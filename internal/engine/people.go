package engine

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

// ---- finding people -----------------------------------------------------------------

// Door is a kind of person worth finding, when Job Hunt has no name yet.
type Door struct {
	Title   string `json:"title"`
	Company string `json:"company"`
	Kind    string `json:"kind"`
	Why     string `json:"why"`
	Search  string `json:"search"`
	URL     string `json:"url"`
}

// DoorsDoc is the stored list of who to look for.
type DoorsDoc struct {
	Doors []Door `json:"doors"`
	At    int64  `json:"at"`
	Web   bool   `json:"web"`
}

// canSearchWeb reports whether the way Claude is reached can look things up.
func (e *Engine) canSearchWeb() bool {
	switch e.LLM().Engine {
	case "api", "claude-code":
		return true
	}
	return false
}

// FindPeople proposes who to write to. Named people found on public pages
// become people; the rest become "who to look for" with a search to run.
func (e *Engine) FindPeople(ctx context.Context) error {
	companies, _ := e.S.Companies("following")
	var names []string
	for _, c := range companies {
		if len(names) < 30 {
			names = append(names, c.Name)
		}
	}
	web := e.canSearchWeb()
	leads, err := e.brain.Doors(ctx, e.Person(), names, web)
	if err != nil {
		return err
	}
	doc := DoorsDoc{At: e.Now().Unix(), Web: web}
	added := 0
	for _, l := range leads {
		kind := l.Kind
		if !validKind(kind) {
			kind = "same_craft"
		}
		if strings.TrimSpace(l.Name) == "" {
			doc.Doors = append(doc.Doors, Door{Title: l.Title, Company: l.Company, Kind: kind, Why: l.Why, Search: l.Search, URL: safeURL(l.URL)})
			continue
		}
		var companyID int64
		if strings.TrimSpace(l.Company) != "" {
			if c, _, err := e.S.UpsertCompany(store.Company{Name: l.Company, State: "suggested", Source: "person"}); err == nil {
				companyID = c.ID
			}
		}
		_, isNew, err := e.S.AddPerson(store.Person{CompanyID: companyID, Name: l.Name, Title: l.Title, Kind: kind, Why: l.Why, URL: safeURL(l.URL), Source: "proposed"})
		if err == nil && isNew {
			added++
		}
	}
	if err := e.S.SaveDoc(0, "doors", doc); err != nil {
		return err
	}
	e.S.Changed("people", "today")
	e.S.Log(store.Activity{Kind: "people", Text: fmt.Sprintf("Found %d people and %d kinds of people worth writing to", added, len(doc.Doors))})
	return nil
}

func validKind(k string) bool {
	for _, x := range store.PersonKinds {
		if x == k {
			return true
		}
	}
	return false
}

// safeURL keeps only ordinary web links; anything else from outside is dropped.
func safeURL(s string) string {
	s = strings.TrimSpace(s)
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return ""
	}
	return s
}

// Doors returns who to look for.
func (e *Engine) Doors() DoorsDoc {
	var doc DoorsDoc
	e.S.Doc(0, "doors", &doc)
	return doc
}

// AddPerson records someone the person found.
func (e *Engine) AddPerson(p store.Person, company string) (int64, error) {
	if strings.TrimSpace(company) != "" {
		c, _, err := e.S.UpsertCompany(store.Company{Name: company, State: "suggested", Source: "person"})
		if err != nil {
			return 0, err
		}
		p.CompanyID = c.ID
	}
	if !validKind(p.Kind) {
		p.Kind = "contact"
	}
	p.URL = safeURL(p.URL)
	id, _, err := e.S.AddPerson(p)
	return id, err
}

// ---- notes ------------------------------------------------------------------------

