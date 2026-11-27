package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"jobhunt/internal/trace"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/llm"
	"jobhunt/internal/office"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// ---- employers ------------------------------------------------------------------

// SeedEmployers asks which employers hire people like this person, adds them
// to the watch list, and works out where each posts its jobs.
func (e *Engine) SeedEmployers(ctx context.Context, n int) error {
	have, _ := e.S.Companies("following", "suggested", "muted")
	var names []string
	for _, c := range have {
		names = append(names, c.Name)
	}
	list, err := e.brain.Employers(ctx, e.Person(), names, n)
	if err != nil {
		return err
	}
	e.seeded()
	added := 0
	for _, emp := range list {
		if strings.TrimSpace(emp.Name) == "" {
			continue
		}
		_, isNew, err := e.S.UpsertCompany(store.Company{Name: emp.Name, Site: cleanSite(emp.Site), Sector: emp.Sector, Why: emp.Why, About: strings.TrimSpace(emp.About), AboutFrom: fromIf(emp.About, "claude"), State: "following", Source: "proposed"})
		if err == nil && isNew {
			added++
		}
	}
	if added > 0 {
		e.S.Log(store.Activity{Kind: "employers", Text: fmt.Sprintf("Added %d employers that hire people like you", added)})
	}
	e.DetectBoards(ctx)
	e.DescribeEmployers(ctx)
	return nil
}

func cleanSite(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		s = "https://" + s
	}
	return strings.TrimRight(s, "/")
}

// DetectBoards works out where each watched employer posts its jobs, for
// those not checked in the last week.
func (e *Engine) DetectBoards(ctx context.Context) {
	companies, _ := e.S.Companies("following")
	weekAgo := e.Now().Add(-7 * 24 * time.Hour).Unix()
	for _, c := range companies {
		if ctx.Err() != nil {
			return
		}
		if c.BoardKind != "" || c.BoardCheckedAt > weekAgo {
			continue
		}
		e.DetectBoard(ctx, c.ID)
	}
}

func fromIf(text, from string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}
	return from
}

// DescribeEmployers fills in what watched employers do, for the ones nobody
// has described yet. Each is asked about once: an employer Claude cannot
// place is marked so, and gets its description from its first posting instead.
func (e *Engine) DescribeEmployers(ctx context.Context, ids ...int64) error {
	if e.LLM().Engine == "" {
		return nil
	}
	var todo []store.Company
	if len(ids) > 0 {
		for _, id := range ids {
			if c, err := e.S.Company(id); err == nil && c.About == "" {
				todo = append(todo, c)
			}
		}
	} else {
		all, _ := e.S.Companies("following")
		for _, c := range all {
			if c.About == "" && c.AboutFrom == "" {
				todo = append(todo, c)
			}
		}
	}
	p := e.S.Profile()
	place := strings.TrimSpace(p.City + " " + p.Country)
	for len(todo) > 0 && ctx.Err() == nil {
		batch := todo[:min(len(todo), 20)]
		todo = todo[len(batch):]
		refs := make([]brain.EmployerRef, len(batch))
		for i, c := range batch {
			refs[i] = brain.EmployerRef{Name: c.Name, Site: c.Site, Sector: c.Sector}
		}
		got, err := e.brain.AboutEmployers(ctx, place, refs)
		if err != nil {
			return err
		}
		for _, c := range batch {
			// Read it again: a posting may have described it meanwhile.
			now, err := e.S.Company(c.ID)
			if err != nil || now.About != "" {
				continue
			}
			if a := got[store.NormName(c.Name)]; a != "" {
				now.About, now.AboutFrom = a, "claude"
			} else {
				now.AboutFrom = "unknown"
			}
			e.S.SaveCompany(now)
		}
	}
	return ctx.Err()
}

// DetectBoard looks for one employer's public job board.
func (e *Engine) DetectBoard(ctx context.Context, id int64) error {
	c, err := e.S.Company(id)
	if err != nil {
		return err
	}
	cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	b, derr := e.Src.Detect(cctx, c.Name, c.Site)
	c.BoardCheckedAt = e.Now().Unix()
	switch {
	case derr == nil:
		c.BoardKind, c.BoardToken, c.BoardNote = b.Kind, b.Token, ""
	case errors.Is(derr, sources.ErrNoBoard):
		c.BoardNote = "No public job board found; watched through LinkedIn"
		// Not on a job system Job Hunt knows: its own careers page may still
		// list its openings plainly enough to read.
		if pb, _, perr := e.Src.DetectPage(cctx, c.Site); perr == nil {
			c.BoardKind, c.BoardToken, c.BoardNote = pb.Kind, pb.Token, ""
		}
	default:
		c.BoardNote = "Couldn't check its careers page; watched through LinkedIn"
	}
	return e.S.SaveCompany(c)
}

// KnownBoard reports whether an address is a page of a job system Job Hunt
// reads directly, which needs no looking at to be sure.
func KnownBoard(raw string) bool {
	_, ok := sources.ParseBoardURL(raw)
	return ok
}

// SetBoardFromURL lets the person paste an employer's careers page. A page on
// a job system Job Hunt knows is read through that system; any other page is
// read as it stands, if it shows postings.
func (e *Engine) SetBoardFromURL(id int64, raw string) error {
	c, err := e.S.Company(id)
	if err != nil {
		return err
	}
	b, ok := sources.ParseBoardURL(raw)
	if !ok {
		addr, public := sources.PublicURL(raw)
		if !public {
			return errors.New("that is not a web address Job Hunt can open")
		}
		ctx, cancel := context.WithTimeout(e.ctx, 75*time.Second)
		defer cancel()
		posts, rerr := e.Src.ReadSite(ctx, sources.Site{URL: addr, Board: true}, "", "")
		if rerr != nil || len(posts) == 0 {
			return errors.New("Job Hunt could not find any postings on that page. Paste the page that lists the openings themselves. The employer is still watched through LinkedIn")
		}
		b = sources.Board{Kind: "page", Token: addr}
	}
	c.BoardKind, c.BoardToken, c.BoardNote, c.BoardCheckedAt = b.Kind, b.Token, "", e.Now().Unix()
	return e.S.SaveCompany(c)
}

// ---- searching ------------------------------------------------------------------

// SearchState is remembered between searches.
type SearchState struct {
	LastFull      int64  `json:"last_full"`
	LastFast      int64  `json:"last_fast"`
	LinkedInUntil int64  `json:"linkedin_until"` // LinkedIn asked us to slow down until then
	LinkedInNote  string `json:"linkedin_note"`
	// LinkedInStrikes: how many times in a row LinkedIn asked to slow down.
	// Each one makes the next rest longer and the searches fewer.
	LinkedInStrikes int  `json:"linkedin_strikes,omitempty"`
	Paused          bool `json:"paused"`
	// PausedUntil: the pause ends by itself then; 0 for until the person says.
	PausedUntil int64 `json:"paused_until"`
	// LinkedInTurn: which title in which place LinkedIn is asked about next,
	// when they do not all fit in one search.
	LinkedInTurn int `json:"linkedin_turn,omitempty"`
}

// slowDown reports whether a source answered that it is asked too often.
func slowDown(err error) bool {
	var he *sources.HTTPError
	return errors.As(err, &he) && (he.Status == 429 || he.Status == 999)
}

// AfterUpdate puts right, once, what earlier versions left behind: a rest
// LinkedIn asked for while it went through the VPN (it goes directly again),
// and the rests of Adzuna and Indeed, whose reasons were misjudged.
func (e *Engine) AfterUpdate() {
	var done bool
	if e.S.Get("fixed_65", &done); !done {
		e.asideElsewhere()
		e.S.Set("fixed_65", true)
	}
	if e.S.Get("fixed_61", &done); done {
		return
	}
	if st := e.searchState(); st.LinkedInUntil > e.Now().Unix() && e.offVPNByItself("linkedin") {
		st.LinkedInUntil, st.LinkedInNote, st.LinkedInStrikes = 0, "", 0
		e.S.Set("search", st)
	}
	for _, id := range []string{"adzuna", "indeed"} {
		e.setSourceState(id, func(s *SourceState) { s.Error, s.ErrorAt, s.RestUntil = "", 0, 0 })
	}
	e.S.Set("fixed_61", true)
}

// asideElsewhere sets aside the roles a search brought back from another
// city before Job Hunt checked for that. Only roles the person hasn't touched:
// nothing prepared, saved, applied to or added by them.
func (e *Engine) asideElsewhere() {
	p := e.S.Profile()
	rows, _ := e.S.Pairs(`SELECT '', id FROM roles WHERE closed = '' AND stage IN ('new', 'found') AND saved = 0 AND fit_tailored < 0
		AND source NOT IN ('manual', 'extension', 'lead', 'mail')`)
	n := 0
	for _, row := range rows {
		r, err := e.S.Role(int64(row.N))
		if err != nil || placeOK(p, r.Location, r.Workplace) || !otherMarket(p, r.Location, r.Workplace) {
			continue
		}
		if e.S.CloseRole(r.ID, "screened", "Based somewhere else") == nil {
			n++
		}
	}
	if n > 0 {
		trace.Log("did", "set aside %d roles based in another city", n)
	}
}

