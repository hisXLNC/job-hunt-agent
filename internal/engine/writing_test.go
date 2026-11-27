package engine

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ledongthuc/pdf"

	"jobhunt/internal/store"
)

// prepared sets a person up, finds one good role and prepares it. The clock
// it returns moves both the engine and the store.
func prepared(t *testing.T) (*Engine, int64, *time.Time) {
	t.Helper()
	e, w := newEngine(t)
	setUp(t, e)
	now := time.Now()
	e.Now = func() time.Time { return now }
	e.S.Now = func() time.Time { return now }
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"ready"}, Limit: 10})
	if len(roles) != 1 {
		t.Fatalf("want one prepared role, got %d", len(roles))
	}
	return e, roles[0].ID, &now
}

func pdfText(t *testing.T, data []byte) (string, int) {
	t.Helper()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a PDF: %v", err)
	}
	var b strings.Builder
	for i := 1; i <= r.NumPage(); i++ {
		s, err := r.Page(i).GetPlainText(nil)
		if err != nil {
			t.Fatalf("page %d: %v", i, err)
		}
		b.WriteString(s + "\n")
	}
	return strings.Join(strings.Fields(b.String()), " "), r.NumPage()
}

func TestRoleFilesAsPDF(t *testing.T) {
	e, id, _ := prepared(t)
	p := e.S.Profile()
	p.Signature = "Kind regards,\nSam Rivera, CPA"
	e.S.SaveProfile(p)

	cvf, err := e.CVPDF(id)
	if err != nil {
		t.Fatal(err)
	}
	if cvf.Name != "Sam Rivera - Acme Corp - CV.pdf" {
		t.Errorf("CV file name %q", cvf.Name)
	}
	if text, _ := pdfText(t, cvf.Data); !strings.Contains(text, "Sam Rivera") || !strings.Contains(text, "Northwind Group") {
		t.Errorf("the CV's PDF is missing its text: %.200s", text)
	}
	lf, err := e.LetterPDF(id)
	if err != nil {
		t.Fatal(err)
	}
	ltext, _ := pdfText(t, lf.Data)
	if lf.Name != "Sam Rivera - Acme Corp - Letter.pdf" || !strings.Contains(ltext, "Dear Hiring Team,") || !strings.Contains(ltext, "Sam Rivera, CPA") || strings.Contains(ltext, "Sincerely") {
		t.Errorf("letter %q: %.300s", lf.Name, ltext)
	}
	both, err := e.PackPDF(id)
	if err != nil {
		t.Fatal(err)
	}
	btext, pages := pdfText(t, both.Data)
	if both.Name != "Sam Rivera - Acme Corp - Letter and CV.pdf" || pages < 2 {
		t.Errorf("pack %q has %d pages", both.Name, pages)
	}
	if l, c := strings.Index(btext, "Dear Hiring Team,"), strings.Index(btext, "Northwind Group"); l < 0 || c < 0 || l > c {
		t.Errorf("the letter should come first, then the CV (letter at %d, CV at %d)", l, c)
	}
	// The Word files carry the same kind of name.
	if f, _ := e.CVFile(id); f.Name != "Sam Rivera - Acme Corp - CV.docx" {
		t.Errorf("Word CV name %q", f.Name)
	}
	if f, _ := e.LetterFile(id); f.Name != "Sam Rivera - Acme Corp - Letter.docx" {
		t.Errorf("Word letter name %q", f.Name)
	}
	if e.PDFGap(id) {
		t.Error("a CV in plain Latin letters should need no warning")
	}
}

