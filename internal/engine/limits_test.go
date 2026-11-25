package engine

import (
	"testing"

	"jobhunt/internal/store"
)

func TestLimitsApplyToRolesAlreadyFound(t *testing.T) {
	e, _ := newEngine(t)
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "Acme", State: "following"})
	add := func(key, title string) int64 {
		id, err := e.S.AddRole(store.Role{CompanyID: c.ID, Key: key, Title: title, Description: goodAd, Applicants: -1})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	contract := add("a:1", "Tax Manager (12-month contract)")
	saved := add("a:2", "Tax Lead - Contract")
	e.S.SetSaved(saved, true)
	said := add("a:3", "Tax Analyst, fixed-term")
	e.S.CloseRole(said, "no", "Not this kind of contract")
	perm := add("a:4", "Tax Technology Manager")

	p := e.S.Profile()
	p.NoTypes = []string{"contract"}
	e.S.SaveProfile(p)
	aside, back, err := e.ApplyLimits()
	if err != nil || aside != 1 || back != 0 {
		t.Fatalf("aside %d back %d %v", aside, back, err)
	}
	if r, _ := e.S.Role(contract); r.Closed != "screened" || r.ClosedWhy != "A kind of job you ruled out (contract)" {
		t.Fatalf("contract = %q %q", r.Closed, r.ClosedWhy)
	}
	if r, _ := e.S.Role(saved); r.Closed != "" {
		t.Fatal("a role the person saved was set aside")
	}
	if r, _ := e.S.Role(perm); r.Closed != "" {
		t.Fatal("a permanent role was set aside")
	}

	// Turned off again: the contract comes back, the one said no to does not.
	p.NoTypes = nil
	e.S.SaveProfile(p)
	if _, back, _ := e.ApplyLimits(); back != 1 {
		t.Fatalf("back = %d", back)
	}
	if r, _ := e.S.Role(contract); r.Closed != "" {
		t.Fatal("the contract did not come back")
	}
	if r, _ := e.S.Role(said); r.Closed != "no" {
		t.Fatal("a role said no to was reopened")
	}
}

func TestLimitsSetAsideARolePreparedOnItsOwn(t *testing.T) {
	e, _ := newEngine(t)
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "Acme", State: "following"})
	id, _ := e.S.AddRole(store.Role{CompanyID: c.ID, Key: "a:1", Title: "Tax Manager - Contract", Description: goodAd, Applicants: -1})
	e.S.Advance(id, "ready")
	e.S.SaveDoc(id, "letter", LetterDoc{Text: "Dear Acme"})
	p := e.S.Profile()
	p.NoTypes = []string{"contract"}
	e.S.SaveProfile(p)
	if aside, _, _ := e.ApplyLimits(); aside != 1 {
		t.Fatalf("aside = %d", aside)
	}
	if ok, _ := e.S.Doc(id, "letter", &LetterDoc{}); !ok {
		t.Fatal("the letter was lost")
	}
}
