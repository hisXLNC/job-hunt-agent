package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	added := 0
	for _, emp := range list {
		if strings.TrimSpace(emp.Name) == "" {
			continue
		}
		_, isNew, err := e.S.UpsertCompany(store.Company{Name: emp.Name, Site: cleanSite(emp.Site), Sector: emp.Sector, Why: emp.Why, State: "following", Source: "proposed"})
		if err == nil && isNew {
			added++
		}
	}
	if added > 0 {
		e.S.Log(store.Activity{Kind: "employers", Text: fmt.Sprintf("Added %d employers that hire people like you", added)})
	}
	e.DetectBoards(ctx)
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
	default:
		c.BoardNote = "Couldn't check its careers page; watched through LinkedIn"
	}
	return e.S.SaveCompany(c)
}

// SetBoardFromURL lets the person paste an employer's careers page.
func (e *Engine) SetBoardFromURL(id int64, raw string) error {
	b, ok := sources.ParseBoardURL(raw)
	if !ok {
		return errors.New("that page isn't one of the job systems Job Hunt can read directly (Workday, Greenhouse, Lever, Ashby, SmartRecruiters). The employer is still watched through LinkedIn")
	}
	c, err := e.S.Company(id)
	if err != nil {
		return err
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
	Paused        bool   `json:"paused"`
}

func (e *Engine) searchState() SearchState {
	var st SearchState
	e.S.Get("search", &st)
	return st
}

func (e *Engine) Paused() bool { return e.searchState().Paused }

// SetPaused switches all automatic searching on or off.
func (e *Engine) SetPaused(p bool) {
	st := e.searchState()
	st.Paused = p
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
}

// StartSearch starts a search in the background. Kind is "full" or "fast".
func (e *Engine) StartSearch(kind string) bool {
	doing := "Searching every source"
	if kind == "fast" {
		doing = "Checking for postings under an hour old"
	}
	return e.Go("search", doing, func(ctx context.Context) error {
		return e.Search(ctx, kind)
	})
}

// Search looks for new postings, reads the ones that pass the quick rules,
// and prepares the strong ones.
func (e *Engine) Search(ctx context.Context, kind string) error {
	p := e.S.Profile()
	if !p.SetupDone {
		return nil
	}
	runID := e.S.StartRun("search:" + kind)
	stats := RunStats{Kind: kind, ByPlace: map[string][2]int{}, ClearedBy: map[string]int{}}
	st := e.searchState()
	now := e.Now()
	var fresh []int64

	note := func(place string, seen, added int) {
		v := stats.ByPlace[place]
		stats.ByPlace[place] = [2]int{v[0] + seen, v[1] + added}
	}

	// 1. Employers' own boards: the earliest place a posting appears.
	companies, _ := e.S.Companies("following")
	for _, c := range companies {
		if ctx.Err() != nil {
			break
		}
		if c.BoardKind == "" {
			continue
		}
		// A fast pass only re-reads boards that are cheap to read whole.
		if kind == "fast" && c.BoardKind == "workday" {
			continue
		}
		stats.Looked++
		posts, err := e.listBoard(ctx, c, p)
		if err != nil {
			stats.Problems = append(stats.Problems, fmt.Sprintf("%s: %s", c.Name, plainErr(err)))
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
		// Workday is searched by keyword, so absence proves nothing there.
		if c.BoardKind != "workday" && len(posts) > 0 {
			for _, id := range open {
				e.S.MarkGone(id)
				stats.Gone++
			}
		}
		stats.Seen += len(posts)
		note(c.Name, len(posts), added)
	}

	// 2. LinkedIn's public search: every title, step-up and sideways included,
	// each searched as often as the others.
	if now.Unix() >= st.LinkedInUntil {
		within := 26 * time.Hour
		if st.LastFull == 0 {
			within = 7 * 24 * time.Hour
		} else if d := now.Sub(time.Unix(st.LastFull, 0)) + 2*time.Hour; d > within {
			within = min(d, 14*24*time.Hour)
		}
		few := false
		if kind == "fast" {
			within, few = 2*time.Hour, true
		}
		place := strings.TrimSpace(strings.Trim(p.City+", "+p.Country, ", "))
		blocked := false
		for _, bt := range p.Titles.All() {
			if ctx.Err() != nil || blocked {
				break
			}
			stats.Looked++
			posts, err := e.Src.Search(ctx, sources.Query{Keywords: bt.Title, Location: place, Within: within, FewApplicants: few})
			if err != nil {
				var he *sources.HTTPError
				if errors.As(err, &he) && (he.Status == 429 || he.Status == 999 || he.Status == 403) {
					st.LinkedInUntil = now.Add(2 * time.Hour).Unix()
					st.LinkedInNote = "LinkedIn asked Job Hunt to slow down; trying again later"
					stats.Problems = append(stats.Problems, st.LinkedInNote)
					blocked = true
					continue
				}
				stats.Problems = append(stats.Problems, "LinkedIn, "+bt.Title+": "+plainErr(err))
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
			note("LinkedIn: "+bt.Title, len(posts), added)
			select {
			case <-ctx.Done():
			case <-time.After(e.linkedInPause()):
			}
		}
	} else {
		stats.Problems = append(stats.Problems, firstOf(st.LinkedInNote, "LinkedIn is resting"))
	}

	if kind == "full" {
		st.LastFull = now.Unix()
	}
	st.LastFast = now.Unix()
	paused := e.searchState().Paused
	st.Paused = paused
	e.S.Set("search", st)

	// 3. Read what is new, freshest first: being early matters more than
	// anything else Job Hunt does.
	stats.New = len(fresh) + stats.Cleared
	e.readAll(ctx, fresh, &stats)

	state := "done"
	if ctx.Err() != nil {
		state = "stopped"
	}
	e.S.EndRun(runID, state, stats, strings.Join(stats.Problems, "\n"))
	if stats.Kept > 0 || kind == "full" {
		e.S.Log(store.Activity{Kind: "search", Text: fmt.Sprintf("Searched %d places: %d postings, %d new, %d worth a look", stats.Looked, stats.Seen, stats.New, stats.Kept)})
	}
	return nil
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

// nearby places that count as the same job market.
var metros = map[string][]string{
	"toronto":   {"toronto", "gta", "greater toronto", "mississauga", "markham", "vaughan", "north york", "etobicoke", "scarborough", "brampton", "oakville", "richmond hill", "ontario", " on"},
	"vancouver": {"vancouver", "burnaby", "richmond", "surrey", "british columbia", " bc"},
	"montreal":  {"montreal", "montréal", "laval", "quebec", "québec", " qc"},
	"ottawa":    {"ottawa", "gatineau", "kanata", "ontario", " on"},
	"calgary":   {"calgary", "alberta", " ab"},
	"new york":  {"new york", "nyc", "manhattan", "brooklyn", "jersey city", " ny"},
	"london":    {"london", "greater london"},
}

// placeOK reports whether a posting's location is somewhere the person will be.
func placeOK(p store.Profile, location, workplace string) bool {
	loc := strings.ToLower(location)
	if strings.TrimSpace(loc) == "" {
		return true // unknown: let the reading decide
	}
	city := strings.ToLower(strings.TrimSpace(strings.Split(p.City, ",")[0]))
	if city == "" {
		return true
	}
	names := metros[city]
	if names == nil {
		names = []string{city}
	}
	padded := " " + strings.NewReplacer(",", " ", "(", " ", ")", " ", "-", " ", "/", " ").Replace(loc) + " "
	for _, n := range names {
		if strings.HasPrefix(n, " ") {
			if strings.Contains(padded, n+" ") {
				return true
			}
		} else if strings.Contains(loc, n) {
			return true
		}
	}
	country := strings.ToLower(strings.TrimSpace(p.Country))
	remote := workplace == "remote" || strings.Contains(loc, "remote") || strings.Contains(loc, "anywhere")
	if remote && (country == "" || strings.Contains(loc, country) || strings.TrimSpace(strings.NewReplacer("remote", "", "-", "", ",", "").Replace(loc)) == "") {
		return true
	}
	// A bare country name means "anywhere in the country".
	if country != "" && strings.TrimSpace(loc) == country {
		return true
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
		return "Title isn't in your field", ""
	}
	if !searched && !placeOK(p, post.Location, post.Workplace) {
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
	return "", band
}

func (e *Engine) ingest(companyID int64, post sources.Posting, p store.Profile, stats *RunStats) (int64, bool, bool) {
	return e.ingestBand(companyID, post, p, stats, "")
}

// ingest records a posting if it is new. It reports the role's id, whether it
// was new, and whether the quick rules set it aside.
func (e *Engine) ingestBand(companyID int64, post sources.Posting, p store.Profile, stats *RunStats, searchedBand string) (int64, bool, bool) {
	if id, _, seen := e.S.SeenRole(post.Key); seen {
		e.S.TouchRole(id, post.Applicants, post.Description)
		return id, false, false
	}
	// The same job seen through another place is the same role; and a role
	// the person said no to stays said no to, however it reappears.
	if id, closed, dup := e.S.SimilarRole(companyID, post.Title, post.Location); dup {
		if closed == "no" {
			stats.Cleared++
			stats.ClearedBy["You said no to this one before"]++
		}
		e.S.TouchRole(id, post.Applicants, "")
		return id, false, false
	}
	reason, band := screen(p, post, searchedBand != "")
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
		r.Description = "" // not kept for roles nobody will look at
	}
	id, err := e.S.AddRole(r)
	if err != nil {
		return 0, false, false
	}
	if reason != "" {
		stats.Cleared++
		stats.ClearedBy[reason]++
		return id, true, true
	}
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

	var mu sync.Mutex
	var wg sync.WaitGroup
	work := make(chan int64)
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range work {
				kept, prepared, err := e.ReadRole(ctx, id)
				mu.Lock()
				if err == nil {
					stats.Read++
					if kept {
						stats.Kept++
					}
					if prepared {
						stats.Prepared++
					}
				}
				mu.Unlock()
				if err != nil && !errors.Is(err, context.Canceled) {
					e.problem("Reading new roles", err)
					if stopsWork(err) {
						return
					}
				}
			}
		}()
	}
	for _, a := range list {
		if ctx.Err() != nil {
			break
		}
		if rest, _, _ := e.meter.Resting(); rest {
			break
		}
		work <- a.id
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
	keepFit    = 55
	prepareFit = 70
)

// ReadRole reads one role against the person: fetches the full posting if
// needed, scores it, and either sets it aside or moves it to "found".
func (e *Engine) ReadRole(ctx context.Context, id int64) (kept, prepared bool, err error) {
	r, err := e.S.Role(id)
	if err != nil {
		return false, false, err
	}
	if r.Closed == "no" {
		return false, false, nil
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
			e.S.SetRoleDetail(id, post.Description, post.ApplyURL, post.Pay, post.Workplace, applicants, posted)
			r, _ = e.S.Role(id)
		}
	}
	if len(strings.Fields(r.Description)) < 40 {
		// Without the posting's text there is nothing to read. Keep it visible
		// so the person can open it, but don't spend Claude on a guess.
		e.S.Advance(id, "found")
		e.S.SetReading(id, -1, r.Band, brain.Reading{Summary: "Job Hunt couldn't get this posting's text. Open the posting to read it; the extension can send it back."})
		return true, false, nil
	}
	p := e.Person()
	if len(p.CVs) == 0 {
		return false, false, errors.New("add a CV first")
	}
	reading, err := e.brain.ReadRole(ctx, p, postingOf(r))
	if err != nil {
		return false, false, err
	}
	band := reading.Band
	if band == "other" || band == "" {
		band = r.Band
	}
	if err := e.S.SetReading(id, reading.Fit, band, reading); err != nil {
		return false, false, err
	}
	if reading.Verdict == "skip" || reading.Fit < keepFit {
		why := firstOf(reading.SkipWhy, "Fit too low ("+fmt.Sprint(reading.Fit)+")")
		// A role the person added themselves is never set aside for them.
		if r.Source != "manual" && r.Source != "extension" {
			e.S.CloseRole(id, "screened", why)
			return false, false, nil
		}
	}
	e.S.Advance(id, "found")
	e.S.Log(store.Activity{Kind: "read", RoleID: id, CompanyID: r.CompanyID, Text: fmt.Sprintf("Scored %d against your %s", reading.Fit, e.cvName(reading.CVID))})

	if reading.Fit >= prepareFit && e.S.Profile().MayPrepare != "ask" {
		if perr := e.Prepare(ctx, id); perr == nil {
			prepared = true
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
}

// LetterDoc is the "letter" document of a role.
type LetterDoc struct {
	Text string `json:"text"`
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

	var wg sync.WaitGroup
	var tail brain.Tailoring
	var letter string
	var terr, lerr error
	wg.Add(2)
	go func() { defer wg.Done(); tail, terr = e.brain.Tailor(ctx, p, base, post, reading) }()
	go func() { defer wg.Done(); letter, lerr = e.brain.Letter(ctx, p, post, reading) }()
	wg.Wait()
	if terr != nil {
		return terr
	}
	if lerr != nil {
		return lerr
	}
	doc := TailoredCV{CVID: cvID, CVName: e.cvName(cvID), Changes: tail.Changes, LeftOut: tail.LeftOut, Questions: tail.Questions, FitAfter: tail.FitAfter}
	if err := e.S.SaveDoc(id, "cv", doc); err != nil {
		return err
	}
	if err := e.S.SaveDoc(id, "letter", LetterDoc{Text: letter}); err != nil {
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

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9 ._-]+`)

func fileName(parts ...string) string {
	s := strings.Join(parts, " - ")
	s = strings.Join(strings.Fields(unsafeName.ReplaceAllString(s, " ")), " ")
	if len(s) > 90 {
		s = s[:90]
	}
	return s + ".docx"
}

// CVFile renders the tailored CV for a role as a Word document.
func (e *Engine) CVFile(roleID int64) (File, error) {
	_, out, _, err := e.RoleCV(roleID)
	if err != nil {
		return File{}, err
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderCV(out)
	return File{Name: fileName(firstOf(out.Name, "CV"), r.Company), Data: data}, err
}

// LetterFile renders the letter for a role as a Word document.
func (e *Engine) LetterFile(roleID int64) (File, error) {
	var doc LetterDoc
	ok, err := e.S.Doc(roleID, "letter", &doc)
	if err != nil {
		return File{}, err
	}
	if !ok {
		return File{}, store.ErrNotFound
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return File{}, err
	}
	p := e.S.Profile()
	contact := []string{}
	if cvs, _ := e.S.CVs(); len(cvs) > 0 {
		var m cv.CV
		if json.Unmarshal(cvs[0].Model, &m) == nil {
			contact = append([]string{m.Contact.Location, m.Contact.Email, m.Contact.Phone}, m.Contact.Links...)
		}
	}
	data, err := office.RenderLetter(office.Letter{
		Name: p.Name, Contact: contact, Date: e.Now().Format("2 January 2006"),
		To: []string{"Hiring team", r.Company}, Subject: r.Title, Body: "Dear hiring team,\n\n" + doc.Text, Sign: "Sincerely,",
	})
	return File{Name: fileName(firstOf(p.Name, "Letter"), r.Company, "letter"), Data: data}, err
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
	id, err := e.S.AddRole(store.Role{CompanyID: c.ID, Key: key, Source: source, Title: title, Location: location, URL: url, Description: description, Applicants: -1})
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
			text += fmt.Sprintf(" (about %d applicants at the time)", r.Applicants)
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
	if err := e.S.CloseRole(id, "no", why); err != nil {
		return err
	}
	e.S.Log(store.Activity{Kind: "no", RoleID: id, CompanyID: r.CompanyID, Text: "You said not interested" + map[bool]string{true: ": " + why, false: ""}[why != ""]})
	return nil
}
