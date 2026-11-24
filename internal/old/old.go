// Package old reads what the previous Job Hunt (the Windows app, releases up
// to 26.11.21) kept, so the new one can start from it. It reads from the old
// app's data folder or from one of its backup files, and it only ever reads:
// the database is copied aside first, so the old app's own files are never
// opened for writing, locked or changed.
package old

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotOld means the file or folder is not the old Job Hunt's data.
var ErrNotOld = errors.New("that is not the old Job Hunt's data: it should be its data folder, its jobhunt.db file, or a backup .zip it made")

// Default returns where the old app keeps its data on this computer, or ""
// when it was never installed here. JOBHUNT_OLD names another place.
func Default() string {
	var tries []string
	if p := os.Getenv("JOBHUNT_OLD"); p != "" {
		tries = append(tries, p)
	}
	if runtime.GOOS == "windows" {
		if l := os.Getenv("LOCALAPPDATA"); l != "" {
			tries = append(tries, filepath.Join(l, "Job Hunt", "data"))
		}
	}
	for _, t := range tries {
		if st, err := os.Stat(filepath.Join(t, "jobhunt.db")); err == nil && !st.IsDir() {
			return t
		}
		if st, err := os.Stat(t); err == nil && !st.IsDir() {
			return t
		}
	}
	return ""
}

// Source is the old app's data, opened for reading.
type Source struct {
	Where string // what the person would call it: the folder or file

	db   *sql.DB
	tmp  string
	dirs []string        // folders that may hold "cv/" and "applications/"
	zip  *zip.ReadCloser // or the backup they are in
	cols map[string]map[string]bool
}

// Open opens the old data at path: the data folder, a jobhunt.db file, or a
// backup .zip. scratch is a folder for the working copy of the database.
func Open(p, scratch string) (*Source, error) {
	st, err := os.Stat(p)
	if err != nil {
		return nil, fmt.Errorf("can't open %s: %w", p, err)
	}
	if err := os.MkdirAll(scratch, 0o700); err != nil {
		return nil, err
	}
	tmp, err := os.MkdirTemp(scratch, "old-")
	if err != nil {
		return nil, err
	}
	s := &Source{Where: p, tmp: tmp, cols: map[string]map[string]bool{}}
	fail := func(err error) (*Source, error) { s.Close(); return nil, err }
	work := filepath.Join(tmp, "jobhunt.db")

	switch {
	case st.IsDir():
		if err := copyFile(filepath.Join(p, "jobhunt.db"), work); err != nil {
			return fail(ErrNotOld)
		}
		// What the old app had not yet folded into the main file.
		for _, ext := range []string{"-wal", "-shm"} {
			copyFile(filepath.Join(p, "jobhunt.db"+ext), work+ext)
		}
		s.dirs = []string{p}
		// The old app could keep its documents in a folder the person chose.
		if b, err := os.ReadFile(filepath.Join(p, "files-folder.txt")); err == nil {
			if d := strings.TrimSpace(string(b)); d != "" {
				s.dirs = append([]string{d}, s.dirs...)
			}
		}
	case isZip(p):
		z, err := zip.OpenReader(p)
		if err != nil {
			return fail(ErrNotOld)
		}
		s.zip = z
		f, err := z.Open("jobhunt.db")
		if err != nil {
			return fail(ErrNotOld)
		}
		out, err := os.Create(work)
		if err == nil {
			_, err = io.Copy(out, io.LimitReader(f, 2<<30))
			out.Close()
		}
		f.Close()
		if err != nil {
			return fail(err)
		}
	default:
		if err := copyFile(p, work); err != nil {
			return fail(err)
		}
		for _, ext := range []string{"-wal", "-shm"} {
			copyFile(p+ext, work+ext)
		}
		s.dirs = []string{filepath.Dir(p)}
	}

	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(work)+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return fail(err)
	}
	s.db = db
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('jobs', 'kv', 'events')`).Scan(&n); err != nil || n < 3 {
		return fail(ErrNotOld)
	}
	return s, nil
}

func isZip(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	var head [4]byte
	_, err = io.ReadFull(f, head[:])
	return err == nil && string(head[:2]) == "PK"
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// Close lets go of the working copy.
func (s *Source) Close() {
	if s.db != nil {
		s.db.Close()
	}
	if s.zip != nil {
		s.zip.Close()
	}
	if s.tmp != "" {
		os.RemoveAll(s.tmp)
	}
}

// has reports whether a table has a column; the old app added some over time.
func (s *Source) has(table, col string) bool {
	if s.cols[table] == nil {
		s.cols[table] = map[string]bool{}
		rows, err := s.db.Query(`SELECT name FROM pragma_table_info(?)`, table)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var n string
				rows.Scan(&n)
				s.cols[table][n] = true
			}
		}
	}
	return s.cols[table][col]
}

// col is a column to select, or an empty text when this database is too old to have it.
func (s *Source) col(table, name string) string {
	if s.has(table, name) {
		return "COALESCE(" + name + ", '')"
	}
	return "''"
}

// KV returns one of the old app's settings, or "".
func (s *Source) KV(key string) string {
	var v string
	s.db.QueryRow(`SELECT value FROM kv WHERE key = ?`, key).Scan(&v)
	return v
}

// File returns a document the old app made or was given, by the path it
// recorded. The path is from another time and maybe another computer, so
// only its tail ("cv/…", "applications/…") is used to find the file.
func (s *Source) File(recorded string) ([]byte, bool) {
	rel := tail(recorded)
	if rel == "" {
		return nil, false
	}
	if s.zip != nil {
		f, err := s.zip.Open(rel)
		if err != nil {
			return nil, false
		}
		defer f.Close()
		b, err := io.ReadAll(io.LimitReader(f, 20<<20))
		return b, err == nil && len(b) > 0
	}
	for _, d := range s.dirs {
		if b, err := os.ReadFile(filepath.Join(d, filepath.FromSlash(rel))); err == nil && len(b) > 0 && len(b) <= 20<<20 {
			return b, true
		}
	}
	return nil, false
}

// tail reduces a recorded path to "cv/…" or "applications/…", refusing
// anything that would climb out of the data folder.
func tail(recorded string) string {
	p := path.Clean("/" + strings.ReplaceAll(recorded, `\`, "/"))
	for _, top := range []string{"/applications/", "/cv/"} {
		if i := strings.LastIndex(p, top); i >= 0 {
			return p[i+1:]
		}
	}
	return ""
}

// ---- what is in it ----

// Track is one of the old app's CVs, with the job titles searched for it.
type Track struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Titles   []string `json:"titles"`
	Kind     string   `json:"kind"`
	Original string   `json:"original"`
}

// Profile is the part of the old settings worth carrying over.
type Profile struct {
	Name                 string   `json:"name"`
	Locations            []string `json:"locations"`
	RemoteOK             bool     `json:"remote_ok"`
	MinSalary            float64  `json:"min_salary"`
	ExcludeCompanies     []string `json:"exclude_companies"`
	ExcludeTitleKeywords []string `json:"exclude_title_keywords"`
	Tracks               []Track  `json:"tracks"`
	ApplicationFacts     string   `json:"application_facts"`
	Stories              string   `json:"stories"`
	Guidance             string   `json:"guidance"`
	Certifications       []struct {
		Name    string `json:"name"`
		Issuer  string `json:"issuer"`
		Number  string `json:"number"`
		Issued  string `json:"issued"`
		Expires string `json:"expires"`
	} `json:"certifications"`
	Wants struct {
		Avoid        []string `json:"avoid"`
		Dealbreakers []string `json:"dealbreakers"`
	} `json:"wants"`
	Sources struct {
		Greenhouse      []string `json:"greenhouse"`
		Lever           []string `json:"lever"`
		Ashby           []string `json:"ashby"`
		SmartRecruiters []string `json:"smartrecruiters"`
		Workable        []string `json:"workable"`
		BambooHR        []string `json:"bamboohr"`
		Sites           []string `json:"sites"`
		CustomSites     []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"custom_sites"`
		Off []string `json:"off"`
	} `json:"sources"`
}

