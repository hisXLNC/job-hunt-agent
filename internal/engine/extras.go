package engine

// The things around a prepared application: checking the CV that gets sent,
// the words a screening system looks for, whether such a system reads it at
// all, the copy-and-paste kit for forms, the person's own files, the posting
// on the employer's own site, an offer, and the reply to a no.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

// TextHash is a short fingerprint of a text, to tell when it changed.
func TextHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:8])
}

// ---- Check my CV ---------------------------------------------------------------------------

// CheckDoc is the last careful reading of the CV as it gets sent. Of is the
// hash of the text it read, so the page can say when the CV changed since.
type CheckDoc struct {
	Lines []brain.CheckLine `json:"lines"`
	Of    string            `json:"of"`
	At    int64             `json:"at"`
}

// CheckCV reads the CV exactly as it will be sent, requirement by requirement.
func (e *Engine) CheckCV(ctx context.Context, roleID int64) error {
	r, err := e.S.Role(roleID)
	if err != nil {
		return err
	}
	_, sent, _, err := e.RoleCV(roleID)
	if err != nil {
		return err
	}
	text := cv.Text(sent)
	out, err := e.brain.CheckCV(ctx, e.Person(), postingOf(r), text)
	if err != nil {
		return err
	}
	var lines []brain.CheckLine
	for _, l := range out.Lines {
		switch l.Status {
		case "shown", "unclear", "missing":
		default:
			l.Status = "unclear"
		}
		if strings.TrimSpace(l.Ask) != "" && len(lines) < 10 {
			lines = append(lines, l)
		}
	}
	return e.S.SaveDoc(roleID, "check", CheckDoc{Lines: lines, Of: TextHash(text), At: e.Now().Unix()})
}

// SentHash is the hash of the CV text as it is sent now; "" if none.
func (e *Engine) SentHash(roleID int64) string {
	if _, sent, _, err := e.RoleCV(roleID); err == nil {
		return TextHash(cv.Text(sent))
	}
	return ""
}

// ---- words a screening system looks for -----------------------------------------------------

// Keyword is one word of the posting and whether the CV as sent has it.
type Keyword struct {
	Word string `json:"word"`
	In   bool   `json:"in"`
}

var notWordish = regexp.MustCompile(`[^\p{L}\p{N}+#/.&]+`)

func squashWords(s string) string {
	return " " + strings.Join(strings.Fields(notWordish.ReplaceAllString(strings.ToLower(s), " ")), " ") + " "
}

// Keywords counts, here and without Claude, which of the posting's words the
// CV as sent contains.
func Keywords(words []string, sent string) []Keyword {
	have := squashWords(sent)
	seen := map[string]bool{}
	var out []Keyword
	for _, w := range words {
		w = strings.TrimSpace(w)
		k := squashWords(w)
		if strings.TrimSpace(k) == "" || seen[k] || len(out) >= 20 {
			continue
		}
		seen[k] = true
		in := strings.Contains(have, k)
		// "e-invoicing" and "e invoicing" and "einvoicing" are the same word.
		if !in {
			in = strings.Contains(strings.ReplaceAll(have, " ", ""), strings.ReplaceAll(k, " ", ""))
		}
		out = append(out, Keyword{Word: w, In: in})
	}
	return out
}

// ---- will a screening system read it ----------------------------------------------------------

// ReadNote is one finding about whether a screening system reads the CV.
type ReadNote struct {
	Text string `json:"text"`
	Bad  bool   `json:"bad"`
	Fix  string `json:"fix,omitempty"` // "profile": the fix is on the person's own details
}

var odd = regexp.MustCompile(`[\x{2600}-\x{27BF}\x{1F000}-\x{1FAFF}\x{E000}-\x{F8FF}\x{25A0}-\x{25FF}\x{2190}-\x{21FF}]`)

