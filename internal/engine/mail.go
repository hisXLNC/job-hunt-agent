package engine

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"jobhunt/internal/brain"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// MailSet is how Job Hunt reads the person's inbox. It only ever reads: the
// mailbox is opened read-only and nothing is sent, moved or marked.
type MailSet struct {
	On       bool   `json:"on"`
	Host     string `json:"host"`
	User     string `json:"user"`
	Pass     string `json:"pass,omitempty"`
	Validity uint32 `json:"validity"`
	LastUID  uint32 `json:"last_uid"`
	LastAt   int64  `json:"last_at"`
	Note     string `json:"note"`
	// Box is the folder last read: "All Mail" where the mail service has one,
	// so a message the person archived is still seen; the inbox otherwise.
	Box string `json:"box,omitempty"`
	// Every is how often the inbox is read, in minutes (10 when 0).
	Every int `json:"every,omitempty"`
}

// Often is how often the inbox is read.
func (set MailSet) Often() time.Duration {
	if set.Every < 5 || set.Every > 240 {
		return 10 * time.Minute
	}
	return time.Duration(set.Every) * time.Minute
}

var allMailRe = regexp.MustCompile(`(?i)^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$`)

// wholeBox finds the folder that holds every message, archived or not
// (Gmail's "All Mail"). "" when the service has none.
func wholeBox(c *imapConn) string {
	lines, err := c.cmd(`LIST "" "*"`)
	if err != nil {
		return ""
	}
	for _, l := range lines {
		m := allMailRe.FindStringSubmatch(l.text)
		if m == nil || !strings.Contains(strings.ToLower(m[1]), `\all`) {
			continue
		}
		name := strings.TrimSpace(m[2])
		if u, err := strconv.Unquote(name); err == nil {
			name = u
		}
		if name != "" && !strings.ContainsAny(name, "\r\n{") {
			return name
		}
	}
	return ""
}

func (e *Engine) MailSet() MailSet {
	var set MailSet
	e.S.Get("mail", &set)
	if set.Host == "" {
		set.Host = "imap.gmail.com:993"
	}
	return set
}

// SetMail saves the mailbox settings and checks they work.
func (e *Engine) SetMail(ctx context.Context, set MailSet) error {
	old := e.MailSet()
	set.User = strings.TrimSpace(set.User)
	set.Pass = strings.ReplaceAll(strings.TrimSpace(set.Pass), " ", "")
	if set.Pass == "" {
		set.Pass = old.Pass
	}
	if set.Host == "" {
		set.Host = "imap.gmail.com:993"
	}
	if !strings.Contains(set.Host, ":") {
		set.Host += ":993"
	}
	if set.User != old.User || set.Host != old.Host {
		set.Validity, set.LastUID = 0, 0
	} else {
		set.Validity, set.LastUID, set.LastAt, set.Box = old.Validity, old.LastUID, old.LastAt, old.Box
	}
	if set.Every == 0 {
		set.Every = old.Every
	}
	set.Note = ""
	if set.On {
		if set.User == "" || set.Pass == "" {
			return errors.New("enter the address and the app password")
		}
		c, err := e.openMail(ctx, set)
		if err != nil {
			return err
		}
		c.close()
	}
	if err := e.S.Set("mail", set); err != nil {
		return err
	}
	e.S.Changed("connections")
	if set.On {
		e.Go("mail", "", func(ctx context.Context) error { return e.CheckMail(ctx) })
	}
	return nil
}

// ---- a very small read-only IMAP client -------------------------------------------------

type imapConn struct {
	c   net.Conn
	r   *bufio.Reader
	tag int
}

type imapLine struct {
	text string
	lits [][]byte
}

var litRe = regexp.MustCompile(`\{(\d+)\}$`)

