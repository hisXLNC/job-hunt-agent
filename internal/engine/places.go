package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// Places are where Job Hunt looks besides employers' own boards: the title
// searches (LinkedIn, Job Bank, FreeHire) and the job sites and recruiters
// the person has it watch.

const placesKey = "places"

// PlaceSite is a job site or a recruiter's site being watched.
type PlaceSite struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"` // may hold {title} and {place}
	Link    string `json:"link,omitempty"`
	Browser bool   `json:"browser,omitempty"`
	Kind    string `json:"kind"` // "Recruiter" or "Job site"
	About   string `json:"about,omitempty"`
	Off     bool   `json:"off,omitempty"`
}

func (s PlaceSite) site() sources.Site {
	return sources.Site{ID: s.ID, Name: s.Name, URL: s.URL, Link: s.Link, Browser: s.Browser}
}

// PlaceRest is a place left alone for a while because it asked, or broke.
type PlaceRest struct {
	Until int64  `json:"until"`
	Note  string `json:"note"`
}

type placeSet struct {
	Off   []string             `json:"off"` // title searches switched off
	Sites []PlaceSite          `json:"sites"`
	Rest  map[string]PlaceRest `json:"rest"`
}

func (e *Engine) placeSet() placeSet {
	var ps placeSet
	e.S.Get(placesKey, &ps)
	if ps.Rest == nil {
		ps.Rest = map[string]PlaceRest{}
	}
	return ps
}

func (ps placeSet) off(id string) bool {
	for _, x := range ps.Off {
		if x == id {
			return true
		}
	}
	return false
}

var finderNames = map[string][2]string{
	"linkedin": {"LinkedIn", "Its public job search, every title, newest first. Checked every 20 minutes for postings under two hours old."},
	"jobbank":  {"Job Bank", "The Government of Canada's job board. Many employers must post there."},
	"freehire": {"FreeHire", "A free index of postings gathered from employers' own job systems."},
}

// countryCode gives the two letters for the countries Job Hunt knows sources for.
func countryCode(country string) string {
	switch strings.ToLower(strings.TrimSpace(country)) {
	case "canada", "ca":
		return "CA"
	case "united states", "usa", "us", "united states of america":
		return "US"
	case "united kingdom", "uk", "great britain", "england":
		return "GB"
	}
	return ""
}

// provinceOf gives the two-letter province of the person's city, if known.
func provinceOf(p store.Profile) string {
	for _, r := range metros[cityOf(p)].Region {
		if len(r) == 2 {
			return strings.ToUpper(r)
		}
	}
	return ""
}

// finders lists the title searches that make sense for this person.
func finders(p store.Profile) []string {
	out := []string{"linkedin"}
	if countryCode(p.Country) == "CA" || p.Country == "" {
		out = append(out, "jobbank")
	}
	return append(out, "freehire")
}

// Place is one row of the list the person sees.
type Place struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"` // "Search", "Recruiter", "Job site"
	About     string `json:"about"`
	URL       string `json:"url,omitempty"`
	On        bool   `json:"on"`
	Mine      bool   `json:"mine"` // added by the person: can be removed
	Note      string `json:"note,omitempty"`
	RestUntil int64  `json:"rest_until,omitempty"`
	Seen      int    `json:"seen"` // postings in the last full search
	New       int    `json:"new"`
}

// PlacesView is what Radar shows.
type PlacesView struct {
	Places    []Place `json:"places"`
	Suggested []Place `json:"suggested"`
	Browser   bool    `json:"browser"` // a real browser is available for pages that need one
}

