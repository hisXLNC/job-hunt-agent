package engine

import (
	"testing"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

func TestQuickFactsAreReadFromThePosting(t *testing.T) {
	for _, c := range []struct{ title, desc, want string }{
		{"Tax Manager", "Job type: Full-time, permanent.", "Full-time"},
		{"Tax Analyst (Part-Time)", "", "Part-time"},
		{"Program Manager", "This is a 12-month contract with possible extension.", "Contract, 12 mo"},
		{"Tax Intern", "Full-time for the summer", "Internship"},
		{"Director, Tax", "We build software.", ""},
	} {
		if got := JobType(c.title, c.desc); got != c.want {
			t.Errorf("JobType(%q, %q) = %q, want %q", c.title, c.desc, got, c.want)
		}
	}
	for pay, want := range map[string]int{"$142k–$165k": 165000, "$120,000 - $140,000 a year": 140000, "$38 an hour": 79040, "": 0, "Competitive": 0} {
		if got := PayPerYear(pay); got != want {
			t.Errorf("PayPerYear(%q) = %d, want %d", pay, got, want)
		}
	}
	if d, ok := Closes("Great team. Closing date: December 4, 2026. Apply now."); !ok || d.Format("2006-01-02") != "2026-12-04" {
		t.Errorf("Closes: %v %v", d, ok)
	}
	if _, ok := Closes("We close deals fast."); ok {
		t.Error("found a closing date where there is none")
	}
}

func TestHardLimitsSetPostingsAside(t *testing.T) {
	p := store.Profile{Titles: store.Titles{Level: []string{"Tax Manager"}}, PayFloor: 100000, PayStrict: true, MaxAgeDays: 7, NoTypes: []string{"contract"}}
	base := sources.Posting{Title: "Tax Manager", Company: "Acme", Pay: "$120,000 a year", PostedAt: time.Now().Add(-time.Hour)}
	if why, _ := screen(p, base, true); why != "" {
		t.Fatalf("a posting inside every limit was set aside: %s", why)
	}
	low, old, contract := base, base, base
	low.Pay = "$70,000–$85,000 a year"
	old.PostedAt = time.Now().Add(-9 * 24 * time.Hour)
	contract.Title = "Tax Manager (12 month contract)"
	for name, post := range map[string]sources.Posting{"pay": low, "age": old, "type": contract} {
		if why, _ := screen(p, post, true); why == "" {
			t.Errorf("the %s limit let a posting through", name)
		}
	}
	// With no stated pay, nothing is assumed.
	base.Pay = ""
	if why, _ := screen(p, base, true); why != "" {
		t.Errorf("a posting that names no pay was set aside: %s", why)
	}
}
