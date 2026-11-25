package engine

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// addRole puts an open role in the store as a search would, first seen at a
// moment, and moves it to a stage.
func addRole(t *testing.T, e *Engine, company store.Company, title, stage string, seen time.Time) int64 {
	t.Helper()
	was := e.S.Now
	e.S.Now = func() time.Time { return seen }
	defer func() { e.S.Now = was }()
	id, err := e.S.AddRole(store.Role{CompanyID: company.ID, Key: "test:" + title, Source: "greenhouse", Title: title, Location: "Toronto, ON", Applicants: -1})
	if err != nil {
		t.Fatal(err)
	}
	if stage != "new" {
		e.S.Advance(id, stage)
	}
	return id
}

func role(t *testing.T, e *Engine, id int64) store.Role {
	t.Helper()
	r, err := e.S.Role(id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// Ratings: looked up by themselves, shown with roles, and a floor that sets
// aside roles at employers rated under it, never one the person said no to,
// saved or added, and never at an employer with no rating.
func TestCompanyRatings(t *testing.T) {
	e, w := newEngine(t)
	acme := setUp(t, e)
	ctx := context.Background()
	rating := 2.8
	stand := brain.StandIn()
	looked := 0
	e.CLIStandIn = llm.Func(func(ctx context.Context, req llm.Request) (llm.Response, error) {
		if req.Task == "reviews" {
			looked++
			return llm.Response{Text: fmt.Sprintf(`{"rating":%.1f,"count":120,"sources":[],"likes":[],"warns":[],"note":""}`, rating)}, nil
		}
		return stand.Do(ctx, req)
	})
	set := e.LLM()
	set.Engine = "claude-code"
	e.SetLLM(set)

	now := time.Now()
	open := addRole(t, e, acme, "Tax Technology Manager", "found", now)
	no := addRole(t, e, acme, "Tax Systems Lead", "found", now)
	e.NotInterested(no, "too far")
	saved := addRole(t, e, acme, "Indirect Tax Manager", "found", now)
	e.S.SetSaved(saved, true)
	mine, _ := e.AddRole("Acme Corp", "VAT Technology Manager", "Toronto", "", "", "manual")

	// The chore looks up the employer of a role worth a look, once.
	e.lookUpRatings(now)
	for i := 0; i < 200 && (e.Busy("ratings") || e.EmployerRating(acme.ID) == 0); i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if looked != 1 || e.EmployerRating(acme.ID) != 2.8 {
		t.Fatalf("looked %d times, rating %.1f", looked, e.EmployerRating(acme.ID))
	}
	e.lookUpRatings(now.Add(time.Minute))
	if e.Busy("ratings") {
		t.Error("lookups are spaced twenty minutes apart")
	}
	other, _, _ := e.S.UpsertCompany(store.Company{Name: "Unrated Ledger", State: "following"})
	unrated := addRole(t, e, other, "Tax Technology Manager II", "found", now)
	if r := e.Ratings(); r[acme.ID] != 2.8 {
		t.Errorf("ratings = %v", r)
	}
	if role(t, e, open).Closed != "" {
		t.Fatal("no floor, nothing set aside")
	}

	if err := e.SetSearchSet(SearchSet{MinRating: 3.5}); err != nil {
		t.Fatal(err)
	}
	if r := role(t, e, open); r.Closed != "screened" || !strings.HasPrefix(r.ClosedWhy, "Employees rate Acme Corp 2.8") {
		t.Errorf("role at a low-rated employer: closed=%q why=%q", r.Closed, r.ClosedWhy)
	}
	if r := role(t, e, no); r.Closed != "no" {
		t.Errorf("not interested must stay not interested, got %q", r.Closed)
	}
	if r := role(t, e, saved); r.Closed != "" {
		t.Error("a saved role is never set aside")
	}
	if r := role(t, e, mine); r.Closed != "" {
		t.Error("a role the person added is never set aside")
	}
	if r := role(t, e, unrated); r.Closed != "" {
		t.Error("an employer with no rating is never set aside")
	}

	// New postings there are set aside as they come in.
	w.jobs = []map[string]any{job(7, "Senior Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	all, _, _ := e.S.Roles(store.RoleFilter{Closed: []string{"*"}, Unread: true, Limit: 50})
	for _, r := range all {
		if r.Title == "Senior Tax Technology Manager" && (r.Closed != "screened" || !strings.HasPrefix(r.ClosedWhy, "Employees rate")) {
			t.Errorf("new posting at a low-rated employer: closed=%q why=%q", r.Closed, r.ClosedWhy)
		}
	}

	// A better rating, or the floor off, brings them back.
	rating = 4.1
	if err := e.lookUpReviews(ctx, acme.ID); err != nil {
		t.Fatal(err)
	}
	if r := role(t, e, open); r.Closed != "" {
		t.Errorf("a rating over the floor brings the role back: %q %q", r.Closed, r.ClosedWhy)
	}
	if r := role(t, e, no); r.Closed != "no" {
		t.Error("not interested is never reopened")
	}
	rating = 2.0
	e.lookUpReviews(ctx, acme.ID)
	e.SetSearchSet(SearchSet{})
	if r := role(t, e, open); r.Closed != "" {
		t.Errorf("the floor off brings the role back: %q", r.Closed)
	}
}

// Old matches: off unless chosen; then roles nobody acted on in that many
// days are set aside, never deleted, and never one saved, applied to, said
// no to, prepared, saved for later or added by the person.
func TestOldMatchesCleared(t *testing.T) {
	e, _ := newEngine(t)
	acme := setUp(t, e)
	now := time.Now()
	old := now.Add(-70 * 24 * time.Hour)
	stale := addRole(t, e, acme, "Tax Technology Manager", "found", old)
	unread := addRole(t, e, acme, "Tax Data Manager", "new", old)
	fresh := addRole(t, e, acme, "Tax Systems Manager", "found", now.Add(-10*24*time.Hour))
	saved := addRole(t, e, acme, "Indirect Tax Manager", "found", old)
	e.S.SetSaved(saved, true)
	applied := addRole(t, e, acme, "Tax Automation Manager", "found", old)
	no := addRole(t, e, acme, "Tax Reporting Manager", "found", old)
	prepared := addRole(t, e, acme, "VAT Manager", "found", old)
	e.S.SaveDoc(prepared, "cv", TailoredCV{CVID: 1})
	later := addRole(t, e, acme, "GST Manager", "found", old)
	e.S.Now = func() time.Time { return old }
	e.MarkApplied(applied, "")
	e.NotInterested(no, "")
	e.S.SetLater(later, now.Add(48*time.Hour).Unix())
	e.S.Now = time.Now

	if n := e.clearUnacted(now); n != 0 {
		t.Fatalf("off by default, but %d set aside", n)
	}
	if err := e.SetSearchSet(SearchSet{ClearDays: 45}); err == nil {
		t.Error("only 30, 60 or 90 days")
	}
	if err := e.SetSearchSet(SearchSet{ClearDays: 60}); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int64]string{stale: "screened", unread: "screened", fresh: "", saved: "", applied: "", no: "no", prepared: "", later: ""} {
		r := role(t, e, id)
		if r.Closed != want {
			t.Errorf("%s: closed=%q want %q", r.Title, r.Closed, want)
		}
	}
	if r := role(t, e, stale); !strings.Contains(r.ClosedWhy, "60 days") {
		t.Errorf("reason: %q", r.ClosedWhy)
	}
	e.S.Reopen(stale)
	if n := e.clearUnacted(now); n != 0 {
		t.Errorf("a role brought back is acted on and stays; %d set aside", n)
	}
}

// Budget mode: off by default; on, a big batch waits for the night, and
// Run now or Cancel end the wait. A small batch is read at once.
func TestBudgetMode(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	noon := time.Date(2026, 11, 25, 12, 0, 0, 0, time.Local)
	e.Now = func() time.Time { return noon }
	towns := []string{"Toronto", "Mississauga", "Markham", "Vaughan", "Oakville", "Brampton", "Pickering", "Ajax", "Whitby", "Oshawa", "Burlington", "Milton", "Richmond Hill", "Etobicoke", "Scarborough"}
	for i, town := range towns {
		w.jobs = append(w.jobs, job(100+i, "Tax Technology Manager", town+", ON", goodAd))
	}
	if e.SearchSet().Budget {
		t.Fatal("budget mode must start off")
	}
	e.SetSearchSet(SearchSet{Budget: true})
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	b := e.Budget()
	if b.Waiting != len(towns) || b.RunAt != nextNight(noon).Unix() {
		t.Fatalf("a big batch should wait for the night: %+v", b)
	}
	if !e.budgetHolds(1) {
		t.Error("while a batch waits, reading waits")
	}
	// The night comes (or the computer wakes after it): the wait is over.
	e.Now = func() time.Time { return noon.Add(20 * time.Hour) }
	if e.budgetHolds(len(towns)) || e.Budget().RunAt != 0 {
		t.Error("the wait ends at its set time")
	}

	// Run now reads them at once.
	e.Now = func() time.Time { return noon }
	e.S.Set(budgetKey, BudgetHold{Since: noon.Unix(), RunAt: nextNight(noon).Unix()})
	if err := e.RunBudgetNow(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 300 && e.Busy("read"); i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if n := e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`); n != 0 || e.Budget().RunAt != 0 {
		t.Errorf("run now: %d still unread", n)
	}

	// Cancel sets the waiting ones aside, unread, and deletes nothing.
	for i, town := range towns {
		w.jobs = append(w.jobs, job(200+i, "Lead Tax Technology Manager", town+", ON", goodAd))
	}
	e.Search(ctx, "full")
	if e.Budget().Waiting == 0 {
		t.Fatal("a second big batch should wait too")
	}
	n, err := e.CancelBudget()
	if err != nil || n != len(towns) {
		t.Fatalf("cancel set aside %d: %v", n, err)
	}
	if e.Budget().RunAt != 0 || e.S.Count(`SELECT COUNT(*) FROM roles WHERE closed = 'screened' AND closed_why LIKE 'Not read%'`) != len(towns) {
		t.Error("cancelled postings are set aside with the reason")
	}

	// A small batch is read straight away.
	w.jobs = append(w.jobs, job(300, "Principal Tax Technology Manager", "Toronto, ON", goodAd))
	e.Search(ctx, "full")
	if e.Budget().RunAt != 0 || e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`) != 0 {
		t.Error("a small batch is read at once")
	}
}
