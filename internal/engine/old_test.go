package engine

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// oldData writes a data folder the way the old Job Hunt left one. modern is
// false for a database from before the later columns were added.
func oldData(t *testing.T, modern, withCV bool, secrets map[string]string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "Job Hunt", "data")
	if err := os.MkdirAll(filepath.Join(dir, "applications", "maple-1"), 0o755); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "cv"), 0o755)
	if withCV {
		os.WriteFile(filepath.Join(dir, "cv", "taxtech.txt"), []byte(testCV), 0o644)
	}
	os.WriteFile(filepath.Join(dir, "applications", "maple-1", "Sam Rivera - Maple Bank.docx"), []byte("PK\x03\x04 the CV sent to Maple Bank"), 0o644)

	db, err := sql.Open("sqlite", filepath.Join(dir, "jobhunt.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	extra := ""
	if modern {
		extra = ", closed_at TEXT, deadline TEXT, score_after INTEGER, apply_url TEXT"
	}
	for _, q := range []string{
		`CREATE TABLE jobs (id TEXT PRIMARY KEY, source TEXT NOT NULL, company TEXT NOT NULL, title TEXT NOT NULL, location TEXT, url TEXT, apply_email TEXT, description TEXT, salary TEXT,
			posted_at TEXT, found_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, score INTEGER, track TEXT, reasoning TEXT, red_flags TEXT, keywords TEXT,
			cv_path TEXT, letter_path TEXT, cover_letter TEXT, email_subject TEXT, applied_at TEXT, notes TEXT` + extra + `)`,
		`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE events (id INTEGER PRIMARY KEY, job_id TEXT, kind TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL, by_whom TEXT)`,
		`CREATE TABLE recruiters (email TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL, kind TEXT NOT NULL, roles TEXT, stage TEXT, first_at TEXT, last_at TEXT, emails INTEGER, gmail_ids TEXT, asked INTEGER, hidden INTEGER, phone TEXT, linkedin TEXT, notes TEXT)`,
		`CREATE TABLE recruiter_jobs (email TEXT, job_id TEXT, stage TEXT, first_at TEXT, last_at TEXT, emails INTEGER, last_subject TEXT)`,
		`CREATE TABLE calendar_events (event_id TEXT PRIMARY KEY, job_id TEXT, kind TEXT NOT NULL, start TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	ago := func(days int) string { return now.AddDate(0, 0, -days).Format(time.RFC3339) }
	job := func(id, company, title, status string, found int, score any, cvPath, letter, applied string) {
		t.Helper()
		src, _, _ := strings.Cut(id, ":")
		_, err := db.Exec(`INSERT INTO jobs (id, source, company, title, location, url, description, salary, posted_at, found_at, updated_at, status, score, reasoning, red_flags, keywords, cv_path, cover_letter, applied_at, notes)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id, src, company, title, "Toronto, Ontario, Canada", "https://example.com/jobs/"+id, "The posting for "+title+" at "+company+". Own the indirect tax engine.", "$140,000 a year",
			ago(found+1), ago(found), ago(max(found-2, 0)), status, score, "A strong match on tax engines.", `["Wants CPA"]`, `["Vertex","SAP"]`, cvPath, letter, applied, "")
		if err != nil {
			t.Fatal(err)
		}
	}
	null := sql.NullString{}
	job("linkedin:4012345678", "Maple Bank", "Senior Tax Manager", "applied", 60, 82, `C:\Users\sam\AppData\Local\Job Hunt\data\applications\maple-1\Sam Rivera - Maple Bank.docx`, "Dear Maple Bank, I built tax engines.", ago(40))
	job("greenhouse:acme:77", "Acme Corp", "Tax Technology Lead", "ready", 20, 77, "", "Dear Acme, here is why.", "")
	job("indeed:abc", "Borealis Ltd.", "Tax Analyst", "dismissed", 200, 55, "", "", "")
	job("adzuna:1", "Old Co", "Tax Manager", "queued", 90, 60, "", "", "")
	job("adzuna:2", "Fresh Co", "Indirect Tax Manager", "queued", 3, 70, "", "", "")
	job("lever:x1", "Northern Rail", "Tax Systems Manager", "interviewing", 30, 88, "", "Dear Northern Rail.", ago(25))
	job("jobbank:5", "City Works", "Tax Officer", "rejected", 80, 64, "", "", ago(70))
	job("workday:9", "Quiet Inc", "Tax Lead", "no_response", 120, 66, "", "", ago(110))
	job("workday:10", "Skip Inc", "Bookkeeper", "skipped", 100, 12, "", "", "")
	job("manual:11", "Kept Co", "Head of Tax Technology", "saved", 10, null, "", "", "")
	if modern {
		db.Exec(`UPDATE jobs SET score_after = 91 WHERE id = 'linkedin:4012345678'`)
	}
	db.Exec(`INSERT INTO events (job_id, kind, detail, created_at) VALUES ('linkedin:4012345678', 'tailored', 'CV and letter written from Tax technology', ?), ('linkedin:4012345678', 'scored', '82', ?), ('linkedin:4012345678', 'tailor:error', 'boom', ?)`, ago(59), ago(60), ago(60))
	db.Exec(`INSERT INTO recruiters (email, name, company, kind, last_at, emails, hidden, phone, linkedin, notes) VALUES
		('dana@talent.example', 'Dana Whitfield', 'Maple Bank', 'recruiter', ?, 3, 0, '416 555 0100', 'https://www.linkedin.com/in/dana-whitfield', 'Friendly'),
		('noreply@spam.example', 'Spam Bot', 'Spam', 'recruiter', ?, 1, 1, '', '', '')`, ago(35), ago(35))
	db.Exec(`INSERT INTO recruiter_jobs (email, job_id) VALUES ('dana@talent.example', 'linkedin:4012345678')`)
	db.Exec(`INSERT INTO calendar_events (event_id, job_id, kind, start, title) VALUES ('e1', 'lever:x1', 'interview', ?, 'Interview: Northern Rail'), ('e2', 'lever:x1', 'prep', ?, 'Prep')`, ago(20), ago(21))

	profile := map[string]any{
		"name": "Sam Rivera", "email": "sam@example.com", "locations": []string{"Toronto, ON", "Mississauga, ON"}, "remote_ok": true, "min_salary": 120000,
		"exclude_companies": []string{"Borealis Ltd."}, "exclude_title_keywords": []string{"intern"},
		"tracks":            []map[string]any{{"name": "taxtech", "label": "Tax technology", "titles": []string{"Indirect Tax Manager", "Tax Technology Manager"}}},
		"sources":           map[string]any{"greenhouse": []string{"acme"}, "lever": []string{"northern-rail"}, "sites": []string{"roberthalf", "aerotek"}, "custom_sites": []map[string]string{{"name": "Aplin", "url": "https://aplin.example/jobs?q={title}"}, {"name": "Broken", "url": "file:///etc/passwd"}}},
		"application_facts": "I hold a valid G driving licence\n- Open to hybrid work",
		"certifications":    []map[string]string{{"name": "CPA", "issuer": "CPA Ontario", "issued": "2020"}},
		"stories":           "At Northwind I cut the close by four days.\n\nAt Contoso I trained forty people.",
		"wants":             map[string]any{"dealbreakers": []string{"more than 25% travel"}},
	}
	pb, _ := json.Marshal(profile)
	db.Exec(`INSERT INTO kv (key, value) VALUES ('profile', ?)`, string(pb))
	for k, v := range secrets {
		db.Exec(`INSERT INTO kv (key, value) VALUES (?, ?)`, k, v)
	}
	return dir
}

