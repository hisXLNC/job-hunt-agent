package store

import (
	"encoding/json"
	"errors"
	"strings"
)

// ---- leads -------------------------------------------------------------------
//
// A lead is a way in that is not a posting: someone saying in a post that they
// are hiring, news that an employer raised money or is growing, or something
// the person pasted in. Its text comes from strangers and is only ever shown,
// escaped, and read by Claude as material.

// Lead kinds: "post" (someone hiring), "news" (funding or growth), "yours".
// States: "open", "dismissed" (the person set it aside), "not_hiring" (read
// and found not to be hiring; kept so the same post is not taken in again).
type Lead struct {
	ID          int64           `json:"id"`
	Key         string          `json:"key"`
	Kind        string          `json:"kind"`
	Source      string          `json:"source"`
	Company     string          `json:"company"`
	Author      string          `json:"author"`
	AuthorTitle string          `json:"author_title"`
	AuthorURL   string          `json:"author_url"`
	Headline    string          `json:"headline"`
	Text        string          `json:"text,omitempty"`
	URL         string          `json:"url"`
	Fit         int             `json:"fit"`
	Reading     json.RawMessage `json:"reading,omitempty"`
	ReadAt      int64           `json:"read_at"`
	State       string          `json:"state"`
	SentAt      int64           `json:"sent_at"`
	FollowedAt  int64           `json:"followed_at"`
	RepliedAt   int64           `json:"replied_at"`
	RoleID      int64           `json:"role_id"`
	CompanyID   int64           `json:"company_id"`
	PersonID    int64           `json:"person_id"`
	FoundAt     int64           `json:"found_at"`
}

const leadCols = `id, key, kind, source, company, author, author_title, author_url, headline, text, url, fit, reading, read_at, state, sent_at, followed_at, replied_at, role_id, company_id, person_id, found_at`

func scanLead(sc interface{ Scan(...any) error }) (Lead, error) {
	var l Lead
	var reading string
	err := sc.Scan(&l.ID, &l.Key, &l.Kind, &l.Source, &l.Company, &l.Author, &l.AuthorTitle, &l.AuthorURL, &l.Headline, &l.Text, &l.URL, &l.Fit, &reading, &l.ReadAt, &l.State, &l.SentAt, &l.FollowedAt, &l.RepliedAt, &l.RoleID, &l.CompanyID, &l.PersonID, &l.FoundAt)
	l.Reading = raw(reading)
	return l, err
}

// AddLead records a lead unless one with the same key is already known. It
// reports the lead's id and whether it is new.
func (s *Store) AddLead(l Lead) (int64, bool, error) {
	if strings.TrimSpace(l.Key) == "" {
		return 0, false, errors.New("a lead needs a key")
	}
	var id int64
	if err := s.db.QueryRow(`SELECT id FROM leads WHERE key = ?`, l.Key).Scan(&id); err == nil {
		return id, false, nil
	}
	if l.Kind == "" {
		l.Kind = "post"
	}
	if l.Source == "" {
		l.Source = "you"
	}
	if l.State == "" {
		l.State = "open"
	}
	if l.FoundAt == 0 {
		l.FoundAt = s.now()
	}
	res, err := s.db.Exec(`INSERT INTO leads(key, kind, source, company, author, author_title, author_url, headline, text, url, fit, state, found_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		l.Key, l.Kind, l.Source, strings.TrimSpace(l.Company), strings.TrimSpace(l.Author), strings.TrimSpace(l.AuthorTitle), l.AuthorURL, strings.TrimSpace(l.Headline), l.Text, l.URL, -1, l.State, l.FoundAt)
	if err != nil {
		return 0, false, err
	}
	s.Changed("leads")
	id, _ = res.LastInsertId()
	return id, true, nil
}

func (s *Store) Lead(id int64) (Lead, error) {
	l, err := scanLead(s.db.QueryRow(`SELECT `+leadCols+` FROM leads WHERE id = ?`, id))
	return l, notFound(err)
}

// SetLeadReading keeps Claude's sizing-up of a lead. A company Claude named
// fills in an empty one; the state changes only from open (a dismissed lead
// stays dismissed).
func (s *Store) SetLeadReading(id int64, fit int, company, state string, reading any) error {
	b, err := json.Marshal(reading)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE leads SET fit = ?, reading = ?, read_at = ?, company = CASE WHEN company = '' THEN ? ELSE company END,
		state = CASE WHEN state = 'open' THEN ? ELSE state END WHERE id = ?`, fit, string(b), s.now(), strings.TrimSpace(company), state, id)
	s.Changed("leads")
	return err
}

