package engine

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// ---- insights: Progress in depth -----------------------------------------------------------
//
// Every number here is Job Hunt's own count. Claude only reads them back in
// plain words (at most once a week by itself, or when asked), and reads the
// no's for one short note that tailoring then follows.

// PeriodCount is one line of the funnel for a period, with the period before.
type PeriodCount struct {
	Label  string `json:"label"`
	N      int    `json:"n"`
	Before int    `json:"before"`
}

// PayInsight is what the pay in postings says.
type PayInsight struct {
	Seen       int `json:"seen"`        // postings seen in the period
	Shown      int `json:"shown"`       // of them, naming pay
	Median     int `json:"median"`      // of those naming pay
	Good       int `json:"good"`        // median of good fits (70 and up)
	Applied    int `json:"applied"`     // median of roles applied to
	Heard      int `json:"heard"`       // median of roles that answered
	Floor      int `json:"floor"`       // the person's own floor, a year
	UnderFloor int `json:"under_floor"` // good fits naming pay below the floor
}

// OverlapRow is how many roles a source showed, and how many only it did.
type OverlapRow struct {
	Label  string `json:"label"`
	Seen   int    `json:"seen"`
	Only   int    `json:"only"`
	Shared int    `json:"shared"`
}

// RejectView is how the no's in the period went.
type RejectView struct {
	Total       int `json:"total"`
	BeforeReply int `json:"before_reply"` // before anyone answered
	AfterTalk   int `json:"after_talk"`   // after an interview
	FitNo       int `json:"fit_no"`       // median fit of the no's
	FitHeard    int `json:"fit_heard"`    // median fit of roles that answered
}

// resultsDoc is Claude's stored reading.
type resultsDoc struct {
	brain.ResultsReading
	At      int64 `json:"at"`
	Applied int   `json:"applied"` // applications counted at the time
	No      int   `json:"no"`      // no's counted at the time
}

// InsightsPage is the deeper half of Progress.
type InsightsPage struct {
	Days       int           `json:"days"`
	From       int64         `json:"from"`
	Funnel     []PeriodCount `json:"funnel"`
	ByCV       []Rate        `json:"by_cv"`
	ByFit      []Rate        `json:"by_fit"`
	ByKind     []Rate        `json:"by_kind"`
	ByPay      []Rate        `json:"by_pay"`
	Pay        PayInsight    `json:"pay"`
	PayLines   []string      `json:"pay_lines"`
	Overlap    []OverlapRow  `json:"overlap"`
	Both       int           `json:"both"` // roles seen through more than one source
	Rejects    RejectView    `json:"rejects"`
	Lines      []string      `json:"lines"` // plain observations, when the numbers bear them
	Reading    *resultsDoc   `json:"reading"`
	GuidanceOn bool          `json:"guidance_on"`
	Busy       bool          `json:"busy"`
	CanRead    bool          `json:"can_read"`
	Applied    int           `json:"applied"` // all time, to say whether a reading is possible
}

// insightDays keeps the period to one of the three views.
func insightDays(d int) int {
	switch d {
	case 7, 30, 90:
		return d
	}
	return 30
}

func median(v []int) int {
	if len(v) == 0 {
		return 0
	}
	s := append([]int(nil), v...)
	sort.Ints(s)
	return s[len(s)/2]
}

func fitBand(fit int) string {
	switch {
	case fit < 0:
		return "Not scored"
	case fit >= 85:
		return "85 and up"
	case fit >= 70:
		return "70 to 84"
	case fit >= 55:
		return "55 to 69"
	}
	return "Under 55"
}

var fitOrder = []string{"85 and up", "70 to 84", "55 to 69", "Under 55", "Not scored"}

// payBand puts a yearly figure into a band: against the person's floor
// when they set one, otherwise in plain thousands.
func payBand(year, floor int) string {
	switch {
	case year <= 0:
		return "No pay given"
	case floor > 0 && year < floor:
		return "Below your floor"
	case floor > 0 && year <= floor*12/10:
		return "Up to 20% above your floor"
	case floor > 0:
		return "More than 20% above your floor"
	case year < 60000:
		return "Under 60k"
	case year < 80000:
		return "60k to 80k"
	case year < 100000:
		return "80k to 100k"
	case year < 130000:
		return "100k to 130k"
	}
	return "130k and up"
}

