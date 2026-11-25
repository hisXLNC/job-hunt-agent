package engine

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// ---- recruiters and hiring people, found in two years of mail ---------------------------
//
// A switch on the inbox card, off until the person turns it on. Only the
// envelopes (sender, subject, date) of two years of mail are read to pick
// out who might be a recruiter; system senders are left out. Of those, only
// the newest message from each sender is opened, and only its opening and
// signature are passed to Claude, a few senders to a request.

// RecruiterScan is how the last look through the mail went.
type RecruiterScan struct {
	At    int64  `json:"at"` // the last look that covered everything up to then
	Found int    `json:"found"`
	Note  string `json:"note,omitempty"`
	// TriedAt is the last look, finished or not; More says senders were left
	// for the next look, which then comes soon.
	TriedAt int64 `json:"tried_at,omitempty"`
	More    bool  `json:"more,omitempty"`
}

// recruiterScanDue says whether it is time to look through the mail again:
// a week after a whole look, an hour after one that left senders for later
// or failed.
func (e *Engine) recruiterScanDue() bool {
	s, now := e.RecruiterScan(), e.Now()
	if now.Sub(time.Unix(s.TriedAt, 0)) < time.Hour {
		return false
	}
	return s.More || s.Note != "" || now.Sub(time.Unix(s.At, 0)) > 7*24*time.Hour
}

const (
	recruiterScanKey = "mail_recruiters"
	judgedKey        = "mail_recruiters_judged"
	scanSenders      = 40 // senders looked at in one go
	scanBatch        = 10 // senders to one request to Claude
)

func (e *Engine) RecruiterScan() RecruiterScan {
	var s RecruiterScan
	e.S.Get(recruiterScanKey, &s)
	return s
}

var (
	systemLocalRe = regexp.MustCompile(`^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|news(?:letter)?s?|info|hello|support|help|team|admin|marketing|updates?|jobs|careers|recruiting|recruitment|talent|hr|hiring|apply|applications?|contact|service|billing|accounts?|security|digest|members?|community|feedback|surveys?|calendar|invites?|reply|messages?|mail|email)(?:[+._-].*)?$`)
	systemWordRe  = regexp.MustCompile(`no-?reply|donotreply|do-not-reply|bounce|notification|mailer`)
	recruitWordRe = regexp.MustCompile(`(?i)\b(?:recruit\w*|talent|hiring|interview\w*|opportunit\w*|position|role|candida\w*|application|your (?:cv|resume|résumé|profile|background|experience)|job|career\w*|vacanc\w*|headhunt\w*|opening)\b`)
	phoneRe       = regexp.MustCompile(`\+?\(?\d[\d ().-]{7,20}\d`)
	linkedInRe    = regexp.MustCompile(`(?i)(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]{2,100}/?`)
	quoteStartRe  = regexp.MustCompile(`(?im)^(?:on .{4,200} wrote:|-{2,} ?original message ?-{2,}|from: .+|_{8,})\s*$`)
)

// systemDomains send mail for systems, not for people.
var systemDomains = []string{"linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com", "workopolis.com", "google.com", "facebookmail.com", "github.com", "calendly.com", "mailchimp.com", "sendgrid.net", "amazonses.com", "zoom.us", "microsoft.com", "apple.com"}

// freeMail domains say nothing about whom a person works for.
var freeMail = []string{"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com"}

func domainIn(domain string, list []string) bool {
	for _, d := range list {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			return true
		}
	}
	return false
}

// systemSender reports whether an address belongs to a machine or a shared
// mailbox rather than a person.
func systemSender(addr string) bool {
	local, domain, ok := strings.Cut(strings.ToLower(addr), "@")
	if !ok || local == "" || domain == "" {
		return true
	}
	return systemLocalRe.MatchString(local) || systemWordRe.MatchString(local) || domainIn(domain, systemDomains) || domainIn(domain, mailSenders)
}

// signatureText is the opening of a message and its signature, without the
// earlier messages quoted under it.
func signatureText(body string) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	if loc := quoteStartRe.FindStringIndex(body); loc != nil && loc[0] > 0 {
		body = body[:loc[0]]
	}
	var lines []string
	for _, l := range strings.Split(body, "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, ">") {
			lines = append(lines, l)
		}
	}
	head := clipText(strings.Join(lines, "\n"), 500)
	tail := lines[max(len(lines)-14, 0):]
	sig := strings.Join(tail, "\n")
	if strings.Contains(head, sig) {
		return head
	}
	return head + "\n[…]\n" + clipText(sig, 900)
}