func hashOf(t *testing.T, path string) [32]byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(b)
}

func TestBringOverFromTheOldJobHunt(t *testing.T) {
	e, _ := newEngine(t)
	ctx := context.Background()
	dir := oldData(t, true, true, map[string]string{"claude.engine": "api", "claude.key": "sk-ant-old"})
	before := hashOf(t, filepath.Join(dir, "jobhunt.db"))

	look, err := e.LookAtOld(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !look.Found || look.Name != "Sam Rivera" || look.Applied != 4 || look.Prepared != 1 || look.NotInterested != 1 || look.Open != 2 || len(look.CVs) != 1 || look.People != 1 || look.Claude != "key" {
		t.Fatalf("look = %+v", look)
	}

	res, err := e.ImportOld(ctx, dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Roles != 8 || res.Applied != 4 || res.Prepared != 1 || res.NotInterested != 1 || res.LeftBehind != 2 || res.CVs != 1 || res.People != 1 || res.Talks != 1 || res.Muted != 1 || res.Sites != 2 {
		t.Fatalf("result = %+v", res)
	}
	// The way Claude was already reached here is left alone.
	if got := e.LLM(); got.Engine != "demo" || got.Key != "" {
		t.Fatalf("the Claude connection was replaced: %+v", got)
	}

	p := e.S.Profile()
	if p.Name != "Sam Rivera" || p.City != "Toronto" || p.Country != "Canada" || p.PayFloor != 120000 || !hasFold(p.Places, "Mississauga") || !hasFold(p.Avoid, "intern") {
		t.Fatalf("profile = %+v", p)
	}
	if !hasFold(p.Titles.Level, "Indirect Tax Manager") || len(p.Titles.StepUp) == 0 || len(p.Titles.Sideways) == 0 {
		t.Fatalf("the old titles must be added and step-up kept: %+v", p.Titles)
	}
	if cvs, _ := e.S.CVs(); len(cvs) != 1 || cvs[0].Filename != "Tax technology.txt" {
		t.Fatalf("cvs = %+v", cvs)
	}
	facts, _ := e.S.Facts()
	var all []string
	for _, f := range facts {
		all = append(all, f.Text)
	}
	joined := strings.Join(all, "\n")
	for _, want := range []string{"G driving licence", "Open to hybrid work", "Certification: CPA, CPA Ontario, issued 2020", "trained forty people", "25% travel"} {
		if !strings.Contains(joined, want) {
			t.Errorf("fact %q did not come over: %s", want, joined)
		}
	}
	if strings.Contains(joined, "sam@example.com") {
		t.Error("the person's address was copied into the facts")
	}

	// A job applied to keeps its text, its dates, its letter and the CV that was sent.
	id, closed, ok := e.S.SeenRole("linkedin:4012345678")
	if !ok || closed != "" {
		t.Fatal("the applied LinkedIn role is missing")
	}
	r, _ := e.S.Role(id)
	wantApplied := time.Now().AddDate(0, 0, -40).Unix()
	if r.Stage != "applied" || r.Fit != 82 || r.FitTailored != 91 || !strings.Contains(r.Description, "Own the indirect tax engine") || r.AppliedAt < wantApplied-120 || r.AppliedAt > wantApplied+120 || r.Pay == "" {
		t.Fatalf("role = %+v", r)
	}
	var letter LetterDoc
	if ok, _ := e.S.Doc(id, "letter", &letter); !ok || !strings.Contains(letter.Text, "Dear Maple Bank") {
		t.Fatalf("letter = %+v", letter)
	}
	f, err := e.OldCVFile(id)
	if err != nil || !bytes.HasPrefix(f.Data, []byte("PK")) || f.Name != "Sam Rivera - Maple Bank.docx" {
		t.Fatalf("old CV file = %q %v", f.Name, err)
	}
	acts, _ := e.S.ActivityList(store.ActivityFilter{RoleID: id, Limit: 20})
	var said []string
	for _, a := range acts {
		said = append(said, a.Text)
	}
	if h := strings.Join(said, "|"); !strings.Contains(h, "CV and letter written") || strings.Contains(h, "boom") || strings.Contains(h, "82") {
		t.Errorf("history = %s", h)
	}

	// Statuses land where they belong.
	for key, want := range map[string][2]string{
		"old:greenhouse:acme:77": {"ready", ""}, "old:lever:x1": {"interview", ""}, "old:jobbank:5": {"applied", "rejected"},
		"old:workday:9": {"applied", "expired"}, "old:adzuna:2": {"found", ""}, "old:manual:11": {"new", ""}, "old:indeed:abc": {"found", "no"},
	} {
		id, closed, ok := e.S.SeenRole(key)
		if !ok {
			t.Errorf("%s did not come over", key)
			continue
		}
		r, _ := e.S.Role(id)
		if r.Stage != want[0] || closed != want[1] {
			t.Errorf("%s: stage %q closed %q, want %v", key, r.Stage, closed, want)
		}
		if key == "old:manual:11" && !r.Saved {
			t.Error("the saved role is no longer saved")
		}
	}
	for _, key := range []string{"old:adzuna:1", "old:workday:10"} {
		if _, _, ok := e.S.SeenRole(key); ok {
			t.Errorf("%s should have stayed behind", key)
		}
	}

	// A role the person said no to stays said no to when a search meets it again.
	bor, err := e.S.CompanyByName("Borealis")
	if err != nil || bor.State != "muted" {
		t.Fatalf("the excluded employer is not muted: %+v %v", bor, err)
	}
	stats := &RunStats{ClearedBy: map[string]int{}}
	nid, fresh, _ := e.ingest(bor.ID, sources.Posting{Source: "greenhouse", Key: "greenhouse:999", Company: "Borealis Ltd.", Title: "Tax Analyst", Location: "Toronto, ON", Applicants: -1}, e.S.Profile(), stats)
	if back, _ := e.S.Role(nid); fresh || back.Closed != "no" {
		t.Fatalf("a role said no to in the old app came back: fresh=%v %+v", fresh, back)
	}

	// The person who wrote, and the interview.
	people, _ := e.S.People(store.PeopleFilter{})
	if len(people) != 1 || people[0].Name != "Dana Whitfield" || people[0].Kind != "recruiter" || people[0].KnowsYouAt == 0 || people[0].Company != "Maple Bank" || people[0].EmailSure != "sure" {
		t.Fatalf("people = %+v", people)
	}
	rail, _, _ := e.S.SeenRole("old:lever:x1")
	if talks, _ := e.S.TalksForRole(rail); len(talks) != 1 || talks[0].Kind != "interview" {
		t.Fatalf("talks = %+v", talks)
	}
	// The boards that were watched are watched here, under the employer's own name.
	if c, err := e.S.CompanyByName("Acme Corp"); err != nil || c.Name != "Acme Corp" || c.BoardKind != "greenhouse" || c.BoardToken != "acme" || c.State != "following" {
		t.Fatalf("board = %+v %v", c, err)
	}
	if c, err := e.S.CompanyByName("Northern Rail"); err != nil || c.BoardKind != "lever" || c.BoardToken != "northern-rail" || c.State != "following" {
		t.Fatalf("board = %+v %v", c, err)
	}

	// Again: nothing twice.
	roles := e.S.Count(`SELECT COUNT(*) FROM roles`)
	again, err := e.ImportOld(ctx, dir, "")
	if err != nil {
		t.Fatal(err)
	}
	// The job sites that were being watched are watched here; the ones that cannot be are named.
	var watched []string
	for _, x := range e.placeSet().Sites {
		watched = append(watched, x.ID+" "+x.URL)
	}
	if got := strings.Join(watched, "; "); !strings.Contains(got, "roberthalf ") || !strings.Contains(got, "site-aplin-example https://aplin.example/jobs?q={title}") || strings.Contains(got, "passwd") {
		t.Fatalf("watched sites: %s", got)
	}
	if notes := strings.Join(res.Notes, " "); !strings.Contains(notes, "aerotek") || !strings.Contains(notes, "Broken") {
		t.Fatalf("notes: %q", notes)
	}
	if again.Sites != 0 || len(e.placeSet().Sites) != 2 {
		t.Fatalf("sites added twice: %+v", e.placeSet().Sites)
	}
	if again.Roles != 0 || again.CVs != 0 || again.People != 0 || again.Talks != 0 || again.Facts != 0 || e.S.Count(`SELECT COUNT(*) FROM roles`) != roles {
		t.Fatalf("the second run added things: %+v", again)
	}
	if l, _ := e.LookAtOld(""); l.Last == nil || l.Last.Where != dir {
		t.Fatalf("the last run is not remembered: %+v", l)
	}

	// The old app's own files are exactly as they were.
	if hashOf(t, filepath.Join(dir, "jobhunt.db")) != before {
		t.Fatal("the old database was changed")
	}
	left, _ := os.ReadDir(dir)
	for _, f := range left {
		if strings.HasSuffix(f.Name(), "-wal") || strings.HasSuffix(f.Name(), "-shm") || strings.HasSuffix(f.Name(), "-journal") {
			t.Errorf("%s was left in the old folder", f.Name())
		}
	}
	if tmp, _ := os.ReadDir(filepath.Join(e.Dir, "tmp")); len(tmp) != 0 {
		t.Errorf("working copies were left behind: %v", tmp)
	}
}

func TestBringOverFromABackupAndAnOlderDatabase(t *testing.T) {
	// A fresh start with nothing connected: the key in the old data connects Claude.
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	e := New(s, t.TempDir())
	t.Cleanup(func() { e.Stop(); s.Close() })

	dir := oldData(t, false, false, map[string]string{"claude.engine": "api", "claude.key": "sk-ant-old"})
	zpath := filepath.Join(t.TempDir(), "Job Hunt backup.zip")
	zf, _ := os.Create(zpath)
	zw := zip.NewWriter(zf)
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		w, _ := zw.Create(filepath.ToSlash(rel))
		f, _ := os.Open(p)
		defer f.Close()
		_, err = io.Copy(w, f)
		return err
	})
	zw.Close()
	zf.Close()

	res, err := e.ImportOld(context.Background(), zpath, "Job Hunt backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if res.Roles != 8 || res.Where != "Job Hunt backup.zip" || res.Claude == "" || res.CVs != 0 {
		t.Fatalf("result = %+v", res)
	}
	if got := e.LLM(); got.Engine != "api" || got.Key != "sk-ant-old" {
		t.Fatalf("Claude was not connected from the old key: %+v", got)
	}
	id, _, ok := e.S.SeenRole("linkedin:4012345678")
	if !ok {
		t.Fatal("the applied role is missing")
	}
	if r, _ := e.S.Role(id); r.FitTailored != -1 || r.Fit != 82 {
		t.Fatalf("an older database has no tailored score: %+v", r)
	}
	if f, err := e.OldCVFile(id); err != nil || len(f.Data) == 0 {
		t.Fatalf("the CV in the backup did not come over: %v", err)
	}
	// With no CV to read, the old titles are still what is searched for.
	if p := e.S.Profile(); !hasFold(p.Titles.Level, "Tax Technology Manager") || p.City != "Toronto" {
		t.Fatalf("profile = %+v", p)
	}

	// Something that is not the old Job Hunt is refused in words.
	junk := filepath.Join(t.TempDir(), "notes.zip")
	os.WriteFile(junk, []byte("PK\x03\x04 not really"), 0o644)
	if _, err := e.ImportOld(context.Background(), junk, ""); err == nil || !strings.Contains(err.Error(), "not the old Job Hunt") {
		t.Fatalf("junk was accepted: %v", err)
	}
	if _, err := e.ImportOld(context.Background(), filepath.Join(t.TempDir(), "missing"), ""); err == nil {
		t.Fatal("a missing folder was accepted")
	}
}