// SaveLeadReading replaces the stored reading as it is (the person's own
// edits to the notes).
func (s *Store) SaveLeadReading(id int64, reading any) error {
	b, err := json.Marshal(reading)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE leads SET reading = ? WHERE id = ?`, string(b), id)
	s.Changed("leads")
	return err
}

// ForgetLeadReading asks for the lead to be read again.
func (s *Store) ForgetLeadReading(id int64) error {
	_, err := s.db.Exec(`UPDATE leads SET read_at = 0 WHERE id = ?`, id)
	s.Changed("leads")
	return err
}

// SetLeadState changes a lead's state: "open" or "dismissed".
func (s *Store) SetLeadState(id int64, state string) error {
	if state != "open" && state != "dismissed" {
		return errors.New("unknown lead state")
	}
	_, err := s.db.Exec(`UPDATE leads SET state = ? WHERE id = ?`, state, id)
	s.Changed("leads")
	return err
}

// SetLeadStep records one step with a lead: "sent", "followed" or "replied"
// at a moment (0 undoes it).
func (s *Store) SetLeadStep(id int64, step string, at int64) error {
	col := map[string]string{"sent": "sent_at", "followed": "followed_at", "replied": "replied_at"}[step]
	if col == "" {
		return errors.New("unknown step")
	}
	_, err := s.db.Exec(`UPDATE leads SET `+col+` = ? WHERE id = ?`, at, id)
	s.Changed("leads")
	return err
}

// LinkLead ties a lead to the role, employer or person made from it.
func (s *Store) LinkLead(id int64, what string, to int64) error {
	col := map[string]string{"role": "role_id", "company": "company_id", "person": "person_id"}[what]
	if col == "" {
		return errors.New("unknown link")
	}
	_, err := s.db.Exec(`UPDATE leads SET `+col+` = ? WHERE id = ?`, to, id)
	s.Changed("leads")
	return err
}

// LeadFilter picks leads for a list. Show: "open" (not yet written to),
// "written" (written to), "dismissed", or "" for open and written.
type LeadFilter struct {
	Show   string
	Limit  int
	Offset int
}

func (f LeadFilter) where() string {
	switch f.Show {
	case "open":
		return `state = 'open' AND sent_at = 0`
	case "written":
		return `state = 'open' AND sent_at > 0`
	case "dismissed":
		return `state = 'dismissed'`
	}
	return `state = 'open'`
}

// Leads lists leads: those to write to first by fit (unread at the end),
// those written to by when, newest first.
func (s *Store) Leads(f LeadFilter) ([]Lead, int, error) {
	w := f.where()
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM leads WHERE ` + w).Scan(&total); err != nil {
		return nil, 0, err
	}
	if f.Limit <= 0 {
		f.Limit = 60
	}
	order := `(sent_at > 0), CASE WHEN read_at = 0 THEN 1 ELSE 0 END, fit DESC, found_at DESC`
	if f.Show == "written" {
		order = `replied_at > 0, sent_at DESC`
	} else if f.Show == "dismissed" {
		order = `found_at DESC`
	}
	rows, err := s.db.Query(`SELECT `+leadCols+` FROM leads WHERE `+w+` ORDER BY `+order+` LIMIT ? OFFSET ?`, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Lead{}
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, 0, err
		}
		l.Text = ""
		out = append(out, l)
	}
	return out, total, rows.Err()
}

// LeadsToRead are open leads Claude has not sized up yet, oldest first.
func (s *Store) LeadsToRead(limit int) ([]Lead, error) {
	rows, err := s.db.Query(`SELECT `+leadCols+` FROM leads WHERE state = 'open' AND read_at = 0 ORDER BY found_at LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Lead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ---- where a role was seen ------------------------------------------------------

// SeenThrough records that a role was seen through a source, besides the one
// that brought it in first.
func (s *Store) SeenThrough(roleID int64, source string) {
	if roleID == 0 || source == "" {
		return
	}
	s.db.Exec(`INSERT OR IGNORE INTO role_seen(role_id, source, at) VALUES(?,?,?)`, roleID, source, s.now())
}

// RoleSources lists, for roles first seen since a moment, every source each
// was seen through (its own first).
func (s *Store) RoleSources(since int64) (map[int64][]string, error) {
	rows, err := s.db.Query(`SELECT r.id, r.source, COALESCE(x.source, '') FROM roles r LEFT JOIN role_seen x ON x.role_id = r.id WHERE r.first_seen_at >= ? ORDER BY r.id`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]string{}
	for rows.Next() {
		var id int64
		var own, also string
		if err := rows.Scan(&id, &own, &also); err != nil {
			return nil, err
		}
		if _, ok := out[id]; !ok {
			out[id] = []string{own}
		}
		if also != "" && also != own {
			out[id] = append(out[id], also)
		}
	}
	return out, rows.Err()
}
