package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/office"
	"jobhunt/internal/store"
)

// What happens to a role's documents after they are first written: the
// letter's style, "ask for changes" with its way back, the PDF files, the
// one follow-up to an application, saving a role for later and taking back
// "I applied".

// ---- the letter's style, asking for changes ---------------------------------------------------

func (e *Engine) roleForWriting(roleID int64) (store.Role, brain.Reading, brain.Person, error) {
	var reading brain.Reading
	r, err := e.S.Role(roleID)
	if err != nil {
		return r, reading, brain.Person{}, err
	}
	json.Unmarshal(r.Reading, &reading)
	p := e.Person()
	if len(p.CVs) == 0 {
		return r, reading, p, errors.New("add a CV first")
	}
	return r, reading, p, nil
}

// RewriteLetter writes a role's letter again: in another style, with what the
// person asked for, or both. The letter as it was is kept so it can be put back.
func (e *Engine) RewriteLetter(ctx context.Context, roleID int64, style, ask string) error {
	var doc LetterDoc
	ok, err := e.S.Doc(roleID, "letter", &doc)
	if err != nil {
		return err
	}
	if !ok {
		return store.ErrNotFound
	}
	was := firstOf(doc.Style, store.LetterStyles[0])
	if style == "" {
		style = was
	}
	if !store.KnownLetterStyle(style) {
		return fmt.Errorf("unknown letter style %q", style)
	}
	ask = strings.TrimSpace(ask)
	if ask == "" && style == was {
		return nil
	}
	r, reading, p, err := e.roleForWriting(roleID)
	if err != nil {
		return err
	}
	var again *brain.Again
	if ask != "" {
		again = &brain.Again{Ask: ask, Text: doc.Text}
	}
	text, err := e.brain.Letter(ctx, p, postingOf(r), reading, style, again)
	if err != nil {
		return err
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("no letter came back; the one you had is unchanged")
	}
	next := LetterDoc{Text: text, Style: style, Prev: &LetterBefore{Text: doc.Text, Style: was, Ask: ask}}
	if err := e.S.SaveDoc(roleID, "letter", next); err != nil {
		return err
	}
	what := "Letter written again in the " + style + " style"
	if ask != "" {
		what = "Letter changed as you asked"
	}
	e.S.Log(store.Activity{Kind: "rewrote", RoleID: roleID, CompanyID: r.CompanyID, Text: what})
	return nil
}

// UndoLetter puts back the letter as it was before it was last written again.
func (e *Engine) UndoLetter(roleID int64) error {
	var doc LetterDoc
	ok, err := e.S.Doc(roleID, "letter", &doc)
	if err != nil {
		return err
	}
	if !ok || doc.Prev == nil {
		return store.ErrNotFound
	}
	return e.S.SaveDoc(roleID, "letter", LetterDoc{Text: doc.Prev.Text, Style: doc.Prev.Style})
}

// SaveLetter keeps the person's own edit of a letter. Its style, and the way
// back to the version before, stay.
func (e *Engine) SaveLetter(roleID int64, text string) error {
	var doc LetterDoc
	if _, err := e.S.Doc(roleID, "letter", &doc); err != nil {
		return err
	}
	doc.Text = strings.TrimSpace(text)
	return e.S.SaveDoc(roleID, "letter", doc)
}

// RetailorCV tailors a role's CV again with what the person asked for. The
// edits as they were are kept so they can be put back.
func (e *Engine) RetailorCV(ctx context.Context, roleID int64, ask string) error {
	ask = strings.TrimSpace(ask)
	if ask == "" {
		return errors.New("say what to change")
	}
	var doc TailoredCV
	ok, err := e.S.Doc(roleID, "cv", &doc)
	if err != nil {
		return err
	}
	if !ok {
		return store.ErrNotFound
	}
	r, reading, p, err := e.roleForWriting(roleID)
	if err != nil {
		return err
	}
	base, err := e.CVModel(doc.CVID)
	if err != nil {
		return err
	}
	tail, err := e.brain.Tailor(ctx, p, base, postingOf(r), reading, &brain.Again{Ask: ask, Changes: doc.Changes})
	if err != nil {
		return err
	}
	next := doc
	next.Prev = &CVBefore{Changes: doc.Changes, LeftOut: doc.LeftOut, Questions: doc.Questions, FitAfter: doc.FitAfter, Ask: ask}
	next.Changes, next.LeftOut, next.Questions, next.FitAfter = tail.Changes, tail.LeftOut, tail.Questions, tail.FitAfter
	if err := e.S.SaveDoc(roleID, "cv", next); err != nil {
		return err
	}
	e.S.SetFitTailored(roleID, tail.FitAfter)
	e.S.Log(store.Activity{Kind: "rewrote", RoleID: roleID, CompanyID: r.CompanyID, Text: fmt.Sprintf("CV tailored again as you asked (%d changes)", len(tail.Changes))})
	return nil
}