func TestBringingOverSaysHowFarItIs(t *testing.T) {
	e, _ := newEngine(t)
	var seen []OldStep
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			if l, _ := e.LookAtOld(""); l.Busy && l.Progress != nil && l.Progress.Text != "" {
				if n := len(seen); n == 0 || seen[n-1] != *l.Progress {
					seen = append(seen, *l.Progress)
				}
			}
			time.Sleep(200 * time.Microsecond)
		}
	}()
	// Reading a CV is made to take a moment, as it does with Claude.
	e.oldSay("", 0, 0)
	if _, err := e.ImportOld(context.Background(), oldData(t, true, true, map[string]string{"claude.engine": "api", "claude.key": "sk-ant-old"}), ""); err != nil {
		t.Fatal(err)
	}
	close(stop)
	<-done
	last := -1
	for _, s := range seen {
		if s.Percent < last || s.Percent > 100 {
			t.Fatalf("the bar went backwards or past the end: %+v", seen)
		}
		last = s.Percent
	}
	if l, _ := e.LookAtOld(""); l.Busy || l.Progress != nil {
		t.Fatalf("still says it is busy: %+v", l)
	}
}

func TestClearingOutTheOldJobsKeepsWhatWasAppliedTo(t *testing.T) {
	e, _ := newEngine(t)
	ctx := context.Background()
	dir := oldData(t, true, false, nil)
	if _, err := e.ImportOld(ctx, dir, ""); err != nil {
		t.Fatal(err)
	}
	// A role found here, not by the old app, is never touched.
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "New Find Inc", State: "following"})
	mine, _ := e.S.AddRole(store.Role{CompanyID: c.ID, Key: "greenhouse:new:1", Title: "Tax Manager", Applicants: -1})
	rail, _, _ := e.S.SeenRole("old:lever:x1")

	e.clearOldOnce()
	var done OldCleared
	if ok, _ := e.S.Get(oldClearedKey, &done); !ok || done.Roles != 3 || done.Copy == "" {
		t.Fatalf("cleared = %+v", done)
	}
	for _, key := range []string{"linkedin:4012345678", "old:lever:x1", "old:jobbank:5", "old:workday:9", "old:indeed:abc", "greenhouse:new:1"} {
		if _, _, ok := e.S.SeenRole(key); !ok {
			t.Errorf("%s was removed", key)
		}
	}
	for _, key := range []string{"old:greenhouse:acme:77", "old:adzuna:2", "old:manual:11"} {
		if _, _, ok := e.S.SeenRole(key); ok {
			t.Errorf("%s is still there", key)
		}
	}
	if _, err := e.S.Role(mine); err != nil {
		t.Fatal(err)
	}
	// What was applied to keeps its letter, CV and interview.
	maple, _, _ := e.S.SeenRole("linkedin:4012345678")
	if _, err := e.OldCVFile(maple); err != nil {
		t.Fatal("the CV sent to Maple Bank is gone")
	}
	if talks, _ := e.S.TalksForRole(rail); len(talks) != 1 {
		t.Fatalf("talks = %+v", talks)
	}
	if n := e.S.Count(`SELECT COUNT(*) FROM docs WHERE role_id NOT IN (SELECT id FROM roles) AND role_id <> 0`); n != 0 {
		t.Fatalf("%d documents left without a role", n)
	}
	// Employers that only came with the cleared jobs go; watched boards stay.
	if _, err := e.S.CompanyByName("Fresh Co"); err == nil {
		t.Error("Fresh Co is still suggested")
	}
	if co, err := e.S.CompanyByName("Acme Corp"); err != nil || co.BoardToken != "acme" {
		t.Errorf("the watched board went: %+v %v", co, err)
	}
	// A copy of everything was saved first, and is offered back.
	if _, err := os.Stat(done.Copy); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, cp := range e.Copies() {
		found = found || (cp.Before && strings.Contains(cp.What, "clearing"))
	}
	if !found {
		t.Fatalf("the copy is not listed: %+v", e.Copies())
	}
	// Bringing things over again brings back only what was applied to.
	roles := e.S.Count(`SELECT COUNT(*) FROM roles`)
	if _, err := e.ImportOld(ctx, dir, ""); err != nil {
		t.Fatal(err)
	}
	if n := e.S.Count(`SELECT COUNT(*) FROM roles`); n != roles {
		t.Fatalf("bringing over again added %d roles", n-roles)
	}
	// It happens once.
	e.S.AddRole(store.Role{CompanyID: c.ID, Key: "old:later", Title: "Tax Lead", Applicants: -1})
	e.clearOldOnce()
	if _, _, ok := e.S.SeenRole("old:later"); !ok {
		t.Fatal("the clear-out ran twice")
	}
}

