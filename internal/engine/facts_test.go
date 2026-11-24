package engine

import "testing"

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