func (e *Engine) searchState() SearchState {
	var st SearchState
	e.S.Get("search", &st)
	return st
}

func (e *Engine) Paused() bool {
	st := e.searchState()
	if st.Paused && st.PausedUntil > 0 && e.Now().Unix() >= st.PausedUntil {
		e.SetPaused(false) // a pause for a set time is over
		return false
	}
	return st.Paused
}

// PausedUntil is when a pause for a set time ends; 0 when there is none.
func (e *Engine) PausedUntil() int64 {
	if st := e.searchState(); st.Paused {
		return st.PausedUntil
	}
	return 0
}

// PauseFor pauses searching for a number of days (a holiday, an exam week).
func (e *Engine) PauseFor(days int) {
	st := e.searchState()
	st.Paused, st.PausedUntil = true, 0
	if days > 0 {
		st.PausedUntil = e.Now().Add(time.Duration(days) * 24 * time.Hour).Unix()
	}
	e.S.Set("search", st)
	e.S.Changed("status")
}

// SetPaused switches all automatic searching on or off.
func (e *Engine) SetPaused(p bool) {
	st := e.searchState()
	st.Paused, st.PausedUntil = p, 0
	e.S.Set("search", st)
	e.S.Changed("status")
}

// RunStats is what one search did.
type RunStats struct {
	Kind      string            `json:"kind"`
	Looked    int               `json:"looked"`     // places looked at
	Seen      int               `json:"seen"`       // postings seen
	New       int               `json:"new"`        // not seen before
	Cleared   int               `json:"cleared"`    // set aside by the quick rules
	Read      int               `json:"read"`       // read against the CV
	Kept      int               `json:"kept"`       // worth a look
	Prepared  int               `json:"prepared"`   // documents made
	Gone      int               `json:"gone"`       // postings taken down
	Problems  []string          `json:"problems"`   // places that didn't answer
	ByPlace   map[string][2]int `json:"by_place"`   // place → seen, new
	ClearedBy map[string]int    `json:"cleared_by"` // reason → count
	// BySource is the same search seen by kind of source ("boards",
	// "linkedin", "jobbank", "freehire", "sites", "adzuna", "jooble",
	// "jsearch"): what Radar's list of sources is drawn from.
	BySource map[string]SourceRun `json:"by_source,omitempty"`

	// What was decided about each posting, by kind of source: kept apart
	// from the run (see keepOutcomes), as it can run to thousands.
	src, from string
	outcomes  map[string]*SourceLog
	// Roles set aside only for their title's wording: given a second look.
	titleAside []int64
}

// SourceRun is what one kind of source gave in one search.
type SourceRun struct {
	Looked int    `json:"looked"`          // places of this kind asked
	Seen   int    `json:"seen"`            // postings they showed
	New    int    `json:"new"`             // of those, not seen before
	Failed int    `json:"failed"`          // places that did not answer
	Error  string `json:"error,omitempty"` // the last one's reason, in plain words
}

// saw notes that one place of a kind answered.
func (st *RunStats) saw(kind string, seen, added int) {
	if st.BySource == nil {
		st.BySource = map[string]SourceRun{}
	}
	r := st.BySource[kind]
	r.Looked, r.Seen, r.New = r.Looked+1, r.Seen+seen, r.New+added
	st.BySource[kind] = r
}

// missed notes that one place of a kind did not answer, and why.
func (st *RunStats) missed(kind, why string) {
	if st.BySource == nil {
		st.BySource = map[string]SourceRun{}
	}
	r := st.BySource[kind]
	r.Looked, r.Failed, r.Error = r.Looked+1, r.Failed+1, why
	st.BySource[kind] = r
}

// StartSearch starts a search in the background. Kind is "full" or "fast",
// or "force": a full search the person asked for that ignores the schedule,
// looks back a week rather than to the last search, and then checks the
// roles set aside lately against the rules as they are now.
func (e *Engine) StartSearch(kind string) bool {
	doing := "Searching every source"
	if kind == "fast" {
		doing = "Checking for postings under an hour old"
	} else if kind == "force" {
		doing = "Searching every source, a week back"
	}
	return e.Go("search", doing, func(ctx context.Context) error {
		// Kept until the search ends by itself or the person stops it. If
		// the program stops first, the next start picks it up (resumeSearch).
		e.S.Set("search:open", kind)
		err := e.Search(ctx, kind)
		if e.ctx.Err() == nil {
			e.S.Set("search:open", "")
		}
		return err
	})
}

