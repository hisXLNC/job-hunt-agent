package engine

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

const testCV = `Sam Rivera
Dubai, United Arab Emirates | sam@example.com | +971 50 000 0000

Summary
Tax technology manager with ten years of experience implementing indirect tax engines and e-invoicing for multinational groups.

Experience

Tax Technology Manager
Northwind Group, Dubai
2019 - Present
- Led the implementation of a Vertex indirect tax engine across 14 countries on SAP S/4HANA
- Built e-invoicing integrations for Saudi Arabia and Egypt handling 2 million invoices a month
- Managed a team of six analysts and a vendor budget of USD 1.2 million
- Automated VAT return preparation with Alteryx, cutting the monthly close by four days

Senior Tax Analyst
Contoso Advisory, Dubai
2015 - 2019
- Prepared VAT and GST returns for clients in retail and logistics
- Designed tax determination logic in SAP for a regional retailer
- Trained finance teams on new VAT rules

Education
Bachelor of Commerce, Accounting
University of Jordan
2011 - 2015

Skills
SAP S/4HANA, Vertex, Alteryx, Power BI, SQL, e-invoicing, VAT, GST, indirect tax
`

const goodAd = `<p>We are hiring a tax technology manager to own our indirect tax engine.</p><ul>
<li>Implementation of a Vertex indirect tax engine on SAP S/4HANA</li>
<li>Experience with e-invoicing integrations handling large invoice volumes</li>
<li>Managed a team of analysts and a vendor budget</li>
<li>Automated VAT and GST return preparation with Alteryx</li>
<li>Designed tax determination logic in SAP</li></ul>
<p>You will work with finance teams across the group and report to the head of tax. The role is hybrid in our Toronto office.</p>`

func job(id int, title, loc, content string) map[string]any {
	return map[string]any{"id": id, "title": title, "absolute_url": fmt.Sprintf("https://boards.greenhouse.io/acme/jobs/%d", id),
		"content": content, "location": map[string]string{"name": loc}, "first_published": time.Now().Add(-40 * time.Minute).Format(time.RFC3339)}
}

type world struct {
	mu   sync.Mutex
	jobs []map[string]any
	li   int // status LinkedIn answers with
}

func newEngine(t *testing.T) (*Engine, *world) {
	t.Helper()
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	w := &world{li: 200}
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.mu.Lock()
		defer w.mu.Unlock()
		switch {
		case strings.Contains(r.URL.Path, "/v1/boards/acme/jobs"):
			json.NewEncoder(rw).Encode(map[string]any{"jobs": w.jobs})
		case strings.Contains(r.URL.Path, "seeMoreJobPostings"):
			rw.WriteHeader(w.li)
		default:
			http.NotFound(rw, r)
		}
	}))
	e := New(s, t.TempDir())
	e.Src = &sources.Client{Base: map[string]string{"greenhouse": srv.URL, "linkedin": srv.URL}}
	t.Cleanup(func() { e.Stop(); srv.Close(); s.Close() })
	if err := e.SetLLM(LLMSettings{Engine: "demo"}); err != nil {
		t.Fatal(err)
	}
	return e, w
}

func setUp(t *testing.T, e *Engine) store.Company {
	t.Helper()
	ctx := context.Background()
	c, prop, err := e.AddCV(ctx, "Sam Rivera CV.txt", []byte(testCV))
	if err != nil {
		t.Fatal(err)
	}
	if c.ID == 0 || prop == nil {
		t.Fatal("no CV stored")
	}
	p := e.S.Profile()
	if p.Name != "Sam Rivera" {
		t.Fatalf("name = %q", p.Name)
	}
	if len(p.Titles.StepUp) == 0 || len(p.Titles.Sideways) == 0 {
		t.Fatalf("step-up and sideways titles must be proposed: %+v", p.Titles)
	}
	p.City, p.Country, p.SetupDone = "Toronto", "Canada", true
	p.ArriveOn = time.Now().AddDate(0, 0, 40).Format("2006-01-02")
	if err := e.S.SaveProfile(p); err != nil {
		t.Fatal(err)
	}
	co, _, err := e.S.UpsertCompany(store.Company{Name: "Acme Corp", State: "following"})
	if err != nil {
		t.Fatal(err)
	}
	co.BoardKind, co.BoardToken = "greenhouse", "acme"
	if err := e.S.SaveCompany(co); err != nil {
		t.Fatal(err)
	}
	return co
}

