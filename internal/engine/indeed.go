package engine

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// Indeed through the person's Claude connector. When Job Hunt reaches Claude
// through the Claude Code sign-in, Claude Code can use the connectors the
// person set up in claude.ai, Indeed among them. With the person's say-so
// (it starts off), a full search asks Claude Code to run Indeed's search for
// each title in the person's city and hand the postings back as data. Only
// Indeed's two tools are allowed for that request, nothing about the person
// is sent with it, and what comes back is checked like any posting: it is
// untrusted text, kept and shown escaped, and its link must lead to Indeed.

const (
	srcIndeed = "indeed"
	// indeedPerDay is the most Indeed searches in a day: each is a Claude
	// Code run with several tool calls, on the person's plan.
	indeedPerDay = 8
	// indeedPerSearch is the most titles one full search asks Indeed for.
	indeedPerSearch = 4
)

const indeedAbout = "Indeed's own job search, run by Claude through the Indeed connector of your Claude account. Only when Job Hunt reaches Claude through your Claude subscription (Claude Code). Each title is one search, on full searches, at most 8 a day; it uses your plan."

// indeedMissing is what to do when the connector isn't there.
const indeedMissing = "Indeed isn't connected to your Claude account. In claude.ai, open Settings, Connectors, and connect Indeed, then press Test here"

// indeedWhy says, from what Claude Code itself reported about the Indeed
// connector, what is wrong and how long to leave it.
func indeedWhy(f brain.IndeedFound) (string, time.Duration) {
	switch f.State {
	case "needs-auth":
		return "Indeed is on your Claude account but needs signing in again. In claude.ai, open Settings, Connectors, Indeed, and press Connect; then press Test here", time.Hour
	case "failed", "pending":
		return "The Indeed connector is on your Claude account but didn't answer just now (Indeed's side, or too many requests). Job Hunt tries again in an hour; Test tries now", time.Hour
	case "connected":
		return "The Indeed connector is there, but Claude couldn't use its search" + firstOf(map[bool]string{true: " (" + f.Note + ")"}[f.Note != ""], "") + ". Job Hunt tries again in an hour; Test tries now", time.Hour
	case "none":
		others := "no connectors at all"
		if len(f.Seen) > 0 {
			others = "only " + strings.Join(f.Seen, ", ")
		}
		return "Claude Code on this computer doesn't have the Indeed connector: it listed " + others + ". Connect Indeed in claude.ai (Settings, Connectors) on the same Claude account Claude Code is signed in to (Check sign-in, under Claude above), then press Test", time.Hour
	}
	return indeedMissing, time.Hour
}

// indeedReady says why the Indeed source can't run now, or "".
func (e *Engine) indeedReady() string {
	if e.LLM().Engine != "claude-code" {
		return "Works only when Job Hunt reaches Claude through your Claude subscription (Claude Code), under Claude above."
	}
	return ""
}

var indeedJK = regexp.MustCompile(`^[0-9a-fA-F]{12,20}$`)

// indeedPosting checks one job Claude read from Indeed and turns it into a
// posting. It is false for a job with no title or employer, or whose link
// doesn't lead to Indeed's own site.
func indeedPosting(j brain.IndeedJob, now time.Time) (sources.Posting, bool) {
	if strings.TrimSpace(j.Title) == "" || strings.TrimSpace(j.Company) == "" {
		return sources.Posting{}, false
	}
	jk, host := "", "www"
	if u, err := url.Parse(strings.TrimSpace(j.URL)); err == nil && (u.Scheme == "https" || u.Scheme == "http") {
		h := strings.ToLower(u.Hostname())
		if h == "indeed.com" || strings.HasSuffix(h, ".indeed.com") {
			jk = u.Query().Get("jk")
			if label, _, _ := strings.Cut(h, "."); len(label) == 2 {
				host = label // "ca.indeed.com" keeps its country
			}
		}
	}
	if !indeedJK.MatchString(jk) {
		jk = j.JobID
	}
	if !indeedJK.MatchString(jk) {
		return sources.Posting{}, false
	}
	jk = strings.ToLower(jk)
	p := sources.Posting{
		Source: srcIndeed,
		// The same key as the job-alert e-mails from Indeed: one job, one role.
		Key:     "alert:indeed:" + jk,
		Title:   j.Title,
		Company: j.Company, Location: j.Location, Pay: j.Pay,
		URL:         "https://" + host + ".indeed.com/viewjob?jk=" + jk,
		Description: j.Description,
		Applicants:  -1,
		PostedAt:    postedWhen(j.Posted, now),
	}
	p.NeedsDetail = len(strings.Fields(p.Description)) < 40
	return p, true
}

var agoRE = regexp.MustCompile(`(?i)(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago`)

// postedWhen reads "3 days ago", "today", "just posted" or a date.
func postedWhen(s string, now time.Time) time.Time {
	low := strings.ToLower(strings.TrimSpace(s))
	switch {
	case low == "":
		return time.Time{}
	case strings.Contains(low, "just") || strings.Contains(low, "today") || strings.Contains(low, "new"):
		return now
	case strings.Contains(low, "yesterday"):
		return now.Add(-24 * time.Hour)
	}
	if m := agoRE.FindStringSubmatch(low); m != nil {
		n, _ := strconv.Atoi(m[1])
		unit := map[string]time.Duration{"minute": time.Minute, "hour": time.Hour, "day": 24 * time.Hour, "week": 7 * 24 * time.Hour, "month": 30 * 24 * time.Hour}[m[2]]
		return now.Add(-time.Duration(n) * unit)
	}
	for _, layout := range []string{"2006-01-02", time.RFC3339, "January 2, 2006", "Jan 2, 2006"} {
		if t, err := time.Parse(layout, strings.TrimSpace(s)); err == nil && !t.After(now) {
			return t
		}
	}
	return time.Time{}
}

