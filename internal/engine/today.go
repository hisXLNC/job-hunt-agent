package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// Card is one thing worth the person's attention today.
//
// Kinds: talk, mail, apply (documents ready), decide (worth a look, nothing
// prepared), send (a note is drafted), nudge (a note went unanswered),
// meet (someone to write to), setup, problem.
type Card struct {
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Sub      string `json:"sub"`
	Why      string `json:"why"`
	RoleID   int64  `json:"role_id,omitempty"`
	PersonID int64  `json:"person_id,omitempty"`
	NoteID   int64  `json:"note_id,omitempty"`
	TalkID   int64  `json:"talk_id,omitempty"`
	MailID   int64  `json:"mail_id,omitempty"`
	Fit      int    `json:"fit"`
	Tailored int    `json:"tailored"`
	At       int64  `json:"at,omitempty"` // when the posting went up, or the talk happens
	Seen     int    `json:"seen"`         // applicants so far, -1 unknown
	Fresh    bool   `json:"fresh"`        // still early enough to be among the first
	Band     string `json:"band,omitempty"`
	Body     string `json:"body,omitempty"`
	URL      string `json:"url,omitempty"`
	Channel  string `json:"channel,omitempty"`
	Busy     bool   `json:"busy,omitempty"`

	// At a glance, for the list.
	Company   string `json:"company,omitempty"`
	CompanyID int64  `json:"company_id,omitempty"`
	Place     string `json:"place,omitempty"`
	Workplace string `json:"workplace,omitempty"`
	JobType   string `json:"job_type,omitempty"`
	Pay       string `json:"pay,omitempty"`
	PayYear   int    `json:"pay_year,omitempty"`
	Tags      []Tag  `json:"tags,omitempty"`
}

// Number is one headline figure.
type Number struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Sub   string `json:"sub"`
	Tone  string `json:"tone,omitempty"`
	// Of, when above 0, is a goal the figure counts towards, and Done how far along it is.
	Done int `json:"done,omitempty"`
	Of   int `json:"of,omitempty"`
}

// Step is one line of the "before you land" list.
type Step struct {
	Text string `json:"text"`
	Done bool   `json:"done"`
	Sub  string `json:"sub"`
	Go   string `json:"go"`
}

// Landing is where a relocating person stands.
type Landing struct {
	Days     int    `json:"days"`
	ArriveOn string `json:"arrive_on"`
	City     string `json:"city"`
	Steps    []Step `json:"steps"`
	Done     int    `json:"done"`
}

// Brief is the Today page.
type Brief struct {
	Name     string           `json:"name"`
	Date     string           `json:"date"`
	Headline string           `json:"headline"`
	Numbers  []Number         `json:"numbers"`
	Question *store.Question  `json:"question,omitempty"`
	Waiting  int              `json:"waiting"` // more questions behind this one
	Cards    []Card           `json:"cards"`
	More     int              `json:"more"` // cards not shown
	Done     []store.Activity `json:"done"` // done while you were away
	Landing  *Landing         `json:"landing,omitempty"`
	Problems []store.Activity `json:"problems"`
}

const freshFor = 24 * time.Hour

