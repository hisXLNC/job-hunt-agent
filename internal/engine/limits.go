package engine

import (
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/store"
)

// The hard limits (pay floor, age of posting, kinds of job) also apply to the
// roles already found, not only to the next search. A role the person has not
// acted on (not saved, not applied to) that a limit now rules out is set aside
// with the reason, keeping anything written for it; one set aside by a limit that is no longer
// on comes back. A role the person said no to is never brought back.

// limitReasons start every reason limitReason gives, so a role set aside by
// a limit can be told from one set aside for anything else.
var limitReasons = []string{"Pays under your floor", "Posted more than ", "A kind of job you ruled out ("}

// limitReason is the reason a limit rules a role out, or "".
func limitReason(p store.Profile, r store.Role, now time.Time) string {
	if p.PayStrict && p.PayFloor > 0 {
		if y := PayPerYear(r.Pay); y > 0 && y < p.PayFloor {
			return "Pays under your floor"
		}
	}
	if p.MaxAgeDays > 0 && r.PostedAt > 0 && now.Sub(time.Unix(r.PostedAt, 0)) > time.Duration(p.MaxAgeDays)*24*time.Hour {
		return fmt.Sprintf("Posted more than %d days ago", p.MaxAgeDays)
	}
	if len(p.NoTypes) > 0 {
		kind := strings.ToLower(JobType(r.Title, r.Description))
		for _, t := range p.NoTypes {
			if t = strings.ToLower(strings.TrimSpace(t)); t != "" && strings.HasPrefix(kind, t) {
				return "A kind of job you ruled out (" + t + ")"
			}
		}
	}
	return ""
}

func byLimit(why string) bool {
	for _, x := range limitReasons {
		if strings.HasPrefix(why, x) {
			return true
		}
	}
	return false
}

// ApplyLimits sets aside the untouched roles the limits now rule out, and
// brings back those set aside by a limit that is off now. It reports how many
// of each.
func (e *Engine) ApplyLimits() (aside, back int, err error) {
	p, now := e.S.Profile(), e.Now()
	ids, err := e.S.UntouchedOrLimited()
	if err != nil {
		return 0, 0, err
	}
	for _, id := range ids {
		r, err := e.S.Role(id)
		if err != nil {
			continue
		}
		why := limitReason(p, r, now)
		switch {
		case r.Closed == "" && why != "":
			if e.S.CloseRole(id, "screened", why) == nil {
				aside++
			}
		case r.Closed == "screened" && byLimit(r.ClosedWhy) && why == "":
			if e.S.Reopen(id) == nil {
				back++
			}
		case r.Closed == "screened" && byLimit(r.ClosedWhy) && why != r.ClosedWhy:
			e.S.CloseRole(id, "screened", why)
		}
	}
	if aside > 0 || back > 0 {
		e.S.Log(store.Activity{Kind: "tidied", Text: fmt.Sprintf("Your limits changed: %s set aside, %s back", countWord(aside, "role"), countWord(back, "role"))})
	}
	return aside, back, nil
}
