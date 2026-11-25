package brain

import (
	"context"
	"strings"
	"testing"

	"jobhunt/internal/store"
)

func TestWhatTheyWantIsToldOnlyWhenSaid(t *testing.T) {
	p := Person{Profile: store.Profile{Name: "Sam"}}
	if b := p.Block(); strings.Contains(b, "What they want") {
		t.Fatalf("nothing was said, but the block has it:\n%s", b)
	}
	if wantsFor(p) != "" {
		t.Fatal("the rule is added for a person who said nothing")
	}
	p.Profile.Seniority, p.Profile.Terms = "manager", "permanent"
	p.Profile.Industries, p.Profile.NoIndustries = []string{"Banking"}, []string{"Gambling"}
	p.Profile.DealBreakers, p.Profile.CareerPath = []string{"on-call rota"}, "Head of Tax Technology"
	b := p.Block()
	for _, want := range []string{"Level they want: manager of a team", "permanent only", "Industries they want (weigh a role in one up): Banking",
		"Industries they do not want (skip a role in one): Gambling", "Deal-breakers (skip a role that clearly has one): on-call rota", "The career path they want: Head of Tax Technology"} {
		if !strings.Contains(b, want) {
			t.Errorf("the block lacks %q:\n%s", want, b)
		}
	}
	if !strings.Contains(wantsFor(p), "Deal-breaker") {
		t.Error("the rule on how it weighs is missing")
	}
}

func TestReadingWeighsWhatTheyWant(t *testing.T) {
	b := &Brain{LLM: StandIn()}
	cvs := []store.CV{{ID: 1, Name: "Main", Text: "Tax technology manager\n- Led the implementation of Vertex on SAP"}}
	post := Posting{Company: "Acme", Title: "Tax Technology Manager", Description: "Lead the Vertex implementation on SAP. You join the on-call rota every other week."}
	ctx := context.Background()

	r, err := b.ReadRole(ctx, Person{CVs: cvs}, post)
	if err != nil {
		t.Fatal(err)
	}
	if r.Path != "unknown" || strings.HasPrefix(r.SkipWhy, "Deal-breaker") {
		t.Fatalf("with nothing wanted: %+v", r)
	}
	p := Person{CVs: cvs, Profile: store.Profile{DealBreakers: []string{"on-call rota"}, CareerPath: "Tax technology leadership"}}
	if r, err = b.ReadRole(ctx, p, post); err != nil {
		t.Fatal(err)
	}
	if r.Verdict != "skip" || r.SkipWhy != "Deal-breaker: on-call rota" || r.Path != "on" {
		t.Fatalf("with a deal-breaker and a path: %+v", r)
	}
	p.Profile.DealBreakers, p.Profile.CareerPath = nil, "Data engineering"
	if r, _ = b.ReadRole(ctx, p, post); r.Path != "off" || r.Verdict == "skip" {
		t.Fatalf("off the path: %+v", r)
	}
}