// Places lists where Job Hunt looks and what each place gave last time.
func (e *Engine) Places() PlacesView {
	ps, p, now := e.placeSet(), e.S.Profile(), e.Now().Unix()
	last := map[string][2]int{}
	if runs, _ := e.S.Runs("search:full", 1); len(runs) > 0 {
		var st RunStats
		json.Unmarshal(runs[0].Stats, &st)
		for place, n := range st.ByPlace {
			name, _, _ := strings.Cut(place, ": ")
			v := last[name]
			last[name] = [2]int{v[0] + n[0], v[1] + n[1]}
		}
	}
	rest := func(pl *Place) {
		if r, ok := ps.Rest[pl.ID]; ok && (r.Until > now || r.Until == 0) {
			pl.Note, pl.RestUntil = r.Note, r.Until
		}
	}
	view := PlacesView{Browser: e.Src.Render != nil}
	for _, id := range finders(p) {
		pl := Place{ID: id, Name: finderNames[id][0], Kind: "Search", About: finderNames[id][1], On: !ps.off(id), Seen: last[finderNames[id][0]][0], New: last[finderNames[id][0]][1]}
		rest(&pl)
		if id == "linkedin" {
			if st := e.searchState(); st.LinkedInUntil > now {
				pl.Note, pl.RestUntil = st.LinkedInNote, st.LinkedInUntil
			}
		}
		view.Places = append(view.Places, pl)
	}
	have := map[string]bool{}
	for _, s := range ps.Sites {
		have[s.ID] = true
		// Every watched site can be taken off the list again.
		pl := Place{ID: s.ID, Name: s.Name, Kind: s.Kind, About: s.About, URL: s.URL, On: !s.Off, Mine: true, Seen: last[s.Name][0], New: last[s.Name][1]}
		rest(&pl)
		view.Places = append(view.Places, pl)
	}
	cc := countryCode(p.Country)
	for _, k := range sources.Known {
		if have[k.ID] || (cc != "" && k.Country != cc) {
			continue
		}
		view.Suggested = append(view.Suggested, Place{ID: k.ID, Name: k.Name, Kind: k.Kind, About: k.About, URL: k.URL})
	}
	return view
}

// SetPlaceOn switches one place on or off.
func (e *Engine) SetPlaceOn(id string, on bool) error {
	ps := e.placeSet()
	found := false
	if _, ok := finderNames[id]; ok {
		found = true
		var off []string
		for _, x := range ps.Off {
			if x != id {
				off = append(off, x)
			}
		}
		if !on {
			off = append(off, id)
		}
		ps.Off = off
	}
	for i := range ps.Sites {
		if ps.Sites[i].ID == id {
			ps.Sites[i].Off, found = !on, true
		}
	}
	if !found {
		return store.ErrNotFound
	}
	if on {
		delete(ps.Rest, id) // switching it on again is asking to try again
		if id == "linkedin" {
			st := e.searchState()
			st.LinkedInUntil, st.LinkedInNote = 0, ""
			e.S.Set("search", st)
		}
	}
	e.S.Set(placesKey, ps)
	e.S.Changed("runs", "status")
	return nil
}

// AddSite starts watching a job site or recruiter: one of the suggested ones
// by its id, or any page by its address. The address may hold {title} and
// {place} where the site's own search takes them. The page is tried once,
// and the number of postings it showed comes back with a note in words when
// it showed none.
func (e *Engine) AddSite(ctx context.Context, id, name, raw string) (Place, int, string, error) {
	ps := e.placeSet()
	var s PlaceSite
	if k, ok := sources.KnownByID(id); ok && raw == "" {
		s = PlaceSite{ID: k.ID, Name: k.Name, URL: k.URL, Link: k.Link, Browser: k.Browser, Kind: k.Kind, About: k.About}
	} else {
		var err error
		if s, err = siteAt(name, raw, ps.Sites); err != nil {
			return Place{}, 0, "", err
		}
	}
	for _, x := range ps.Sites {
		if x.ID == s.ID {
			return Place{}, 0, "", errors.New("that site is already on the list")
		}
	}
	if len(ps.Sites) >= 40 {
		return Place{}, 0, "", errors.New("that is a lot of sites. Take one off the list first")
	}

	// Try it once, with the person's first title, so they know now whether it works.
	p := e.S.Profile()
	title := ""
	if all := p.Titles.All(); len(all) > 0 {
		title = all[0].Title
	}
	cctx, cancel := context.WithTimeout(ctx, 75*time.Second)
	defer cancel()
	posts, err := e.Src.ReadSite(cctx, s.site(), title, cityOf(p))
	note := ""
	switch {
	case err != nil:
		_, note = restFor(err, e.Src.Render != nil)
		if note == "" {
			note = "did not answer just now (" + plainErr(err) + ")"
		}
	case len(posts) == 0:
		note = "showed no postings Job Hunt could read"
		if s.site().Searches() {
			note += " for " + title
		}
	}
	ps.Sites = append(ps.Sites, s)
	if note != "" {
		ps.Rest[s.ID] = PlaceRest{Note: capFirst(note), Until: e.Now().Add(time.Hour).Unix()}
	}
	e.S.Set(placesKey, ps)
	e.S.Log(store.Activity{Kind: "source", Text: "Started watching " + s.Name})
	e.S.Changed("runs", "status")
	return Place{ID: s.ID, Name: s.Name, Kind: s.Kind, About: s.About, URL: s.URL, On: true, Mine: true, Note: capFirst(note)}, len(posts), note, nil
}

