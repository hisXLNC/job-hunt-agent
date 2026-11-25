package engine

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// applyTo records a role read with a CV and a fit, applied to some days ago,
// and how it ended.
func applyTo(t *testing.T, e *Engine, key, title, pay string, cvID int64, fit int, daysAgo int, stage, closed string) int64 {
	t.Helper()
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "Employer " + key, State: "suggested"})
	clock := e.S.Now
	e.S.Now = func() time.Time { return time.Now().AddDate(0, 0, -daysAgo) }
	defer func() { e.S.Now = clock }()
	id, err := e.S.AddRole(store.Role{CompanyID: c.ID, Key: key, Source: "linkedin", Title: title, Pay: pay, Applicants: -1})
	if err != nil {
		t.Fatal(err)
	}
	e.S.SetReading(id, fit, "level", map[string]any{"fit": fit, "cv_id": cvID})
	if err := e.S.SetStage(id, stage); err != nil {
		t.Fatal(err)
	}
	if closed != "" {
		e.S.CloseRole(id, closed, "They said no")
	}
	return id
}

func TestInsightsCountResultsByCVFitKindAndPay(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	cvs, _ := e.S.CVs()
	main := cvs[0]
	other, err := e.S.AddCV(store.CV{Name: "Systems CV", Text: "x"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	level := e.S.Profile().Titles.Level[0]
	applyTo(t, e, "a", level, "$120,000 a year", main.ID, 88, 3, "interview", "")
	applyTo(t, e, "b", level, "$95,000", main.ID, 74, 5, "reply", "")
	applyTo(t, e, "c", "Payroll Clerk", "", other, 50, 6, "applied", "rejected")
	applyTo(t, e, "d", "Payroll Clerk", "$40/hour", other, 52, 8, "applied", "rejected")
	applyTo(t, e, "e", level, "", other, 60, 60, "applied", "rejected") // outside 30 days

	pg := e.Insights(30)
	if pg.Days != 30 || len(pg.Funnel) != 6 {
		t.Fatalf("period: %+v", pg.Funnel)
	}
	find := func(rs []Rate, label string) Rate {
		for _, r := range rs {
			if r.Label == label {
				return r
			}
		}
		t.Fatalf("no row %q in %+v", label, rs)
		return Rate{}
	}
	if r := find(pg.ByCV, main.Name); r.Applied != 2 || r.Heard != 2 || r.Talks != 1 {
		t.Fatalf("by CV: %+v", r)
	}
	if r := find(pg.ByCV, "Systems CV"); r.Applied != 2 || r.Heard != 0 {
		t.Fatalf("other CV: %+v", r)
	}
	if pg.ByFit[0].Label != "85 and up" || find(pg.ByFit, "Under 55").Applied != 2 {
		t.Fatalf("by fit: %+v", pg.ByFit)
	}
	if find(pg.ByKind, level).Applied != 2 || find(pg.ByKind, "Other titles").Applied != 2 {
		t.Fatalf("by kind: %+v", pg.ByKind)
	}
	if find(pg.ByPay, "100k to 130k").Applied != 1 || find(pg.ByPay, "No pay given").Applied != 1 || find(pg.ByPay, "80k to 100k").Applied != 2 {
		t.Fatalf("by pay: %+v", pg.ByPay)
	}
	if pg.Rejects.Total != 2 || pg.Rejects.BeforeReply != 2 {
		t.Fatalf("no's: %+v", pg.Rejects)
	}
	// The 90-day view takes in the older one.
	if r := e.Insights(90); r.Rejects.Total != 3 || r.Funnel[2].N != 5 {
		t.Fatalf("90 days: %+v %+v", r.Rejects, r.Funnel[2])
	}
	// The 7-day view puts the older ones in the period before.
	if r := e.Insights(7); r.Funnel[2].N != 3 || r.Funnel[2].Before != 1 {
		t.Fatalf("7 days: %+v", r.Funnel[2])
	}
	if insightDays(12) != 30 {
		t.Fatal("unknown period")
	}
}

func TestInsightsOverlapBetweenSources(t *testing.T) {
	e, _ := newEngine(t)
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "Acme", State: "following"})
	a, _ := e.S.AddRole(store.Role{CompanyID: c.ID, Key: "li:1", Source: "linkedin", Title: "Analyst", Applicants: -1})
	e.S.AddRole(store.Role{CompanyID: c.ID, Key: "li:2", Source: "linkedin", Title: "Manager", Applicants: -1})
	e.S.AddRole(store.Role{CompanyID: c.ID, Key: "gh:3", Source: "greenhouse", Title: "Lead", Applicants: -1})
	e.S.SeenThrough(a, "greenhouse")
	e.S.SeenThrough(a, "greenhouse") // once is enough
	pg := e.Insights(30)
	if pg.Both != 1 {
		t.Fatalf("both: %d", pg.Both)
	}
	got := map[string]OverlapRow{}
	for _, o := range pg.Overlap {
		got[o.Label] = o
	}
	if li := got["LinkedIn"]; li.Seen != 2 || li.Only != 1 || li.Shared != 1 {
		t.Fatalf("linkedin: %+v", li)
	}
	if b := got["Employers' own boards"]; b.Seen != 2 || b.Only != 1 {
		t.Fatalf("boards: %+v", b)
	}
}