// Search looks for new postings, reads the ones that pass the quick rules,
// and prepares the strong ones.
func (e *Engine) Search(ctx context.Context, kind string) error {
	p := e.S.Profile()
	if !p.SetupDone {
		return nil
	}
	force := kind == "force"
	if force {
		kind = "full"
	}
	e.preparedNow.Store(0)
	runID := e.S.StartRun("search:" + kind)
	stats := RunStats{Kind: kind, ByPlace: map[string][2]int{}, ClearedBy: map[string]int{}}
	st := e.searchState()
	now := e.Now()
	var fresh []int64

	note := func(place string, seen, added int) {
		v := stats.ByPlace[place]
		stats.ByPlace[place] = [2]int{v[0] + seen, v[1] + added}
	}

	// LinkedIn is asked about every title in every place the person named,
	// up to its share of one search.
	places := searchedPlaces(p)
	liAll := titlesAt(p.Titles.All(), places)
	liAsk := turnOf(liAll, st.LinkedInTurn, linkedInShare(linkedInMost(kind, len(p.Titles.All()), len(places)), st.LinkedInStrikes))

	// 1. Employers' own boards: the earliest place a posting appears.
	companies, _ := e.S.Companies("following")
	// How many places there are to look at, for the progress bar.
	look, at := len(liAsk), 0
	for _, c := range companies {
		if c.BoardKind != "" && !(kind == "fast" && (c.BoardKind == "workday" || c.BoardKind == "page")) {
			look++
		}
	}
	if kind == "full" {
		look += 2
	}
	e.StepTakes(ctx, 4*time.Second)
	boardFailed, boardOK := map[int64]error{}, []int64{}
	for _, c := range companies {
		if ctx.Err() != nil {
			break
		}
		if c.BoardKind == "" {
			continue
		}
		// A fast pass only re-reads boards that are cheap to read whole.
		if kind == "fast" && (c.BoardKind == "workday" || c.BoardKind == "page") {
			continue
		}
		e.Report(ctx, at, look, c.Name)
		at++
		stats.Looked++
		stats.reading(srcBoards, c.Name)
		posts, err := e.listBoard(ctx, c, p)
		if err != nil && ctx.Err() == nil {
			boardFailed[c.ID] = err
		} else if err == nil {
			boardOK = append(boardOK, c.ID)
		}
		if err != nil {
			stats.Problems = append(stats.Problems, fmt.Sprintf("%s: %s", c.Name, plainErr(err)))
			stats.missed(srcBoards, fmt.Sprintf("%s: %s", c.Name, plainErr(err)))
			continue
		}
		open, _ := e.S.OpenRoleKeys(c.ID, c.BoardKind)
		added := 0
		for _, post := range posts {
			delete(open, post.Key)
			post.Company = c.Name
			id, isNew, cleared := e.ingest(c.ID, post, p, &stats)
			if isNew {
				added++
				if !cleared {
					fresh = append(fresh, id)
				}
			}
		}
		// Whatever was open and is no longer listed has been taken down.
		// Workday is searched by keyword, and a careers page read as it stands
		// may show only its first screen, so absence proves nothing there.
		if c.BoardKind != "workday" && c.BoardKind != "page" && len(posts) > 0 {
			for _, id := range open {
				e.S.MarkGone(id)
				stats.Gone++
			}
		}
		stats.Seen += len(posts)
		stats.saw(srcBoards, len(posts), added)
		note(c.Name, len(posts), added)
	}

	e.boardStrikes(boardFailed, boardOK)

	// 2. LinkedIn's public search: every title, step-up and sideways included,
	// each searched as often as the others.
	sinceLast := 26 * time.Hour
	if st.LastFull == 0 || force {
		sinceLast = 7 * 24 * time.Hour
	} else if d := now.Sub(time.Unix(st.LastFull, 0)) + 2*time.Hour; d > sinceLast {
		sinceLast = min(d, 14*24*time.Hour)
	}
	if e.placeSet().off("linkedin") {
		// Switched off by the person.
	} else if now.Unix() >= st.LinkedInUntil {
		within := sinceLast
		few := false
		if kind == "fast" {
			within, few = 2*time.Hour, true
		}
		blocked := false
		asked := 0
		for _, bt := range liAsk {
			if ctx.Err() != nil || blocked {
				break
			}
			e.Report(ctx, at, look, "LinkedIn: "+bt.label(places[0]))
			at++
			stats.Looked++
			asked++
			stats.reading("linkedin", bt.label(places[0]))
			liq := sources.Query{Keywords: bt.Title, Location: bt.At.Loc, Miles: metros[strings.ToLower(bt.At.Town)].Miles, Within: within, FewApplicants: few}
			posts, err := e.Src.Search(ctx, liq)
			if slowDown(err) && e.offVPNByItself("linkedin") {
				// It was the VPN server LinkedIn throttled: asked again directly.
				posts, err = e.Src.Search(ctx, liq)
			}
			if err != nil {
				var he *sources.HTTPError
				if errors.As(err, &he) && (he.Status == 429 || he.Status == 999 || he.Status == 403) {
					st.LinkedInStrikes = min(st.LinkedInStrikes+1, 5)
					rest := linkedInRestFor(st.LinkedInStrikes)
					st.LinkedInUntil = now.Add(rest).Unix()
					st.LinkedInNote = fmt.Sprintf("LinkedIn asked Job Hunt to slow down. It is left alone until %s, then asked about fewer titles at a time", now.Add(rest).Format("15:04"))
					stats.Problems = append(stats.Problems, st.LinkedInNote)
					stats.missed("linkedin", st.LinkedInNote)
					blocked = true
					continue
				}
				stats.Problems = append(stats.Problems, "LinkedIn, "+bt.label(places[0])+": "+plainErr(err))
				stats.missed("linkedin", "LinkedIn "+plainErr(err))
				continue
			}
			st.LinkedInNote = ""
			added := 0
			for _, post := range posts {
				if strings.TrimSpace(post.Company) == "" {
					continue
				}
				comp, _, err := e.S.UpsertCompany(store.Company{Name: post.Company, State: "suggested", Source: "posting"})
				if err != nil {
					continue
				}
				if comp.State == "muted" {
					stats.ClearedBy["An employer you muted"]++
					stats.Cleared++
					stats.decided(PostingOutcome{Title: post.Title, Company: comp.Name, Location: post.Location, Outcome: "skipped", Why: "An employer you muted"})
					continue
				}
				id, isNew, cleared := e.ingestBand(comp.ID, post, p, &stats, bt.Band)
				if isNew {
					added++
					if !cleared {
						fresh = append(fresh, id)
					}
				}
			}
			stats.Seen += len(posts)
			stats.saw("linkedin", len(posts), added)
			note("LinkedIn: "+bt.label(places[0]), len(posts), added)
			select {
			case <-ctx.Done():
			case <-time.After(e.linkedInPause()):
			}
		}
		if len(liAll) > 0 {
			st.LinkedInTurn = (st.LinkedInTurn + asked) % len(liAll)
		}
		// A round with no complaint earns back one step.
		if !blocked && asked > 0 && st.LinkedInStrikes > 0 {
			st.LinkedInStrikes--
		}
	} else {
		stats.Problems = append(stats.Problems, firstOf(st.LinkedInNote, "LinkedIn is resting"))
		stats.missed("linkedin", firstOf(st.LinkedInNote, "LinkedIn is resting"))
	}

	// 3. The other title searches, and the job sites and recruiters the person
	// has Job Hunt watch. Slower places: asked on full searches only.
	if kind == "full" && ctx.Err() == nil {
		e.StepTakes(ctx, 40*time.Second)
		e.Report(ctx, look-2, look, "Job Bank, FreeHire and the job sites you watch")
		e.searchPlaces(ctx, p, sinceLast, &stats, &fresh, note)
	}
	// 3b. The searches that take a key (Adzuna, Jooble, Google for Jobs), for
	// those who set one up. Each has a daily allowance, so a quick check asks
	// them sparingly, and only those that can be asked for today's postings.
	if ctx.Err() == nil {
		e.searchKeyed(ctx, kind, p, sinceLast, &stats, &fresh, note)
	}
	// 3c. Indeed through the person's Claude connector, on full searches.
	if kind == "full" && ctx.Err() == nil {
		e.searchIndeed(ctx, p, &stats, &fresh, note)
	}
	// Stopped part-way: the next search starts where a full one would.
	if ctx.Err() != nil {
		e.keepOutcomes(&stats)
		e.S.EndRun(runID, "stopped", stats, "You stopped it")
		return ctx.Err()
	}

	if kind == "full" {
		st.LastFull = now.Unix()
	}
	st.LastFast = now.Unix()
	paused := e.searchState().Paused
	st.Paused = paused
	e.S.Set("search", st)

	// 4. Read what is new, freshest first: being early matters more than
	// anything else Job Hunt does.
	stats.New = len(fresh) + stats.Cleared
	fresh = append(fresh, e.secondLook(ctx, p, &stats)...)
	// In budget mode a big batch stays unread until the night.
	if !e.budgetHolds(len(fresh)) {
		e.readAll(ctx, fresh, &stats)
	}

	state := "done"
	if ctx.Err() != nil {
		state = "stopped"
	}
	e.keepOutcomes(&stats)
	e.S.EndRun(runID, state, stats, strings.Join(stats.Problems, "\n"))
	if state == "done" {
		e.noteThin(stats)
	}
	if stats.Kept > 0 || kind == "full" {
		e.S.Log(store.Activity{Kind: "search", Text: fmt.Sprintf("Searched %d places: %d postings, %d new, %d worth a look", stats.Looked, stats.Seen, stats.New, stats.Kept)})
	}
	if force && ctx.Err() == nil {
		// Then what the rules set aside lately, against the rules as they are now.
		if _, err := e.ScoreAgain(ctx, false); err != nil && !errors.Is(err, context.Canceled) {
			e.problem("Scoring again", err)
		}
	}
	return nil
}

// linkedInMost is how many LinkedIn searches one search makes: every title,
// and, when the person named more places than their city, every title in
// every place up to a share LinkedIn puts up with. A quick check, which runs
// many times a day, takes half that share.
func linkedInMost(kind string, titles, places int) int {
	most := 24
	if kind == "fast" {
		most = 10
	}
	if places <= 1 {
		return titles
	}
	return max(titles, min(titles*places, most))
}

// linkedInShare cuts LinkedIn's share of a search after it has asked to slow
// down: half for each recent strike, never fewer than three.
func linkedInShare(n, strikes int) int {
	cut := n
	for range strikes {
		cut /= 2
	}
	return max(cut, min(3, n))
}

// linkedInRestFor is how long LinkedIn is left alone after the strikes so
// far: 2 hours, then 4, 8, 16, at most a day.
func linkedInRestFor(strikes int) time.Duration {
	return min(2*time.Hour<<max(strikes-1, 0), 24*time.Hour)
}

func (e *Engine) linkedInPause() time.Duration {
	if e.Src.Base != nil && e.Src.Base["linkedin"] != "" {
		return 0 // tests
	}
	return 4 * time.Second
}

func plainErr(err error) string {
	var he *sources.HTTPError
	switch {
	case errors.As(err, &he) && he.Status == 404:
		return "its job board has moved"
	case errors.As(err, &he):
		return fmt.Sprintf("didn't answer (%d)", he.Status)
	case errors.Is(err, context.DeadlineExceeded):
		return "took too long to answer"
	}
	s := err.Error()
	if i := strings.LastIndex(s, ": "); i >= 0 && len(s)-i < 80 {
		s = s[i+2:]
	}
	return s
}

func (e *Engine) listBoard(ctx context.Context, c store.Company, p store.Profile) ([]sources.Posting, error) {
	cctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	b := sources.Board{Kind: c.BoardKind, Token: c.BoardToken}
	if b.Kind != "workday" {
		return e.Src.List(cctx, b)
	}
	// Workday boards can hold thousands of postings; search them by the words
	// that mark this person's field instead of walking the whole board.
	words := p.Domain
	if len(words) == 0 {
		words = coreWords(p)
	}
	if len(words) > 4 {
		words = words[:4]
	}
	seen := map[string]bool{}
	var out []sources.Posting
	var firstErr error
	for _, w := range words {
		posts, err := e.Src.ListWorkday(cctx, b, w, 60)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, post := range posts {
			if !seen[post.Key] {
				seen[post.Key] = true
				out = append(out, post)
			}
		}
	}
	if len(out) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// ---- the quick rules ----------------------------------------------------------------

var generic = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`senior sr junior jr lead principal staff head chief vice president vp director manager associate assistant specialist analyst advisor adviser consultant officer coordinator administrator executive supervisor expert professional partner intern of the and for in at to a an i ii iii iv global regional national canada team group services service`) {
		generic[w] = true
	}
}

var tokenRe = regexp.MustCompile(`[a-z0-9+#]+`)

func tokens(s string) []string { return tokenRe.FindAllString(strings.ToLower(s), -1) }

// coreWords are the distinctive words of the titles the person wants.
func coreWords(p store.Profile) []string {
	seen := map[string]bool{}
	var out []string
	for _, bt := range p.Titles.All() {
		for _, w := range tokens(bt.Title) {
			if !generic[w] && len(w) > 2 && !seen[w] {
				seen[w] = true
				out = append(out, w)
			}
		}
	}
	return out
}

var juniorRe = regexp.MustCompile(`(?i)\b(intern|internship|co-?op|student|summer|apprentice|graduate program|new grad|trainee|entry[- ]level|volunteer)\b`)