// Readable checks, by fixed rules, what trips up applicant-tracking systems.
// Job Hunt's own files are always one column, with standard headings and no
// tables or pictures, so those are said once and not tested.
func Readable(c cv.CV) []ReadNote {
	notes := []ReadNote{{Text: "One column, standard headings, no tables, text boxes or pictures: the file Job Hunt writes is built that way."}}
	if strings.TrimSpace(c.Contact.Email) == "" {
		notes = append(notes, ReadNote{Text: "There is no e-mail address on the CV that gets sent.", Bad: true, Fix: "cv"})
	}
	if strings.TrimSpace(c.Contact.Phone) == "" {
		notes = append(notes, ReadNote{Text: "There is no phone number on the CV that gets sent.", Bad: true, Fix: "cv"})
	}
	hasWork, undated := false, 0
	for _, s := range c.Sections {
		if s.Kind == "experience" {
			hasWork = true
			for _, it := range joinLoose(s.Items) {
				if strings.TrimSpace(it.Dates) == "" && strings.TrimSpace(it.Heading) != "" {
					undated++
				}
			}
		}
	}
	if !hasWork {
		notes = append(notes, ReadNote{Text: "No section reads as work experience, which most systems look for first.", Bad: true})
	}
	if undated > 0 {
		notes = append(notes, ReadNote{Text: fmt.Sprintf("%d %s in your experience %s no dates; systems often skip a role without them.", undated, pluralWord(undated, "role", "roles"), pluralWord(undated, "has", "have")), Bad: true})
	}
	text := cv.Text(c)
	n := len(strings.Fields(text))
	switch {
	case n > 1150:
		notes = append(notes, ReadNote{Text: fmt.Sprintf("About %d words, which is past two pages. Recruiters skim; trimming the oldest roles helps.", n), Bad: true})
	case n < 180:
		notes = append(notes, ReadNote{Text: fmt.Sprintf("Only about %d words; a system has little to match.", n), Bad: true})
	}
	if m := odd.FindAllString(text, 4); len(m) > 0 {
		notes = append(notes, ReadNote{Text: "It has symbols some systems turn into gibberish: " + strings.Join(m, " ") + ".", Bad: true})
	}
	return notes
}