func TestFileNamesAreSafeOnWindows(t *testing.T) {
	for _, c := range []struct{ got, want string }{
		{fileNameExt("pdf", "José Álvarez-Müller", `A/B: "Consulting" <Ltd>?*|`, "CV"), "José Álvarez-Müller - A B Consulting Ltd - CV.pdf"},
		{fileNameExt("docx", "Sam Rivera", "", "Letter"), "Sam Rivera - Letter.docx"},
		{fileNameExt("pdf", "...", `\\`), "Job Hunt.pdf"},
		{fileNameExt("pdf", "Sam Rivera", "Acme Corp.", "CV"), "Sam Rivera - Acme Corp - CV.pdf"},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
	long := fileNameExt("pdf", strings.Repeat("é", 200), "CV")
	if n := len([]rune(long)); n > 94 || !strings.HasSuffix(long, ".pdf") {
		t.Errorf("a long name was not cut cleanly: %d runes", n)
	}
}

func TestLetterStylesAndAskingForChanges(t *testing.T) {
	e, id, _ := prepared(t)
	ctx := context.Background()
	var first LetterDoc
	e.S.Doc(id, "letter", &first)
	if first.Style != "standard" || first.Text == "" || first.Prev != nil {
		t.Fatalf("first letter: %+v", first)
	}

	// Another style writes it again and keeps the one before.
	if err := e.RewriteLetter(ctx, id, "formal", ""); err != nil {
		t.Fatal(err)
	}
	var formal LetterDoc
	e.S.Doc(id, "letter", &formal)
	if formal.Style != "formal" || formal.Text == first.Text || formal.Prev == nil || formal.Prev.Text != first.Text || formal.Prev.Style != "standard" {
		t.Fatalf("formal letter: %+v", formal)
	}
	if f, _ := e.LetterPDF(id); f.Data != nil {
		if text, _ := pdfText(t, f.Data); !strings.Contains(text, "Dear Hiring Committee,") {
			t.Errorf("a formal letter greets formally: %.200s", text)
		}
	}
	// The person's own edit keeps the style and the way back.
	if err := e.SaveLetter(id, "My own words."); err != nil {
		t.Fatal(err)
	}
	var mine LetterDoc
	e.S.Doc(id, "letter", &mine)
	if mine.Text != "My own words." || mine.Style != "formal" || mine.Prev == nil {
		t.Fatalf("an edit lost the style or the way back: %+v", mine)
	}
	if err := e.UndoLetter(id); err != nil {
		t.Fatal(err)
	}
	var back LetterDoc
	e.S.Doc(id, "letter", &back)
	if back.Text != first.Text || back.Style != "standard" || back.Prev != nil {
		t.Fatalf("put back: %+v", back)
	}
	if err := e.UndoLetter(id); err != store.ErrNotFound {
		t.Errorf("nothing further to put back, got %v", err)
	}
	// Asking for a change.
	if err := e.RewriteLetter(ctx, id, "", "Make it shorter"); err != nil {
		t.Fatal(err)
	}
	var asked LetterDoc
	e.S.Doc(id, "letter", &asked)
	if len(asked.Text) >= len(first.Text) || asked.Prev == nil || asked.Prev.Ask != "Make it shorter" || asked.Style != "standard" {
		t.Fatalf("asked: %+v", asked)
	}
	if err := e.RewriteLetter(ctx, id, "loud", ""); err == nil {
		t.Error("an unknown style was accepted")
	}
	// Preparing again keeps the style chosen for the role.
	e.RewriteLetter(ctx, id, "short", "")
	if err := e.Prepare(ctx, id); err != nil {
		t.Fatal(err)
	}
	var again LetterDoc
	e.S.Doc(id, "letter", &again)
	if again.Style != "short" {
		t.Errorf("preparing again dropped the role's style: %q", again.Style)
	}

	// The CV: ask, see something different, put it back.
	_, _, was, _ := e.RoleCV(id)
	if err := e.RetailorCV(ctx, id, "Lead with the title"); err != nil {
		t.Fatal(err)
	}
	_, _, now, _ := e.RoleCV(id)
	if now.Prev == nil || now.Prev.Ask != "Lead with the title" || len(now.Changes) == 0 || len(now.Changes) == len(was.Changes) {
		t.Fatalf("the CV was not tailored again: %d changes, was %d", len(now.Changes), len(was.Changes))
	}
	if err := e.UndoCV(id); err != nil {
		t.Fatal(err)
	}
	if _, _, back, _ := e.RoleCV(id); back.Prev != nil || len(back.Changes) != len(was.Changes) {
		t.Fatalf("the CV was not put back: %d changes", len(back.Changes))
	}
	if err := e.RetailorCV(ctx, id, "  "); err == nil {
		t.Error("an empty request was accepted")
	}
	// A new role takes the style set under You.
	p := e.S.Profile()
	p.LetterStyle = "warm"
	e.S.SaveProfile(p)
	e.S.DropDoc(id, "letter")
	if err := e.Prepare(ctx, id); err != nil {
		t.Fatal(err)
	}
	var warm LetterDoc
	e.S.Doc(id, "letter", &warm)
	if warm.Style != "warm" {
		t.Errorf("the default style was not used: %q", warm.Style)
	}
}

func chaseCards(e *Engine) []Card {
	var out []Card
	for _, c := range e.Today().Cards {
		if c.Kind == "chase" {
			out = append(out, c)
		}
	}
	return out
}

func TestFollowingUpOnAnApplication(t *testing.T) {
	e, id, now := prepared(t)
	ctx := context.Background()
	if err := e.WriteChase(ctx, id); err == nil {
		t.Fatal("a follow-up was written for a role not applied to")
	}
	if err := e.MarkApplied(id, ""); err != nil {
		t.Fatal(err)
	}
	*now = now.AddDate(0, 0, 7)
	if c := chaseCards(e); len(c) != 0 {
		t.Fatalf("too early for a follow-up: %+v", c)
	}
	*now = now.AddDate(0, 0, 2)
	cards := chaseCards(e)
	if len(cards) != 1 || cards[0].RoleID != id || cards[0].Sub != "Applied 9 days ago, no reply" {
		t.Fatalf("want one follow-up card after nine days: %+v", cards)
	}
	// 0 under You means never.
	p := e.S.Profile()
	zero := 0
	p.ChaseDays = &zero
	e.S.SaveProfile(p)
	if c := chaseCards(e); len(c) != 0 {
		t.Fatal("follow-ups are switched off but one was suggested")
	}
	p.ChaseDays = nil
	e.S.SaveProfile(p)

	// A receipt is not a reply; an invitation is.
	e.S.AddMail(store.Mail{MsgID: "a", RoleID: id, Kind: "receipt", Subject: "We got your application"})
	if c := chaseCards(e); len(c) != 1 {
		t.Fatal("an automatic receipt should not count as a reply")
	}

	if err := e.WriteChase(ctx, id); err != nil {
		t.Fatal(err)
	}
	var doc ChaseDoc
	e.S.Doc(id, "chase", &doc)
	if !strings.Contains(doc.Body, "Tax Technology Manager") || !strings.Contains(doc.Body, "Sam Rivera") || doc.Subject == "" || doc.Days != 9 {
		t.Fatalf("follow-up: %+v", doc)
	}
	if c := chaseCards(e); len(c) != 1 || c[0].Body != "written" {
		t.Fatalf("a written follow-up still waits to be sent: %+v", c)
	}
	if err := e.SaveChase(id, "Still keen", "Hello,\n\nMy own words."); err != nil {
		t.Fatal(err)
	}
	if err := e.ChaseSent(id); err != nil {
		t.Fatal(err)
	}
	if c := chaseCards(e); len(c) != 0 {
		t.Fatal("the card stayed after the follow-up was sent")
	}
	acts, _ := e.S.ActivityList(store.ActivityFilter{RoleID: id, Limit: 20})
	found := false
	for _, a := range acts {
		found = found || a.Kind == "chased"
	}
	if !found {
		t.Error("sending the follow-up is not in the role's history")
	}
	// One follow-up per application: no second card, however long it stays quiet.
	*now = now.AddDate(0, 0, 20)
	if c := chaseCards(e); len(c) != 0 {
		t.Fatal("a second follow-up was suggested")
	}
	if err := e.WriteChase(ctx, id); err == nil {
		t.Fatal("a second follow-up was written")
	}
}

func TestAReplyOrLettingGoStopsTheFollowUp(t *testing.T) {
	e, id, now := prepared(t)
	e.MarkApplied(id, "")
	*now = now.AddDate(0, 0, 10)
	if c := chaseCards(e); len(c) != 1 {
		t.Fatalf("want a follow-up card: %+v", c)
	}
	if err := e.ChaseDropped(id); err != nil {
		t.Fatal(err)
	}
	if c := chaseCards(e); len(c) != 0 {
		t.Fatal("the card stayed after it was let go")
	}
	e.S.DropDoc(id, "chase")
	e.S.AddMail(store.Mail{MsgID: "b", RoleID: id, Kind: "interview", Subject: "Interview"})
	if c := chaseCards(e); len(c) != 0 {
		t.Fatal("a follow-up was suggested although they answered")
	}
}

func TestTakingBackApplied(t *testing.T) {
	e, id, _ := prepared(t)
	if err := e.Unapply(id); err == nil {
		t.Fatal("a role that was never applied to was taken back")
	}
	e.MarkApplied(id, "")
	if r, _ := e.S.Role(id); r.Stage != "applied" || r.AppliedAt == 0 {
		t.Fatalf("not applied: %+v", r)
	}
	if err := e.Unapply(id); err != nil {
		t.Fatal(err)
	}
	r, _ := e.S.Role(id)
	if r.Stage != "ready" || r.AppliedAt != 0 || r.Closed != "" {
		t.Fatalf("after taking it back: stage=%s applied_at=%d", r.Stage, r.AppliedAt)
	}
	if n := e.Today().Numbers[1]; n.Done != 0 {
		t.Errorf("it still counts as applied this week: %+v", n)
	}
	// It can be applied to again.
	if err := e.MarkApplied(id, ""); err != nil {
		t.Fatal(err)
	}
	if r, _ := e.S.Role(id); r.Stage != "applied" || r.AppliedAt == 0 {
		t.Fatalf("applying again: %+v", r)
	}
	// Once they answered, it is no longer a mistake to take back.
	e.S.Advance(id, "interview")
	if err := e.Unapply(id); err == nil {
		t.Fatal("an application with an interview was taken back")
	}
}

func TestSaveForLater(t *testing.T) {
	e, id, now := prepared(t)
	onToday := func() bool {
		for _, c := range e.Today().Cards {
			if c.RoleID == id && c.Kind == "apply" {
				return true
			}
		}
		return false
	}
	if !onToday() {
		t.Fatal("the prepared role should be on Today")
	}
	if err := e.Later(id, 3); err != nil {
		t.Fatal(err)
	}
	if onToday() {
		t.Fatal("a role saved for later is still on Today")
	}
	if rs, n, _ := e.S.Roles(store.RoleFilter{Later: now.Unix(), Limit: 10}); n != 1 || rs[0].ID != id {
		t.Fatalf("the saved-for-later list: %d", n)
	}
	*now = now.AddDate(0, 0, 2)
	if onToday() {
		t.Fatal("it came back too early")
	}
	*now = now.AddDate(0, 0, 1)
	if !onToday() {
		t.Fatal("it did not come back on its day")
	}
	// Bringing it back by hand.
	e.Later(id, 7)
	e.Later(id, 0)
	if !onToday() {
		t.Fatal("bringing it back did nothing")
	}
	// A role the person said no to is never brought back by this, or kept on a timer.
	e.Later(id, 1)
	if err := e.NotInterested(id, "not for me"); err != nil {
		t.Fatal(err)
	}
	if r, _ := e.S.Role(id); r.LaterUntil != 0 || r.Closed != "no" {
		t.Fatalf("closing should clear the timer: %+v", r.LaterUntil)
	}
	if err := e.Later(id, 1); err == nil {
		t.Fatal("a closed role was saved for later")
	}
	*now = now.AddDate(0, 0, 5)
	if r, _ := e.S.Role(id); r.Closed != "no" || onToday() {
		t.Fatal("a no came back")
	}
}

func TestWeeklyGoal(t *testing.T) {
	e, id, _ := prepared(t)
	n := e.Today().Numbers[1]
	if n.Value != "0 of 10" || n.Of != 10 || n.Done != 0 {
		t.Fatalf("the goal starts at 10 a week: %+v", n)
	}
	e.MarkApplied(id, "")
	if n = e.Today().Numbers[1]; n.Value != "1 of 10" || n.Done != 1 {
		t.Fatalf("after one application: %+v", n)
	}
	pr := e.Progress()
	if pr.Goal != 10 || len(pr.Weeks) != 8 || pr.Weeks[7].Applied != 1 {
		t.Fatalf("progress: goal %d, weeks %+v", pr.Goal, pr.Weeks)
	}
	p := e.S.Profile()
	zero := 0
	p.WeeklyGoal = &zero
	e.S.SaveProfile(p)
	if n = e.Today().Numbers[1]; n.Value != "1" || n.Of != 0 {
		t.Fatalf("with no goal: %+v", n)
	}
	if e.Progress().Goal != 0 {
		t.Error("progress still shows a goal")
	}
}

func TestClearingTakenDownRoles(t *testing.T) {
	e, kept, now := prepared(t)
	add := func(title, source string) int64 {
		co, _, _ := e.S.UpsertCompany(store.Company{Name: "Acme Corp"})
		id, err := e.S.AddRole(store.Role{CompanyID: co.ID, Key: source + ":" + title, Source: source, Title: title, Applicants: -1})
		if err != nil {
			t.Fatal(err)
		}
		e.S.Advance(id, "found")
		return id
	}
	stale := add("Not seen for weeks", "linkedin")
	mine := add("Added by hand", "manual")
	*now = now.AddDate(0, 0, 40)
	fresh := add("Seen today", "linkedin")
	// Taken down, then opened again by the person: open, and its posting gone.
	gone := add("Taken down", "greenhouse")
	e.S.MarkGone(gone)
	e.S.Reopen(gone)
	// The prepared role's posting is gone too, but it has documents.
	e.S.MarkGone(kept)

	if n := e.TakenDown(); n != 2 {
		t.Fatalf("want 2 roles to clear, got %d", n)
	}
	n, err := e.ClearTakenDown()
	if err != nil || n != 2 {
		t.Fatalf("cleared %d, %v", n, err)
	}
	for id, want := range map[int64]string{gone: "expired", stale: "expired", mine: "", fresh: "", kept: ""} {
		r, err := e.S.Role(id)
		if err != nil {
			t.Fatalf("role %d was deleted: %v", id, err)
		}
		if r.Closed != want {
			t.Errorf("%s: closed = %q, want %q", r.Title, r.Closed, want)
		}
	}
	if r, _ := e.S.Role(kept); r.Description == "" {
		t.Error("a prepared role lost its text")
	}
	if n, _ := e.ClearTakenDown(); n != 0 {
		t.Errorf("a second tidy closed %d more", n)
	}
}