// metro is a city together with the towns around it that are the same job
// market, so that "Toronto" means the Greater Toronto Area.
type metro struct {
	Towns  []string // a town marked ~ shares its name with places elsewhere and needs the region or country beside it
	Region []string // the province or state, as written in postings
	Miles  int      // how far LinkedIn's search should reach from the centre
}

var metros = map[string]metro{
	"toronto": {Miles: 35, Region: []string{"ontario", "on", "ont"}, Towns: []string{"toronto", "gta", "greater toronto", "greater toronto area", "north york", "etobicoke", "scarborough", "east york",
		"mississauga", "brampton", "caledon", "vaughan", "woodbridge", "thornhill", "markham", "unionville", "richmond hill", "~aurora", "~newmarket", "king city", "stouffville",
		"oakville", "~burlington", "~milton", "halton hills", "~georgetown", "pickering", "ajax", "whitby", "oshawa", "~concord", "york region", "peel region", "halton region", "durham region"}},
	"vancouver":     {Miles: 30, Region: []string{"british columbia", "bc"}, Towns: []string{"vancouver", "burnaby", "~richmond", "~surrey", "north vancouver", "west vancouver", "new westminster", "coquitlam", "port coquitlam", "port moody", "~delta", "~langley", "metro vancouver", "lower mainland"}},
	"montreal":      {Miles: 30, Region: []string{"quebec", "québec", "qc"}, Towns: []string{"montreal", "montréal", "laval", "longueuil", "brossard", "dorval", "pointe claire", "saint laurent", "greater montreal"}},
	"ottawa":        {Miles: 25, Region: []string{"ontario", "on"}, Towns: []string{"ottawa", "gatineau", "kanata", "nepean", "orleans"}},
	"calgary":       {Miles: 25, Region: []string{"alberta", "ab"}, Towns: []string{"calgary", "airdrie", "cochrane", "okotoks"}},
	"new york":      {Miles: 25, Region: []string{"new york", "ny"}, Towns: []string{"new york", "nyc", "manhattan", "brooklyn", "queens", "bronx", "jersey city", "hoboken"}},
	"london":        {Miles: 25, Towns: []string{"london", "greater london", "city of london", "westminster", "canary wharf", "croydon", "stratford"}},
	"edmonton":      {Miles: 25, Region: []string{"alberta", "ab"}, Towns: []string{"edmonton", "st albert", "sherwood park", "~leduc", "spruce grove", "nisku"}},
	"winnipeg":      {Miles: 20, Region: []string{"manitoba", "mb"}, Towns: []string{"winnipeg", "~selkirk", "~steinbach"}},
	"halifax":       {Miles: 20, Region: []string{"nova scotia", "ns"}, Towns: []string{"halifax", "dartmouth", "bedford", "sackville"}},
	"hamilton":      {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"hamilton", "~burlington", "stoney creek", "ancaster", "dundas", "grimsby"}},
	"kitchener":     {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"kitchener", "waterloo", "cambridge", "guelph", "region of waterloo", "waterloo region"}},
	"waterloo":      {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"waterloo", "kitchener", "cambridge", "guelph", "region of waterloo", "waterloo region"}},
	"victoria":      {Miles: 20, Region: []string{"british columbia", "bc"}, Towns: []string{"victoria", "saanich", "esquimalt", "langford", "oak bay"}},
	"quebec":        {Miles: 20, Region: []string{"quebec", "québec", "qc"}, Towns: []string{"quebec city", "québec city", "ville de québec", "lévis", "levis", "sainte foy"}},
	"san francisco": {Miles: 35, Region: []string{"california", "ca"}, Towns: []string{"san francisco", "bay area", "sf", "oakland", "berkeley", "san mateo", "redwood city", "palo alto", "mountain view", "menlo park", "south san francisco", "emeryville"}},
	"los angeles":   {Miles: 35, Region: []string{"california", "ca"}, Towns: []string{"los angeles", "la", "santa monica", "pasadena", "burbank", "glendale", "culver city", "long beach", "irvine", "el segundo"}},
	"chicago":       {Miles: 30, Region: []string{"illinois", "il"}, Towns: []string{"chicago", "evanston", "oak brook", "schaumburg", "naperville", "deerfield"}},
	"boston":        {Miles: 25, Region: []string{"massachusetts", "ma"}, Towns: []string{"boston", "cambridge", "somerville", "waltham", "quincy", "newton", "burlington"}},
	"seattle":       {Miles: 25, Region: []string{"washington", "wa"}, Towns: []string{"seattle", "bellevue", "redmond", "kirkland", "tacoma", "everett"}},
	"dubai":         {Miles: 30, Region: []string{"united arab emirates", "uae"}, Towns: []string{"dubai", "sharjah", "jebel ali", "difc"}},
	"sydney":        {Miles: 30, Region: []string{"new south wales", "nsw"}, Towns: []string{"sydney", "north sydney", "parramatta", "macquarie park", "chatswood"}},
	"melbourne":     {Miles: 30, Region: []string{"victoria", "vic"}, Towns: []string{"melbourne", "southbank", "docklands", "richmond", "st kilda"}},
	"singapore":     {Miles: 20, Towns: []string{"singapore"}},
	"dublin":        {Miles: 20, Region: []string{"ireland", "county dublin"}, Towns: []string{"dublin", "dún laoghaire", "dun laoghaire", "sandyford", "swords", "blanchardstown"}},
	"st catharines": {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"st catharines", "niagara falls", "welland", "thorold", "grimsby", "niagara on the lake", "niagara region"}},
	"windsor":       {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"windsor", "lasalle", "tecumseh"}},
	"kingston":      {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"kingston"}},
	"barrie":        {Miles: 20, Region: []string{"ontario", "on"}, Towns: []string{"barrie", "innisfil", "orillia"}},
	"manchester":    {Miles: 20, Region: []string{"greater manchester"}, Towns: []string{"manchester", "salford", "stockport", "trafford", "oldham"}},
}

var placeSplit = strings.NewReplacer(",", " ", "(", " ", ")", " ", "-", " ", "/", " ", ".", " ", ";", " ", "|", " ", "·", " ")

// placeWords pads a place with spaces so that whole names can be looked for.
func placeWords(s string) string {
	return " " + strings.Join(strings.Fields(placeSplit.Replace(strings.ToLower(s))), " ") + " "
}

func cityOf(p store.Profile) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(p.City, ",")[0]))
}

