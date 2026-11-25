package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"regexp"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// ---- writing to the mailbox: drafts and labels -------------------------------------------
//
// Each of these is its own switch on the inbox card, off until the person
// turns it on. A draft is never sent from the mailbox: it waits in Drafts
// for the person.

const (
	labelApplied    = "JobHunt/Applied"
	labelRecruiters = "JobHunt/Recruiters"
)

func hasFlag(flags, use string) bool {
	for _, f := range strings.Fields(strings.ToLower(flags)) {
		if f == strings.ToLower(use) {
			return true
		}
	}
	return false
}

// appendMsg puts one message into a folder. The literal is sent only after
// the server says to go ahead.
func (c *imapConn) appendMsg(box, flags string, msg []byte) error {
	c.tag++
	tag := fmt.Sprintf("a%d", c.tag)
	c.c.SetDeadline(time.Now().Add(60 * time.Second))
	if _, err := fmt.Fprintf(c.c, "%s APPEND %s (%s) {%d}\r\n", tag, imapQuote(box), flags, len(msg)); err != nil {
		return err
	}
	for {
		l, err := c.readLine()
		if err != nil {
			return err
		}
		if strings.HasPrefix(l.text, "+") {
			break
		}
		if rest, ok := strings.CutPrefix(l.text, tag+" "); ok {
			return errors.New(rest)
		}
	}
	if _, err := c.c.Write(append(append([]byte{}, msg...), '\r', '\n')); err != nil {
		return err
	}
	for {
		l, err := c.readLine()
		if err != nil {
			return err
		}
		if rest, ok := strings.CutPrefix(l.text, tag+" "); ok {
			if strings.HasPrefix(strings.ToUpper(rest), "OK") {
				return nil
			}
			return errors.New(rest)
		}
	}
}

// copyTo labels messages of the open folder. On Gmail a copy into a label's
// folder adds the label; the message itself is not changed. A label that
// cannot be made or given is left for next time; it never stops the reading.
func copyTo(c *imapConn, box string, uids []uint32) {
	if len(uids) == 0 {
		return
	}
	if _, err := c.cmd("CREATE %s", imapQuote(box)); err != nil && !strings.Contains(strings.ToUpper(err.Error()), "ALREADYEXISTS") && !strings.Contains(strings.ToLower(err.Error()), "exist") {
		return
	}
	strs := make([]string, len(uids))
	for i, u := range uids {
		strs[i] = strconv.FormatUint(uint64(u), 10)
	}
	c.cmd("UID COPY %s %s", strings.Join(strs, ","), imapQuote(box))
}

// labelFor says which label a message Job Hunt took in gets: the ones from a
// recruiter or someone hiring go under Recruiters, the rest about an
// application under Applied.
func (e *Engine) labelFor(msgID string) string {
	rows, _ := e.S.Pairs(`SELECT m.kind || ':' || COALESCE(p.kind, ''), m.role_id FROM mails m LEFT JOIN people p ON p.id = m.person_id WHERE m.msg_id = ?`, msgID)
	if len(rows) == 0 {
		return ""
	}
	kind, who, _ := strings.Cut(rows[0].Label, ":")
	switch {
	case who == "recruiter" || who == "manager":
		return labelRecruiters
	case kind == "other" && rows[0].N == 0:
		return ""
	}
	return labelApplied
}

// ---- a message going out -------------------------------------------------------------