// Today builds the brief by rules; no Claude call is made to show it.
func (e *Engine) Today() Brief {
	now := e.Now()
	p := e.S.Profile()
	b := Brief{Name: strings.Fields(p.Name + " there")[0], Date: now.Format("Monday 2 January")}
	if p.Name == "" {
		b.Name = ""
	}

	if qs, _ := e.S.OpenQuestions(); len(qs) > 0 {
		q := qs[0]
		b.Question, b.Waiting = &q, len(qs)-1
	}

	var cards []Card
	// 1. Conversations in the next two days.
	talks, _ := e.S.Talks(now.Add(-time.Hour).Unix(), now.Add(48*time.Hour).Unix())
	for _, t := range talks {
		who := strings.TrimSpace(t.Person)
		if t.Company != "" {
			who = strings.TrimSpace(who + " · " + t.Company)
		}
		why := "Your prep pack is ready."
		if len(t.Prep) < 5 {
			why = "Job Hunt is writing your prep pack."
		}
		cards = append(cards, Card{Kind: "talk", Title: t.Title, Sub: who, Why: why, TalkID: t.ID, RoleID: t.RoleID, At: t.At, URL: safeURL(t.Link), Company: t.Company})
	}
	// 2. Mail that needs an answer.
	mails, _, _ := e.S.Mails(store.MailFilter{State: "new", Limit: 6})
	for _, m := range mails {
		cards = append(cards, Card{Kind: "mail", Title: firstOf(m.Company, m.FromName, "A reply") + " wrote to you", Sub: m.Subject, Why: firstOf(m.Next, m.Summary), MailID: m.ID, RoleID: m.RoleID, At: m.At, Company: m.Company})
	}
	// 3. Roles with documents ready: the freshest first, because being
	// early is worth more than a few points of fit.
	// A role saved for later stays out until its day comes.
	ready, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"ready"}, Sort: "age", Limit: 40, NotLater: now.Unix()})
	sort.SliceStable(ready, func(i, j int) bool { return urgency(ready[i], now) > urgency(ready[j], now) })
	for _, r := range ready {
		cards = append(cards, e.roleCard("apply", r, now))
	}
	// 4. Strong roles nothing was prepared for.
	found, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"found"}, MinFit: keepFit, Sort: "fit", Limit: 12, NotLater: now.Unix()})
	sort.SliceStable(found, func(i, j int) bool { return urgency(found[i], now) > urgency(found[j], now) })
	for _, r := range found {
		c := e.roleCard("decide", r, now)
		c.Busy = e.Preparing(r.ID)
		cards = append(cards, c)
	}
	// 5. Notes: drafted and waiting to be sent, then follow-ups that are due.
	drafts, _ := e.S.NotesInState("draft")
	for _, n := range drafts {
		if per, err := e.S.Person(n.PersonID); err == nil {
			cards = append(cards, Card{Kind: "send", Title: "Send your note to " + per.Name, Sub: joinNonEmpty(" · ", per.Title, per.Company), Why: per.Why, PersonID: per.ID, NoteID: n.ID, Body: n.Body, URL: per.URL, Channel: n.Channel, Company: per.Company, CompanyID: per.CompanyID})
		}
	}
	due, _ := e.S.NotesDue(now.Unix())
	for _, n := range due {
		if per, err := e.S.Person(n.PersonID); err == nil {
			days := int(now.Sub(time.Unix(n.SentAt, 0)).Hours() / 24)
			cards = append(cards, Card{Kind: "nudge", Title: per.Name + " hasn't answered", Sub: joinNonEmpty(" · ", per.Title, per.Company), Why: fmt.Sprintf("You wrote %d days ago. One short follow-up is normal; after that, let it go.", days), PersonID: per.ID, NoteID: n.ID})
		}
	}
	// 6. Applications that have gone quiet: one short follow-up, once.
	for _, r := range e.quietApplications(p, now) {
		days := int(now.Sub(time.Unix(r.AppliedAt, 0)).Hours() / 24)
		c := Card{Kind: "chase", Title: r.Title, Sub: fmt.Sprintf("Applied %d days ago, no reply", days), RoleID: r.ID, Fit: r.Fit, Tailored: r.FitTailored, Seen: -1,
			Why: "One short follow-up is normal; after that, let it go.", Company: r.Company, CompanyID: r.CompanyID}
		var ch ChaseDoc
		if ok, _ := e.S.Doc(r.ID, "chase", &ch); ok && ch.Body != "" {
			c.Body = "written"
		}
		cards = append(cards, c)
	}
	// 7. People worth a first note, when few people know the person yet.
	know, _ := e.S.KnowYou()
	if know < 8 {
		fresh, _ := e.S.People(store.PeopleFilter{States: []string{"new"}})
		for i, per := range fresh {
			if i >= 3 {
				break
			}
			cards = append(cards, Card{Kind: "meet", Title: per.Name, Sub: joinNonEmpty(" · ", per.Title, per.Company), Why: per.Why, PersonID: per.ID, URL: per.URL, Band: per.Kind, Company: per.Company, CompanyID: per.CompanyID})
		}
	}
	const show = 200
	if len(cards) > show {
		b.More = len(cards) - show
		cards = cards[:show]
	}
	b.Cards = cards

	// Headline figures.
	counts, _ := e.S.RoleCounts()
	weekAgo := weekStart(now).Unix() // weeks run Monday to Sunday, as on Progress
	appliedWeek := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ?`, weekAgo)
	early := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at - CASE WHEN posted_at > 0 THEN posted_at ELSE first_seen_at END < 86400`, weekAgo)
	freshReady := 0
	for _, r := range ready {
		if now.Sub(time.Unix(r.Age(), 0)) < freshFor {
			freshReady++
		}
	}
	b.Numbers = []Number{
		{Label: "Ready to send", Value: fmt.Sprint(counts["ready"]), Sub: fmt.Sprintf("%d posted in the last day", freshReady), Tone: tone(freshReady > 0, "hot")},
		appliedNumber(appliedWeek, early, p.Goal()),
		{Label: "In conversation", Value: fmt.Sprint(counts["reply"] + counts["interview"] + counts["offer"]), Sub: fmt.Sprintf("%d interviewing", counts["interview"]), Tone: tone(counts["interview"]+counts["offer"] > 0, "good")},
		{Label: "People who know you", Value: fmt.Sprint(know), Sub: "in " + firstOf(p.City, "your city")},
	}

	// One sentence that says what today is about.
	switch {
	case len(talks) > 0:
		b.Headline = fmt.Sprintf("You have %s coming up. %s", countWord(len(talks), "conversation"), readyWords(counts["ready"], freshReady))
	case len(mails) > 0:
		b.Headline = fmt.Sprintf("%s to answer. %s", capFirst(countWord(len(mails), "reply")), readyWords(counts["ready"], freshReady))
	case counts["ready"] > 0:
		b.Headline = readyWords(counts["ready"], freshReady)
	case len(found) > 0:
		b.Headline = fmt.Sprintf("%s worth a look; nothing is prepared yet.", capFirst(countWord(len(found), "role")))
	case e.LLM().Engine == "":
		b.Headline = "Connect Claude and Job Hunt starts working."
	case e.Busy("search"):
		b.Headline = "Searching now. New roles appear here as they are read."
	default:
		b.Headline = "Nothing needs you right now. Job Hunt keeps watching and will put new roles here."
	}

	// What was done since the person last looked.
	since := e.S.GetInt("seen_today")
	if since == 0 || now.Unix()-since > 3*86400 {
		since = now.Add(-24 * time.Hour).Unix()
	}
	acts, _ := e.S.ActivityList(store.ActivityFilter{Since: since, Kinds: []string{"search", "prepared", "employers", "people", "mail", "arriving", "reply"}, Limit: 8})
	b.Done = acts
	b.Problems, _ = e.S.ActivityList(store.ActivityFilter{Since: now.Add(-6 * time.Hour).Unix(), Kinds: []string{"problem"}, Limit: 3})

	if l := e.landing(p, now, know); l != nil {
		b.Landing = l
	}
	return b
}