func (c *imapConn) readLine() (imapLine, error) {
	var out imapLine
	for {
		s, err := c.r.ReadString('\n')
		if err != nil {
			return out, err
		}
		s = strings.TrimRight(s, "\r\n")
		m := litRe.FindStringSubmatch(s)
		if m == nil {
			out.text += s
			return out, nil
		}
		n, _ := strconv.Atoi(m[1])
		if n > 4<<20 {
			return out, errors.New("mail server sent an oversized part")
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(c.r, buf); err != nil {
			return out, err
		}
		out.text += s
		out.lits = append(out.lits, buf)
	}
}

func (c *imapConn) cmd(format string, args ...any) ([]imapLine, error) {
	c.tag++
	tag := fmt.Sprintf("a%d", c.tag)
	c.c.SetDeadline(time.Now().Add(60 * time.Second))
	if _, err := fmt.Fprintf(c.c, tag+" "+format+"\r\n", args...); err != nil {
		return nil, err
	}
	var lines []imapLine
	for {
		l, err := c.readLine()
		if err != nil {
			return lines, err
		}
		if rest, ok := strings.CutPrefix(l.text, tag+" "); ok {
			if strings.HasPrefix(strings.ToUpper(rest), "OK") {
				return lines, nil
			}
			return lines, errors.New(rest)
		}
		lines = append(lines, l)
	}
}

func (c *imapConn) close() {
	c.c.SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprintf(c.c, "z9 LOGOUT\r\n")
	c.c.Close()
}

func imapQuote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func (e *Engine) openMail(ctx context.Context, set MailSet) (*imapConn, error) {
	dial := e.mailDial
	if dial == nil {
		dial = func(ctx context.Context, host string) (net.Conn, error) {
			d := tls.Dialer{NetDialer: &net.Dialer{Timeout: 20 * time.Second}}
			return d.DialContext(ctx, "tcp", host)
		}
	}
	nc, err := dial(ctx, set.Host)
	if err != nil {
		return nil, fmt.Errorf("couldn't reach the mail server at %s", set.Host)
	}
	c := &imapConn{c: nc, r: bufio.NewReaderSize(nc, 64<<10)}
	nc.SetDeadline(time.Now().Add(30 * time.Second))
	if _, err := c.readLine(); err != nil {
		nc.Close()
		return nil, errors.New("the mail server didn't answer")
	}
	if _, err := c.cmd("LOGIN %s %s", imapQuote(set.User), imapQuote(set.Pass)); err != nil {
		nc.Close()
		return nil, errors.New("the mail server refused the sign-in. For Gmail this needs an app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password")
	}
	return c, nil
}

var (
	uidRe      = regexp.MustCompile(`\bUID (\d+)`)
	validityRe = regexp.MustCompile(`UIDVALIDITY (\d+)`)
)

// mailSenders are systems that send application mail on employers' behalf.
var mailSenders = []string{"greenhouse.io", "greenhouse-mail.io", "lever.co", "myworkday.com", "workday.com", "smartrecruiters.com", "ashbyhq.com", "icims.com", "taleo.net", "successfactors.com", "jobvite.com", "bamboohr.com", "workable.com", "recruitee.com", "teamtailor.com", "breezy.hr", "oraclecloud.com", "avature.net", "phenompeople.com"}

type mailHead struct {
	uid      uint32
	msgID    string
	fromName string
	fromAddr string
	subject  string
	at       int64
}

func decodeHeader(s string) string {
	dec := new(mime.WordDecoder)
	out, err := dec.DecodeHeader(s)
	if err != nil {
		return s
	}
	return out
}

func parseHead(raw []byte) mailHead {
	var h mailHead
	msg, err := mail.ReadMessage(bytes.NewReader(append(raw, '\r', '\n')))
	if err != nil {
		return h
	}
	h.subject = strings.TrimSpace(decodeHeader(msg.Header.Get("Subject")))
	h.msgID = strings.Trim(strings.TrimSpace(msg.Header.Get("Message-Id")), "<>")
	if a, err := mail.ParseAddress(msg.Header.Get("From")); err == nil {
		h.fromName, h.fromAddr = strings.TrimSpace(a.Name), strings.ToLower(a.Address)
	} else {
		h.fromName = decodeHeader(msg.Header.Get("From"))
	}
	if t, err := msg.Header.Date(); err == nil {
		h.at = t.Unix()
	}
	return h
}

// bodyParts returns a raw message's plain and HTML forms, either of which
// may be empty. The message may be cut short.
func bodyParts(rawMsg []byte) (plain, html string) {
	msg, err := mail.ReadMessage(bytes.NewReader(rawMsg))
	if err != nil {
		return "", ""
	}
	return partText(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body, 0)
}

// bodyText pulls readable text out of a raw message, which may be cut short.
func bodyText(rawMsg []byte) string {
	msg, err := mail.ReadMessage(bytes.NewReader(rawMsg))
	if err != nil {
		return ""
	}
	plain, html := partText(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body, 0)
	if strings.TrimSpace(plain) == "" {
		plain = sources.HTMLToText(html)
	}
	plain = strings.TrimSpace(strings.ReplaceAll(plain, "\r\n", "\n"))
	if len(plain) > 12000 {
		plain = plain[:12000]
	}
	return plain
}

func partText(ctype, enc string, r io.Reader, depth int) (plain, html string) {
	mt, params, err := mime.ParseMediaType(ctype)
	if err != nil {
		mt = "text/plain"
	}
	if strings.HasPrefix(mt, "multipart/") && depth < 4 {
		mr := multipart.NewReader(r, params["boundary"])
		for {
			p, err := mr.NextRawPart()
			if err != nil {
				break
			}
			pl, ht := partText(p.Header.Get("Content-Type"), p.Header.Get("Content-Transfer-Encoding"), p, depth+1)
			if plain == "" {
				plain = pl
			}
			if html == "" {
				html = ht
			}
		}
		return plain, html
	}
	if mt != "text/plain" && mt != "text/html" {
		return "", ""
	}
	switch strings.ToLower(strings.TrimSpace(enc)) {
	case "base64":
		r = base64.NewDecoder(base64.StdEncoding, &skipNewlines{r})
	case "quoted-printable":
		r = quotedprintable.NewReader(r)
	}
	b, _ := io.ReadAll(io.LimitReader(r, 200<<10))
	text := string(b)
	if cs := strings.ToLower(params["charset"]); cs == "iso-8859-1" || cs == "windows-1252" || cs == "latin1" {
		rs := make([]rune, 0, len(b))
		for _, c := range b {
			rs = append(rs, rune(c))
		}
		text = string(rs)
	}
	text = strings.ToValidUTF8(text, "")
	if mt == "text/html" {
		return "", text
	}
	return text, ""
}

type skipNewlines struct{ r io.Reader }

func (s *skipNewlines) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	j := 0
	for i := 0; i < n; i++ {
		if p[i] != '\r' && p[i] != '\n' {
			p[j] = p[i]
			j++
		}
	}
	if j == 0 && n > 0 && err == nil {
		return s.Read(p)
	}
	return j, err
}

