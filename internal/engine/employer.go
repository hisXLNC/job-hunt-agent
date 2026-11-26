package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// One employer's page: everything Job Hunt knows about it in one place.

// EmployerRole is a posting of theirs with its at-a-glance facts.
type EmployerRole struct {
	store.Role
	JobType  string `json:"job_type"`
	Division string `json:"division"`
	Open     bool   `json:"open"`
	PayYear  int    `json:"pay_year"`
}

// HistoryItem is one thing that happened between the person and the employer.
type HistoryItem struct {
	At       int64  `json:"at"`
	Kind     string `json:"kind"`
	Tone     string `json:"tone"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	RoleID   int64  `json:"role_id,omitempty"`
	PersonID int64  `json:"person_id,omitempty"`
	MailID   int64  `json:"mail_id,omitempty"`
	TalkID   int64  `json:"talk_id,omitempty"`
}

// EmployerReviews is what employees say in public, and when it was looked up.
type EmployerReviews struct {
	brain.Reviews
	At int64 `json:"at"`
}

type EmployerPage struct {
	Company   store.Company    `json:"company"`
	Site      string           `json:"site"`
	Roles     []EmployerRole   `json:"roles"`
	Open      int              `json:"open"`
	Applied   int              `json:"applied"`
	Talks     int              `json:"talks"`
	History   []HistoryItem    `json:"history"`
	People    []store.Person   `json:"people"`
	Signals   []store.Signal   `json:"signals"`
	Notes     string           `json:"notes"`
	Reviews   *EmployerReviews `json:"reviews,omitempty"`
	Looking   bool             `json:"looking"`
	CanLook   bool             `json:"can_look"`
	PayLow    int              `json:"pay_low"`
	PayHigh   int              `json:"pay_high"`
	Divisions []string         `json:"divisions"`
}

// Employer gathers one employer's page.
func (e *Engine) Employer(id int64) (EmployerPage, error) {
	c, err := e.S.Company(id)
	if err != nil {
		return EmployerPage{}, err
	}
	p := EmployerPage{Company: c, CanLook: e.canSearchWeb() || e.LLM().Engine == "demo", Looking: e.Busy(fmt.Sprintf("reviews:%d", id))}
	roles, _, _ := e.S.Roles(store.RoleFilter{CompanyID: id, Closed: []string{"", "no", "rejected", "expired", "withdrawn", "aside"}, Unread: true, Sort: "age", Limit: 300})
	seenDiv := map[string]bool{}
	for _, r := range roles {
		er := EmployerRole{Role: r, Open: r.Closed == "" && r.GoneAt == 0}
		if full, err := e.S.Role(r.ID); err == nil {
			er.JobType = JobType(r.Title, full.Description)
			var rd brain.Reading
			if json.Unmarshal(full.Reading, &rd) == nil {
				er.Division = divisionName(rd.Division)
			}
		}
		if er.Division != "" && !seenDiv[er.Division] {
			seenDiv[er.Division] = true
			p.Divisions = append(p.Divisions, er.Division)
		}
		if er.Open {
			p.Open++
		}
		if y := PayPerYear(r.Pay); y > 0 {
			er.PayYear = y
			if p.PayLow == 0 || y < p.PayLow {
				p.PayLow = y
			}
			if y > p.PayHigh {
				p.PayHigh = y
			}
		}
		if r.AppliedAt > 0 {
			p.Applied++
			p.History = append(p.History, HistoryItem{At: r.AppliedAt, Kind: "Applied", Title: r.Title, Detail: appliedHow(r), RoleID: r.ID})
		}
		if r.Closed == "rejected" {
			p.History = append(p.History, HistoryItem{At: r.StageAt, Kind: "They said no", Tone: "crit", Title: r.Title, Detail: r.ClosedWhy, RoleID: r.ID})
		}
		talks, _ := e.S.TalksForRole(r.ID)
		for _, t := range talks {
			p.Talks++
			p.History = append(p.History, HistoryItem{At: t.At, Kind: "Interview", Tone: "info", Title: firstOf(t.Title, r.Title), Detail: joinNonEmpty(" · ", t.Person, minutesWords(t.Minutes)), RoleID: r.ID, TalkID: t.ID})
		}
		p.Roles = append(p.Roles, er)
	}
	if sites, _ := e.employerSites(id); len(sites) > 0 {
		p.Site = sites[0]
	}
	mails, _, _ := e.S.Mails(store.MailFilter{Limit: 200})
	for _, m := range mails {
		if m.CompanyID == id {
			p.History = append(p.History, HistoryItem{At: m.At, Kind: "Message", Tone: "blue", Title: firstOf(m.FromName, "They") + " wrote to you", Detail: firstOf(m.Summary, m.Subject), MailID: m.ID, RoleID: m.RoleID})
		}
	}
	sort.SliceStable(p.History, func(i, j int) bool { return p.History[i].At > p.History[j].At })
	p.People, _ = e.S.People(store.PeopleFilter{CompanyID: id})
	p.Signals, _ = e.S.Signals(id, 6)
	e.S.Get(fmt.Sprintf("conote:%d", id), &p.Notes)
	var rv EmployerReviews
	if e.S.Get(fmt.Sprintf("coreviews:%d", id), &rv); rv.At != 0 {
		p.Reviews = &rv
	}
	return p, nil
}

func appliedHow(r store.Role) string {
	if d := r.AppliedAt - r.Age(); d > 0 && d < 86400 {
		return fmt.Sprintf("Applied %d hours after it was posted", max(int(d/3600), 1))
	}
	return ""
}

func minutesWords(n int) string {
	if n <= 0 {
		return ""
	}
	return fmt.Sprintf("%d min", n)
}

// divisionName keeps the name of a division out of the sentence describing it.
func divisionName(s string) string {
	s = strings.TrimSpace(s)
	for _, cut := range []string{":", " — ", " - ", ", which", " is ", " builds ", " runs ", " sits ", ". ", " ("} {
		if i := strings.Index(s, cut); i > 2 {
			s = s[:i]
		}
	}
	if len(s) > 34 || len(s) < 2 {
		return ""
	}
	return s
}

// SetEmployerNote keeps the person's own notes about an employer.
func (e *Engine) SetEmployerNote(id int64, text string) error {
	if _, err := e.S.Company(id); err != nil {
		return err
	}
	if len(text) > 8000 {
		text = text[:8000]
	}
	e.S.Set(fmt.Sprintf("conote:%d", id), text)
	return nil
}

// EmployerRating is the rating kept for an employer, 0 when none is known.
func (e *Engine) EmployerRating(id int64) float64 {
	var rv EmployerReviews
	e.S.Get(fmt.Sprintf("coreviews:%d", id), &rv)
	return rv.Rating
}

// LookUpReviews asks Claude to read what employees say in public about an
// employer. It runs in the background and can be stopped.
func (e *Engine) LookUpReviews(id int64) error {
	c, err := e.S.Company(id)
	if err != nil {
		return err
	}
	if !e.canSearchWeb() && e.LLM().Engine != "demo" {
		return errors.New("Claude needs to be connected to look this up")
	}
	e.Go(fmt.Sprintf("reviews:%d", id), "Reading what employees say about "+c.Name, func(ctx context.Context) error {
		return e.lookUpReviews(ctx, id)
	})
	return nil
}

// lookUpReviews reads what employees say about one employer, keeps it, and
// applies the person's lowest rating to its roles. Both the "Look it up"
// button and the lookups Job Hunt makes by itself come here.
func (e *Engine) lookUpReviews(ctx context.Context, id int64) error {
	c, err := e.S.Company(id)
	if err != nil {
		return err
	}
	e.StepTakes(ctx, 45*time.Second)
	e.Report(ctx, 0, 1, "Looking at public employee reviews")
	rv, err := e.brain.Reviews(ctx, c.Name, c.Site, e.S.Profile().City)
	if err != nil {
		return err
	}
	for i := range rv.Sources {
		rv.Sources[i].URL = safeURL(rv.Sources[i].URL)
	}
	if rv.Rating < 0 || rv.Rating > 5 {
		rv.Rating = 0
	}
	e.S.Set(fmt.Sprintf("coreviews:%d", id), EmployerReviews{Reviews: rv, At: e.Now().Unix()})
	e.applyRatingFloor([]int64{id})
	e.S.Changed("companies", "today", "roles")
	return nil
}

// ---- employer pictures --------------------------------------------------------------

var logoMu sync.Mutex
var logoBusy = map[int64]bool{}
var logoSlots = make(chan struct{}, 3)

// Logo returns an employer's picture from its own site, kept on disk after
// the first time. ok is false when it has none (the letter tile is shown).
func (e *Engine) Logo(ctx context.Context, id int64) (data []byte, kind string, ok bool) {
	dir := filepath.Join(e.Dir, "logos3") // "logos" and "logos2" held some pictures of other sites taken for employers
	file := filepath.Join(dir, fmt.Sprint(id))
	e.forgetNoLogos(dir)
	if b, err := os.ReadFile(file); err == nil {
		if len(b) == 0 {
			if st, err := os.Stat(file); err == nil && time.Since(st.ModTime()) < 7*24*time.Hour {
				return nil, "", false // looked lately, none found
			}
		} else {
			return b, httpKind(b), true
		}
	}
	logoMu.Lock()
	if logoBusy[id] {
		// Another page asked a moment ago: wait for that look rather than answer "none".
		logoMu.Unlock()
		for range 60 {
			select {
			case <-ctx.Done():
				return nil, "", false
			case <-time.After(500 * time.Millisecond):
			}
			if b, err := os.ReadFile(file); err == nil {
				if len(b) == 0 {
					return nil, "", false
				}
				return b, httpKind(b), true
			}
		}
		return nil, "", false
	}
	logoBusy[id] = true
	logoMu.Unlock()
	defer func() { logoMu.Lock(); delete(logoBusy, id); logoMu.Unlock() }()
	// The look goes on when the page that asked is redrawn and stops waiting,
	// so the answer is kept for the next time.
	ctx = context.WithoutCancel(ctx)

	sites, guesses := e.employerSites(id)
	shown := e.shownLogo(id)
	os.MkdirAll(dir, 0o700)
	if strings.TrimSpace(e.companyName(id)) == "" && len(sites)+len(guesses) == 0 && shown == "" {
		os.WriteFile(file, nil, 0o600)
		return nil, "", false
	}
	select {
	case logoSlots <- struct{}{}:
		defer func() { <-logoSlots }()
	case <-ctx.Done():
		return nil, "", false
	}
	name := ""
	if c, err := e.S.Company(id); err == nil {
		name = c.Name
	}
	var b []byte
	var err error
	try := func(site, mustName string) bool {
		cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
		defer cancel()
		b, kind, err = e.Src.Logo(cctx, site, mustName)
		if err != nil {
			trace.Log("fetch", "no picture for employer %d from %s: %v", id, site, err)
		}
		return err == nil
	}
	found := false
	from := ""
	// First the logo a job source showed beside its posting (LinkedIn, Google for
	// Jobs): the employer's real logo, where a site's icon can be a tiny mark.
	if !found && shown != "" && ctx.Err() == nil {
		cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
		b, kind, err = e.Src.LogoFrom(cctx, shown)
		cancel()
		if found = err == nil; found {
			from = "the job source's logo"
		} else {
			trace.Log("fetch", "no picture for employer %d from the job source's logo: %v", id, err)
		}
	}
	for _, s := range sites {
		if found {
			break
		}
		if found = try(s, ""); found {
			from = s
			break
		}
	}
	// Then the website found from the name (Clearbit's company suggestions),
	// whose icon comes from the site or from Google's copy of it.
	if !found && ctx.Err() == nil {
		if d := e.foundDomain(ctx, id, name); d != "" {
			cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			b, kind, err = e.Src.IconOf(cctx, d)
			cancel()
			if found = err == nil; found {
				from = d + " (found from the name)"
			} else {
				trace.Log("fetch", "no picture for employer %d from %s: %v", id, d, err)
			}
		}
	}
	for _, s := range guesses {
		if found || ctx.Err() != nil {
			break
		}
		if found = try(s, name); found {
			from = s + " (guessed from the name)"
		}
	}
	if found {
		trace.Log("fetch", "picture for employer %d (%s) taken from %s", id, name, from)
	}
	if !found {
		if ctx.Err() == nil {
			os.WriteFile(file, nil, 0o600)
		}
		return nil, "", false
	}
	os.WriteFile(file, b, 0o600)
	return b, kind, true
}

func httpKind(b []byte) string { return http.DetectContentType(b) }

// employerSites are the employer's own sites, surest first: the one kept for
// it, then the sites its postings link to that carry its name. guesses are
// addresses made from its name, to be checked before use.
func (e *Engine) employerSites(id int64) (sites, guesses []string) {
	c, err := e.S.Company(id)
	if err != nil {
		return nil, nil
	}
	seen := map[string]bool{}
	add := func(s string) {
		if s != "" && !seen[s] && sources.Belongs(s, c.Name) {
			seen[s] = true
			sites = append(sites, s)
		}
	}
	if s := sources.OwnSite(c.Site); s != "" && (c.Source == "you" || sources.Belongs(s, c.Name)) { // the person's own choice stands
		seen[s] = true
		sites = append(sites, s)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{CompanyID: id, Closed: []string{"", "no", "rejected", "expired", "withdrawn", "aside"}, Unread: true, Limit: 20})
	for _, r := range roles {
		add(sources.OwnSite(r.ApplyURL))
		add(sources.OwnSite(r.URL))
	}
	for _, g := range sources.Guesses(c.Name) {
		if !seen[g] {
			guesses = append(guesses, g)
		}
	}
	return sites, guesses
}

func logoKey(id int64) string { return fmt.Sprintf("logo_url:%d", id) }

// shownLogo is the logo address a job source last showed for the employer.
func (e *Engine) shownLogo(id int64) string {
	var u string
	e.S.Get(logoKey(id), &u)
	return u
}

// noteEmployerLooks keeps what a posting says about how its employer looks:
// the logo its source shows (its address changes, so the latest is kept) and
// the employer's own website, when the employer has none yet.
func (e *Engine) noteEmployerLooks(id int64, post sources.Posting) {
	if id == 0 {
		return
	}
	if post.Logo != "" && post.Logo != e.shownLogo(id) {
		e.S.Set(logoKey(id), post.Logo)
		// "None found" was decided without this address: look again.
		file := filepath.Join(e.Dir, "logos3", fmt.Sprint(id))
		if st, err := os.Stat(file); err == nil && st.Size() == 0 {
			os.Remove(file)
		}
	}
	if post.Site != "" {
		if c, err := e.S.Company(id); err == nil && c.Site == "" && sources.Belongs(post.Site, c.Name) {
			c.Site = post.Site
			e.S.SaveCompany(c)
		}
	}
}

func (e *Engine) companyName(id int64) string {
	if c, err := e.S.Company(id); err == nil {
		return c.Name
	}
	return ""
}

// foundDomain is the employer's website as found from its name, looked up
// once and kept ("-" kept when none was found, asked again after a month).
func (e *Engine) foundDomain(ctx context.Context, id int64, name string) string {
	key := fmt.Sprintf("logo_domain:%d", id)
	var kept struct {
		Domain string `json:"domain"`
		At     int64  `json:"at"`
	}
	if ok, _ := e.S.Get(key, &kept); ok && kept.At > 0 && (kept.Domain != "-" || time.Since(time.Unix(kept.At, 0)) < 30*24*time.Hour) {
		if kept.Domain == "-" {
			return ""
		}
		return kept.Domain
	}
	if strings.TrimSpace(name) == "" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	d, err := e.Src.FindDomain(cctx, name)
	cancel()
	if err != nil && !strings.Contains(err.Error(), "no website found") {
		trace.Log("fetch", "no website found for employer %d: %v", id, err)
		return "" // asked again next time
	}
	kept.Domain, kept.At = firstOf(d, "-"), time.Now().Unix()
	e.S.Set(key, kept)
	return d
}

// forgetNoLogos clears, once, the "none found" marks made before employers'
// websites were found from their names, so each is looked for again.
var noLogosOnce sync.Once

func (e *Engine) forgetNoLogos(dir string) {
	noLogosOnce.Do(func() {
		var done bool
		if e.S.Get("logo_none_cleared_56", &done); done {
			return
		}
		ents, _ := os.ReadDir(dir)
		for _, en := range ents {
			if fi, err := en.Info(); err == nil && fi.Size() == 0 {
				os.Remove(filepath.Join(dir, en.Name()))
			}
		}
		e.S.Set("logo_none_cleared_56", true)
	})
}