// Area lists the places that count as the person's city, for showing them.
func Area(p store.Profile) []string {
	var out []string
	for _, t := range metros[cityOf(p)].Towns {
		t = strings.TrimPrefix(t, "~")
		if t == cityOf(p) || strings.Contains(t, "region") || strings.Contains(t, "greater") || len(t) <= 3 {
			continue
		}
		words := strings.Fields(t)
		for i, w := range words {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
		out = append(out, strings.Join(words, " "))
	}
	return out
}

// placeOK reports whether a posting's location is somewhere the person will be.
func placeOK(p store.Profile, location, workplace string) bool {
	loc := strings.ToLower(location)
	if strings.TrimSpace(loc) == "" {
		return true // unknown: let the reading decide
	}
	city := cityOf(p)
	if city == "" {
		return true
	}
	padded := placeWords(loc)
	has := func(name string) bool { return strings.Contains(padded, placeWords(name)) }
	country := strings.ToLower(strings.TrimSpace(p.Country))
	m, known := metros[city]
	if !known {
		m.Towns = []string{city}
	}
	inRegion := country != "" && has(country)
	for _, r := range m.Region {
		inRegion = inRegion || has(r)
	}
	for _, t := range m.Towns {
		if name := strings.TrimPrefix(t, "~"); has(name) && (name == t || inRegion) {
			return true
		}
	}
	// Places the person added themselves.
	for _, t := range p.Places {
		if t = strings.TrimSpace(t); t != "" && has(t) {
			return true
		}
	}
	// What is left once the province, the country and the words about
	// working from home are taken away. Nothing left means the posting names
	// no town: "Ontario, Canada", "Remote - Canada", "Canada".
	rest := padded
	for _, w := range append([]string{country, "remote", "hybrid", "anywhere", "work from home", "wfh", "in", "within", "area", "province", "state"}, m.Region...) {
		if w != "" {
			rest = strings.ReplaceAll(rest, placeWords(w), " ")
		}
	}
	bare := strings.TrimSpace(rest) == ""
	remote := workplace == "remote" || has("remote") || has("anywhere") || has("work from home")
	if remote {
		// Remote in the person's country or province, or with no place given.
		return country == "" || inRegion || bare
	}
	// A province or country alone means "somewhere in it".
	return bare && inRegion
}

// otherMarket reports whether a location names a city that is another job
// market than the person's (Ottawa, for someone in Toronto). A town Job Hunt
// doesn't know is not counted: it may be next door. A remote role is never
// elsewhere: where its employer sits doesn't matter.
func otherMarket(p store.Profile, location, workplace string) bool {
	city := cityOf(p)
	if city == "" || strings.TrimSpace(location) == "" || workplace == "remote" {
		return false
	}
	padded := placeWords(location)
	if strings.Contains(padded, " remote ") {
		return false
	}
	mine := map[string]bool{city: true}
	for _, t := range metros[city].Towns {
		mine[strings.TrimPrefix(t, "~")] = true
	}
	for key, m := range metros {
		if key == city {
			continue
		}
		for _, t := range append([]string{key}, m.Towns...) {
			if strings.HasPrefix(t, "~") || len(t) <= 3 || mine[t] || strings.Contains(t, "region") || strings.Contains(t, "greater") {
				continue
			}
			if strings.Contains(padded, placeWords(t)) {
				return true
			}
		}
	}
	return false
}

// titleOK reports whether a title could be a job this person wants, and the
// band of the wanted title it matched.
func titleOK(p store.Profile, title string) (bool, string) {
	have := map[string]bool{}
	for _, w := range tokens(title) {
		have[w] = true
		// plural and singular count as the same word
		have[strings.TrimSuffix(w, "s")] = true
	}
	best, bestBand := 0.0, ""
	for _, bt := range p.Titles.All() {
		var core []string
		for _, w := range tokens(bt.Title) {
			if !generic[w] && len(w) > 2 {
				core = append(core, w)
			}
		}
		if len(core) == 0 {
			continue
		}
		n := 0
		for _, w := range core {
			if have[w] || have[strings.TrimSuffix(w, "s")] {
				n++
			}
		}
		// Between wanted titles that match equally, the one whose level
		// words (manager, director, lead) also appear wins the band.
		level := 0
		for _, w := range tokens(bt.Title) {
			if generic[w] && len(w) > 3 && have[w] {
				level++
			}
		}
		if score := float64(n)/float64(len(core)) + 0.01*float64(level); score > best {
			best, bestBand = score, bt.Band
		}
	}
	if best >= 0.6 {
		return true, bestBand
	}
	for _, d := range p.Domain {
		d = strings.ToLower(strings.TrimSpace(d))
		if d != "" && (have[d] || have[strings.TrimSuffix(d, "s")] || (len(d) > 4 && strings.Contains(strings.ToLower(title), d))) {
			return true, bestBand
		}
	}
	return false, ""
}

// screen applies the rules that need no reading. It returns "" to keep a
// posting, or the reason it is set aside.
func screen(p store.Profile, post sources.Posting, searched bool) (reason, band string) {
	title := post.Title
	low := strings.ToLower(title)
	for _, a := range p.Avoid {
		if a = strings.ToLower(strings.TrimSpace(a)); a != "" && (strings.Contains(low, a) || strings.Contains(strings.ToLower(post.Company), a)) {
			return "On your never-show list", ""
		}
	}
	if juniorRe.MatchString(title) {
		return "Student or entry-level role", ""
	}
	ok, band := titleOK(p, title)
	if !ok {
		return titleAside, ""
	}
	// A search for the person's city can still bring back roles elsewhere
	// (a site's wide radius, or its guess at what was meant): those that name
	// another city are set aside too.
	if !placeOK(p, post.Location, post.Workplace) && (!searched || otherMarket(p, post.Location, post.Workplace)) {
		return "Based somewhere else", band
	}
	if len(p.Workplaces) > 0 && post.Workplace != "" {
		found := false
		for _, w := range p.Workplaces {
			if w == post.Workplace {
				found = true
			}
		}
		if !found {
			return "Not a way of working you chose (" + post.Workplace + ")", band
		}
	}
	if p.PayStrict && p.PayFloor > 0 {
		if payBelow(p, post.Pay) {
			return "Pays under your floor", band
		}
	}
	if p.MaxAgeDays > 0 && !post.PostedAt.IsZero() && time.Since(post.PostedAt) > time.Duration(p.MaxAgeDays)*24*time.Hour {
		return fmt.Sprintf("Posted more than %d days ago", p.MaxAgeDays), band
	}
	if len(p.NoTypes) > 0 {
		kind := strings.ToLower(JobType(post.Title, post.Description))
		for _, t := range p.NoTypes {
			if t = strings.ToLower(strings.TrimSpace(t)); t != "" && strings.HasPrefix(kind, t) {
				return "A kind of job you ruled out (" + t + ")", band
			}
		}
	}
	return "", band
}

func (e *Engine) ingest(companyID int64, post sources.Posting, p store.Profile, stats *RunStats) (int64, bool, bool) {
	return e.ingestBand(companyID, post, p, stats, "")
}

// ingest records a posting if it is new. It reports the role's id, whether it
// was new, and whether the quick rules set it aside.
func (e *Engine) ingestBand(companyID int64, post sources.Posting, p store.Profile, stats *RunStats, searchedBand string) (int64, bool, bool) {
	if post.Pay == "" {
		// Most sources give no pay of their own; many postings name it in their text.
		post.Pay = PayFromText(post.Description)
	}
	e.noteEmployerLooks(companyID, post)
	seenAs := PostingOutcome{Title: post.Title, Company: post.Company, Location: post.Location}
	if id, _, seen := e.S.SeenRole(post.Key); seen {
		e.S.TouchRole(id, post.Applicants, post.Description)
		seenAs.RoleID, seenAs.Outcome = id, "here"
		stats.decided(seenAs)
		return id, false, false
	}
	// The same job seen through another place is the same role; and a role
	// the person said no to stays said no to, however it reappears.
	if id, closed, dup := e.S.SimilarRole(companyID, post.Title, post.Location); dup {
		seenAs.RoleID, seenAs.Outcome = id, "here"
		if closed == "no" {
			stats.Cleared++
			stats.ClearedBy["You said no to this one before"]++
			seenAs.Outcome, seenAs.Why = "skipped", "You said no to this one before"
		}
		e.S.TouchRole(id, post.Applicants, "")
		e.S.SeenThrough(id, post.Source) // for the overlap between sources, on Progress
		stats.decided(seenAs)
		return id, false, false
	}
	reason, band := screen(p, post, searchedBand != "")
	if reason == "" {
		reason = e.ratingAside(companyID, post.Company)
	}
	if band == "" {
		band = searchedBand
	}
	r := store.Role{
		CompanyID: companyID, Key: post.Key, Source: post.Source, Title: post.Title, Location: post.Location,
		Workplace: post.Workplace, Pay: post.Pay, URL: post.URL, ApplyURL: post.ApplyURL, Description: post.Description,
		Applicants: post.Applicants, Band: band,
	}
	if !post.PostedAt.IsZero() {
		r.PostedAt = post.PostedAt.Unix()
	}
	if reason != "" {
		r.Closed, r.ClosedWhy = "screened", reason
		if reason != titleAside {
			r.Description = "" // not kept for roles nobody will look at
		}
	}
	id, err := e.S.AddRole(r)
	if err != nil {
		return 0, false, false
	}
	seenAs.RoleID = id
	if reason == titleAside {
		stats.titleAside = append(stats.titleAside, id)
	}
	if reason != "" {
		stats.Cleared++
		stats.ClearedBy[reason]++
		seenAs.Outcome, seenAs.Why = "skipped", reason
		stats.decided(seenAs)
		return id, true, true
	}
	seenAs.Outcome = "new"
	stats.decided(seenAs)
	return id, true, false
}

// ---- reading and preparing ---------------------------------------------------------------

func (e *Engine) readAll(ctx context.Context, ids []int64, stats *RunStats) {
	if len(ids) == 0 {
		return
	}
	// Freshest first.
	type aged struct {
		id  int64
		age int64
	}
	var list []aged
	for _, id := range ids {
		if r, err := e.S.Role(id); err == nil {
			list = append(list, aged{id, r.Age()})
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].age > list[j].age })

	// With grouped scoring on, a few postings go to Claude in one request.
	size := 1
	if e.LLM().Grouped {
		size = brain.GroupSize
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	work := make(chan []int64)
	readDone := 0
	e.StepTakes(ctx, 8*time.Second)
	e.Report(ctx, 0, len(list), fmt.Sprintf("Reading %s against your CV", countWord(len(list), "new role")))
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for chunk := range work {
				stop := false
				for _, res := range e.readGroup(ctx, chunk) {
					mu.Lock()
					readDone++
					e.Report(ctx, readDone, len(list), fmt.Sprintf("Read %d of %d new roles", readDone, len(list)))
					if res.err == nil {
						stats.Read++
						if res.kept {
							stats.Kept++
						}
						if res.prepared {
							stats.Prepared++
						}
					}
					mu.Unlock()
					if res.err != nil && !errors.Is(res.err, context.Canceled) {
						e.problem("Reading new roles", res.err)
						stop = stop || stopsWork(res.err)
					}
				}
				if stop {
					return
				}
			}
		}()
	}
	for i := 0; i < len(list); i += size {
		if ctx.Err() != nil {
			break
		}
		if rest, _, _ := e.meter.Resting(); rest {
			break
		}
		var chunk []int64
		for _, a := range list[i:min(i+size, len(list))] {
			chunk = append(chunk, a.id)
		}
		work <- chunk
	}
	close(work)
	// Workers that returned early leave ids unread; they stay at stage "new"
	// and are picked up by the next pass.
	go func() {
		for range work {
		}
	}()
	wg.Wait()
}

