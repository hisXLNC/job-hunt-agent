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

func TestPayFromText(t *testing.T) {
	for desc, want := range map[string]string{
		"About the role.\nSalary range: $85,000 - $105,000 per year, plus benefits.":    "$85,000 - $105,000 per year",
		"The base pay for this position is CAD 92,000 to 118,000 annually.":             "CAD 92,000 to 118,000 annually",
		"Pay rate: $42.50/hour. 40 hours a week.":                                       "$42.50/hour",
		"Compensation: £45k–£55k depending on experience":                               "£45k–£55k",
		"We offer a salary of 90,000 to 110,000 CAD per year.":                          "90,000 to 110,000 CAD per year",
		"We raised $40,000,000 in funding and serve 5,000 customers.":                   "",
		"You will manage a budget of $250,000 a year and a team of 6.":                  "",
		"A $5,000 signing bonus is paid after 90 days. Join 2,000 to 3,000 colleagues.": "",
		"Founded in 1998 - 2001 was a big year. Call 416 555 0100.":                     "",
		"No pay is named here at all.":                                                  "",
		"Hourly rate between $38 and $46 per hour based on experience.":                 "$38 and $46 per hour",
	} {
		if got := PayFromText(desc); got != want {
			t.Errorf("PayFromText(%q) = %q, want %q", desc, got, want)
		}
	}
}

func TestTheFitBarsFollowThePersonsChoice(t *testing.T) {
	var p store.Profile
	if p.Keep() != 55 || p.PrepareAt() != 70 {
		t.Fatalf("defaults %d %d", p.Keep(), p.PrepareAt())
	}
	keep, prep := 75, 60
	p.KeepFit, p.PrepareFit = &keep, &prep
	if p.Keep() != 75 || p.PrepareAt() != 75 {
		t.Fatalf("preparing below the keeping bar: %d %d", p.Keep(), p.PrepareAt())
	}
}
