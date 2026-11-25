package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/store"
)

// An engine over a real file, as the program has it.
func fileEngine(t *testing.T, dir string) *Engine {
	t.Helper()
	s, err := store.Open(filepath.Join(dir, "jobhunt.db"))
	if err != nil {
		t.Fatal(err)
	}
	e := New(s, dir)
	t.Cleanup(func() { e.Stop(); s.Close() })
	return e
}

func TestNoticesAreKeptUnderTheBell(t *testing.T) {
	e, _ := newEngine(t)
	// No way to show a notification here; it is kept all the same.
	e.Tell("Tax Manager at Acme", "Fit 88 · posted 20 min ago.", "#/roles/3")
	e.Tell("Tax Manager at Acme", "Fit 88 · posted 20 min ago.", "#/roles/3") // said twice, kept once
	e.Tell("Acme wrote to you", "They want to talk.", "#/replies")
	e.problem("Reading new roles", fmt.Errorf("the page didn't answer"))
	list, unread := e.Notices()
	if len(list) != 3 || unread != 3 {
		t.Fatalf("kept %d, unread %d: %+v", len(list), unread, list)
	}
	if list[0].Kind != "problem" || list[0].Page != "#/settings/app" || list[1].Kind != "mail" || list[2].Kind != "role" {
		t.Fatalf("newest first, each with its kind and page: %+v", list)
	}
	e.ReadNotices(list[2].ID)
	if _, unread = e.Notices(); unread != 2 {
		t.Fatalf("after reading one: %d unread", unread)
	}
	// Once read, the same thing happening again is news again.
	e.Tell("Tax Manager at Acme", "Fit 88 · posted 20 min ago.", "#/roles/3")
	if list, _ = e.Notices(); len(list) != 4 {
		t.Fatalf("a read notice blocked a new one: %d", len(list))
	}
	e.ReadNotices(0)
	if _, unread = e.Notices(); unread != 0 {
		t.Fatalf("mark all read left %d", unread)
	}
	for i := 0; i < 70; i++ {
		e.Keep("app", fmt.Sprintf("Notice %d", i), "", "somewhere else")
	}
	list, _ = e.Notices()
	if len(list) != noticesKept || list[0].Title != "Notice 69" {
		t.Fatalf("the newest %d are kept: %d, first %q", noticesKept, len(list), list[0].Title)
	}
	if list[0].Page != "#/today" {
		t.Fatalf("a notice only ever opens a page of Job Hunt: %q", list[0].Page)
	}
}

