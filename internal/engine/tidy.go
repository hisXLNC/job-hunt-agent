package engine

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// Three things Job Hunt can do by itself to keep the list short:
//
//   - look up what employees say about the employers of roles worth a look,
//     a few a day, and set aside roles at employers rated under a number;
//   - set aside roles nobody acted on after 30, 60 or 90 days;
//   - in budget mode, keep a big batch of new postings for the night.
//
// Each only ever sets roles aside (closes them as "screened", with the
// reason, so Bring back works); nothing is deleted, and a role the person
// said no to, saved, applied to or added themselves is never touched.

const searchSetKey = "searchset"

// SearchSet is what the person chose for these.
type SearchSet struct {
	// RatingsOff stops the lookups of employee ratings. They are on unless
	// the person turns them off.
	RatingsOff bool `json:"ratings_off"`
	// MinRating sets aside roles at employers employees rate under it, out
	// of 5. 0 = off. An employer with no rating is never set aside.
	MinRating float64 `json:"min_rating"`
	// ClearDays sets aside roles nobody acted on after this many days:
	// 0 (off), 30, 60 or 90.
	ClearDays int `json:"clear_days"`
	// Budget keeps a big batch of new postings to read at night.
	Budget bool `json:"budget"`
}

func (e *Engine) SearchSet() SearchSet {
	var set SearchSet
	e.S.Get(searchSetKey, &set)
	return set
}

// SetSearchSet saves the choices and applies them to the roles already found.
func (e *Engine) SetSearchSet(set SearchSet) error {
	switch set.ClearDays {
	case 0, 30, 60, 90:
	default:
		return errors.New("set aside after 30, 60 or 90 days, or never")
	}
	if set.MinRating != 0 && (set.MinRating < 1 || set.MinRating > 5) {
		return errors.New("the lowest rating is between 1 and 5, or none")
	}
	set.MinRating = float64(int(set.MinRating*10+0.5)) / 10
	was := e.SearchSet()
	if err := e.S.Set(searchSetKey, set); err != nil {
		return err
	}
	if was.MinRating != set.MinRating {
		e.applyRatingFloor(nil)
	}
	if set.ClearDays != 0 && set.ClearDays != was.ClearDays {
		e.clearUnacted(e.Now())
	}
	if !set.Budget {
		e.S.Set(budgetKey, BudgetHold{}) // nothing waits for the night any more
	}
	e.S.Changed("connections", "status", "roles", "radar")
	return nil
}

// ---- employee ratings ---------------------------------------------------------------

const ratingPrefix = "Employees rate "

// ratingReason is why a role at an employer with this rating is set aside,
// or "" when it isn't.
func ratingReason(name string, rating, floor float64) string {
	if floor <= 0 || rating <= 0 || rating >= floor {
		return ""
	}
	return fmt.Sprintf("%s%s %.1f★, under your %.1f", ratingPrefix, name, rating, floor)
}

// Ratings is the employee rating of every employer that has one.
func (e *Engine) Ratings() map[int64]float64 {
	rows, _ := e.S.Pairs(`SELECT CAST(json_extract(v, '$.rating') AS TEXT), CAST(substr(k, 11) AS INTEGER) FROM kv
		WHERE k LIKE 'coreviews:%' AND json_extract(v, '$.rating') > 0`)
	out := map[int64]float64{}
	for _, r := range rows {
		if f, err := strconv.ParseFloat(r.Label, 64); err == nil && f > 0 {
			out[int64(r.N)] = f
		}
	}
	return out
}

// ratingAside is the reason a new posting at an employer is set aside for
// its rating, or "".
func (e *Engine) ratingAside(companyID int64, name string) string {
	floor := e.SearchSet().MinRating
	if floor <= 0 {
		return ""
	}
	return ratingReason(name, e.EmployerRating(companyID), floor)
}

