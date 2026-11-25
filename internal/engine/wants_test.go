package engine

import (
	"context"
	"testing"

	"jobhunt/internal/store"
)

// What the person wants is weighed when a role is read: a deal-breaker sets
// the role aside with the reason, and each role is tagged on or off the
// career path they want, in lists too.
func TestWhatYouWantInScoring(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	p := e.S.Profile()
	p.DealBreakers, p.CareerPath = []string{"night shift"}, "Tax technology leadership"
	e.S.SaveProfile(p)
	w.jobs = []map[string]any{
		job(1, "Tax Technology Manager", "Toronto, ON", goodAd),
		job(2, "Senior Tax Technology Manager", "Toronto, ON", goodAd+"<p>This role works the night shift twice a month.</p>"),
	}
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	all, _, _ := e.S.Roles(store.RoleFilter{Closed: []string{"*"}, Unread: true, Limit: 50})
	by := map[string]store.Role{}
	for _, r := range all {
		by[r.Title] = r
	}
	if r := by["Tax Technology Manager"]; r.Closed != "" || r.Path != "on" {
		t.Errorf("the wanted role: closed=%q path=%q", r.Closed, r.Path)
	}
	if r := by["Senior Tax Technology Manager"]; r.Closed != "screened" || r.ClosedWhy != "Deal-breaker: night shift" {
		t.Errorf("the role with a deal-breaker: closed=%q why=%q", r.Closed, r.ClosedWhy)
	}
	// The tag is on the role itself as well as in lists.
	if r, _ := e.S.Role(by["Tax Technology Manager"].ID); r.Path != "on" {
		t.Errorf("one role: path %q", r.Path)
	}
}