func TestSearchReadPrepareApply(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	w.jobs = []map[string]any{
		job(1, "Tax Technology Manager", "Toronto, ON", goodAd),
		job(2, "Tax Technology Intern", "Toronto, ON", goodAd),
		job(3, "Tax Technology Manager", "Berlin, Germany", goodAd),
		job(4, "Warehouse Supervisor", "Toronto, ON", "<p>Run the night shift.</p>"),
		job(5, "Lead Tax Technology Manager", "Mississauga, Ontario", goodAd),
	}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	all, _, _ := e.S.Roles(store.RoleFilter{Closed: []string{"*"}, Unread: true, Limit: 50})
	by := map[string]store.Role{}
	for _, r := range all {
		by[r.Title+"|"+r.Location] = r
	}
	if len(all) != 5 {
		t.Fatalf("want 5 roles recorded, got %d", len(all))
	}
	good := by["Tax Technology Manager|Toronto, ON"]
	if good.Stage != "ready" || good.Fit < prepareFit {
		t.Fatalf("the matching role should be read and prepared at once: stage=%s fit=%d closed=%s", good.Stage, good.Fit, good.Closed)
	}
	if good.FitTailored < good.Fit {
		t.Errorf("tailored fit %d below fit %d", good.FitTailored, good.Fit)
	}
	if r := by["Tax Technology Intern|Toronto, ON"]; r.Closed != "screened" {
		t.Errorf("intern role should be set aside, got %+v", r)
	}
	if r := by["Tax Technology Manager|Berlin, Germany"]; r.Closed != "screened" || !strings.Contains(r.ClosedWhy, "somewhere else") {
		t.Errorf("Berlin role should be set aside for place, got closed=%q why=%q", r.Closed, r.ClosedWhy)
	}
	if r := by["Warehouse Supervisor|Toronto, ON"]; r.Closed != "screened" {
		t.Errorf("unrelated role should be set aside, got %+v", r)
	}
	// A step-up title is treated like any other wanted title.
	up := by["Lead Tax Technology Manager|Mississauga, Ontario"]
	if up.Closed != "" || up.Band != "step_up" {
		t.Errorf("step-up role must be kept and marked as a step up: closed=%q band=%q stage=%s", up.Closed, up.Band, up.Stage)
	}

	// The documents exist and render.
	base, out, doc, err := e.RoleCV(good.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Changes) == 0 {
		t.Error("tailoring proposed no changes")
	}
	if base.Name != out.Name {
		t.Error("tailoring must not change the name")
	}
	f, err := e.CVFile(good.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := zip.NewReader(bytes.NewReader(f.Data), int64(len(f.Data))); err != nil {
		t.Fatalf("CV file is not a .docx: %v", err)
	}
	if !strings.HasSuffix(f.Name, ".docx") || strings.ContainsAny(f.Name, `/\:`) {
		t.Errorf("bad file name %q", f.Name)
	}
	if _, err := e.LetterFile(good.ID); err != nil {
		t.Fatal(err)
	}
	// Switching a change off changes what is sent.
	if err := e.SetChange(good.ID, 0, true, nil); err != nil {
		t.Fatal(err)
	}
	_, out2, _, _ := e.RoleCV(good.ID)
	if a, _ := json.Marshal(out); string(a) == string(mustJSON(out2)) {
		t.Error("switching a change off made no difference")
	}

	// Today puts it in front of the person.
	brief := e.Today()
	found := false
	for _, c := range brief.Cards {
		if c.Kind == "apply" && c.RoleID == good.ID {
			found = true
			if !c.Fresh {
				t.Error("a 40-minute-old posting should be marked fresh")
			}
		}
	}
	if !found {
		t.Errorf("ready role missing from Today: %+v", brief.Cards)
	}
	if brief.Landing == nil || brief.Landing.Days < 39 {
		t.Errorf("a relocating person should see the landing list: %+v", brief.Landing)
	}

	// Applying.
	if err := e.MarkApplied(good.ID, ""); err != nil {
		t.Fatal(err)
	}
	r, _ := e.S.Role(good.ID)
	if r.Stage != "applied" || r.AppliedAt == 0 {
		t.Fatalf("not applied: %+v", r.Stage)
	}
	// The posting is taken down: an applied role keeps its text and stays open.
	w.mu.Lock()
	w.jobs = []map[string]any{job(5, "Lead Tax Technology Manager", "Mississauga, Ontario", goodAd)}
	w.mu.Unlock()
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	r, _ = e.S.Role(good.ID)
	if r.Closed != "" || r.Description == "" || r.GoneAt == 0 {
		t.Errorf("an applied role whose posting went down must keep its text: closed=%q gone=%d len=%d", r.Closed, r.GoneAt, len(r.Description))
	}
	pr := e.Progress()
	if pr.Speed.Applied != 1 || pr.Speed.FirstDay != 1 {
		t.Errorf("progress: %+v", pr.Speed)
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestNotInterestedStaysClosed(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Limit: 10})
	if len(roles) != 1 {
		t.Fatalf("want one role, got %d", len(roles))
	}
	id := roles[0].ID
	if err := e.NotInterested(id, "wrong team"); err != nil {
		t.Fatal(err)
	}
	// The employer reposts it under a new id, and it shows up again.
	w.mu.Lock()
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd), job(77, "Tax Technology Manager", "Toronto, ON", goodAd)}
	w.mu.Unlock()
	for i := 0; i < 2; i++ {
		if err := e.Search(ctx, "full"); err != nil {
			t.Fatal(err)
		}
	}
	open, _, _ := e.S.Roles(store.RoleFilter{Unread: true, Limit: 10})
	if len(open) != 0 {
		t.Fatalf("a role the person said no to came back: %+v", open)
	}
	r, _ := e.S.Role(id)
	if r.Closed != "no" {
		t.Fatalf("closed = %q", r.Closed)
	}
	// Nothing the program does can move it.
	e.S.Advance(id, "interview")
	e.S.CloseRole(id, "expired", "")
	e.ReadRole(ctx, id)
	if r, _ = e.S.Role(id); r.Closed != "no" || r.Stage == "interview" {
		t.Fatalf("a no was overturned: %+v", r)
	}
}