// Claude's reading of the no's becomes a note that tailoring follows, unless
// the person switches it off.
func TestRejectionsGuideTailoring(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	var mu sync.Mutex
	var prompts []string
	e.Sample = llm.Func(func(ctx context.Context, req llm.Request) (llm.Response, error) {
		if req.Task == "tailor" {
			mu.Lock()
			prompts = append(prompts, req.Prompt)
			mu.Unlock()
		}
		return brain.StandIn().Do(ctx, req)
	})
	if err := e.LookAtResults(); err == nil {
		t.Fatal("a reading with nothing applied to")
	}
	cvs, _ := e.S.CVs()
	for i, k := range []string{"r1", "r2", "r3", "r4", "r5"} {
		closed := ""
		if i < 3 {
			closed = "rejected"
		}
		applyTo(t, e, k, "Tax Analyst", "", cvs[0].ID, 60, 2, "applied", closed)
	}
	if !e.resultsDue(time.Now()) {
		t.Fatal("a reading is due with five applications")
	}
	if err := e.readResults(ctx); err != nil {
		t.Fatal(err)
	}
	d, ok := e.resultsDoc()
	if !ok || d.Summary == "" || d.Guidance == "" || len(d.Rejections) == 0 || d.Applied != 5 || d.No != 3 {
		t.Fatalf("reading: %+v", d)
	}
	if e.resultsDue(time.Now().Add(24 * time.Hour)) {
		t.Fatal("read again within the week")
	}
	if e.resultsDue(time.Now().Add(8 * 24 * time.Hour)) {
		t.Fatal("read again with nothing new")
	}
	if e.Person().Guidance != d.Guidance {
		t.Fatal("the note does not reach the brain")
	}
	if pg := e.Insights(30); pg.Reading == nil || !pg.GuidanceOn {
		t.Fatal("reading not on the page")
	}

	// Tailoring follows it.
	id, err := e.AddRole("Globex", "Tax Technology Manager", "Toronto, ON", "", goodAd, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.ReadRole(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := e.Prepare(ctx, id); err != nil {
		t.Fatal(err)
	}
	// Another pass may be preparing the same role at that moment; wait for it.
	for i := 0; i < 100; i++ {
		mu.Lock()
		n := len(prompts)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	mu.Lock()
	n := len(prompts)
	last := ""
	if n > 0 {
		last = prompts[n-1]
	}
	mu.Unlock()
	if n == 0 || !strings.Contains(last, d.Guidance) {
		t.Fatalf("tailoring did not follow the note (%d prompts)", n)
	}
	// Switched off, it is left out.
	e.SetGuidance(false)
	if e.Person().Guidance != "" {
		t.Fatal("switched off, still used")
	}
	var raw json.RawMessage
	if ok, _ := e.S.Get("results", &raw); !ok {
		t.Fatal("the reading itself was lost")
	}
}