func pluralWord(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// ---- the copy-and-paste kit ----------------------------------------------------------------

// KitLine is one thing an application form asks, ready to copy.
type KitLine struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// KitJob is one role on the CV as sent.
type KitJob struct {
	Title   string `json:"title"`
	Org     string `json:"org"`
	Dates   string `json:"dates"`
	Bullets string `json:"bullets"`
}

// Kit is what forms ask for, taken from the person's details and the CV as sent.
type Kit struct {
	Lines []KitLine `json:"lines"`
	Jobs  []KitJob  `json:"jobs"`
	Study []KitJob  `json:"study"`
}

var workSaid = map[string]string{"citizen": "Citizen", "resident": "Permanent resident", "permit": "Work permit", "none": "I would need sponsorship"}

// MakeKit gathers what application forms ask for, from the person's details
// and the CV that gets sent for this role.
func MakeKit(p store.Profile, c cv.CV) Kit {
	var k Kit
	add := func(label, v string) {
		if v = strings.TrimSpace(v); v != "" {
			k.Lines = append(k.Lines, KitLine{label, v})
		}
	}
	name := c.Name
	if name == "" {
		name = p.Name
	}
	add("Name", name)
	if parts := strings.Fields(name); len(parts) > 1 {
		add("First name", parts[0])
		add("Last name", strings.Join(parts[1:], " "))
	}
	add("E-mail", c.Contact.Email)
	add("Phone", c.Contact.Phone)
	for _, l := range c.Contact.Links {
		if strings.Contains(strings.ToLower(l), "linkedin.") {
			add("LinkedIn", l)
		} else {
			add("Website", l)
		}
	}
	city := c.Contact.Location
	if p.City != "" {
		city = strings.Join(nonEmpty(p.City, p.Country), ", ")
		if p.ArriveOn != "" {
			city += " (arriving " + p.ArriveOn + ")"
		}
	}
	add("City", city)
	for _, s := range c.Sections {
		if s.Kind == "experience" && len(s.Items) > 0 {
			it := s.Items[0]
			add("Current title", strings.Join(nonEmpty(it.Heading, it.Org), ", "))
			break
		}
	}
	if p.Years > 0 {
		add("Years of experience", fmt.Sprint(p.Years))
	}
	if w := workSaid[p.WorkStatus]; w != "" {
		if p.Country != "" && p.WorkStatus != "none" {
			w += " (" + p.Country + ")"
		}
		add("Right to work", w)
	}
	if p.PayFloor > 0 {
		add("Lowest pay you take", fmt.Sprintf("%d%s", p.PayFloor, map[string]string{"hour": " an hour", "year": " a year"}[p.PayUnit]))
	}
	add("Summary", firstNonEmpty(c.Summary, p.Summary))
	for _, s := range c.Sections {
		for _, it := range joinLoose(s.Items) {
			j := KitJob{Title: it.Heading, Org: it.Org, Dates: it.Dates, Bullets: strings.TrimSpace(strings.Join(append(nonEmpty(it.Text), it.Bullets...), "\n"))}
			switch s.Kind {
			case "experience":
				k.Jobs = append(k.Jobs, j)
			case "education":
				k.Study = append(k.Study, j)
			}
		}
	}
	return k
}

// joinLoose puts back together an entry whose dates or bullets were read as
// an entry of their own, with no heading, right after it.
func joinLoose(items []cv.Item) []cv.Item {
	var out []cv.Item
	for _, it := range items {
		if n := len(out); n > 0 && strings.TrimSpace(it.Heading) == "" && strings.TrimSpace(it.Org) == "" {
			last := &out[n-1]
			if last.Dates == "" {
				last.Dates = it.Dates
			} else if it.Dates != "" {
				out = append(out, it)
				continue
			}
			if it.Text != "" {
				last.Text = strings.TrimSpace(last.Text + "\n" + it.Text)
			}
			last.Bullets = append(append([]string(nil), last.Bullets...), it.Bullets...)
			continue
		}
		out = append(out, it)
	}
	return out
}

func nonEmpty(s ...string) []string {
	var out []string
	for _, x := range s {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if strings.TrimSpace(x) != "" {
			return strings.TrimSpace(x)
		}
	}
	return ""
}

// ---- the person's own files -----------------------------------------------------------------

// OwnFile is a CV or letter file the person would rather send than Job Hunt's.
type OwnFile struct {
	Name string `json:"name"`
	Data []byte `json:"data"`
	At   int64  `json:"at"`
}

// OwnKinds are the two files a person can bring for a role.
var OwnKinds = map[string]string{"cv": "owncv", "letter": "ownletter"}

// SetOwnFile keeps the person's own file for a role. Word and PDF only.
func (e *Engine) SetOwnFile(roleID int64, kind, name string, data []byte) error {
	doc, ok := OwnKinds[kind]
	if !ok {
		return errors.New("unknown kind of file")
	}
	low := strings.ToLower(name)
	switch {
	case strings.HasSuffix(low, ".pdf") && strings.HasPrefix(string(data), "%PDF"):
	case strings.HasSuffix(low, ".docx") && strings.HasPrefix(string(data), "PK"):
	default:
		return errors.New("use a Word (.docx) or PDF file")
	}
	if len(data) > 10<<20 {
		return errors.New("that file is over 10 MB")
	}
	if _, err := e.S.Role(roleID); err != nil {
		return err
	}
	if err := e.S.SaveDoc(roleID, doc, OwnFile{Name: name, Data: data, At: e.Now().Unix()}); err != nil {
		return err
	}
	e.S.Log(store.Activity{RoleID: roleID, Kind: "own_file", Text: "You chose your own " + map[string]string{"cv": "CV", "letter": "letter"}[kind] + " file to send: " + name})
	return nil
}

// DropOwnFile goes back to Job Hunt's own document.
func (e *Engine) DropOwnFile(roleID int64, kind string) error {
	doc, ok := OwnKinds[kind]
	if !ok {
		return errors.New("unknown kind of file")
	}
	return e.S.DropDoc(roleID, doc)
}

// Own returns the person's own file of that kind for a role, if they gave one.
func (e *Engine) Own(roleID int64, kind string) (File, bool) {
	var f OwnFile
	if ok, _ := e.S.Doc(roleID, OwnKinds[kind], &f); !ok || len(f.Data) == 0 {
		return File{}, false
	}
	return File{Name: f.Name, Data: f.Data}, true
}

// OwnInfo is what the page shows of an own file: no bytes.
type OwnInfo struct {
	Name string `json:"name"`
	At   int64  `json:"at"`
}

func (e *Engine) OwnInfo(roleID int64, kind string) *OwnInfo {
	var f OwnFile
	if ok, _ := e.S.Doc(roleID, OwnKinds[kind], &f); !ok {
		return nil
	}
	return &OwnInfo{f.Name, f.At}
}

// ---- the posting on the employer's own site --------------------------------------------------------

// OwnSite is where the same posting is on the employer's own site.
type OwnSite struct {
	URL  string `json:"url"`
	Note string `json:"note"`
	From string `json:"from"` // "search": a board Job Hunt searches; "web": found on the web
	At   int64  `json:"at"`
}

// The employer's own systems among the sources Job Hunt reads.
var ownSystems = map[string]bool{"greenhouse": true, "lever": true, "ashby": true, "smartrecruiters": true, "workday": true, "workable": true, "bamboohr": true, "recruitee": true, "page": true, "site": true}

// Hosts of the applicant systems employers run their own careers sites on.
var systemHosts = []string{"myworkdayjobs.com", "myworkdaysite.com", "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "workable.com", "bamboohr.com", "recruitee.com", "icims.com", "taleo.net", "successfactors.com", "successfactors.eu", "oraclecloud.com", "jobvite.com", "teamtailor.com", "personio.de", "personio.com", "breezy.hr", "applytojob.com", "ultipro.com", "ukg.com", "dayforcehcm.com", "paylocity.com", "csod.com", "avature.net", "eightfold.ai", "phenompeople.com", "pinpointhq.com", "rippling.com", "jazz.co"}

// Hosts that are job boards, never the employer's own site.
var boardHosts = []string{"linkedin.com", "indeed.", "glassdoor.", "ziprecruiter.", "monster.", "jobbank.gc.ca", "workopolis.", "adzuna.", "jooble.", "simplyhired.", "talent.com", "eluta.ca", "google.com"}

func hostOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
}

func under(host, domain string) bool {
	domain = strings.TrimPrefix(strings.ToLower(domain), "www.")
	return host == domain || strings.HasSuffix(host, "."+domain)
}

// OnOwnSite reports whether an address is on the employer's own site or on an
// applicant system it runs, and not on a job board.
func OnOwnSite(raw, employerSite string) bool {
	h := hostOf(raw)
	if h == "" {
		return false
	}
	for _, b := range boardHosts {
		if strings.HasSuffix(b, ".") && (strings.HasPrefix(h, b) || strings.Contains(h, "."+b)) || under(h, b) {
			return false
		}
	}
	if s := hostOf(employerSite); s != "" && under(h, s) {
		return true
	}
	if s := hostOf("https://" + strings.TrimPrefix(strings.TrimPrefix(employerSite, "https://"), "http://")); s != "" && under(h, s) {
		return true
	}
	for _, d := range systemHosts {
		if under(h, d) {
			return true
		}
	}
	return false
}

// NeedsOwnSite reports whether a role came through a job board, so the same
// posting on the employer's own site is worth finding.
func NeedsOwnSite(r store.Role, site string) bool {
	if ownSystems[r.Source] {
		return false
	}
	if r.Source == "manual" && OnOwnSite(firstNonEmpty(r.ApplyURL, r.URL), site) {
		return false
	}
	return true
}

// OwnSiteFromSearches looks for the same role among the ones Job Hunt found
// on the employer's own boards. No Claude, no web.
func (e *Engine) OwnSiteFromSearches(r store.Role) string {
	others, _, _ := e.S.Roles(store.RoleFilter{CompanyID: r.CompanyID, Closed: []string{"*"}, Unread: true, Limit: 200})
	for _, o := range others {
		if o.ID == r.ID || !ownSystems[o.Source] || !sameTitle(o.Title, titleWords(r.Title)) {
			continue
		}
		if u := firstNonEmpty(o.ApplyURL, o.URL); hostOf(u) != "" {
			return u
		}
	}
	return ""
}

// FindOwnSite looks for the posting on the employer's own site: first among
// what Job Hunt's own searches found, then on the web if Claude can look.
func (e *Engine) FindOwnSite(ctx context.Context, roleID int64) error {
	r, err := e.S.Role(roleID)
	if err != nil {
		return err
	}
	c, _ := e.S.Company(r.CompanyID)
	if u := e.OwnSiteFromSearches(r); u != "" {
		return e.S.SaveDoc(roleID, "ownsite", OwnSite{URL: u, From: "search", At: e.Now().Unix()})
	}
	if !e.canSearchWeb() {
		return errors.New("looking on the web needs Claude connected with an API key or the Claude Code sign-in")
	}
	found, err := e.brain.FindPosting(ctx, r.Company, c.Site, r.Title, r.Location)
	if err != nil {
		return err
	}
	doc := OwnSite{From: "web", At: e.Now().Unix()}
	if OnOwnSite(found.URL, c.Site) {
		doc.URL = strings.TrimSpace(found.URL)
	} else {
		doc.Note = "Not found on their own site. They may only advertise it on job boards."
	}
	return e.S.SaveDoc(roleID, "ownsite", doc)
}

// ---- an offer ------------------------------------------------------------------------------

// OfferDoc is an offer the person pasted and what Job Hunt made of it.
type OfferDoc struct {
	Text   string            `json:"text"`
	Advice brain.OfferAdvice `json:"advice"`
	At     int64             `json:"at"`
}

// WeighOffer reads an offer the person pasted.
func (e *Engine) WeighOffer(ctx context.Context, roleID int64, text string) error {
	r, err := e.S.Role(roleID)
	if err != nil {
		return err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("paste the offer first")
	}
	adv, err := e.brain.Offer(ctx, e.Person(), postingOf(r), text)
	if err != nil {
		return err
	}
	if r.Stage != "offer" && r.Closed == "" {
		e.S.SetStage(roleID, "offer")
	}
	return e.S.SaveDoc(roleID, "offer", OfferDoc{Text: text, Advice: adv, At: e.Now().Unix()})
}

// ---- after a no -------------------------------------------------------------------------------

// NoReply is the short answer to a no.
type NoReply struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
	To      string `json:"to"`
	Email   string `json:"email"`
}