// applyRatingFloor sets aside the untouched roles at employers rated under
// the floor, and brings back those it set aside that no longer are. With no
// ids it looks at every employer with a rating.
func (e *Engine) applyRatingFloor(ids []int64) (aside, back int) {
	ratings := e.Ratings()
	if ids == nil {
		for id := range ratings {
			ids = append(ids, id)
		}
		// Employers whose roles were set aside for a rating they no longer have.
		rows, _ := e.S.Pairs(`SELECT '', company_id FROM roles WHERE closed = 'screened' AND closed_why LIKE ? GROUP BY company_id`, ratingPrefix+"%")
		for _, r := range rows {
			ids = append(ids, int64(r.N))
		}
	}
	floor := e.SearchSet().MinRating
	roles, _ := e.S.RoleIDsAtEmployers(ids)
	for _, id := range roles {
		r, err := e.S.Role(id)
		if err != nil {
			continue
		}
		why := ratingReason(r.Company, ratings[r.CompanyID], floor)
		switch {
		case r.Closed == "" && why != "":
			if e.S.CloseRole(id, "screened", why) == nil {
				aside++
			}
		case r.Closed == "screened" && strings.HasPrefix(r.ClosedWhy, ratingPrefix) && why == "":
			if e.S.Reopen(id) == nil {
				back++
			}
		case r.Closed == "screened" && strings.HasPrefix(r.ClosedWhy, ratingPrefix) && why != r.ClosedWhy:
			e.S.CloseRole(id, "screened", why)
		}
	}
	if aside > 0 || back > 0 {
		e.S.Log(store.Activity{Kind: "tidied", Text: fmt.Sprintf("Employee ratings: %s set aside, %s back", countWord(aside, "role"), countWord(back, "role"))})
	}
	return aside, back
}

// lookUpRatings is the chore that looks up, now and then, what employees say
// about the employer of a role worth a look. At most one at a time, one every
// twenty minutes, ten a day; never while searching or while Claude rests.
func (e *Engine) lookUpRatings(now time.Time) {
	if e.SearchSet().RatingsOff || !e.canSearchWeb() || e.Busy("search") || e.Busy("ratings") || e.heldBack("ratings") {
		return
	}
	if rest, _, _ := e.meter.Resting(); rest {
		return
	}
	day := "ratings:" + now.Format("2006-01-02")
	if e.S.GetInt(day) >= 10 || now.Unix()-e.S.GetInt("chore:ratings") < 20*60 {
		return
	}
	id := e.nextToRate(now)
	if id == 0 {
		return
	}
	e.S.Set("chore:ratings", now.Unix())
	e.S.Set(day, e.S.GetInt(day)+1)
	e.S.Set(fmt.Sprintf("ratingtried:%d", id), now.Unix())
	c, err := e.S.Company(id)
	if err != nil {
		return
	}
	e.Go("ratings", "Looking up what employees say about "+c.Name, func(ctx context.Context) error {
		if err := e.lookUpReviews(ctx, id); err != nil {
			trace.Log("search", "rating for %s not found: %v", c.Name, err)
			if stopsWork(err) {
				return err
			}
		}
		return nil
	})
}

// nextToRate picks the employer of the strongest open role worth a look that
// has never been looked up, and wasn't tried in the last month.
func (e *Engine) nextToRate(now time.Time) int64 {
	rows, _ := e.S.Pairs(`SELECT '', r.company_id FROM roles r JOIN companies c ON c.id = r.company_id
		WHERE r.closed = '' AND r.stage IN ('found','ready','applied','reply','interview','offer') AND c.state != 'muted'
		AND NOT EXISTS (SELECT 1 FROM kv WHERE kv.k = 'coreviews:' || r.company_id)
		GROUP BY r.company_id ORDER BY MAX(r.fit) DESC LIMIT 40`)
	for _, r := range rows {
		if now.Unix()-e.S.GetInt(fmt.Sprintf("ratingtried:%d", r.N)) > 30*86400 {
			return int64(r.N)
		}
	}
	return 0
}

// ---- old matches ---------------------------------------------------------------------

// clearUnacted sets aside the roles nobody acted on in the days the person
// chose. Roles with documents, saved, saved for later, applied to or added by
// the person stay; nothing is deleted.
func (e *Engine) clearUnacted(now time.Time) int {
	days := e.SearchSet().ClearDays
	if days <= 0 {
		return 0
	}
	n, err := e.S.SetAsideUnacted(now.Add(-time.Duration(days)*24*time.Hour).Unix(), fmt.Sprintf("Nothing done with it for %d days", days))
	if err != nil {
		trace.Log("problem", "setting aside old roles: %v", err)
		return 0
	}
	if n > 0 {
		e.S.Log(store.Activity{Kind: "tidied", Text: fmt.Sprintf("Set aside %s you hadn't acted on in %d days. They are under Roles, Set aside.", countWord(n, "role"), days)})
	}
	return n
}

