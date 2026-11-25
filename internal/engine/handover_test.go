package engine

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/store"
)

// waitJob waits for a background job to finish.
func waitJob(t *testing.T, e *Engine, name string) {
	t.Helper()
	for i := 0; i < 600; i++ {
		if !e.Busy(name) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s didn't finish", name)
}

// Two computers sharing one cloud-drive folder for their copies.
func twoComputers(t *testing.T) (office, laptop *Engine, shared string) {
	t.Helper()
	shared = t.TempDir()
	office = fileEngine(t, t.TempDir())
	office.HostName = "Office PC"
	laptop = fileEngine(t, t.TempDir())
	laptop.HostName = "Laptop"
	for _, e := range []*Engine{office, laptop} {
		if err := e.SetBackup(BackupSet{Dir: shared, Keep: 7}); err != nil {
			t.Fatal(err)
		}
	}
	return office, laptop, shared
}

func TestCarryOnWhereYouLeftOffOnAnotherComputer(t *testing.T) {
	office, laptop, shared := twoComputers(t)
	at := time.Date(2026, 11, 24, 17, 0, 0, 0, time.Local)
	office.Now = func() time.Time { return at }
	p := office.S.Profile()
	p.Name = "Sam Rivera"
	office.S.SaveProfile(p)
	if _, err := office.AddRole("Acme", "Tax Manager", "Toronto", "https://acme.example/jobs/1", "", "manual"); err != nil {
		t.Fatal(err)
	}
	waitJob(t, office, "read:1")

	// Nothing to carry on from yet, and a computer never offers its own copy.
	if h := laptop.OtherComputer(); h != nil {
		t.Fatalf("offered %+v before anything was handed over", h)
	}
	done, err := office.HandOver()
	if err != nil {
		t.Fatal(err)
	}
	if done.Computer != "Office PC" || done.Dir != shared {
		t.Fatalf("hand-over said %+v", done)
	}
	for _, f := range []string{"jobhunt-on-office-pc.db", "jobhunt-on-office-pc.json", "Job Hunt applications.csv"} {
		if _, err := os.Stat(filepath.Join(shared, f)); err != nil {
			t.Errorf("%s is not in the shared folder: %v", f, err)
		}
	}
	if h := office.OtherComputer(); h != nil {
		t.Fatalf("the office offered its own copy: %+v", h)
	}

	// The laptop starts and offers to carry on.
	h := laptop.OtherComputer()
	if h == nil || h.Computer != "Office PC" || !h.Handed || h.At != at.Unix() || h.Copy != "jobhunt-on-office-pc.db" {
		t.Fatalf("the laptop should offer the office's copy: %+v", h)
	}
	if h.Both {
		t.Error("the laptop was not used, so both did not run")
	}
	// It is listed among the copies, by the computer that made it.
	listed := false
	for _, c := range laptop.Copies() {
		if c.Name == h.Copy && c.What == "The latest from Office PC" {
			listed = true
		}
	}
	if !listed {
		t.Errorf("the other computer's copy isn't listed: %+v", laptop.Copies())
	}
	if _, err := laptop.ContinueFrom("jobhunt-before-restore-x.db"); err == nil {
		t.Error("carried on from a copy that isn't the one offered")
	}
	if _, err := laptop.ContinueFrom(h.Copy); err != nil {
		t.Fatal(err)
	}
	if laptop.StagedRestore() == nil || laptop.OtherComputer() != nil {
		t.Fatal("the copy should be waiting to be put back, and not offered again")
	}

	// At the next start it is put back the safe way: what was there is saved first.
	// The program does this before it opens its data, so the laptop's file is closed here
	// (Windows won't move a file that is open).
	laptop.Stop()
	time.Sleep(50 * time.Millisecond)
	laptop.S.Close()
	out :=ApplyStagedRestore(laptop.Dir, filepath.Join(laptop.Dir, "jobhunt.db"), time.Now())
	if out == nil || out.Error != "" || out.Saved == "" {
		t.Fatalf("restore: %+v", out)
	}
	s, err := store.Open(filepath.Join(laptop.Dir, "jobhunt.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Profile().Name != "Sam Rivera" || s.Count(`SELECT COUNT(*) FROM roles`) != 1 {
		t.Fatalf("the laptop doesn't have the office's data: %q, %d roles", s.Profile().Name, s.Count(`SELECT COUNT(*) FROM roles`))
	}
	again := New(s, laptop.Dir)
	again.HostName = "Laptop"
	defer again.Stop()
	if h := again.OtherComputer(); h != nil {
		t.Fatalf("after carrying on, the same copy was offered again: %+v", h)
	}
}

func TestBothComputersUsedIsSaidPlainly(t *testing.T) {
	office, laptop, _ := twoComputers(t)
	at := time.Date(2026, 11, 24, 17, 0, 0, 0, time.Local)
	office.Now = func() time.Time { return at }
	if _, err := office.HandOver(); err != nil {
		t.Fatal(err)
	}
	// The laptop was used after it was last in step (never, here).
	laptop.startWork = at.Add(-time.Hour).Unix()
	h := laptop.OtherComputer()
	if h == nil || !h.Both {
		t.Fatalf("both were used, so it must say so: %+v", h)
	}
	// "Keep working here" stops the offer of that copy, not of a newer one.
	laptop.StayHere()
	if h := laptop.OtherComputer(); h != nil {
		t.Fatalf("offered again after keeping this one: %+v", h)
	}
	at = at.Add(2 * time.Hour)
	if _, err := office.HandOver(); err != nil {
		t.Fatal(err)
	}
	if h := laptop.OtherComputer(); h == nil || h.At != at.Unix() {
		t.Fatalf("a newer copy should be offered: %+v", h)
	}
	// A hand-over from the laptop puts it in step.
	laptop.Now = func() time.Time { return at.Add(time.Hour) }
	if _, err := laptop.HandOver(); err != nil {
		t.Fatal(err)
	}
	if h := laptop.OtherComputer(); h != nil {
		t.Fatalf("after handing over, an older copy was offered: %+v", h)
	}
}

func TestACopyStillArrivingIsNotOffered(t *testing.T) {
	office, laptop, shared := twoComputers(t)
	if _, err := office.HandOver(); err != nil {
		t.Fatal(err)
	}
	// The drive has brought the note but only part of the copy.
	db := filepath.Join(shared, "jobhunt-on-office-pc.db")
	b, _ := os.ReadFile(db)
	os.WriteFile(db, b[:len(b)/2], 0o600)
	if h := laptop.OtherComputer(); h != nil {
		t.Fatalf("offered a copy that hasn't fully arrived: %+v", h)
	}
	// Without a chosen folder there is nothing to hand over.
	solo := fileEngine(t, t.TempDir())
	if _, err := solo.HandOver(); err == nil || !strings.Contains(err.Error(), "cloud drive") {
		t.Fatalf("handing over with no shared folder: %v", err)
	}
}

func TestTheApplicationsSheetIsKeptInTheCopiesFolder(t *testing.T) {
	office, _, shared := twoComputers(t)
	if _, err := office.AddRole("Acme", "=cmd|' /C calc'!A0", "Toronto", "https://acme.example/jobs/2", "", "manual"); err != nil {
		t.Fatal(err)
	}
	waitJob(t, office, "read:1")
	if err := office.KeepApplicationsSheet(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(shared, "Job Hunt applications.csv"))
	if err != nil {
		t.Fatal(err)
	}
	var want bytes.Buffer
	office.WriteRolesCSV(&want)
	if !bytes.Equal(got, want.Bytes()) || !strings.Contains(string(got), "Title,Employer") {
		t.Fatalf("the sheet isn't the download's content:\n%s", got)
	}
	if strings.Contains(string(got), "\n=cmd") || !strings.Contains(string(got), "'=cmd") {
		t.Error("a title that looks like a formula must not run in a spreadsheet")
	}
	// Only written when something changed: a file left alone stays as it is.
	os.WriteFile(filepath.Join(shared, "Job Hunt applications.csv"), got, 0o600)
	old := time.Now().Add(-time.Hour)
	os.Chtimes(filepath.Join(shared, "Job Hunt applications.csv"), old, old)
	office.KeepApplicationsSheet()
	if info, _ := os.Stat(filepath.Join(shared, "Job Hunt applications.csv")); info.ModTime().After(old.Add(time.Minute)) {
		t.Error("the sheet was written again with nothing changed")
	}
}

func TestUpdateRemindersOnceADay(t *testing.T) {
	e, _ := newEngine(t)
	e.Version = "26.11.40"
	now := time.Date(2026, 11, 25, 10, 0, 0, 0, time.Local)
	e.Now = func() time.Time { return now }
	e.SetAutoUpdate(false)
	e.remindUpdate(now)
	if list, _ := e.Notices(); len(list) != 0 {
		t.Fatalf("reminded with nothing newer: %+v", list)
	}
	e.S.Set(updateKey, Update{Version: "26.11.49", URL: "https://example.invalid/x"})
	e.remindUpdate(now)
	e.remindUpdate(now.Add(time.Hour))
	list, _ := e.Notices()
	if len(list) != 1 || !strings.Contains(list[0].Title, "26.11.49") || list[0].Page != "#/settings/app" {
		t.Fatalf("one reminder a day: %+v", list)
	}
	e.ReadNotices(0)
	e.remindUpdate(now.Add(24 * time.Hour))
	if list, _ := e.Notices(); len(list) != 2 {
		t.Fatalf("the next day it reminds again: %+v", list)
	}

	// When versions install by themselves, a day is given for that first.
	f, _ := newEngine(t)
	f.Version = "26.11.40"
	f.Now = e.Now
	f.RunInstaller = func(string) error { return nil }
	f.S.Set(updateKey, Update{Version: "26.11.49"})
	f.remindUpdate(now)
	if list, _ := f.Notices(); len(list) != 0 {
		t.Fatalf("reminded before it had a chance to install itself: %+v", list)
	}
	f.remindUpdate(now.Add(25 * time.Hour))
	if list, _ := f.Notices(); len(list) != 1 {
		t.Fatalf("a day on, not installed, it reminds: %+v", list)
	}
}

func TestAChangedCVRedoesWaitingWorkAndKeepsYourEdits(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"ready"}, Limit: 5})
	if len(roles) != 1 {
		t.Fatalf("want one ready role, got %d", len(roles))
	}
	id := roles[0].ID
	_, _, doc, err := e.RoleCV(id)
	if err != nil || len(doc.Changes) < 2 {
		t.Fatalf("tailoring: %v %+v", err, doc)
	}
	first := doc.CVID
	mine := "Led a Vertex rollout across 14 countries, my own words"
	if err := e.SetChange(id, 0, false, &mine); err != nil {
		t.Fatal(err)
	}
	if err := e.SetChange(id, 1, true, nil); err != nil {
		t.Fatal(err)
	}
	if err := e.SaveLetter(id, "Dear Acme, my own letter."); err != nil {
		t.Fatal(err)
	}
	if n := len(e.waitingOn(first)); n != 1 {
		t.Fatalf("the role waits on the CV: %d", n)
	}

	// Replacing the file reads it again and redoes the role, keeping the edits.
	n, err := e.ReplaceCV(ctx, first, "Sam Rivera CV v2.txt", []byte(testCV+"\nCertified Public Accountant\n"))
	if err != nil || n != 1 {
		t.Fatalf("replace: %d %v", n, err)
	}
	waitJob(t, e, "cvredo")
	c, _ := e.S.CV(first)
	if c.Filename != "Sam Rivera CV v2.txt" || !strings.Contains(c.Text, "Certified Public Accountant") {
		t.Fatalf("the new file isn't in place: %q", c.Filename)
	}
	_, _, doc2, err := e.RoleCV(id)
	if err != nil {
		t.Fatal(err)
	}
	var kept, off bool
	for _, ch := range doc2.Changes {
		if ch.Mine && ch.After == mine {
			kept = true
		}
		if ch.Before == doc.Changes[1].Before && ch.Off {
			off = true
		}
	}
	if !kept || !off {
		t.Errorf("your own wording and the change you switched off must be kept: %+v", doc2.Changes)
	}
	var letter LetterDoc
	if e.S.Doc(id, "letter", &letter); letter.Text != "Dear Acme, my own letter." {
		t.Errorf("your own letter must be kept: %q", letter.Text)
	}
	if acts, _ := e.S.ActivityList(store.ActivityFilter{RoleID: id, Limit: 5}); len(acts) == 0 || !strings.Contains(acts[0].Text, "because your CV changed") {
		t.Errorf("the role's history should say why: %+v", acts)
	}

	// Removing the CV moves the waiting role to the one left.
	second, _, err := e.AddCV(ctx, "Second CV.txt", []byte(testCV))
	if err != nil {
		t.Fatal(err)
	}
	if n, err := e.RemoveCV(first); err != nil || n != 1 {
		t.Fatalf("remove: %d %v", n, err)
	}
	waitJob(t, e, "cvredo")
	if _, _, doc3, err := e.RoleCV(id); err != nil || doc3.CVID != second.ID {
		t.Fatalf("after removing the CV the role should use the one left: %v %+v", err, doc3.CVID)
	}
	if _, err := e.RemoveCV(second.ID); err == nil {
		t.Error("removed the last CV")
	}
	// A role you applied to is never redone.
	e.MarkApplied(id, "")
	if n := len(e.waitingOn(second.ID)); n != 0 {
		t.Errorf("an applied role was counted as waiting: %d", n)
	}
}