type readResult struct {
	kept, prepared bool
	err            error
}

// readGroup reads a few roles. One role is read on its own; several are read
// in one request, and one by one if that request's answer doesn't fit them.
func (e *Engine) readGroup(ctx context.Context, ids []int64) []readResult {
	out := make([]readResult, len(ids))
	if len(ids) == 1 {
		k, p, err := e.ReadRole(ctx, ids[0])
		out[0] = readResult{k, p, err}
		return out
	}
	var ready []store.Role
	var at []int
	for i, id := range ids {
		r, ok, kept, err := e.textToRead(ctx, id, false)
		if !ok {
			out[i] = readResult{kept: kept, err: err}
			continue
		}
		ready, at = append(ready, r), append(at, i)
	}
	if len(ready) == 0 {
		return out
	}
	p := e.Person()
	if len(p.CVs) == 0 {
		for _, i := range at {
			out[i].err = errors.New("add a CV first")
		}
		return out
	}
	posts := make([]brain.Posting, len(ready))
	for i, r := range ready {
		posts[i] = e.postingToRead(r)
	}
	var readings []brain.Reading
	var err error
	if len(ready) > 1 {
		readings, err = e.brain.ReadRoles(ctx, p, posts)
	}
	if len(ready) == 1 || (err != nil && !stopsWork(err) && ctx.Err() == nil) {
		if err != nil {
			trace.Log("search", "grouped reading of %d roles failed, reading them one by one: %v", len(ready), err)
		}
		readings, err = make([]brain.Reading, len(ready)), nil
		for j, r := range ready {
			rd, rerr := e.brain.ReadRole(ctx, p, posts[j])
			if rerr != nil {
				out[at[j]].err = rerr
				if stopsWork(rerr) || ctx.Err() != nil {
					return out
				}
				continue
			}
			k, pr, terr := e.takeReading(ctx, r, rd, false)
			out[at[j]] = readResult{k, pr, terr}
		}
		return out
	}
	if err != nil {
		for _, i := range at {
			out[i].err = err
		}
		return out
	}
	for j, r := range ready {
		k, pr, terr := e.takeReading(ctx, r, readings[j], false)
		out[at[j]] = readResult{k, pr, terr}
	}
	return out
}

// stopsWork reports errors that will repeat for every role.
func stopsWork(err error) bool {
	var lim *llm.LimitError
	var auth *llm.AuthError
	return errors.Is(err, llm.ErrNotConnected) || errors.As(err, &lim) || errors.As(err, &auth)
}

// ReadUnread reads roles left unread by an earlier pass.
func (e *Engine) ReadUnread(ctx context.Context) {
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"new"}, Sort: "age", Limit: 60})
	if len(roles) == 0 {
		return
	}
	var ids []int64
	for _, r := range roles {
		ids = append(ids, r.ID)
	}
	var stats RunStats
	e.readAll(ctx, ids, &stats)
}

func postingOf(r store.Role) brain.Posting {
	return brain.Posting{Company: r.Company, Title: r.Title, Location: r.Location, Workplace: r.Workplace, Pay: r.Pay, Description: r.Description}
}

// The fit at or above which a role is worth the person's attention, and at
// or above which documents are prepared without being asked.
const (
	keepFit = 55 // unless the person chose another: Profile.Keep
)

// ReadRole reads one role against the person: fetches the full posting if
// needed, scores it, and either sets it aside or moves it to "found".
func (e *Engine) ReadRole(ctx context.Context, id int64) (kept, prepared bool, err error) {
	return e.readRole(ctx, id, false)
}

// readRole reads one role. Again, the role is one set aside earlier, read
// once more because the person asked: it stays set aside unless the reading
// now clears the bar, and nothing is written for it by itself.
func (e *Engine) readRole(ctx context.Context, id int64, again bool) (kept, prepared bool, err error) {
	r, ready, kept, err := e.textToRead(ctx, id, again)
	if !ready {
		return kept, false, err
	}
	p := e.Person()
	if len(p.CVs) == 0 {
		return false, false, errors.New("add a CV first")
	}
	reading, err := e.brain.ReadRole(ctx, p, e.postingToRead(r))
	if err != nil {
		return false, false, err
	}
	return e.takeReading(ctx, r, reading, again)
}

// postingToRead is a role as Claude is shown it, with what is on record
// about its employer.
func (e *Engine) postingToRead(r store.Role) brain.Posting {
	post := postingOf(r)
	if co, err := e.S.Company(r.CompanyID); err == nil {
		post.About = co.About
	}
	return post
}

// textToRead makes sure a role has its posting's text. ready is false when
// there is nothing to read (yet); kept then says whether the role was kept
// for the person to open anyway.
func (e *Engine) textToRead(ctx context.Context, id int64, again bool) (r store.Role, ready, kept bool, err error) {
	r, err = e.S.Role(id)
	if err != nil {
		return r, false, false, err
	}
	if r.Closed == "no" || (again && r.Closed != "screened") {
		return r, false, false, nil
	}
	if len(strings.Fields(r.Description)) < 40 {
		post := sources.Posting{Source: r.Source, Key: r.Key, URL: r.URL, NeedsDetail: true}
		dctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		derr := e.Src.Detail(dctx, &post)
		cancel()
		if derr == nil {
			posted := int64(0)
			if !post.PostedAt.IsZero() {
				posted = post.PostedAt.Unix()
			}
			applicants := post.Applicants
			if applicants == 0 && r.Applicants < 0 {
				applicants = -1
			}
			e.S.SetRoleDetail(id, post.Description, post.ApplyURL, firstOf(post.Pay, PayFromText(post.Description)), post.Workplace, applicants, posted)
			r, _ = e.S.Role(id)
		} else {
			trace.Log("search", "posting text for role %d (%s) not fetched: %v", id, r.Source, derr)
		}
		// The source's own way did not give the text: read the posting's page
		// the way a browser would.
		if len(strings.Fields(r.Description)) < 40 && r.URL != "" {
			page := sources.Posting{Key: r.Key, URL: r.URL, NeedsDetail: true}
			pctx, cancel := context.WithTimeout(ctx, 60*time.Second)
			perr := e.Src.DetailFromPage(pctx, &page)
			cancel()
			if perr == nil && len(strings.Fields(page.Description)) >= 40 {
				e.S.SetRoleDetail(id, page.Description, firstOf(page.ApplyURL, r.ApplyURL), firstOf(page.Pay, r.Pay, PayFromText(page.Description)), firstOf(page.Workplace, r.Workplace), r.Applicants, r.PostedAt)
				r, _ = e.S.Role(id)
			} else if perr != nil {
				trace.Log("search", "posting page for role %d not read: %v", id, perr)
			}
		}
	}
	if len(strings.Fields(r.Description)) < 40 && again {
		// Still nothing to read: it stays where it was.
		return r, false, false, nil
	}
	if len(strings.Fields(r.Description)) < 40 {
		// Without the posting's text there is nothing to read, and Claude is
		// not spent on a guess. It is tried again on the next two passes
		// (sites have bad minutes); after that it is kept, unscored, for the
		// person to open.
		tries := "readtries:" + fmt.Sprint(id)
		n := e.S.GetInt(tries) + 1
		e.S.Set(tries, n)
		if n < 3 && ctx.Err() == nil {
			trace.Log("search", "role %d has no text yet, try %d of 3", id, n)
			return r, false, false, nil
		}
		e.S.Advance(id, "found")
		e.S.SetReading(id, -1, r.Band, brain.Reading{Summary: "Job Hunt couldn't get this posting's text. Open the posting to read it; the extension can send it back."})
		return r, false, true, nil
	}
	return r, true, false, nil
}