var payOrder = []string{"Below your floor", "Up to 20% above your floor", "More than 20% above your floor", "Under 60k", "60k to 80k", "80k to 100k", "100k to 130k", "130k and up", "No pay given"}

// floorPerYear is the person's pay floor as a yearly figure.
func floorPerYear(p store.Profile) int {
	if p.PayFloor <= 0 {
		return 0
	}
	switch strings.ToLower(p.PayUnit) {
	case "hour", "hourly", "an hour", "per hour":
		return p.PayFloor * 2080
	case "day", "daily":
		return p.PayFloor * 230
	case "month", "monthly":
		return p.PayFloor * 12
	}
	return p.PayFloor
}

var sourceNames = map[string]string{"linkedin": "LinkedIn", "greenhouse": "Employers' own boards", "lever": "Employers' own boards", "ashby": "Employers' own boards", "smartrecruiters": "Employers' own boards", "workday": "Employers' own boards", "manual": "Added by you", "extension": "Sent from your browser", "indeed": "Indeed", "jobbank": "Job Bank", "freehire": "FreeHire", "mail": "Job alert mail", "alerts": "Job alert mail", "lead": "From a lead", "old": "The old Job Hunt"}

func sourceName(s string) string {
	if n, ok := sourceNames[s]; ok {
		return n
	}
	if s == "" {
		return "Other"
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// rateRows counts applications by a label, in a fixed order when one is given.
func rateRows(rows []store.ResultRow, label func(store.ResultRow) string, order []string) []Rate {
	idx := map[string]int{}
	var out []Rate
	for _, r := range rows {
		l := label(r)
		i, ok := idx[l]
		if !ok {
			i = len(out)
			idx[l] = i
			out = append(out, Rate{Label: l})
		}
		out[i].Applied++
		if heard(r.Stage) {
			out[i].Heard++
		}
		if r.Stage == "interview" || r.Stage == "offer" {
			out[i].Talks++
		}
	}
	pos := func(l string) int {
		for i, o := range order {
			if o == l {
				return i
			}
		}
		return len(order)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if pi, pj := pos(out[i].Label), pos(out[j].Label); pi != pj {
			return pi < pj
		}
		return out[i].Applied > out[j].Applied
	})
	if out == nil {
		out = []Rate{}
	}
	return out
}

// Insights counts the period's results: the last 7, 30 or 90 days.
func (e *Engine) Insights(days int) InsightsPage {
	days = insightDays(days)
	now := e.Now()
	from := now.AddDate(0, 0, -days).Unix()
	before := now.AddDate(0, 0, -2*days).Unix()
	s := e.S
	pr := s.Profile()
	pg := InsightsPage{Days: days, From: from, GuidanceOn: e.guidanceOn(), Busy: e.Busy("results"), CanRead: e.LLM().Engine != ""}
	pg.Applied = s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`)
	if d, ok := e.resultsDoc(); ok {
		pg.Reading = &d
	}

	// The funnel for the period, beside the period before it.
	count := func(lo, hi int64) []int {
		seen := s.Count(`SELECT COUNT(*) FROM roles WHERE first_seen_at >= ? AND first_seen_at < ?`, lo, hi)
		worth := s.Count(`SELECT COUNT(*) FROM roles WHERE first_seen_at >= ? AND first_seen_at < ? AND stage != 'new' AND closed != 'screened'`, lo, hi)
		applied := s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at < ?`, lo, hi)
		heardN := s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at < ? AND stage IN ('reply','interview','offer')`, lo, hi)
		talks := s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at < ? AND stage IN ('interview','offer')`, lo, hi)
		offers := s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at < ? AND stage = 'offer'`, lo, hi)
		return []int{seen, worth, applied, heardN, talks, offers}
	}
	nowN, prevN := count(from, now.Unix()+1), count(before, from)
	for i, l := range []string{"Postings seen", "Worth a look", "Applied", "Heard back", "Interviews", "Offers"} {
		pg.Funnel = append(pg.Funnel, PeriodCount{Label: l, N: nowN[i], Before: prevN[i]})
	}

	rows, _ := s.AppliedSince(from)
	cvs, _ := s.CVs()
	cvName := map[int64]string{}
	for _, c := range cvs {
		cvName[c.ID] = c.Name
	}
	pg.ByCV = rateRows(rows, func(r store.ResultRow) string {
		switch {
		case r.OwnCV:
			return "Your own file"
		case cvName[r.CVID] != "":
			return cvName[r.CVID]
		case r.CVID > 0:
			return "A CV since removed"
		}
		return "Not tailored"
	}, nil)
	pg.ByFit = rateRows(rows, func(r store.ResultRow) string { return fitBand(r.Fit) }, fitOrder)
	titles := pr.Titles.All()
	pg.ByKind = rateRows(rows, func(r store.ResultRow) string {
		for _, t := range titles {
			if sameTitle(r.Title, titleWords(t.Title)) {
				return t.Title
			}
		}
		return "Other titles"
	}, nil)
	if len(pg.ByKind) > 8 {
		pg.ByKind = pg.ByKind[:8]
	}
	floor := floorPerYear(pr)
	pg.ByPay = rateRows(rows, func(r store.ResultRow) string { return payBand(PayPerYear(r.Pay), floor) }, payOrder)

	// Pay in what was seen.
	seen, _ := s.SeenSince(from, now.Unix()+1)
	var all, good, app, hrd []int
	pg.Pay.Floor = floor
	for _, r := range seen {
		pg.Pay.Seen++
		y := PayPerYear(r.Pay)
		if y <= 0 {
			continue
		}
		pg.Pay.Shown++
		all = append(all, y)
		if r.Fit >= 70 {
			good = append(good, y)
			if floor > 0 && y < floor {
				pg.Pay.UnderFloor++
			}
		}
	}
	for _, r := range rows {
		if y := PayPerYear(r.Pay); y > 0 {
			app = append(app, y)
			if heard(r.Stage) {
				hrd = append(hrd, y)
			}
		}
	}
	pg.Pay.Median, pg.Pay.Good, pg.Pay.Applied, pg.Pay.Heard = median(all), median(good), median(app), median(hrd)
	pg.PayLines = payLines(pg.Pay, len(good), len(app), len(hrd))

	// Overlap between sources: which places show roles nobody else does.
	srcs, _ := s.RoleSources(from)
	byLabel := map[string]*OverlapRow{}
	for _, list := range srcs {
		labels := map[string]bool{}
		for _, x := range list {
			labels[sourceName(x)] = true
		}
		if len(labels) > 1 {
			pg.Both++
		}
		for l := range labels {
			o := byLabel[l]
			if o == nil {
				o = &OverlapRow{Label: l}
				byLabel[l] = o
			}
			o.Seen++
			if len(labels) == 1 {
				o.Only++
			} else {
				o.Shared++
			}
		}
	}
	pg.Overlap = []OverlapRow{}
	for _, o := range byLabel {
		pg.Overlap = append(pg.Overlap, *o)
	}
	sort.Slice(pg.Overlap, func(i, j int) bool {
		if pg.Overlap[i].Seen != pg.Overlap[j].Seen {
			return pg.Overlap[i].Seen > pg.Overlap[j].Seen
		}
		return pg.Overlap[i].Label < pg.Overlap[j].Label
	})

	// The no's.
	var fitNo, fitHeard []int
	for _, r := range rows {
		if r.Closed == "rejected" {
			pg.Rejects.Total++
			switch r.Stage {
			case "interview", "offer":
				pg.Rejects.AfterTalk++
			case "applied", "ready", "found", "new":
				pg.Rejects.BeforeReply++
			}
			if r.Fit >= 0 {
				fitNo = append(fitNo, r.Fit)
			}
		} else if heard(r.Stage) && r.Fit >= 0 {
			fitHeard = append(fitHeard, r.Fit)
		}
	}
	pg.Rejects.FitNo, pg.Rejects.FitHeard = median(fitNo), median(fitHeard)
	pg.Lines = insightLines(pg, len(rows), len(fitNo), len(fitHeard))
	return pg
}

func money(n int) string {
	if n >= 1000 {
		return fmt.Sprintf("%dk", (n+500)/1000)
	}
	return fmt.Sprint(n)
}

func payLines(p PayInsight, good, app, hrd int) []string {
	out := []string{}
	if p.Seen == 0 {
		return out
	}
	out = append(out, fmt.Sprintf("%d of the %d postings seen named their pay (%d%%).", p.Shown, p.Seen, p.Shown*100/p.Seen))
	if p.Shown >= 3 {
		out = append(out, fmt.Sprintf("The middle of what they offered: about %s a year.", money(p.Median)))
	}
	if good >= 3 {
		out = append(out, fmt.Sprintf("Roles that fit you well (70 and up) offered about %s.", money(p.Good)))
	}
	if app >= 3 && hrd >= 2 {
		out = append(out, fmt.Sprintf("You applied at about %s; the ones that answered offered about %s.", money(p.Applied), money(p.Heard)))
	}
	if p.Floor > 0 && p.UnderFloor > 0 {
		out = append(out, fmt.Sprintf("%d good fit%s named pay below your floor of %s.", p.UnderFloor, plural(p.UnderFloor), money(p.Floor)))
	}
	return out
}

// insightLines are plain observations, only where the numbers can bear them.
func insightLines(pg InsightsPage, applied, nNo, nHeard int) []string {
	out := []string{}
	best := func(rates []Rate, min int) (Rate, Rate, bool) {
		var hi, lo Rate
		found := 0
		for _, r := range rates {
			if r.Applied < min {
				continue
			}
			if found == 0 || r.Heard*hi.Applied > hi.Heard*r.Applied {
				hi = r
			}
			if found == 0 || r.Heard*lo.Applied < lo.Heard*r.Applied {
				lo = r
			}
			found++
		}
		return hi, lo, found >= 2 && hi.Label != lo.Label && hi.Heard*lo.Applied > lo.Heard*hi.Applied
	}
	if hi, lo, ok := best(pg.ByCV, 3); ok {
		out = append(out, fmt.Sprintf("Applications with “%s” heard back %d of %d times; with “%s”, %d of %d.", hi.Label, hi.Heard, hi.Applied, lo.Label, lo.Heard, lo.Applied))
	}
	if hi, _, ok := best(pg.ByKind, 3); ok {
		out = append(out, fmt.Sprintf("%s roles answer you most often: %d of %d.", hi.Label, hi.Heard, hi.Applied))
	}
	if nNo >= 3 && nHeard >= 2 && pg.Rejects.FitHeard-pg.Rejects.FitNo >= 8 {
		out = append(out, fmt.Sprintf("The roles that said no fit you less (about %d) than the ones that answered (about %d). Fewer, better-fitting applications may do more.", pg.Rejects.FitNo, pg.Rejects.FitHeard))
	}
	if pg.Rejects.Total >= 3 && pg.Rejects.BeforeReply*3 >= pg.Rejects.Total*2 {
		out = append(out, "Most no's came before anyone spoke to you: the CV and the first lines of the letter are where to work.")
	} else if pg.Rejects.AfterTalk >= 2 && pg.Rejects.AfterTalk*2 >= pg.Rejects.Total {
		out = append(out, "Your CV gets you into the room; the no's come after interviews. Practising the interview is where to put time.")
	}
	if pg.Both > 0 {
		for _, o := range pg.Overlap {
			if o.Seen >= 5 && o.Only == 0 {
				out = append(out, fmt.Sprintf("Everything %s showed was also found somewhere else.", o.Label))
			}
		}
	}
	return out
}

// ---- Claude's reading ------------------------------------------------------------------

func (e *Engine) resultsDoc() (resultsDoc, bool) {
	var d resultsDoc
	ok, _ := e.S.Get("results", &d)
	return d, ok && d.At > 0
}

func (e *Engine) guidanceOn() bool {
	off := false
	e.S.Get("results:guidance_off", &off)
	return !off
}

// SetGuidance switches the tailoring note from the no's on or off.
func (e *Engine) SetGuidance(on bool) error {
	if err := e.S.Set("results:guidance_off", !on); err != nil {
		return err
	}
	e.S.Changed("progress")
	return nil
}

// tailorGuidance is the note tailoring follows, when there is one and it is on.
func (e *Engine) tailorGuidance() string {
	if !e.guidanceOn() {
		return ""
	}
	d, ok := e.resultsDoc()
	if !ok {
		return ""
	}
	return strings.TrimSpace(d.Guidance)
}

// resultsDue: a week since the last reading, and something new to read.
func (e *Engine) resultsDue(now time.Time) bool {
	applied := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`)
	if applied < 5 {
		return false
	}
	d, _ := e.resultsDoc()
	if now.Unix()-d.At < 7*86400 {
		return false
	}
	no := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0 AND closed = 'rejected'`)
	return applied != d.Applied || no != d.No
}

// LookAtResults asks Claude for its reading now. It runs in the background.
func (e *Engine) LookAtResults() error {
	if e.LLM().Engine == "" {
		return llm.ErrNotConnected
	}
	if e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`) < 3 {
		return errors.New("Apply to a few roles first; there is nothing to read yet.")
	}
	e.Resume("results")
	e.Go("results", "Reading your results", func(ctx context.Context) error { return e.readResults(ctx) })
	return nil
}

