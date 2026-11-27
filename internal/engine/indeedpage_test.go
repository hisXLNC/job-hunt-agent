package engine

import (
	"context"
	"testing"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// The side panel asks which Indeed jobs Job Hunt wants, then hands them over;
// a job whose link leads off Indeed is dropped, and one seen before isn't
// wanted again.
func TestIndeedPage(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	title := e.S.Profile().Titles.All()[0].Title
	jobs := []PageJob{
		{JobID: "a1b2c3d4e5f60718", Title: title, Company: "Acme Corp", Location: "Toronto, ON", Pay: "$110,000–$130,000 a year", URL: "https://ca.indeed.com/viewjob?jk=a1b2c3d4e5f60718"},
		{JobID: "0f1e2d3c4b5a6978", Title: title, Company: "Beta Inc", Location: "Ottawa, ON", URL: "https://ca.indeed.com/viewjob?jk=0f1e2d3c4b5a6978"},
		{JobID: "nope", Title: title, Company: "Gamma", Location: "Toronto, ON", URL: "https://example.com/job"},
	}
	want := e.IndeedPageWants(jobs)
	if len(want) != 1 || want[0] != "a1b2c3d4e5f60718" {
		t.Fatalf("wanted %v", want)
	}
	seen, added := e.TakeIndeedPage(jobs)
	if seen != 2 || added != 2 {
		t.Errorf("seen %d added %d", seen, added)
	}
	id, _, ok := e.S.SeenRole("alert:indeed:a1b2c3d4e5f60718")
	if !ok {
		t.Fatal("not kept")
	}
	if r, _ := e.S.Role(id); r.Pay != "$110,000–$130,000 a year" || r.URL != "https://ca.indeed.com/viewjob?jk=a1b2c3d4e5f60718" || r.Source != "indeed" {
		t.Errorf("role: %+v", r)
	}
	if w := e.IndeedPageWants(jobs); len(w) != 0 {
		t.Errorf("wanted again: %v", w)
	}
}

// What the text reading missed is asked of Claude, with only the lines that
// could hold pay; a posting with none of those isn't asked about.
func TestPayWithClaude(t *testing.T) {
	e, _ := newEngine(t)
	co := setUp(t, e)
	named, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "pc:1", Title: "Analyst", Applicants: -1, Stage: "found",
		Description: "About us.\nThe budgeted range is $90,000 to $105,000\nMore words about the job."})
	none, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "pc:2", Title: "Analyst", Applicants: -1, Stage: "found",
		Description: "About us.\nNo figures here at all.\nMore words."})
	if brain.PayLines("About us.\nNo figures here at all.") != "" {
		t.Error("lines with no pay were picked")
	}
	if err := e.payWithClaude(context.Background()); err != nil {
		t.Fatal(err)
	}
	if r, _ := e.S.Role(named); r.Pay != "$90,000 to $105,000" && r.Pay == "" {
		t.Errorf("named: %q", r.Pay)
	}
	if r, _ := e.S.Role(none); r.Pay != "" {
		t.Errorf("none: %q", r.Pay)
	}
}
