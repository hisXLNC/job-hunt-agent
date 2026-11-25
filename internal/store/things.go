package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ---- companies ---------------------------------------------------------------

// Company states: "following" (watched), "suggested" (met through a posting,
// not yet chosen), "muted" (never show again).
type Company struct {
	ID             int64           `json:"id"`
	Name           string          `json:"name"`
	Site           string          `json:"site"`
	BoardKind      string          `json:"board_kind"`
	BoardToken     string          `json:"board_token"`
	BoardCheckedAt int64           `json:"board_checked_at"`
	BoardNote      string          `json:"board_note"`
	Why            string          `json:"why"`
	Sector         string          `json:"sector"`
	About          string          `json:"about"`
	AboutFrom      string          `json:"about_from"`
	State          string          `json:"state"`
	Source         string          `json:"source"`
	Plan           json.RawMessage `json:"plan"`
	CreatedAt      int64           `json:"created_at"`

	// Filled by listings.
	OpenRoles  int   `json:"open_roles"`
	BestFit    int   `json:"best_fit"`
	NewestRole int64 `json:"newest_role"`
	People     int   `json:"people"`
	KnowYou    int   `json:"know_you"`
	Applied    int   `json:"applied"`
}

var corpWords = map[string]bool{"inc": true, "incorporated": true, "ltd": true, "limited": true, "llp": true, "llc": true, "corp": true, "corporation": true, "co": true, "company": true, "plc": true, "gmbh": true, "sa": true, "ag": true, "the": true, "lp": true}

// NormName reduces a company name to a comparable form, so "Thomson Reuters
// Canada Ltd." and "thomson reuters" are the same employer.
func NormName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '&':
			b.WriteString(" and ")
		default:
			b.WriteByte(' ')
		}
	}
	words := strings.Fields(b.String())
	var keep []string
	for i, w := range words {
		if corpWords[w] && !(i == 0 && len(words) > 1 && w != "the") {
			continue
		}
		if w == "canada" && i == len(words)-1 && len(words) > 1 {
			continue
		}
		keep = append(keep, w)
	}
	if len(keep) == 0 {
		keep = words
	}
	return strings.Join(keep, " ")
}

const companyCols = `c.id, c.name, c.site, c.board_kind, c.board_token, c.board_checked_at, c.board_note, c.why, c.sector, c.about, c.about_from, c.state, c.source, c.plan, c.created_at`

func scanCompany(sc interface{ Scan(...any) error }, extra ...any) (Company, error) {
	var c Company
	var plan string
	dst := []any{&c.ID, &c.Name, &c.Site, &c.BoardKind, &c.BoardToken, &c.BoardCheckedAt, &c.BoardNote, &c.Why, &c.Sector, &c.About, &c.AboutFrom, &c.State, &c.Source, &plan, &c.CreatedAt}
	if len(extra) > 0 {
		dst = append(dst, &c.OpenRoles, &c.BestFit, &c.NewestRole, &c.People, &c.KnowYou, &c.Applied)
	}
	err := sc.Scan(dst...)
	c.Plan = raw(plan)
	return c, err
}