// CheckMail looks at what arrived since last time. Only messages that are
// plainly about the search (from an employer the person applied to, from a
// hiring system, from someone they wrote to, or a job alert from a job site)
// are opened; everything else in the inbox is left unread and never leaves
// the computer. Job alerts are read for their postings here, on this
// computer, and are not passed to Claude.
func (e *Engine) CheckMail(ctx context.Context) error {
	set := e.MailSet()
	if !set.On {
		return nil
	}
	fail := func(err error) error {
		set.Note = err.Error()
		e.S.Set("mail", set)
		e.S.Changed("connections")
		return err
	}
	c, err := e.openMail(ctx, set)
	if err != nil {
		return fail(err)
	}
	defer c.close()
	box := wholeBox(c)
	lines, err := []imapLine(nil), errors.New("none")
	if box != "" {
		lines, err = c.cmd("EXAMINE %s", imapQuote(box))
	}
	if err != nil {
		box = ""
		lines, err = c.cmd("EXAMINE INBOX")
	}
	if err != nil {
		return fail(errors.New("couldn't open the inbox"))
	}
	if box != set.Box {
		// Another folder numbers its messages its own way.
		set.Box, set.LastUID = box, 0
	}
	for _, l := range lines {
		if m := validityRe.FindStringSubmatch(l.text); m != nil {
			v, _ := strconv.ParseUint(m[1], 10, 32)
			if uint32(v) != set.Validity {
				set.Validity, set.LastUID = uint32(v), 0
			}
		}
	}
	now := e.Now()
	since := now.Add(-14 * 24 * time.Hour)
	if set.LastAt > 0 {
		since = time.Unix(set.LastAt, 0).Add(-48 * time.Hour)
	}
	lines, err = c.cmd("UID SEARCH SINCE %s", since.Format("2-Jan-2006"))
	if err != nil {
		return fail(errors.New("couldn't search the inbox"))
	}
	var uids []uint32
	for _, l := range lines {
		if rest, ok := strings.CutPrefix(l.text, "* SEARCH"); ok {
			for _, f := range strings.Fields(rest) {
				if u, err := strconv.ParseUint(f, 10, 32); err == nil && uint32(u) > set.LastUID {
					uids = append(uids, uint32(u))
				}
			}
		}
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	if len(uids) > 400 {
		uids = uids[len(uids)-400:]
	}
	taken := 0
	alerts, alertSeen, alertNew := e.alertsOn(), 0, 0
	alertMails := 0
	for start := 0; start < len(uids) && ctx.Err() == nil; start += 50 {
		chunk := uids[start:min(start+50, len(uids))]
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
			h.uid = uint32(u)
			if h.msgID == "" {
				h.msgID = fmt.Sprintf("uid:%d:%d", set.Validity, h.uid)
			}
			if h.uid > set.LastUID {
				set.LastUID = h.uid
			}
			if e.S.MailSeen(h.msgID) {
				continue
			}
			if strings.EqualFold(h.fromAddr, set.User) {
				continue // the person's own sent mail, when every folder is read
			}
			// A job alert from a job site is a list of postings, not a reply.
			if site := sources.AlertSite(h.fromAddr, h.subject); site != "" && alerts {
				if posts := e.readAlert(c, h, site); len(posts) > 0 {
					seen, added := e.takeAlert(site, posts)
					alertSeen, alertNew, alertMails = alertSeen+seen, alertNew+added, alertMails+1
					// Remembered as seen; its text is not kept.
					e.S.AddMail(store.Mail{MsgID: h.msgID, FromName: h.fromName, FromAddr: h.fromAddr, Subject: h.subject, At: h.at, Kind: "alert", State: "done",
						Summary: fmt.Sprintf("%s from a %s job alert, %d new", countWord(seen, "posting"), sources.AlertName(site), added)})
					continue
				}
			}
			match := e.matchMail(h.fromName, h.fromAddr, h.subject)
			if !match.relevant {
				continue
			}
			if match.handled {
				continue
			}
			body, err := c.cmd("UID FETCH %d (UID BODY.PEEK[]<0.60000>)", h.uid)
			if err != nil || len(body) == 0 {
				continue
			}
			var text string
			for _, bl := range body {
				if len(bl.lits) > 0 {
					text = bodyText(bl.lits[0])
				}
			}
			m2 := store.Mail{MsgID: h.msgID, FromName: h.fromName, FromAddr: h.fromAddr, Subject: h.subject, At: h.at, Body: text, PersonID: match.personID, CompanyID: match.companyID}
			if err := e.takeMail(ctx, m2); err != nil {
				if stopsWork(err) {
					// Try these again next time rather than lose them.
					set.LastUID = h.uid - 1
					set.Note = ""
					e.S.Set("mail", set)
					return err
				}
				continue
			}
			taken++
		}
	}
	set.LastAt, set.Note = now.Unix(), ""
	e.S.Set("mail", set)
	if alertMails > 0 {
		e.setSourceState(srcAlerts, func(s *SourceState) { s.At, s.Seen, s.New = now.Unix(), alertSeen, alertNew })
		e.S.Changed("runs")
		if alertNew > 0 {
			e.S.Log(store.Activity{Kind: "search", Text: fmt.Sprintf("Job-alert e-mails: %s, %d new", countWord(alertSeen, "posting"), alertNew)})
		}
	}
	e.S.Changed("connections")
	if taken > 0 {
		e.S.Log(store.Activity{Kind: "mail", Text: fmt.Sprintf("Read %d new message%s about your search", taken, plural(taken))})
	}
	return nil
}