func TestLinkedInBackOff(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	w.li = 429
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	st := e.searchState()
	if st.LinkedInUntil <= time.Now().Unix() {
		t.Fatal("LinkedIn said slow down and Job Hunt did not back off")
	}
}

func TestSchedule(t *testing.T) {
	loc := time.UTC
	at := func(h, m int) time.Time { return time.Date(2026, 11, 24, h, m, 0, 0, loc) }
	// Never searched: now.
	if got := nextFull(at(9, 0), 0); !got.Equal(at(9, 0)) {
		t.Errorf("never searched: %v", got)
	}
	// Searched at 07:05: next is 12:30.
	if got := nextFull(at(9, 0), at(7, 5).Unix()); !got.Equal(at(12, 30)) {
		t.Errorf("after the morning search: %v", got)
	}
	// Computer was off over lunch: catch up now.
	if got := nextFull(at(14, 0), at(7, 5).Unix()); !got.Equal(at(14, 0)) {
		t.Errorf("missed search: %v", got)
	}
	// After the evening search: tomorrow 07:00.
	if got := nextFull(at(20, 0), at(17, 31).Unix()); !got.Equal(at(7, 0).AddDate(0, 0, 1)) {
		t.Errorf("overnight: %v", got)
	}
	if !quiet(PhoneSet{QuietFrom: 22, QuietTo: 7}, 23) || !quiet(PhoneSet{QuietFrom: 22, QuietTo: 7}, 3) || quiet(PhoneSet{QuietFrom: 22, QuietTo: 7}, 12) {
		t.Error("quiet hours")
	}
}

func TestPlaceAndTitleRules(t *testing.T) {
	p := store.Profile{City: "Toronto", Country: "Canada", Domain: []string{"tax"},
		Titles: store.Titles{Level: []string{"Tax Technology Manager"}, StepUp: []string{"Director, Tax Technology"}, Sideways: []string{"Finance Systems Manager"}}}
	for loc, want := range map[string]bool{
		"Toronto, ON": true, "Mississauga, Ontario, Canada": true, "Remote - Canada": true, "Remote": true, "Canada": true, "": true,
		"Vancouver, BC": false, "Berlin": false, "Remote - United States": false, "London, UK": false, "Boston, MA": false,
	} {
		if got := placeOK(p, loc, ""); got != want {
			t.Errorf("placeOK(%q) = %v, want %v", loc, got, want)
		}
	}
	for title, want := range map[string]string{
		"Senior Manager, Tax Technology": "level", "Director of Tax Technology": "step_up", "Finance Systems Manager": "sideways",
		"Indirect Tax Lead": "*", "Software Engineer": "", "Barista": "",
	} {
		ok, band := titleOK(p, title)
		switch {
		case want == "" && ok:
			t.Errorf("titleOK(%q) should be false", title)
		case want == "*" && !ok:
			t.Errorf("titleOK(%q) should pass on the field word", title)
		case want != "" && want != "*" && (!ok || band != want):
			t.Errorf("titleOK(%q) = %v %q, want %q", title, ok, band, want)
		}
	}
	if why, _ := screen(store.Profile{City: "Toronto", Domain: []string{"tax"}, Avoid: []string{"Acme"}}, sources.Posting{Title: "Tax Manager", Company: "Acme Corp"}, false); why == "" {
		t.Error("avoid list ignored")
	}
}