// weekStart is the Monday the week of a moment began on.
func weekStart(now time.Time) time.Time {
	return dayStart(now).AddDate(0, 0, -(int(now.Weekday())+6)%7)
}

// appliedNumber is the week's applications, against the goal when there is one.
func appliedNumber(applied, early, goal int) Number {
	n := Number{Label: "Applied this week", Value: fmt.Sprint(applied), Sub: fmt.Sprintf("%d within a day of posting", early)}
	if goal > 0 {
		n.Value, n.Done, n.Of = fmt.Sprintf("%d of %d", applied, goal), applied, goal
		if applied >= goal {
			n.Tone = "good"
		}
	}
	return n
}

// MarkSeen records that the person looked at Today, so "done while you were
// away" starts from here next time.
func (e *Engine) MarkSeen() {
	now := e.Now().Unix()
	if now-e.S.GetInt("seen_today") > 1800 {
		e.S.Set("seen_today_prev", e.S.GetInt("seen_today"))
		e.S.Set("seen_today", now)
	}
}

func tone(on bool, t string) string {
	if on {
		return t
	}
	return ""
}

func countWord(n int, word string) string {
	if n == 1 {
		return "one " + word
	}
	if strings.HasSuffix(word, "y") {
		return fmt.Sprintf("%d %sies", n, strings.TrimSuffix(word, "y"))
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func capFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func readyWords(ready, fresh int) string {
	switch {
	case ready == 0:
		return ""
	case fresh > 0:
		return fmt.Sprintf("%s ready to send, %d of them posted in the last day: those first.", capFirst(countWord(ready, "application")), fresh)
	}
	return fmt.Sprintf("%s ready to send.", capFirst(countWord(ready, "application")))
}

func joinNonEmpty(sep string, parts ...string) string {
	var out []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, strings.TrimSpace(p))
		}
	}
	return strings.Join(out, sep)
}