func digitsOf(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}

// sigPart is the signature end of what signatureText made.
func sigPart(text string) string {
	if i := strings.LastIndex(text, "\n[…]\n"); i >= 0 {
		return text[i:]
	}
	lines := strings.Split(text, "\n")
	return strings.Join(lines[max(len(lines)-8, 0):], "\n")
}

// checkedPhone keeps a phone number only when the signature itself has it.
func checkedPhone(claimed, text string) string {
	text = sigPart(text)
	for _, p := range []string{claimed, phoneRe.FindString(text)} {
		p = oneLine(p)
		d := digitsOf(p)
		if len(d) >= 9 && len(d) <= 15 && strings.Contains(digitsOf(text), d) && phoneRe.MatchString(p) {
			return clipText(p, 30)
		}
	}
	return ""
}

// checkedLinkedIn keeps a profile link only when the signature has it.
func checkedLinkedIn(claimed, text string) string {
	text = sigPart(text)
	for _, l := range []string{claimed, linkedInRe.FindString(text)} {
		l = strings.TrimSpace(l)
		if l == "" || !linkedInRe.MatchString(l) || linkedInRe.FindString(l) != l || !strings.Contains(strings.ToLower(text), strings.ToLower(strings.TrimPrefix(strings.TrimPrefix(l, "https://"), "http://"))) {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(l), "http") {
			l = "https://" + l
		}
		return safeURL(l)
	}
	return ""
}

// plainLabel keeps a name, title or employer that came from mail to a short,
// plain line.
func plainLabel(s string, n int) string {
	s = oneLine(s)
	if strings.ContainsAny(s, "<>@{}\\") {
		return ""
	}
	return clipText(s, n)
}

type senderSeen struct {
	addr, name, subject string
	at                  int64
	uids                []uint32
}

