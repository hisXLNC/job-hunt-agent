package engine

import (
	"context"
	"testing"

	"jobhunt/internal/store"
)

func TestTitlesTheRulesMissGetASecondLook(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	p := e.S.Profile()
	p.Domain = nil
	e.S.SaveProfile(p)
	w.jobs = []map[string]any{
		job(1, "Taxation Technology Controller", "Toronto, ON", goodAd),
		job(2, "Warehouse Supervisor", "Toronto, ON", goodAd),
	}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Limit: 10, Closed: []string{"*"}, Unread: true})
	got := map[string]store.Role{}
	for _, r := range roles {
		full, _ := e.S.Role(r.ID)
		got[r.Title] = full
	}
	if r := got["Taxation Technology Controller"]; r.Closed != "" || r.Reading == nil {
		t.Errorf("the same work under another name should be brought back and read: closed=%q why=%q", r.Closed, r.ClosedWhy)
	}
	if r := got["Warehouse Supervisor"]; r.Closed != "screened" || r.ClosedWhy != titleAside || r.Description != "" {
		t.Errorf("another field stays set aside, without its text: closed=%q why=%q len=%d", r.Closed, r.ClosedWhy, len(r.Description))
	}
}
