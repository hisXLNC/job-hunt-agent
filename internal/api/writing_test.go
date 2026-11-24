package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/engine"
	"jobhunt/internal/store"
)

const shortCV = `Sam Rivera
Toronto, Canada | sam@example.com

Summary
Finance manager with ten years of experience running the month-end close.

Experience

Finance Manager
Northwind Group, Toronto
2019 - Present
- Ran the month-end close for a group of 14 companies
- Managed a team of six analysts and a vendor budget of CAD 1.2 million
- Automated the consolidation in SAP, cutting the monthly close by four days
- Built the reporting pack the board reads every month in Power BI

Senior Accountant
Contoso Advisory, Toronto
2015 - 2019
- Prepared monthly accounts and reconciliations for clients in retail and logistics
- Trained finance teams on new revenue recognition rules
- Designed the intercompany settlement process for a regional retailer

Education
Bachelor of Commerce, Accounting
University of Toronto
2011 - 2015

Skills
Month-end close, SAP, Excel
`

// readyRole gives the server one role with its CV and letter written.
func readyRole(t *testing.T, srv *Server) int64 {
	t.Helper()
	ctx := context.Background()
	if _, _, err := srv.E.AddCV(ctx, "Sam Rivera CV.txt", []byte(shortCV)); err != nil {
		t.Fatal(err)
	}
	p := srv.S.Profile()
	p.MayPrepare = "ask" // nothing is prepared behind the test's back
	srv.S.SaveProfile(p)
	id, err := srv.E.AddRole("Northwind", "Finance Manager", "Toronto, ON", "", strings.Repeat("Run the month-end close for the group and manage a team of analysts. ", 8), "manual")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; srv.E.Busy(fmt.Sprintf("read:%d", id)); i++ {
		if i > 500 {
			t.Fatal("the role was never read")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := srv.E.Prepare(ctx, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func post(h http.Handler, path, body string) (int, string) {
	w := do(h, call{method: "POST", path: path, marker: true, body: body})
	return w.Code, w.Body.String()
}

func TestRoleDocumentsAsPDF(t *testing.T) {
	srv, h := newServer(t)
	id := readyRole(t, srv)
	for path, name := range map[string]string{
		"cv.pdf":     "Sam Rivera - Northwind - CV.pdf",
		"letter.pdf": "Sam Rivera - Northwind - Letter.pdf",
		"both.pdf":   "Sam Rivera - Northwind - Letter and CV.pdf",
	} {
		w := do(h, call{path: fmt.Sprintf("/api/roles/%d/%s", id, path)})
		if w.Code != 200 || w.Header().Get("Content-Type") != "application/pdf" || !strings.HasPrefix(w.Body.String(), "%PDF-") {
			t.Fatalf("%s: %d %s", path, w.Code, w.Header().Get("Content-Type"))
		}
		if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, name) {
			t.Errorf("%s is called %q, want %q", path, cd, name)
		}
	}
	if w := do(h, call{path: "/api/roles/9999/cv.pdf"}); w.Code != 404 {
		t.Errorf("a role that is not there: %d", w.Code)
	}
}

func TestLetterStyleAskAndPutBack(t *testing.T) {
	srv, h := newServer(t)
	id := readyRole(t, srv)
	detail := func() map[string]any {
		var out map[string]any
		json.Unmarshal(do(h, call{path: fmt.Sprintf("/api/roles/%d", id)}).Body.Bytes(), &out)
		return out
	}
	first := detail()
	if first["letter_style"] != "standard" || first["letter_prev"] != nil || first["pdf_gap"] != false {
		t.Fatalf("at first: style=%v prev=%v gap=%v", first["letter_style"], first["letter_prev"], first["pdf_gap"])
	}
	role := fmt.Sprintf("/api/roles/%d/", id)
	if code, body := post(h, role+"letterstyle", `{"style":"formal"}`); code != 200 {
		t.Fatalf("style: %d %s", code, body)
	}
	if d := detail(); d["letter_style"] != "formal" || d["letter_prev"] == nil || d["letter"] == first["letter"] {
		t.Fatalf("after formal: %v %v", d["letter_style"], d["letter_prev"])
	}
	// The person's own edit keeps the style.
	post(h, role+"letter", `{"text":"My own words."}`)
	if d := detail(); d["letter"] != "My own words." || d["letter_style"] != "formal" {
		t.Fatalf("an edit lost the style: %v", d["letter_style"])
	}
	if code, _ := post(h, role+"undoletter", ""); code != 200 {
		t.Fatal("put back failed")
	}
	if d := detail(); d["letter"] != first["letter"] || d["letter_style"] != "standard" {
		t.Fatal("the first letter did not come back")
	}
	for _, c := range []struct{ action, body string }{
		{"undoletter", ""}, {"undocv", ""}, {"letterstyle", `{"style":"loud"}`}, {"askletter", `{"ask":"  "}`}, {"askcv", `{}`},
		{"later", `{"days":2}`}, {"unapply", ""}, {"chase", ""}, {"chasesave", `{"text":"x"}`},
	} {
		if code, body := post(h, role+c.action, c.body); code != 400 {
			t.Errorf("%s %s: %d %s", c.action, c.body, code, body)
		}
	}
	if code, body := post(h, role+"askcv", `{"ask":"Fewer changes"}`); code != 200 {
		t.Fatalf("askcv: %d %s", code, body)
	}
	var doc engine.TailoredCV
	if srv.S.Doc(id, "cv", &doc); doc.Prev == nil || doc.Prev.Ask != "Fewer changes" {
		t.Fatalf("the CV before was not kept: %+v", doc.Prev)
	}
	if code, _ := post(h, role+"undocv", ""); code != 200 {
		t.Fatal("putting the CV back failed")
	}
}

func TestLaterUnapplyFollowUpAndTidyRoutes(t *testing.T) {
	srv, h := newServer(t)
	id := readyRole(t, srv)
	role := fmt.Sprintf("/api/roles/%d/", id)
	list := func(q string) (int, map[string]int) {
		var out struct {
			Total  int            `json:"total"`
			Counts map[string]int `json:"counts"`
		}
		json.Unmarshal(do(h, call{path: "/api/roles?" + q}).Body.Bytes(), &out)
		return out.Total, out.Counts
	}
	if code, body := post(h, role+"later", `{"days":3}`); code != 200 {
		t.Fatalf("later: %d %s", code, body)
	}
	if n, counts := list("later=1"); n != 1 || counts["later"] != 1 {
		t.Fatalf("saved for later: %d, %v", n, counts)
	}
	post(h, role+"later", `{"days":0}`)
	if n, counts := list("later=1"); n != 0 || counts["later"] != 0 {
		t.Fatalf("brought back: %d, %v", n, counts)
	}

	// Applied by mistake, then taken back.
	post(h, role+"applied", "")
	if code, body := post(h, role+"unapply", ""); code != 200 {
		t.Fatalf("unapply: %d %s", code, body)
	}
	if r, _ := srv.S.Role(id); r.Stage != "ready" || r.AppliedAt != 0 {
		t.Fatalf("after unapply: %s", r.Stage)
	}

	// The follow-up: written, reworded, sent once.
	post(h, role+"applied", "")
	if code, body := post(h, role+"chase", ""); code != 200 {
		t.Fatalf("chase: %d %s", code, body)
	}
	post(h, role+"chasesave", `{"subject":"Still keen","text":"Hello,\n\nMine."}`)
	var d struct {
		Chase engine.ChaseDoc `json:"chase"`
	}
	json.Unmarshal(do(h, call{path: fmt.Sprintf("/api/roles/%d", id)}).Body.Bytes(), &d)
	if d.Chase.Subject != "Still keen" || !strings.Contains(d.Chase.Body, "Mine.") || d.Chase.SentAt != 0 {
		t.Fatalf("follow-up: %+v", d.Chase)
	}
	if code, _ := post(h, role+"chasesent", ""); code != 200 {
		t.Fatal("chasesent failed")
	}
	if code, body := post(h, role+"chase", ""); code != 400 || !strings.Contains(body, "already followed up") {
		t.Fatalf("a second follow-up: %d %s", code, body)
	}
	// A role the person said no to cannot be saved for later.
	post(h, role+"no", `{"why":"no"}`)
	if code, _ := post(h, role+"later", `{"days":1}`); code != 400 {
		t.Fatal("a closed role was saved for later")
	}
	if r, _ := srv.S.Role(id); r.Closed != "no" {
		t.Fatalf("closed = %q", r.Closed)
	}

	// Tidy closes a reopened taken-down role, and says how many.
	co, _, _ := srv.S.UpsertCompany(store.Company{Name: "Northwind"})
	gone, _ := srv.S.AddRole(store.Role{CompanyID: co.ID, Key: "greenhouse:1", Source: "greenhouse", Title: "Analyst", Applicants: -1})
	srv.S.MarkGone(gone)
	srv.S.Reopen(gone)
	if _, counts := list(""); counts["taken_down"] != 1 {
		t.Fatalf("taken down: %v", counts)
	}
	if code, body := post(h, "/api/roles/tidy", ""); code != 200 || !strings.Contains(body, `"closed":1`) {
		t.Fatalf("tidy: %d %s", code, body)
	}
	if r, err := srv.S.Role(gone); err != nil || r.Closed != "expired" {
		t.Fatalf("after tidy: %+v %v", r.Closed, err)
	}
}

func TestProfileSettingsForLettersFollowUpsAndGoal(t *testing.T) {
	srv, h := newServer(t)
	put := func(body string) (int, string) {
		w := do(h, call{method: "PUT", path: "/api/profile", marker: true, body: body})
		return w.Code, w.Body.String()
	}
	if p := srv.S.Profile(); p.LetterStyle != "standard" || p.ChaseAfter() != 8 || p.Goal() != 10 {
		t.Fatalf("defaults: %s %d %d", p.LetterStyle, p.ChaseAfter(), p.Goal())
	}
	if code, body := put(`{"letter_style":"warm","signature":"Kind regards,\n\n  Sam Rivera, CPA  ","chase_days":0,"weekly_goal":5}`); code != 200 {
		t.Fatalf("%d %s", code, body)
	}
	p := srv.S.Profile()
	if p.LetterStyle != "warm" || p.Signature != "Kind regards,\nSam Rivera, CPA" || p.ChaseAfter() != 0 || p.Goal() != 5 {
		t.Fatalf("saved: %+v", p)
	}
	// Another change leaves them alone.
	put(`{"city":"Toronto"}`)
	if p = srv.S.Profile(); p.LetterStyle != "warm" || p.ChaseAfter() != 0 || p.Goal() != 5 {
		t.Fatalf("lost on a later save: %+v", p)
	}
	for _, body := range []string{`{"letter_style":"loud"}`, `{"chase_days":-1}`, `{"chase_days":400}`, `{"weekly_goal":1000}`} {
		if code, _ := put(body); code != 400 {
			t.Errorf("%s was accepted", body)
		}
	}
}

func TestAssistantAndTheNewRoleRoutes(t *testing.T) {
	srv, h, sc := withScript(t)
	id := readyRole(t, srv)
	co, _, _ := srv.S.UpsertCompany(store.Company{Name: "Northwind"})
	gone, _ := srv.S.AddRole(store.Role{CompanyID: co.ID, Key: "greenhouse:1", Source: "greenhouse", Title: "Analyst", Applicants: -1})
	srv.S.MarkGone(gone)
	srv.S.Reopen(gone)
	sc.steps = []brain.AssistStep{
		calls(brain.AssistCall{Method: "POST", Path: fmt.Sprintf("/api/roles/%d/later", id), Body: `{"days":7}`},
			brain.AssistCall{Method: "POST", Path: fmt.Sprintf("/api/roles/%d/letterstyle", id), Body: `{"style":"short"}`},
			brain.AssistCall{Method: "POST", Path: "/api/roles/tidy"},
			brain.AssistCall{Method: "GET", Path: fmt.Sprintf("/api/roles/%d/both.pdf", id)}),
		{Say: "Done; the tidy waits for your OK."}}
	v := tell(t, h, "Save this for next week, make the letter short and clear out the dead postings", fmt.Sprintf("#/roles/%d", id))
	last := v.Turns[len(v.Turns)-1]
	if len(last.Extra.Did) != 2 || !strings.HasPrefix(last.Extra.Did[0].Label, "Save for later: Finance Manager at Northwind") || !last.Extra.Did[1].OK {
		t.Fatalf("done at once: %+v", last.Extra.Did)
	}
	// Closing roles waits for the person, and the button says how many.
	if len(last.Extra.Held) != 1 || last.Extra.Held[0].Label != "Clear taken-down roles (1)" {
		t.Fatalf("held: %+v", last.Extra.Held)
	}
	if r, _ := srv.S.Role(gone); r.Closed != "" {
		t.Fatal("roles were closed without the person's OK")
	}
	if r, _ := srv.S.Role(id); r.LaterUntil == 0 {
		t.Fatal("the role was not saved for later")
	}
	var letter engine.LetterDoc
	if srv.S.Doc(id, "letter", &letter); letter.Style != "short" || letter.Prev == nil {
		t.Fatalf("letter: %+v", letter)
	}
	// Files are for the person to download; they are not on the assistant's list.
	if n := sc.seen[1].Notes; !strings.HasPrefix(n[len(n)-1].Result, "Not made") {
		t.Fatalf("the PDF was fetched: %+v", n[len(n)-1])
	}
}