// ---- mail -----------------------------------------------------------------------------

type fakeIMAP struct {
	msgs map[int]string // uid → raw message
	log  []string
}

func (f *fakeIMAP) serve(c net.Conn) {
	defer c.Close()
	r := bufio.NewReader(c)
	fmt.Fprintf(c, "* OK ready\r\n")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		f.log = append(f.log, line)
		tag, rest, _ := strings.Cut(line, " ")
		up := strings.ToUpper(rest)
		switch {
		case strings.HasPrefix(up, "LOGIN"):
			if !strings.Contains(rest, `"app-pass"`) {
				fmt.Fprintf(c, "%s NO bad credentials\r\n", tag)
				continue
			}
			fmt.Fprintf(c, "%s OK\r\n", tag)
		case strings.HasPrefix(up, "EXAMINE"):
			fmt.Fprintf(c, "* OK [UIDVALIDITY 9] ok\r\n%s OK [READ-ONLY]\r\n", tag)
		case strings.HasPrefix(up, "UID SEARCH"):
			fmt.Fprintf(c, "* SEARCH")
			for uid := range f.msgs {
				fmt.Fprintf(c, " %d", uid)
			}
			fmt.Fprintf(c, "\r\n%s OK\r\n", tag)
		case strings.HasPrefix(up, "UID FETCH") && strings.Contains(up, "HEADER.FIELDS"):
			set := strings.Fields(rest)[2]
			for _, u := range strings.Split(set, ",") {
				var uid int
				fmt.Sscan(u, &uid)
				head, _, _ := strings.Cut(f.msgs[uid], "\r\n\r\n")
				head += "\r\n\r\n"
				fmt.Fprintf(c, "* %d FETCH (UID %d BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {%d}\r\n%s)\r\n", uid, uid, len(head), head)
			}
			fmt.Fprintf(c, "%s OK\r\n", tag)
		case strings.HasPrefix(up, "UID FETCH"):
			var uid int
			fmt.Sscan(strings.Fields(rest)[2], &uid)
			m := f.msgs[uid]
			fmt.Fprintf(c, "* %d FETCH (BODY[]<0> {%d}\r\n%s UID %d)\r\n%s OK\r\n", uid, len(m), m, uid, tag)
		case strings.HasPrefix(up, "LOGOUT"):
			fmt.Fprintf(c, "* BYE\r\n%s OK\r\n", tag)
			return
		default:
			fmt.Fprintf(c, "%s BAD\r\n", tag)
		}
	}
}

func rawMail(from, subject, body string) string {
	return "From: " + from + "\r\nSubject: " + subject + "\r\nDate: Tue, 24 Nov 2026 10:00:00 +0000\r\nMessage-ID: <" + fmt.Sprint(len(subject), len(body)) + "@x>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body
}