func TestPerCVSettings(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	cvs, _ := e.S.CVs()
	id := cvs[0].ID
	if err := e.SetCVSet(id, CVSet{Titles: []string{" Indirect Tax Lead ", "indirect tax lead", ""}, Keywords: []string{"Vertex", "SAP"}, LetterStyle: "formal"}); err != nil {
		t.Fatal(err)
	}
	set := e.CVSet(id)
	if len(set.Titles) != 1 || set.Titles[0] != "Indirect Tax Lead" || set.LetterStyle != "formal" {
		t.Fatalf("settings: %+v", set)
	}
	found := false
	for _, t := range e.S.Profile().Titles.All() {
		found = found || t.Title == "Indirect Tax Lead"
	}
	if !found {
		t.Error("a CV's title should be searched for")
	}
	if err := e.SetCVSet(id, CVSet{LetterStyle: "shouty"}); err == nil {
		t.Error("an unknown letter style was saved")
	}
	// Claude sees what each CV is for.
	if b := e.Person().Block(); !strings.Contains(b, "Indirect Tax Lead") || !strings.Contains(b, "Vertex, SAP") {
		t.Error("the CV's titles and words should reach Claude")
	}
	more, err := e.MoreTitles(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range more {
		for _, have := range e.S.Profile().Titles.All() {
			if strings.EqualFold(m, have.Title) {
				t.Errorf("suggested a title already searched: %q", m)
			}
		}
	}
	look, err := e.LookAtCV(id)
	if err != nil || !look.Readable || len(look.ATS) == 0 || look.Model.Name == "" || look.CV.Text != "" {
		t.Fatalf("the CV's look: %v %+v", err, look)
	}
}

func TestWriteAllFollowUps(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	now := time.Now()
	e.Now = func() time.Time { return now }
	e.S.Now = func() time.Time { return now }
	if _, err := e.WriteAllChases(); err == nil {
		t.Error("with nothing due it should say so")
	}
	var ids []int64
	for _, title := range []string{"Tax Manager", "Tax Lead", "VAT Manager"} {
		id, err := e.AddRole("Acme", title, "Toronto", "https://acme.example/jobs/"+strings.ReplaceAll(title, " ", "-"), "", "manual")
		if err != nil {
			t.Fatal(err)
		}
		waitJob(t, e, fmt.Sprintf("read:%d", id))
		if err := e.MarkApplied(id, ""); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	now = now.AddDate(0, 0, 12)
	due := e.ChasesToWrite()
	if len(due) != 3 {
		t.Fatalf("three are due: %v", due)
	}
	e.ChaseDropped(ids[0])
	n, err := e.WriteAllChases()
	if err != nil || n != 2 {
		t.Fatalf("write all: %d %v", n, err)
	}
	waitJob(t, e, "chases")
	written := 0
	for _, id := range ids {
		var ch ChaseDoc
		if ok, _ := e.S.Doc(id, "chase", &ch); ok && ch.Body != "" && ch.SentAt == 0 {
			written++
		}
	}
	if written != 2 || len(e.ChasesToWrite()) != 0 {
		t.Fatalf("written %d, still due %v", written, e.ChasesToWrite())
	}
}

func TestAddingAPostingFromALinkNeverReopensANo(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	if _, err := e.AddFromLink(ctx, "Look at this one"); err == nil {
		t.Error("added a role with no link")
	}
	if _, err := e.AddFromLink(ctx, "http://192.168.1.1/jobs/1"); err == nil {
		t.Error("added a role from a private address")
	}
	no, _ := e.AddRole("Acme", "Tax Manager", "Toronto", "https://acme.example/jobs/7", "", "manual")
	waitJob(t, e, fmt.Sprintf("read:%d", no))
	e.NotInterested(no, "too junior")
	// Shared from a phone: words, then the link.
	id, err := e.AddFromLink(ctx, "Tax Manager at Acme https://acme.example/jobs/7.")
	if !errors.Is(err, ErrSaidNo) || id != no {
		t.Fatalf("a link to a role you said no to: %d %v", id, err)
	}
	if r, _ := e.S.Role(no); r.Closed != "no" {
		t.Fatalf("the role was reopened: %q", r.Closed)
	}
	open, _ := e.AddRole("Acme", "Tax Lead", "Toronto", "https://acme.example/jobs/8", "", "manual")
	waitJob(t, e, fmt.Sprintf("read:%d", open))
	if id, err := e.AddFromLink(ctx, "https://acme.example/jobs/8"); err != nil || id != open {
		t.Fatalf("a link to a role already here opens it: %d %v", id, err)
	}
	// A page that can't be read says what to do instead.
	if _, err := e.AddFromLink(ctx, "https://acme.example/nothing-here"); err == nil || !strings.Contains(err.Error(), "side panel") {
		t.Fatalf("an unreadable page: %v", err)
	}
}
