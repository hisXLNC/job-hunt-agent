package engine

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// Employers are looked for again each week, after the person changes what
// they look for, and after a full search that found little; never more than
// the reasons call for.
func TestEmployersFoundByThemselves(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	now := time.Now()
	e.Now = func() time.Time { return now }
	if why := e.seedWhy(now); why != "" {
		t.Fatalf("the first look only records where things stand, got %q", why)
	}
	if why := e.seedWhy(now.Add(2 * time.Hour)); why != "" {
		t.Errorf("nothing changed, got %q", why)
	}
	if why := e.seedWhy(now.Add(8 * 24 * time.Hour)); why != "the weekly look" {
		t.Errorf("a week on: %q", why)
	}
	p := e.S.Profile()
	p.Titles.Level = append(p.Titles.Level, "Indirect Tax Lead")
	e.S.SaveProfile(p)
	if why := e.seedWhy(now.Add(30 * time.Minute)); why != "" {
		t.Errorf("a change straight after a look waits an hour, got %q", why)
	}
	if why := e.seedWhy(now.Add(2 * time.Hour)); why != "you changed what you look for" {
		t.Errorf("after a change: %q", why)
	}
	e.seeded()
	e.noteThin(RunStats{Kind: "full", New: 1})
	if why := e.seedWhy(now.Add(time.Hour)); why != "" {
		t.Errorf("a thin search straight after a look waits, got %q", why)
	}
	e.Now = func() time.Time { return now.Add(3 * 24 * time.Hour) }
	e.noteThin(RunStats{Kind: "full", New: 1})
	if why := e.seedWhy(now.Add(3 * 24 * time.Hour)); why != "the last search found little" {
		t.Errorf("after a thin search: %q", why)
	}
	e.seeded()
	e.noteThin(RunStats{Kind: "full", New: 9, Kept: 2})
	if why := e.seedWhy(now.Add(3*24*time.Hour + time.Minute)); why != "" {
		t.Errorf("a search that found plenty is no reason, got %q", why)
	}

	// An employer the person muted is never brought back by a suggestion.
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "Harbour Bank", State: "following"})
	e.MuteEmployer(c.ID)
	if got, _, _ := e.S.UpsertCompany(store.Company{Name: "Harbour Bank", State: "following", Source: "proposed"}); got.State != "muted" {
		t.Errorf("muted employer came back as %q", got.State)
	}
}

// A board that fails twice in a row, on two days, is no longer read; the
// employer stays, and the activity log says so. Slow answers and a computer
// with no connection count for nothing.
func TestDeadBoardsDropped(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	gone, _, _ := e.S.UpsertCompany(store.Company{Name: "Gone Ledger", State: "following"})
	gone.BoardKind, gone.BoardToken = "greenhouse", "goneledger"
	e.S.SaveCompany(gone)
	ctx := context.Background()
	day := time.Now()
	e.Now = func() time.Time { return day }

	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	if c, _ := e.S.Company(gone.ID); c.BoardKind == "" {
		t.Fatal("two failures on one day are one strike")
	}
	day = day.Add(25 * time.Hour)
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	c, _ := e.S.Company(gone.ID)
	if c.BoardKind != "" || c.State != "following" {
		t.Fatalf("board should be dropped and the employer kept: kind=%q state=%q", c.BoardKind, c.State)
	}
	acts, _ := e.S.ActivityList(store.ActivityFilter{CompanyID: gone.ID, Limit: 10})
	said := false
	for _, a := range acts {
		said = said || strings.Contains(a.Text, "Stopped reading Gone Ledger's job board")
	}
	if !said {
		t.Error("the activity log should say the board is no longer read")
	}
	acme, _ := e.S.CompanyByName("Acme Corp")
	if acme.BoardKind == "" {
		t.Error("a board that answers is kept")
	}

	// Slow or offline: no strike. Nothing answered at all: no strike either.
	other, _, _ := e.S.UpsertCompany(store.Company{Name: "Slow Ledger", State: "following"})
	other.BoardKind, other.BoardToken = "greenhouse", "slow"
	e.S.SaveCompany(other)
	for i := 0; i < 3; i++ {
		day = day.Add(25 * time.Hour)
		e.boardStrikes(map[int64]error{other.ID: context.DeadlineExceeded}, []int64{acme.ID})
		e.boardStrikes(map[int64]error{other.ID: &sources.HTTPError{Status: 404}}, nil)
	}
	if c, _ := e.S.Company(other.ID); c.BoardKind == "" {
		t.Error("a slow board, or a computer with no connection, must not lose a board")
	}
	if !boardDead(&sources.HTTPError{Status: 410}) || boardDead(&sources.HTTPError{Status: 503}) || boardDead(errors.New("x")) {
		t.Error("only a board that is gone counts")
	}
}
