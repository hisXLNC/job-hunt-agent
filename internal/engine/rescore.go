package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// Score again: the roles set aside lately are looked at once more with the
// person's rules, CVs and settings as they are now. The quick rules cost
// nothing to check; a role that now passes them, or (when the person asks
// for it) one Claude set aside, is read again, one request each. A role the
// person said no to is never among them, nor one of a muted employer, nor
// one they saved or applied to, nor one whose posting is gone.

const (
	rescoreDays = 30  // how far back set-aside roles are looked at again
	rescoreMost = 300 // and at most this many of them
)

// Rescore is what scoring again would do, said before it starts.
type Rescore struct {
	ByRules  int `json:"by_rules"`  // set aside by the quick rules
	Pass     int `json:"pass"`      // of those, how many pass the rules as they are now
	ByClaude int `json:"by_claude"` // set aside after Claude read them
	Fetch    int `json:"fetch"`     // of those to read, how many need the posting fetched again
	// Requests to Claude: for the roles that now pass the rules alone, and
	// with the ones Claude set aside as well.
	Requests    int `json:"requests"`
	RequestsAll int `json:"requests_all"`
	Days        int `json:"days"`
}

// rescoreList sorts the roles set aside lately: those that pass the rules as
// they are now, those that still do not (with the reason now), and those
// Claude set aside.
func (e *Engine) rescoreList() (pass []store.Role, still map[int64]string, claude []store.Role, err error) {
	p := e.S.Profile()
	roles, err := e.S.SetAside(e.Now().Add(-rescoreDays*24*time.Hour).Unix(), rescoreMost)
	if err != nil {
		return nil, nil, nil, err
	}
	still = map[int64]string{}
	for _, r := range roles {
		if r.Fit >= 0 {
			claude = append(claude, r)
			continue
		}
		post := sources.Posting{Title: r.Title, Company: r.Company, Location: r.Location, Workplace: r.Workplace, Pay: r.Pay, Description: r.Description}
		if r.PostedAt > 0 {
			post.PostedAt = time.Unix(r.PostedAt, 0)
		}
		// A posting found by a title search was not held to the place rule.
		searched := r.Source == "linkedin" && r.Band != ""
		if why, _ := screen(p, post, searched); why != "" {
			still[r.ID] = why
			continue
		}
		pass = append(pass, r)
	}
	return pass, still, claude, nil
}

// RescoreEstimate says what scoring again would do and what it would cost.
func (e *Engine) RescoreEstimate() (Rescore, error) {
	pass, still, claude, err := e.rescoreList()
	if err != nil {
		return Rescore{}, err
	}
	out := Rescore{ByRules: len(pass) + len(still), Pass: len(pass), ByClaude: len(claude), Days: rescoreDays,
		Requests: len(pass), RequestsAll: len(pass) + len(claude)}
	for _, r := range pass {
		if len(strings.Fields(r.Description)) < 40 {
			out.Fetch++
		}
	}
	return out, nil
}

// StartRescore scores again in the background. All includes the roles Claude
// set aside, each read once more.
func (e *Engine) StartRescore(all bool) bool {
	return e.Go("rescore", "Scoring set-aside roles again", func(ctx context.Context) error {
		_, err := e.ScoreAgain(ctx, all)
		return err
	})
}

// ScoreAgain looks at the roles set aside lately once more. It reports how
// many came back.
func (e *Engine) ScoreAgain(ctx context.Context, all bool) (back int, err error) {
	pass, still, claude, err := e.rescoreList()
	if err != nil {
		return 0, err
	}
	// The reason a role is still set aside is brought up to date for free.
	for id, why := range still {
		if r, err := e.S.Role(id); err == nil && r.ClosedWhy != why {
			e.S.CloseRole(id, "screened", why)
		}
	}
	read := pass
	if all {
		read = append(read, claude...)
	}
	if len(read) == 0 {
		return 0, nil
	}
	e.StepTakes(ctx, 8*time.Second)
	for i, r := range read {
		if ctx.Err() != nil {
			break
		}
		if rest, _, _ := e.meter.Resting(); rest {
			break
		}
		e.Report(ctx, i, len(read), fmt.Sprintf("Reading %d of %d set-aside roles again", i+1, len(read)))
		kept, _, err := e.readRole(ctx, r.ID, true)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				break
			}
			e.problem("Scoring again", err)
			if stopsWork(err) {
				break
			}
			continue
		}
		if kept {
			back++
		}
	}
	e.S.Log(store.Activity{Kind: "tidied", Text: fmt.Sprintf("Scored %s again: %s back among the roles worth a look", countWord(len(read), "set-aside role"), countWord(back, "role"))})
	return back, ctx.Err()
}