// ScanRecruiters looks through up to two years of mail for recruiters and
// hiring people, and adds them to People with what their signature gives.
func (e *Engine) ScanRecruiters(ctx context.Context) error {
	set := e.MailSet()
	if !set.On || !set.Recruiters {
		return nil
	}
	scan := e.RecruiterScan()
	scan.TriedAt = e.Now().Unix()
	fail := func(err error) error {
		scan.Note = err.Error()
		e.S.Set(recruiterScanKey, scan)
		e.S.Changed("connections")
		return err
	}
	judged := map[string]int64{}
	e.S.Get(judgedKey, &judged)
	known := map[string]bool{}
	if rows, err := e.S.Pairs(`SELECT lower(email), id FROM people WHERE email != ''`); err == nil {
		for _, r := range rows {
			known[r.Label] = true
		}
	}

	c, err := e.openMail(ctx, set)
	if err != nil {
		return fail(err)
	}
	opened := true
	defer func() {
		if opened {
			c.close()
		}
	}()
	box := wholeBox(c)
	if box != "" {
		_, err = c.cmd("EXAMINE %s", imapQuote(box))
	}
	if box == "" || err != nil {
		if _, err := c.cmd("EXAMINE INBOX"); err != nil {
			return fail(errors.New("couldn't open the inbox"))
		}
	}
	now := e.Now()
	since := now.AddDate(-2, 0, 0)
	if scan.At > 0 {
		since = time.Unix(scan.At, 0).Add(-48 * time.Hour)
	}
	lines, err := c.cmd("UID SEARCH SINCE %s", since.Format("2-Jan-2006"))
	if err != nil {
		return fail(errors.New("couldn't search the inbox"))
	}
	var uids []uint32
	for _, l := range lines {
		if rest, ok := strings.CutPrefix(l.text, "* SEARCH"); ok {
			for _, f := range strings.Fields(rest) {
				if u, err := strconv.ParseUint(f, 10, 32); err == nil {
					uids = append(uids, uint32(u))
				}
			}
		}
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	if len(uids) > 6000 {
		uids = uids[len(uids)-6000:]
	}

	// Envelopes only: who wrote, about what, when.
	senders := map[string]*senderSeen{}
	for start := 0; start < len(uids) && ctx.Err() == nil; start += 200 {
		chunk := uids[start:min(start+200, len(uids))]
		strs := make([]string, len(chunk))
		for i, u := range chunk {
			strs[i] = strconv.FormatUint(uint64(u), 10)
		}
		lines, err := c.cmd("UID FETCH %s (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])", strings.Join(strs, ","))
		if err != nil {
			return fail(errors.New("couldn't read the inbox"))
		}
		for _, l := range lines {
			m := uidRe.FindStringSubmatch(l.text)
			if m == nil || len(l.lits) == 0 {
				continue
			}
			u, _ := strconv.ParseUint(m[1], 10, 32)
			h := parseHead(l.lits[0])
			addr := h.fromAddr
			if addr == "" || strings.EqualFold(addr, set.User) || known[addr] || judged[addr] > 0 || systemSender(addr) {
				continue
			}
			if sources.AlertSite(addr, h.subject) != "" {
				continue
			}
			s := senders[addr]
			if s == nil {
				s = &senderSeen{addr: addr}
				senders[addr] = s
			}
			s.uids = append(s.uids, uint32(u))
			if h.at >= s.at {
				s.at, s.name, s.subject = h.at, h.fromName, h.subject
			}
		}
	}
	// Only senders whose mail looks like it is about work are opened.
	var list []*senderSeen
	for _, s := range senders {
		if recruitWordRe.MatchString(s.subject) || e.matchMail(s.name, s.addr, s.subject).companyID != 0 {
			list = append(list, s)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].at > list[j].at })
	more := len(list) > scanSenders
	if more {
		list = list[:scanSenders]
	}
	var asks []brain.Sender
	for i, s := range list {
		body, err := c.cmd("UID FETCH %d (UID BODY.PEEK[]<0.30000>)", s.uids[len(s.uids)-1])
		if err != nil {
			continue
		}
		text := ""
		for _, bl := range body {
			if len(bl.lits) > 0 {
				text = signatureText(bodyText(bl.lits[0]))
			}
		}
		asks = append(asks, brain.Sender{Ref: i, From: strings.TrimSpace(s.name + " <" + s.addr + ">"), Subject: s.subject, Text: text})
	}

	var found []*senderSeen
	var labelUIDs []uint32
	boards := map[int64]bool{}
	for start := 0; start < len(asks) && ctx.Err() == nil; start += scanBatch {
		batch := asks[start:min(start+scanBatch, len(asks))]
		got, err := e.brain.Senders(ctx, batch)
		if err != nil {
			if stopsWork(err) {
				e.S.Set(judgedKey, judged)
				return fail(err)
			}
			continue
		}
		byRef := map[int]brain.SenderReading{}
		for _, g := range got {
			byRef[g.Ref] = g
		}
		for _, a := range batch {
			s := list[a.Ref]
			judged[s.addr] = now.Unix()
			g, ok := byRef[a.Ref]
			if !ok || (g.Kind != "recruiter" && g.Kind != "manager") {
				continue
			}
			cid, ok := e.keepRecruiter(s, g, a.Text)
			if !ok {
				continue
			}
			found = append(found, s)
			labelUIDs = append(labelUIDs, s.uids[max(len(s.uids)-50, 0):]...)
			if cid != 0 {
				boards[cid] = true
			}
		}
	}
	if set.Labels && set.Gmail() {
		copyTo(c, labelRecruiters, labelUIDs)
	}
	c.close()
	opened = false

	// Their employers' job boards, found the way any employer's is.
	for cid := range boards {
		if ctx.Err() != nil {
			break
		}
		co, err := e.S.Company(cid)
		if err != nil || co.State == "muted" || co.BoardKind != "" || co.BoardCheckedAt != 0 {
			continue
		}
		e.DetectBoard(ctx, cid)
		if co, err = e.S.Company(cid); err == nil && co.BoardKind != "" && co.State == "suggested" {
			co.State = "following"
			e.S.SaveCompany(co)
			e.S.Log(store.Activity{Kind: "employers", CompanyID: co.ID, Text: "Watching " + co.Name + "'s job board, found through a recruiter's mail"})
		}
	}

	e.S.Set(judgedKey, judged)
	// A look that left senders for later keeps its window, so the rest of
	// the two years is still looked through; the senders judged are skipped.
	scan.Found, scan.Note, scan.More = scan.Found+len(found), "", more || ctx.Err() != nil
	if !scan.More {
		scan.At = now.Unix()
	}
	e.S.Set(recruiterScanKey, scan)
	if len(found) > 0 {
		e.S.Log(store.Activity{Kind: "people", Text: fmt.Sprintf("Found %s in your mail", countWord(len(found), "recruiter or hiring person"))})
	}
	e.S.Changed("people", "connections")
	return ctx.Err()
}

