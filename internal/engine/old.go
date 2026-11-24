package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/old"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// Bringing things over from the previous Job Hunt. The old data is only
// read. Everything can be run again without making anything twice, so a
// person who connects Claude later can press the button again for their CVs.

// OldLook is what the old Job Hunt holds, before anything is brought over.
type OldLook struct {
	Found         bool       `json:"found"`
	Where         string     `json:"where"`
	Name          string     `json:"name"`
	Applied       int        `json:"applied"`        // applied, in interviews, offers, turned down
	Prepared      int        `json:"prepared"`       // CV and letter written, not yet sent
	Open          int        `json:"open"`           // found or saved, not acted on
	NotInterested int        `json:"not_interested"` // the person said no
	CVs           []string   `json:"cvs"`
	People        int        `json:"people"`
	Claude        string     `json:"claude"` // how the old one reached Claude and whether that can be reused: "", "key", "subscription"
	Busy          bool       `json:"busy"`   // things are being brought over right now
	Last          *OldResult `json:"last,omitempty"`
}

// OldResult is what one run brought over.
type OldResult struct {
	At            int64    `json:"at"`
	Where         string   `json:"where"`
	Roles         int      `json:"roles"`
	Applied       int      `json:"applied"`
	Prepared      int      `json:"prepared"`
	NotInterested int      `json:"not_interested"`
	LeftBehind    int      `json:"left_behind"` // old postings nobody acted on
	CVs           int      `json:"cvs"`
	CVsWaiting    int      `json:"cvs_waiting"` // CV files found but not read: Claude is not connected
	People        int      `json:"people"`
	Talks         int      `json:"talks"`
	Facts         int      `json:"facts"`
	Employers     int      `json:"employers"`
	Muted         int      `json:"muted"`
	Sites         int      `json:"sites"`
	Claude        string   `json:"claude"` // "" or how Claude was connected from the old settings
	Notes         []string `json:"notes"`  // anything that did not come over, in words
}

const oldDoneKey = "old.imported"

func (e *Engine) oldOpen(path string) (*old.Source, error) {
	if path == "" {
		path = old.Default()
	}
	if path == "" {
		return nil, errors.New("the old Job Hunt's data was not found on this computer. Choose a backup it made, or its data folder")
	}
	return old.Open(path, filepath.Join(e.Dir, "tmp"))
}

// LookAtOld reports what the old Job Hunt holds. An empty path means the
// place the old app keeps its data on this computer.
func (e *Engine) LookAtOld(path string) (OldLook, error) {
	if path == "" {
		// Pages ask often; the old data is copied aside for each real look.
		e.mu.Lock()
		seen, at := e.oldSeen, e.oldSeenAt
		e.mu.Unlock()
		if seen != nil && time.Since(at) < time.Minute {
			return *seen, nil
		}
	}
	if !e.oldMu.TryLock() {
		return OldLook{Busy: true}, nil
	}
	e.oldMu.Unlock()
	look, err := e.lookAtOld(path)
	if err == nil && path == "" {
		e.mu.Lock()
		e.oldSeen, e.oldSeenAt = &look, time.Now()
		e.mu.Unlock()
	}
	return look, err
}

func (e *Engine) lookAtOld(path string) (OldLook, error) {
	var look OldLook
	var last OldResult
	if ok, _ := e.S.Get(oldDoneKey, &last); ok {
		look.Last = &last
	}
	if path == "" && old.Default() == "" {
		return look, nil
	}
	src, err := e.oldOpen(path)
	if err != nil {
		return look, err
	}
	defer src.Close()
	look.Found, look.Where = true, src.Where
	p := src.Profile()
	look.Name = p.Name
	now := e.Now()
	src.Jobs(nil, func(j old.Job) error {
		switch m := mapOld(j, now); {
		case !m.keep:
		case m.closed == "no":
			look.NotInterested++
		case m.applied:
			look.Applied++
		case m.stage == "ready":
			look.Prepared++
		case m.closed == "":
			look.Open++
		}
		return nil
	})
	for _, t := range p.Tracks {
		if name, _, ok := src.CV(t); ok {
			look.CVs = append(look.CVs, name)
		}
	}
	look.People = len(src.Recruiters())
	switch {
	case src.KV("claude.engine") != "code" && src.KV("claude.key") != "":
		look.Claude = "key"
	case src.KV("claude.engine") == "code":
		look.Claude = "subscription"
	}
	return look, nil
}

