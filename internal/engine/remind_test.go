package engine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"jobhunt/internal/store"
)

func TestAConfirmationMarksTheRoleApplied(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Limit: 10})
	id := roles[0].ID
	if r, _ := e.S.Role(id); stageOrder(r.Stage) >= stageOrder("applied") {
		t.Fatalf("the role starts before applied, got %s", r.Stage)
	}
	// Their confirmation arrives; the person never pressed "I applied".
	if _, err := e.PasteMail(ctx, "Acme Corp Careers <no-reply@acme.example>", "Thank you for applying", "We have received your application to Acme Corp for Tax Technology Manager.", 0); err != nil {
		t.Fatal(err)
	}
	r, _ := e.S.Role(id)
	if r.Stage != "applied" || r.AppliedAt == 0 {
		t.Fatalf("a confirmation should mark the role applied: stage=%s applied_at=%d", r.Stage, r.AppliedAt)
	}

	// A role the person said no to is never brought back by mail.
	no, err := e.S.AddRole(store.Role{CompanyID: r.CompanyID, Key: "t:no", Source: "manual", Title: "Indirect Tax Analyst", Stage: "found", Applicants: -1})
	if err != nil {
		t.Fatal(err)
	}
	e.S.CloseRole(no, "no", "not for me")
	if rid := e.appliedElsewhere("Acme Corp", "Indirect Tax Analyst", e.Now().Unix()); rid != 0 {
		t.Errorf("a confirmation reached for a role the person said no to")
	}
	if x, _ := e.S.Role(no); x.Closed != "no" || x.Stage != "found" {
		t.Errorf("the role the person said no to changed: %+v", x)
	}

	// A confirmation for something Job Hunt never found adds it, applied.
	before, _, _ := e.S.Roles(store.RoleFilter{Limit: 50})
	if _, err := e.PasteMail(ctx, "Northwind Talent <jobs@northwind.example>", "Application received", "Thank you for applying for the Senior Analyst position at Northwind Traders. We will be in touch.", 0); err != nil {
		t.Fatal(err)
	}
	after, _, _ := e.S.Roles(store.RoleFilter{Limit: 50})
	if len(after) != len(before)+1 {
		t.Fatalf("want one role added from the confirmation, had %d now %d", len(before), len(after))
	}
	var added store.Role
	for _, x := range after {
		if x.Company == "Northwind Traders" {
			added = x
		}
	}
	if added.Title != "Senior Analyst" || added.Stage != "applied" || added.Source != "mail" {
		t.Errorf("the added role: %+v", added)
	}
}

func TestReminders(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	p := e.S.Profile()
	p.SetupDone = true
	e.S.SaveProfile(p)

	var mu sync.Mutex
	var sent []map[string]any
	ntfy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var m map[string]any
		json.Unmarshal(b, &m)
		mu.Lock()
		sent = append(sent, m)
		mu.Unlock()
	}))
	defer ntfy.Close()
	if err := e.SetPhone(PhoneSet{On: true, Server: ntfy.URL, Topic: "a-long-private-topic", MinFit: 75}); err != nil {
		t.Fatal(err)
	}
	pushed := func() []map[string]any {
		time.Sleep(150 * time.Millisecond)
		mu.Lock()
		defer mu.Unlock()
		out := sent
		sent = nil
		return out
	}

	now := time.Date(2026, 11, 23, 19, 0, 0, 0, time.Local) // a Monday evening
	e.Now = func() time.Time { return now }
	e.S.Now = func() time.Time { return now }
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "Acme Corp"})
	rid, _ := e.S.AddRole(store.Role{CompanyID: c.ID, Key: "t:1", Source: "manual", Title: "Tax Manager", Stage: "ready", Applicants: -1,
		Description: "A fine role. Applications close on " + now.AddDate(0, 0, 2).Format("January 2, 2006") + "."})
	tomorrow := time.Date(2026, 11, 24, 10, 30, 0, 0, time.Local)
	tid, _ := e.S.AddTalk(store.Talk{Kind: "interview", Title: "Interview", RoleID: rid, At: tomorrow.Unix(), Minutes: 45, Prep: json.RawMessage(`{"opening":"Hello"}`)})

	e.remind(now)
	list, _ := e.Notices()
	titles := func() string {
		var s []string
		for _, n := range list {
			s = append(s, n.Title)
		}
		return strings.Join(s, " | ")
	}
	if !strings.Contains(titles(), "Tomorrow at 10:30: interview with Acme Corp") {
		t.Errorf("no evening-before reminder: %s", titles())
	}
	if !strings.Contains(titles(), "Closes on Wednesday: Tax Manager at Acme Corp") {
		t.Errorf("no closing reminder: %s", titles())
	}
	// The phone hears about it without the employer's name.
	got := pushed()
	if len(got) != 2 {
		t.Fatalf("want two phone notices, got %d: %v", len(got), got)
	}
	for _, m := range got {
		if s, _ := json.Marshal(m); strings.Contains(string(s), "Acme") || strings.Contains(string(s), "Tax Manager") {
			t.Errorf("a private notice named the role or employer: %s", s)
		}
	}
	// Nothing is said twice.
	e.remind(now)
	if again, _ := e.Notices(); len(again) != len(list) {
		t.Errorf("reminders were repeated: %d then %d", len(list), len(again))
	}
	pushed()

	// The next morning: the summary, with last week's count on a Monday... it is Tuesday now.
	now = time.Date(2026, 11, 24, 8, 5, 0, 0, time.Local)
	e.remind(now)
	list, _ = e.Notices()
	if !strings.Contains(titles(), "Today: interview at 10:30, 1 ready to send") {
		t.Errorf("no morning summary: %s", titles())
	}
	pushed()

	// An hour and a half after it ended: how did it go.
	now = tomorrow.Add(45*time.Minute + 95*time.Minute)
	e.remind(now)
	list, _ = e.Notices()
	if !strings.Contains(titles(), "How did it go with Acme Corp?") {
		t.Errorf("no after-interview question: %s", titles())
	}
	pushed()

	// The person says: an offer. The role moves; a thank-you can be written.
	if err := e.SetTalkWent(tid, "offer"); err != nil {
		t.Fatal(err)
	}
	if r, _ := e.S.Role(rid); r.Stage != "offer" {
		t.Errorf("after 'offer' the role is at %s", r.Stage)
	}
	if err := e.WriteThanks(context.Background(), tid); err != nil {
		t.Fatal(err)
	}
	if th := e.TalkThanks(tid); th.Body == "" {
		t.Error("no thank-you was written")
	}

	// Urgent only: a closing date stays off the phone, an interview does not.
	set := e.Phone()
	set.Only, set.Detail = "urgent", true
	e.SetPhone(set)
	now = time.Date(2026, 11, 30, 19, 0, 0, 0, time.Local)
	e.Say(false, "A role closes soon", "Closes tomorrow: X at Y", "", "#/roles/1")
	e.Say(true, "A conversation tomorrow", "Tomorrow at 9:00: interview with Acme Corp", "", "#/interviews/1")
	got = pushed()
	if len(got) != 1 || got[0]["title"] != "Tomorrow at 9:00: interview with Acme Corp" || got[0]["priority"] != float64(4) {
		t.Errorf("urgent only, with names: %v", got)
	}
}