// UpsertCompany finds a company by name or creates it. An existing company is
// never downgraded: a muted one stays muted, a followed one stays followed.
func (s *Store) UpsertCompany(c Company) (Company, bool, error) {
	norm := NormName(c.Name)
	if norm == "" {
		return Company{}, false, errors.New("company needs a name")
	}
	if got, err := s.CompanyByName(c.Name); err == nil {
		changed := false
		if got.Site == "" && c.Site != "" {
			got.Site, changed = c.Site, true
		}
		if got.Why == "" && c.Why != "" {
			got.Why, changed = c.Why, true
		}
		if got.Sector == "" && c.Sector != "" {
			got.Sector, changed = c.Sector, true
		}
		if got.About == "" && c.About != "" {
			got.About, got.AboutFrom, changed = c.About, c.AboutFrom, true
		}
		if got.BoardKind == "" && c.BoardKind != "" {
			got.BoardKind, got.BoardToken, changed = c.BoardKind, c.BoardToken, true
		}
		if got.State == "suggested" && c.State == "following" {
			got.State, changed = "following", true
		}
		if changed {
			return got, false, s.SaveCompany(got)
		}
		return got, false, nil
	}
	if c.State == "" {
		c.State = "following"
	}
	if c.Source == "" {
		c.Source = "you"
	}
	res, err := s.db.Exec(`INSERT INTO companies(name, norm, site, board_kind, board_token, why, sector, about, about_from, state, source, plan, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		strings.TrimSpace(c.Name), norm, c.Site, c.BoardKind, c.BoardToken, c.Why, c.Sector, c.About, c.AboutFrom, c.State, c.Source, rawStr(c.Plan, "{}"), s.now())
	if err != nil {
		return Company{}, false, err
	}
	c.ID, _ = res.LastInsertId()
	c.CreatedAt = s.now()
	c.Plan = raw(string(c.Plan))
	s.Changed("companies")
	return c, true, nil
}

func (s *Store) SaveCompany(c Company) error {
	_, err := s.db.Exec(`UPDATE companies SET name=?, site=?, board_kind=?, board_token=?, board_checked_at=?, board_note=?, why=?, sector=?, about=?, about_from=?, state=?, plan=? WHERE id=?`,
		c.Name, c.Site, c.BoardKind, c.BoardToken, c.BoardCheckedAt, c.BoardNote, c.Why, c.Sector, c.About, c.AboutFrom, c.State, rawStr(c.Plan, "{}"), c.ID)
	s.Changed("companies")
	return err
}

func (s *Store) Company(id int64) (Company, error) {
	c, err := scanCompany(s.db.QueryRow(`SELECT `+companyCols+` FROM companies c WHERE c.id = ?`, id))
	return c, notFound(err)
}

func (s *Store) CompanyByName(name string) (Company, error) {
	c, err := scanCompany(s.db.QueryRow(`SELECT `+companyCols+` FROM companies c WHERE c.norm = ?`, NormName(name)))
	return c, notFound(err)
}

// Companies lists companies in the given states (none = following and
// suggested), each with counts of what is going on there.
func (s *Store) Companies(states ...string) ([]Company, error) {
	if len(states) == 0 {
		states = []string{"following", "suggested"}
	}
	args := make([]any, len(states))
	for i, st := range states {
		args[i] = st
	}
	q := `SELECT ` + companyCols + `,
	  (SELECT COUNT(*) FROM roles r WHERE r.company_id = c.id AND r.closed = '' AND r.stage != 'new'),
	  COALESCE((SELECT MAX(r.fit) FROM roles r WHERE r.company_id = c.id AND r.closed = ''), -1),
	  COALESCE((SELECT MAX(CASE WHEN r.posted_at > 0 THEN r.posted_at ELSE r.first_seen_at END) FROM roles r WHERE r.company_id = c.id AND r.closed = '' AND r.stage != 'new'), 0),
	  (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id AND p.state != 'skipped'),
	  (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id AND p.knows_you_at > 0),
	  (SELECT COUNT(*) FROM roles r WHERE r.company_id = c.id AND r.applied_at > 0)
	FROM companies c WHERE c.state IN (` + strings.TrimRight(strings.Repeat("?,", len(states)), ",") + `) ORDER BY c.name COLLATE NOCASE`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Company
	for rows.Next() {
		c, err := scanCompany(rows, true)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type Signal struct {
	ID        int64  `json:"id"`
	CompanyID int64  `json:"company_id"`
	Kind      string `json:"kind"`
	Text      string `json:"text"`
	URL       string `json:"url"`
	At        int64  `json:"at"`
}

func (s *Store) AddSignal(g Signal) error {
	if g.At == 0 {
		g.At = s.now()
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM signals WHERE company_id = ? AND text = ?`, g.CompanyID, g.Text).Scan(&n)
	if n > 0 {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO signals(company_id, kind, text, url, at) VALUES(?,?,?,?,?)`, g.CompanyID, g.Kind, g.Text, g.URL, g.At)
	s.Changed("companies")
	return err
}

func (s *Store) Signals(companyID int64, limit int) ([]Signal, error) {
	rows, err := s.db.Query(`SELECT id, company_id, kind, text, url, at FROM signals WHERE company_id = ? ORDER BY at DESC LIMIT ?`, companyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Signal
	for rows.Next() {
		var g Signal
		if err := rows.Scan(&g.ID, &g.CompanyID, &g.Kind, &g.Text, &g.URL, &g.At); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ---- roles -------------------------------------------------------------------

// A role moves forward through stages and can be closed at any point.
//
// Stages: new (just seen, not read yet) → found (read and worth a look) →
// ready (documents prepared) → applied → reply → interview → offer.
//
// Closed: "" (open), "screened" (Job Hunt read it and it isn't for this
// person), "no" (the person said not interested: permanent, never reopened),
// "rejected", "expired", "withdrawn".
var Stages = []string{"new", "found", "ready", "applied", "reply", "interview", "offer"}

func stageRank(st string) int {
	for i, x := range Stages {
		if x == st {
			return i
		}
	}
	return -1
}

type Role struct {
	ID          int64           `json:"id"`
	CompanyID   int64           `json:"company_id"`
	Company     string          `json:"company"`
	Key         string          `json:"key"`
	Source      string          `json:"source"`
	Title       string          `json:"title"`
	Location    string          `json:"location"`
	Workplace   string          `json:"workplace"`
	Pay         string          `json:"pay"`
	URL         string          `json:"url"`
	ApplyURL    string          `json:"apply_url"`
	Description string          `json:"description,omitempty"`
	PostedAt    int64           `json:"posted_at"`
	FirstSeenAt int64           `json:"first_seen_at"`
	LastSeenAt  int64           `json:"last_seen_at"`
	GoneAt      int64           `json:"gone_at"`
	Applicants  int             `json:"applicants"`
	Band        string          `json:"band"`
	Stage       string          `json:"stage"`
	StageAt     int64           `json:"stage_at"`
	Closed      string          `json:"closed"`
	ClosedWhy   string          `json:"closed_why"`
	Fit         int             `json:"fit"`
	FitTailored int             `json:"fit_tailored"`
	Reading     json.RawMessage `json:"reading,omitempty"`
	Saved       bool            `json:"saved"`
	Auto        bool            `json:"auto"`
	AppliedAt   int64           `json:"applied_at"`
	// LaterUntil: the person saved the role for later; it stays off Today
	// until this moment. 0 when not saved for later.
	LaterUntil int64 `json:"later_until"`
}

// Age is when the posting went up, or when Job Hunt first saw it.
func (r Role) Age() int64 {
	if r.PostedAt > 0 {
		return r.PostedAt
	}
	return r.FirstSeenAt
}

const roleCols = `r.id, r.company_id, c.name, r.key, r.source, r.title, r.location, r.workplace, r.pay, r.url, r.apply_url, r.posted_at, r.first_seen_at, r.last_seen_at, r.gone_at, r.applicants, r.band, r.stage, r.stage_at, r.closed, r.closed_why, r.fit, r.fit_tailored, r.saved, r.auto, r.applied_at, r.later_until`

func scanRole(sc interface{ Scan(...any) error }, full bool) (Role, error) {
	var r Role
	var saved, auto int
	dst := []any{&r.ID, &r.CompanyID, &r.Company, &r.Key, &r.Source, &r.Title, &r.Location, &r.Workplace, &r.Pay, &r.URL, &r.ApplyURL, &r.PostedAt, &r.FirstSeenAt, &r.LastSeenAt, &r.GoneAt, &r.Applicants, &r.Band, &r.Stage, &r.StageAt, &r.Closed, &r.ClosedWhy, &r.Fit, &r.FitTailored, &saved, &auto, &r.AppliedAt, &r.LaterUntil}
	var reading string
	if full {
		dst = append(dst, &r.Description, &reading)
	}
	err := sc.Scan(dst...)
	r.Saved, r.Auto = saved != 0, auto != 0
	if full {
		r.Reading = raw(reading)
	}
	return r, err
}

// SeenRole reports whether a posting with this key was ever recorded.
func (s *Store) SeenRole(key string) (id int64, closed string, ok bool) {
	err := s.db.QueryRow(`SELECT id, closed FROM roles WHERE key = ?`, key).Scan(&id, &closed)
	return id, closed, err == nil
}

// SimilarRole finds a role at the same company with the same title in the
// same place, so the same job seen through two places is one role. A role
// the person said no to is preferred, so a repost of it stays closed.
func (s *Store) SimilarRole(companyID int64, title, location string) (id int64, closed string, ok bool) {
	rows, err := s.db.Query(`SELECT id, closed, location FROM roles WHERE company_id = ? AND lower(title) = lower(?) ORDER BY (closed = 'no') DESC, id DESC`, companyID, strings.TrimSpace(title))
	if err != nil {
		return 0, "", false
	}
	defer rows.Close()
	for rows.Next() {
		var loc string
		if rows.Scan(&id, &closed, &loc) == nil && samePlace(loc, location) {
			return id, closed, true
		}
	}
	return 0, "", false
}

// samePlace compares two location strings by their first part (the city).
// An unknown place matches anything.
func samePlace(a, b string) bool {
	city := func(x string) string {
		x = strings.ToLower(strings.TrimSpace(strings.FieldsFunc(x+",", func(r rune) bool { return r == ',' || r == '(' || r == ';' || r == '/' })[0]))
		return x
	}
	if strings.TrimSpace(a) == "" || strings.TrimSpace(b) == "" {
		return true
	}
	ca, cb := city(a), city(b)
	return ca == cb || strings.Contains(ca, cb) || strings.Contains(cb, ca)
}

// AddRole records a newly seen posting.
func (s *Store) AddRole(r Role) (int64, error) {
	now := s.now()
	if r.Stage == "" {
		r.Stage = "new"
	}
	if r.FirstSeenAt == 0 {
		r.FirstSeenAt = now
	}
	if r.Applicants == 0 && r.Source != "manual" {
		// 0 is a real answer only when a source said so; callers pass -1 for unknown.
	}
	res, err := s.db.Exec(`INSERT INTO roles(company_id, key, source, title, location, workplace, pay, url, apply_url, description, posted_at, first_seen_at, last_seen_at, applicants, band, stage, stage_at, closed, closed_why, fit, fit_tailored, reading)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.CompanyID, r.Key, r.Source, strings.TrimSpace(r.Title), r.Location, r.Workplace, r.Pay, r.URL, r.ApplyURL, r.Description, r.PostedAt, r.FirstSeenAt, now, r.Applicants, r.Band, r.Stage, now, r.Closed, r.ClosedWhy, -1, -1, rawStr(r.Reading, "{}"))
	if err != nil {
		return 0, err
	}
	s.Changed("roles")
	return res.LastInsertId()
}

