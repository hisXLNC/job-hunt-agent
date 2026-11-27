package engine

import (
	"context"
	"fmt"
	"strings"

	"jobhunt/internal/brain"
	"jobhunt/internal/sources"
	"jobhunt/internal/trace"
)

// Indeed search pages the person opens in their own browser. Indeed turns
// programs away, so Job Hunt never searches it itself; the side panel reads
// the jobs on a search page the person has open and hands them over. It asks
// first which of them are new and pass the person's rules, and for those
// reads each posting's text inside the same page, slowly, the way Indeed's
// own page does. Everything that comes back is untrusted text, checked like
// any posting, and its link must lead to Indeed.

// pageJobsMost is the most jobs one page hands over.
const pageJobsMost = 30

// PageJob is one job read off an Indeed page.
type PageJob = brain.IndeedJob

func (e *Engine) pagePostings(jobs []PageJob) []sources.Posting {
	if len(jobs) > pageJobsMost {
		jobs = jobs[:pageJobsMost]
	}
	now := e.Now()
	var out []sources.Posting
	for _, j := range jobs {
		j.Title, j.Company, j.Location = cut(j.Title, 200), cut(j.Company, 120), cut(j.Location, 120)
		j.Pay, j.Posted, j.Description = cut(j.Pay, 120), cut(j.Posted, 60), cut(j.Description, 60000)
		if p, ok := indeedPosting(j, now); ok {
			out = append(out, p)
		}
	}
	return out
}

func cut(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		s = s[:n]
	}
	return s
}

// IndeedPageWants says which of the jobs on the page Job Hunt would like the
// text of: the ones it hasn't seen that its rules keep. Nothing is stored.
func (e *Engine) IndeedPageWants(jobs []PageJob) []string {
	p := e.S.Profile()
	var want []string
	for _, post := range e.pagePostings(jobs) {
		if _, _, seen := e.S.SeenRole(post.Key); seen {
			continue
		}
		if why, _ := screen(p, post, false); why != "" {
			continue
		}
		want = append(want, strings.TrimPrefix(post.Key, "alert:indeed:"))
	}
	return want
}

// TakeIndeedPage keeps the jobs from an Indeed page like a search's finds and
// reads the new ones against the person's CVs, freshest first.
func (e *Engine) TakeIndeedPage(jobs []PageJob) (seen, added int) {
	posts := e.pagePostings(jobs)
	p := e.S.Profile()
	stats := RunStats{Kind: "page", ByPlace: map[string][2]int{}, ClearedBy: map[string]int{}}
	var fresh []int64
	added = e.takeFound(posts, "Indeed", p, &stats, &fresh)
	if len(fresh) > 0 {
		e.Go("indeedpage", fmt.Sprintf("Reading %s from Indeed", countWord(len(fresh), "new role")), func(ctx context.Context) error {
			if e.budgetHolds(len(fresh)) {
				return nil
			}
			e.readAll(ctx, fresh, &stats)
			return nil
		})
	}
	trace.Log("did", "an Indeed page in your browser: %d jobs, %d new", len(posts), added)
	return len(posts), added
}

// payWithClaude asks Claude, once, for the pay of open roles that still name
// none after Job Hunt's own reading of their text. Only roles whose text has a
// line that could hold pay are asked about, at most 60, the freshest first;
// each request carries just those lines. It stops when Claude is resting.
func (e *Engine) payWithClaude(ctx context.Context) error {
	rows, _ := e.S.Pairs(`SELECT '', id FROM roles WHERE closed = '' AND pay = '' AND description != ''
		AND stage IN ('new', 'found', 'ready') ORDER BY id DESC LIMIT 400`)
	asked, filled := 0, 0
	for _, row := range rows {
		if asked >= 60 || ctx.Err() != nil {
			break
		}
		if rest, _, _ := e.meter.Resting(); rest {
			break
		}
		r, err := e.S.Role(int64(row.N))
		if err != nil || r.Pay != "" {
			continue
		}
		lines := brain.PayLines(r.Description)
		if lines == "" {
			continue
		}
		asked++
		pay, err := e.brain.PayOf(ctx, r.Title, lines)
		if err != nil {
			if stopsWork(err) {
				break
			}
			continue
		}
		if y := PayPerYear(pay); pay != "" && y >= 20000 && y <= 1500000 && len(pay) <= 120 {
			e.S.SetRoleDetail(r.ID, "", "", pay, "", -1, 0)
			filled++
		}
	}
	trace.Log("did", "asked Claude for the pay of %d open roles; %d named one", asked, filled)
	return nil
}