func rateLine(title string, rates []Rate) string {
	var parts []string
	for _, r := range rates {
		parts = append(parts, fmt.Sprintf("%s: %d applied, %d heard back, %d interviews", r.Label, r.Applied, r.Heard, r.Talks))
	}
	if len(parts) == 0 {
		return ""
	}
	return title + ": " + strings.Join(parts, "; ")
}

func (e *Engine) readResults(ctx context.Context) error {
	e.Report(ctx, 0, 1, "Reading how your applications went")
	pg := e.Insights(90)
	var nums []string
	for _, f := range pg.Funnel {
		nums = append(nums, fmt.Sprintf("Last 90 days, %s: %d (the 90 days before: %d)", strings.ToLower(f.Label), f.N, f.Before))
	}
	for _, l := range []string{rateLine("By CV", pg.ByCV), rateLine("By fit score", pg.ByFit), rateLine("By kind of role", pg.ByKind), rateLine("By pay", pg.ByPay)} {
		if l != "" {
			nums = append(nums, l)
		}
	}
	nums = append(nums, pg.PayLines...)
	for _, o := range pg.Overlap {
		nums = append(nums, fmt.Sprintf("Source %s: %d roles, %d found nowhere else", o.Label, o.Seen, o.Only))
	}
	pr := e.Progress()
	if pr.Speed.Applied > 0 {
		nums = append(nums, fmt.Sprintf("Applications sent within a day of the posting: %d of %d; while under ten had applied: %d", pr.Speed.FirstDay, pr.Speed.Applied, pr.Speed.FirstTen))
	}
	nums = append(nums, fmt.Sprintf("People written to: %d, answered: %d", pr.People.Written, pr.People.Replied))

	rows, _ := e.S.AppliedSince(0)
	var no []string
	for _, r := range rows {
		if r.Closed != "rejected" || len(no) == 40 {
			continue
		}
		line := fmt.Sprintf("%s at %s: got as far as %s; fit %d; %s", clipRunes(r.Title, 90), clipRunes(r.Company, 60), r.Stage, r.Fit, map[string]string{"level": "at their level", "step_up": "a step up", "sideways": "sideways"}[r.Band])
		if r.Said != "" {
			line += "; the mail said: " + clipRunes(r.Said, 200)
		}
		no = append(no, line)
	}
	out, err := e.brain.ReadResults(ctx, brain.ResultsInput{Person: e.Person(), Numbers: nums, Rejections: no})
	if err != nil {
		return err
	}
	out.Summary = clipRunes(out.Summary, 600)
	out.Guidance = clipRunes(out.Guidance, 600)
	if len(out.Points) > 4 {
		out.Points = out.Points[:4]
	}
	if len(out.Rejections) > 3 {
		out.Rejections = out.Rejections[:3]
	}
	if len(no) < 2 {
		// Too few no's to say anything about them.
		out.Rejections, out.Guidance = nil, ""
	}
	applied := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`)
	e.S.Set("results", resultsDoc{ResultsReading: out, At: e.Now().Unix(), Applied: applied, No: len(no)})
	e.S.Log(store.Activity{Kind: "results", Text: "Read how your applications are going"})
	e.S.Changed("progress")
	return nil
}