// UndoCV puts back the CV edits as they were before the person asked for changes.
func (e *Engine) UndoCV(roleID int64) error {
	var doc TailoredCV
	ok, err := e.S.Doc(roleID, "cv", &doc)
	if err != nil {
		return err
	}
	if !ok || doc.Prev == nil {
		return store.ErrNotFound
	}
	doc.Changes, doc.LeftOut, doc.Questions, doc.FitAfter = doc.Prev.Changes, doc.Prev.LeftOut, doc.Prev.Questions, doc.Prev.FitAfter
	doc.Prev = nil
	if err := e.S.SaveDoc(roleID, "cv", doc); err != nil {
		return err
	}
	e.S.SetFitTailored(roleID, doc.FitAfter)
	return nil
}

// ---- the files ----------------------------------------------------------------------------

// sender is the name that goes on a file: the one on the CV, else the profile's.
func (e *Engine) sender(c cv.CV) string {
	return firstOf(c.Name, e.S.Profile().Name, "CV")
}

// roleLetter lays out a role's letter as it is sent: who it is from, the
// greeting and closing its style calls for, or the person's own closing.
func (e *Engine) roleLetter(roleID int64) (office.Letter, store.Role, error) {
	var doc LetterDoc
	ok, err := e.S.Doc(roleID, "letter", &doc)
	if err != nil {
		return office.Letter{}, store.Role{}, err
	}
	if !ok {
		return office.Letter{}, store.Role{}, store.ErrNotFound
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return office.Letter{}, r, err
	}
	p := e.S.Profile()
	contact := []string{}
	if cvs, _ := e.S.CVs(); len(cvs) > 0 {
		var m cv.CV
		if json.Unmarshal(cvs[0].Model, &m) == nil {
			contact = append([]string{m.Contact.Location, m.Contact.Email, m.Contact.Phone}, m.Contact.Links...)
		}
	}
	greeting, sign := "Dear hiring team,", "Sincerely,"
	switch doc.Style {
	case "formal":
		greeting = "Dear Hiring Committee,"
	case "short":
		sign = "Best,"
	case "warm":
		sign = "With thanks,"
	}
	l := office.Letter{
		Name: p.Name, Contact: contact, Date: e.Now().Format("2 January 2006"),
		To: []string{"Hiring team", r.Company}, Subject: r.Title, Body: greeting + "\n\n" + doc.Text, Sign: sign,
	}
	for _, line := range strings.Split(p.Signature, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			l.Signature = append(l.Signature, line)
		}
	}
	return l, r, nil
}