// takeReading keeps Claude's reading of a role, sets the role aside or moves
// it to "found", and prepares it when it is strong enough.
func (e *Engine) takeReading(ctx context.Context, r store.Role, reading brain.Reading, again bool) (kept, prepared bool, err error) {
	id := r.ID
	// The first posting that says what an employer does describes it from then
	// on; what the person wrote themselves is never replaced. A recruiter's
	// posting describes its client, which says nothing about its next one.
	if co, coErr := e.S.Company(r.CompanyID); coErr == nil && reading.Employer != "" && co.About == "" && !reading.Agency {
		if now, err := e.S.Company(r.CompanyID); err == nil && now.About == "" {
			now.About, now.AboutFrom = reading.Employer, "posting"
			e.S.SaveCompany(now)
		}
	}
	band := reading.Band
	if band == "other" || band == "" {
		band = r.Band
	}
	if err := e.S.SetReading(id, reading.Fit, band, reading); err != nil {
		return false, false, err
	}
	e.payFromReading(r, reading)
	prof := e.S.Profile()
	// A near miss that an honest tailoring would carry over the bar is kept:
	// "worth a look tailored".
	nearMiss := reading.Verdict != "skip" && reading.Fit < prof.Keep() && reading.IfTailored >= prof.Keep()
	if reading.Verdict == "skip" || (reading.Fit < prof.Keep() && !nearMiss) {
		why := firstOf(reading.SkipWhy, "Fit too low ("+fmt.Sprint(reading.Fit)+")")
		// A role the person added themselves is never set aside for them.
		if r.Source != "manual" && r.Source != "extension" {
			e.S.CloseRole(id, "screened", why)
			return false, false, nil
		}
	}
	if again {
		// Back among the roles worth a look; a "no" is never undone here.
		if ok, err := e.S.Unscreen(id); err != nil || !ok {
			return false, false, err
		}
	}
	e.S.Advance(id, "found")
	text := fmt.Sprintf("Scored %d against your %s", reading.Fit, e.cvName(reading.CVID))
	if nearMiss {
		text += fmt.Sprintf("; about %d once tailored, so it is worth a look", reading.IfTailored)
	}
	e.S.Log(store.Activity{Kind: "read", RoleID: id, CompanyID: r.CompanyID, Text: text})

	// One search prepares at most as many as the person allowed; the rest
	// wait on Today with a Prepare button.
	full := prof.PrepareMax > 0 && e.Busy("search") && int(e.preparedNow.Load()) >= prof.PrepareMax
	if reading.Fit >= prof.PrepareAt() && prof.MayPrepare != "ask" && !full && !again {
		if perr := e.Prepare(ctx, id); perr == nil {
			prepared = true
			e.preparedNow.Add(1)
		} else if !errors.Is(perr, context.Canceled) {
			e.problem("Preparing documents", perr)
		}
	}
	return true, prepared, nil
}

func (e *Engine) cvName(id int64) string {
	if c, err := e.S.CV(id); err == nil {
		return c.Name
	}
	return "CV"
}

// TailoredCV is the "cv" document of a role.
type TailoredCV struct {
	CVID      int64           `json:"cv_id"`
	CVName    string          `json:"cv_name"`
	Changes   []cv.Change     `json:"changes"`
	LeftOut   []brain.LeftOut `json:"left_out"`
	Questions []string        `json:"questions"`
	FitAfter  int             `json:"fit_after"`
	// Earlier: the application at the same employer this CV was kept close to.
	Earlier *EarlierRef `json:"earlier,omitempty"`
	// Prev is the set of edits as it was before the person last asked for
	// changes, so "Put it back" can restore it.
	Prev *CVBefore `json:"prev,omitempty"`
}

// CVBefore is a tailored CV as it stood before the person asked for changes.
type CVBefore struct {
	Changes   []cv.Change     `json:"changes"`
	LeftOut   []brain.LeftOut `json:"left_out"`
	Questions []string        `json:"questions"`
	FitAfter  int             `json:"fit_after"`
	Ask       string          `json:"ask"` // what they asked for
}

// LetterDoc is the "letter" document of a role.
type LetterDoc struct {
	Text  string `json:"text"`
	Style string `json:"style,omitempty"` // one of store.LetterStyles; "" reads as the first
	Own   bool   `json:"own,omitempty"`   // the person edited it themselves
	// Prev is the letter as it was before it was last written again.
	Prev *LetterBefore `json:"prev,omitempty"`
}

// LetterBefore is a letter as it stood before it was written again.
type LetterBefore struct {
	Text  string `json:"text"`
	Style string `json:"style"`
	Ask   string `json:"ask"` // what the person asked for; "" when only the style changed
}

// Prepare makes the documents for a role: a tailored CV and a letter. Both
// are written at once; the role is ready the moment they are.
func (e *Engine) Prepare(ctx context.Context, id int64) error {
	e.mu.Lock()
	if e.preps[id] {
		e.mu.Unlock()
		return nil
	}
	e.preps[id] = true
	e.mu.Unlock()
	e.S.Changed("roles")
	defer func() {
		e.mu.Lock()
		delete(e.preps, id)
		e.mu.Unlock()
		e.S.Changed("roles", "today")
	}()

	r, err := e.S.Role(id)
	if err != nil {
		return err
	}
	var reading brain.Reading
	json.Unmarshal(r.Reading, &reading)
	p := e.Person()
	if len(p.CVs) == 0 {
		return errors.New("add a CV first")
	}
	cvID := reading.CVID
	if _, err := e.S.CV(cvID); err != nil {
		cvID = p.CVs[0].ID
	}
	base, err := e.CVModel(cvID)
	if err != nil {
		return err
	}
	post := postingOf(r)
	// A role that already has a letter keeps the style chosen for it; else
	// the CV's own style, when the person chose one for it.
	style := p.Profile.LetterStyle
	if s := e.CVSet(cvID).LetterStyle; s != "" {
		style = s
	}
	var had LetterDoc
	if ok, _ := e.S.Doc(id, "letter", &had); ok && store.KnownLetterStyle(had.Style) {
		style = had.Style
	}
	e.StepTakes(ctx, 50*time.Second)
	e.Report(ctx, 0, 1, "Tailoring your CV and writing the letter for "+r.Company)

	var wg sync.WaitGroup
	var tail brain.Tailoring
	var letter string
	var terr, lerr error
	wg.Add(2)
	before := e.EarlierHere(r)
	var again *brain.Again
	if before != nil {
		again = &brain.Again{Earlier: before.text}
	}
	go func() { defer wg.Done(); tail, terr = e.brain.Tailor(ctx, p, base, post, reading, again) }()
	go func() { defer wg.Done(); letter, lerr = e.brain.Letter(ctx, p, post, reading, style, nil) }()
	wg.Wait()
	if terr != nil {
		return terr
	}
	if lerr != nil {
		return lerr
	}
	doc := TailoredCV{CVID: cvID, CVName: e.cvName(cvID), Changes: tail.Changes, LeftOut: tail.LeftOut, Questions: tail.Questions, FitAfter: tail.FitAfter}
	if before != nil {
		doc.Earlier = &before.EarlierRef
	}
	if err := e.S.SaveDoc(id, "cv", doc); err != nil {
		return err
	}
	if err := e.S.SaveDoc(id, "letter", LetterDoc{Text: letter, Style: style}); err != nil {
		return err
	}
	e.S.SetFitTailored(id, tail.FitAfter)
	for i, q := range tail.Questions {
		if strings.TrimSpace(q) != "" {
			e.S.Ask(store.Question{Key: fmt.Sprintf("tailor:%s", store.QuestionKey(q)), Text: q, Weight: 20 - i,
				Why: "Asked while tailoring for " + r.Title + " at " + r.Company + ". Your answer is kept and used wherever it helps."})
		}
	}
	e.S.Advance(id, "ready")
	e.S.Log(store.Activity{Kind: "prepared", RoleID: id, CompanyID: r.CompanyID, Text: fmt.Sprintf("CV and letter ready (%d changes)", len(tail.Changes))})
	e.maybePush(r, reading.Fit, tail.FitAfter)
	e.keepFilesQuietly(id)
	return nil
}

// Preparing reports whether a role's documents are being written right now.
func (e *Engine) Preparing(id int64) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.preps[id]
}

// SetChange switches one tailoring change on or off, or edits its text.
func (e *Engine) SetChange(roleID int64, index int, off bool, after *string) error {
	var doc TailoredCV
	ok, err := e.S.Doc(roleID, "cv", &doc)
	if err != nil {
		return err
	}
	if !ok || index < 0 || index >= len(doc.Changes) {
		return store.ErrNotFound
	}
	doc.Changes[index].Off = off
	if after != nil {
		doc.Changes[index].After = strings.TrimSpace(*after)
		doc.Changes[index].Mine = true
	}
	return e.S.SaveDoc(roleID, "cv", doc)
}

// SwitchCV re-tailors a role from a different base CV.
func (e *Engine) SwitchCV(ctx context.Context, roleID, cvID int64) error {
	r, err := e.S.Role(roleID)
	if err != nil {
		return err
	}
	if _, err := e.S.CV(cvID); err != nil {
		return err
	}
	var reading brain.Reading
	json.Unmarshal(r.Reading, &reading)
	reading.CVID = cvID
	if err := e.S.SetReading(roleID, r.Fit, r.Band, reading); err != nil {
		return err
	}
	return e.Prepare(ctx, roleID)
}

// RoleCV returns the CV as it will be sent for a role: the base with the
// switched-on changes applied.
func (e *Engine) RoleCV(roleID int64) (cv.CV, cv.CV, TailoredCV, error) {
	var doc TailoredCV
	ok, err := e.S.Doc(roleID, "cv", &doc)
	if err != nil {
		return cv.CV{}, cv.CV{}, doc, err
	}
	if !ok {
		return cv.CV{}, cv.CV{}, doc, store.ErrNotFound
	}
	base, err := e.CVModel(doc.CVID)
	if err != nil {
		return cv.CV{}, cv.CV{}, doc, err
	}
	out, _ := cv.Apply(base, doc.Changes)
	return base, out, doc, nil
}

// File is a document ready to download or attach.
type File struct {
	Name string
	Data []byte
}

// Everything but letters (of any alphabet), digits and a little punctuation
// is left out of a file's name, so it is safe on Windows and in a download
// header.
var unsafeName = regexp.MustCompile(`[^\p{L}\p{N} ._-]+`)