// ---- budget mode -----------------------------------------------------------------------

const (
	budgetKey = "budget:held"
	// budgetBatch is the most new postings read at once in budget mode; a
	// bigger batch waits for the night.
	budgetBatch = 12
	nightFrom   = 1 // the night's reading starts at 01:00
	nightTo     = 6
)

// BudgetHold is a batch of postings kept for the night.
type BudgetHold struct {
	Since int64 `json:"since,omitempty"`
	RunAt int64 `json:"run_at,omitempty"`
}

// BudgetView is what the pages show of budget mode.
type BudgetView struct {
	On      bool  `json:"on"`
	Waiting int   `json:"waiting"` // postings waiting to be read
	RunAt   int64 `json:"run_at"`  // when they will be; 0 when nothing waits
}

func (e *Engine) budgetHold() BudgetHold {
	var h BudgetHold
	e.S.Get(budgetKey, &h)
	return h
}

func night(t time.Time) bool { return t.Hour() >= nightFrom && t.Hour() < nightTo }

// nextNight is when the night's reading starts.
func nextNight(t time.Time) time.Time {
	if night(t) {
		return t
	}
	n := time.Date(t.Year(), t.Month(), t.Day(), nightFrom, 0, 0, 0, t.Location())
	if !n.After(t) {
		n = n.AddDate(0, 0, 1)
	}
	return n
}

// budgetHolds reports whether reading should wait: budget mode is on and a
// batch is already waiting, or this one is too big for the day. The wait ends
// at a set moment, so a computer that slept through the night reads it on
// waking.
func (e *Engine) budgetHolds(n int) bool {
	now := e.Now()
	h := e.budgetHold()
	if !e.SearchSet().Budget {
		return false
	}
	if h.RunAt > 0 {
		if now.Unix() < h.RunAt {
			return true
		}
		e.S.Set(budgetKey, BudgetHold{}) // the night came
		return false
	}
	if n <= budgetBatch || night(now) {
		return false
	}
	at := nextNight(now)
	e.S.Set(budgetKey, BudgetHold{Since: now.Unix(), RunAt: at.Unix()})
	e.S.Log(store.Activity{Kind: "search", Text: fmt.Sprintf("Budget mode: %s wait to be read at %s", countWord(n, "new posting"), at.Format("15:04"))})
	e.S.Changed("status", "radar")
	return true
}

// Budget says what waits for the night.
func (e *Engine) Budget() BudgetView {
	h := e.budgetHold()
	v := BudgetView{On: e.SearchSet().Budget}
	if h.RunAt > 0 {
		v.RunAt = h.RunAt
		v.Waiting = e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`)
	}
	return v
}

// RunBudgetNow reads what waits for the night now.
func (e *Engine) RunBudgetNow() error {
	if e.LLM().Engine == "" {
		return errors.New("connect Claude first")
	}
	e.S.Set(budgetKey, BudgetHold{})
	e.Resume("read")
	e.Go("read", "Reading new roles", func(ctx context.Context) error {
		for ctx.Err() == nil && e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`) > 0 {
			before := e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`)
			e.ReadUnread(ctx)
			if e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`) >= before {
				break // nothing more can be read now
			}
		}
		return nil
	})
	e.S.Changed("status", "radar")
	return nil
}

// CancelBudget drops the batch waiting for the night: its postings are set
// aside unread, with the reason, and can be brought back one by one.
func (e *Engine) CancelBudget() (int, error) {
	if e.budgetHold().RunAt == 0 {
		return 0, nil
	}
	e.S.Set(budgetKey, BudgetHold{})
	n, err := e.S.SetAsideUnread("Not read: you cancelled the night's reading")
	if err == nil && n > 0 {
		e.S.Log(store.Activity{Kind: "tidied", Text: fmt.Sprintf("You cancelled the night's reading: %s set aside unread", countWord(n, "posting"))})
	}
	e.S.Changed("status", "radar")
	return n, err
}
