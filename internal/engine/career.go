package engine

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// ---- career path ---------------------------------------------------------------------
//
// Claude reads where the CV can go and what each route asks for; every number
// of postings is counted here, from what Job Hunt has actually seen.

// careerDoc is the stored reading.
type careerDoc struct {
	brain.Career
	At  int64 `json:"at"`
	Web bool  `json:"web"`
	// CVs names the CVs the reading was made from: all the person had then.
	CVs []string `json:"cvs,omitempty"`
}

// enoughSeen is how many postings a route needs before its counts are shown.
const enoughSeen = 5

// CareerGapView is one gap with how often postings ask for it.
type CareerGapView struct {
	brain.CareerGap
	Asked int  `json:"asked"`
	Done  bool `json:"done"`
}

// CareerRouteView is one route with Job Hunt's own counts.
type CareerRouteView struct {
	brain.CareerRoute
	Gaps      []CareerGapView `json:"gaps"`
	Seen      int             `json:"seen"`      // postings for it in the last 90 days
	Enough    bool            `json:"enough"`    // Seen is enough to count gaps
	Searching bool            `json:"searching"` // all its titles are in the search
	Applied   int             `json:"applied"`
	Heard     int             `json:"heard"`
	Talks     int             `json:"talks"`
}

// CareerTryView is a title to try, and whether it is searched already.
type CareerTryView struct {
	brain.CareerTitle
	Searching bool `json:"searching"`
}

// CareerPage is everything the Career path page shows.
type CareerPage struct {
	Has     bool              `json:"has"`
	At      int64             `json:"at"`
	Web     bool              `json:"web"`
	Looking bool              `json:"looking"`
	CanLook bool              `json:"can_look"`
	Now     brain.CareerNow   `json:"now"`
	Routes  []CareerRouteView `json:"routes"`
	Try     []CareerTryView   `json:"try"`
	Note    string            `json:"note"`
	// CVs names the CVs the reading was made from. Every CV the person has
	// is read together; none is picked over the others.
	CVs []string `json:"cvs"`
	// How applications at the person's own level go, to compare with.
	Level struct {
		Applied int `json:"applied"`
		Heard   int `json:"heard"`
		Talks   int `json:"talks"`
	} `json:"level"`
}

var careerStop = map[string]bool{"of": true, "and": true, "the": true, "for": true, "in": true, "to": true, "a": true, "an": true, "at": true, "with": true}
var parenRe = regexp.MustCompile(`\([^)]*\)`)
var careerWordRe = regexp.MustCompile(`[a-z0-9+#]+`)

// titleWords are the words a posting's title must hold to be this title.
func titleWords(t string) []string {
	var out []string
	for _, w := range careerWordRe.FindAllString(strings.ToLower(parenRe.ReplaceAllString(t, " ")), -1) {
		if !careerStop[w] {
			out = append(out, w)
		}
	}
	return out
}

// sameTitle: a posting's title holds every word of the searched one.
func sameTitle(posting string, want []string) bool {
	if len(want) == 0 {
		return false
	}
	have := map[string]bool{}
	for _, w := range careerWordRe.FindAllString(strings.ToLower(posting), -1) {
		have[w] = true
		have[strings.TrimSuffix(w, "s")] = true
	}
	for _, w := range want {
		if !have[w] && !have[strings.TrimSuffix(w, "s")] {
			return false
		}
	}
	return true
}

func (e *Engine) careerDoc() (careerDoc, bool) {
	var d careerDoc
	ok, _ := e.S.Get("career", &d)
	return d, ok && d.At > 0
}

func (e *Engine) careerDone() map[string]int64 {
	m := map[string]int64{}
	e.S.Get("career:done", &m)
	return m
}

func searchedTitles(p store.Profile) map[string]bool {
	in := map[string]bool{}
	for _, t := range p.Titles.All() {
		in[strings.ToLower(strings.TrimSpace(t.Title))] = true
	}
	return in
}

