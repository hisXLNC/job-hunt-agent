package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// More places to find jobs: the three job searches that take a key the
// person gets for themselves (Adzuna, Jooble, Google for Jobs), and the
// job-alert e-mails that job sites send to the person's inbox.
//
// The keys are kept under "sourcekeys" and never leave this file except to
// be handed to the service they belong to: what the pages are shown says
// only whether a key is there.

const (
	sourceKeysKey  = "sourcekeys"
	sourceStateKey = "sourcestate"

	// The kinds of source Radar lists, beside the ids of the title searches.
	srcBoards = "boards"
	srcSites  = "sites"
	srcAlerts = "alerts"
)

// SourceKeys is what the person saved for the searches that take a key.
type SourceKeys struct {
	AdzunaID    string         `json:"adzuna_id,omitempty"`
	AdzunaKey   string         `json:"adzuna_key,omitempty"`
	Jooble      string         `json:"jooble,omitempty"`
	JSearch     string         `json:"jsearch,omitempty"`
	JSearchFrom string         `json:"jsearch_from,omitempty"` // "rapidapi" or "openwebninja"
	Apify       string         `json:"apify,omitempty"`        // an Apify API token
	ApifyActor  string         `json:"apify_actor,omitempty"`  // the scraper; empty means the default
	Off         []string       `json:"off,omitempty"`          // sources switched off: "adzuna", "jooble", "jsearch", "alerts"
	Limit       map[string]int `json:"limit,omitempty"`        // most requests a day, where the person set one
}

func (k SourceKeys) forSources() sources.Keys {
	return sources.Keys{AdzunaID: k.AdzunaID, AdzunaKey: k.AdzunaKey, Jooble: k.Jooble, JSearch: k.JSearch, JSearchFrom: k.JSearchFrom, Apify: k.Apify, ApifyActor: k.ApifyActor}
}

func (k SourceKeys) off(id string) bool {
	for _, x := range k.Off {
		if x == id {
			return true
		}
	}
	return false
}

func (k SourceKeys) limit(id string) int {
	if n := k.Limit[id]; n > 0 {
		return n
	}
	return keyedSources[id].perDay
}

func (e *Engine) sourceKeys() SourceKeys {
	var k SourceKeys
	e.S.Get(sourceKeysKey, &k)
	return k
}

// keyedSource is what Job Hunt knows about one search that takes a key.
type keyedSource struct {
	name   string
	about  string
	get    string // where a key comes from, in plain words
	link   string // the page that gives one
	perDay int    // requests a day that fit the free plan
	fast   bool   // can be asked for today's postings only, so a quick check may use it
}

var keyedSources = map[string]keyedSource{
	"adzuna": {name: "Adzuna", perDay: 200, fast: true,
		about: "A job search engine that gathers postings from job boards and employers' sites in 19 countries.",
		get:   "Free. Sign up on Adzuna's developer page, then copy the Application ID and the Application Key it shows you.",
		link:  "https://developer.adzuna.com/signup"},
	"jooble": {name: "Jooble", perDay: 60,
		about: "Gathers listings from thousands of job sites. It shows a few lines of each posting; Job Hunt opens the posting for the rest.",
		get:   "Free. Fill in the short form on Jooble's API page and the key arrives by e-mail.",
		link:  "https://jooble.org/api/about"},
	"jsearch": {name: "Google for Jobs", perDay: 6, fast: true,
		about: "What Google shows when you search for jobs: postings from LinkedIn, Indeed, Glassdoor, ZipRecruiter and employers' own sites, read through a service called JSearch.",
		get:   "Subscribe to JSearch on RapidAPI (the free plan gives about 200 requests a month) and copy the key it shows as X-RapidAPI-Key. A key bought from OpenWeb Ninja works too.",
		link:  "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch"},
	"apify": {name: "LinkedIn through Apify", perDay: 24,
		about: "LinkedIn's own job search, run for you by a scraper on Apify: every posting comes with its whole description, and LinkedIn never sees Job Hunt asking. One request is one title on a full search; quick checks stay on LinkedIn's free public search.",
		get:   "Apify charges per posting after its free monthly credit (about $1 for 1,000 with the usual scraper). Sign up, then copy your API token from Settings, API & Integrations.",
		link:  "https://console.apify.com/settings/integrations"},
}