// readAlert opens one job-alert e-mail and reads the postings out of it.
// Nothing in the message is followed or obeyed; see sources.ParseAlert.
func (e *Engine) readAlert(c *imapConn, h mailHead, site string) []sources.Posting {
	body, err := c.cmd("UID FETCH %d (UID BODY.PEEK[]<0.400000>)", h.uid)
	if err != nil {
		return nil
	}
	for _, bl := range body {
		if len(bl.lits) > 0 {
			plain, html := bodyParts(bl.lits[0])
			return sources.ParseAlert(site, html, plain)
		}
	}
	return nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

type mailMatch struct {
	relevant  bool
	handled   bool // dealt with by a rule; nothing more to read
	personID  int64
	companyID int64
}

var (
	acceptedRe = regexp.MustCompile(`(?i)^(.+?) accepted your invitation`)
	messagedRe = regexp.MustCompile(`(?i)^(.+?) (?:sent you a (?:new )?message|replied to your message|just messaged you)`)
)

// matchMail decides, from the envelope alone, whether a message has to do
// with the search.
func (e *Engine) matchMail(fromName, fromAddr, subject string) mailMatch {
	var m mailMatch
	domain := ""
	if i := strings.LastIndexByte(fromAddr, '@'); i >= 0 {
		domain = fromAddr[i+1:]
	}
	people, _ := e.S.People(store.PeopleFilter{})
	// LinkedIn tells you by mail when someone accepts or answers.
	if strings.HasSuffix(domain, "linkedin.com") {
		name := ""
		replied := false
		if x := acceptedRe.FindStringSubmatch(subject); x != nil {
			name = x[1]
		} else if x := messagedRe.FindStringSubmatch(subject); x != nil {
			name, replied = x[1], true
		}
		if name == "" {
			return m
		}
		for _, p := range people {
			if strings.EqualFold(strings.TrimSpace(p.Name), strings.TrimSpace(name)) {
				e.heardFrom(p, replied)
				m.relevant, m.handled, m.personID = true, true, p.ID
				return m
			}
		}
		return m
	}
	for _, p := range people {
		if p.Email != "" && strings.EqualFold(p.Email, fromAddr) {
			m.relevant, m.personID, m.companyID = true, p.ID, p.CompanyID
			return m
		}
	}
	hay := " " + store.NormName(fromName+" "+strings.NewReplacer(".", " ", "-", " ").Replace(domain)+" "+subject) + " "
	rows, _ := e.S.Pairs(`SELECT c.name, c.id FROM companies c WHERE EXISTS (SELECT 1 FROM roles r WHERE r.company_id = c.id AND r.stage IN ('found','ready','applied','reply','interview','offer') AND r.closed != 'no')`)
	for _, row := range rows {
		n := store.NormName(row.Label)
		if len(n) >= 3 && strings.Contains(hay, " "+n+" ") {
			m.relevant, m.companyID = true, int64(row.N)
			return m
		}
	}
	for _, d := range mailSenders {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			m.relevant = true
			return m
		}
	}
	// "Thank you for applying": an application the person sent, perhaps for
	// a role Job Hunt never found.
	if receiptRe.MatchString(subject) {
		m.relevant = true
	}
	return m
}