// urgency ranks roles: a posting loses value by the hour for its first day,
// and fit decides between postings of a similar age.
func urgency(r store.Role, now time.Time) float64 {
	age := now.Sub(time.Unix(r.Age(), 0)).Hours()
	fit := float64(max(r.Fit, r.FitTailored))
	early := 0.0
	switch {
	case age < 3:
		early = 40
	case age < 24:
		early = 25
	case age < 72:
		early = 10
	}
	if r.Applicants >= 0 && r.Applicants < 10 {
		early += 15
	}
	return fit + early
}

func (e *Engine) roleCard(kind string, r store.Role, now time.Time) Card {
	c := Card{Kind: kind, Title: r.Title, Sub: joinNonEmpty(" · ", r.Company, r.Location), RoleID: r.ID, Fit: r.Fit, Tailored: r.FitTailored, At: r.Age(), Seen: r.Applicants, Band: r.Band, URL: firstOf(r.ApplyURL, r.URL)}
	c.Fresh = now.Sub(time.Unix(r.Age(), 0)) < freshFor || (r.Applicants >= 0 && r.Applicants < 10)
	var rd *brain.Reading
	desc := ""
	if full, err := e.S.Role(r.ID); err == nil {
		desc = full.Description
		var got brain.Reading
		if json.Unmarshal(full.Reading, &got) == nil {
			c.Why = got.Summary
			rd = &got
		}
	}
	e.roleFacts(&c, r, desc, rd, e.S.Profile().PayFloor, now)
	return c
}