// SourceState is what happened the last time one of these was asked.
type SourceState struct {
	At        int64  `json:"at,omitempty"`         // when it last answered
	Seen      int    `json:"seen,omitempty"`       // postings it showed then
	New       int    `json:"new,omitempty"`        // of those, new
	Error     string `json:"error,omitempty"`      // why it did not answer, since
	ErrorAt   int64  `json:"error_at,omitempty"`   //
	RestUntil int64  `json:"rest_until,omitempty"` // left alone until then
	Day       string `json:"day,omitempty"`        // the day Used counts
	Used      int    `json:"used,omitempty"`       // requests made that day
	FastAt    int64  `json:"fast_at,omitempty"`    // the last quick check that asked it
	Turn      int    `json:"turn,omitempty"`       // which title is next, when not all fit in a day
}

func (e *Engine) sourceStates() map[string]SourceState {
	st := map[string]SourceState{}
	e.S.Get(sourceStateKey, &st)
	return st
}

// setSourceState changes one source's state. The rest is read again first,
// since a search and the person's Test button may both be writing.
func (e *Engine) setSourceState(id string, change func(*SourceState)) SourceState {
	e.srcMu.Lock()
	defer e.srcMu.Unlock()
	st := e.sourceStates()
	s := st[id]
	if day := e.Now().Format("2006-01-02"); s.Day != day {
		s.Day, s.Used = day, 0
	}
	change(&s)
	st[id] = s
	e.S.Set(sourceStateKey, st)
	return s
}

// SourceKeyInput is what the Connections page sends for one source. An empty
// key or app ID keeps the saved one.
type SourceKeyInput struct {
	AppID string `json:"app_id"`
	Key   string `json:"key"`
	From  string `json:"from"`
	On    *bool  `json:"on"`
	Limit *int   `json:"limit"`
}

func tidyKey(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len(s) > 300 || strings.ContainsAny(s, " \t\r\n\"'<>") {
		return "", errors.New("that doesn't look like a key. Copy it again, without spaces around it")
	}
	return s, nil
}

// SetSource saves what the person entered for one of the keyed searches, or
// switches job-alert e-mails on or off.
func (e *Engine) SetSource(id string, in SourceKeyInput) error {
	_, keyed := keyedSources[id]
	if !keyed && id != srcAlerts {
		return store.ErrNotFound
	}
	key, err := tidyKey(in.Key)
	if err != nil {
		return err
	}
	appID, err := tidyKey(in.AppID)
	if err != nil {
		return err
	}
	e.srcMu.Lock()
	k := e.sourceKeys()
	changed := key != "" || appID != ""
	switch id {
	case "adzuna":
		k.AdzunaID, k.AdzunaKey = firstOf(appID, k.AdzunaID), firstOf(key, k.AdzunaKey)
		if k.AdzunaID == "" || k.AdzunaKey == "" {
			e.srcMu.Unlock()
			return errors.New("Adzuna needs both its Application ID and its Application Key")
		}
	case "jooble":
		k.Jooble = firstOf(key, k.Jooble)
	case "apify":
		k.Apify = firstOf(key, k.Apify)
		if appID != "" {
			k.ApifyActor = appID
		}
	case "jsearch":
		k.JSearch = firstOf(key, k.JSearch)
		from := sources.FromRapidAPI
		if in.From == sources.FromOpenWebNinja {
			from = sources.FromOpenWebNinja
		}
		changed = changed || (k.JSearch != "" && from != firstOf(k.JSearchFrom, sources.FromRapidAPI))
		k.JSearchFrom = from
	}
	if keyed && !k.forSources().Has(id) {
		e.srcMu.Unlock()
		return errors.New("paste the key first")
	}
	if in.On != nil {
		var off []string
		for _, x := range k.Off {
			if x != id {
				off = append(off, x)
			}
		}
		if !*in.On {
			off = append(off, id)
		}
		k.Off = off
	}
	if in.Limit != nil && keyed {
		if k.Limit == nil {
			k.Limit = map[string]int{}
		}
		delete(k.Limit, id)
		if n := *in.Limit; n > 0 && n != keyedSources[id].perDay {
			k.Limit[id] = min(n, 5000)
		}
	}
	err = e.S.Set(sourceKeysKey, k)
	e.srcMu.Unlock()
	if err != nil {
		return err
	}
	if changed || (in.On != nil && *in.On) {
		// A new key, or being switched on again, is asking to try again.
		e.setSourceState(id, func(s *SourceState) { s.Error, s.ErrorAt, s.RestUntil = "", 0, 0 })
	}
	if changed {
		e.S.Log(store.Activity{Kind: "source", Text: "Saved a key for " + keyedSources[id].name})
	}
	e.S.Changed("connections", "runs", "status")
	return nil
}