var receiptRe = regexp.MustCompile(`(?i)\b(thank(?:s| you) for (?:applying|your application|your interest in)|application (?:received|confirmation|submitted|has been received)|we(?: have|'ve)? received your application|your application (?:to|for|with|at|has been)|successfully applied)\b`)

// heardFrom records that someone accepted or answered on LinkedIn.
func (e *Engine) heardFrom(p store.Person, replied bool) {
	if n, err := e.S.LatestNote(p.ID); err == nil && n.State == "sent" && replied {
		e.S.NoteReplied(n.ID)
		e.S.Log(store.Activity{Kind: "reply", PersonID: p.ID, CompanyID: p.CompanyID, Text: p.Name + " answered your note"})
		return
	}
	if p.KnowsYouAt == 0 {
		p.KnowsYouAt = e.Now().Unix()
		if p.State == "new" {
			p.State = "active"
		}
		e.S.SavePerson(p)
		e.S.Log(store.Activity{Kind: "reply", PersonID: p.ID, CompanyID: p.CompanyID, Text: p.Name + " accepted your invitation"})
	}
}

// takeMail reads one message, files it, and moves the role it is about.
func (e *Engine) takeMail(ctx context.Context, m store.Mail) error {
	var refs []brain.RoleRef
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"ready", "applied", "reply", "interview", "offer"}, Sort: "stage", Limit: 80})
	// A confirmation can be for a role the person applied to before Job Hunt
	// prepared anything: the roles it kept at the employers the message names.
	hay := " " + store.NormName(m.FromName+" "+m.Subject+" "+clipText(m.Body, 1500)) + " "
	found, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"found"}, Sort: "age", Limit: 300})
	extra := 0
	for _, r := range found {
		n := store.NormName(r.Company)
		if extra < 25 && (r.CompanyID == m.CompanyID && m.CompanyID != 0 || len(n) >= 3 && strings.Contains(hay, " "+n+" ")) {
			roles = append(roles, r)
			extra++
		}
	}
	for _, r := range roles {
		ref := brain.RoleRef{ID: r.ID, Company: r.Company, Title: r.Title, Stage: r.Stage}
		if r.CompanyID == m.CompanyID {
			refs = append([]brain.RoleRef{ref}, refs...)
		} else {
			refs = append(refs, ref)
		}
	}
	reading, err := e.brain.ReadMail(ctx, e.Person(), brain.Mail{From: strings.TrimSpace(m.FromName + " <" + m.FromAddr + ">"), Subject: m.Subject, Body: m.Body}, refs)
	if err != nil {
		return err
	}
	m.Kind, m.Summary, m.Next, m.Draft, m.RoleID = reading.Kind, reading.Summary, reading.Next, reading.Reply, reading.RoleID
	if m.Kind == "interview" {
		// They ask when the person is free: the draft offers real free times.
		m.Draft = e.fillTimes(m.Draft)
	}
	if m.PersonID != 0 && (m.Kind == "other" || m.Kind == "question") {
		m.Kind = "person"
	}
	if m.Kind == "other" && m.RoleID == 0 && m.PersonID == 0 {
		// Not about the search after all (a newsletter from an employer, say).
		// Remember only that it was seen.
		m.Body, m.State = "", "done"
		_, _, err := e.S.AddMail(m)
		return err
	}
	switch m.Kind {
	case "receipt", "rejection", "other":
		m.State = "done"
	default:
		m.State = "new"
	}
	id, isNew, err := e.S.AddMail(m)
	if err != nil || !isNew {
		return err
	}
	_ = id
	if m.PersonID != 0 {
		if p, err := e.S.Person(m.PersonID); err == nil {
			e.heardFrom(p, true)
		}
	}
	if m.RoleID == 0 && m.Kind == "receipt" {
		// They confirm an application Job Hunt knew nothing about: keep it,
		// so it is counted, followed up and matched to what they write next.
		if rid := e.appliedElsewhere(reading.Company, reading.Title, m.At); rid != 0 {
			m.RoleID = rid
			e.S.MailRole(id, rid)
		}
	}
	if m.RoleID == 0 {
		return nil
	}
	r, err := e.S.Role(m.RoleID)
	if err != nil {
		return nil
	}
	if r.Closed == "no" {
		return nil // the person said no to this one; mail does not bring it back
	}
	act := store.Activity{Kind: "mail", RoleID: r.ID, CompanyID: r.CompanyID, Text: firstOf(m.Summary, "They wrote to you")}
	switch m.Kind {
	case "receipt":
		if stageOrder(r.Stage) < stageOrder("applied") {
			if r.Closed != "" {
				e.S.Reopen(r.ID) // set aside by the program, but the person applied
			}
			e.MarkApplied(r.ID, "(their confirmation arrived by mail)")
		}
	case "interview", "assessment":
		e.S.Advance(r.ID, "interview")
		if m.Kind == "interview" {
			e.bookFromMail(r, reading.When, reading.Link, m.At)
		}
	case "offer":
		e.S.Advance(r.ID, "offer")
	case "question":
		e.S.Advance(r.ID, "reply")
	case "rejection":
		if stageOrder(r.Stage) >= stageOrder("applied") {
			e.S.CloseRole(r.ID, "rejected", "They said no by mail on "+time.Unix(m.At, 0).Format("2 January"))
		}
	}
	e.S.Log(act)
	if m.State == "new" {
		plain := map[string]string{"interview": "An interview request", "assessment": "An assessment to do", "offer": "An offer"}[m.Kind]
		e.Say(plain != "", firstOf(plain, "An employer wrote to you"), r.Company+" wrote to you", firstOf(m.Summary, m.Subject), "#/replies")
	}
	return nil
}