// Profile reads the old settings.
func (s *Source) Profile() Profile {
	var p Profile
	json.Unmarshal([]byte(s.KV("profile")), &p)
	return p
}

// CV returns the file of one of the old CVs.
func (s *Source) CV(t Track) (name string, data []byte, ok bool) {
	for _, ext := range []string{".docx", ".pdf", ".txt"} {
		if b, ok := s.File("cv/" + t.Name + ext); ok {
			label := strings.TrimSpace(t.Label)
			if label == "" {
				label = strings.TrimSuffix(t.Original, filepath.Ext(t.Original))
			}
			if label == "" {
				label = t.Name
			}
			return label + ext, b, true
		}
	}
	return "", nil, false
}

// Job is one posting the old app kept.
type Job struct {
	ID, Source, Company, Title, Location, URL, ApplyURL string
	Description, Salary, Status, Reasoning, Notes       string
	CoverLetter, CVPath, LetterPath                     string
	Posted, Found, Updated, Applied, Closed             time.Time
	Score, ScoreAfter                                   int // -1 when it was never scored
	RedFlags, Keywords                                  []string
}

// Jobs calls fn for every job in the given statuses (all when none are
// named), oldest first.
func (s *Source) Jobs(statuses []string, fn func(Job) error) error {
	q := `SELECT id, source, company, title, COALESCE(location, ''), COALESCE(url, ''), ` + s.col("jobs", "apply_url") + `,
		COALESCE(description, ''), COALESCE(salary, ''), status, COALESCE(reasoning, ''), COALESCE(notes, ''), COALESCE(cover_letter, ''),
		COALESCE(cv_path, ''), COALESCE(letter_path, ''), COALESCE(posted_at, ''), COALESCE(found_at, ''), COALESCE(updated_at, ''),
		COALESCE(applied_at, ''), ` + s.col("jobs", "closed_at") + `, COALESCE(score, -1), ` +
		map[bool]string{true: "COALESCE(score_after, -1)", false: "-1"}[s.has("jobs", "score_after")] + `,
		COALESCE(red_flags, '[]'), COALESCE(keywords, '[]') FROM jobs`
	var args []any
	if len(statuses) > 0 {
		q += ` WHERE status IN (?` + strings.Repeat(",?", len(statuses)-1) + `)`
		for _, st := range statuses {
			args = append(args, st)
		}
	}
	rows, err := s.db.Query(q+` ORDER BY found_at`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var j Job
		var posted, found, updated, applied, closed, flags, words string
		if err := rows.Scan(&j.ID, &j.Source, &j.Company, &j.Title, &j.Location, &j.URL, &j.ApplyURL, &j.Description, &j.Salary, &j.Status,
			&j.Reasoning, &j.Notes, &j.CoverLetter, &j.CVPath, &j.LetterPath, &posted, &found, &updated, &applied, &closed, &j.Score, &j.ScoreAfter, &flags, &words); err != nil {
			return err
		}
		j.Posted, j.Found, j.Updated, j.Applied, j.Closed = when(posted), when(found), when(updated), when(applied), when(closed)
		json.Unmarshal([]byte(flags), &j.RedFlags)
		json.Unmarshal([]byte(words), &j.Keywords)
		if err := fn(j); err != nil {
			return err
		}
	}
	return rows.Err()
}