// ForgetSource removes the key saved for one search. Roles found there stay.
func (e *Engine) ForgetSource(id string) error {
	if _, ok := keyedSources[id]; !ok {
		return store.ErrNotFound
	}
	e.srcMu.Lock()
	k := e.sourceKeys()
	switch id {
	case "adzuna":
		k.AdzunaID, k.AdzunaKey = "", ""
	case "jooble":
		k.Jooble = ""
	case "jsearch":
		k.JSearch, k.JSearchFrom = "", ""
	case "apify":
		k.Apify, k.ApifyActor = "", ""
	}
	delete(k.Limit, id)
	err := e.S.Set(sourceKeysKey, k)
	st := e.sourceStates()
	delete(st, id)
	e.S.Set(sourceStateKey, st)
	e.srcMu.Unlock()
	e.S.Changed("connections", "runs", "status")
	return err
}

// keyedPlain says in plain words why a keyed search did not answer, and how
// long to leave it alone.
func keyedPlain(id string, err error) (string, time.Duration) {
	name := keyedSources[id].name
	switch {
	case errors.Is(err, sources.ErrKeyRefused):
		hint := "Copy it again from where you got it and save it here"
		if id == "adzuna" {
			hint = "The Application ID and the Application Key go together: copy both again"
		} else if id == "apify" {
			hint = "Copy the API token again from Apify's Settings, API & Integrations"
		} else if id == "jsearch" {
			hint = "Check that you are subscribed to JSearch, and that the right place is chosen under \"Key from\""
		}
		return name + " refused the key. " + hint, 24 * time.Hour
	case errors.Is(err, sources.ErrOutOfRequests):
		return name + " has no requests left for now on this key's plan. Job Hunt will try again later", 6 * time.Hour
	case errors.Is(err, sources.ErrNoCountry):
		return name + " has no listings for your country", 24 * time.Hour
	case errors.Is(err, sources.ErrNoKey):
		return name + " has no key saved", 0
	}
	var he *sources.HTTPError
	if errors.As(err, &he) || errors.Is(err, context.DeadlineExceeded) {
		return name + " " + plainErr(err), 0
	}
	return name + " couldn't be reached from this computer just now", 0
}

// keyedQuery is the search asked of a keyed source for one title.
func keyedQuery(p store.Profile, title string, within time.Duration) sources.Query {
	return sources.Query{Keywords: title, Location: strings.TrimSpace(strings.Split(p.City, ",")[0]), Country: countryCode(p.Country), Within: within}
}

