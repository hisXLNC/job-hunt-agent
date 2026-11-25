package engine

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

func TestScoreAgain(t *testing.T) {
	e, _ := newEngine(t)
	acme := setUp(t, e)
	ctx := context.Background()
	muted, _, _ := e.S.UpsertCompany(store.Company{Name: "Muted Ltd", State: "muted"})
	add := func(co int64, key, title, loc, why string) int64 {
		id, err := e.S.AddRole(store.Role{CompanyID: co, Key: key, Source: "greenhouse", Title: title, Location: loc, Description: goodAd, Closed: "screened", ClosedWhy: why, Applicants: -1})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	hamilton := add(acme.ID, "a:1", "Tax Technology Manager", "Hamilton, ON", "Based somewhere else")
	still := add(acme.ID, "a:2", "Tax Technology Manager", "Berlin, Germany", "Based somewhere else")
	clerk := add(acme.ID, "a:3", "Warehouse Supervisor", "Toronto, ON", "Title isn't in your field")
	mute := add(muted.ID, "m:1", "Tax Technology Manager", "Hamilton, ON", "Based somewhere else")
	no, _ := e.S.AddRole(store.Role{CompanyID: acme.ID, Key: "a:4", Source: "greenhouse", Title: "Tax Technology Manager", Location: "Hamilton, ON", Description: goodAd, Closed: "no", ClosedWhy: "Not for me", Applicants: -1})
	byClaude := add(acme.ID, "a:5", "Tax Technology Lead", "Toronto, ON", "Fit too low (40)")
	e.S.SetReading(byClaude, 40, "", brain.Reading{Fit: 40})

	// Before anything changes, nothing passes the rules.
	est, err := e.RescoreEstimate()
	if err != nil {
		t.Fatal(err)
	}
	if est.ByRules != 3 || est.Pass != 0 || est.ByClaude != 1 || est.Requests != 0 || est.RequestsAll != 1 {
		t.Fatalf("before: %+v", est)
	}

	// Hamilton becomes a place the person counts: one role now passes.
	p := e.S.Profile()
	p.Places = []string{"Hamilton"}
	e.S.SaveProfile(p)
	if est, _ = e.RescoreEstimate(); est.Pass != 1 || est.Requests != 1 || est.RequestsAll != 2 || est.Fetch != 0 {
		t.Fatalf("after adding Hamilton: %+v", est)
	}
	back, err := e.ScoreAgain(ctx, false)
	if err != nil || back != 1 {
		t.Fatalf("score again: %d, %v", back, err)
	}
	r, _ := e.S.Role(hamilton)
	if r.Closed != "" || r.Stage != "found" || r.Fit < 0 {
		t.Fatalf("the Hamilton role: closed=%q stage=%q fit=%d", r.Closed, r.Stage, r.Fit)
	}
	// Nothing is written for it by itself: a bulk re-check is no search.
	if docs, _ := e.S.Docs(hamilton); len(docs) != 0 {
		t.Errorf("documents were written for a role scored again: %d", len(docs))
	}
	for id, want := range map[int64]string{still: "screened", clerk: "screened", mute: "screened", no: "no", byClaude: "screened"} {
		if r, _ := e.S.Role(id); r.Closed != want {
			t.Errorf("role %d (%s): closed %q, want %q", id, r.Title, r.Closed, want)
		}
	}

	// All: the role Claude set aside is read again too, and comes back.
	if back, err := e.ScoreAgain(ctx, true); err != nil || back != 1 {
		t.Fatalf("score all again: %d, %v", back, err)
	}
	if r, _ := e.S.Role(byClaude); r.Closed != "" {
		t.Errorf("the role Claude set aside: closed %q", r.Closed)
	}
	for id, want := range map[int64]string{mute: "screened", no: "no"} {
		if r, _ := e.S.Role(id); r.Closed != want {
			t.Errorf("role %d after all: closed %q, want %q", id, r.Closed, want)
		}
	}
	// A role the person said no to never comes back this way.
	if ok, _ := e.S.Unscreen(no); ok {
		t.Fatal("Unscreen brought back a role said no to")
	}
}

// Search now, ignoring the schedule: a week back, and the set-aside roles
// are checked again afterwards.
func TestForceSearch(t *testing.T) {
	e, _ := newEngine(t)
	acme := setUp(t, e)
	ctx := context.Background()
	var mu sync.Mutex
	var within []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "seeMoreJobPostings") {
			mu.Lock()
			within = append(within, r.URL.Query().Get("f_TPR"))
			mu.Unlock()
		}
	}))
	t.Cleanup(srv.Close)
	e.Src.Base["linkedin"] = srv.URL
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	id, _ := e.S.AddRole(store.Role{CompanyID: acme.ID, Key: "a:9", Source: "greenhouse", Title: "Tax Technology Manager", Location: "Guelph, ON", Description: goodAd, Closed: "screened", ClosedWhy: "Based somewhere else", Applicants: -1})
	p := e.S.Profile()
	p.Places = []string{"Guelph"}
	e.S.SaveProfile(p)

	mu.Lock()
	within = nil
	mu.Unlock()
	if err := e.Search(ctx, "force"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	if len(within) == 0 {
		t.Fatal("LinkedIn was not asked")
	}
	for _, w := range within {
		if w != "r604800" {
			t.Errorf("a forced search looked back %q, not a week", w)
		}
	}
	mu.Unlock()
	if r, _ := e.S.Role(id); r.Closed != "" {
		t.Errorf("the set-aside role that now passes: closed %q (%s)", r.Closed, r.ClosedWhy)
	}
	if runs, _ := e.S.Runs("search:full", 1); len(runs) == 0 {
		t.Error("a forced search is not kept as a full search")
	}
}