// DraftNote writes a note to a person. It is a draft until the person says
// they sent it; Job Hunt sends nothing unless the person presses Send on it.
func (e *Engine) DraftNote(ctx context.Context, personID int64, purpose, channel string, roleID int64) (store.Note, error) {
	p, err := e.S.Person(personID)
	if err != nil {
		return store.Note{}, err
	}
	if purpose == "" {
		purpose = brain.PurposeIntro
	}
	if channel == "" {
		channel = "linkedin"
		if p.Email != "" && p.URL == "" {
			channel = "email"
		}
	}
	var post *brain.Posting
	if roleID != 0 {
		if r, err := e.S.Role(roleID); err == nil {
			x := postingOf(r)
			post = &x
		}
	}
	earlier := ""
	if purpose == brain.PurposeNudge {
		if n, err := e.S.LatestNote(personID); err == nil {
			earlier = n.Body
			if roleID == 0 {
				roleID = n.RoleID
			}
			channel = n.Channel
		}
	}
	msg, err := e.brain.Note(ctx, e.Person(), brain.Target{Name: p.Name, Title: p.Title, Company: p.Company, Kind: p.Kind, Why: p.Why}, purpose, channel, post, earlier)
	if err != nil {
		return store.Note{}, err
	}
	// One open draft per person: writing again replaces it.
	if n, err := e.S.LatestNote(personID); err == nil && n.State == "draft" {
		e.S.DeleteNote(n.ID)
	}
	id, err := e.S.AddNote(store.Note{PersonID: personID, RoleID: roleID, Channel: channel, Purpose: purpose, Subject: msg.Subject, Body: msg.Body})
	if err != nil {
		return store.Note{}, err
	}
	if p.State == "new" {
		p.State = "active"
		e.S.SavePerson(p)
	}
	return e.S.Note(id)
}

// NoteSent records that the person sent a note; a follow-up is suggested a
// week later if nothing comes back.
func (e *Engine) NoteSent(id int64) error {
	n, err := e.S.Note(id)
	if err != nil {
		return err
	}
	days := 7
	if n.Purpose == brain.PurposeNudge {
		days = 10
	}
	if n.Purpose == brain.PurposeThanks {
		days = 0
	}
	if err := e.S.NoteSent(id, days); err != nil {
		return err
	}
	if days == 0 {
		e.S.NoteNudged(id, 0)
	}
	p, _ := e.S.Person(n.PersonID)
	e.S.Log(store.Activity{Kind: "note", PersonID: n.PersonID, RoleID: n.RoleID, CompanyID: p.CompanyID, Text: "You wrote to " + p.Name})
	return nil
}

// NoteReplied records that the person heard back.
func (e *Engine) NoteReplied(id int64) error {
	n, err := e.S.Note(id)
	if err != nil {
		return err
	}
	if err := e.S.NoteReplied(id); err != nil {
		return err
	}
	p, _ := e.S.Person(n.PersonID)
	e.S.Log(store.Activity{Kind: "reply", PersonID: n.PersonID, RoleID: n.RoleID, CompanyID: p.CompanyID, Text: p.Name + " answered"})
	return nil
}

// PeopleForRole suggests who to write to about one role: people already
// known at that employer.
func (e *Engine) PeopleForRole(roleID int64) []store.Person {
	r, err := e.S.Role(roleID)
	if err != nil {
		return nil
	}
	people, _ := e.S.People(store.PeopleFilter{CompanyID: r.CompanyID})
	return people
}

// ---- importing the people you already know ---------------------------------------------