// TestSource runs one tiny search, so the person knows now whether the key
// works. It reports how many postings came back.
func (e *Engine) TestSource(ctx context.Context, id string) (int, error) {
	if _, ok := keyedSources[id]; !ok {
		return 0, store.ErrNotFound
	}
	keys := e.sourceKeys().forSources()
	if !keys.Has(id) {
		return 0, errors.New("save the key first")
	}
	p := e.S.Profile()
	title := "manager"
	if all := p.Titles.All(); len(all) > 0 {
		title = all[0].Title
	}
	if id == "apify" {
		// Checked without running a scraper, which would cost.
		cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		if err := e.Src.TestApify(cctx, keys.Apify); err != nil {
			why, _ := keyedPlain(id, err)
			e.setSourceState(id, func(s *SourceState) { s.Error, s.ErrorAt = why, e.Now().Unix() })
			e.S.Changed("connections", "runs")
			return 0, errors.New(why)
		}
		e.setSourceState(id, func(s *SourceState) { s.Error, s.ErrorAt, s.RestUntil = "", 0, 0 })
		e.S.Changed("connections", "runs")
		return 0, nil
	}
	q := keyedQuery(p, title, 7*24*time.Hour)
	q.Max = 5
	if id == "adzuna" && !sources.AdzunaCovers(q.Country) {
		// The key can still be tried, somewhere Adzuna does have listings.
		q.Country, q.Location = "GB", ""
	}
	cctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	posts, err := e.Src.FindKeyed(cctx, id, keys, q)
	now := e.Now().Unix()
	if err != nil {
		why, rest := keyedPlain(id, err)
		// Out of requests means the key itself was accepted.
		if errors.Is(err, sources.ErrOutOfRequests) {
			e.setSourceState(id, func(s *SourceState) {
				s.Used++
				s.Error, s.ErrorAt, s.RestUntil = why, now, now+int64(rest/time.Second)
			})
			e.S.Changed("connections", "runs")
			return 0, errors.New(why)
		}
		e.setSourceState(id, func(s *SourceState) { s.Used++; s.Error, s.ErrorAt = why, now })
		e.S.Changed("connections", "runs")
		trace.Log("search", "test of %s failed: %v", id, err)
		return 0, errors.New(why)
	}
	e.setSourceState(id, func(s *SourceState) {
		s.Used++
		s.Error, s.ErrorAt, s.RestUntil = "", 0, 0
		if s.At == 0 {
			s.At, s.Seen, s.New = now, len(posts), 0
		}
	})
	e.S.Changed("connections", "runs")
	return len(posts), nil
}

// searchKeyed asks the keyed searches for the person's titles. A full search
// asks each for as many titles as its daily allowance leaves; a quick check
// asks only those that can be told "today's postings only", at most once an
// hour, and never spends more than half the day's allowance, so the full
// searches always have some left. When the titles do not all fit, the next
// search carries on where this one stopped.
func (e *Engine) searchKeyed(ctx context.Context, kind string, p store.Profile, within time.Duration, stats *RunStats, fresh *[]int64, note func(place string, seen, added int)) {
	k := e.sourceKeys()
	keys := k.forSources()
	var titles []string
	for _, bt := range p.Titles.All() {
		titles = append(titles, bt.Title)
	}
	if len(titles) == 0 {
		return
	}
	now := e.Now()
	slow := e.Src.Base == nil // tests answer at once
	for _, id := range sources.Keyed {
		src := keyedSources[id]
		if !keys.Has(id) || k.off(id) || ctx.Err() != nil {
			continue
		}
		if kind == "fast" && !src.fast {
			continue
		}
		st := e.setSourceState(id, func(*SourceState) {}) // rolls the day's count over
		if st.RestUntil > now.Unix() {
			if kind == "full" {
				stats.Problems = append(stats.Problems, firstOf(st.Error, src.name+" is resting"))
				stats.missed(id, firstOf(st.Error, src.name+" is resting"))
			}
			continue
		}
		limit := k.limit(id)
		n, w := min(len(titles), 8, limit-st.Used), within
		if kind == "fast" {
			if now.Unix()-st.FastAt < 3600 {
				continue
			}
			n, w = min(len(titles), 3, limit/2-st.Used), 2*time.Hour
		}
		if n <= 0 {
			continue // today's allowance is spent; not a problem
		}
		seen, added, answered, misses, used := 0, 0, false, 0, 0
		why, rest := "", time.Duration(0)
		for i := 0; i < n && ctx.Err() == nil; i++ {
			if i > 0 && slow {
				select {
				case <-ctx.Done():
				case <-time.After(2 * time.Second):
				}
			}
			title := titles[(st.Turn+i)%len(titles)]
			e.Report(ctx, i, n, src.name+": "+title)
			stats.Looked++
			used++
			wait := 40 * time.Second
			if id == "apify" {
				wait = 5 * time.Minute // a scraper run takes a minute or two
			}
			cctx, cancel := context.WithTimeout(ctx, wait)
			posts, err := e.Src.FindKeyed(cctx, id, keys, keyedQuery(p, title, w))
			cancel()
			if err != nil {
				if ctx.Err() != nil {
					break
				}
				why, rest = keyedPlain(id, err)
				stats.missed(id, why)
				trace.Log("search", "%s, %q: %v", id, title, err)
				if misses++; rest > 0 || misses >= 2 {
					break // a refused key or no answer at all: no point asking for every title
				}
				continue
			}
			answered = true
			got := e.takeFound(posts, src.name, p, stats, fresh)
			stats.saw(id, len(posts), got)
			seen, added = seen+len(posts), added+got
			note(src.name+": "+title, len(posts), got)
		}
		if why != "" {
			stats.Problems = append(stats.Problems, why)
		}
		e.setSourceState(id, func(s *SourceState) {
			s.Used += used
			s.Turn = (s.Turn + used) % len(titles)
			if kind == "fast" {
				s.FastAt = now.Unix()
			}
			if answered {
				s.At, s.Seen, s.New = now.Unix(), seen, added
			}
			if why != "" {
				s.Error, s.ErrorAt = why, now.Unix()
				if rest > 0 {
					s.RestUntil = now.Add(rest).Unix()
				}
			} else if answered {
				s.Error, s.ErrorAt, s.RestUntil = "", 0, 0
			}
		})
	}
}