func TestWhereCopiesAreKept(t *testing.T) {
	dir := t.TempDir()
	e := fileEngine(t, dir)
	if set := e.BackupSet(); set.Dir != "" || set.Keep != 7 || e.BackupDir() != filepath.Join(dir, "backups") {
		t.Fatalf("default: %+v in %s", set, e.BackupDir())
	}
	for _, bad := range []BackupSet{{Dir: "", Keep: 5}, {Dir: "copies", Keep: 7}, {Dir: filepath.Join(dir, "not-there"), Keep: 7}, {Dir: filepath.Join(dir, "jobhunt.db"), Keep: 7}} {
		if err := e.SetBackup(bad); err == nil {
			t.Errorf("%+v was accepted", bad)
		}
	}
	other := t.TempDir()
	if err := e.SetBackup(BackupSet{Dir: ` "` + other + `" `, Keep: 14}); err != nil {
		t.Fatal(err)
	}
	if e.BackupDir() != other || e.BackupSet().Keep != 14 {
		t.Fatalf("not saved: %s %+v", e.BackupDir(), e.BackupSet())
	}
	// Fourteen daily copies stay; the copies made before a restore are counted apart.
	for d := 1; d <= 20; d++ {
		os.WriteFile(filepath.Join(other, fmt.Sprintf("jobhunt-2026-10-%02d.db", d)), []byte("x"), 0o600)
	}
	os.WriteFile(filepath.Join(other, "jobhunt-before-restore-20261001-120000.db"), []byte("x"), 0o600)
	os.WriteFile(filepath.Join(other, "holiday.jpg"), []byte("x"), 0o600)
	p, err := e.Backup()
	if err != nil || filepath.Dir(p) != other {
		t.Fatalf("backup: %s %v", p, err)
	}
	copies := e.Copies()
	daily, latest := 0, 0
	for _, c := range copies {
		switch {
		case dailyCopy.MatchString(c.Name):
			daily++
		case onCopy.MatchString(c.Name) && c.What == "This computer's latest":
			latest++ // in a folder the person chose, for another computer to carry on from
		}
	}
	if daily != 14 || latest != 1 || len(copies) != 16 {
		t.Fatalf("%d daily copies and %d latest of %d listed", daily, latest, len(copies))
	}
	if _, err := os.Stat(filepath.Join(other, "holiday.jpg")); err != nil {
		t.Fatal("a file that isn't a copy was removed")
	}
	// The default folder said in full is the default.
	if err := os.MkdirAll(e.DefaultBackupDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := e.SetBackup(BackupSet{Dir: e.DefaultBackupDir(), Keep: 7}); err != nil || e.BackupSet().Dir != "" {
		t.Fatalf("back to the default: %v %+v", err, e.BackupSet())
	}
}

func TestPuttingASavedCopyBack(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "jobhunt.db")
	e := fileEngine(t, dir)
	e.S.AddFact("I had this when the copy was saved", "you")
	saved, err := e.Backup()
	if err != nil {
		t.Fatal(err)
	}
	e.S.AddFact("I added this afterwards", "you")
	e.SetTheme("dark")

	for _, name := range []string{"", "../jobhunt.db", "jobhunt-2026-01-01.db", "jobhunt.db", `..\jobhunt-2026-01-01.db`} {
		if _, err := e.StageRestore(name); err == nil {
			t.Errorf("%q was staged", name)
		}
	}
	junk := filepath.Join(e.BackupDir(), "jobhunt-2020-01-01.db")
	os.WriteFile(junk, []byte("not a database at all, just words"), 0o600)
	if _, err := e.StageRestore(filepath.Base(junk)); err == nil {
		t.Fatal("a file that is not a database was staged")
	}
	if e.StagedRestore() != nil {
		t.Fatal("something is waiting after only refusals")
	}

	// Nothing waiting: starting changes nothing.
	if out := ApplyStagedRestore(dir, db, time.Now()); out != nil {
		t.Fatalf("applied with nothing staged: %+v", out)
	}
	st, err := e.StageRestore(filepath.Base(saved))
	if err != nil {
		t.Fatal(err)
	}
	if got := e.StagedRestore(); got == nil || got.Name != st.Name {
		t.Fatalf("staged: %+v", got)
	}
	// Staging alone changes nothing in the data in use.
	if facts, _ := e.S.Facts(); len(facts) != 2 {
		t.Fatalf("the running data changed: %d facts", len(facts))
	}
	// Changing one's mind.
	if err := e.CancelRestore(); err != nil || e.StagedRestore() != nil {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := e.StageRestore(filepath.Base(saved)); err != nil {
		t.Fatal(err)
	}

	// The program stops and starts again.
	e.Stop()
	e.S.Close()
	out := ApplyStagedRestore(dir, db, time.Date(2026, 11, 24, 9, 30, 0, 0, time.UTC))
	if out == nil || out.Error != "" || out.Saved == "" {
		t.Fatalf("apply: %+v", out)
	}
	if readStaged(dir) != nil {
		t.Fatal("the copy is still waiting after being put back")
	}
	e2 := fileEngine(t, dir)
	e2.Restored(out)
	facts, _ := e2.S.Facts()
	if len(facts) != 1 || facts[0].Text != "I had this when the copy was saved" {
		t.Fatalf("the data is not the saved copy: %+v", facts)
	}
	if list, _ := e2.Notices(); len(list) == 0 || !strings.Contains(list[0].Text, "jobhunt-before-restore-20261124-093000.db") {
		t.Fatalf("the person was not told: %+v", list)
	}
	// What was replaced is itself a copy that can be put back, later data and all.
	if err := store.Check(out.Saved); err != nil {
		t.Fatal(err)
	}
	was, err := store.Open(out.Saved)
	if err != nil {
		t.Fatal(err)
	}
	defer was.Close()
	if facts, _ := was.Facts(); len(facts) != 2 {
		t.Fatalf("the copy saved first is missing what was added later: %d facts", len(facts))
	}
	found := false
	for _, c := range e2.Copies() {
		found = found || (c.Before && c.Name == filepath.Base(out.Saved))
	}
	if !found {
		t.Fatalf("the copy saved first is not listed: %+v", e2.Copies())
	}
}

func TestABrokenStagedCopyLeavesTheDataAlone(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "jobhunt.db")
	e := fileEngine(t, dir)
	e.S.AddFact("still here", "you")
	e.Stop()
	e.S.Close()
	os.MkdirAll(restoreDir(dir), 0o700)
	os.WriteFile(pendingDB(dir), []byte("SQLite format 3\x00 and then nonsense"), 0o600)
	out := ApplyStagedRestore(dir, db, time.Now())
	if out == nil || out.Error == "" {
		t.Fatalf("a broken copy was put back: %+v", out)
	}
	if readStaged(dir) != nil {
		t.Fatal("the broken copy would be tried again at every start")
	}
	e2 := fileEngine(t, dir)
	e2.Restored(out)
	if facts, _ := e2.S.Facts(); len(facts) != 1 {
		t.Fatalf("the data was harmed: %+v", facts)
	}
	if list, _ := e2.Notices(); len(list) != 1 || list[0].Kind != "problem" {
		t.Fatalf("the person was not told it failed: %+v", list)
	}
}