func TestTheSearchKeysComeOver(t *testing.T) {
	e, _ := newEngine(t)
	e.SetSource("jooble", SourceKeyInput{Key: "jooble-mine"})
	dir := oldData(t, true, false, map[string]string{
		"adzuna.id": "adz-id", "adzuna.key": "adz-key", "jooble.key": "jooble-old",
		"jsearch.key": "js-key", "jsearch.provider": "rapidapi", "apify.key": "apify-token", "apify.actor": "someone/other-scraper",
	})
	res, err := e.ImportOld(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	k := e.sourceKeys()
	if k.AdzunaID != "adz-id" || k.AdzunaKey != "adz-key" || k.JSearch != "js-key" || k.JSearchFrom != "rapidapi" || k.Apify != "apify-token" || k.ApifyActor != "someone/other-scraper" {
		t.Fatalf("keys = %+v", k)
	}
	if k.Jooble != "jooble-mine" {
		t.Fatal("a key saved here was replaced")
	}
	if len(res.Searches) != 3 {
		t.Fatalf("searches = %v", res.Searches)
	}
	for _, s := range e.MoreSources() {
		if (s.ID == "apify" || s.ID == "adzuna") && !s.HasKey {
			t.Errorf("%s shows no key", s.ID)
		}
	}
}