// Counts says how many jobs the old app has in each status.
func (s *Source) Counts() map[string]int {
	out := map[string]int{}
	rows, err := s.db.Query(`SELECT status, COUNT(*) FROM jobs GROUP BY status`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		rows.Scan(&st, &n)
		out[st] = n
	}
	return out
}

// Event is one line of a job's history.
type Event struct {
	Kind, Detail string
	At           time.Time
}

// Events returns the lines of one job's history a person would want to keep:
// what was done and when, not every search, scoring or error along the way.
func (s *Source) Events(jobID string, limit int) []Event {
	rows, err := s.db.Query(`SELECT kind, COALESCE(detail, ''), created_at FROM events WHERE job_id = ? AND kind NOT LIKE '%:error'
		AND kind NOT IN ('scored', 'unscored', 'rescore', 'search', 'sources', 'discover', 'purge', 'leads', 'picture', 'fill', 'held')
		ORDER BY created_at DESC LIMIT ?`, jobID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var at string
		rows.Scan(&e.Kind, &e.Detail, &at)
		e.At = when(at)
		out = append(out, e)
	}
	return out
}

// Recruiter is someone the old app saw writing to the person.
type Recruiter struct {
	Email, Name, Company, Kind, Phone, LinkedIn, Notes string
	Last                                               time.Time
	Emails                                             int
	JobIDs                                             []string
}

// Recruiters returns the people the old app kept, hidden ones left out.
func (s *Source) Recruiters() []Recruiter {
	rows, err := s.db.Query(`SELECT email, name, company, kind, ` + s.col("recruiters", "phone") + `, ` + s.col("recruiters", "linkedin") + `, ` + s.col("recruiters", "notes") + `,
		COALESCE(last_at, ''), COALESCE(emails, 0) FROM recruiters WHERE COALESCE(hidden, 0) = 0 ORDER BY last_at DESC`)
	if err != nil {
		return nil
	}
	var out []Recruiter
	for rows.Next() {
		var r Recruiter
		var last string
		rows.Scan(&r.Email, &r.Name, &r.Company, &r.Kind, &r.Phone, &r.LinkedIn, &r.Notes, &last, &r.Emails)
		r.Last = when(last)
		out = append(out, r)
	}
	rows.Close()
	for i := range out {
		jr, err := s.db.Query(`SELECT job_id FROM recruiter_jobs WHERE email = ?`, out[i].Email)
		if err != nil {
			continue
		}
		for jr.Next() {
			var id string
			jr.Scan(&id)
			out[i].JobIDs = append(out[i].JobIDs, id)
		}
		jr.Close()
	}
	return out
}

// Interview is an interview the old app put in the calendar.
type Interview struct {
	JobID, Title string
	Start        time.Time
}

func (s *Source) Interviews() []Interview {
	rows, err := s.db.Query(`SELECT COALESCE(job_id, ''), title, start FROM calendar_events WHERE kind = 'interview' ORDER BY start`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Interview
	for rows.Next() {
		var i Interview
		var at string
		rows.Scan(&i.JobID, &i.Title, &at)
		if i.Start = when(at); !i.Start.IsZero() {
			out = append(out, i)
		}
	}
	return out
}

var layouts = []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"}

// when reads the old app's timestamps; anything unreadable is the zero time.
func when(s string) time.Time {
	s = strings.TrimSpace(s)
	if len(s) > 35 {
		s = s[:35]
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t
		}
	}
	return time.Time{}
}