// Outgoing is one message the person wrote with Job Hunt, about one thing:
// a reply to a message (mail), a follow-up (chase), a reply to a no
// (noreply), an answer to an offer (offer), a thank-you after a
// conversation (thanks) or a note to a person (note). ID is that thing's.
type Outgoing struct {
	Kind    string `json:"kind"`
	ID      int64  `json:"id"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// outFor is what an outgoing message belongs to.
type outFor struct {
	roleID, personID, companyID, mailID int64
	thread                              string // Message-ID it answers, without <>
}

var msgIDRe = regexp.MustCompile(`^[^\s<>@"]{1,200}@[^\s<>@"]{1,200}$`)

// realMsgID reports whether a stored id came from a real message (not one
// pasted or numbered by Job Hunt), so a reply can point at it.
func realMsgID(id string) bool {
	return !strings.HasPrefix(id, "uid:") && !strings.HasPrefix(id, "paste:") && msgIDRe.MatchString(id)
}

var rePrefixRe = regexp.MustCompile(`(?i)^\s*((re|aw|fwd?|tr)\s*:\s*)+`)

// sameSubject reports whether two subjects are one conversation's.
func sameSubject(a, b string) bool {
	a, b = oneLine(rePrefixRe.ReplaceAllString(a, "")), oneLine(rePrefixRe.ReplaceAllString(b, ""))
	return a != "" && strings.EqualFold(a, b)
}

// answered finds the message, filed under a role or from a person, that an
// outgoing one answers: only one from the person it goes to, under the same
// subject, so what the person sees is what is sent.
func (e *Engine) answered(where string, id int64, to, subject string) (string, int64) {
	if to == "" {
		return "", 0
	}
	rows, _ := e.S.Pairs(`SELECT msg_id || char(0) || subject, id FROM mails WHERE `+where+` = ? AND lower(from_addr) = lower(?) ORDER BY at DESC LIMIT 20`, id, to)
	for _, r := range rows {
		msgID, subj, _ := strings.Cut(r.Label, "\x00")
		if realMsgID(msgID) && sameSubject(subj, subject) {
			return msgID, int64(r.N)
		}
	}
	return "", 0
}

func (e *Engine) outFor(o Outgoing) (outFor, error) {
	var f outFor
	to, _ := oneAddress(o.To)
	switch o.Kind {
	case "mail":
		m, err := e.S.Mail(o.ID)
		if err != nil {
			return f, err
		}
		f.roleID, f.personID, f.companyID, f.mailID = m.RoleID, m.PersonID, m.CompanyID, m.ID
		if realMsgID(m.MsgID) {
			f.thread = m.MsgID
		}
		return f, nil
	case "chase", "noreply", "offer":
		r, err := e.S.Role(o.ID)
		if err != nil {
			return f, err
		}
		f.roleID, f.companyID = r.ID, r.CompanyID
		f.thread, f.mailID = e.answered("role_id", r.ID, to, o.Subject)
		return f, nil
	case "thanks":
		t, err := e.S.Talk(o.ID)
		if err != nil {
			return f, err
		}
		f.roleID, f.personID = t.RoleID, t.PersonID
	case "note":
		n, err := e.S.Note(o.ID)
		if err != nil {
			return f, err
		}
		f.roleID, f.personID = n.RoleID, n.PersonID
	default:
		return f, errors.New("unknown kind of message")
	}
	if f.personID != 0 {
		f.thread, f.mailID = e.answered("person_id", f.personID, to, o.Subject)
	}
	if f.thread == "" && f.roleID != 0 {
		f.thread, f.mailID = e.answered("role_id", f.roleID, to, o.Subject)
	}
	if f.roleID != 0 {
		if r, err := e.S.Role(f.roleID); err == nil {
			f.companyID = r.CompanyID
		}
	}
	return f, nil
}

// oneLine keeps a header value to one line of plain text.
func oneLine(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}

// oneAddress reads exactly one address; a list is refused, so one press is
// one message to one person.
func oneAddress(s string) (string, error) {
	s = oneLine(s)
	if s == "" {
		return "", nil
	}
	list, err := mail.ParseAddressList(s)
	if err != nil || len(list) != 1 {
		return "", errors.New("give one e-mail address to send it to")
	}
	return list[0].Address, nil
}

// buildMessage writes the message as a mail program would.
func (e *Engine) buildMessage(set MailSet, o Outgoing, f outFor) (msg []byte, msgID string, err error) {
	to, err := oneAddress(o.To)
	if err != nil {
		return nil, "", err
	}
	body := strings.TrimSpace(strings.ReplaceAll(o.Body, "\r\n", "\n"))
	if body == "" {
		return nil, "", errors.New("the message is empty")
	}
	var b bytes.Buffer
	from := mail.Address{Name: oneLine(e.S.Profile().Name), Address: set.User}
	domain := "jobhunt.local"
	if i := strings.LastIndexByte(set.User, '@'); i >= 0 && msgIDRe.MatchString("x"+set.User[i:]) {
		domain = set.User[i+1:]
	}
	rnd := make([]byte, 12)
	rand.Read(rnd)
	msgID = "jobhunt." + hex.EncodeToString(rnd) + "@" + domain
	fmt.Fprintf(&b, "From: %s\r\n", from.String())
	if to != "" {
		fmt.Fprintf(&b, "To: %s\r\n", (&mail.Address{Address: to}).String())
	}
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", oneLine(o.Subject)))
	fmt.Fprintf(&b, "Date: %s\r\n", e.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&b, "Message-ID: <%s>\r\n", msgID)
	if f.thread != "" {
		fmt.Fprintf(&b, "In-Reply-To: <%s>\r\nReferences: <%s>\r\n", f.thread, f.thread)
	}
	b.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n")
	qp := quotedprintable.NewWriter(&b)
	qp.Write([]byte(body + "\n"))
	qp.Close()
	return b.Bytes(), msgID, nil
}

// savedDraft is where Job Hunt last put a draft for one thing.
type savedDraft struct {
	MsgID string `json:"msg_id"`
	Box   string `json:"box"`
}

func draftKey(o Outgoing) string { return fmt.Sprintf("gdraft:%s:%d", o.Kind, o.ID) }

func draftsBox(c *imapConn, set MailSet) string {
	if b := specialBox(c, `\drafts`); b != "" {
		return b
	}
	if set.Gmail() {
		return "[Gmail]/Drafts"
	}
	return "Drafts"
}

// keepWording stores the text as the person last changed it, on the thing it
// belongs to, so what was saved or sent is what the page shows.
func (e *Engine) keepWording(o Outgoing) error {
	subject, body := oneLine(o.Subject), strings.TrimSpace(o.Body)
	if body == "" {
		return errors.New("the message is empty")
	}
	switch o.Kind {
	case "mail":
		m, err := e.S.Mail(o.ID)
		if err != nil {
			return err
		}
		m.Draft = body
		return e.S.SaveMail(m)
	case "chase":
		return e.SaveChase(o.ID, subject, body)
	case "thanks":
		return e.SaveThanks(o.ID, subject, body)
	case "note":
		return e.S.SaveNoteText(o.ID, subject, body)
	case "noreply":
		var n NoReply
		if ok, err := e.S.Doc(o.ID, "noreply", &n); err != nil || !ok {
			return store.ErrNotFound
		}
		n.Subject, n.Body = subject, body
		return e.S.SaveDoc(o.ID, "noreply", n)
	case "offer":
		var d OfferDoc
		if ok, err := e.S.Doc(o.ID, "offer", &d); err != nil || !ok {
			return store.ErrNotFound
		}
		d.Advice.Subject, d.Advice.Reply = subject, body
		return e.S.SaveDoc(o.ID, "offer", d)
	}
	return errors.New("unknown kind of message")
}

// SaveDraft puts the message in the mailbox's Drafts, in the thread of the
// message it answers. It is not sent: it waits there for the person. A
// draft saved again for the same thing replaces the one before.
func (e *Engine) SaveDraft(ctx context.Context, o Outgoing) error {
	set := e.MailSet()
	if !set.On || !set.Drafts {
		return errors.New("turn on “Save replies as drafts in my mail” on the inbox card under Settings → Connections first")
	}
	f, err := e.outFor(o)
	if err != nil {
		return err
	}
	if err := e.keepWording(o); err != nil {
		return err
	}
	msg, msgID, err := e.buildMessage(set, o, f)
	if err != nil {
		return err
	}
	c, err := e.openMail(ctx, set)
	if err != nil {
		return err
	}
	defer c.close()
	box := draftsBox(c, set)
	var old savedDraft
	if ok, _ := e.S.Get(draftKey(o), &old); ok && old.MsgID != "" {
		dropDraft(c, old)
	}
	if err := c.appendMsg(box, `\Draft \Seen`, msg); err != nil {
		return errors.New("the mail server didn't take the draft: " + oneLine(err.Error()))
	}
	e.S.Set(draftKey(o), savedDraft{MsgID: msgID, Box: box})
	e.S.Log(store.Activity{Kind: "mail", RoleID: f.roleID, CompanyID: f.companyID, PersonID: f.personID, Text: "Saved as a draft in your mail: " + clipText(oneLine(o.Subject), 120)})
	return nil
}

// dropDraft removes one draft Job Hunt saved, found by its own Message-ID,
// from the Drafts folder and nowhere else.
func dropDraft(c *imapConn, d savedDraft) {
	if d.Box == "" || !msgIDRe.MatchString(d.MsgID) || !strings.HasPrefix(d.MsgID, "jobhunt.") {
		return
	}
	if _, err := c.cmd("SELECT %s", imapQuote(d.Box)); err != nil {
		return
	}
	lines, err := c.cmd(`UID SEARCH HEADER Message-ID %s`, imapQuote("<"+d.MsgID+">"))
	if err != nil {
		return
	}
	var uids []string
	for _, l := range lines {
		if rest, ok := strings.CutPrefix(l.text, "* SEARCH"); ok {
			for _, u := range strings.Fields(rest) {
				if _, err := strconv.ParseUint(u, 10, 32); err == nil {
					uids = append(uids, u)
				}
			}
		}
	}
	if len(uids) == 0 || len(uids) > 3 {
		return
	}
	set := strings.Join(uids, ",")
	if _, err := c.cmd(`UID STORE %s +FLAGS.SILENT (\Deleted)`, set); err != nil {
		return
	}
	c.cmd("UID EXPUNGE %s", set)
}

// ---- sending, one press for one message ------------------------------------------------

type smtpPlain struct{ user, pass string }

func (a smtpPlain) Start(*smtp.ServerInfo) (string, []byte, error) {
	return "PLAIN", []byte("\x00" + a.user + "\x00" + a.pass), nil
}
func (a smtpPlain) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return nil, errors.New("the mail server asked for more than a password")
	}
	return nil, nil
}

// smtpHost is the sending server that goes with the reading one.
func smtpHost(set MailSet) string {
	if set.Gmail() {
		return "smtp.gmail.com:465"
	}
	host, _, err := net.SplitHostPort(set.Host)
	if err != nil {
		host = set.Host
	}
	if h, ok := strings.CutPrefix(host, "imap."); ok {
		host = "smtp." + h
	}
	return host + ":465"
}

type sentMark struct {
	Sum string `json:"sum"`
	At  int64  `json:"at"`
}

// SendMail sends one message the person wrote and pressed Send on. It is
// never called by Job Hunt itself, the assistant or the phone.
func (e *Engine) SendMail(ctx context.Context, o Outgoing) error {
	set := e.MailSet()
	if !set.On || !set.Send {
		return errors.New("turn on “Let me send mail from Job Hunt” on the inbox card under Settings → Connections first")
	}
	to, err := oneAddress(o.To)
	if err != nil {
		return err
	}
	if to == "" {
		return errors.New("say who it goes to")
	}
	f, err := e.outFor(o)
	if err != nil {
		return err
	}
	if err := e.keepWording(o); err != nil {
		return err
	}
	// The same text to the same person twice within ten minutes is a second
	// press, not a second message.
	sum := sha256.Sum256([]byte(to + "\x00" + oneLine(o.Subject) + "\x00" + strings.TrimSpace(o.Body)))
	key := fmt.Sprintf("sent:%s:%d", o.Kind, o.ID)
	var last sentMark
	if ok, _ := e.S.Get(key, &last); ok && last.Sum == hex.EncodeToString(sum[:]) && e.Now().Unix()-last.At < 600 {
		return errors.New("that message has already gone")
	}
	msg, _, err := e.buildMessage(set, o, f)
	if err != nil {
		return err
	}
	if err := e.smtpSend(ctx, set, to, msg); err != nil {
		return err
	}
	e.S.Set(key, sentMark{Sum: hex.EncodeToString(sum[:]), At: e.Now().Unix()})
	e.S.Log(store.Activity{Kind: "mail", RoleID: f.roleID, CompanyID: f.companyID, PersonID: f.personID, Text: "You sent “" + clipText(oneLine(o.Subject), 120) + "” to " + to + " from Job Hunt"})
	switch o.Kind {
	case "mail":
		if m, err := e.S.Mail(o.ID); err == nil {
			m.State = "done"
			e.S.SaveMail(m)
		}
	case "chase":
		e.ChaseSent(o.ID)
	case "note":
		e.NoteSent(o.ID)
	}
	var d savedDraft
	if ok, _ := e.S.Get(draftKey(o), &d); ok && d.MsgID != "" && set.Drafts {
		if c, err := e.openMail(ctx, set); err == nil {
			dropDraft(c, d)
			c.close()
		}
		e.S.Set(draftKey(o), savedDraft{})
	}
	e.S.Changed("mail", "today", "roles")
	return nil
}

func (e *Engine) smtpSend(ctx context.Context, set MailSet, to string, msg []byte) error {
	addr := smtpHost(set)
	host, _, _ := net.SplitHostPort(addr)
	dial := e.smtpDial
	if dial == nil {
		dial = func(ctx context.Context, addr string) (net.Conn, error) {
			d := tls.Dialer{NetDialer: &net.Dialer{Timeout: 20 * time.Second}, Config: &tls.Config{ServerName: host}}
			return d.DialContext(ctx, "tcp", addr)
		}
	}
	nc, err := dial(ctx, addr)
	if err != nil {
		return fmt.Errorf("couldn't reach the mail server at %s", addr)
	}
	nc.SetDeadline(time.Now().Add(60 * time.Second))
	c, err := smtp.NewClient(nc, host)
	if err != nil {
		nc.Close()
		return errors.New("the mail server didn't answer")
	}
	defer c.Close()
	if err := c.Auth(smtpPlain{set.User, set.Pass}); err != nil {
		return errors.New("the mail server refused the sign-in for sending")
	}
	if err := c.Mail(set.User); err != nil {
		return errors.New("the mail server refused the message: " + oneLine(err.Error()))
	}
	if err := c.Rcpt(to); err != nil {
		return errors.New("the mail server refused that address: " + oneLine(err.Error()))
	}
	w, err := c.Data()
	if err != nil {
		return errors.New("the mail server refused the message: " + oneLine(err.Error()))
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return errors.New("the mail server refused the message: " + oneLine(err.Error()))
	}
	c.Quit()
	return nil
}

// ---- a reply, written when the person asks --------------------------------------------

// WriteMailReply drafts the reply to one message. Reading mail never does
// this by itself; the person presses "Write it".
func (e *Engine) WriteMailReply(ctx context.Context, id int64) error {
	m, err := e.S.Mail(id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(m.Body) == "" {
		return errors.New("the text of this message was not kept, so there is nothing to answer")
	}
	reply, err := e.brain.MailReply(ctx, e.Person(), brain.Mail{From: strings.TrimSpace(m.FromName + " <" + m.FromAddr + ">"), Subject: m.Subject, Body: m.Body}, m.Kind)
	if err != nil {
		return err
	}
	if reply == "" {
		return errors.New("no reply came back; try again")
	}
	if m.Kind == "interview" {
		// They ask when the person is free: the draft offers real free times.
		reply = e.fillTimes(reply)
	}
	m.Draft = reply
	return e.S.SaveMail(m)
}