// Career is the page: the stored reading with today's counts.
func (e *Engine) Career() CareerPage {
	pg := CareerPage{Looking: e.Busy("career"), CanLook: e.LLM().Engine != "", Routes: []CareerRouteView{}, Try: []CareerTryView{}}
	d, ok := e.careerDoc()
	if !ok {
		return pg
	}
	pg.Has, pg.At, pg.Web, pg.Now, pg.Note = true, d.At, d.Web, d.Now, d.Note
	if pg.CVs = d.CVs; len(pg.CVs) == 0 {
		pg.CVs = e.cvNames() // read before the names were kept: it read them all
	}
	since := e.Now().AddDate(0, 0, -90).Unix()
	roles, _ := e.S.RoleTexts(0)
	recent, _ := e.S.RoleTexts(since)
	done := e.careerDone()
	in := searchedTitles(e.S.Profile())
	for _, r := range roles {
		if r.Applied && r.Band == "level" {
			pg.Level.Applied++
			if heard(r.Stage) {
				pg.Level.Heard++
			}
			if r.Stage == "interview" || r.Stage == "offer" {
				pg.Level.Talks++
			}
		}
	}
	for _, rt := range d.Routes {
		v := CareerRouteView{CareerRoute: rt, Searching: len(rt.Titles) > 0}
		var wants [][]string
		for _, t := range rt.Titles {
			wants = append(wants, titleWords(t))
			if !in[strings.ToLower(t)] {
				v.Searching = false
			}
		}
		matches := func(title string) bool {
			for _, w := range wants {
				if sameTitle(title, w) {
					return true
				}
			}
			return false
		}
		var texts []string
		for _, r := range recent {
			if matches(r.Title) {
				v.Seen++
				texts = append(texts, strings.ToLower(r.Text))
			}
		}
		for _, r := range roles {
			if r.Applied && matches(r.Title) {
				v.Applied++
				if heard(r.Stage) {
					v.Heard++
				}
				if r.Stage == "interview" || r.Stage == "offer" {
					v.Talks++
				}
			}
		}
		v.Enough = v.Seen >= enoughSeen
		for _, g := range rt.Gaps {
			gv := CareerGapView{CareerGap: g, Done: done[g.ID] > 0}
			for _, t := range texts {
				for _, w := range g.Words {
					if strings.Contains(t, w) {
						gv.Asked++
						break
					}
				}
			}
			v.Gaps = append(v.Gaps, gv)
		}
		if v.Gaps == nil {
			v.Gaps = []CareerGapView{}
		}
		pg.Routes = append(pg.Routes, v)
	}
	for _, t := range d.Try {
		pg.Try = append(pg.Try, CareerTryView{CareerTitle: t, Searching: in[strings.ToLower(t.Title)]})
	}
	return pg
}

func heard(stage string) bool { return stage == "reply" || stage == "interview" || stage == "offer" }

// LookAtCareer asks Claude to read where the CV can go. It runs in the background.
func (e *Engine) LookAtCareer() error {
	if e.LLM().Engine == "" {
		return llm.ErrNotConnected
	}
	if cvs, _ := e.S.CVs(); len(cvs) == 0 {
		return errors.New("Add your CV under You first; the reading starts from it.")
	}
	e.Resume("career")
	e.Go("career", "Reading where your CV can go", func(ctx context.Context) error { return e.readCareer(ctx) })
	return nil
}