// bookFromMail puts a confirmed interview into Interviews, with prep, when
// the message fixes one moment for it. The moment and the link come from
// mail, so both are checked; an entry already there is left alone.
func (e *Engine) bookFromMail(r store.Role, when, link string, mailAt int64) {
	when = strings.TrimSpace(when)
	if when == "" {
		return
	}
	var at time.Time
	var err error
	for _, layout := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05", time.RFC3339, "2006-01-02 15:04"} {
		if at, err = time.ParseInLocation(layout, when, e.Now().Location()); err == nil {
			break
		}
	}
	now := e.Now()
	if err != nil || at.Before(now) || at.After(now.AddDate(0, 0, 120)) {
		return
	}
	talks, _ := e.S.TalksForRole(r.ID)
	for _, t := range talks {
		if d := t.At - at.Unix(); d > -6*3600 && d < 6*3600 {
			return
		}
	}
	id, err := e.AddTalk(store.Talk{Kind: "interview", RoleID: r.ID, Title: "Interview", At: at.Unix(), Minutes: e.TalkSet().Minutes, Link: safeURL(link)})
	if err != nil {
		return
	}
	e.S.Log(store.Activity{Kind: "talk", RoleID: r.ID, CompanyID: r.CompanyID, Text: "Added to Interviews from their message: " + at.Format("Monday 2 January, 15:04")})
	e.Say(true, "An interview is booked", "Interview with "+r.Company+" on "+at.Format("Monday 2 January")+" at "+at.Format("15:04"), "It is in Interviews, taken from their message. Check the time against the message; your prep pack is being written.", fmt.Sprintf("#/interviews/%d", id))
}