// oldMapped is where an old job lands here.
type oldMapped struct {
	keep, applied, saved bool
	stage, closed, why   string
}

// mapOld decides what an old job becomes. Two things are fixed: a job the
// person said no to stays said no to, and a job they applied to or prepared
// keeps everything, however old it is.
func mapOld(j old.Job, now time.Time) oldMapped {
	age := now.Sub(firstTime(j.Found, j.Updated))
	switch j.Status {
	case "ready", "approved":
		return oldMapped{keep: true, stage: "ready"}
	case "applied":
		return oldMapped{keep: true, applied: true, stage: "applied"}
	case "no_response":
		return oldMapped{keep: true, applied: true, stage: "applied", closed: "expired", why: "No reply (marked in the old Job Hunt)"}
	case "interviewing":
		return oldMapped{keep: true, applied: true, stage: "interview"}
	case "offer":
		return oldMapped{keep: true, applied: true, stage: "offer"}
	case "rejected":
		return oldMapped{keep: true, applied: true, stage: "applied", closed: "rejected", why: "They said no (recorded in the old Job Hunt)"}
	case "dismissed":
		return oldMapped{keep: true, stage: "found", closed: "no", why: "You said not interested in the old Job Hunt"}
	case "saved":
		return oldMapped{keep: true, saved: true, stage: "found"}
	case "queued":
		// Found and never opened: only the recent ones are still worth a look.
		return oldMapped{keep: age < 30*24*time.Hour, stage: "found"}
	case "skipped":
		return oldMapped{keep: age < 45*24*time.Hour, stage: "found", closed: "screened", why: "Set aside by the old Job Hunt"}
	}
	return oldMapped{}
}

func firstTime(ts ...time.Time) time.Time {
	for _, t := range ts {
		if !t.IsZero() {
			return t
		}
	}
	return time.Time{}
}

func unix(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Unix()
}

// OldCV is the "old_cv" document of a role: the CV file the old Job Hunt
// wrote for it, kept as it was sent.
type OldCV struct {
	Name string `json:"name"`
	Data []byte `json:"data"`
}

// OldCVFile returns the CV the old Job Hunt wrote for a role.
func (e *Engine) OldCVFile(roleID int64) (File, error) {
	var doc OldCV
	ok, err := e.S.Doc(roleID, "old_cv", &doc)
	if err != nil {
		return File{}, err
	}
	if !ok || len(doc.Data) == 0 {
		return File{}, store.ErrNotFound
	}
	return File{Name: doc.Name, Data: doc.Data}, nil
}