// siteAt makes a watched site from an address the person gave.
func siteAt(name, raw string, have []PlaceSite) (PlaceSite, error) {
	raw = strings.TrimSpace(raw)
	if raw != "" && !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	// The address is checked with its blanks filled, since a blank is not valid in one.
	probe := sources.Site{URL: raw}.Address("manager", "toronto")
	if _, ok := sources.PublicURL(probe); !ok {
		return PlaceSite{}, errors.New("that is not a web address Job Hunt can open. Paste the page's address from your browser, starting with https://")
	}
	u, _ := url.Parse(probe)
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	s := PlaceSite{ID: "site-" + strings.NewReplacer(".", "-").Replace(host), Name: strings.TrimSpace(name), URL: raw, Kind: "Job site"}
	if s.Name == "" {
		s.Name = host
	}
	if len(s.Name) > 60 {
		s.Name = s.Name[:60]
	}
	for n, base := 2, s.ID; ; n++ {
		clash := false
		for _, x := range have {
			clash = clash || (x.ID == s.ID && x.URL != s.URL)
		}
		if !clash {
			return s, nil
		}
		s.ID = fmt.Sprintf("%s-%d", base, n)
	}
}

// keepSites adds sites to the list without trying them first (the next full
// search does that). It returns how many were new.
func (e *Engine) keepSites(add []PlaceSite) int {
	ps, n := e.placeSet(), 0
	for _, s := range add {
		dup := len(ps.Sites) >= 40
		for _, x := range ps.Sites {
			dup = dup || x.ID == s.ID || x.URL == s.URL
		}
		if !dup {
			ps.Sites = append(ps.Sites, s)
			n++
		}
	}
	if n > 0 {
		e.S.Set(placesKey, ps)
	}
	return n
}

// RemoveSite stops watching a site. Roles already found there stay.
func (e *Engine) RemoveSite(id string) error {
	ps := e.placeSet()
	var keep []PlaceSite
	for _, s := range ps.Sites {
		if s.ID != id {
			keep = append(keep, s)
		}
	}
	if len(keep) == len(ps.Sites) {
		return store.ErrNotFound
	}
	ps.Sites = keep
	delete(ps.Rest, id)
	e.S.Set(placesKey, ps)
	e.S.Changed("runs", "status")
	return nil
}

// restFor says how long to leave a place alone after an error, and why, in
// words that follow the place's name. Zero means try again next time.
func restFor(err error, haveBrowser bool) (time.Duration, string) {
	var he *sources.HTTPError
	switch {
	case errors.Is(err, sources.ErrNeedsBrowser):
		if haveBrowser {
			return 6 * time.Hour, "turned Job Hunt away, even in a browser"
		}
		return 24 * time.Hour, "only opens in a real browser, and Job Hunt found neither Edge nor Chrome on this computer"
	case errors.Is(err, sources.ErrChanged):
		return 24 * time.Hour, "has changed its pages, and Job Hunt could not read them"
	case errors.Is(err, sources.ErrPrivateAddress):
		return 24 * time.Hour, "is not an address on the public internet"
	case errors.As(err, &he) && (he.Status == 429 || he.Status == 403 || he.Status == 503 || he.Status == 999):
		return 3 * time.Hour, "asked Job Hunt to slow down"
	case errors.As(err, &he) && he.Status == 404:
		return 24 * time.Hour, "has moved its search page"
	}
	return 0, ""
}

