package engine

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// ---- leads ---------------------------------------------------------------------------
//
// Ways in that are not postings: hiring posts the side panel reads on
// LinkedIn, funding and growth news from a web search a few times a week, and
// leads the person pastes in. Claude sizes each one up. A first note and one
// follow-up are written only when the person asks for each; they send them.

// newsEvery is how often the web is searched for news, when that is on:
// a little over twice a week.
const newsEvery = 56 * time.Hour

// followAfter is when a note with no answer is worth one follow-up.
const followAfter = 7 * 24 * time.Hour

var hiringRe = regexp.MustCompile(`(?i)(#hiring\b|\bwe(['’]| a)?re hiring|\bi(['’]| a)?m hiring|\bis hiring|\bare hiring|\bnow hiring|\bhiring (a|an|for|our|my|two|three|several|multiple)\b|we(['’]| a)?re (looking|searching) for (a|an)\b|looking to hire|join (my|our) team|open (role|roles|position|positions)\b|growing (my|our|the) team|come work with (me|us)|nous recrutons|on recrute)`)
var notHiringRe = regexp.MustCompile(`(?i)(#opentowork|open to work|i(['’]| a)?m looking for (a |my )?(new|next) (role|job|opportunity|position)|looking for my next|was laid off|were laid off|hire me\b)`)

// LooksHiring is a first, free sieve for posts from the side panel: it reads
// like someone hiring, not someone looking for work. What passes is read
// properly by Claude afterwards.
func LooksHiring(text string) bool {
	return hiringRe.MatchString(text) && !notHiringRe.MatchString(text)
}

// linkKey is a link however it was written: no scheme, "www.", query or
// trailing slash.
func linkKey(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Host), "www.") + strings.TrimRight(u.Path, "/")
}

func textKey(text string) string {
	t := strings.ToLower(strings.Join(strings.Fields(text), " "))
	if len(t) > 400 {
		t = t[:400]
	}
	sum := sha1.Sum([]byte(t))
	return hex.EncodeToString(sum[:10])
}

func leadKey(link, text string) string {
	if k := linkKey(link); k != "" {
		return "link:" + k
	}
	return "text:" + textKey(text)
}