// appliedElsewhere records an application the person made that Job Hunt had
// no role for. It never touches a role the person said no to.
func (e *Engine) appliedElsewhere(company, title string, at int64) int64 {
	company, title = clipText(strings.TrimSpace(company), 80), clipText(strings.TrimSpace(title), 120)
	if company == "" || title == "" || strings.ContainsAny(company+title, "<>\n") {
		return 0
	}
	c, _, err := e.S.UpsertCompany(store.Company{Name: company, State: "suggested", Source: "mail"})
	if err != nil {
		return 0
	}
	if id, closed, dup := e.S.SimilarRole(c.ID, title, ""); dup {
		if closed == "no" {
			return 0
		}
		return id
	}
	id, err := e.S.AddRole(store.Role{CompanyID: c.ID, Key: "mail:" + store.NormName(company) + ":" + strings.ToLower(title), Source: "mail", Title: title, Applicants: -1, Stage: "found", FirstSeenAt: at})
	if err != nil {
		return 0
	}
	e.S.Log(store.Activity{Kind: "added", RoleID: id, CompanyID: c.ID, Text: "Added from their confirmation e-mail: you applied to this one yourself"})
	return id
}

func clipText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

func stageOrder(st string) int {
	for i, s := range store.Stages {
		if s == st {
			return i
		}
	}
	return -1
}

var fromLineRe = regexp.MustCompile(`(?im)^from:\s*(.+)$`)
var subjLineRe = regexp.MustCompile(`(?im)^subject:\s*(.+)$`)

// PasteMail takes in a message the person pasted, for those who would rather
// not connect their inbox.
func (e *Engine) PasteMail(ctx context.Context, from, subject, body string, roleID int64) (int64, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return 0, errors.New("paste the message first")
	}
	if from == "" {
		if x := fromLineRe.FindStringSubmatch(body); x != nil {
			from = strings.TrimSpace(x[1])
		}
	}
	if subject == "" {
		if x := subjLineRe.FindStringSubmatch(body); x != nil {
			subject = strings.TrimSpace(x[1])
		}
	}
	sum := sha256.Sum256([]byte(body))
	m := store.Mail{MsgID: "paste:" + hex.EncodeToString(sum[:8]), Subject: subject, Body: body, At: e.Now().Unix()}
	if a, err := mail.ParseAddress(from); err == nil {
		m.FromName, m.FromAddr = a.Name, strings.ToLower(a.Address)
	} else {
		m.FromName = from
	}
	if roleID != 0 {
		if r, err := e.S.Role(roleID); err == nil {
			m.CompanyID = r.CompanyID
		}
	} else {
		m.CompanyID = e.matchMail(m.FromName, m.FromAddr, m.Subject).companyID
	}
	if e.S.MailSeen(m.MsgID) {
		return 0, errors.New("that message is already here")
	}
	if err := e.takeMail(ctx, m); err != nil {
		return 0, err
	}
	var id int64
	if list, _, _ := e.S.Mails(store.MailFilter{Limit: 5}); len(list) > 0 {
		for _, x := range list {
			if x.MsgID == m.MsgID {
				id = x.ID
			}
		}
	}
	return id, nil
}