// searchIndeed asks the Indeed connector for the person's titles, on full
// searches, when the person turned it on and Claude Code is how Claude is
// reached.
func (e *Engine) searchIndeed(ctx context.Context, p store.Profile, stats *RunStats, fresh *[]int64, note func(place string, seen, added int)) {
	if !e.sourceKeys().Indeed || e.indeedReady() != "" {
		return
	}
	var titles []string
	for _, bt := range p.Titles.All() {
		titles = append(titles, bt.Title)
	}
	if len(titles) == 0 {
		return
	}
	now := e.Now()
	st := e.setSourceState(srcIndeed, func(*SourceState) {})
	if st.RestUntil > now.Unix() {
		stats.Problems = append(stats.Problems, firstOf(st.Error, "Indeed is resting"))
		stats.missed(srcIndeed, firstOf(st.Error, "Indeed is resting"))
		return
	}
	n := min(len(titles), indeedPerSearch, indeedPerDay-st.Used)
	if n <= 0 {
		return
	}
	place := strings.TrimSpace(strings.Split(p.City, ",")[0])
	seen, added, used, answered := 0, 0, 0, false
	why, rest := "", time.Duration(0)
	for i := 0; i < n && ctx.Err() == nil; i++ {
		title := titles[(st.Turn+i)%len(titles)]
		e.Report(ctx, i, n, "Indeed: "+title)
		stats.Looked++
		used++
		found, err := e.brain.Indeed(ctx, brain.IndeedQuery{Title: title, Location: place, Country: searchCountry(p), Max: 10})
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			trace.Log("search", "indeed, %q: %v", title, err)
			why = "Indeed through Claude didn't answer: " + plainErr(err)
			if stopsWork(err) || errors.Is(err, llm.ErrNotConnected) {
				why, rest = "Indeed waits for Claude: "+plainErr(err), time.Hour
			}
			stats.missed(srcIndeed, why)
			if rest > 0 {
				break
			}
			continue
		}
		if !found.Connected {
			why, rest = indeedWhy(found)
			trace.Log("search", "indeed: connector %q; Claude Code listed %v; note %q", found.State, found.Seen, found.Note)
			stats.missed(srcIndeed, why)
			break
		}
		answered = true
		var posts []sources.Posting
		for _, j := range found.Jobs {
			if post, ok := indeedPosting(j, now); ok {
				posts = append(posts, post)
			}
		}
		got := e.takeFound(posts, "Indeed", p, stats, fresh)
		stats.saw(srcIndeed, len(posts), got)
		seen, added = seen+len(posts), added+got
		note("Indeed: "+title, len(posts), got)
	}
	if why != "" {
		stats.Problems = append(stats.Problems, why)
	}
	e.setSourceState(srcIndeed, func(s *SourceState) {
		s.Used += used
		s.Turn = (s.Turn + used) % len(titles)
		if answered {
			s.At, s.Seen, s.New = now.Unix(), seen, added
		}
		switch {
		case why != "":
			s.Error, s.ErrorAt = why, now.Unix()
			if rest > 0 {
				s.RestUntil = now.Add(rest).Unix()
			}
		case answered:
			s.Error, s.ErrorAt, s.RestUntil = "", 0, 0
		}
	})
}

// indeedRow is the Indeed line of the "More job sources" card.
func (e *Engine) indeedRow(k SourceKeys, st SourceState) MoreSource {
	m := MoreSource{ID: srcIndeed, Name: "Indeed through Claude", About: indeedAbout, On: k.Indeed, At: st.At, Seen: st.Seen, New: st.New, Limit: indeedPerDay}
	if st.Day == e.Now().Format("2006-01-02") {
		m.Used = st.Used
	}
	switch why := e.indeedReady(); {
	case why != "":
		m.State, m.Note = "none", why
	case !m.On:
		m.State = "off"
	case st.Error != "":
		m.State, m.Note = "problem", st.Error
	case st.At > 0:
		m.State = "working"
	default:
		m.State, m.Note = "waiting", "Asked on the next full search."
	}
	return m
}

// testIndeed runs one Indeed search now, for the first title, and notes what
// happened: the person's Test button. It counts towards the day's searches.
func (e *Engine) testIndeed(ctx context.Context) (int, error) {
	if why := e.indeedReady(); why != "" {
		return 0, errors.New(why)
	}
	p := e.S.Profile()
	title := "manager"
	if all := p.Titles.All(); len(all) > 0 {
		title = all[0].Title
	}
	now := e.Now()
	found, err := e.brain.Indeed(ctx, brain.IndeedQuery{Title: title, Location: strings.TrimSpace(strings.Split(p.City, ",")[0]), Country: searchCountry(p), Max: 10})
	why := ""
	switch {
	case err != nil:
		trace.Log("search", "indeed test: %v", err)
		why = "Indeed through Claude didn't answer: " + plainErr(err)
	case !found.Connected:
		why, _ = indeedWhy(found)
		trace.Log("search", "indeed test: connector %q; Claude Code listed %v; note %q", found.State, found.Seen, found.Note)
	}
	n := 0
	if why == "" {
		for _, j := range found.Jobs {
			if _, ok := indeedPosting(j, now); ok {
				n++
			}
		}
	}
	e.setSourceState(srcIndeed, func(s *SourceState) {
		s.Used++
		if why != "" {
			s.Error, s.ErrorAt = why, now.Unix()
			return
		}
		s.At, s.Seen, s.New = now.Unix(), n, 0
		s.Error, s.ErrorAt, s.RestUntil = "", 0, 0
	})
	e.S.Changed("connections", "runs")
	if why != "" {
		return 0, errors.New(why)
	}
	return n, nil
}
