package engine

import (
	"testing"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// Pay lines as postings write them, and money that isn't pay.
func TestPayFromTextPhrasings(t *testing.T) {
	for in, want := range map[string]string{
		"Base pay range\n$90,000.00/yr - $110,000.00/yr": "$90,000.00/yr - $110,000.00/yr",
		"$90K - $110K":                     "$90K - $110K",
		"Hiring range: $85,000 – $100,000": "$85,000 – $100,000",
		"In compliance with pay transparency, the range for this role in Ontario is $95,000 to $115,000.": "$95,000 to $115,000",
		"This role pays $100,000-$120,000.":                    "$100,000-$120,000",
		"Target pay range: 110 000 $ – 130 000 $ par année":    "110 000 $ – 130 000 $",
		"Salary Range: $102,600.00 - $153,900.00":              "$102,600.00 - $153,900.00",
		"We serve 25,000 to 50,000 users across a wide range.": "",
		"Approve loans of $25,000 - $250,000":                  "",
		"We raised $30,000,000 - $40,000,000 last year":        "",
	} {
		if got := PayFromText("About the job. " + in + " Benefits and more."); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

// A pay read as only the bottom of its range is completed; the pay Claude
// found fills an empty one, and a figure that isn't pay is left out.
func TestPayCompletedAndFromReading(t *testing.T) {
	e, _ := newEngine(t)
	co := setUp(t, e)
	cut, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "p:1", Title: "Analyst", Pay: "$90,000.00/yr", Applicants: -1,
		Description: "Base pay range\n$90,000.00/yr - $110,000.00/yr\nMore about the job."})
	kept, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "p:2", Title: "Analyst", Pay: "$95,000", Applicants: -1,
		Description: "Salary range: $70,000 - $80,000. Other words."})
	e.fillPay()
	if r, _ := e.S.Role(cut); r.Pay != "$90,000.00/yr - $110,000.00/yr" {
		t.Errorf("cut range: %q", r.Pay)
	}
	if r, _ := e.S.Role(kept); r.Pay != "$95,000" {
		t.Errorf("a pay of its own was changed: %q", r.Pay)
	}

	none, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "p:3", Title: "Analyst", Applicants: -1, Description: "No figures here."})
	r, _ := e.S.Role(none)
	e.payFromReading(r, brain.Reading{Pay: "$5 million in revenue"})
	if r, _ := e.S.Role(none); r.Pay != "" {
		t.Errorf("not pay kept: %q", r.Pay)
	}
	e.payFromReading(r, brain.Reading{Pay: "$85,000 - $105,000 a year"})
	if r, _ := e.S.Role(none); r.Pay != "$85,000 - $105,000 a year" {
		t.Errorf("reading's pay: %q", r.Pay)
	}
}
