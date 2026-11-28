package store

import "testing"

// "BMO" and "Bank of Montreal" are one employer: new postings land on one,
// and the two saved before are put together with all their roles.
func TestSameEmployerUnderTwoNames(t *testing.T) {
	for in, want := range map[string]string{"Bank of Montreal": "bmo", "BMO Financial Group": "bmo", "BMO": "bmo",
		"Royal Bank of Canada": "rbc", "TD Bank Group": "td", "The Toronto-Dominion Bank": "td", "Scotiabank": "scotiabank",
		"Canadian Imperial Bank of Commerce": "cibc", "National Bank of Canada": "national bank", "Thomson Reuters Canada Ltd.": "thomson reuters"} {
		if got := NormName(in); got != want {
			t.Errorf("NormName(%q) = %q, want %q", in, got, want)
		}
	}
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	// As earlier versions saved them.
	add := func(name, norm, state string) int64 {
		res, err := s.db.Exec(`INSERT INTO companies(name, norm, state, source, plan, created_at) VALUES(?,?,?,?,'{}',0)`, name, norm, state, "search")
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	bmo, bank, other := add("BMO", "bmo", "suggested"), add("Bank of Montreal", "bank of montreal", "following"), add("Dentalcorp", "dentalcorp", "suggested")
	role := func(c int64, key string) {
		if _, err := s.db.Exec(`INSERT INTO roles(company_id, key, title, url, first_seen_at, last_seen_at, stage_at) VALUES(?,?,?,?,0,0,0)`, c, key, "Digital Product Manager", "https://x/"+key); err != nil {
			t.Fatal(err)
		}
	}
	role(bmo, "a")
	role(bank, "b")
	role(bank, "c")
	role(other, "d")
	if n := s.MergeSameEmployers(); n != 1 {
		t.Fatalf("merged %d", n)
	}
	c, err := s.CompanyByName("BMO Financial Group")
	if err != nil || c.ID != bank || c.Name != "Bank of Montreal" || c.State != "following" {
		t.Fatalf("kept %+v, %v", c, err)
	}
	if n := s.Count(`SELECT COUNT(*) FROM roles WHERE company_id = ?`, bank); n != 3 {
		t.Errorf("roles moved: %d of 3", n)
	}
	if _, err := s.Company(bmo); err == nil {
		t.Error("the other one is still there")
	}
	if got, isNew, _ := s.UpsertCompany(Company{Name: "BMO"}); isNew || got.ID != bank {
		t.Errorf("a new posting from BMO went to %+v", got)
	}
	if s.MergeSameEmployers() != 0 {
		t.Error("merged again")
	}
}