// ---- what the Connections page shows -----------------------------------------------

// MoreSource is one row of the "More job sources" card. It says whether a
// key is saved, never what it is.
type MoreSource struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	About  string `json:"about"`
	Get    string `json:"get,omitempty"`
	Link   string `json:"link,omitempty"`
	HasKey bool   `json:"has_key"`
	From   string `json:"from,omitempty"`  // jsearch: where the key is from
	Actor  string `json:"actor,omitempty"` // apify: the scraper chosen, if not the usual one
	On     bool   `json:"on"`
	State  string `json:"state"` // "working" | "problem" | "off" | "none" | "waiting"
	Note   string `json:"note,omitempty"`
	At     int64  `json:"at,omitempty"`
	Seen   int    `json:"seen"`
	New    int    `json:"new"`
	Limit  int    `json:"limit,omitempty"` // requests a day
	Used   int    `json:"used"`            // made today
	Fast   bool   `json:"fast,omitempty"`  // also asked on quick checks
}

// MoreSources lists the keyed searches and job-alert e-mails for the
// Connections page.
func (e *Engine) MoreSources() []MoreSource {
	k, states := e.sourceKeys(), e.sourceStates()
	keys := k.forSources()
	today := e.Now().Format("2006-01-02")
	var out []MoreSource
	for _, id := range sources.Keyed {
		src, st := keyedSources[id], states[id]
		m := MoreSource{ID: id, Name: src.name, About: src.about, Get: src.get, Link: src.link, HasKey: keys.Has(id), On: !k.off(id), At: st.At, Seen: st.Seen, New: st.New,
			Limit: k.limit(id), Fast: src.fast}
		if st.Day == today {
			m.Used = st.Used
		}
		if id == "apify" {
			m.Actor = k.ApifyActor
		}
		if id == "jsearch" {
			m.From = firstOf(k.JSearchFrom, sources.FromRapidAPI)
		}
		switch {
		case !m.HasKey:
			m.State = "none"
		case !m.On:
			m.State = "off"
		case st.Error != "":
			m.State, m.Note = "problem", st.Error
		case st.At > 0:
			m.State = "working"
		default:
			m.State = "waiting"
		}
		out = append(out, m)
	}
	mail, st := e.MailSet(), states[srcAlerts]
	a := MoreSource{ID: srcAlerts, Name: "Job-alert e-mails", On: !k.off(srcAlerts), At: st.At, Seen: st.Seen, New: st.New,
		About: "The lists of new postings that LinkedIn, Indeed, Glassdoor, Job Bank, Eluta, Workopolis and ZipRecruiter send you. Job Hunt takes the postings out of them on this computer; the e-mails themselves are not passed to Claude."}
	switch {
	case !mail.On:
		a.State, a.Note = "none", "Needs your inbox connected, above."
	case !a.On:
		a.State = "off"
	case mail.Note != "":
		a.State, a.Note = "problem", mail.Note
	case st.At > 0:
		a.State = "working"
	default:
		a.State, a.Note = "waiting", "No job alert has arrived since the inbox was connected. Set alerts up on the job sites themselves."
	}
	return append(out, a)
}