// ImportOld brings over what the old Job Hunt kept: how Claude is reached,
// who the person is and what they look for, their CVs, the jobs they acted
// on (with the posting text, letter and CV), the people who wrote to them,
// and their interviews.
//
// shown is what to call the source afterwards when path is a working file
// (an uploaded backup); empty means the path itself.
func (e *Engine) ImportOld(ctx context.Context, path, shown string) (OldResult, error) {
	if !e.oldMu.TryLock() {
		return OldResult{}, errors.New("already bringing things over. Give it a few minutes")
	}
	defer e.oldMu.Unlock()
	defer func() {
		e.mu.Lock()
		e.oldSeen = nil
		e.mu.Unlock()
	}()
	src, err := e.oldOpen(path)
	if err != nil {
		return OldResult{}, err
	}
	defer src.Close()
	now := e.Now()
	res := OldResult{At: now.Unix(), Where: firstOf(shown, src.Where)}
	op := src.Profile()

	// 1. Claude, the way the old one reached it, if nothing is set here yet.
	if e.LLM().Engine == "" {
		set := e.LLM()
		if key := strings.TrimSpace(src.KV("claude.key")); key != "" && src.KV("claude.engine") != "code" {
			set.Engine, set.Key = "api", key
			res.Claude = "your API key"
		} else if cli, _ := llm.FindCLI(); cli != "" {
			set.Engine, set.CLI = "claude-code", cli
			res.Claude = "your Claude subscription"
		}
		if set.Engine != "" {
			if err := e.SetLLM(set); err != nil {
				return res, err
			}
		}
	}

	// 2. Who the person is and where they look. Only blanks are filled:
	// anything already said here stands.
	prof := e.S.Profile()
	if prof.Name == "" {
		prof.Name = strings.TrimSpace(op.Name)
	}
	if prof.City == "" && len(op.Locations) > 0 {
		prof.City, prof.Country = oldPlace(op.Locations[0])
		for _, l := range op.Locations[1:] {
			if c, _ := oldPlace(l); c != "" && !strings.EqualFold(c, prof.City) && !hasFold(prof.Places, c) {
				prof.Places = append(prof.Places, c)
			}
		}
		if !op.RemoteOK {
			prof.Workplaces = []string{"hybrid", "onsite"}
		}
	}
	if prof.PayFloor == 0 && op.MinSalary >= 1000 {
		prof.PayFloor = int(op.MinSalary)
	}
	for _, w := range op.ExcludeTitleKeywords {
		if w = strings.TrimSpace(w); w != "" && !hasFold(prof.Avoid, w) {
			prof.Avoid = append(prof.Avoid, w)
		}
	}
	if err := e.S.SaveProfile(prof); err != nil {
		return res, err
	}

	// 3. CVs. Each is read by Claude the same way a newly added one is.
	have, _ := e.S.CVs()
	connected := e.LLM().Engine != ""
	for _, t := range op.Tracks {
		name, data, ok := src.CV(t)
		if !ok {
			continue
		}
		dup := false
		for _, c := range have {
			dup = dup || strings.EqualFold(c.Filename, name)
		}
		if dup {
			continue
		}
		if !connected {
			res.CVsWaiting++
			continue
		}
		if _, _, err := e.AddCV(ctx, name, data); err != nil {
			res.Notes = append(res.Notes, fmt.Sprintf("Your CV %q could not be read: %s", name, plainErr(err)))
			if stopsWork(err) {
				res.CVsWaiting++
				connected = false
			}
			continue
		}
		res.CVs++
	}
	if res.CVsWaiting > 0 {
		res.Notes = append(res.Notes, fmt.Sprintf("%s still to read. Connect Claude, then bring things over again: nothing is added twice.", countWord(res.CVsWaiting, "CV")))
	}

	// The titles the old one searched for, added to whatever the CVs suggested.
	prof = e.S.Profile()
	for _, t := range op.Tracks {
		for _, title := range t.Titles {
			title = strings.TrimSpace(title)
			if title == "" || hasFold(prof.Titles.Level, title) || hasFold(prof.Titles.StepUp, title) || hasFold(prof.Titles.Sideways, title) {
				continue
			}
			prof.Titles.Level = append(prof.Titles.Level, title)
		}
	}
	if err := e.S.SaveProfile(prof); err != nil {
		return res, err
	}

	// 4. What the old one was told about the person.
	res.Facts = e.oldFacts(op)

	// 5. Employers never to show.
	for _, name := range op.ExcludeCompanies {
		if strings.TrimSpace(name) == "" {
			continue
		}
		c, fresh, err := e.S.UpsertCompany(store.Company{Name: name, State: "muted", Source: "old"})
		if err != nil {
			continue
		}
		if !fresh && c.State != "muted" {
			c.State = "muted"
			e.S.SaveCompany(c)
		}
		res.Muted++
	}
	// 6. Jobs.
	ids := map[string]int64{} // old job id → role here
	err = src.Jobs(nil, func(j old.Job) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		m := mapOld(j, now)
		if !m.keep || strings.TrimSpace(j.Company) == "" || strings.TrimSpace(j.Title) == "" {
			if j.Status == "queued" || j.Status == "skipped" {
				res.LeftBehind++
			}
			return nil
		}
		key := oldKey(j)
		if id, _, seen := e.S.SeenRole(key); seen {
			ids[j.ID] = id
			return nil
		}
		state := "suggested"
		if m.stage == "interview" || m.stage == "offer" {
			state = "following"
		}
		c, _, err := e.S.UpsertCompany(store.Company{Name: j.Company, State: state, Source: "old"})
		if err != nil {
			return nil
		}
		// A role already here under another name for the same posting. One the
		// person said no to in the old app is still closed here.
		if id, closed, dup := e.S.SimilarRole(c.ID, j.Title, j.Location); dup {
			ids[j.ID] = id
			if m.closed == "no" && closed != "no" {
				e.S.CloseRole(id, "no", m.why)
				res.NotInterested++
			}
			return nil
		}
		reading := brain.Reading{Fit: j.Score, Summary: strings.TrimSpace(j.Reasoning), Concerns: j.RedFlags, Keywords: j.Keywords}
		rb, _ := json.Marshal(reading)
		r := store.Role{
			CompanyID: c.ID, Key: key, Source: j.Source, Title: j.Title, Location: j.Location, Workplace: workplaceWord(j.Location),
			Pay: j.Salary, URL: safeURL(j.URL), ApplyURL: safeURL(j.ApplyURL), Description: j.Description,
			PostedAt: unix(j.Posted), FirstSeenAt: unix(firstTime(j.Found, j.Updated, now)), LastSeenAt: unix(firstTime(j.Updated, j.Found, now)),
			Applicants: -1, Stage: m.stage, Closed: m.closed, ClosedWhy: m.why, Saved: m.saved,
			Fit: j.Score, FitTailored: j.ScoreAfter, Reading: rb,
		}
		r.StageAt = unix(firstTime(j.Closed, j.Updated, j.Found, now))
		if m.applied {
			r.AppliedAt = unix(firstTime(j.Applied, j.Updated, j.Found, now))
		}
		if r.Fit < 0 || r.Fit > 100 {
			r.Fit, r.Reading = -1, nil
			if m.stage == "found" && m.closed == "" {
				r.Stage = "new" // never read: read it here
			}
		}
		if r.FitTailored > 100 {
			r.FitTailored = -1
		}
		id, err := e.S.ImportRole(r)
		if err != nil {
			return nil
		}
		ids[j.ID] = id
		res.Roles++
		switch {
		case m.closed == "no":
			res.NotInterested++
		case m.applied:
			res.Applied++
		case m.stage == "ready":
			res.Prepared++
		}

		if text := strings.TrimSpace(j.CoverLetter); text != "" {
			e.S.SaveDoc(id, "letter", LetterDoc{Text: text})
		}
		if data, ok := src.File(j.CVPath); ok {
			e.S.SaveDoc(id, "old_cv", OldCV{Name: fileNameExt(strings.TrimPrefix(filepath.Ext(strings.ReplaceAll(j.CVPath, `\`, "/")), "."), firstOf(prof.Name, "CV"), j.Company), Data: data})
		}
		e.S.Log(store.Activity{At: r.FirstSeenAt, Kind: "added", RoleID: id, CompanyID: c.ID, Text: "Found by the old Job Hunt"})
		for _, ev := range src.Events(j.ID, 12) {
			if text := oldEvent(ev); text != "" && !ev.At.IsZero() {
				e.S.Log(store.Activity{At: ev.At.Unix(), Kind: "old", RoleID: id, CompanyID: c.ID, Text: text})
			}
		}
		if m.applied {
			e.S.Log(store.Activity{At: r.AppliedAt, Kind: "applied", RoleID: id, CompanyID: c.ID, Text: "You applied (recorded in the old Job Hunt)"})
		}
		if note := strings.TrimSpace(j.Notes); note != "" {
			e.S.Log(store.Activity{At: r.LastSeenAt, Kind: "note", RoleID: id, CompanyID: c.ID, Text: "Your note: " + clip(note, 1500)})
		}
		return nil
	})
	if err != nil {
		return res, err
	}
	if res.LeftBehind > 0 {
		res.Notes = append(res.Notes, fmt.Sprintf("%s the old Job Hunt found and nobody acted on stayed behind. Anything still open will be found again.", countWord(res.LeftBehind, "older posting")))
	}

	// The job boards that were watched. They come after the jobs, so a board
	// joins the employer its postings already named ("maplebank" is Maple Bank).
	known, _ := e.S.Companies("following", "suggested")
	boards := map[string][]string{"greenhouse": op.Sources.Greenhouse, "lever": op.Sources.Lever, "ashby": op.Sources.Ashby,
		"smartrecruiters": op.Sources.SmartRecruiters, "workable": op.Sources.Workable, "bamboohr": op.Sources.BambooHR}
	for kind, tokens := range boards {
		for _, tok := range tokens {
			tok = strings.TrimSpace(tok)
			if tok == "" || len(tok) > 80 || strings.ContainsAny(tok, " /\\?#") {
				continue
			}
			name := boardName(tok)
			for _, c := range known {
				if squash(c.Name) == squash(tok) {
					name = c.Name
					break
				}
			}
			if c, fresh, err := e.S.UpsertCompany(store.Company{Name: name, BoardKind: kind, BoardToken: tok, State: "following", Source: "old",
				Why: "You watched its job board in the old Job Hunt"}); err == nil && (fresh || c.BoardToken == tok) {
				res.Employers++
			}
		}
	}

	// 7. People who wrote to the person.
	for _, rc := range src.Recruiters() {
		name := strings.TrimSpace(rc.Name)
		if name == "" {
			name, _, _ = strings.Cut(rc.Email, "@")
		}
		if name == "" {
			continue
		}
		var companyID int64
		if strings.TrimSpace(rc.Company) != "" {
			if c, _, err := e.S.UpsertCompany(store.Company{Name: rc.Company, State: "suggested", Source: "old"}); err == nil {
				companyID = c.ID
			}
		}
		kind := "recruiter"
		if k := strings.ToLower(rc.Kind); strings.Contains(k, "manager") || strings.Contains(k, "hiring") || k == "employer" {
			kind = "manager"
		}
		why := "Wrote to you"
		if rc.Emails > 1 {
			why = fmt.Sprintf("Wrote to you %d times", rc.Emails)
		}
		if !rc.Last.IsZero() {
			why += ", last in " + rc.Last.Format("January 2006")
		}
		why = joinNonEmpty(". ", why, strings.TrimSpace(rc.Phone), clip(strings.TrimSpace(rc.Notes), 400))
		p := store.Person{CompanyID: companyID, Name: name, Kind: kind, Why: why, URL: safeURL(rc.LinkedIn), Source: "old", KnowsYouAt: unix(firstTime(rc.Last, now))}
		if strings.Contains(rc.Email, "@") {
			p.Email, p.EmailSure = strings.TrimSpace(rc.Email), "sure"
		}
		if _, fresh, err := e.S.AddPerson(p); err == nil && fresh {
			res.People++
		}
	}

	// 8. Interviews that were in the calendar.
	for _, iv := range src.Interviews() {
		roleID := ids[iv.JobID]
		if roleID == 0 {
			continue
		}
		at, dup := iv.Start.Unix(), false
		talks, _ := e.S.TalksForRole(roleID)
		for _, t := range talks {
			dup = dup || t.At == at
		}
		if dup {
			continue
		}
		// Straight to the store: nothing is prepared for a talk that is history.
		if _, err := e.S.AddTalk(store.Talk{RoleID: roleID, Kind: "interview", Title: firstOf(iv.Title, "Interview"), At: at, Minutes: 60}); err == nil {
			res.Talks++
		}
	}

	// Job sites and recruiters that were being watched.
	var sites []PlaceSite
	var lost []string
	for _, id := range op.Sources.Sites {
		if k, ok := sources.KnownByID(id); ok {
			sites = append(sites, PlaceSite{ID: k.ID, Name: k.Name, URL: k.URL, Link: k.Link, Browser: k.Browser, Kind: k.Kind, About: k.About})
		} else {
			lost = append(lost, id)
		}
	}
	for _, c := range op.Sources.CustomSites {
		if s, err := siteAt(clip(c.Name, 60), c.URL, sites); err == nil {
			sites = append(sites, s)
		} else {
			lost = append(lost, firstOf(clip(c.Name, 60), "a site without a usable address"))
		}
	}
	res.Sites = e.keepSites(sites)
	if len(lost) > 0 {
		res.Notes = append(res.Notes, "Not brought over, because Job Hunt cannot read them here: "+strings.Join(lost, ", ")+".")
	}

	e.S.Set(oldDoneKey, res)
	e.S.Log(store.Activity{Kind: "import", Text: fmt.Sprintf("Brought over from the old Job Hunt: %s, %s, %s", countWord(res.Roles, "role"), countWord(res.CVs, "CV"), countWord(res.People, "person"))})
	e.S.Changed("roles", "today", "people", "you", "profile", "companies", "progress", "connections")
	return res, nil
}

// oldKey names an old job here. LinkedIn postings keep the name the search
// uses, so the search recognises them; everything else is marked as old.
func oldKey(j old.Job) string {
	if id, ok := strings.CutPrefix(j.ID, "linkedin:"); ok && id != "" && strings.Trim(id, "0123456789") == "" {
		return "linkedin:" + id
	}
	return "old:" + j.ID
}

// oldFacts carries over what the person told the old app about themselves.
func (e *Engine) oldFacts(op old.Profile) int {
	have := map[string]bool{}
	if facts, err := e.S.Facts(); err == nil {
		for _, f := range facts {
			have[strings.ToLower(strings.TrimSpace(f.Text))] = true
		}
	}
	n := 0
	add := func(text string) {
		text = clip(strings.TrimSpace(text), 1200)
		if len(text) < 4 || have[strings.ToLower(text)] {
			return
		}
		if _, err := e.S.AddFact(text, "old"); err == nil {
			have[strings.ToLower(text)] = true
			n++
		}
	}
	for _, line := range strings.Split(op.ApplicationFacts, "\n") {
		add(strings.TrimLeft(line, "-*• \t"))
	}
	for _, c := range op.Certifications {
		if strings.TrimSpace(c.Name) == "" {
			continue
		}
		text := "Certification: " + strings.TrimSpace(c.Name)
		if c.Issuer != "" {
			text += ", " + c.Issuer
		}
		if c.Number != "" {
			text += " (number " + c.Number + ")"
		}
		if c.Issued != "" {
			text += ", issued " + c.Issued
		}
		if c.Expires != "" {
			text += ", expires " + c.Expires
		}
		add(text)
	}
	for _, para := range strings.Split(strings.ReplaceAll(op.Stories, "\r\n", "\n"), "\n\n") {
		add(para)
	}
	if g := strings.TrimSpace(op.Guidance); g != "" {
		add("How I want my applications written: " + g)
	}
	if len(op.Wants.Avoid) > 0 {
		add("Industries I don't want: " + strings.Join(op.Wants.Avoid, ", "))
	}
	if len(op.Wants.Dealbreakers) > 0 {
		add("What rules a role out for me: " + strings.Join(op.Wants.Dealbreakers, "; "))
	}
	return n
}

// oldEvent puts one line of the old history in words, or "" to leave it out.
func oldEvent(ev old.Event) string {
	detail := clip(strings.Join(strings.Fields(ev.Detail), " "), 300)
	label := map[string]string{
		"applied": "Applied", "tailored": "CV and letter written", "revised": "CV or letter revised", "added": "Added",
		"email": "Mail", "calendar": "Calendar", "contact": "Contact found", "recruiter": "Recruiter", "chosen": "CV chosen",
		"skipped": "Set aside", "cv": "CV", "status": "Status changed",
	}[ev.Kind]
	if label == "" {
		if detail == "" {
			return ""
		}
		return detail
	}
	if detail == "" {
		return label
	}
	return label + ": " + detail
}

var provinces = map[string]bool{"ab": true, "bc": true, "mb": true, "nb": true, "nl": true, "ns": true, "nt": true, "nu": true, "on": true, "pe": true, "qc": true, "sk": true, "yt": true,
	"alberta": true, "british columbia": true, "manitoba": true, "new brunswick": true, "newfoundland and labrador": true, "nova scotia": true, "ontario": true,
	"prince edward island": true, "quebec": true, "québec": true, "saskatchewan": true, "yukon": true}

var countries = map[string]string{"canada": "Canada", "united states": "United States", "usa": "United States", "us": "United States", "united kingdom": "United Kingdom", "uk": "United Kingdom",
	"ireland": "Ireland", "australia": "Australia", "germany": "Germany", "france": "France", "netherlands": "Netherlands", "india": "India", "uae": "United Arab Emirates", "united arab emirates": "United Arab Emirates"}

// oldPlace reads "Toronto, ON" or "Toronto, Ontario, Canada" as a city and,
// when it can tell, a country.
func oldPlace(loc string) (city, country string) {
	parts := strings.Split(loc, ",")
	city = strings.TrimSpace(parts[0])
	for _, p := range parts[1:] {
		p = strings.ToLower(strings.TrimSpace(p))
		if c := countries[p]; c != "" {
			country = c
		} else if provinces[p] && country == "" {
			country = "Canada"
		}
	}
	if c := countries[strings.ToLower(city)]; c != "" && len(parts) == 1 {
		return "", c
	}
	return city, country
}

func workplaceWord(location string) string {
	l := strings.ToLower(location)
	switch {
	case strings.Contains(l, "remote"):
		return "remote"
	case strings.Contains(l, "hybrid"):
		return "hybrid"
	}
	return ""
}

// boardName turns a board's short name ("maple-bank") into something to show
// until the employer's real name is known.
func boardName(token string) string {
	words := strings.FieldsFunc(token, func(r rune) bool { return r == '-' || r == '_' || r == '.' })
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

// squash reduces an employer's name or a board's short name to its letters
// and digits, so the two can be compared.
func squash(name string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, store.NormName(name))
}

func hasFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(strings.TrimSpace(x), strings.TrimSpace(s)) {
			return true
		}
	}
	return false
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := s[:n]
	for len(cut) > 0 && cut[len(cut)-1]&0xC0 == 0x80 {
		cut = cut[:len(cut)-1]
	}
	if len(cut) > 0 && cut[len(cut)-1] >= 0xC0 {
		cut = cut[:len(cut)-1]
	}
	return strings.TrimSpace(cut) + "…"
}