// searchPlaces runs the title searches other than LinkedIn and reads the
// watched sites. It belongs to a full search: these places are asked a few
// times a day, slowly, and left alone when they say so.
func (e *Engine) searchPlaces(ctx context.Context, p store.Profile, within time.Duration, stats *RunStats, fresh *[]int64, note func(place string, seen, added int)) {
	ps := e.placeSet()
	now := e.Now()
	slow := e.Src.Base == nil // tests answer at once and need no manners
	pause := func(d time.Duration) {
		if !slow {
			return
		}
		select {
		case <-ctx.Done():
		case <-time.After(d):
		}
	}
	resting := func(id string) bool {
		r, ok := ps.Rest[id]
		return ok && r.Until > now.Unix()
	}
	misses := map[string]int{}
	problem := func(text string) {
		for _, p := range stats.Problems {
			if p == text {
				return // said once is enough
			}
		}
		stats.Problems = append(stats.Problems, text)
	}
	failed := func(id, name string, err error) (stop bool) {
		d, why := restFor(err, e.Src.Render != nil)
		if d == 0 {
			problem(name + ": " + plainErr(err))
			misses[id]++
			return misses[id] >= 2 // not answering at all: no point asking for every title
		}
		ps.Rest[id] = PlaceRest{Until: now.Add(d).Unix(), Note: name + " " + why}
		problem(name + " " + why)
		return true
	}
	take := func(posts []sources.Posting, from string) (added int) {
		for _, post := range posts {
			name := firstOf(post.Company, from)
			comp, _, err := e.S.UpsertCompany(store.Company{Name: name, State: "suggested", Source: "posting"})
			if err != nil {
				continue
			}
			if comp.State == "muted" {
				stats.ClearedBy["An employer you muted"]++
				stats.Cleared++
				continue
			}
			post.Company = comp.Name
			// These searches match loosely, so the title rules decide what is kept.
			id, isNew, cleared := e.ingest(comp.ID, post, p, stats)
			if isNew {
				added++
				if !cleared {
					*fresh = append(*fresh, id)
				}
			}
		}
		stats.Seen += len(posts)
		return added
	}
	var titles []string
	for _, bt := range p.Titles.All() {
		titles = append(titles, bt.Title)
	}
	city := strings.TrimSpace(strings.Split(p.City, ",")[0])
	place := strings.TrimSpace(strings.Trim(p.City+", "+p.Country, ", "))

	for _, id := range finders(p) {
		if id == "linkedin" || ps.off(id) || ctx.Err() != nil {
			continue
		}
		name := finderNames[id][0]
		if resting(id) {
			stats.Problems = append(stats.Problems, firstOf(ps.Rest[id].Note, name+" is resting"))
			continue
		}
		asked := titles
		q := sources.Query{Location: place, Province: provinceOf(p), Country: countryCode(p.Country), Within: within}
		if id == "jobbank" {
			// Job Bank matches words loosely and limits how often it is asked.
			asked = sources.JobBankTitles(titles, 6)
			q.Within = max(within, 3*24*time.Hour)
		} else if len(asked) > 10 {
			asked = asked[:10]
		}
		ok := false
		for i, title := range asked {
			if ctx.Err() != nil {
				break
			}
			if i > 0 {
				pause(2 * time.Second)
			}
			stats.Looked++
			q.Keywords = title
			posts, err := e.Src.Find(ctx, id, q)
			if err != nil {
				if failed(id, name, err) {
					break
				}
				continue
			}
			ok = true
			note(name+": "+title, len(posts), take(posts, name))
		}
		if ok {
			delete(ps.Rest, id)
		}
	}

	for _, s := range ps.Sites {
		if s.Off || ctx.Err() != nil {
			continue
		}
		if resting(s.ID) {
			stats.Problems = append(stats.Problems, firstOf(ps.Rest[s.ID].Note, s.Name+" is resting"))
			continue
		}
		site := s.site()
		asked := []string{""}
		if site.Searches() {
			asked = titles
			if len(asked) > 6 {
				asked = asked[:6]
			}
		}
		ok, seen := false, 0
		for i, title := range asked {
			if ctx.Err() != nil {
				break
			}
			if i > 0 {
				pause(4 * time.Second)
			}
			stats.Looked++
			cctx, cancel := context.WithTimeout(ctx, 75*time.Second)
			posts, err := e.Src.ReadSite(cctx, site, title, city)
			cancel()
			if err != nil {
				if failed(s.ID, s.Name, err) {
					break
				}
				continue
			}
			ok = true
			seen += len(posts)
			where := s.Name
			if title != "" {
				where += ": " + title
			}
			note(where, len(posts), take(posts, s.Name))
		}
		if ok {
			delete(ps.Rest, s.ID)
			if seen == 0 {
				ps.Rest[s.ID] = PlaceRest{Note: s.Name + " showed no postings Job Hunt could read last time"}
			}
		}
	}

	// Only the resting notes changed here; the person may have switched
	// things meanwhile, so theirs are kept.
	cur := e.placeSet()
	cur.Rest = ps.Rest
	e.S.Set(placesKey, cur)
}
