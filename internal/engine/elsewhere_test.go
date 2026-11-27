package engine

import (
	"testing"

	"jobhunt/internal/store"
)

// A role a search for Toronto brought back from another city is set aside;
// one in a town Job Hunt doesn't know, or remote, is kept.
func TestSearchedRoleElsewhere(t *testing.T) {
	p := store.Profile{City: "Toronto, ON", Country: "Canada"}
	for loc, want := range map[string]bool{
		"Ottawa, Ontario, Canada":         true,
		"St. Catharines, Ontario, Canada": true,
		"Montreal, QC":                    true,
		"London, Ontario, Canada":         true,
		"Toronto, Ontario, Canada":        false,
		"Mississauga, ON":                 false,
		"Bolton, Ontario, Canada":         false,
		"Ontario, Canada":                 false,
		"Remote - Ottawa":                 false,
		"Toronto or Ottawa, ON":           false,
	} {
		if got := !placeOK(p, loc, "") && otherMarket(p, loc, ""); got != want {
			t.Errorf("%s: set aside %v, want %v", loc, got, want)
		}
	}
	if otherMarket(p, "Ottawa, ON", "remote") {
		t.Error("a remote role was set aside for where its employer is")
	}
}

// Roles already found in another city are set aside once; touched ones stay.
func TestAsideElsewhere(t *testing.T) {
	e, _ := newEngine(t)
	co := setUp(t, e)
	p := e.S.Profile()
	p.City, p.Country = "Toronto, ON", "Canada"
	e.S.SaveProfile(p)
	far, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "o:1", Source: "linkedin", Title: "Analyst", Location: "Ottawa, Ontario, Canada", Applicants: -1, Stage: "found"})
	mine, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "o:2", Source: "manual", Title: "Analyst", Location: "Ottawa, Ontario, Canada", Applicants: -1, Stage: "found"})
	home, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "o:3", Source: "linkedin", Title: "Analyst", Location: "Toronto, ON", Applicants: -1, Stage: "found"})
	e.asideElsewhere()
	for id, want := range map[int64]string{far: "screened", mine: "", home: ""} {
		if r, _ := e.S.Role(id); r.Closed != want {
			t.Errorf("%s: closed %q, want %q", r.Location+" "+r.Source, r.Closed, want)
		}
	}
}
