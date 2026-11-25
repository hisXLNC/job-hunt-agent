package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// Employers found by themselves: the list of employers to watch is topped up
// each week, after the person changes what they look for, and after a full
// search that found little. An employer the person muted is never brought
// back (UpsertCompany never turns "muted" into "following").
//
// Dead boards: an employer's job board that fails twice in a row, on two
// different days, is no longer read. The employer stays on the list and is
// still watched through LinkedIn; its board is looked for again after a week.

const (
	seededKey     = "employers:seeded"  // when employers were last added
	seedProfKey   = "employers:profile" // what the person looked for then
	thinKey       = "employers:thin"    // when a full search last found little
	boardFailsKey = "boardfails"

	seedEvery = 7 * 24 * time.Hour
)

// lookingFor is what employer discovery depends on, in one string.
func lookingFor(p store.Profile) string {
	var parts []string
	for _, bt := range p.Titles.All() {
		parts = append(parts, strings.ToLower(strings.TrimSpace(bt.Title)))
	}
	parts = append(parts, "|"+strings.Join(p.Domain, ","), "|"+strings.ToLower(p.City+","+p.Country))
	return strings.Join(parts, ";")
}

// seedWhy says why employers should be looked for now, or "".
func (e *Engine) seedWhy(now time.Time) string {
	last := e.S.GetInt(seededKey)
	var was string
	e.S.Get(seedProfKey, &was)
	is := lookingFor(e.S.Profile())
	switch {
	case was == "":
		// Never recorded: what is looked for now is the starting point.
		e.S.Set(seedProfKey, is)
		if last == 0 {
			e.S.Set(seededKey, now.Unix())
		}
		return ""
	case was != is && now.Unix()-last > 3600:
		return "you changed what you look for"
	case now.Unix()-last >= int64(seedEvery/time.Second):
		return "the weekly look"
	case e.S.GetInt(thinKey) > last && now.Unix()-last > 2*86400:
		return "the last search found little"
	}
	return ""
}

// discoverEmployers is the chore that tops up the employers watched.
func (e *Engine) discoverEmployers(now time.Time) {
	if e.LLM().Engine == "" || e.heldBack("employers") || e.Busy("employers") {
		return
	}
	why := e.seedWhy(now)
	if why == "" {
		return
	}
	// A try that failed waits six hours before the next.
	if now.Unix()-e.S.GetInt("chore:employers-try") < 6*3600 {
		return
	}
	e.S.Set("chore:employers-try", now.Unix())
	trace.Log("search", "looking for more employers: %s", why)
	e.Go("employers", "Finding more employers that hire people like you", func(ctx context.Context) error {
		return e.SeedEmployers(ctx, 12)
	})
}

// seeded records that employers were just looked for.
func (e *Engine) seeded() {
	e.S.Set(seededKey, e.Now().Unix())
	e.S.Set(seedProfKey, lookingFor(e.S.Profile()))
}

// noteThin remembers a full search that found little, so employers are
// looked for again.
func (e *Engine) noteThin(stats RunStats) {
	if stats.Kind == "full" && stats.Kept == 0 && stats.New < 3 {
		e.S.Set(thinKey, e.Now().Unix())
	}
}

// boardFail is one employer's run of failed board reads.
type boardFail struct {
	N   int    `json:"n"`
	Day string `json:"day"` // the day of the last one counted
	Why string `json:"why"`
}

// boardDead reports whether a board's failure says it is gone, not just slow
// or unreachable for a moment.
func boardDead(err error) bool {
	var he *sources.HTTPError
	if errors.As(err, &he) {
		return he.Status == 404 || he.Status == 410
	}
	return errors.Is(err, sources.ErrNoBoard)
}

// boardStrikes counts this search's board failures. A board that answered is
// cleared; one that failed in a way that says it is gone gets a strike, at
// most one a day, and at the second its board is no longer read. When no
// board answered at all, this computer was likely offline and nothing counts.
func (e *Engine) boardStrikes(failed map[int64]error, answered []int64) {
	fails := map[int64]boardFail{}
	e.S.Get(boardFailsKey, &fails)
	changed := false
	for _, id := range answered {
		if _, ok := fails[id]; ok {
			delete(fails, id)
			changed = true
		}
	}
	if len(answered) > 0 {
		day := e.Now().Format("2006-01-02")
		for id, err := range failed {
			if !boardDead(err) {
				continue
			}
			f := fails[id]
			if f.Day == day {
				continue
			}
			f.N, f.Day, f.Why, changed = f.N+1, day, plainErr(err), true
			fails[id] = f
			if f.N >= 2 {
				e.dropBoard(id, f.Why)
				delete(fails, id)
			}
		}
	}
	if changed {
		e.S.Set(boardFailsKey, fails)
	}
}

// dropBoard stops reading an employer's board. The employer stays.
func (e *Engine) dropBoard(id int64, why string) {
	c, err := e.S.Company(id)
	if err != nil || c.BoardKind == "" {
		return
	}
	c.BoardKind, c.BoardToken = "", ""
	c.BoardNote = "Its job board failed twice in a row, so Job Hunt stopped reading it; still watched through LinkedIn"
	c.BoardCheckedAt = e.Now().Unix()
	if e.S.SaveCompany(c) != nil {
		return
	}
	e.S.Log(store.Activity{Kind: "employers", CompanyID: c.ID,
		Text: fmt.Sprintf("Stopped reading %s's job board: it failed twice in a row (%s). %s stays on your list and is still watched through LinkedIn.", c.Name, why, c.Name)})
	e.S.Changed("companies", "radar")
}