// keepRecruiter adds one sender to People, at their employer, and notes them
// on the roles there. It returns the employer, and false when nothing was
// kept. An employer the person muted is left alone.
func (e *Engine) keepRecruiter(s *senderSeen, g brain.SenderReading, text string) (int64, bool) {
	name := plainLabel(g.Name, 80)
	if name == "" {
		name = plainLabel(s.name, 80)
	}
	if name == "" {
		return 0, false
	}
	_, domain, _ := strings.Cut(s.addr, "@")
	company := plainLabel(g.Company, 80)
	if company == "" && !domainIn(domain, freeMail) {
		first := strings.Split(domain, ".")[0]
		if len(first) > 1 {
			company = strings.ToUpper(first[:1]) + first[1:]
		}
	}
	if !domainIn(domain, freeMail) {
		// An employer the person muted, known by its address.
		if muted, _ := e.S.Companies("muted"); len(muted) > 0 {
			for _, m := range muted {
				if m.Site != "" && strings.Contains(strings.ToLower(m.Site), "//"+domain) {
					return 0, false
				}
			}
		}
	}
	// An employer already on the list is used as it is: what a message
	// claims never changes it. Only one this look adds gets the sender's
	// site and has its board looked for.
	var co store.Company
	created := false
	if company != "" {
		if c, err := e.S.CompanyByName(company); err == nil {
			if c.State == "muted" {
				return 0, false
			}
			co = c
		} else {
			site := ""
			if !domainIn(domain, freeMail) {
				site = "https://" + domain
			}
			c, fresh, err := e.S.UpsertCompany(store.Company{Name: company, Site: site, State: "suggested", Source: "mail"})
			if err != nil || c.State == "muted" {
				return 0, false
			}
			co, created = c, fresh
		}
	}
	kind := "recruiter"
	if g.Kind == "manager" {
		kind = "manager"
	}
	when := time.Unix(s.at, 0).In(e.Now().Location()).Format("2 January 2006")
	p := store.Person{CompanyID: co.ID, Name: name, Title: plainLabel(g.Title, 100), Kind: kind,
		Why:   clipText("Wrote to you on "+when+": “"+plainLabel(s.subject, 120)+"”", 200),
		Email: s.addr, EmailSure: "sure", URL: checkedLinkedIn(g.LinkedIn, text), Phone: checkedPhone(g.Phone, text),
		Source: "mail", State: "new", KnowsYouAt: s.at}
	// Someone of that name is already there: a message signing with their
	// name does not change them (adding would fill in their empty details).
	if e.S.Count(`SELECT COUNT(*) FROM people WHERE (lower(name) = lower(?) AND company_id = ?) OR (? != '' AND url = ?)`, p.Name, p.CompanyID, p.URL, p.URL) > 0 {
		return 0, false
	}
	id, isNew, err := e.S.AddPerson(p)
	if err != nil || !isNew {
		return 0, false
	}
	e.S.Log(store.Activity{Kind: "people", PersonID: id, CompanyID: co.ID, Text: "Found in your mail: " + name + ", " + map[string]string{"recruiter": "a recruiter", "manager": "hiring"}[kind]})
	if co.ID != 0 {
		roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"applied", "reply", "interview", "offer"}, Limit: 200})
		n := 0
		for _, r := range roles {
			if r.CompanyID == co.ID && r.Closed != "no" && n < 3 {
				e.S.Log(store.Activity{Kind: "people", RoleID: r.ID, PersonID: id, CompanyID: co.ID, Text: name + " at " + co.Name + " wrote to you; found in your mail"})
				n++
			}
		}
	}
	if !created {
		return 0, true
	}
	return co.ID, true
}
