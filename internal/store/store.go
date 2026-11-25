// Package store is everything Job Hunt remembers, in one SQLite file.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"jobhunt/internal/trace"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// Store is safe for use from many goroutines.
type Store struct {
	db   *sql.DB
	path string

	mu   sync.Mutex
	subs map[chan string]struct{}

	// Now is the clock; tests replace it.
	Now func() time.Time
}

// The schema only ever grows: add a new entry, never edit an old one.
var migrations = []string{
	`
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE cvs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  original BLOB,
  text TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '{}',
  focus TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE facts (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'you',
  created_at INTEGER NOT NULL
);

CREATE TABLE answers (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  norm TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL DEFAULT '',
  board_kind TEXT NOT NULL DEFAULT '',
  board_token TEXT NOT NULL DEFAULT '',
  board_checked_at INTEGER NOT NULL DEFAULT 0,
  board_note TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'following',
  source TEXT NOT NULL DEFAULT 'you',
  plan TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE signals (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX signals_company ON signals(company_id, at DESC);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  workplace TEXT NOT NULL DEFAULT '',
  pay TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  posted_at INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  gone_at INTEGER NOT NULL DEFAULT 0,
  applicants INTEGER NOT NULL DEFAULT -1,
  band TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'new',
  stage_at INTEGER NOT NULL,
  closed TEXT NOT NULL DEFAULT '',
  closed_why TEXT NOT NULL DEFAULT '',
  fit INTEGER NOT NULL DEFAULT -1,
  fit_tailored INTEGER NOT NULL DEFAULT -1,
  reading TEXT NOT NULL DEFAULT '{}',
  saved INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0,
  applied_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX roles_open ON roles(closed, stage, fit DESC);
CREATE INDEX roles_company ON roles(company_id);

CREATE TABLE docs (
  id INTEGER PRIMARY KEY,
  role_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(role_id, kind)
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  email_sure TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'you',
  state TEXT NOT NULL DEFAULT 'new',
  knows_you_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX people_company ON people(company_id);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'linkedin',
  purpose TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT 0,
  replied_at INTEGER NOT NULL DEFAULT 0,
  nudge_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notes_person ON notes(person_id);

CREATE TABLE talks (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL DEFAULT 0,
  role_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'chat',
  title TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 30,
  link TEXT NOT NULL DEFAULT '',
  prep TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX talks_at ON talks(at);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  answer TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 0,
  asked_at INTEGER NOT NULL,
  answered_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  role_id INTEGER NOT NULL DEFAULT 0,
  company_id INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX activity_at ON activity(at DESC);
CREATE INDEX activity_role ON activity(role_id, at);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'running',
  stats TEXT NOT NULL DEFAULT '{}',
  log TEXT NOT NULL DEFAULT ''
);

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  task TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_cached INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX llm_calls_at ON llm_calls(at);

CREATE TABLE changes (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  what TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  before TEXT NOT NULL DEFAULT '',
  after TEXT NOT NULL DEFAULT '',
  undone_at INTEGER NOT NULL DEFAULT 0
);
`,
	`
CREATE TABLE mails (
  id INTEGER PRIMARY KEY,
  msg_id TEXT NOT NULL UNIQUE,
  from_name TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  role_id INTEGER NOT NULL DEFAULT 0,
  company_id INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  next TEXT NOT NULL DEFAULT '',
  draft TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);
CREATE INDEX mails_at ON mails(at DESC);
`,
	`
CREATE TABLE chat (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  who TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE chat_files (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  data BLOB
);
CREATE INDEX chat_files_chat ON chat_files(chat_id);
`,
	// 4: what an employer does, in a sentence or two, and where that came from
	// ("posting", "claude", "you", or "unknown" when asked and nobody could say).
	`
ALTER TABLE companies ADD COLUMN about TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN about_from TEXT NOT NULL DEFAULT '';
`,
	// 5: a role the person saved for later stays off Today until this moment.
	`
ALTER TABLE roles ADD COLUMN later_until INTEGER NOT NULL DEFAULT 0;
`,
	// 6: leads (hiring posts, funding and growth news, ones the person pasted
	// in), and every place a role was seen through, for the overlap between sources.
	`
CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'post',
  source TEXT NOT NULL DEFAULT 'you',
  company TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  author_title TEXT NOT NULL DEFAULT '',
  author_url TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  fit INTEGER NOT NULL DEFAULT -1,
  reading TEXT NOT NULL DEFAULT '{}',
  read_at INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open',
  sent_at INTEGER NOT NULL DEFAULT 0,
  followed_at INTEGER NOT NULL DEFAULT 0,
  replied_at INTEGER NOT NULL DEFAULT 0,
  role_id INTEGER NOT NULL DEFAULT 0,
  company_id INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER NOT NULL DEFAULT 0,
  found_at INTEGER NOT NULL
);
CREATE INDEX leads_state ON leads(state, fit DESC);

CREATE TABLE role_seen (
  role_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (role_id, source)
);
`,
	// 7: a person's phone number, as their e-mail signature gives it.
	`
ALTER TABLE people ADD COLUMN phone TEXT NOT NULL DEFAULT '';
`,
}