func TestMail(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Limit: 10})
	id := roles[0].ID
	e.MarkApplied(id, "")

	f := &fakeIMAP{msgs: map[int]string{
		1: rawMail(`"Dana at Acme Corp" <dana@acme.example>`, "Interview for Tax Technology Manager", "Hi Sam,\r\nWe would like to schedule a call. What is your availability next week?\r\nDana"),
		2: rawMail(`"Shoe Shop" <deals@shoes.example>`, "50% off everything", "Private: this must never be read."),
		3: rawMail(`"Bank" <alerts@bank.example>`, "Your statement", "Account details."),
	}}
	e.mailDial = func(ctx context.Context, host string) (net.Conn, error) {
		a, b := net.Pipe()
		go f.serve(b)
		return a, nil
	}
	if err := e.SetMail(ctx, MailSet{On: true, User: "me@example.com", Pass: "wrong"}); err == nil {
		t.Fatal("a wrong password was accepted")
	}
	if err := e.S.Set("mail", MailSet{On: true, User: "me@example.com", Pass: "app-pass"}); err != nil {
		t.Fatal(err)
	}
	if err := e.CheckMail(ctx); err != nil {
		t.Fatal(err)
	}
	mails, total, _ := e.S.Mails(store.MailFilter{})
	if total != 1 || mails[0].Kind != "interview" || mails[0].RoleID != id {
		t.Fatalf("want exactly the employer's message, filed as an interview: %+v", mails)
	}
	if r, _ := e.S.Role(id); r.Stage != "interview" {
		t.Errorf("role stage = %s", r.Stage)
	}
	// Unrelated mail was never opened.
	for _, l := range f.log {
		if strings.Contains(l, "BODY.PEEK[]") && !strings.Contains(l, "FETCH 1 ") {
			t.Errorf("opened mail that has nothing to do with the search: %s", l)
		}
		up := strings.ToUpper(l)
		if strings.Contains(up, "STORE") || strings.Contains(up, "SELECT ") || strings.Contains(up, "APPEND") || strings.Contains(up, "EXPUNGE") {
			t.Errorf("mail must be read-only, sent: %s", l)
		}
	}
	// A second check takes nothing twice.
	if err := e.CheckMail(ctx); err != nil {
		t.Fatal(err)
	}
	if _, total, _ := e.S.Mails(store.MailFilter{}); total != 1 {
		t.Errorf("mail taken twice: %d", total)
	}
	// A rejection pasted by hand closes the role but keeps it.
	if _, err := e.PasteMail(ctx, "Acme Corp Talent <no-reply@acme.example>", "Your application", "Unfortunately we are not moving forward with your application to Acme Corp.", id); err != nil {
		t.Fatal(err)
	}
	if r, _ := e.S.Role(id); r.Closed != "rejected" || r.Description == "" {
		t.Errorf("rejection: closed=%q", r.Closed)
	}
}

func TestConnectionsImport(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	csv := "Notes:\n\"When exporting your connection data, you may notice...\"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n" +
		"Lee,Park,https://www.linkedin.com/in/leepark,,Acme Corp.,Finance Director,01 Jan 2024\n" +
		"Ana,Lopez,https://www.linkedin.com/in/analopez,,Somewhere Else Ltd,Engineer,02 Jan 2024\n"
	added, at, err := e.ImportConnections([]byte(csv))
	if err != nil {
		t.Fatal(err)
	}
	if added != 1 || at != 1 {
		t.Fatalf("added=%d at=%d", added, at)
	}
	people, _ := e.S.People(store.PeopleFilter{})
	if len(people) != 1 || people[0].Name != "Lee Park" || people[0].KnowsYouAt == 0 {
		t.Fatalf("only the person at a watched employer is kept: %+v", people)
	}
	// And a note can be drafted to them; it stays a draft until the person sends it.
	n, err := e.DraftNote(context.Background(), people[0].ID, "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if n.State != "draft" || n.Body == "" || len(n.Body) > 300 {
		t.Errorf("note: state=%s len=%d", n.State, len(n.Body))
	}
}

func TestArrivingAndTalks(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	if err := e.BuildArriving(ctx); err != nil {
		t.Fatal(err)
	}
	doc, ok := e.Arriving()
	if !ok || len(doc.Screening) == 0 {
		t.Fatalf("no arrival pack: %+v", doc)
	}
	id, err := e.ApplyArriving()
	if err != nil {
		t.Fatal(err)
	}
	if cvs, _ := e.S.CVs(); len(cvs) != 2 || cvs[1].ID != id {
		t.Fatalf("the original CV must stay and a copy be added: %d", len(cvs))
	}
	tid, err := e.S.AddTalk(store.Talk{Kind: "chat", Title: "Coffee", At: time.Now().Add(24 * time.Hour).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.PrepTalk(ctx, tid); err != nil {
		t.Fatal(err)
	}
	if tk, _ := e.S.Talk(tid); len(tk.Prep) < 20 {
		t.Error("no prep pack")
	}
	name, ics, err := e.ICS(tid)
	if err != nil || !strings.HasSuffix(name, ".ics") || !bytes.Contains(ics, []byte("BEGIN:VEVENT")) {
		t.Errorf("ics: %q %v", name, err)
	}
	rep, err := e.Ask(ctx, "I hold a CPA and I arrive on 2027-02-01. How is my search going?")
	if err != nil || rep.Reply == "" {
		t.Fatalf("ask: %+v %v", rep, err)
	}
}