func fileName(parts ...string) string {
	return fileNameExt("docx", parts...)
}

func fileNameExt(ext string, parts ...string) string {
	var kept []string
	for _, p := range parts {
		p = strings.Join(strings.Fields(unsafeName.ReplaceAllString(p, " ")), " ")
		if p = strings.Trim(p, " ."); p != "" {
			kept = append(kept, p)
		}
	}
	s := []rune(strings.Join(kept, " - "))
	if len(s) > 90 {
		s = s[:90]
	}
	name := strings.Trim(string(s), " .-")
	if name == "" {
		name = "Job Hunt"
	}
	return name + "." + ext
}

// CVFile renders the tailored CV for a role as a Word document.
func (e *Engine) CVFile(roleID int64) (File, error) {
	if f, ok := e.Own(roleID, "cv"); ok {
		return f, nil
	}
	_, out, _, err := e.RoleCV(roleID)
	if err != nil {
		return File{}, err
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderCV(out)
	return File{Name: fileName(e.sender(out), r.Company, "CV"), Data: data}, err
}

// LetterFile renders the letter for a role as a Word document.
func (e *Engine) LetterFile(roleID int64) (File, error) {
	if f, ok := e.Own(roleID, "letter"); ok {
		return f, nil
	}
	l, r, err := e.roleLetter(roleID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderLetter(l)
	return File{Name: fileName(firstOf(l.Name, "Letter"), r.Company, "Letter"), Data: data}, err
}

// BaseCVFile renders a stored CV, untailored.
func (e *Engine) BaseCVFile(cvID int64) (File, error) {
	m, err := e.CVModel(cvID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderCV(m)
	return File{Name: fileName(firstOf(m.Name, "CV")), Data: data}, err
}

// ---- roles the person adds or acts on -------------------------------------------------------

// AddRole records a role the person found themselves (pasted, or sent by the
// extension) and reads it at once.
func (e *Engine) AddRole(company, title, location, url, description, source string) (int64, error) {
	company, title = strings.TrimSpace(company), strings.TrimSpace(title)
	if company == "" || title == "" {
		return 0, errors.New("a role needs an employer and a title")
	}
	c, _, err := e.S.UpsertCompany(store.Company{Name: company, State: "suggested", Source: "you"})
	if err != nil {
		return 0, err
	}
	if source == "" {
		source = "manual"
	}
	key := source + ":" + firstOf(url, store.NormName(company)+":"+strings.ToLower(title))
	if id, _, seen := e.S.SeenRole(key); seen {
		if description != "" {
			e.S.TouchRole(id, -1, description)
		}
		e.S.Reopen(id) // the person asked for it, so it comes back
		return id, nil
	}
	if id, closed, dup := e.S.SimilarRole(c.ID, title, location); dup {
		if description != "" {
			e.S.TouchRole(id, -1, description)
		}
		if closed != "" {
			e.S.Reopen(id)
		}
		return id, nil
	}
	id, err := e.S.AddRole(store.Role{CompanyID: c.ID, Key: key, Source: source, Title: title, Location: location, URL: url, Description: description, Pay: PayFromText(description), Applicants: -1})
	if err != nil {
		return 0, err
	}
	e.S.Log(store.Activity{Kind: "added", RoleID: id, CompanyID: c.ID, Text: "You added this role"})
	e.Go(fmt.Sprintf("read:%d", id), "Reading the role you added", func(ctx context.Context) error {
		_, _, err := e.ReadRole(ctx, id)
		return err
	})
	return id, nil
}

// MarkApplied records that the person applied.
func (e *Engine) MarkApplied(id int64, how string) error {
	r, err := e.S.Role(id)
	if err != nil {
		return err
	}
	moved, err := e.S.Advance(id, "applied")
	if err != nil {
		return err
	}
	if moved {
		text := "You applied"
		if r.Applicants >= 0 {
			text += " (" + ApplicantsText(r.Applicants) + " applicants at the time)"
		}
		if age := e.Now().Unix() - r.Age(); age > 0 && age < 3600 {
			text += ", inside its first hour"
		}
		if how != "" {
			text += " " + how
		}
		detail := ""
		if r.Applicants >= 0 && r.Applicants < 10 {
			detail = "first10"
		}
		e.S.Log(store.Activity{Kind: "applied", RoleID: id, CompanyID: r.CompanyID, Text: text, Detail: detail})
		e.S.UpsertCompany(store.Company{Name: r.Company, State: "following"})
	}
	return nil
}

// NotInterested closes a role for good and remembers why.
func (e *Engine) NotInterested(id int64, why string) error {
	r, err := e.S.Role(id)
	if err != nil {
		return err
	}
	why = clipText(strings.TrimSpace(why), 200)
	if err := e.S.CloseRole(id, "no", why); err != nil {
		return err
	}
	e.S.Log(store.Activity{Kind: "no", RoleID: id, CompanyID: r.CompanyID, Text: "You said not interested" + map[bool]string{true: ": " + why, false: ""}[why != ""]})
	return nil
}

// MuteEmployer stops an employer's roles from being shown again: the person
// said so. Roles they already applied to or prepared stay as they are.
func (e *Engine) MuteEmployer(companyID int64) error {
	c, err := e.S.Company(companyID)
	if err != nil {
		return err
	}
	c.State = "muted"
	if err := e.S.SaveCompany(c); err != nil {
		return err
	}
	e.S.Log(store.Activity{Kind: "no", CompanyID: c.ID, Text: "You asked never to be shown " + c.Name + " again"})
	e.S.Changed("companies", "roles", "today")
	return nil
}

// TurnedDown is what the person said no to lately and why, in a few lines:
// the reading of a new role takes it into account.
func (e *Engine) TurnedDown() []string {
	rows, _ := e.S.Pairs(`SELECT r.title || ' at ' || c.name || ': ' || r.closed_why, r.id FROM roles r JOIN companies c ON c.id = r.company_id
		WHERE r.closed = 'no' AND r.closed_why != '' ORDER BY r.stage_at DESC LIMIT 12`)
	var out []string
	for _, row := range rows {
		out = append(out, clipText(row.Label, 220))
	}
	return out
}

// ---- the person's own notes on a role, and answers for its form -----------------------

// RoleNotes is what the person wrote down about a role.
type RoleNotes struct {
	Text string `json:"text"`
	At   int64  `json:"at"`
}

func (e *Engine) SaveRoleNotes(id int64, text string) error {
	if _, err := e.S.Role(id); err != nil {
		return err
	}
	if len(text) > 20000 {
		text = clipText(text, 20000)
	}
	return e.S.SaveDoc(id, "mynotes", RoleNotes{Text: strings.TrimSpace(text), At: e.Now().Unix()})
}

// AnswersDoc is the questions of a role's application form with answers
// to copy. The person pastes the questions; Job Hunt never fills or sends.
type AnswersDoc struct {
	Answers []brain.FormAnswer `json:"answers"`
	At      int64              `json:"at"`
}

func (e *Engine) AnswerQuestions(ctx context.Context, id int64, text string) error {
	var qs []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "-*•0123456789.) "))
		if len(line) >= 6 {
			qs = append(qs, line)
		}
	}
	if len(qs) == 0 {
		return errors.New("paste the form's questions, one on each line")
	}
	out, err := e.FormAnswers(ctx, id, qs, nil)
	if err != nil {
		return err
	}
	return e.S.SaveDoc(id, "answers", AnswersDoc{Answers: out, At: e.Now().Unix()})
}

// payFromReading keeps the pay Claude found in a posting when the text's own
// reading found none. A figure that doesn't read as pay is left out.
func (e *Engine) payFromReading(r store.Role, rd brain.Reading) {
	pay := strings.Join(strings.Fields(rd.Pay), " ")
	if r.Pay != "" || pay == "" || len(pay) > 120 {
		return
	}
	if y := PayPerYear(pay); y < 20000 || y > 1500000 {
		return
	}
	e.S.SetRoleDetail(r.ID, "", "", pay, "", -1, 0)
}

// fillPay reads pay from the text of roles that have none. It fills an empty
// pay, and completes one that was read as only the bottom of its range
// ("$90,000.00/yr" of "$90,000.00/yr - $110,000.00/yr"); nothing else a role
// already says is changed.
func (e *Engine) fillPay() {
	ids, _ := e.S.Pairs(`SELECT '', id FROM roles WHERE description != '' AND (pay = '' OR (pay NOT LIKE '%-%' AND pay NOT LIKE '%–%' AND pay NOT LIKE '%—%' AND pay NOT LIKE '% to %')) ORDER BY id DESC LIMIT 6000`)
	n := 0
	for _, row := range ids {
		r, err := e.S.Role(int64(row.N))
		if err != nil {
			continue
		}
		if pay := PayFromText(r.Description); pay != "" && pay != r.Pay && (r.Pay == "" || strings.HasPrefix(pay, r.Pay)) {
			e.S.SetRoleDetail(r.ID, "", "", pay, "", -1, 0)
			n++
		}
	}
	if n > 0 {
		trace.Log("did", "read the pay out of %d postings' text", n)
	}
}