func (e *Engine) readCareer(ctx context.Context) error {
	e.Report(ctx, 0, 1, "Reading your CV and the postings Job Hunt has seen")
	since := e.Now().AddDate(0, 0, -90).Unix()
	recent, _ := e.S.RoleTexts(since)
	count := map[string]int{}
	name := map[string]string{}
	for _, r := range recent {
		t := strings.Join(strings.Fields(r.Title), " ")
		if t == "" || len(t) > 90 {
			continue
		}
		k := strings.ToLower(t)
		count[k]++
		name[k] = t
	}
	keys := make([]string, 0, len(count))
	for k := range count {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if count[keys[i]] != count[keys[j]] {
			return count[keys[i]] > count[keys[j]]
		}
		return keys[i] < keys[j]
	})
	var seen []string
	for _, k := range keys[:min(60, len(keys))] {
		seen = append(seen, fmt.Sprintf("%s (%d)", name[k], count[k]))
	}
	old, _ := e.careerDoc()
	done := e.careerDone()
	var before []string
	for _, r := range old.Routes {
		for _, g := range r.Gaps {
			mark := ""
			if done[g.ID] > 0 {
				mark = " (the person marked this done)"
			}
			before = append(before, fmt.Sprintf("%s: %s%s", g.ID, g.Gap, mark))
		}
	}
	web := e.canSearchWeb()
	out, err := e.brain.Career(ctx, brain.CareerInput{Person: e.Person(), Seen: seen, Before: before, Web: web})
	if err != nil {
		return err
	}
	out = tidyCareer(out, e.S.Profile())
	if len(out.Routes) == 0 {
		return errors.New("Claude's answer held no routes")
	}
	e.S.Set("career", careerDoc{Career: out, At: e.Now().Unix(), Web: web, CVs: e.cvNames()})
	e.S.Set("career:ladder", e.Now().Unix())
	// Marks stay on the gaps that are still there.
	keep := map[string]int64{}
	for _, r := range out.Routes {
		for _, g := range r.Gaps {
			if done[g.ID] > 0 {
				keep[g.ID] = done[g.ID]
			}
		}
	}
	e.S.Set("career:done", keep)
	e.S.Log(store.Activity{Kind: "career", Text: "Looked at where your CV can go: " + out.Routes[0].Title + " first"})
	e.S.Changed("career")
	return nil
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	s = strings.Trim(slugRe.ReplaceAllString(strings.ToLower(s), "-"), "-")
	if len(s) > 40 {
		s = strings.TrimRight(s[:40], "-")
	}
	return s
}

func cleanTitle(t string) string {
	t = strings.Join(strings.Fields(t), " ")
	if len(t) > 80 {
		t = strings.TrimSpace(t[:80])
	}
	return t
}

// tidyCareer keeps Claude's answer within bounds: no avoided titles, no
// repeats, valid bands, ids that are unique.
func tidyCareer(c brain.Career, p store.Profile) brain.Career {
	avoided := func(t string) bool {
		lt := strings.ToLower(t)
		for _, a := range p.Avoid {
			la := strings.ToLower(strings.TrimSpace(a))
			if la != "" && (strings.Contains(lt, la) || strings.Contains(la, lt)) {
				return true
			}
		}
		return false
	}
	band := func(b string) string {
		switch b {
		case "step_up", "sideways", "level":
			return b
		}
		return "sideways"
	}
	ids := map[string]bool{}
	var routes []brain.CareerRoute
	rec := false
	for _, r := range c.Routes {
		r.Title = cleanTitle(r.Title)
		if r.Title == "" || avoided(r.Title) || len(routes) == 3 {
			continue
		}
		r.Band = band(r.Band)
		r.Fit = max(0, min(100, r.Fit))
		var titles []string
		had := map[string]bool{}
		for _, t := range append([]string{r.Title}, r.Titles...) {
			t = cleanTitle(t)
			if t == "" || had[strings.ToLower(t)] || avoided(t) || len(titles) == 4 {
				continue
			}
			had[strings.ToLower(t)] = true
			titles = append(titles, t)
		}
		r.Titles = titles
		var gaps []brain.CareerGap
		for _, g := range r.Gaps {
			if strings.TrimSpace(g.Gap) == "" || len(gaps) == 4 {
				continue
			}
			g.ID = slug(g.ID)
			if g.ID == "" {
				g.ID = slug(g.Gap)
			}
			// The same gap under two routes keeps one id; two different gaps
			// under one id get told apart.
			if ids[g.ID] && !sameGapElsewhere(routes, g) {
				g.ID = slug(g.ID + "-" + g.Gap)
			}
			ids[g.ID] = true
			var words []string
			for _, w := range g.Words {
				w = strings.ToLower(strings.TrimSpace(w))
				if len(w) >= 3 && len(words) < 6 {
					words = append(words, w)
				}
			}
			g.Words = words
			gaps = append(gaps, g)
		}
		r.Gaps = gaps
		if r.Recommended && rec {
			r.Recommended = false
		}
		rec = rec || r.Recommended
		routes = append(routes, r)
	}
	if !rec && len(routes) > 0 {
		routes[0].Recommended = true
	}
	c.Routes = routes
	in := searchedTitles(p)
	var try []brain.CareerTitle
	had := map[string]bool{}
	for _, t := range c.Try {
		t.Title = cleanTitle(t.Title)
		k := strings.ToLower(t.Title)
		if t.Title == "" || had[k] || in[k] || avoided(t.Title) || len(try) == 5 {
			continue
		}
		had[k] = true
		t.Band = band(t.Band)
		try = append(try, t)
	}
	c.Try = try
	if c.Now.Pay < 0 {
		c.Now.Pay = 0
	}
	c.Now.Title = cleanTitle(c.Now.Title)
	return c
}

