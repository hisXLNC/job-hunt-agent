package engine

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/store"
)

func TestJobLink(t *testing.T) {
	yes := []string{
		"https://www.linkedin.com/jobs/view/4012345678/",
		"  https://www.linkedin.com/jobs/view/senior-analyst-at-acme-4012345678?refId=x  ",
		"https://boards.greenhouse.io/acme/jobs/1234567",
		"https://jobs.lever.co/acme/0b8d3e4a-1111-2222-3333-444455556666",
		"https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto/Analyst_R123",
		"https://ca.indeed.com/viewjob?jk=abc123",
		"https://www.acme.com/careers/analyst-12345",
	}
	for _, s := range yes {
		if _, ok := JobLink(s); !ok {
			t.Errorf("should be a job link: %q", s)
		}
	}
	no := []string{
		"", "hello world", "https://www.linkedin.com/feed/", "see https://www.linkedin.com/jobs/view/4012345678",
		"javascript:alert(1)", "http://127.0.0.1:47700/jobs/12345", "https://user:pw@example.com/jobs/12345",
		"https://www.google.com/search?q=jobs",
	}
	for _, s := range no {
		if _, ok := JobLink(s); ok {
			t.Errorf("should not be a job link: %q", s)
		}
	}
	if got, _ := JobLink("https://boards.greenhouse.io/acme/jobs/1234567#apply"); strings.Contains(got, "#") {
		t.Errorf("the part after # is dropped: %q", got)
	}
}

func TestCopiedLink(t *testing.T) {
	e, _ := newEngine(t)
	if e.TookCopiedLink("just some words") || e.CopiedLink() != "" {
		t.Fatal("words are not a link")
	}
	link := "https://boards.greenhouse.io/acme/jobs/1234567"
	if !e.TookCopiedLink(link) || e.CopiedLink() != link {
		t.Fatal("a copied job link is offered")
	}
	if e.TookCopiedLink(link) {
		t.Error("the same link is offered once")
	}
	if e.UnreadNotices() != 1 {
		t.Errorf("one notice under the bell, got %d", e.UnreadNotices())
	}
	co, _, _ := e.S.UpsertCompany(store.Company{Name: "Beta", State: "following"})
	e.S.AddRole(store.Role{CompanyID: co.ID, Key: "x:2", Title: "Analyst", URL: "https://boards.greenhouse.io/beta/jobs/7654321", Applicants: -1})
	if e.TookCopiedLink("https://boards.greenhouse.io/beta/jobs/7654321") {
		t.Error("a role Job Hunt already has is not offered again")
	}
}

func TestNextWake(t *testing.T) {
	e, _ := newEngine(t)
	now := time.Date(2026, 11, 25, 9, 0, 0, 0, time.Local)
	e.Now = func() time.Time { return now }
	e.SetSchedule(Schedule{Full: []int{12 * 60}, FastMinutes: 20})
	e.S.Set("search", SearchState{LastFull: now.Unix()})
	if _, ok := e.NextWake(); ok {
		t.Fatal("waking is off until the person turns it on")
	}
	d := e.Desk()
	d.Wake = true
	e.SetDesk(d)
	at, ok := e.NextWake()
	if !ok || !at.Equal(time.Date(2026, 11, 25, 11, 59, 0, 0, time.Local)) {
		t.Fatalf("wake a minute before the noon search, got %v %v", at, ok)
	}
	e.SetPaused(true)
	if _, ok := e.NextWake(); ok {
		t.Error("nothing to wake for while searching is paused")
	}
}

func TestHiringTeam(t *testing.T) {
	e, _ := newEngine(t)
	co, _, _ := e.S.UpsertCompany(store.Company{Name: "Acme Corp", State: "following"})
	id, err := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "t:1", Source: "linkedin", Title: "Analyst", Applicants: -1, Stage: "found"})
	if err != nil {
		t.Fatal(err)
	}
	team := []TeamMember{
		{Name: "Dana  Lee", Title: "Senior Technical Recruiter", URL: "https://www.linkedin.com/in/dana-lee-example"},
		{Name: "Ravi Patel", Title: "Director, Finance", URL: "https://evil.example.com/in/ravi"},
		{Name: "", Title: "No name"},
	}
	n, err := e.AddHiringTeam(id, team)
	if err != nil || n != 2 {
		t.Fatalf("added %d, %v", n, err)
	}
	people, _ := e.S.People(store.PeopleFilter{CompanyID: co.ID})
	by := map[string]store.Person{}
	for _, p := range people {
		by[p.Name] = p
	}
	if p := by["Dana Lee"]; p.Kind != "recruiter" || p.URL == "" || !strings.Contains(p.Why, "Analyst") {
		t.Errorf("recruiter: %+v", p)
	}
	if p := by["Ravi Patel"]; p.Kind != "manager" || p.URL != "" {
		t.Errorf("a link that is not a LinkedIn profile is dropped: %+v", p)
	}
	if n, _ := e.AddHiringTeam(id, team); n != 0 {
		t.Errorf("the same people again are not new: %d", n)
	}
}

func TestKeepFiles(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	home := filepath.Join(t.TempDir(), "Job Hunt")
	e.FilesHome = home
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	all, _, _ := e.S.Roles(store.RoleFilter{Limit: 5})
	if len(all) == 0 || all[0].Stage != "ready" {
		t.Fatalf("role not prepared: %+v", all)
	}
	kept := e.KeptFiles(0)
	if len(kept) != 1 || len(kept[0].Files) < 2 {
		t.Fatalf("the CV and letter should be written when prepared: %+v", kept)
	}
	if p := e.KeptFolderPath(kept[0].Name); p == "" || !strings.HasPrefix(p, home) {
		t.Errorf("folder path: %q", p)
	}
	for _, bad := range []string{"..", "../x", `a\b`, "nope"} {
		if p := e.KeptFolderPath(bad); p != "" {
			t.Errorf("%q must not name a folder: %q", bad, p)
		}
	}
	// Another folder, chosen by the person.
	other := filepath.Join(t.TempDir(), "Mine")
	if err := e.SetFiles(FilesSet{Dir: other}); err != nil {
		t.Fatal(err)
	}
	if err := e.SetFiles(FilesSet{Dir: "relative/path"}); err == nil {
		t.Error("a relative path is refused")
	}
	folder, err := e.KeepFiles(all[0].ID)
	if err != nil || !strings.HasPrefix(folder, other) {
		t.Fatalf("kept in %q: %v", folder, err)
	}
	if _, err := os.Stat(folder); err != nil {
		t.Fatal(err)
	}
	// Off: nothing is written.
	e.SetFiles(FilesSet{Off: true})
	if f, err := e.KeepFiles(all[0].ID); f != "" || err != nil {
		t.Errorf("off writes nothing: %q %v", f, err)
	}
}