// ImportConnections reads LinkedIn's "Connections.csv" export. The person may
// know nobody in the new city, but someone they already know may work at an
// employer on their list, and that is the warmest door there is.
func (e *Engine) ImportConnections(data []byte) (added, atWatched int, err error) {
	text := strings.TrimPrefix(string(data), "\ufeff")
	// The export starts with a few lines of notes before the header row.
	if i := strings.Index(text, "First Name"); i > 0 {
		text = text[i:]
	}
	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	rows, rerr := r.ReadAll()
	if rerr != nil || len(rows) < 2 {
		return 0, 0, errors.New("that doesn't look like LinkedIn's Connections.csv (Settings → Data privacy → Get a copy of your data → Connections)")
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	get := func(row []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}
	if _, ok := col["first name"]; !ok {
		return 0, 0, errors.New("that file has no \"First Name\" column; it should be LinkedIn's Connections.csv")
	}
	watched := map[string]int64{}
	companies, _ := e.S.Companies("following", "suggested")
	for _, c := range companies {
		watched[store.NormName(c.Name)] = c.ID
	}
	now := e.Now().Unix()
	for _, row := range rows[1:] {
		name := strings.TrimSpace(get(row, "first name") + " " + get(row, "last name"))
		company := get(row, "company")
		if name == "" {
			continue
		}
		// Only people at employers on the list are kept: the rest of the
		// address book is none of Job Hunt's business.
		id, ok := watched[store.NormName(company)]
		if !ok || company == "" {
			continue
		}
		_, isNew, aerr := e.S.AddPerson(store.Person{
			CompanyID: id, Name: name, Title: get(row, "position"), Kind: "contact", URL: safeURL(get(row, "url")),
			Email: get(row, "email address"), EmailSure: map[bool]string{true: "sure", false: ""}[get(row, "email address") != ""],
			Why: "You are already connected on LinkedIn", Source: "linkedin", KnowsYouAt: now,
		})
		if aerr == nil {
			atWatched++
			if isNew {
				added++
			}
		}
	}
	e.S.Log(store.Activity{Kind: "people", Text: fmt.Sprintf("Checked your LinkedIn connections: %d work at employers on your list", atWatched)})
	return added, atWatched, nil
}

// ---- arriving -----------------------------------------------------------------------

// ArrivingDoc is the stored relocation pack.
type ArrivingDoc struct {
	brain.Arriving
	CVID    int64 `json:"cv_id"`
	At      int64 `json:"at"`
	Applied int64 `json:"applied"` // id of the CV made from it, if any
}

// BuildArriving prepares the relocation pack from the first CV.
func (e *Engine) BuildArriving(ctx context.Context) error {
	p := e.Person()
	if len(p.CVs) == 0 {
		return errors.New("add a CV first")
	}
	base, err := e.CVModel(p.CVs[0].ID)
	if err != nil {
		return err
	}
	out, err := e.brain.Arrive(ctx, p, base)
	if err != nil {
		return err
	}
	if err := e.S.SaveDoc(0, "arriving", ArrivingDoc{Arriving: out, CVID: p.CVs[0].ID, At: e.Now().Unix()}); err != nil {
		return err
	}
	e.S.Changed("you", "today")
	e.S.Log(store.Activity{Kind: "arriving", Text: "Prepared your arrival pack: CV form, your experience in local terms, screening answers"})
	return nil
}

func (e *Engine) Arriving() (ArrivingDoc, bool) {
	var doc ArrivingDoc
	ok, _ := e.S.Doc(0, "arriving", &doc)
	return doc, ok
}

// SetArrivingChange switches one proposed CV edit on or off.
func (e *Engine) SetArrivingChange(index int, off bool) error {
	doc, ok := e.Arriving()
	if !ok || index < 0 || index >= len(doc.Changes) {
		return store.ErrNotFound
	}
	doc.Changes[index].Off = off
	return e.S.SaveDoc(0, "arriving", doc)
}

// ApplyArriving makes a new CV with the switched-on edits; the original stays.
func (e *Engine) ApplyArriving() (int64, error) {
	doc, ok := e.Arriving()
	if !ok {
		return 0, store.ErrNotFound
	}
	src, err := e.S.CV(doc.CVID)
	if err != nil {
		return 0, err
	}
	base, err := e.CVModel(doc.CVID)
	if err != nil {
		return 0, err
	}
	out, _ := cv.Apply(base, doc.Changes)
	mb, _ := json.Marshal(out)
	p := e.S.Profile()
	name := src.Name + " (" + firstOf(p.Country, "local") + " form)"
	id, err := e.S.AddCV(store.CV{Name: name, Filename: src.Filename, Text: cv.Text(out), Model: mb, Focus: src.Focus}, nil)
	if err != nil {
		return 0, err
	}
	doc.Applied = id
	e.S.SaveDoc(0, "arriving", doc)
	e.S.Log(store.Activity{Kind: "arriving", Text: "Made a copy of your CV in " + firstOf(p.Country, "local") + " form"})
	return id, nil
}

// ---- conversations and interviews -----------------------------------------------------------

// PrepTalk writes the pack for an upcoming conversation.
func (e *Engine) PrepTalk(ctx context.Context, id int64) error {
	t, err := e.S.Talk(id)
	if err != nil {
		return err
	}
	var post *brain.Posting
	var reading *brain.Reading
	if t.RoleID != 0 {
		if r, err := e.S.Role(t.RoleID); err == nil {
			x := postingOf(r)
			post = &x
			var rd brain.Reading
			if json.Unmarshal(r.Reading, &rd) == nil && rd.Summary != "" {
				reading = &rd
			}
		}
	}
	kind := map[string]string{"chat": "an informal conversation", "screen": "a recruiter screening call", "interview": "an interview", "offer": "a call about an offer"}[t.Kind]
	with := t.Person
	if with != "" && t.Company != "" {
		with += " at " + t.Company
	} else if with == "" {
		with = t.Company
	}
	prep, err := e.brain.Prepare(ctx, e.Person(), firstOf(kind, "a conversation"), with, post, reading)
	if err != nil {
		return err
	}
	b, _ := json.Marshal(prep)
	t.Prep = b
	if err := e.S.SaveTalk(t); err != nil {
		return err
	}
	e.S.Changed("talks", "today")
	return nil
}

// AddTalk records a conversation or interview and prepares for it.
func (e *Engine) AddTalk(t store.Talk) (int64, error) {
	if t.At == 0 {
		return 0, errors.New("when is it?")
	}
	if t.Title == "" {
		t.Title = map[string]string{"chat": "Conversation", "screen": "Recruiter call", "interview": "Interview", "offer": "Offer call"}[t.Kind]
	}
	id, err := e.S.AddTalk(t)
	if err != nil {
		return 0, err
	}
	if t.RoleID != 0 {
		switch t.Kind {
		case "screen", "interview":
			e.S.Advance(t.RoleID, "interview")
		case "offer":
			e.S.Advance(t.RoleID, "offer")
		}
	}
	if t.PersonID != 0 {
		if p, err := e.S.Person(t.PersonID); err == nil && p.KnowsYouAt == 0 {
			p.KnowsYouAt, p.State = e.Now().Unix(), "active"
			e.S.SavePerson(p)
		}
	}
	e.S.Changed("talks", "today")
	e.Go(fmt.Sprintf("prep:%d", id), "Preparing you for a conversation", func(ctx context.Context) error { return e.PrepTalk(ctx, id) })
	return id, nil
}

// ICS renders a conversation as a calendar file.
func (e *Engine) ICS(id int64) (string, []byte, error) {
	t, err := e.S.Talk(id)
	if err != nil {
		return "", nil, err
	}
	esc := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\n", `\n`, "\r", "")
	start := time.Unix(t.At, 0).UTC()
	end := start.Add(time.Duration(max(t.Minutes, 15)) * time.Minute)
	title := t.Title
	if t.Company != "" {
		title += ": " + t.Company
	}
	desc := strings.TrimSpace(t.Role + "\n" + t.Link)
	const f = "20060102T150405Z"
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Job Hunt//EN\r\nBEGIN:VEVENT\r\n")
	fmt.Fprintf(&b, "UID:jobhunt-talk-%d@local\r\nDTSTAMP:%s\r\nDTSTART:%s\r\nDTEND:%s\r\n", t.ID, e.Now().UTC().Format(f), start.Format(f), end.Format(f))
	fmt.Fprintf(&b, "SUMMARY:%s\r\nDESCRIPTION:%s\r\n", esc.Replace(title), esc.Replace(desc))
	if u := safeURL(t.Link); u != "" {
		fmt.Fprintf(&b, "URL:%s\r\n", u)
	}
	b.WriteString("BEGIN:VALARM\r\nTRIGGER:-PT30M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
	return fileNameExt("ics", title), []byte(b.String()), nil
}

// ---- the one-page case, form answers, ask ---------------------------------------------------

// CaseDoc is the note sent straight to a hiring manager.
type CaseDoc struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// WriteCase writes the one-page case for a role.
func (e *Engine) WriteCase(ctx context.Context, roleID int64) error {
	r, err := e.S.Role(roleID)
	if err != nil {
		return err
	}
	var reading brain.Reading
	json.Unmarshal(r.Reading, &reading)
	manager := ""
	for _, p := range e.PeopleForRole(roleID) {
		if p.Kind == "manager" {
			manager = p.Name
		}
	}
	msg, err := e.brain.Case(ctx, e.Person(), postingOf(r), reading, manager)
	if err != nil {
		return err
	}
	return e.S.SaveDoc(roleID, "case", CaseDoc{Subject: msg.Subject, Body: msg.Body})
}

// FormAnswers answers application-form questions for the extension. Answers
// it is unsure of are also queued as questions, so the person is asked once.
// choices, when given, holds each question's choices (or none): Claude is told
// them, and what was answered before is still found by the question alone.
func (e *Engine) FormAnswers(ctx context.Context, roleID int64, questions []string, choices [][]string) ([]brain.FormAnswer, error) {
	var clean []string
	var opts [][]string
	for i, q := range questions {
		if q = strings.TrimSpace(q); q != "" && len(q) < 600 && len(clean) < 40 {
			clean = append(clean, q)
			var o []string
			if i < len(choices) {
				for _, c := range choices[i] {
					if c = strings.TrimSpace(c); c != "" && len(c) <= 120 && len(o) < 60 {
						o = append(o, c)
					}
				}
			}
			opts = append(opts, o)
		}
	}
	if len(clean) == 0 {
		return nil, nil
	}
	saved, _ := e.S.Answers()
	// What was answered before is used as is, without asking Claude.
	known := map[string]string{}
	for _, a := range saved {
		known[a.Key] = a.Answer
	}
	out := make([]brain.FormAnswer, len(clean))
	var ask []string
	var askAt []int
	for i, q := range clean {
		if a, ok := known[store.QuestionKey(q)]; ok {
			out[i] = brain.FormAnswer{Question: q, Answer: a, Sure: true}
		} else {
			if len(opts[i]) > 1 {
				q += " [" + strings.Join(opts[i], " | ") + "]"
			}
			ask = append(ask, q)
			askAt = append(askAt, i)
		}
	}
	if len(ask) > 0 {
		var post *brain.Posting
		if r, err := e.S.Role(roleID); err == nil {
			x := postingOf(r)
			post = &x
		}
		got, err := e.brain.FormAnswers(ctx, e.Person(), post, ask, saved)
		if err != nil {
			return nil, err
		}
		for j, i := range askAt {
			fa := brain.FormAnswer{Question: clean[i]}
			if j < len(got) {
				fa.Answer, fa.Sure = got[j].Answer, got[j].Sure
			}
			out[i] = fa
			if !fa.Sure {
				e.S.Ask(store.Question{Key: "form:" + store.QuestionKey(fa.Question), Text: fa.Question, Weight: 30,
					Why: "An application form asked this. Your answer is saved and reused on every form that asks it."})
			}
		}
	}
	return out, nil
}

// Assist takes one step of the assistant.
func (e *Engine) Assist(ctx context.Context, in brain.AssistInput) (brain.AssistStep, error) {
	in.Standing = e.stateInWords()
	in.Now = e.Now().Format("Monday 2 January 2006, 15:04")
	return e.brain.Assist(ctx, e.Person(), in)
}

// stateInWords summarises the search for Claude.
func (e *Engine) stateInWords() string {
	counts, _ := e.S.RoleCounts()
	total, _ := e.S.KnowYou()
	var b strings.Builder
	fmt.Fprintf(&b, "Roles: %d found and waiting for a decision, %d with documents ready, %d applied, %d in conversation, %d interviewing, %d offers. %d set aside by the rules, %d they said no to.\n",
		counts["found"], counts["ready"], counts["applied"], counts["reply"], counts["interview"], counts["offer"], counts["closed:screened"], counts["closed:no"])
	fmt.Fprintf(&b, "People who know them in the target city: %d.\n", total)
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"ready", "applied", "reply", "interview", "offer"}, Sort: "stage", Limit: 25})
	for _, r := range roles {
		fmt.Fprintf(&b, "- %s at %s: %s, fit %d\n", r.Title, r.Company, r.Stage, r.Fit)
	}
	st := e.searchState()
	if st.LastFull > 0 {
		fmt.Fprintf(&b, "Last full search: %s.\n", time.Unix(st.LastFull, 0).Format("2 Jan 15:04"))
	}
	return b.String()
}