// ImportRole records a role brought over from somewhere else exactly as
// given: its stage, dates, fit and whether it is closed. Nothing is read or
// prepared for it afterwards; it arrives as history.
func (s *Store) ImportRole(r Role) (int64, error) {
	if stageRank(r.Stage) < 0 {
		return 0, fmt.Errorf("unknown stage %q", r.Stage)
	}
	switch r.Closed {
	case "", "screened", "no", "rejected", "expired", "withdrawn":
	default:
		return 0, fmt.Errorf("unknown way to close a role: %q", r.Closed)
	}
	now := s.now()
	if r.FirstSeenAt == 0 {
		r.FirstSeenAt = now
	}
	if r.LastSeenAt == 0 {
		r.LastSeenAt = r.FirstSeenAt
	}
	if r.StageAt == 0 {
		r.StageAt = r.LastSeenAt
	}
	res, err := s.db.Exec(`INSERT INTO roles(company_id, key, source, title, location, workplace, pay, url, apply_url, description, posted_at, first_seen_at, last_seen_at, applicants, band, stage, stage_at, closed, closed_why, fit, fit_tailored, reading, saved, applied_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.CompanyID, r.Key, r.Source, strings.TrimSpace(r.Title), r.Location, r.Workplace, r.Pay, r.URL, r.ApplyURL, r.Description, r.PostedAt, r.FirstSeenAt, r.LastSeenAt, r.Applicants, r.Band, r.Stage, r.StageAt, r.Closed, r.ClosedWhy, r.Fit, r.FitTailored, rawStr(r.Reading, "{}"), b2i(r.Saved), r.AppliedAt)
	if err != nil {
		return 0, err
	}
	s.Changed("roles", "today", "progress")
	return res.LastInsertId()
}

// TouchRole notes that a posting is still up, and refreshes what can change.
func (s *Store) TouchRole(id int64, applicants int, description string) {
	now := s.now()
	s.db.Exec(`UPDATE roles SET last_seen_at = ?, gone_at = 0 WHERE id = ?`, now, id)
	if applicants >= 0 {
		s.SetApplicants(id, applicants)
	}
	if description != "" {
		s.db.Exec(`UPDATE roles SET description = ? WHERE id = ? AND description = ''`, description, id)
	}
}

// SetApplicants records how many have applied. "Under 25" (24), the most
// LinkedIn says without signing in, never replaces a smaller count read
// signed in.
func (s *Store) SetApplicants(id int64, n int) {
	if n < 0 {
		return
	}
	s.db.Exec(`UPDATE roles SET applicants = ? WHERE id = ? AND NOT (? = 24 AND applicants BETWEEN 0 AND 23)`, n, id, n)
	s.Changed("roles", "today")
}

// SetRoleDetail stores what a detail fetch learned.
func (s *Store) SetRoleDetail(id int64, description, applyURL, pay, workplace string, applicants int, postedAt int64) {
	s.db.Exec(`UPDATE roles SET description = CASE WHEN ? != '' THEN ? ELSE description END,
		apply_url = CASE WHEN ? != '' THEN ? ELSE apply_url END,
		pay = CASE WHEN ? != '' THEN ? ELSE pay END,
		workplace = CASE WHEN ? != '' THEN ? ELSE workplace END,
		applicants = CASE WHEN ? >= 0 AND NOT (? = 24 AND applicants BETWEEN 0 AND 23) THEN ? ELSE applicants END,
		posted_at = CASE WHEN ? > 0 THEN ? ELSE posted_at END WHERE id = ?`,
		description, description, applyURL, applyURL, pay, pay, workplace, workplace, applicants, applicants, applicants, postedAt, postedAt, id)
	s.Changed("roles")
}

// SetReading stores Job Hunt's reading of a role against the person.
func (s *Store) SetReading(id int64, fit int, band string, reading any) error {
	b, err := json.Marshal(reading)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE roles SET fit = ?, band = CASE WHEN ? != '' THEN ? ELSE band END, reading = ? WHERE id = ?`, fit, band, band, string(b), id)
	s.Changed("roles", "today")
	return err
}

func (s *Store) SetFitTailored(id int64, fit int) {
	s.db.Exec(`UPDATE roles SET fit_tailored = ? WHERE id = ?`, fit, id)
	s.Changed("roles", "today")
}

// Advance moves a role to a later stage. It never moves one backwards, and
// never touches a role the person said no to.
func (s *Store) Advance(id int64, stage string) (bool, error) {
	if stageRank(stage) < 0 {
		return false, fmt.Errorf("unknown stage %q", stage)
	}
	var cur, closed string
	if err := s.db.QueryRow(`SELECT stage, closed FROM roles WHERE id = ?`, id).Scan(&cur, &closed); err != nil {
		return false, notFound(err)
	}
	if closed == "no" || stageRank(stage) <= stageRank(cur) {
		return false, nil
	}
	now := s.now()
	q := `UPDATE roles SET stage = ?, stage_at = ?`
	args := []any{stage, now}
	if stageRank(stage) >= stageRank("applied") {
		q += `, applied_at = CASE WHEN applied_at = 0 THEN ? ELSE applied_at END`
		args = append(args, now)
		// Hearing back reopens a role closed as expired or screened; never a "no".
		q += `, closed = CASE WHEN closed IN ('expired','screened') THEN '' ELSE closed END`
	}
	q += ` WHERE id = ?`
	args = append(args, id)
	if _, err := s.db.Exec(q, args...); err != nil {
		return false, err
	}
	s.Changed("roles", "today", "progress")
	return true, nil
}

// SetStage puts a role at an exact stage: the person correcting the record.
func (s *Store) SetStage(id int64, stage string) error {
	if stageRank(stage) < 0 {
		return fmt.Errorf("unknown stage %q", stage)
	}
	now := s.now()
	applied := 0
	if stageRank(stage) >= stageRank("applied") {
		applied = 1
	}
	_, err := s.db.Exec(`UPDATE roles SET stage = ?, stage_at = ?, applied_at = CASE WHEN ? = 1 AND applied_at = 0 THEN ? WHEN ? = 0 THEN 0 ELSE applied_at END WHERE id = ?`,
		stage, now, applied, now, applied, id)
	s.Changed("roles", "today", "progress")
	return err
}

// CloseRole closes a role. A "no" from the person is permanent: nothing
// except the person's own Reopen can undo it.
func (s *Store) CloseRole(id int64, closed, why string) error {
	switch closed {
	case "screened", "no", "rejected", "expired", "withdrawn":
	default:
		return fmt.Errorf("unknown way to close a role: %q", closed)
	}
	_, err := s.db.Exec(`UPDATE roles SET closed = ?, closed_why = ?, stage_at = ?, later_until = 0 WHERE id = ? AND closed != 'no'`, closed, why, s.now(), id)
	s.Changed("roles", "today", "progress")
	return err
}