// ---- what Radar shows ----------------------------------------------------------------

// SourceRow is one line of Radar's list of every kind of place Job Hunt looks.
type SourceRow struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	What  string `json:"what,omitempty"`  // how much of it there is: "42 employers", "5 sites"
	State string `json:"state"`           // "working" | "problem" | "off" | "none" | "waiting"
	Note  string `json:"note,omitempty"`  // the last error or why it is off, in plain words
	At    int64  `json:"at,omitempty"`    // when it was last asked
	Seen  int    `json:"seen"`            // postings it showed then
	New   int    `json:"new"`             // of those, new
	Setup string `json:"setup,omitempty"` // where it is set up, when it needs setting up
	// Failed names each place of this kind that didn't answer last time:
	// for employers' boards, "Maple Ledger: the board was not found".
	Failed []string `json:"failed,omitempty"`
}

// lastRun is what one kind of source gave in the newest search that asked it.
type lastRun struct {
	SourceRun
	At       int64
	Problems []string // every place that search found not answering
}

// lastBySource finds, for each kind of source, the newest finished search
// that asked it.
func (e *Engine) lastBySource() map[string]lastRun {
	out := map[string]lastRun{}
	full, _ := e.S.Runs("search:full", 6)
	fast, _ := e.S.Runs("search:fast", 12)
	runs := append(full, fast...)
	sort.Slice(runs, func(i, j int) bool { return runs[i].ID > runs[j].ID })
	for _, r := range runs {
		if r.EndedAt == 0 || len(r.Stats) == 0 {
			continue
		}
		var st RunStats
		if json.Unmarshal(r.Stats, &st) != nil {
			continue
		}
		for kind, sr := range st.BySource {
			if _, have := out[kind]; !have {
				out[kind] = lastRun{sr, r.EndedAt, st.Problems}
			}
		}
	}
	return out
}

