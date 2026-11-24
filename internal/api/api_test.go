package api

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	"jobhunt/internal/engine"
	"jobhunt/internal/store"
)

const testPort = 47700

func newServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	e := engine.New(s, t.TempDir())
	t.Cleanup(e.Stop)
	if err := e.SetLLM(engine.LLMSettings{Engine: "demo"}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{E: e, S: s, Port: testPort, Web: fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}}
	return srv, srv.Handler()
}

type call struct {
	method, path, host, origin, key, body, site string
	marker                                      bool
}

func do(h http.Handler, c call) *httptest.ResponseRecorder {
	if c.method == "" {
		c.method = "GET"
	}
	r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
	r.Host = "127.0.0.1:47700"
	if c.host != "" {
		r.Host = c.host
	}
	if c.origin != "" {
		r.Header.Set("Origin", c.origin)
	}
	if c.key != "" {
		r.Header.Set("X-JobHunt-Ext", c.key)
	}
	if c.marker {
		r.Header.Set("X-JobHunt", "1")
	}
	if c.site != "" {
		r.Header.Set("Sec-Fetch-Site", c.site)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestOnlyThisComputersPagesGetIn(t *testing.T) {
	_, h := newServer(t)
	cases := []struct {
		name string
		c    call
		want int
	}{
		{"own page reads", call{path: "/api/state"}, 200},
		{"own page reads, with its origin", call{path: "/api/state", origin: "http://127.0.0.1:47700"}, 200},
		{"a name pointed at this computer", call{path: "/api/state", host: "evil.example:47700"}, 403},
		{"another site reads", call{path: "/api/state", origin: "https://evil.example"}, 403},
		{"another site changes something", call{method: "POST", path: "/api/pause", origin: "https://evil.example", marker: true}, 403},
		{"a plain form post, no marker", call{method: "POST", path: "/api/pause", body: "{}"}, 403},
		{"own page changes something", call{method: "POST", path: "/api/pause", body: `{"paused":true}`, marker: true}, 200},
		{"own page reaching the extension's routes", call{path: "/api/ext/next"}, 403},
		{"an extension reaching the app's routes", call{path: "/api/state", origin: "chrome-extension://" + strings.Repeat("a", 32), key: strings.Repeat("k", 40)}, 403},
		{"an image tag on another site pointed here", call{path: "/api/roles", site: "cross-site"}, 403},
		{"a page on another port of this computer", call{path: "/api/roles", site: "same-site"}, 403},
		{"own page, as the browser marks it", call{path: "/api/roles", site: "same-origin"}, 200},
		{"the page itself", call{path: "/"}, 200},
	}
	for _, c := range cases {
		if got := do(h, c.c).Code; got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
	if csp := do(h, call{path: "/"}).Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("the page has no content policy: %q", csp)
	}
}

func TestExtensionNeedsApproval(t *testing.T) {
	srv, h := newServer(t)
	origin := "chrome-extension://" + strings.Repeat("b", 32)
	key, other := strings.Repeat("k", 40), strings.Repeat("z", 40)

	if got := do(h, call{path: "/api/ext/next", origin: origin, key: key}).Code; got != 403 {
		t.Fatalf("before approval: got %d, want 403", got)
	}
	if got := do(h, call{path: "/api/ext/next", origin: origin}).Code; got != 403 {
		t.Fatalf("without a key: got %d, want 403", got)
	}
	// Nothing is waiting until the panel says hello.
	if got := do(h, call{method: "POST", path: "/api/ext/pair", marker: true}).Code; got != 400 {
		t.Fatalf("approving nothing: got %d, want 400", got)
	}
	w := do(h, call{method: "POST", path: "/api/ext/hello", origin: origin, key: key, body: "{}"})
	if w.Code != 403 || !strings.Contains(w.Body.String(), `"pair":"pending"`) {
		t.Fatalf("hello before approval: %d %s", w.Code, w.Body)
	}
	// The app shows the same code the panel works out from its key.
	var conn struct {
		Pending string `json:"ext_pending"`
	}
	json.Unmarshal(do(h, call{path: "/api/connections"}).Body.Bytes(), &conn)
	if want := strings.ToUpper(hashKey(key)[:6]); conn.Pending != want {
		t.Fatalf("code shown %q, want %q", conn.Pending, want)
	}
	// Another site cannot approve it.
	if got := do(h, call{method: "POST", path: "/api/ext/pair", origin: "https://evil.example", marker: true}).Code; got != 403 {
		t.Fatalf("another site approving: got %d", got)
	}
	if got := do(h, call{method: "POST", path: "/api/ext/pair", marker: true}).Code; got != 200 {
		t.Fatalf("approving: got %d", got)
	}
	if srv.ext().KeyHash != hashKey(key) {
		t.Fatal("the key was not remembered")
	}
	// Approved: works with or without the browser naming where it came from.
	for _, c := range []call{{path: "/api/ext/next", origin: origin, key: key}, {path: "/api/ext/next", key: key}, {method: "POST", path: "/api/ext/hello", origin: origin, key: key, body: "{}"}} {
		if got := do(h, c).Code; got != 200 {
			t.Errorf("approved %s %s: got %d", c.method, c.path, got)
		}
	}
	// A different extension with its own key stays out, and still cannot reach the app.
	if got := do(h, call{path: "/api/ext/next", origin: "chrome-extension://" + strings.Repeat("c", 32), key: other}).Code; got != 403 {
		t.Errorf("another extension: got %d", got)
	}
	if got := do(h, call{path: "/api/state", key: key}).Code; got != 403 {
		t.Errorf("approved extension reading the app's routes: got %d", got)
	}
	// The key never comes back out.
	if body := do(h, call{path: "/api/connections"}).Body.String(); strings.Contains(body, hashKey(key)) || strings.Contains(body, key) {
		t.Error("the connections answer gives the key away")
	}
	do(h, call{method: "POST", path: "/api/ext/unpair", marker: true})
	if got := do(h, call{path: "/api/ext/next", origin: origin, key: key}).Code; got != 403 {
		t.Errorf("after disconnecting: got %d", got)
	}
}

// approvedPanel connects a side panel and returns how it calls.
func approvedPanel(t *testing.T, h http.Handler) func(method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	origin, key := "chrome-extension://"+strings.Repeat("d", 32), strings.Repeat("p", 40)
	do(h, call{method: "POST", path: "/api/ext/hello", origin: origin, key: key, body: "{}"})
	if got := do(h, call{method: "POST", path: "/api/ext/pair", marker: true}).Code; got != 200 {
		t.Fatalf("approving the panel: got %d", got)
	}
	return func(method, path, body string) *httptest.ResponseRecorder {
		return do(h, call{method: method, path: path, origin: origin, key: key, body: body})
	}
}

// An answer the person typed into a form is kept only through the approved
// side panel, and never when it is a secret, an identity number, a date of
// birth or a long piece of writing.
func TestTheSidePanelKeepsAnAnswerThePersonGave(t *testing.T) {
	srv, h := newServer(t)
	body := `{"question":"What is your notice period?","answer":"Two weeks"}`
	// Not from the app's own pages, not from another site, not without approval.
	for name, c := range map[string]call{
		"own page":            {method: "POST", path: "/api/ext/answer", body: body, marker: true},
		"another site":        {method: "POST", path: "/api/ext/answer", body: body, origin: "https://evil.example", marker: true},
		"an unapproved panel": {method: "POST", path: "/api/ext/answer", body: body, origin: "chrome-extension://" + strings.Repeat("e", 32), key: strings.Repeat("q", 40)},
	} {
		if got := do(h, c).Code; got != 403 {
			t.Errorf("%s keeping an answer: got %d, want 403", name, got)
		}
	}
	panel := approvedPanel(t, h)
	if w := panel("POST", "/api/ext/answer", body); w.Code != 200 {
		t.Fatalf("keeping an answer: %d %s", w.Code, w.Body)
	}
	for name, b := range map[string]string{
		"a password":           `{"question":"Choose a password","answer":"hunter2"}`,
		"an identity number":   `{"question":"Social Insurance Number (SIN)","answer":"000 000 000"}`,
		"a social security no": `{"question":"What is your SSN?","answer":"000-00-0000"}`,
		"bank details":         `{"question":"Bank account number","answer":"0000000"}`,
		"a card":               `{"question":"Credit card number","answer":"0000 0000 0000 0000"}`,
		"a date of birth":      `{"question":"Date of birth","answer":"1 January 1990"}`,
		"long writing":         `{"question":"Why us?","answer":"` + strings.Repeat("word ", 80) + `"}`,
		"no answer":            `{"question":"Why us?","answer":"  "}`,
		"no question":          `{"question":"","answer":"Yes"}`,
	} {
		if w := panel("POST", "/api/ext/answer", b); w.Code != 400 {
			t.Errorf("%s: got %d, want 400", name, w.Code)
		}
	}
	saved, _ := srv.S.Answers()
	if len(saved) != 1 || saved[0].Answer != "Two weeks" {
		t.Fatalf("saved answers: %+v", saved)
	}
	// It is used as is the next time a form asks, also when the form lists choices.
	w := panel("POST", "/api/ext/answers", `{"role":0,"questions":["What is your notice period?","Do you own a car?"],"options":[["Immediately","Two weeks","One month"],["Yes","No"]]}`)
	var out struct {
		Answers []struct {
			Question, Answer string
			Sure             bool
		}
	}
	if json.Unmarshal(w.Body.Bytes(), &out); w.Code != 200 || len(out.Answers) != 2 {
		t.Fatalf("answers: %d %s", w.Code, w.Body)
	}
	if a := out.Answers[0]; a.Answer != "Two weeks" || !a.Sure || a.Question != "What is your notice period?" {
		t.Errorf("the kept answer came back as %+v", a)
	}
	if a := out.Answers[1]; a.Sure || a.Question != "Do you own a car?" {
		t.Errorf("an unknown question came back as %+v", a)
	}
	// The assistant has no way to the side panel's routes.
	for _, tl := range tools {
		if strings.HasPrefix(tl.Pattern, "/api/ext/") {
			t.Errorf("the assistant can reach %s %s", tl.Method, tl.Pattern)
		}
	}
}

// The panel is told the jobs, schools and skills on the CV, for forms that
// ask for each one again, and the pay floor for "expected salary".
func TestTheSidePanelGetsTheCVsHistory(t *testing.T) {
	srv, h := newServer(t)
	p := srv.S.Profile()
	p.Name, p.PayFloor, p.PayUnit = "Sam Rivera", 90000, "a year"
	srv.S.Set("profile", p)
	model := `{"name":"Sam Rivera","contact":{"email":"sam.rivera@example.com","phone":"555 0142","location":"Toronto, ON","links":["https://example.com/sam"]},"sections":[
		{"title":"Experience","kind":"experience","items":[{"heading":"Senior Analyst","org":"Northwind Example Ltd","dates":"Mar 2021 – Present","bullets":["Cut month-end close by two days"]}]},
		{"title":"Education","kind":"education","items":[{"heading":"BSc Computer Science","org":"Example University","dates":"2014 – 2018"}]},
		{"title":"Skills","kind":"skills","items":[{"text":"Tools: SQL, Python; Tableau"}]}]}`
	if _, err := srv.S.AddCV(store.CV{Name: "CV", Model: json.RawMessage(model)}, nil); err != nil {
		t.Fatal(err)
	}
	w := approvedPanel(t, h)("GET", "/api/ext/me", "")
	var me struct {
		Email     string `json:"email"`
		PayFloor  int    `json:"pay_floor"`
		Work      []struct{ Title, Org, Dates, Text string }
		Education []struct{ Title, Org string }
		Skills    []string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil || w.Code != 200 {
		t.Fatalf("me: %d %s", w.Code, w.Body)
	}
	if me.Email != "sam.rivera@example.com" || me.PayFloor != 90000 {
		t.Errorf("contact and floor: %+v", me)
	}
	if len(me.Work) != 1 || me.Work[0].Title != "Senior Analyst" || me.Work[0].Org != "Northwind Example Ltd" || !strings.Contains(me.Work[0].Text, "month-end") {
		t.Errorf("work: %+v", me.Work)
	}
	if len(me.Education) != 1 || me.Education[0].Org != "Example University" {
		t.Errorf("education: %+v", me.Education)
	}
	if strings.Join(me.Skills, "|") != "SQL|Python|Tableau" {
		t.Errorf("skills: %v", me.Skills)
	}
}

func TestEmptyListsOnAFreshStart(t *testing.T) {
	_, h := newServer(t)
	for _, p := range []string{"/api/roles", "/api/people", "/api/mail", "/api/talks", "/api/you", "/api/radar", "/api/today", "/api/progress", "/api/board", "/api/connections", "/api/app", "/api/arriving", "/api/activity", "/api/career"} {
		w := do(h, call{path: p})
		if w.Code != 200 {
			t.Errorf("%s: %d %s", p, w.Code, w.Body)
			continue
		}
		if strings.Contains(w.Body.String(), ":null") && p != "/api/arriving" && p != "/api/today" {
			t.Logf("%s still sends null somewhere: %.300s", p, w.Body)
		}
	}
}

// The role page says who the employer is; the person can put it in their own
// words, and those are what every later answer carries.
func TestEmployerDescriptionOnTheRolePage(t *testing.T) {
	srv, h := newServer(t)
	id, err := srv.E.AddRole("Northwind", "Finance Manager", "Toronto, ON", "", "Run the month-end close.", "manual")
	if err != nil {
		t.Fatal(err)
	}
	r, _ := srv.S.Role(id)
	path := "/api/companies/" + strconv.FormatInt(r.CompanyID, 10)
	if w := do(h, call{method: "PUT", path: path, marker: true, body: `{"about":"  A   grocery wholesaler <b>in</b> Ontario. "}`}); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w := do(h, call{path: "/api/roles/" + strconv.FormatInt(id, 10)})
	var got struct {
		Company struct {
			About     string `json:"about"`
			AboutFrom string `json:"about_from"`
		} `json:"company"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	if got.Company.About != "A grocery wholesaler <b>in</b> Ontario." || got.Company.AboutFrom != "you" {
		t.Fatalf("the role page should carry the person's wording, tidied but unchanged: %+v", got.Company)
	}
	// Emptying it lets Job Hunt describe the employer again.
	do(h, call{method: "PUT", path: path, marker: true, body: `{"about":""}`})
	if c, _ := srv.S.Company(r.CompanyID); c.About != "" || c.AboutFrom != "" {
		t.Fatalf("an emptied description should be open to filling again: %+v", c)
	}
}

// oldBackup builds a backup file the way the old Job Hunt wrote one: its
// database and the documents beside it.
func oldBackup(t *testing.T) []byte {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "jobhunt.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE jobs (id TEXT PRIMARY KEY, source TEXT, company TEXT, title TEXT, location TEXT, url TEXT, description TEXT, salary TEXT, posted_at TEXT, found_at TEXT, updated_at TEXT,
			status TEXT, score INTEGER, reasoning TEXT, red_flags TEXT, keywords TEXT, cv_path TEXT, letter_path TEXT, cover_letter TEXT, applied_at TEXT, notes TEXT)`,
		`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE events (id INTEGER PRIMARY KEY, job_id TEXT, kind TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL)`,
		`INSERT INTO kv VALUES ('profile', '{"name":"Sam Rivera","locations":["Toronto, ON"],"tracks":[{"name":"main","titles":["Tax Technology Manager"]}]}')`,
		`INSERT INTO jobs (id, source, company, title, location, description, found_at, updated_at, status, score, cv_path, cover_letter, applied_at) VALUES
			('linkedin:4012345678', 'linkedin', 'Maple Bank', 'Senior Tax Manager', 'Toronto, ON', 'Own the tax engine. <script>alert(1)</script>', '2026-09-01T10:00:00Z', '2026-09-03T10:00:00Z', 'applied', 82,
			 'C:\Users\sam\AppData\Local\Job Hunt\data\applications\maple-1\cv.docx', 'Dear Maple Bank.', '2026-09-02T09:00:00Z'),
			('indeed:1', 'indeed', 'Borealis', 'Tax Analyst', 'Toronto, ON', 'x', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z', 'dismissed', 40, '', '', '')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()
	raw, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("jobhunt.db")
	w.Write(raw)
	w, _ = zw.Create("applications/maple-1/cv.docx")
	w.Write([]byte("PK\x03\x04 the CV that was sent"))
	zw.Close()
	return buf.Bytes()
}

func TestBringOverTheOldJobHunt(t *testing.T) {
	srv, h := newServer(t)
	page := func(method, p, body string) *httptest.ResponseRecorder {
		return do(h, call{method: method, path: p, body: body, marker: true, site: "same-origin"})
	}

	// Nothing of the old app on this computer: the page is told so, without an error.
	if w := page("GET", "/api/import/old", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"found":false`) {
		t.Fatalf("look: %d %s", w.Code, w.Body)
	}
	// Not the old app's data: said in words.
	if w := page("POST", "/api/import/old?name=holiday.zip", "PK not a backup"); w.Code != 400 || !strings.Contains(w.Body.String(), "not the old Job Hunt") {
		t.Fatalf("junk: %d %s", w.Code, w.Body)
	}
	// A page from somewhere else cannot start it.
	if w := do(h, call{method: "POST", path: "/api/import/old", origin: "https://evil.example", body: `{"path":"/"}`, marker: true}); w.Code == 200 {
		t.Fatal("another site started an import")
	}

	w := page("POST", "/api/import/old?name=Job+Hunt+backup.zip", string(oldBackup(t)))
	if w.Code != 200 {
		t.Fatalf("import: %d %s", w.Code, w.Body)
	}
	var res engine.OldResult
	json.Unmarshal(w.Body.Bytes(), &res)
	if res.Roles != 2 || res.Applied != 1 || res.NotInterested != 1 || res.Where != "Job Hunt backup.zip" {
		t.Fatalf("result = %+v", res)
	}
	if left, _ := os.ReadDir(filepath.Join(srv.E.Dir, "tmp")); len(left) != 0 {
		t.Errorf("the uploaded backup was left on disk: %v", left)
	}

	id, _, ok := srv.S.SeenRole("linkedin:4012345678")
	if !ok {
		t.Fatal("the applied role did not come over")
	}
	detail := page("GET", "/api/roles/"+strconv.FormatInt(id, 10), "")
	if !strings.Contains(detail.Body.String(), `"old_cv":`) || !strings.Contains(detail.Body.String(), "Dear Maple Bank.") {
		t.Fatalf("the role does not show what was sent: %s", detail.Body)
	}
	file := page("GET", "/api/roles/"+strconv.FormatInt(id, 10)+"/old-cv", "")
	if file.Code != 200 || !strings.HasPrefix(file.Body.String(), "PK") || !strings.Contains(file.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("old CV download: %d %q", file.Code, file.Header())
	}
	// The role that was dismissed is closed for good, and is not among the open roles.
	if _, closed, ok := srv.S.SeenRole("old:indeed:1"); !ok || closed != "no" {
		t.Fatalf("the dismissed role: ok=%v closed=%q", ok, closed)
	}
	if look := page("GET", "/api/import/old", ""); !strings.Contains(look.Body.String(), `"last":`) {
		t.Fatalf("the last run is not shown: %s", look.Body)
	}
}