// WriteNoReply drafts a gracious reply to a rejection, to the person who sent it if Job Hunt has their mail.
func (e *Engine) WriteNoReply(ctx context.Context, roleID int64) error {
	r, err := e.S.Role(roleID)
	if err != nil {
		return err
	}
	var to, addr, theirs string
	if ms, _, _ := e.S.Mails(store.MailFilter{RoleID: roleID, Limit: 5}); len(ms) > 0 {
		m := ms[0]
		for _, x := range ms {
			if x.Kind == "rejection" {
				m = x
				break
			}
		}
		to, addr = m.FromName, m.FromAddr
		if full, err := e.S.Mail(m.ID); err == nil {
			theirs = full.Body
		}
	}
	msg, err := e.brain.RejectionReply(ctx, e.Person(), postingOf(r), to, theirs)
	if err != nil {
		return err
	}
	return e.S.SaveDoc(roleID, "noreply", NoReply{Subject: msg.Subject, Body: msg.Body, To: to, Email: addr})
}

// ---- applied here before -------------------------------------------------------------------------

// Differs is what changed between the CV the employer has and this one.
type Differs struct {
	EarlierRef
	Added   []string `json:"added"`
	Removed []string `json:"removed"`
}

// EarlierDiff says, line by line, how this role's CV differs from the one the
// employer already has. Nil when this CV was not written with an earlier one.
func (e *Engine) EarlierDiff(roleID int64, doc TailoredCV, sent cv.CV) *Differs {
	if doc.Earlier == nil {
		return nil
	}
	_, then, _, err := e.RoleCV(doc.Earlier.RoleID)
	if err != nil {
		return nil
	}
	split := func(s string) []string {
		var out []string
		for _, l := range strings.Split(s, "\n") {
			if l = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "- ")); l != "" {
				out = append(out, l)
			}
		}
		return out
	}
	set := func(ls []string) map[string]bool {
		m := map[string]bool{}
		for _, l := range ls {
			m[l] = true
		}
		return m
	}
	was, now := split(cv.Text(then)), split(cv.Text(sent))
	a, b := set(was), set(now)
	d := &Differs{EarlierRef: *doc.Earlier}
	for _, l := range now {
		if !a[l] {
			d.Added = append(d.Added, l)
		}
	}
	for _, l := range was {
		if !b[l] {
			d.Removed = append(d.Removed, l)
		}
	}
	return d
}

// ---- helpers -------------------------------------------------------------------------------------

func readingOf(r store.Role) brain.Reading {
	var rd brain.Reading
	json.Unmarshal(r.Reading, &rd)
	return rd
}