// Open opens (creating and upgrading if needed) the database at path.
// ":memory:" gives a private database for tests.
func Open(path string) (*Store, error) {
	dsn := path
	if path == ":memory:" {
		dsn = "file:jh" + fmt.Sprint(time.Now().UnixNano()) + "?mode=memory&cache=shared"
	} else {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, err
		}
		dsn = "file:" + filepath.ToSlash(path)
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	dsn += sep + "_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if path == ":memory:" {
		db.SetMaxOpenConns(1)
	}
	s := &Store{db: db, path: path, subs: map[chan string]struct{}{}, Now: time.Now}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Path() string { return s.path }

func (s *Store) migrate() error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v > len(migrations) {
		return fmt.Errorf("this data was written by a newer Job Hunt (version %d, this app knows %d)", v, len(migrations))
	}
	for i := v; i < len(migrations); i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("upgrade step %d: %w", i+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// Backup writes a consistent copy of the whole database to dst.
func (s *Store) Backup(dst string) error {
	os.Remove(dst)
	_, err := s.db.Exec(`VACUUM INTO ?`, dst)
	return err
}

// Check says whether the file at path is a whole Job Hunt database this
// program can open: used before a saved copy is put back. The file is only
// read.
func Check(path string) error {
	head := make([]byte, 16)
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	_, err = io.ReadFull(f, head)
	f.Close()
	if err != nil || string(head) != "SQLite format 3\x00" {
		return errors.New("that file is not a Job Hunt copy")
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return err
	}
	defer db.Close()
	var ok string
	if err := db.QueryRow(`PRAGMA quick_check`).Scan(&ok); err != nil || ok != "ok" {
		return errors.New("that copy is damaged and can't be put back")
	}
	var v, n int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v > len(migrations) {
		return errors.New("that copy was saved by a newer Job Hunt than this one")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('kv', 'roles', 'cvs')`).Scan(&n); err != nil || n != 3 {
		return errors.New("that file is not a Job Hunt copy")
	}
	return nil
}

func (s *Store) now() int64 { return s.Now().Unix() }

// ---- change notifications --------------------------------------------------

// Subscribe returns a channel of topic names ("roles", "today", ...) that
// changed, and a function to stop listening.
func (s *Store) Subscribe() (<-chan string, func()) {
	ch := make(chan string, 64)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

// Changed tells listeners that something under a topic changed.
func (s *Store) Changed(topics ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs {
		for _, t := range topics {
			select {
			case ch <- t:
			default: // a slow listener misses a tick; it refetches on the next one
			}
		}
	}
}

// ---- small helpers ---------------------------------------------------------

var ErrNotFound = errors.New("not found")

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func raw(s string) json.RawMessage {
	if s == "" {
		return json.RawMessage("{}")
	}
	return json.RawMessage(s)
}

func rawStr(r json.RawMessage, empty string) string {
	if len(r) == 0 {
		return empty
	}
	return string(r)
}

// ---- key/value -------------------------------------------------------------

// Get reads a stored value into out. It reports whether the key existed.
func (s *Store) Get(key string, out any) (bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT v FROM kv WHERE k = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(v), out)
}

// Set stores a value under a key.
func (s *Store) Set(key string, val any) error {
	b, err := json.Marshal(val)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, key, string(b))
	return err
}

func (s *Store) GetString(key string) string {
	var v string
	s.Get(key, &v)
	return v
}

func (s *Store) GetInt(key string) int64 {
	var v int64
	s.Get(key, &v)
	return v
}

// ---- the person ------------------------------------------------------------

type Titles struct {
	Level    []string `json:"level"`
	StepUp   []string `json:"step_up"`
	Sideways []string `json:"sideways"`
}

// All returns every title with its band, step-up first-class alongside level.
func (t Titles) All() []BandTitle {
	var out []BandTitle
	for _, x := range t.Level {
		out = append(out, BandTitle{x, "level"})
	}
	for _, x := range t.StepUp {
		out = append(out, BandTitle{x, "step_up"})
	}
	for _, x := range t.Sideways {
		out = append(out, BandTitle{x, "sideways"})
	}
	return out
}

type BandTitle struct{ Title, Band string }

// Profile is who the person is and what they want.
type Profile struct {
	Name      string   `json:"name"`
	Headline  string   `json:"headline"`
	Summary   string   `json:"summary"`
	Years     int      `json:"years"`
	Strengths []string `json:"strengths"`
	Rare      string   `json:"rare"` // the one thing few other applicants have

	Home       string   `json:"home"`        // where they live now
	City       string   `json:"city"`        // where they want to work
	Places     []string `json:"places"`      // other towns they count as the same place
	Country    string   `json:"country"`     // country of City
	ArriveOn   string   `json:"arrive_on"`   // YYYY-MM-DD, "" if already there
	WorkStatus string   `json:"work_status"` // "", "citizen", "resident", "permit", "none"
	StartEarly bool     `json:"start_early"` // open to starting remotely before arriving

	Titles     Titles   `json:"titles"`
	Domain     []string `json:"domain"` // words nearly every wanted job has in its title
	Avoid      []string `json:"avoid"`
	Workplaces []string `json:"workplaces"` // any of remote, hybrid, onsite; empty = all
	PayFloor   int      `json:"pay_floor"`
	PayUnit    string   `json:"pay_unit"`
	// Hard limits: a posting that breaks one is set aside without being read.
	PayStrict  bool     `json:"pay_strict"`   // set aside roles whose stated pay tops out under the floor
	MaxAgeDays int      `json:"max_age_days"` // set aside postings older than this; 0 = any age
	NoTypes    []string `json:"no_types"`     // any of "contract", "part-time", "internship"

	// How far Job Hunt may go on its own in each area: "ask", "do".
	MayPrepare string `json:"may_prepare"`
	MayApply   string `json:"may_apply"`

	// How letters are written and signed.
	LetterStyle string `json:"letter_style"` // "standard", "formal", "short", "warm"
	Signature   string `json:"signature"`    // the person's own closing, a line each; "" for "Sincerely," and the name
	// Days after applying, with no reply, before Today suggests a follow-up.
	// 0 = never. Not set = 8.
	ChaseDays *int `json:"chase_days"`
	// Applications the person aims to send each week. 0 = no goal. Not set = 10.
	WeeklyGoal *int `json:"weekly_goal"`

	// The fit a role needs to be kept at all. Not set = 55.
	KeepFit *int `json:"keep_fit"`
	// The fit from which the CV and letter are written without asking
	// (when MayPrepare allows). Not set = 70.
	PrepareFit *int `json:"prepare_fit"`
	// The most roles one search prepares by itself; 0 = no limit. The
	// rest wait on Today with a Prepare button.
	PrepareMax int `json:"prepare_max"`
	// How long a LinkedIn connection note may be on the person's account:
	// 300 characters, or 200 on a free account. Not set = 300.
	NoteChars int `json:"note_chars,omitempty"`
	// What matters to the person in a job, in their own words. Claude
	// weighs it when it reads a role.
	Matters   string `json:"matters"`
	SetupDone bool   `json:"setup_done"`

	// What the person wants, which Claude weighs when it reads a role (none
	// of it sets a posting aside before it is read; the hard limits do that).
	Seniority    string   `json:"seniority,omitempty"`     // one of Seniorities; "" = not said
	Terms        string   `json:"terms,omitempty"`         // "permanent", "contract"; "" = either
	Industries   []string `json:"industries,omitempty"`    // industries they want
	NoIndustries []string `json:"no_industries,omitempty"` // industries they do not want
	DealBreakers []string `json:"deal_breakers,omitempty"` // things that rule a role out, in their words
	CareerPath   string   `json:"career_path,omitempty"`   // where they want their career to go; roles are tagged on or off it
}

// Seniorities are the levels a person can say they want, lowest first.
var Seniorities = []string{"mid", "senior", "lead", "manager", "director", "executive"}

// WantsSomething reports whether the person said anything under what they want.
func (p Profile) WantsSomething() bool {
	return p.Seniority != "" || p.Terms != "" || len(p.Industries) > 0 || len(p.NoIndustries) > 0 || len(p.DealBreakers) > 0 || p.CareerPath != ""
}

// Keep is the fit a role needs to be kept.
func (p Profile) Keep() int {
	if p.KeepFit == nil {
		return 55
	}
	return min(max(*p.KeepFit, 30), 95)
}

// PrepareAt is the fit from which documents are written without asking.
func (p Profile) PrepareAt() int {
	at := 70
	if p.PrepareFit != nil {
		at = min(max(*p.PrepareFit, 30), 100)
	}
	return max(at, p.Keep())
}

// NoteLimit is how many characters a LinkedIn connection note may have.
func (p Profile) NoteLimit() int {
	if p.NoteChars == 200 {
		return 200
	}
	return 300
}

// LetterStyles are the ways a cover letter can be written; the first is the usual one.
var LetterStyles = []string{"standard", "formal", "short", "warm"}

// KnownLetterStyle reports whether s names a letter style.
func KnownLetterStyle(s string) bool {
	for _, x := range LetterStyles {
		if x == s {
			return true
		}
	}
	return false
}

const (
	defaultChaseDays  = 8
	defaultWeeklyGoal = 10
)

func (s *Store) Profile() Profile {
	var p Profile
	s.Get("profile", &p)
	if p.MayPrepare == "" {
		p.MayPrepare = "do"
	}
	if p.MayApply == "" {
		p.MayApply = "ask"
	}
	if !KnownLetterStyle(p.LetterStyle) {
		p.LetterStyle = LetterStyles[0]
	}
	if p.ChaseDays == nil || *p.ChaseDays < 0 {
		n := defaultChaseDays
		p.ChaseDays = &n
	}
	if p.WeeklyGoal == nil || *p.WeeklyGoal < 0 {
		n := defaultWeeklyGoal
		p.WeeklyGoal = &n
	}
	return p
}

// ChaseAfter is how many days of silence after applying before a follow-up
// is suggested; 0 means never.
func (p Profile) ChaseAfter() int {
	if p.ChaseDays == nil {
		return defaultChaseDays
	}
	return max(*p.ChaseDays, 0)
}

// Goal is how many applications a week the person aims for; 0 means no goal.
func (p Profile) Goal() int {
	if p.WeeklyGoal == nil {
		return defaultWeeklyGoal
	}
	return max(*p.WeeklyGoal, 0)
}

func (s *Store) SaveProfile(p Profile) error {
	if err := s.Set("profile", p); err != nil {
		return err
	}
	s.Changed("profile", "today")
	return nil
}

// Relocating reports whether the person has not arrived yet, and the days left.
func (p Profile) Relocating(now time.Time) (bool, int) {
	if p.ArriveOn == "" {
		return false, 0
	}
	t, err := time.Parse("2006-01-02", p.ArriveOn)
	if err != nil {
		return false, 0
	}
	d := int(t.Sub(now).Hours()/24 + 0.999)
	return d > 0, d
}

// ---- CVs -------------------------------------------------------------------

type CV struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Filename  string          `json:"filename"`
	Text      string          `json:"text,omitempty"`
	Model     json.RawMessage `json:"model,omitempty"`
	Focus     string          `json:"focus"`
	CreatedAt int64           `json:"created_at"`
	// What the person set for this CV (kept under "cvset:<id>", filled in by
	// the engine): the titles and words it is meant for, and its letter style.
	Titles      []string `json:"titles,omitempty"`
	Keywords    []string `json:"keywords,omitempty"`
	LetterStyle string   `json:"letter_style,omitempty"`
}

// ReplaceCVFile puts a new file in place of a CV's old one, keeping its
// name and what the person set for it.
func (s *Store) ReplaceCVFile(id int64, filename string, original []byte, text string, model []byte) error {
	res, err := s.db.Exec(`UPDATE cvs SET filename = ?, original = ?, text = ?, model = ? WHERE id = ?`, filename, original, text, rawStr(model, "{}"), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	s.Changed("you")
	return nil
}

func (s *Store) AddCV(c CV, original []byte) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO cvs(name, filename, original, text, model, focus, created_at) VALUES(?,?,?,?,?,?,?)`,
		c.Name, c.Filename, original, c.Text, rawStr(c.Model, "{}"), c.Focus, s.now())
	if err != nil {
		return 0, err
	}
	s.Changed("you")
	return res.LastInsertId()
}

func (s *Store) UpdateCV(c CV) error {
	_, err := s.db.Exec(`UPDATE cvs SET name = ?, text = ?, model = ?, focus = ? WHERE id = ?`, c.Name, c.Text, rawStr(c.Model, "{}"), c.Focus, c.ID)
	s.Changed("you")
	return err
}

func (s *Store) DeleteCV(id int64) error {
	_, err := s.db.Exec(`DELETE FROM cvs WHERE id = ?`, id)
	s.Changed("you")
	return err
}

func (s *Store) CVs() ([]CV, error) {
	rows, err := s.db.Query(`SELECT id, name, filename, text, model, focus, created_at FROM cvs ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CV
	for rows.Next() {
		var c CV
		var model string
		if err := rows.Scan(&c.ID, &c.Name, &c.Filename, &c.Text, &model, &c.Focus, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.Model = raw(model)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CV(id int64) (CV, error) {
	var c CV
	var model string
	err := s.db.QueryRow(`SELECT id, name, filename, text, model, focus, created_at FROM cvs WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.Filename, &c.Text, &model, &c.Focus, &c.CreatedAt)
	c.Model = raw(model)
	return c, notFound(err)
}

func (s *Store) CVOriginal(id int64) (filename string, data []byte, err error) {
	err = s.db.QueryRow(`SELECT filename, original FROM cvs WHERE id = ?`, id).Scan(&filename, &data)
	return filename, data, notFound(err)
}

// ---- facts and answers -----------------------------------------------------

type Fact struct {
	ID        int64  `json:"id"`
	Text      string `json:"text"`
	Source    string `json:"source"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) AddFact(text, source string) (int64, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, errors.New("empty fact")
	}
	res, err := s.db.Exec(`INSERT INTO facts(text, source, created_at) VALUES(?,?,?)`, text, source, s.now())
	if err != nil {
		return 0, err
	}
	s.Changed("you")
	return res.LastInsertId()
}

func (s *Store) DeleteFact(id int64) error {
	_, err := s.db.Exec(`DELETE FROM facts WHERE id = ?`, id)
	s.Changed("you")
	return err
}

func (s *Store) Facts() ([]Fact, error) {
	rows, err := s.db.Query(`SELECT id, text, source, created_at FROM facts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Fact
	for rows.Next() {
		var f Fact
		if err := rows.Scan(&f.ID, &f.Text, &f.Source, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Answer is something an application form asked, answered once and reused.
type Answer struct {
	ID        int64  `json:"id"`
	Key       string `json:"key"`
	Question  string `json:"question"`
	Answer    string `json:"answer"`
	UpdatedAt int64  `json:"updated_at"`
}

// QuestionKey reduces a form question to its essence so the same question
// worded slightly differently finds the same answer.
func QuestionKey(q string) string {
	q = strings.ToLower(q)
	var b strings.Builder
	space := false
	for _, r := range q {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
		default:
			space = true
		}
	}
	words := strings.Fields(b.String())
	stop := map[string]bool{"the": true, "a": true, "an": true, "your": true, "you": true, "please": true, "do": true, "are": true, "is": true, "of": true, "to": true, "in": true, "for": true, "what": true, "s": true, "if": true, "any": true, "or": true, "and": true, "be": true, "will": true, "would": true, "have": true}
	var keep []string
	for _, w := range words {
		if !stop[w] {
			keep = append(keep, w)
		}
	}
	if len(keep) > 12 {
		keep = keep[:12]
	}
	return strings.Join(keep, " ")
}

func (s *Store) SaveAnswer(question, answer string) error {
	key := QuestionKey(question)
	if key == "" {
		return errors.New("empty question")
	}
	_, err := s.db.Exec(`INSERT INTO answers(key, question, answer, updated_at) VALUES(?,?,?,?)
		ON CONFLICT(key) DO UPDATE SET answer = excluded.answer, question = excluded.question, updated_at = excluded.updated_at`,
		key, strings.TrimSpace(question), strings.TrimSpace(answer), s.now())
	s.Changed("you")
	return err
}

func (s *Store) DeleteAnswer(id int64) error {
	_, err := s.db.Exec(`DELETE FROM answers WHERE id = ?`, id)
	s.Changed("you")
	return err
}

func (s *Store) Answers() ([]Answer, error) {
	rows, err := s.db.Query(`SELECT id, key, question, answer, updated_at FROM answers ORDER BY question`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Answer
	for rows.Next() {
		var a Answer
		if err := rows.Scan(&a.ID, &a.Key, &a.Question, &a.Answer, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ---- questions Job Hunt needs answered --------------------------------------

type Question struct {
	ID         int64    `json:"id"`
	Key        string   `json:"key"`
	Text       string   `json:"text"`
	Why        string   `json:"why"`
	Options    []string `json:"options"`
	Answer     string   `json:"answer"`
	Weight     int      `json:"weight"`
	AskedAt    int64    `json:"asked_at"`
	AnsweredAt int64    `json:"answered_at"`
}

// Ask queues a question once; asking the same key again does nothing.
func (s *Store) Ask(q Question) error {
	opts, _ := json.Marshal(q.Options)
	if q.Options == nil {
		opts = []byte("[]")
	}
	_, err := s.db.Exec(`INSERT INTO questions(key, text, why, options, weight, asked_at) VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING`,
		q.Key, q.Text, q.Why, string(opts), q.Weight, s.now())
	s.Changed("today")
	return err
}

func (s *Store) scanQuestions(query string, args ...any) ([]Question, error) {
	rows, err := s.db.Query(`SELECT id, key, text, why, options, answer, weight, asked_at, answered_at FROM questions `+query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Question
	for rows.Next() {
		var q Question
		var opts string
		if err := rows.Scan(&q.ID, &q.Key, &q.Text, &q.Why, &opts, &q.Answer, &q.Weight, &q.AskedAt, &q.AnsweredAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(opts), &q.Options)
		out = append(out, q)
	}
	return out, rows.Err()
}

func (s *Store) OpenQuestions() ([]Question, error) {
	return s.scanQuestions(`WHERE answered_at = 0 ORDER BY weight DESC, id`)
}

func (s *Store) Question(id int64) (Question, error) {
	qs, err := s.scanQuestions(`WHERE id = ?`, id)
	if err != nil {
		return Question{}, err
	}
	if len(qs) == 0 {
		return Question{}, ErrNotFound
	}
	return qs[0], nil
}

func (s *Store) AnswerQuestion(id int64, answer string) error {
	_, err := s.db.Exec(`UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?`, answer, s.now(), id)
	s.Changed("today")
	return err
}

// ---- activity --------------------------------------------------------------

type Activity struct {
	ID        int64  `json:"id"`
	At        int64  `json:"at"`
	Kind      string `json:"kind"`
	Text      string `json:"text"`
	RoleID    int64  `json:"role_id,omitempty"`
	CompanyID int64  `json:"company_id,omitempty"`
	PersonID  int64  `json:"person_id,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

// Log records one thing that happened, in words a person would use.
func (s *Store) Log(a Activity) {
	if a.At == 0 {
		a.At = s.now()
	}
	s.db.Exec(`INSERT INTO activity(at, kind, text, role_id, company_id, person_id, detail) VALUES(?,?,?,?,?,?,?)`,
		a.At, a.Kind, a.Text, a.RoleID, a.CompanyID, a.PersonID, a.Detail)
	area := "did"
	if a.Kind == "problem" {
		area = "problem"
	}
	trace.Log(area, "[%s] %s %s", a.Kind, a.Text, a.Detail)
	s.Changed("activity")
}

type ActivityFilter struct {
	RoleID, CompanyID, PersonID int64
	Since                       int64
	Kinds                       []string
	Limit                       int
}

func (s *Store) ActivityList(f ActivityFilter) ([]Activity, error) {
	q := `SELECT id, at, kind, text, role_id, company_id, person_id, detail FROM activity WHERE 1=1`
	var args []any
	if f.RoleID != 0 {
		q += ` AND role_id = ?`
		args = append(args, f.RoleID)
	}
	if f.CompanyID != 0 {
		q += ` AND company_id = ?`
		args = append(args, f.CompanyID)
	}
	if f.PersonID != 0 {
		q += ` AND person_id = ?`
		args = append(args, f.PersonID)
	}
	if f.Since != 0 {
		q += ` AND at >= ?`
		args = append(args, f.Since)
	}
	if len(f.Kinds) > 0 {
		q += ` AND kind IN (` + strings.TrimRight(strings.Repeat("?,", len(f.Kinds)), ",") + `)`
		for _, k := range f.Kinds {
			args = append(args, k)
		}
	}
	q += ` ORDER BY at DESC, id DESC`
	if f.Limit <= 0 {
		f.Limit = 200
	}
	q += fmt.Sprintf(` LIMIT %d`, f.Limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Activity
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.At, &a.Kind, &a.Text, &a.RoleID, &a.CompanyID, &a.PersonID, &a.Detail); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ---- runs (searches and other background work) ------------------------------

type Run struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	StartedAt int64           `json:"started_at"`
	EndedAt   int64           `json:"ended_at"`
	State     string          `json:"state"`
	Stats     json.RawMessage `json:"stats"`
	Log       string          `json:"log,omitempty"`
}

func (s *Store) StartRun(kind string) int64 {
	res, err := s.db.Exec(`INSERT INTO runs(kind, started_at) VALUES(?, ?)`, kind, s.now())
	if err != nil {
		return 0
	}
	id, _ := res.LastInsertId()
	s.Changed("runs")
	return id
}

func (s *Store) EndRun(id int64, state string, stats any, log string) {
	b, _ := json.Marshal(stats)
	s.db.Exec(`UPDATE runs SET ended_at = ?, state = ?, stats = ?, log = ? WHERE id = ?`, s.now(), state, string(b), log, id)
	trace.Log("search", "run %d ended %s: %s %s", id, state, b, log)
	s.Changed("runs")
}

// CloseStaleRuns marks runs left "running" by a previous start of the app.
func (s *Store) CloseStaleRuns() {
	s.db.Exec(`UPDATE runs SET state = 'stopped', ended_at = ? WHERE state = 'running'`, s.now())
}

func (s *Store) Runs(kind string, limit int) ([]Run, error) {
	q := `SELECT id, kind, started_at, ended_at, state, stats, log FROM runs`
	var args []any
	if kind != "" {
		q += ` WHERE kind = ?`
		args = append(args, kind)
	}
	q += fmt.Sprintf(` ORDER BY id DESC LIMIT %d`, max(limit, 1))
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		var r Run
		var stats string
		if err := rows.Scan(&r.ID, &r.Kind, &r.StartedAt, &r.EndedAt, &r.State, &stats, &r.Log); err != nil {
			return nil, err
		}
		r.Stats = raw(stats)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---- Claude usage ----------------------------------------------------------

type Call struct {
	At           int64   `json:"at"`
	Task         string  `json:"task"`
	Engine       string  `json:"engine"`
	Model        string  `json:"model"`
	TokensIn     int64   `json:"tokens_in"`
	TokensOut    int64   `json:"tokens_out"`
	TokensCached int64   `json:"tokens_cached"`
	Cost         float64 `json:"cost"`
	Ms           int64   `json:"ms"`
	Error        string  `json:"error,omitempty"`
}

func (s *Store) LogCall(c Call) {
	if c.At == 0 {
		c.At = s.now()
	}
	s.db.Exec(`INSERT INTO llm_calls(at, task, engine, model, tokens_in, tokens_out, tokens_cached, cost, ms, error) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		c.At, c.Task, c.Engine, c.Model, c.TokensIn, c.TokensOut, c.TokensCached, c.Cost, c.Ms, c.Error)
	trace.Log("claude", "%s via %s %s: %dms, %d in, %d out, %d cached %s", c.Task, c.Engine, c.Model, c.Ms, c.TokensIn, c.TokensOut, c.TokensCached, c.Error)
}

type Usage struct {
	Calls  int     `json:"calls"`
	Cost   float64 `json:"cost"`
	Errors int     `json:"errors"`
}

func (s *Store) UsageSince(since int64) Usage {
	var u Usage
	s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(cost),0), COALESCE(SUM(error != ''),0) FROM llm_calls WHERE at >= ?`, since).Scan(&u.Calls, &u.Cost, &u.Errors)
	return u
}

func (s *Store) UsageByTask(since int64) (map[string]Usage, error) {
	rows, err := s.db.Query(`SELECT task, COUNT(*), COALESCE(SUM(cost),0), COALESCE(SUM(error != ''),0) FROM llm_calls WHERE at >= ? GROUP BY task`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Usage{}
	for rows.Next() {
		var t string
		var u Usage
		if err := rows.Scan(&t, &u.Calls, &u.Cost, &u.Errors); err != nil {
			return nil, err
		}
		out[t] = u
	}
	return out, rows.Err()
}

func (s *Store) LastCalls(limit int) ([]Call, error) {
	rows, err := s.db.Query(`SELECT at, task, engine, model, tokens_in, tokens_out, tokens_cached, cost, ms, error FROM llm_calls ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Call
	for rows.Next() {
		var c Call
		if err := rows.Scan(&c.At, &c.Task, &c.Engine, &c.Model, &c.TokensIn, &c.TokensOut, &c.TokensCached, &c.Cost, &c.Ms, &c.Error); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---- changes Job Hunt made to its own settings, each undoable ---------------

type Change struct {
	ID       int64  `json:"id"`
	At       int64  `json:"at"`
	What     string `json:"what"`
	Why      string `json:"why"`
	Key      string `json:"key"`
	Before   string `json:"before"`
	After    string `json:"after"`
	UndoneAt int64  `json:"undone_at"`
}

func (s *Store) RecordChange(c Change) {
	s.db.Exec(`INSERT INTO changes(at, what, why, key, before, after) VALUES(?,?,?,?,?,?)`, s.now(), c.What, c.Why, c.Key, c.Before, c.After)
	s.Changed("progress")
}

func (s *Store) Changes(limit int) ([]Change, error) {
	rows, err := s.db.Query(`SELECT id, at, what, why, key, before, after, undone_at FROM changes ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Change
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.ID, &c.At, &c.What, &c.Why, &c.Key, &c.Before, &c.After, &c.UndoneAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) ChangeByID(id int64) (Change, error) {
	var c Change
	err := s.db.QueryRow(`SELECT id, at, what, why, key, before, after, undone_at FROM changes WHERE id = ?`, id).
		Scan(&c.ID, &c.At, &c.What, &c.Why, &c.Key, &c.Before, &c.After, &c.UndoneAt)
	return c, notFound(err)
}

func (s *Store) MarkChangeUndone(id int64) {
	s.db.Exec(`UPDATE changes SET undone_at = ? WHERE id = ?`, s.now(), id)
	s.Changed("progress")
}

// Tx runs fn in a transaction.
func (s *Store) Tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