func sameGapElsewhere(routes []brain.CareerRoute, g brain.CareerGap) bool {
	for _, r := range routes {
		for _, x := range r.Gaps {
			if x.ID == g.ID {
				return true
			}
		}
	}
	return false
}

// MarkCareerGap marks a gap done, or not done.
func (e *Engine) MarkCareerGap(id string, done bool) error {
	d, ok := e.careerDoc()
	if !ok {
		return errors.New("There is no reading yet.")
	}
	found := false
	for _, r := range d.Routes {
		for _, g := range r.Gaps {
			found = found || g.ID == id
		}
	}
	if !found {
		return errors.New("That step is no longer on the plan.")
	}
	m := e.careerDone()
	if done {
		m[id] = e.Now().Unix()
	} else {
		delete(m, id)
	}
	e.S.Set("career:done", m)
	e.S.Changed("career")
	return nil
}

// SearchCareerTitles adds titles from the reading to what Job Hunt searches
// for: a whole route's (route >= 0), or one title to try.
func (e *Engine) SearchCareerTitles(route int, title string) ([]string, error) {
	d, ok := e.careerDoc()
	if !ok {
		return nil, errors.New("There is no reading yet.")
	}
	var add []brain.CareerTitle
	switch {
	case route >= 0 && route < len(d.Routes):
		for _, t := range d.Routes[route].Titles {
			add = append(add, brain.CareerTitle{Title: t, Band: d.Routes[route].Band})
		}
	case title != "":
		for _, t := range d.Try {
			if strings.EqualFold(t.Title, title) {
				add = append(add, t)
			}
		}
	}
	if len(add) == 0 {
		return nil, errors.New("That title is not in the reading.")
	}
	p := e.S.Profile()
	in := searchedTitles(p)
	var added []string
	for _, t := range add {
		if in[strings.ToLower(t.Title)] {
			continue
		}
		in[strings.ToLower(t.Title)] = true
		switch t.Band {
		case "step_up":
			p.Titles.StepUp = append(p.Titles.StepUp, t.Title)
		case "level":
			p.Titles.Level = append(p.Titles.Level, t.Title)
		default:
			p.Titles.Sideways = append(p.Titles.Sideways, t.Title)
		}
		added = append(added, t.Title)
	}
	if len(added) == 0 {
		return added, nil
	}
	if err := e.S.SaveProfile(p); err != nil {
		return nil, err
	}
	e.S.Log(store.Activity{Kind: "titles", Text: "Searching for " + strings.Join(added, ", ") + " too (from Career path)"})
	e.S.Changed("career", "you", "radar")
	return added, nil
}

// careerDue: the reading is from before this week's Monday.
func (e *Engine) careerDue(now time.Time) bool {
	d, _ := e.careerDoc()
	if d.At < weekStart(now).Unix() {
		return true
	}
	// A reading from before each route named its titles and ceiling is read
	// again once, so the pay shows where the route leads.
	return len(d.Routes) > 0 && d.Routes[0].CeilingTitle == "" && e.S.GetInt("career:ladder") == 0
}

// cvNames are the names of the person's CVs.
func (e *Engine) cvNames() []string {
	cvs, _ := e.S.CVs()
	names := []string{}
	for _, c := range cvs {
		names = append(names, firstOf(c.Name, c.Filename))
	}
	return names
}