// landing builds the "before you land" list for someone who has not arrived.
func (e *Engine) landing(p store.Profile, now time.Time, know int) *Landing {
	moving, days := p.Relocating(now)
	if !moving {
		return nil
	}
	l := &Landing{Days: days, ArriveOn: p.ArriveOn, City: p.City}
	arr, hasArr := e.Arriving()
	applied := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`)
	talks := e.S.Count(`SELECT COUNT(*) FROM talks`)
	notes := e.S.Count(`SELECT COUNT(*) FROM notes WHERE sent_at > 0`)
	country := firstOf(p.Country, "local")
	add := func(text string, done bool, sub, link string) {
		l.Steps = append(l.Steps, Step{Text: text, Done: done, Sub: sub, Go: link})
		if done {
			l.Done++
		}
	}
	add("Say whether you can work in "+firstOf(p.Country, "the country")+" on arrival", p.WorkStatus != "", "Recruiters ask this first; Job Hunt puts the answer where they look.", "#/you")
	add("Put your CV in "+country+" form", hasArr && arr.Applied != 0, "Local spelling, amounts they recognise, a line on employers they won't know.", "#/you/arriving")
	add("Write to ten people before you land", notes >= 10, fmt.Sprintf("%d written so far. Newcomers get hired through conversations.", notes), "#/people")
	add("Have five people who know who you are", know >= 5, fmt.Sprintf("%d so far: they answered or you have spoken.", know), "#/people")
	add("Send your first ten applications", applied >= 10, fmt.Sprintf("%d sent.", applied), "#/roles")
	add("Have one conversation booked for your first week", talks > 0, "A coffee counts. Add it under Interviews and Job Hunt prepares you.", "#/interviews")
	add("Get phone notices for brand-new roles", e.Phone().On, "So you can apply in the first hour from wherever you are.", "#/you/connections")
	return l
}

// ---- progress ------------------------------------------------------------------------

// Progress is the "where you stand" page.
type Progress struct {
	Funnel   []store.Pair   `json:"funnel"`
	Weeks    []WeekCount    `json:"weeks"`
	Goal     int            `json:"goal"` // applications a week the person aims for; 0 = none
	Speed    Speed          `json:"speed"`
	BySource []Rate         `json:"by_source"`
	ByBand   []Rate         `json:"by_band"`
	People   PeopleProgress `json:"people"`
	Cleared  []store.Pair   `json:"cleared"`
	Lessons  []string       `json:"lessons"`
}

type WeekCount struct {
	Start   int64 `json:"start"`
	Applied int   `json:"applied"`
	Replies int   `json:"replies"`
	Notes   int   `json:"notes"`
}

// Speed is how quickly the person gets applications in.
type Speed struct {
	MedianHours float64 `json:"median_hours"` // posting to application, -1 if none
	FirstDay    int     `json:"first_day"`
	FirstTen    int     `json:"first_ten"` // applied while fewer than 10 had
	Applied     int     `json:"applied"`
}

// Rate is how a group of applications fared.
type Rate struct {
	Label   string `json:"label"`
	Applied int    `json:"applied"`
	Heard   int    `json:"heard"`
	Talks   int    `json:"talks"`
}

type PeopleProgress struct {
	Written int            `json:"written"`
	Replied int            `json:"replied"`
	KnowYou int            `json:"know_you"`
	ByKind  map[string]int `json:"by_kind"`
	Waiting int            `json:"waiting"`
}

func (e *Engine) Progress() Progress {
	now := e.Now()
	var pr Progress
	s := e.S
	everAt := func(stage string) int {
		// Roles that reached at least this stage, wherever they are now.
		idx := stageOrder(stage)
		var names []string
		for i, st := range store.Stages {
			if i >= idx {
				names = append(names, "'"+st+"'")
			}
		}
		return s.Count(`SELECT COUNT(*) FROM roles WHERE stage IN (` + strings.Join(names, ",") + `)`)
	}
	seen := s.Count(`SELECT COUNT(*) FROM roles`)
	pr.Funnel = []store.Pair{
		{Label: "Postings seen", N: seen},
		{Label: "Worth a look", N: everAt("found") - s.Count(`SELECT COUNT(*) FROM roles WHERE closed = 'screened' AND stage = 'found'`)},
		{Label: "Prepared", N: everAt("ready")},
		{Label: "Applied", N: s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`)},
		{Label: "Heard back", N: everAt("reply")},
		{Label: "Interviews", N: everAt("interview")},
		{Label: "Offers", N: everAt("offer")},
	}

	// Eight weeks, Monday to Sunday.
	monday := weekStart(now)
	pr.Goal = s.Profile().Goal()
	for i := 7; i >= 0; i-- {
		from := monday.AddDate(0, 0, -7*i).Unix()
		to := monday.AddDate(0, 0, -7*i+7).Unix()
		pr.Weeks = append(pr.Weeks, WeekCount{
			Start:   from,
			Applied: s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at < ?`, from, to),
			Replies: s.Count(`SELECT COUNT(*) FROM mails WHERE at >= ? AND at < ? AND kind IN ('interview','assessment','question','offer','person')`, from, to) + s.Count(`SELECT COUNT(*) FROM notes WHERE replied_at >= ? AND replied_at < ?`, from, to),
			Notes:   s.Count(`SELECT COUNT(*) FROM notes WHERE sent_at >= ? AND sent_at < ?`, from, to),
		})
	}

	const posted = `CASE WHEN posted_at > 0 THEN posted_at ELSE first_seen_at END`
	pr.Speed.Applied = s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0`)
	pr.Speed.FirstDay = s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0 AND applied_at - ` + posted + ` < 86400`)
	pr.Speed.FirstTen = s.Count(`SELECT COUNT(*) FROM roles r WHERE applied_at > 0 AND EXISTS (SELECT 1 FROM activity a WHERE a.role_id = r.id AND a.kind = 'applied' AND a.detail = 'first10')`)
	pr.Speed.MedianHours = -1
	if gaps, _ := s.Pairs(`SELECT '', applied_at - ` + posted + ` FROM roles WHERE applied_at > 0 ORDER BY 2`); len(gaps) > 0 {
		pr.Speed.MedianHours = float64(max(gaps[len(gaps)/2].N, 0)) / 3600
	}

	rates := func(col string, labels map[string]string) []Rate {
		rows, _ := s.Pairs(`SELECT ` + col + `, COUNT(*) FROM roles WHERE applied_at > 0 GROUP BY 1 ORDER BY 2 DESC`)
		var out []Rate
		for _, row := range rows {
			r := Rate{Label: firstOf(labels[row.Label], row.Label, "Other"), Applied: row.N}
			r.Heard = s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0 AND `+col+` = ? AND stage IN ('reply','interview','offer')`, row.Label)
			r.Talks = s.Count(`SELECT COUNT(*) FROM roles WHERE applied_at > 0 AND `+col+` = ? AND stage IN ('interview','offer')`, row.Label)
			out = append(out, r)
		}
		return out
	}
	pr.BySource = rates("source", map[string]string{"linkedin": "LinkedIn", "greenhouse": "Employer's own board", "lever": "Employer's own board", "ashby": "Employer's own board", "smartrecruiters": "Employer's own board", "workday": "Employer's own board", "manual": "Added by you", "extension": "Sent from your browser"})
	pr.BySource = mergeRates(pr.BySource)
	pr.ByBand = rates("band", map[string]string{"level": "At your level", "step_up": "A step up", "sideways": "Sideways", "": "Other"})

	pr.People.Written = s.Count(`SELECT COUNT(DISTINCT person_id) FROM notes WHERE sent_at > 0`)
	pr.People.Replied = s.Count(`SELECT COUNT(DISTINCT person_id) FROM notes WHERE replied_at > 0`)
	pr.People.Waiting = s.Count(`SELECT COUNT(*) FROM notes WHERE state = 'sent'`)
	pr.People.KnowYou, pr.People.ByKind = s.KnowYou()

	pr.Cleared, _ = s.Pairs(`SELECT closed_why, COUNT(*) FROM roles WHERE closed = 'screened' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`)

	// Plain observations, only when the numbers can bear them.
	if pr.Speed.Applied >= 5 {
		if pr.Speed.MedianHours > 48 {
			pr.Lessons = append(pr.Lessons, fmt.Sprintf("Half your applications went in more than %d days after the posting. The ones sent on day one are read by a person far more often.", int(pr.Speed.MedianHours/24)))
		} else if pr.Speed.MedianHours >= 0 && pr.Speed.MedianHours <= 24 {
			pr.Lessons = append(pr.Lessons, "Most of your applications go in within a day of the posting. Keep that up.")
		}
	}
	if pr.People.Written >= 5 {
		pct := pr.People.Replied * 100 / pr.People.Written
		pr.Lessons = append(pr.Lessons, fmt.Sprintf("%d of the %d people you wrote to answered (%d%%). For cold notes, one in four is good.", pr.People.Replied, pr.People.Written, pct))
	} else if pr.Speed.Applied >= 5 && pr.People.Written < 3 {
		pr.Lessons = append(pr.Lessons, "You are applying but writing to almost nobody. For someone new to a city, notes to people produce more interviews than applications do.")
	}
	return pr
}

func mergeRates(in []Rate) []Rate {
	idx := map[string]int{}
	var out []Rate
	for _, r := range in {
		if i, ok := idx[r.Label]; ok {
			out[i].Applied += r.Applied
			out[i].Heard += r.Heard
			out[i].Talks += r.Talks
			continue
		}
		idx[r.Label] = len(out)
		out = append(out, r)
	}
	return out
}
