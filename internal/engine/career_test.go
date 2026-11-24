package engine

import (
	"context"
	"strings"
	"testing"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// Career path: Claude names the routes; the counts are Job Hunt's own, from
// postings it has seen, and steps marked done stay done across a new reading.
func TestCareerPathCountsItselfAndKeepsMarks(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	p := e.S.Profile()
	up := p.Titles.StepUp[0]

	// Not enough postings yet: no counts are shown.
	if err := e.readCareer(ctx); err != nil {
		t.Fatal(err)
	}
	pg := e.Career()
	if !pg.Has || len(pg.Routes) != 3 || pg.Routes[0].Title != up || !pg.Routes[0].Recommended {
		t.Fatalf("reading: %+v", pg.Routes)
	}
	if pg.Routes[0].Enough || pg.Routes[0].Searching != true {
		t.Fatalf("with nothing seen the counts must wait, and the person's own step-up title is searched: %+v", pg.Routes[0])
	}

	// Six postings for the step up, four asking for a team.
	for i, text := range []string{"Lead a team of 8.", "Direct reports: 5.", "Own the budget.", "People leader.", "Team of 12.", "Run the tax engine."} {
		if _, err := e.AddRole("Employer "+string(rune('A'+i)), up, "Toronto, ON", "", text, "manual"); err != nil {
			t.Fatal(err)
		}
	}
	e.AddRole("Other", "Payroll Clerk", "Toronto, ON", "", "team of 3", "manual")
	pg = e.Career()
	r := pg.Routes[0]
	if r.Seen != 6 || !r.Enough {
		t.Fatalf("seen = %d", r.Seen)
	}
	var lead CareerGapView
	for _, g := range r.Gaps {
		if g.ID == "lead-team" {
			lead = g
		}
	}
	if lead.Asked != 4 {
		t.Fatalf("leading a team asked for in %d of 6, want 4", lead.Asked)
	}

	if err := e.MarkCareerGap("lead-team", true); err != nil {
		t.Fatal(err)
	}
	if err := e.MarkCareerGap("made-up", true); err == nil {
		t.Fatal("a step that is not on the plan cannot be marked")
	}
	if err := e.readCareer(ctx); err != nil {
		t.Fatal(err)
	}
	for _, g := range e.Career().Routes[0].Gaps {
		if g.ID == "lead-team" && !g.Done {
			t.Fatal("a step marked done must stay done after the plan is read again")
		}
	}

	// Searching a route's titles adds them to the person's titles once.
	side := e.Career().Routes[1]
	added, err := e.SearchCareerTitles(1, "")
	if err != nil || len(added) == 0 {
		t.Fatalf("added %v, %v", added, err)
	}
	again, _ := e.SearchCareerTitles(1, "")
	if len(again) != 0 {
		t.Fatalf("added twice: %v", again)
	}
	if !e.Career().Routes[1].Searching {
		t.Fatalf("route %q should now be searched", side.Title)
	}
	if _, err := e.SearchCareerTitles(-1, "Chief Everything Officer"); err == nil {
		t.Fatal("only titles from the reading can be added")
	}
}

func TestCareerAnswerIsKeptInBounds(t *testing.T) {
	p := store.Profile{Avoid: []string{"Sales"}}
	p.Titles.Level = []string{"Tax Manager"}
	in := brain.Career{
		Routes: []brain.CareerRoute{
			{Title: "Sales Director", Band: "step_up"},
			{Title: "  Head of   Tax ", Band: "boss", Fit: 140, Recommended: true, Titles: []string{"head of tax", "Tax Sales Lead", "VP Tax"},
				Gaps: []brain.CareerGap{{ID: "Team!", Gap: "Leading people", Words: []string{"Team Of", "x"}}, {ID: "team", Gap: "Something else"}}},
			{Title: "Tax Product Owner", Band: "sideways", Recommended: true},
			{Title: "A", Band: "level"}, {Title: "B", Band: "level"},
		},
		Try: []brain.CareerTitle{{Title: "Tax Manager"}, {Title: "Tax Lead", Band: "?"}, {Title: "tax lead"}},
	}
	out := tidyCareer(in, p)
	if len(out.Routes) != 3 || out.Routes[0].Title != "Head of Tax" {
		t.Fatalf("routes: %+v", out.Routes)
	}
	r := out.Routes[0]
	if r.Band != "sideways" || r.Fit != 100 || strings.Join(r.Titles, "|") != "Head of Tax|VP Tax" {
		t.Fatalf("route kept out of bounds: %+v", r)
	}
	if r.Gaps[0].ID != "team" || r.Gaps[1].ID == "team" || strings.Join(r.Gaps[0].Words, "|") != "team of" {
		t.Fatalf("gaps: %+v", r.Gaps)
	}
	if out.Routes[1].Recommended {
		t.Fatal("only one route is recommended")
	}
	if len(out.Try) != 1 || out.Try[0].Title != "Tax Lead" || out.Try[0].Band != "sideways" {
		t.Fatalf("try: %+v", out.Try)
	}
}

func TestSameTitle(t *testing.T) {
	for _, c := range []struct {
		posting, want string
		ok            bool
	}{
		{"Senior Manager, Tax Technology", "Tax Technology Manager", true},
		{"Head of Tax Technology (Remote)", "Head of Tax Technology", true},
		{"Tax Analyst", "Tax Technology Manager", false},
		{"Finance Systems Product Managers", "Finance Systems Product Manager", true},
		{"Tax Transformation Director", "Tax Transformation Director (consulting)", true},
	} {
		if got := sameTitle(c.posting, titleWords(c.want)); got != c.ok {
			t.Errorf("%q as %q: %v", c.posting, c.want, got)
		}
	}
}