func TestCalendar(t *testing.T) {
	e, _ := newEngine(t)
	co := setUp(t, e)
	now := e.Now()
	at := time.Date(now.Year(), now.Month(), now.Day(), 15, 0, 0, 0, now.Location()).AddDate(0, 0, 3)
	closes := now.AddDate(0, 0, 9)
	rid, err := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "cal:1", Title: "Tax Manager; Indirect", Description: "A fine job.\nClosing date: " + closes.Format("January 2, 2006") + ". Apply now."})
	if err != nil {
		t.Fatal(err)
	}
	e.S.SetStage(rid, "found")
	tid, _ := e.S.AddTalk(store.Talk{RoleID: rid, Kind: "interview", Title: "First interview", At: at.Unix(), Minutes: 45})
	e.S.AddTalk(store.Talk{Kind: "chat", Title: "Coffee, with a friend", At: at.Add(26 * time.Hour).Unix(), Minutes: 30})
	pid, _, _ := e.S.AddPerson(store.Person{Name: "Leila Haddad", Kind: "made_move"})
	nid, _ := e.S.AddNote(store.Note{PersonID: pid, Channel: "linkedin", Body: "Hello"})
	e.S.NoteSent(nid, 7)

	items := e.Calendar(dayStart(now).Unix(), dayStart(now).AddDate(0, 0, 30).Unix())
	kinds := map[string]CalItem{}
	for _, it := range items {
		kinds[it.Kind] = it
	}
	if len(items) != 4 || kinds["interview"].Go != fmt.Sprintf("#/interviews/%d", tid) || kinds["chat"].At == 0 ||
		kinds["follow"].Go != fmt.Sprintf("#/people/%d", pid) || kinds["closes"].Day != closes.Format("2006-01-02") || kinds["closes"].Go != fmt.Sprintf("#/roles/%d", rid) {
		t.Fatalf("calendar: %+v", items)
	}
	if kinds["interview"].Day != at.Format("2006-01-02") {
		t.Fatalf("the interview is on %s, want %s", kinds["interview"].Day, at.Format("2006-01-02"))
	}
	// A role the person closed has no deadline worth showing.
	e.S.CloseRole(rid, "no", "")
	if items = e.Calendar(dayStart(now).Unix(), dayStart(now).AddDate(0, 0, 30).Unix()); len(items) != 3 {
		t.Fatalf("a closed role is still on the calendar: %+v", items)
	}
	ics := string(e.CalendarICS(90))
	for _, want := range []string{"BEGIN:VCALENDAR", fmt.Sprintf("UID:jobhunt-talk-%d@local", tid), "SUMMARY:Coffee\\, with a friend", "DTSTART;VALUE=DATE:", "SUMMARY:Follow up with Leila Haddad", "END:VCALENDAR"} {
		if !strings.Contains(ics, want) {
			t.Errorf("the calendar file lacks %q:\n%s", want, ics)
		}
	}
	if strings.Count(ics, "BEGIN:VEVENT") != 3 || strings.Count(ics, "END:VEVENT") != 3 {
		t.Errorf("events in the file:\n%s", ics)
	}
}