// Reopen is only ever called because the person asked.
func (s *Store) Reopen(id int64) error {
	_, err := s.db.Exec(`UPDATE roles SET closed = '', closed_why = '', later_until = 0, stage = CASE WHEN stage = 'new' THEN 'found' ELSE stage END, stage_at = ? WHERE id = ?`, s.now(), id)
	s.Changed("roles", "today")
	return err
}

// Unscreen brings back a role that was set aside by the rules or by its
// reading, now that it clears them. Only a set-aside role comes back: one the
// person said no to, or closed in any other way, is left as it is. It reports
// whether the role came back.
func (s *Store) Unscreen(id int64) (bool, error) {
	res, err := s.db.Exec(`UPDATE roles SET closed = '', closed_why = '', stage_at = ? WHERE id = ? AND closed = 'screened'`, s.now(), id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	s.Changed("roles", "today")
	return n > 0, nil
}

// SetAside lists the roles set aside (by the rules or by their reading) that
// were first seen since a moment, newest first: the person never saved or
// applied to them, their posting is still up, and their employer is not
// muted.
func (s *Store) SetAside(since int64, limit int) ([]Role, error) {
	rows, err := s.db.Query(`SELECT `+roleCols+`, r.description, r.reading FROM roles r JOIN companies c ON c.id = r.company_id
		WHERE r.closed = 'screened' AND r.saved = 0 AND r.applied_at = 0 AND r.gone_at = 0 AND c.state != 'muted' AND r.first_seen_at >= ?
		ORDER BY r.first_seen_at DESC LIMIT ?`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Role
	for rows.Next() {
		r, err := scanRole(rows, true)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetLater keeps an open role off Today until a moment (0 brings it back
// now). It never touches a closed role: a role the person said no to cannot
// come back this way, and it reports whether anything changed.
func (s *Store) SetLater(id, until int64) (bool, error) {
	res, err := s.db.Exec(`UPDATE roles SET later_until = ? WHERE id = ? AND closed = ''`, until, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	s.Changed("roles", "today")
	return n > 0, nil
}

// Unapply takes back a mistaken "I applied": the role goes to the given
// earlier stage and is no longer counted as applied. Only a role that is at
// "applied" and open is changed; it reports whether one was.
func (s *Store) Unapply(id int64, stage string) (bool, error) {
	if stageRank(stage) < 0 || stageRank(stage) >= stageRank("applied") {
		return false, fmt.Errorf("unknown stage %q", stage)
	}
	res, err := s.db.Exec(`UPDATE roles SET stage = ?, stage_at = ?, applied_at = 0 WHERE id = ? AND stage = 'applied' AND closed = ''`, stage, s.now(), id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	s.Changed("roles", "today", "progress")
	return n > 0, nil
}

// untouched picks open roles the person never prepared or applied to. Roles
// with documents or an application keep everything and are never picked.
const untouched = `closed = '' AND stage IN ('new','found') AND applied_at = 0
	AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.role_id = roles.id)`

// Of those, the ones whose posting is gone: taken down where the source says
// so, or not seen in any search since a moment, for sources that never say
// (a role the person added themselves is never called unseen).
const (
	takenDown = untouched + ` AND gone_at > 0`
	unseen    = untouched + ` AND gone_at = 0 AND source NOT IN ('manual','extension') AND last_seen_at < ?`
)

// GoneUntouched counts the roles CloseGone would close.
func (s *Store) GoneUntouched(unseenSince int64) int {
	return s.Count(`SELECT COUNT(*) FROM roles WHERE `+takenDown) + s.Count(`SELECT COUNT(*) FROM roles WHERE `+unseen, unseenSince)
}

// CloseGone closes (never deletes) every open role whose posting was taken
// down, or has not been seen since a moment, and that the person never
// prepared or applied to. It returns how many.
func (s *Store) CloseGone(unseenSince int64) (int, error) {
	now := s.now()
	total := 0
	for _, step := range []struct {
		why, where string
		args       []any
	}{
		{"The posting was taken down", takenDown, nil},
		{"The posting hasn't been seen for a month", unseen, []any{unseenSince}},
	} {
		res, err := s.db.Exec(`UPDATE roles SET closed = 'expired', closed_why = ?, stage_at = ?, later_until = 0 WHERE `+step.where, append([]any{step.why, now}, step.args...)...)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += int(n)
	}
	s.Changed("roles", "today", "progress")
	return total, nil
}

// AppliedSilent lists open applications sent before a moment that nobody
// has answered: no reply in the inbox, no conversation.
func (s *Store) AppliedSilent(before, now int64, limit int) ([]Role, error) {
	rows, err := s.db.Query(`SELECT `+roleCols+` FROM roles r JOIN companies c ON c.id = r.company_id
		WHERE r.closed = '' AND r.stage = 'applied' AND r.applied_at > 0 AND r.applied_at <= ? AND r.later_until <= ?
		AND NOT EXISTS (SELECT 1 FROM mails m WHERE m.role_id = r.id AND m.kind IN ('interview','assessment','question','offer','rejection','person'))
		AND NOT EXISTS (SELECT 1 FROM talks t WHERE t.role_id = r.id)
		ORDER BY r.applied_at ASC, r.id ASC LIMIT ?`, before, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Role
	for rows.Next() {
		r, err := scanRole(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AppliedQuiet lists open roles applied to between two moments that have had
// no answer: no mail from a person or a hiring system beyond a receipt, no
// conversation, and no follow-up already sent or let go.
func (s *Store) AppliedQuiet(from, to, now int64, limit int) ([]Role, error) {
	rows, err := s.db.Query(`SELECT `+roleCols+` FROM roles r JOIN companies c ON c.id = r.company_id
		WHERE r.closed = '' AND r.stage = 'applied' AND r.applied_at >= ? AND r.applied_at <= ? AND r.later_until <= ?
		AND NOT EXISTS (SELECT 1 FROM mails m WHERE m.role_id = r.id AND m.kind IN ('interview','assessment','question','offer','rejection','person'))
		AND NOT EXISTS (SELECT 1 FROM talks t WHERE t.role_id = r.id)
		AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.role_id = r.id AND d.kind = 'chase'
			AND (COALESCE(json_extract(d.body, '$.sent_at'), 0) > 0 OR COALESCE(json_extract(d.body, '$.dropped_at'), 0) > 0))
		ORDER BY r.applied_at ASC, r.id ASC LIMIT ?`, from, to, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Role
	for rows.Next() {
		r, err := scanRole(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) SetSaved(id int64, saved bool) error {
	_, err := s.db.Exec(`UPDATE roles SET saved = ? WHERE id = ?`, b2i(saved), id)
	s.Changed("roles")
	return err
}

// MarkGone notes that a posting is no longer listed. Roles the person applied
// to or prepared keep everything; untouched ones are closed as expired.
func (s *Store) MarkGone(id int64) {
	now := s.now()
	s.db.Exec(`UPDATE roles SET gone_at = ? WHERE id = ? AND gone_at = 0`, now, id)
	s.db.Exec(`UPDATE roles SET closed = 'expired', closed_why = 'The posting was taken down' WHERE id = ? AND closed = '' AND stage IN ('new','found')`, id)
	s.Changed("roles")
}

func (s *Store) Role(id int64) (Role, error) {
	r, err := scanRole(s.db.QueryRow(`SELECT `+roleCols+`, r.description, r.reading FROM roles r JOIN companies c ON c.id = r.company_id WHERE r.id = ?`, id), true)
	return r, notFound(err)
}

// RoleFilter picks roles for a list. Zero value: every open role that has
// been read.
type RoleFilter struct {
	Stages    []string
	Closed    []string // nil = open only; []string{"*"} = everything
	CompanyID int64
	Search    string
	Band      string
	MinFit    int
	Saved     bool
	Later     int64  // not 0: only roles saved for later beyond this moment
	NotLater  int64  // not 0: leave out roles saved for later beyond this moment
	Unread    bool   // include stage "new"
	Sort      string // fit, age, company, title, stage, applicants (prefix "-" reverses)
	Limit     int
	Offset    int
}

func (f RoleFilter) where() (string, []any) {
	w := []string{"1=1"}
	var args []any
	in := func(col string, vals []string) {
		w = append(w, col+` IN (`+strings.TrimRight(strings.Repeat("?,", len(vals)), ",")+`)`)
		for _, v := range vals {
			args = append(args, v)
		}
	}
	if len(f.Stages) > 0 {
		in("r.stage", f.Stages)
	} else if !f.Unread {
		w = append(w, `r.stage != 'new'`)
	}
	switch {
	case len(f.Closed) == 0:
		w = append(w, `r.closed = ''`)
	case f.Closed[0] == "*":
	default:
		in("r.closed", f.Closed)
	}
	if f.CompanyID != 0 {
		w = append(w, `r.company_id = ?`)
		args = append(args, f.CompanyID)
	}
	if q := strings.TrimSpace(f.Search); q != "" {
		w = append(w, `(r.title LIKE ? OR c.name LIKE ? OR r.location LIKE ?)`)
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}
	if f.Band != "" {
		w = append(w, `r.band = ?`)
		args = append(args, f.Band)
	}
	if f.MinFit > 0 {
		w = append(w, `r.fit >= ?`)
		args = append(args, f.MinFit)
	}
	if f.Saved {
		w = append(w, `r.saved = 1`)
	}
	if f.Later != 0 {
		w = append(w, `r.later_until > ?`)
		args = append(args, f.Later)
	}
	if f.NotLater != 0 {
		w = append(w, `r.later_until <= ?`)
		args = append(args, f.NotLater)
	}
	return strings.Join(w, " AND "), args
}

var roleSorts = map[string]string{
	"fit":        "MAX(r.fit, r.fit_tailored) DESC, r.id DESC",
	"age":        "(CASE WHEN r.posted_at > 0 THEN r.posted_at ELSE r.first_seen_at END) DESC, r.id DESC",
	"company":    "c.name COLLATE NOCASE ASC, r.id DESC",
	"title":      "r.title COLLATE NOCASE ASC, r.id DESC",
	"stage":      "r.stage_at DESC, r.id DESC",
	"applicants": "(CASE WHEN r.applicants < 0 THEN 100000 ELSE r.applicants END) ASC, r.id DESC",
}

func (s *Store) Roles(f RoleFilter) ([]Role, int, error) {
	where, args := f.where()
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM roles r JOIN companies c ON c.id = r.company_id WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	key, rev := strings.TrimPrefix(f.Sort, "-"), strings.HasPrefix(f.Sort, "-")
	order, ok := roleSorts[key]
	if !ok {
		order = roleSorts["age"]
	}
	if rev {
		order = strings.NewReplacer(" DESC", " ASC", " ASC", " DESC").Replace(order)
	}
	q := `SELECT ` + roleCols + ` FROM roles r JOIN companies c ON c.id = r.company_id WHERE ` + where + ` ORDER BY ` + order
	if f.Limit > 0 {
		q += fmt.Sprintf(` LIMIT %d OFFSET %d`, f.Limit, f.Offset)
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Role
	for rows.Next() {
		r, err := scanRole(rows, false)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// RolesNamingADate lists open roles not yet applied to whose posting speaks
// of a closing date, with the posting's words, so the date can be read out.
func (s *Store) RolesNamingADate() ([]Role, error) {
	rows, err := s.db.Query(`SELECT r.id, r.title, c.name, r.description FROM roles r JOIN companies c ON c.id = r.company_id
		WHERE r.closed = '' AND r.stage IN ('found', 'ready')
		AND (r.description LIKE '%clos%' OR r.description LIKE '%deadline%' OR r.description LIKE '%apply by%' OR r.description LIKE '%applications due%' OR r.description LIKE '%application due%' OR r.description LIKE '%posting end date%')
		ORDER BY r.id DESC LIMIT 2000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Role
	for rows.Next() {
		var r Role
		if err := rows.Scan(&r.ID, &r.Title, &r.Company, &r.Description); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RoleCounts gives the number of roles per stage (open ones), plus each way
// of being closed under "closed:<how>".
func (s *Store) RoleCounts() (map[string]int, error) {
	out := map[string]int{}
	rows, err := s.db.Query(`SELECT CASE WHEN closed = '' THEN stage ELSE 'closed:' || closed END, COUNT(*) FROM roles GROUP BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}

// OpenRoleKeys lists open, listed roles from one source at one company, for
// working out which postings were taken down.
func (s *Store) OpenRoleKeys(companyID int64, source string) (map[string]int64, error) {
	rows, err := s.db.Query(`SELECT key, id FROM roles WHERE company_id = ? AND source = ? AND gone_at = 0`, companyID, source)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var id int64
		if err := rows.Scan(&k, &id); err != nil {
			return nil, err
		}
		out[k] = id
	}
	return out, rows.Err()
}

// ---- documents ---------------------------------------------------------------

// Doc kinds: "cv" (tailored CV: base, changes), "letter", "case" (one-page
// case for the hiring manager), "answers" (form answers), and with role 0:
// "arriving" (the relocation pack).
type Doc struct {
	ID        int64           `json:"id"`
	RoleID    int64           `json:"role_id"`
	Kind      string          `json:"kind"`
	Body      json.RawMessage `json:"body"`
	CreatedAt int64           `json:"created_at"`
	UpdatedAt int64           `json:"updated_at"`
}

func (s *Store) SaveDoc(roleID int64, kind string, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	now := s.now()
	_, err = s.db.Exec(`INSERT INTO docs(role_id, kind, body, created_at, updated_at) VALUES(?,?,?,?,?)
		ON CONFLICT(role_id, kind) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`, roleID, kind, string(b), now, now)
	s.Changed("roles", "docs")
	return err
}

// DropDoc removes one document of a role, if it has it.
func (s *Store) DropDoc(roleID int64, kind string) error {
	_, err := s.db.Exec(`DELETE FROM docs WHERE role_id = ? AND kind = ?`, roleID, kind)
	s.Changed("roles", "docs")
	return err
}

// Doc loads a document into out and reports whether it exists.
func (s *Store) Doc(roleID int64, kind string, out any) (bool, error) {
	var body string
	err := s.db.QueryRow(`SELECT body FROM docs WHERE role_id = ? AND kind = ?`, roleID, kind).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(body), out)
}

func (s *Store) Docs(roleID int64) ([]Doc, error) {
	rows, err := s.db.Query(`SELECT id, role_id, kind, body, created_at, updated_at FROM docs WHERE role_id = ? ORDER BY id`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Doc
	for rows.Next() {
		var d Doc
		var body string
		if err := rows.Scan(&d.ID, &d.RoleID, &d.Kind, &body, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.Body = raw(body)
		out = append(out, d)
	}
	return out, rows.Err()
}

// ---- people ------------------------------------------------------------------

// Kinds of people worth writing to. The first five are the doors that open
// for someone arriving without a network.
//
//	knows_work   works at a firm that already knows the person's work
//	made_move    made the same move (same origin, now here)
//	same_roots   same school, employer, country or community
//	same_craft   does the same specialised work here
//	mentor       a mentor through a newcomer programme
//	recruiter    posted or recruits for a role
//	manager      probably the hiring manager for a role
//	contact      someone the person already knows
//
// States: "new" (suggested), "active" (a note is drafted or out), "skipped".
var PersonKinds = []string{"knows_work", "made_move", "same_roots", "same_craft", "mentor", "recruiter", "manager", "contact"}

type Person struct {
	ID         int64  `json:"id"`
	CompanyID  int64  `json:"company_id"`
	Company    string `json:"company"`
	Name       string `json:"name"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	Why        string `json:"why"`
	URL        string `json:"url"`
	Email      string `json:"email"`
	EmailSure  string `json:"email_sure"` // "", "sure", "likely", "guess"
	Place      string `json:"place"`
	Source     string `json:"source"`
	State      string `json:"state"`
	KnowsYouAt int64  `json:"knows_you_at"`
	CreatedAt  int64  `json:"created_at"`

	Note *Note `json:"note,omitempty"` // latest note, in listings
}

const personCols = `p.id, p.company_id, COALESCE(c.name, ''), p.name, p.title, p.kind, p.why, p.url, p.email, p.email_sure, p.place, p.source, p.state, p.knows_you_at, p.created_at`

func scanPerson(sc interface{ Scan(...any) error }) (Person, error) {
	var p Person
	err := sc.Scan(&p.ID, &p.CompanyID, &p.Company, &p.Name, &p.Title, &p.Kind, &p.Why, &p.URL, &p.Email, &p.EmailSure, &p.Place, &p.Source, &p.State, &p.KnowsYouAt, &p.CreatedAt)
	return p, err
}

// AddPerson records a person once: the same name at the same company, or the
// same profile link, is the same person.
func (s *Store) AddPerson(p Person) (int64, bool, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return 0, false, errors.New("person needs a name")
	}
	var id int64
	err := s.db.QueryRow(`SELECT id FROM people WHERE (lower(name) = lower(?) AND company_id = ?) OR (? != '' AND url = ?) LIMIT 1`, p.Name, p.CompanyID, p.URL, p.URL).Scan(&id)
	if err == nil {
		s.db.Exec(`UPDATE people SET title = CASE WHEN title = '' THEN ? ELSE title END, url = CASE WHEN url = '' THEN ? ELSE url END,
			email = CASE WHEN email = '' THEN ? ELSE email END, email_sure = CASE WHEN email_sure = '' THEN ? ELSE email_sure END,
			why = CASE WHEN why = '' THEN ? ELSE why END WHERE id = ?`, p.Title, p.URL, p.Email, p.EmailSure, p.Why, id)
		return id, false, nil
	}
	if p.State == "" {
		p.State = "new"
	}
	if p.Source == "" {
		p.Source = "you"
	}
	res, err := s.db.Exec(`INSERT INTO people(company_id, name, title, kind, why, url, email, email_sure, place, source, state, knows_you_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.CompanyID, p.Name, p.Title, p.Kind, p.Why, p.URL, p.Email, p.EmailSure, p.Place, p.Source, p.State, p.KnowsYouAt, s.now())
	if err != nil {
		return 0, false, err
	}
	id, _ = res.LastInsertId()
	s.Changed("people", "today")
	return id, true, nil
}

func (s *Store) SavePerson(p Person) error {
	_, err := s.db.Exec(`UPDATE people SET company_id=?, name=?, title=?, kind=?, why=?, url=?, email=?, email_sure=?, place=?, state=?, knows_you_at=? WHERE id=?`,
		p.CompanyID, p.Name, p.Title, p.Kind, p.Why, p.URL, p.Email, p.EmailSure, p.Place, p.State, p.KnowsYouAt, p.ID)
	s.Changed("people", "today")
	return err
}

func (s *Store) DeletePerson(id int64) error {
	_, err := s.db.Exec(`DELETE FROM people WHERE id = ?`, id)
	s.Changed("people", "today")
	return err
}

func (s *Store) Person(id int64) (Person, error) {
	p, err := scanPerson(s.db.QueryRow(`SELECT `+personCols+` FROM people p LEFT JOIN companies c ON c.id = p.company_id WHERE p.id = ?`, id))
	return p, notFound(err)
}

type PeopleFilter struct {
	CompanyID int64
	Kind      string
	States    []string // nil = everything except skipped
	KnowYou   bool
	Search    string
}

func (s *Store) People(f PeopleFilter) ([]Person, error) {
	w := []string{"1=1"}
	var args []any
	if f.CompanyID != 0 {
		w = append(w, `p.company_id = ?`)
		args = append(args, f.CompanyID)
	}
	if f.Kind != "" {
		w = append(w, `p.kind = ?`)
		args = append(args, f.Kind)
	}
	if len(f.States) > 0 {
		w = append(w, `p.state IN (`+strings.TrimRight(strings.Repeat("?,", len(f.States)), ",")+`)`)
		for _, st := range f.States {
			args = append(args, st)
		}
	} else {
		w = append(w, `p.state != 'skipped'`)
	}
	if f.KnowYou {
		w = append(w, `p.knows_you_at > 0`)
	}
	if q := strings.TrimSpace(f.Search); q != "" {
		w = append(w, `(p.name LIKE ? OR p.title LIKE ? OR c.name LIKE ?)`)
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}
	rows, err := s.db.Query(`SELECT `+personCols+` FROM people p LEFT JOIN companies c ON c.id = p.company_id WHERE `+strings.Join(w, " AND ")+` ORDER BY p.id DESC`, args...)
	if err != nil {
		return nil, err
	}
	var out []Person
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if n, err := s.LatestNote(out[i].ID); err == nil {
			out[i].Note = &n
		}
	}
	return out, nil
}

// KnowYou is the number of people who know who the person is: they replied,
// or the two have talked.
func (s *Store) KnowYou() (total int, byKind map[string]int) {
	byKind = map[string]int{}
	rows, err := s.db.Query(`SELECT kind, COUNT(*) FROM people WHERE knows_you_at > 0 GROUP BY kind`)
	if err != nil {
		return 0, byKind
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var n int
		rows.Scan(&k, &n)
		byKind[k] = n
		total += n
	}
	return total, byKind
}

// ---- notes to people ---------------------------------------------------------

// Note states: draft → sent → replied, or sent → quiet (no answer after the
// follow-ups). Job Hunt writes notes; only the person sends them.
type Note struct {
	ID        int64  `json:"id"`
	PersonID  int64  `json:"person_id"`
	RoleID    int64  `json:"role_id"`
	Channel   string `json:"channel"`
	Purpose   string `json:"purpose"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
	State     string `json:"state"`
	CreatedAt int64  `json:"created_at"`
	SentAt    int64  `json:"sent_at"`
	RepliedAt int64  `json:"replied_at"`
	NudgeAt   int64  `json:"nudge_at"`
}

const noteCols = `id, person_id, role_id, channel, purpose, subject, body, state, created_at, sent_at, replied_at, nudge_at`

func scanNote(sc interface{ Scan(...any) error }) (Note, error) {
	var n Note
	err := sc.Scan(&n.ID, &n.PersonID, &n.RoleID, &n.Channel, &n.Purpose, &n.Subject, &n.Body, &n.State, &n.CreatedAt, &n.SentAt, &n.RepliedAt, &n.NudgeAt)
	return n, err
}

func (s *Store) AddNote(n Note) (int64, error) {
	if n.State == "" {
		n.State = "draft"
	}
	if n.Channel == "" {
		n.Channel = "linkedin"
	}
	res, err := s.db.Exec(`INSERT INTO notes(person_id, role_id, channel, purpose, subject, body, state, created_at) VALUES(?,?,?,?,?,?,?,?)`,
		n.PersonID, n.RoleID, n.Channel, n.Purpose, n.Subject, n.Body, n.State, s.now())
	if err != nil {
		return 0, err
	}
	s.db.Exec(`UPDATE people SET state = 'active' WHERE id = ? AND state = 'new'`, n.PersonID)
	s.Changed("people", "today")
	return res.LastInsertId()
}

func (s *Store) SaveNoteText(id int64, subject, body string) error {
	_, err := s.db.Exec(`UPDATE notes SET subject = ?, body = ? WHERE id = ?`, subject, body, id)
	s.Changed("people")
	return err
}

func (s *Store) Note(id int64) (Note, error) {
	n, err := scanNote(s.db.QueryRow(`SELECT `+noteCols+` FROM notes WHERE id = ?`, id))
	return n, notFound(err)
}

func (s *Store) LatestNote(personID int64) (Note, error) {
	n, err := scanNote(s.db.QueryRow(`SELECT `+noteCols+` FROM notes WHERE person_id = ? ORDER BY id DESC LIMIT 1`, personID))
	return n, notFound(err)
}

func (s *Store) Notes(personID int64) ([]Note, error) {
	return s.queryNotes(`WHERE person_id = ? ORDER BY id`, personID)
}

func (s *Store) NotesForRole(roleID int64) ([]Note, error) {
	return s.queryNotes(`WHERE role_id = ? ORDER BY id`, roleID)
}

// NotesDue lists sent notes whose follow-up time has come.
func (s *Store) NotesDue(now int64) ([]Note, error) {
	return s.queryNotes(`WHERE state = 'sent' AND nudge_at > 0 AND nudge_at <= ? ORDER BY nudge_at`, now)
}

func (s *Store) NotesInState(state string) ([]Note, error) {
	return s.queryNotes(`WHERE state = ? ORDER BY id DESC`, state)
}

func (s *Store) queryNotes(where string, args ...any) ([]Note, error) {
	rows, err := s.db.Query(`SELECT `+noteCols+` FROM notes `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// NoteSent records that the person sent a note, and when to follow up.
func (s *Store) NoteSent(id int64, nudgeAfterDays int) error {
	now := s.now()
	_, err := s.db.Exec(`UPDATE notes SET state = 'sent', sent_at = ?, nudge_at = ? WHERE id = ?`, now, now+int64(nudgeAfterDays)*86400, id)
	s.Changed("people", "today", "progress")
	return err
}

// NoteReplied records a reply: this person now knows who the person is.
func (s *Store) NoteReplied(id int64) error {
	now := s.now()
	n, err := s.Note(id)
	if err != nil {
		return err
	}
	s.db.Exec(`UPDATE notes SET state = 'replied', replied_at = ?, nudge_at = 0 WHERE id = ?`, now, id)
	s.db.Exec(`UPDATE people SET knows_you_at = CASE WHEN knows_you_at = 0 THEN ? ELSE knows_you_at END, state = 'active' WHERE id = ?`, now, n.PersonID)
	s.Changed("people", "today", "progress")
	return nil
}

// NoteNudged pushes the follow-up out again, or lets the note go quiet.
func (s *Store) NoteNudged(id int64, againAfterDays int) {
	if againAfterDays <= 0 {
		s.db.Exec(`UPDATE notes SET state = 'quiet', nudge_at = 0 WHERE id = ?`, id)
	} else {
		s.db.Exec(`UPDATE notes SET nudge_at = ? WHERE id = ?`, s.now()+int64(againAfterDays)*86400, id)
	}
	s.Changed("people", "today")
}

func (s *Store) DeleteNote(id int64) error {
	_, err := s.db.Exec(`DELETE FROM notes WHERE id = ?`, id)
	s.Changed("people", "today")
	return err
}

// ---- conversations and interviews ---------------------------------------------

// Talk kinds: "chat" (an informal conversation), "screen" (recruiter call),
// "interview", "offer".
type Talk struct {
	ID        int64           `json:"id"`
	PersonID  int64           `json:"person_id"`
	RoleID    int64           `json:"role_id"`
	Kind      string          `json:"kind"`
	Title     string          `json:"title"`
	At        int64           `json:"at"`
	Minutes   int             `json:"minutes"`
	Link      string          `json:"link"`
	Prep      json.RawMessage `json:"prep"`
	Notes     string          `json:"notes"`
	CreatedAt int64           `json:"created_at"`

	Person  string `json:"person,omitempty"`
	Role    string `json:"role,omitempty"`
	Company string `json:"company,omitempty"`
	// The employer the talk is with, 0 when it is with no employer Job Hunt knows.
	CompanyID int64 `json:"company_id,omitempty"`
}

func (s *Store) AddTalk(t Talk) (int64, error) {
	if t.Kind == "" {
		t.Kind = "chat"
	}
	if t.Minutes == 0 {
		t.Minutes = 30
	}
	res, err := s.db.Exec(`INSERT INTO talks(person_id, role_id, kind, title, at, minutes, link, prep, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		t.PersonID, t.RoleID, t.Kind, t.Title, t.At, t.Minutes, t.Link, rawStr(t.Prep, "{}"), t.Notes, s.now())
	if err != nil {
		return 0, err
	}
	if t.PersonID != 0 {
		s.db.Exec(`UPDATE people SET knows_you_at = CASE WHEN knows_you_at = 0 THEN ? ELSE knows_you_at END, state = 'active' WHERE id = ?`, s.now(), t.PersonID)
	}
	s.Changed("talks", "today", "people", "progress")
	return res.LastInsertId()
}

func (s *Store) SaveTalk(t Talk) error {
	_, err := s.db.Exec(`UPDATE talks SET kind=?, title=?, at=?, minutes=?, link=?, prep=?, notes=? WHERE id=?`,
		t.Kind, t.Title, t.At, t.Minutes, t.Link, rawStr(t.Prep, "{}"), t.Notes, t.ID)
	s.Changed("talks", "today")
	return err
}

func (s *Store) DeleteTalk(id int64) error {
	_, err := s.db.Exec(`DELETE FROM talks WHERE id = ?`, id)
	s.Changed("talks", "today", "progress")
	return err
}

const talkSelect = `SELECT t.id, t.person_id, t.role_id, t.kind, t.title, t.at, t.minutes, t.link, t.prep, t.notes, t.created_at,
	COALESCE(p.name, ''), COALESCE(r.title, ''), COALESCE(c.name, pc.name, ''), COALESCE(c.id, pc.id, 0)
	FROM talks t LEFT JOIN people p ON p.id = t.person_id LEFT JOIN roles r ON r.id = t.role_id
	LEFT JOIN companies c ON c.id = r.company_id LEFT JOIN companies pc ON pc.id = p.company_id `

func (s *Store) queryTalks(where string, args ...any) ([]Talk, error) {
	rows, err := s.db.Query(talkSelect+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Talk
	for rows.Next() {
		var t Talk
		var prep string
		if err := rows.Scan(&t.ID, &t.PersonID, &t.RoleID, &t.Kind, &t.Title, &t.At, &t.Minutes, &t.Link, &prep, &t.Notes, &t.CreatedAt, &t.Person, &t.Role, &t.Company, &t.CompanyID); err != nil {
			return nil, err
		}
		t.Prep = raw(prep)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) Talk(id int64) (Talk, error) {
	ts, err := s.queryTalks(`WHERE t.id = ?`, id)
	if err != nil {
		return Talk{}, err
	}
	if len(ts) == 0 {
		return Talk{}, ErrNotFound
	}
	return ts[0], nil
}

// Talks lists conversations between two moments, earliest first.
func (s *Store) Talks(from, to int64) ([]Talk, error) {
	return s.queryTalks(`WHERE t.at >= ? AND t.at < ? ORDER BY t.at`, from, to)
}

func (s *Store) TalksForRole(roleID int64) ([]Talk, error) {
	return s.queryTalks(`WHERE t.role_id = ? ORDER BY t.at`, roleID)
}

func (s *Store) CountTalks(from, to int64) int {
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM talks WHERE at >= ? AND at < ?`, from, to).Scan(&n)
	return n
}

// ---- numbers for "where you stand" ---------------------------------------------

// Count runs a counting query; for the handful of figures the progress page needs.
func (s *Store) Count(query string, args ...any) int {
	var n int
	s.db.QueryRow(query, args...).Scan(&n)
	return n
}

// Pairs runs a "label, number" query.
func (s *Store) Pairs(query string, args ...any) ([]Pair, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Pair
	for rows.Next() {
		var p Pair
		if err := rows.Scan(&p.Label, &p.N); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type Pair struct {
	Label string `json:"label"`
	N     int    `json:"n"`
}

// RoleText is the little of a role the career reading counts with.
type RoleText struct {
	Title, Text, Band, Stage string
	Applied                  bool
}

// RoleTexts lists roles first seen since a moment (0 for all), with their text.
func (s *Store) RoleTexts(since int64) ([]RoleText, error) {
	rows, err := s.db.Query(`SELECT title, description, band, stage, applied_at > 0 FROM roles WHERE first_seen_at >= ?`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RoleText
	for rows.Next() {
		var r RoleText
		if err := rows.Scan(&r.Title, &r.Text, &r.Band, &r.Stage, &r.Applied); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AppliedBefore is the most recent other role at the same employer that the
// person applied to with a CV Job Hunt has: its own, the person's own file,
// or the file the old app wrote. Zero when there is none.
func (s *Store) AppliedBefore(companyID, except int64) (id int64, title string, at int64) {
	s.db.QueryRow(`SELECT r.id, r.title, r.applied_at FROM roles r
		WHERE r.company_id = ? AND r.id <> ? AND r.applied_at > 0
		AND EXISTS (SELECT 1 FROM docs d WHERE d.role_id = r.id AND d.kind IN ('cv', 'owncv', 'old_cv'))
		ORDER BY r.applied_at DESC LIMIT 1`, companyID, except).Scan(&id, &title, &at)
	return
}

// OldLeftovers lists the roles brought over from the old Job Hunt that the
// person never applied to. A role they said no to is not on it: it stays, closed,
// so the same posting is never shown again.
func (s *Store) OldLeftovers() ([]int64, error) {
	rows, err := s.db.Query(`SELECT id FROM roles
		WHERE (key LIKE 'old:%' OR id IN (SELECT role_id FROM activity WHERE kind = 'added' AND text = 'Found by the old Job Hunt'))
		AND applied_at = 0 AND stage NOT IN ('applied', 'interview', 'offer') AND closed NOT IN ('no', 'rejected', 'withdrawn')
		ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// DropRoles removes roles with their documents and history. Mail, notes and
// talks that named them stay, no longer tied to a role. Employers brought over
// from the old Job Hunt only as suggestions, and now left with nothing, go too.
func (s *Store) DropRoles(ids []int64) (companies int, err error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	for _, id := range ids {
		for _, q := range []string{
			`DELETE FROM docs WHERE role_id = ?`,
			`DELETE FROM activity WHERE role_id = ?`,
			`UPDATE notes SET role_id = 0 WHERE role_id = ?`,
			`UPDATE talks SET role_id = 0 WHERE role_id = ?`,
			`UPDATE mails SET role_id = 0 WHERE role_id = ?`,
			`DELETE FROM roles WHERE id = ?`,
		} {
			if _, err := tx.Exec(q, id); err != nil {
				return 0, err
			}
		}
	}
	res, err := tx.Exec(`DELETE FROM companies WHERE source = 'old' AND state = 'suggested'
		AND id NOT IN (SELECT company_id FROM roles)
		AND id NOT IN (SELECT company_id FROM people)
		AND id NOT IN (SELECT company_id FROM mails)`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if _, err := tx.Exec(`DELETE FROM activity WHERE company_id <> 0 AND role_id = 0 AND company_id NOT IN (SELECT id FROM companies)`); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	s.Changed("roles", "today", "progress", "companies", "people")
	return int(n), nil
}

// UntouchedOrLimited lists the open roles the person has not acted on (not
// saved, not applied to; written documents, which Job Hunt may have made on its
// own, are kept either way), and those set aside by the quick rules, so the
// limits can be applied again to both. A role said no to is not listed.
func (s *Store) UntouchedOrLimited() ([]int64, error) {
	rows, err := s.db.Query(`SELECT id FROM roles WHERE saved = 0 AND applied_at = 0
		AND ((closed = '' AND stage IN ('new','found','ready')) OR closed = 'screened')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