// onlyWeb keeps a link only when it is an ordinary web address.
func onlyWeb(raw string) string {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(raw) > 600 {
		return ""
	}
	return raw
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

// LeadPost is one post the side panel read.
type LeadPost struct {
	Author    string `json:"author"`
	AuthorURL string `json:"author_url"`
	Headline  string `json:"headline"` // the author's own headline
	Text      string `json:"text"`
	URL       string `json:"url"`
}

// LeadTake says what happened to posts sent from the side panel.
type LeadTake struct {
	Seen   int `json:"seen"`
	Hiring int `json:"hiring"`
	Added  int `json:"added"`
}

// AddLeadPosts takes in posts the side panel read. Only those that read like
// hiring are kept, unless the person chose this one post themselves.
func (e *Engine) AddLeadPosts(posts []LeadPost, chosen bool) (LeadTake, error) {
	var t LeadTake
	for _, p := range posts {
		text := clipRunes(p.Text, 6000)
		if len([]rune(text)) < 20 {
			continue
		}
		t.Seen++
		if !chosen && !LooksHiring(text) {
			continue
		}
		t.Hiring++
		link := onlyWeb(p.URL)
		_, isNew, err := e.S.AddLead(store.Lead{Key: leadKey(link, text), Kind: "post", Source: "linkedin", Author: clipRunes(p.Author, 120), AuthorURL: onlyWeb(p.AuthorURL), AuthorTitle: clipRunes(p.Headline, 200), Text: text, URL: link})
		if err != nil {
			return t, err
		}
		if isNew {
			t.Added++
		}
		if t.Seen >= 50 {
			break
		}
	}
	if t.Added > 0 {
		e.S.Log(store.Activity{Kind: "leads", Text: fmt.Sprintf("Took in %d hiring post%s from LinkedIn", t.Added, plural(t.Added))})
		e.readLeadsSoon()
	}
	return t, nil
}

// AddOwnLead takes in a lead the person pasted: the text of a post or an
// article, with its link if they have it. It is kept even if it does not read
// like hiring: they know better.
func (e *Engine) AddOwnLead(text, link, company string) (int64, error) {
	text = clipRunes(text, 6000)
	if len([]rune(text)) < 30 {
		return 0, errors.New("Paste the post or the article itself. Job Hunt does not open LinkedIn pages on its own.")
	}
	link = onlyWeb(link)
	id, isNew, err := e.S.AddLead(store.Lead{Key: leadKey(link, text), Kind: "yours", Source: "you", Company: clipRunes(company, 120), Text: text, URL: link})
	if err != nil {
		return 0, err
	}
	if !isNew {
		// The person brought it back, so it is open again.
		if l, err := e.S.Lead(id); err == nil && l.State != "open" {
			e.S.SetLeadState(id, "open")
		}
		return id, nil
	}
	e.S.Log(store.Activity{Kind: "leads", Text: "You added a lead"})
	e.readLeadsSoon()
	return id, nil
}

func (e *Engine) readLeadsSoon() {
	if e.LLM().Engine == "" {
		return
	}
	e.Go("leads-read", "Sizing up leads", func(ctx context.Context) error { return e.ReadLeads(ctx) })
}

// ReadLeads sizes up every lead not read yet.
func (e *Engine) ReadLeads(ctx context.Context) error {
	if e.LLM().Engine == "" {
		return llm.ErrNotConnected
	}
	for round := 0; round < 5; round++ {
		todo, err := e.S.LeadsToRead(10)
		if err != nil || len(todo) == 0 {
			return err
		}
		p := e.Person()
		for i, l := range todo {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			e.Report(ctx, i, len(todo), "Sizing up "+firstOf(l.Company, l.Author, "a lead"))
			rd, err := e.brain.SizeUpLead(ctx, p, brain.LeadIn{Kind: l.Kind, Company: l.Company, Author: l.Author, AuthorTitle: l.AuthorTitle, Headline: l.Headline, Text: l.Text, URL: l.URL})
			if err != nil {
				return err
			}
			rd = tidyLead(rd)
			// Notes the person asked for (and their own wording) outlive a new size-up.
			var was brain.LeadReading
			json.Unmarshal(l.Reading, &was)
			rd.Note, rd.FollowUp, rd.Edited = was.Note, was.FollowUp, was.Edited
			state := "open"
			if !rd.Hiring && l.Source != "you" {
				state = "not_hiring"
			}
			company := firstOf(l.Company, rd.Company)
			if c, err := e.S.CompanyByName(company); err == nil && company != "" && c.State == "muted" {
				// An employer the person chose never to see stays out of sight.
				state = "dismissed"
			}
			if err := e.S.SetLeadReading(l.ID, rd.Fit, rd.Company, state, rd); err != nil {
				return err
			}
		}
	}
	return nil
}

// tidyLead keeps Claude's answer within bounds.
func tidyLead(r brain.LeadReading) brain.LeadReading {
	r.Fit = max(0, min(100, r.Fit))
	switch r.Worth {
	case "yes", "maybe", "no":
	default:
		r.Worth = "maybe"
	}
	r.Company = clipRunes(r.Company, 120)
	r.Role = clipRunes(r.Role, 120)
	if len(r.Help) > 3 {
		r.Help = r.Help[:3]
	}
	if len(r.Who) > 3 {
		r.Who = r.Who[:3]
	}
	if r.Help == nil {
		r.Help = []string{}
	}
	if r.Who == nil {
		r.Who = []brain.LeadWho{}
	}
	return r
}

// ---- news from the web ------------------------------------------------------------------

// LeadsAuto: whether news is looked for by itself a few times a week.
func (e *Engine) LeadsAuto() bool {
	off := false
	e.S.Get("leads:off", &off)
	return !off
}

func (e *Engine) SetLeadsAuto(on bool) error {
	if err := e.S.Set("leads:off", !on); err != nil {
		return err
	}
	e.S.Changed("leads")
	return nil
}

// canLookForNews: a web search needs a real Claude; the sample answers
// show what it would look like.
func (e *Engine) canLookForNews() bool {
	return e.canSearchWeb() || e.LLM().Engine == "demo"
}

// LookForNews starts a web search for news now, in the background.
func (e *Engine) LookForNews() error {
	if e.LLM().Engine == "" {
		return llm.ErrNotConnected
	}
	if !e.canLookForNews() {
		return errors.New("Searching the web needs your Claude sign-in or an API key.")
	}
	if cvs, _ := e.S.CVs(); len(cvs) == 0 {
		return errors.New("Add your CV under You first; the search starts from it.")
	}
	e.Resume("leads")
	e.Go("leads", "Looking for employers about to hire", func(ctx context.Context) error { return e.findNews(ctx) })
	return nil
}

func (e *Engine) findNews(ctx context.Context) error {
	e.Report(ctx, 0, 2, "Searching the news for employers about to hire")
	p := e.Person()
	pr := p.Profile
	field := firstOf(pr.Headline, strings.Join(pr.Titles.Level, ", "))
	if len(pr.Strengths) > 0 {
		field += " (" + strings.Join(pr.Strengths[:min(3, len(pr.Strengths))], ", ") + ")"
	}
	place := strings.TrimSpace(strings.Trim(pr.City+", "+pr.Country, ", "))
	known, _ := e.S.Pairs(`SELECT DISTINCT company, 0 FROM leads WHERE kind = 'news' AND company != '' AND found_at >= ? LIMIT 40`, e.Now().AddDate(0, 0, -30).Unix())
	var names []string
	for _, k := range known {
		names = append(names, k.Label)
	}
	news, err := e.brain.FindNews(ctx, brain.NewsInput{Person: p, Field: field, Place: place, Known: names})
	e.S.Set("leads:looked", e.Now().Unix())
	if err != nil {
		return err
	}
	added := 0
	for _, n := range news {
		company := clipRunes(n.Company, 120)
		if company == "" || strings.TrimSpace(n.Headline) == "" {
			continue
		}
		if c, err := e.S.CompanyByName(company); err == nil && c.State == "muted" {
			continue
		}
		link := onlyWeb(n.URL)
		key := "news:" + store.NormName(company) + ":" + textKey(n.Headline)
		if link != "" {
			key = leadKey(link, "")
		}
		text := clipRunes(n.Text, 2000)
		if w := strings.TrimSpace(n.When); w != "" {
			text = clipRunes(text+"\n\nAnnounced: "+w, 2100)
		}
		_, isNew, err := e.S.AddLead(store.Lead{Key: key, Kind: "news", Source: "web", Company: company, Headline: clipRunes(n.Headline, 200), Text: text, URL: link})
		if err != nil {
			return err
		}
		if isNew {
			added++
		}
	}
	e.S.Log(store.Activity{Kind: "leads", Text: fmt.Sprintf("Searched the news for employers about to hire: %d new lead%s", added, plural(added))})
	e.Report(ctx, 1, 2, "Sizing up what was found")
	if err := e.ReadLeads(ctx); err != nil {
		return err
	}
	if added > 0 {
		good := e.S.Count(`SELECT COUNT(*) FROM leads WHERE kind = 'news' AND state = 'open' AND fit >= 70 AND found_at >= ?`, e.Now().Add(-time.Hour).Unix())
		if good > 0 {
			e.Tell("Employers about to hire", fmt.Sprintf("%d new lead%s worth writing to", good, plural(good)), "#/leads")
		}
	}
	e.S.Changed("leads")
	return nil
}

// newsDue: on, Claude can search the web, there is a CV, and the last look
// was long enough ago.
func (e *Engine) newsDue(now time.Time) bool {
	if !e.LeadsAuto() || !e.canSearchWeb() || e.heldBack("leads") {
		return false
	}
	if cvs, _ := e.S.CVs(); len(cvs) == 0 {
		return false
	}
	return now.Unix()-e.S.GetInt("leads:looked") >= int64(newsEvery/time.Second)
}

// ---- the page -----------------------------------------------------------------------------

// LeadView is a lead with Claude's reading opened up.
type LeadView struct {
	store.Lead
	Read     brain.LeadReading `json:"read"`
	Due      bool              `json:"due"` // a follow-up is due
	RoleName string            `json:"role_name,omitempty"`
}

// LeadSearch is a LinkedIn post search the side panel can read.
type LeadSearch struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// LeadsPage is everything the Leads page shows.
type LeadsPage struct {
	Leads     []LeadView     `json:"leads"`
	Total     int            `json:"total"`
	Counts    map[string]int `json:"counts"`
	Auto      bool           `json:"auto"`
	CanSearch bool           `json:"can_search"`
	Looking   bool           `json:"looking"`
	Reading   bool           `json:"reading"`
	Looked    int64          `json:"looked"`
	Searches  []LeadSearch   `json:"searches"`
}

func (e *Engine) leadView(l store.Lead) LeadView {
	v := LeadView{Lead: l}
	json.Unmarshal(l.Reading, &v.Read)
	v.Reading = nil
	v.Read = tidyLead(v.Read)
	v.Due = l.SentAt > 0 && l.FollowedAt == 0 && l.RepliedAt == 0 && e.Now().Unix()-l.SentAt >= int64(followAfter/time.Second)
	return v
}

// Leads is the Leads page: show is "open", "written", "dismissed" or "".
func (e *Engine) Leads(show string, limit int) LeadsPage {
	pg := LeadsPage{Leads: []LeadView{}, Auto: e.LeadsAuto(), CanSearch: e.canLookForNews(), Looking: e.Busy("leads"), Reading: e.Busy("leads-read"), Looked: e.S.GetInt("leads:looked")}
	if show == "" {
		show = "open"
	}
	list, total, _ := e.S.Leads(store.LeadFilter{Show: show, Limit: limit})
	for _, l := range list {
		pg.Leads = append(pg.Leads, e.leadView(l))
	}
	pg.Total = total
	due := e.Now().Add(-followAfter).Unix()
	pg.Counts = map[string]int{
		"open":      e.S.Count(`SELECT COUNT(*) FROM leads WHERE state = 'open' AND sent_at = 0`),
		"written":   e.S.Count(`SELECT COUNT(*) FROM leads WHERE state = 'open' AND sent_at > 0`),
		"dismissed": e.S.Count(`SELECT COUNT(*) FROM leads WHERE state = 'dismissed'`),
		"due":       e.S.Count(`SELECT COUNT(*) FROM leads WHERE state = 'open' AND sent_at > 0 AND sent_at <= ? AND followed_at = 0 AND replied_at = 0`, due),
	}
	pg.Searches = e.LeadSearches()
	return pg
}

// LeadSearches are LinkedIn's own post searches for the person's titles,
// newest first from the past week. The person opens them; the side panel
// reads what is on the page.
func (e *Engine) LeadSearches() []LeadSearch {
	out := []LeadSearch{}
	seen := map[string]bool{}
	for _, t := range e.S.Profile().Titles.All() {
		k := strings.ToLower(strings.TrimSpace(t.Title))
		if k == "" || seen[k] || len(out) == 6 {
			continue
		}
		seen[k] = true
		q := url.QueryEscape(`"hiring" "` + strings.TrimSpace(t.Title) + `"`)
		out = append(out, LeadSearch{Title: t.Title, URL: "https://www.linkedin.com/search/results/content/?keywords=" + q + "&origin=FACETED_SEARCH&sortBy=%22date_posted%22&datePosted=%22past-week%22"})
	}
	return out
}

// Lead is one lead with its text, for its own page.
func (e *Engine) Lead(id int64) (LeadView, error) {
	l, err := e.S.Lead(id)
	if err != nil {
		return LeadView{}, err
	}
	v := e.leadView(l)
	if l.RoleID > 0 {
		if r, err := e.S.Role(l.RoleID); err == nil {
			v.RoleName = r.Title
		}
	}
	return v, nil
}

// SetLeadState dismisses a lead or brings it back.
func (e *Engine) SetLeadState(id int64, state string) error {
	if _, err := e.S.Lead(id); err != nil {
		return err
	}
	return e.S.SetLeadState(id, state)
}

// LeadStep records that the person sent the note, sent the follow-up, or
// heard back (on false, undoes it). Job Hunt itself never sends anything.
func (e *Engine) LeadStep(id int64, step string, on bool) error {
	l, err := e.S.Lead(id)
	if err != nil {
		return err
	}
	at := int64(0)
	if on {
		at = e.Now().Unix()
	}
	if step == "followed" && on && l.SentAt == 0 {
		return errors.New("Mark the first note sent first.")
	}
	if err := e.S.SetLeadStep(id, step, at); err != nil {
		return err
	}
	if on {
		who := firstOf(l.Company, "the lead")
		text := map[string]string{"sent": "You wrote to " + who + " about a lead", "followed": "You followed up with " + who, "replied": who + " answered your note"}[step]
		e.S.Log(store.Activity{Kind: "lead_" + step, Text: text, CompanyID: l.CompanyID})
	}
	return nil
}

// SaveLeadNote keeps the person's own wording of the note or the follow-up.
func (e *Engine) SaveLeadNote(id int64, which, subject, body string) error {
	l, err := e.S.Lead(id)
	if err != nil {
		return err
	}
	var rd brain.LeadReading
	json.Unmarshal(l.Reading, &rd)
	m := brain.Message{Subject: clipRunes(subject, 200), Body: clipRunes(body, 4000)}
	switch which {
	case "note":
		rd.Note = m
	case "follow_up":
		rd.FollowUp = m
	default:
		return errors.New("unknown note")
	}
	rd.Edited = true
	return e.S.SaveLeadReading(id, rd)
}

// WriteLeadNote writes the first note ("note") or the one follow-up
// ("follow_up") for a lead: one Claude request, only because the person
// pressed the button. It replaces what was there.
func (e *Engine) WriteLeadNote(ctx context.Context, id int64, which string) (brain.Message, error) {
	if e.LLM().Engine == "" {
		return brain.Message{}, llm.ErrNotConnected
	}
	l, err := e.S.Lead(id)
	if err != nil {
		return brain.Message{}, err
	}
	if l.ReadAt == 0 {
		return brain.Message{}, errors.New("Job Hunt is still sizing this lead up. Try again in a moment.")
	}
	var rd brain.LeadReading
	json.Unmarshal(l.Reading, &rd)
	switch which {
	case "note":
	case "follow_up":
		if strings.TrimSpace(rd.Note.Body) == "" {
			return brain.Message{}, errors.New("Write the first note first.")
		}
	default:
		return brain.Message{}, errors.New("unknown note")
	}
	m, err := e.brain.WriteLeadNote(ctx, e.Person(), brain.LeadIn{Kind: l.Kind, Company: l.Company, Author: l.Author, AuthorTitle: l.AuthorTitle, Headline: l.Headline, Text: l.Text, URL: l.URL}, rd, which)
	if err != nil {
		return brain.Message{}, err
	}
	m.Subject, m.Body = clipRunes(m.Subject, 200), clipRunes(m.Body, 4000)
	// Read again: the person may have changed the other note meanwhile.
	if l, err = e.S.Lead(id); err != nil {
		return brain.Message{}, err
	}
	json.Unmarshal(l.Reading, &rd)
	if which == "note" {
		rd.Note = m
	} else {
		rd.FollowUp = m
	}
	if err := e.S.SaveLeadReading(id, rd); err != nil {
		return brain.Message{}, err
	}
	return m, nil
}

// ReadLeadAgain asks Claude to size the lead up again. Notes already written stay.
func (e *Engine) ReadLeadAgain(id int64) error {
	if e.LLM().Engine == "" {
		return llm.ErrNotConnected
	}
	if _, err := e.S.Lead(id); err != nil {
		return err
	}
	if err := e.S.ForgetLeadReading(id); err != nil {
		return err
	}
	e.readLeadsSoon()
	return nil
}

func (e *Engine) leadCompany(l store.Lead) (string, brain.LeadReading) {
	var rd brain.LeadReading
	json.Unmarshal(l.Reading, &rd)
	return strings.TrimSpace(firstOf(l.Company, rd.Company)), rd
}

// LeadToRole makes the lead a role, to be read and prepared like any other.
// A role the person said no to stays closed, and an employer they chose
// never to see is not brought back.
func (e *Engine) LeadToRole(id int64) (int64, error) {
	l, err := e.S.Lead(id)
	if err != nil {
		return 0, err
	}
	if l.RoleID > 0 {
		if _, err := e.S.Role(l.RoleID); err == nil {
			return l.RoleID, nil
		}
	}
	company, rd := e.leadCompany(l)
	if company == "" {
		return 0, errors.New("Job Hunt doesn't know the employer yet. Read the lead again, or add it as a role by hand.")
	}
	title := firstOf(rd.Role, "A role at "+company)
	if c, err := e.S.CompanyByName(company); err == nil {
		if c.State == "muted" {
			return 0, errors.New("You chose never to see " + c.Name + ". Change that on its page first.")
		}
		if rid, closed, dup := e.S.SimilarRole(c.ID, title, rd.Place); dup && closed == "no" {
			return 0, errors.New("You marked this role not interested. It stays closed.")
		} else if dup {
			e.S.LinkLead(id, "role", rid)
			return rid, nil
		}
	}
	// AddRole brings back a role it already knows; one the person said no to stays closed.
	if _, closed, seen := e.S.SeenRole("lead:" + firstOf(l.URL, store.NormName(company)+":"+strings.ToLower(title))); seen && closed == "no" {
		return 0, errors.New("You marked this role not interested. It stays closed.")
	}
	desc := l.Text
	if l.Headline != "" {
		desc = l.Headline + "\n\n" + desc
	}
	rid, err := e.AddRole(company, title, rd.Place, l.URL, desc, "lead")
	if err != nil {
		return 0, err
	}
	e.S.LinkLead(id, "role", rid)
	return rid, nil
}

// LeadToEmployer follows the lead's employer, so its job board is watched.
func (e *Engine) LeadToEmployer(id int64) (int64, error) {
	l, err := e.S.Lead(id)
	if err != nil {
		return 0, err
	}
	company, _ := e.leadCompany(l)
	if company == "" {
		return 0, errors.New("Job Hunt doesn't know the employer yet. Read the lead again first.")
	}
	if c, err := e.S.CompanyByName(company); err == nil && c.State == "muted" {
		return 0, errors.New("You chose never to see " + c.Name + ". Change that on its page first.")
	}
	c, _, err := e.S.UpsertCompany(store.Company{Name: company, State: "following", Source: "lead"})
	if err != nil {
		return 0, err
	}
	e.S.LinkLead(id, "company", c.ID)
	e.S.Log(store.Activity{Kind: "follow", CompanyID: c.ID, Text: "Watching " + c.Name + " (from a lead)"})
	cid := c.ID
	e.Go(fmt.Sprintf("board:%d", cid), "", func(ctx context.Context) error {
		err := e.DetectBoard(ctx, cid)
		e.DescribeEmployers(ctx, cid)
		return err
	})
	return c.ID, nil
}

// LeadToPerson adds the named person to write to under People.
func (e *Engine) LeadToPerson(id int64, who int) (int64, error) {
	l, err := e.S.Lead(id)
	if err != nil {
		return 0, err
	}
	company, rd := e.leadCompany(l)
	if who < 0 || who >= len(rd.Who) || strings.TrimSpace(rd.Who[who].Name) == "" {
		return 0, errors.New("That person has no name yet. Find them with the search, then add them under People.")
	}
	w := rd.Who[who]
	link := ""
	if who == 0 && l.Kind == "post" && strings.EqualFold(strings.TrimSpace(w.Name), strings.TrimSpace(l.Author)) {
		link = l.AuthorURL
	}
	pid, err := e.AddPerson(store.Person{Name: clipRunes(w.Name, 120), Title: clipRunes(w.Title, 160), Kind: "manager", Why: clipRunes(w.Why, 300), URL: link, Source: "lead"}, company)
	if err != nil {
		return 0, err
	}
	e.S.LinkLead(id, "person", pid)
	return pid, nil
}