// CVPDF renders the tailored CV for a role as a PDF.
func (e *Engine) CVPDF(roleID int64) (File, error) {
	_, out, _, err := e.RoleCV(roleID)
	if err != nil {
		return File{}, err
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderCVPDF(out)
	return File{Name: fileNameExt("pdf", e.sender(out), r.Company, "CV"), Data: data}, err
}

// LetterPDF renders the letter for a role as a PDF.
func (e *Engine) LetterPDF(roleID int64) (File, error) {
	l, r, err := e.roleLetter(roleID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderLetterPDF(l)
	return File{Name: fileNameExt("pdf", firstOf(l.Name, "Letter"), r.Company, "Letter"), Data: data}, err
}

// PackPDF is the letter and the CV in one PDF, the letter first, for forms
// that take a single file.
func (e *Engine) PackPDF(roleID int64) (File, error) {
	l, r, err := e.roleLetter(roleID)
	if err != nil {
		return File{}, err
	}
	_, out, _, err := e.RoleCV(roleID)
	if err != nil {
		return File{}, err
	}
	data, err := office.RenderPackPDF(l, out)
	return File{Name: fileNameExt("pdf", e.sender(out), r.Company, "Letter and CV"), Data: data}, err
}

// PDFGap reports whether a role's documents hold writing a PDF from Job Hunt
// cannot show (it knows Western European letters only), so the page can say
// to use Word for this one.
func (e *Engine) PDFGap(roleID int64) bool {
	var b strings.Builder
	if _, out, _, err := e.RoleCV(roleID); err == nil {
		b.WriteString(out.Name + " " + out.Headline + " " + out.Summary)
		for _, u := range cv.Units(out) {
			b.WriteString(" " + u.Text)
		}
	}
	var doc LetterDoc
	if ok, _ := e.S.Doc(roleID, "letter", &doc); ok {
		b.WriteString(" " + doc.Text)
	}
	return !office.PDFShows(b.String())
}

// ---- following up on an application ------------------------------------------------------------

// ChaseDoc is the "chase" document of a role: the one follow-up e-mail to an
// application that has had no answer. The person sends it; Job Hunt only
// writes it and remembers what became of it.
type ChaseDoc struct {
	Subject   string `json:"subject"`
	Body      string `json:"body"`
	To        string `json:"to"`    // who it goes to, when someone there is known
	Email     string `json:"email"` // their address, when known
	Days      int    `json:"days"`  // days since applying when it was written
	WrittenAt int64  `json:"written_at"`
	SentAt    int64  `json:"sent_at"`    // the person said they sent it
	DroppedAt int64  `json:"dropped_at"` // the person let it go
}

// quietApplications lists the applications old enough, and quiet enough, to
// be worth one follow-up. Older than six weeks is past following up.
func (e *Engine) quietApplications(p store.Profile, now time.Time) []store.Role {
	after := p.ChaseAfter()
	if after <= 0 {
		return nil
	}
	rs, _ := e.S.AppliedQuiet(now.AddDate(0, 0, -45).Unix(), now.AddDate(0, 0, -after).Unix(), now.Unix(), 12)
	return rs
}

func (e *Engine) chase(roleID int64) (ChaseDoc, store.Role, error) {
	var doc ChaseDoc
	r, err := e.S.Role(roleID)
	if err != nil {
		return doc, r, err
	}
	if _, err := e.S.Doc(roleID, "chase", &doc); err != nil {
		return doc, r, err
	}
	return doc, r, nil
}

// WriteChase drafts the follow-up to an application. There is one per
// application: once it is sent, no other is written.
func (e *Engine) WriteChase(ctx context.Context, roleID int64) error {
	doc, r, err := e.chase(roleID)
	if err != nil {
		return err
	}
	if r.AppliedAt == 0 || r.Closed != "" {
		return errors.New("a follow-up is for a role you applied to and that is still open")
	}
	if doc.SentAt > 0 {
		return errors.New("you already followed up on this one; a second one rarely helps")
	}
	var reading brain.Reading
	json.Unmarshal(r.Reading, &reading)
	// Someone at the employer who hires, if one is known.
	to, email := "", ""
	for _, per := range e.PeopleForRole(roleID) {
		if (per.Kind == "recruiter" || per.Kind == "manager") && (to == "" || (email == "" && per.Email != "")) {
			to, email = per.Name, per.Email
		}
	}
	days := max(int(e.Now().Sub(time.Unix(r.AppliedAt, 0)).Hours()/24), 1)
	m, err := e.brain.FollowUp(ctx, e.Person(), postingOf(r), reading, days, to)
	if err != nil {
		return err
	}
	if m.Body == "" {
		return errors.New("no follow-up came back; try again")
	}
	return e.S.SaveDoc(roleID, "chase", ChaseDoc{Subject: m.Subject, Body: m.Body, To: to, Email: email, Days: days, WrittenAt: e.Now().Unix()})
}

// SaveChase keeps the person's own edit of the follow-up.
func (e *Engine) SaveChase(roleID int64, subject, body string) error {
	doc, _, err := e.chase(roleID)
	if err != nil {
		return err
	}
	if doc.WrittenAt == 0 {
		return store.ErrNotFound
	}
	doc.Subject, doc.Body = strings.TrimSpace(subject), strings.TrimSpace(body)
	return e.S.SaveDoc(roleID, "chase", doc)
}

// ChaseSent records that the person sent the follow-up. It goes into the
// role's history and the role is not suggested for a follow-up again.
func (e *Engine) ChaseSent(roleID int64) error {
	doc, r, err := e.chase(roleID)
	if err != nil {
		return err
	}
	if doc.SentAt > 0 {
		return nil
	}
	doc.SentAt, doc.DroppedAt = e.Now().Unix(), 0
	if err := e.S.SaveDoc(roleID, "chase", doc); err != nil {
		return err
	}
	e.S.Log(store.Activity{Kind: "chased", RoleID: roleID, CompanyID: r.CompanyID, Text: "You sent a follow-up"})
	e.S.Changed("today")
	return nil
}

// ChaseDropped records that the person decided not to follow up, so Today
// stops suggesting it. The application itself is untouched.
func (e *Engine) ChaseDropped(roleID int64) error {
	doc, _, err := e.chase(roleID)
	if err != nil {
		return err
	}
	if doc.SentAt > 0 || doc.DroppedAt > 0 {
		return nil
	}
	doc.DroppedAt = e.Now().Unix()
	if err := e.S.SaveDoc(roleID, "chase", doc); err != nil {
		return err
	}
	e.S.Changed("today")
	return nil
}

// ChaseDue reports whether a role is one Today would suggest following up on.
func (e *Engine) ChaseDue(r store.Role) bool {
	for _, q := range e.quietApplications(e.S.Profile(), e.Now()) {
		if q.ID == r.ID {
			return true
		}
	}
	return false
}

// ---- taking back "I applied", saving for later, tidying -----------------------------------------

// Unapply takes back "I applied" when the person did not send it after all.
// The role goes back to where it was: ready when its documents exist, else
// found. A follow-up written for it goes too.
func (e *Engine) Unapply(id int64) error {
	r, err := e.S.Role(id)
	if err != nil {
		return err
	}
	back := "found"
	var doc TailoredCV
	if ok, _ := e.S.Doc(id, "cv", &doc); ok {
		back = "ready"
	}
	moved, err := e.S.Unapply(id, back)
	if err != nil {
		return err
	}
	if !moved {
		return errors.New("only a role marked applied, with no reply yet, can be taken back")
	}
	e.S.DropDoc(id, "chase")
	e.S.Log(store.Activity{Kind: "unapplied", RoleID: id, CompanyID: r.CompanyID, Text: "You said you didn't send it after all"})
	return nil
}

// Later keeps a role off Today for a number of days (0 brings it back now).
// A closed role is refused: one the person said no to never comes back this way.
func (e *Engine) Later(id int64, days int) error {
	if days < 0 || days > 60 {
		return errors.New("save a role for up to 60 days")
	}
	r, err := e.S.Role(id)
	if err != nil {
		return err
	}
	until := int64(0)
	if days > 0 {
		// Back first thing on the day, not at the minute it was put away.
		until = dayStart(e.Now()).AddDate(0, 0, days).Unix()
	}
	ok, err := e.S.SetLater(id, until)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("this role is closed; reopen it first")
	}
	if days > 0 {
		e.S.Log(store.Activity{Kind: "later", RoleID: id, CompanyID: r.CompanyID, Text: "Saved for later, until " + time.Unix(until, 0).In(e.Now().Location()).Format("Monday 2 January")})
	}
	return nil
}

// A posting no search has seen for this long is taken to be gone.
const unseenAfter = 30 * 24 * time.Hour

// TakenDown counts the roles ClearTakenDown would close.
func (e *Engine) TakenDown() int {
	return e.S.GoneUntouched(e.Now().Add(-unseenAfter).Unix())
}

// ClearTakenDown closes, and never deletes, the roles whose posting is gone
// and that the person never prepared or applied to. Roles they applied to or
// prepared keep their text for good.
func (e *Engine) ClearTakenDown() (int, error) {
	n, err := e.S.CloseGone(e.Now().Add(-unseenAfter).Unix())
	if err == nil && n > 0 {
		e.S.Log(store.Activity{Kind: "tidied", Text: fmt.Sprintf("Closed %s whose posting was taken down", countWord(n, "role"))})
	}
	return n, err
}