// Sources lists every kind of place Job Hunt looks, with how each did the
// last time it was asked.
func (e *Engine) Sources() []SourceRow {
	p, ps, now := e.S.Profile(), e.placeSet(), e.Now().Unix()
	last := e.lastBySource()
	// fromRun fills a row from the last search that asked this kind.
	fromRun := func(r *SourceRow, kind string) {
		l, ok := last[kind]
		if !ok {
			r.State = "waiting"
			return
		}
		r.At, r.Seen, r.New = l.At, l.Seen, l.New
		switch {
		case l.Failed > 0 && l.Failed >= l.Looked:
			r.State, r.Note = "problem", l.Error
		case l.Failed > 0:
			r.State, r.Note = "working", fmt.Sprintf("%d of %d didn't answer last time. The last: %s", l.Failed, l.Looked, l.Error)
		default:
			r.State = "working"
		}
	}
	var rows []SourceRow

	boards := e.S.Count(`SELECT COUNT(*) FROM companies WHERE state = 'following' AND board_kind != ''`)
	b := SourceRow{ID: srcBoards, Name: "Employers' own job boards", What: countWord(boards, "employer")}
	if boards == 0 {
		b.What, b.State, b.Note = "", "none", "No employer you watch has a job board Job Hunt can read yet. Add employers under Employers."
	} else {
		fromRun(&b, srcBoards)
		if l, ok := last[srcBoards]; ok && l.Failed > 0 {
			names := map[string]bool{}
			if cs, err := e.S.Companies("following"); err == nil {
				for _, c := range cs {
					names[c.Name] = true
				}
			}
			for _, p := range l.Problems {
				if name, _, ok := strings.Cut(p, ": "); ok && names[name] {
					b.Failed = append(b.Failed, p)
				}
			}
		}
	}
	rows = append(rows, b)

	for _, id := range finders(p) {
		r := SourceRow{ID: id, Name: finderNames[id][0]}
		if id == "linkedin" {
			r.Name = "LinkedIn public search"
		}
		if ps.off(id) {
			r.State = "off"
			if l, ok := last[id]; ok {
				r.At, r.Seen, r.New = l.At, l.Seen, l.New
			}
		} else {
			fromRun(&r, id)
			if rest, ok := ps.Rest[id]; ok && rest.Until > now {
				r.State, r.Note = "problem", rest.Note
			}
			if st := e.searchState(); id == "linkedin" && st.LinkedInUntil > now {
				r.State, r.Note = "problem", firstOf(st.LinkedInNote, "LinkedIn is resting")
			}
		}
		rows = append(rows, r)
	}

	on, resting := 0, 0
	for _, s := range ps.Sites {
		if !s.Off {
			on++
			if rest, ok := ps.Rest[s.ID]; ok && rest.Until > now {
				resting++
			}
		}
	}
	s := SourceRow{ID: srcSites, Name: "Recruiters and job sites", What: countWord(on, "site")}
	switch {
	case len(ps.Sites) == 0:
		s.What, s.State, s.Note = "", "none", "None added yet. Add one with the button above this list."
	case on == 0:
		s.What, s.State = "", "off"
	default:
		fromRun(&s, srcSites)
		if resting > 0 && s.State == "working" && s.Note == "" {
			s.Note = fmt.Sprintf("%d of %d are being left alone for a while", resting, on)
		}
	}
	rows = append(rows, s)

	for _, m := range e.MoreSources() {
		r := SourceRow{ID: m.ID, Name: m.Name, State: m.State, Note: m.Note, At: m.At, Seen: m.Seen, New: m.New}
		if m.ID != srcAlerts {
			// A search says more than the Test button did.
			if l, ok := last[m.ID]; ok && l.At >= m.At && l.Failed < l.Looked {
				r.At, r.Seen, r.New = l.At, l.Seen, l.New
			}
			if m.State == "none" {
				r.Note = "Needs a key, which is free."
			}
			if m.State == "waiting" {
				r.Note = "Asked on the next full search."
			}
		}
		if m.State == "none" {
			r.Setup = "#/you/connections"
		}
		rows = append(rows, r)
	}
	return rows
}

// ---- job-alert e-mails ---------------------------------------------------------------

// alertsOn reports whether job alerts in the inbox are read for postings.
func (e *Engine) alertsOn() bool { return !e.sourceKeys().off(srcAlerts) }

// takeAlert records the postings read out of one job-alert e-mail, like the
// postings of any other source. It reports how many were new. Reading them
// against the CV is left to the usual pass over unread roles.
func (e *Engine) takeAlert(site string, posts []sources.Posting) (seen, added int) {
	p := e.S.Profile()
	stats := RunStats{Kind: "alert", ByPlace: map[string][2]int{}, ClearedBy: map[string]int{}}
	var fresh []int64
	var named []sources.Posting
	for _, post := range posts {
		// An alert that does not say who the employer is cannot be filed.
		if strings.TrimSpace(post.Company) != "" {
			named = append(named, post)
		}
	}
	added = e.takeFound(named, "", p, &stats, &fresh)
	trace.Log("search", "job alert from %s: %d postings, %d named, %d new, %d worth reading", site, len(posts), len(named), added, len(fresh))
	return len(named), added
}
