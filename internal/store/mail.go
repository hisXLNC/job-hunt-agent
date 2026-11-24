package store

import (
	"fmt"
	"strings"
)

// Mail is a message that arrived for the person and has to do with the
// search. Job Hunt reads mail; it never sends any.
//
// Kinds: interview, assessment, question, offer, rejection, receipt, person,
// other. States: "new" (needs the person), "done".
type Mail struct {
	ID        int64  `json:"id"`
	MsgID     string `json:"msg_id"`
	FromName  string `json:"from_name"`
	FromAddr  string `json:"from_addr"`
	Subject   string `json:"subject"`
	At        int64  `json:"at"`
	Body      string `json:"body,omitempty"`
	RoleID    int64  `json:"role_id"`
	CompanyID int64  `json:"company_id"`
	PersonID  int64  `json:"person_id"`
	Kind      string `json:"kind"`
	Summary   string `json:"summary"`
	Next      string `json:"next"`
	Draft     string `json:"draft"`
	State     string `json:"state"`
	CreatedAt int64  `json:"created_at"`

	Role    string `json:"role,omitempty"`
	Company string `json:"company,omitempty"`
}

// MailSeen reports whether a message was already taken in.
func (s *Store) MailSeen(msgID string) bool {
	return s.Count(`SELECT COUNT(*) FROM mails WHERE msg_id = ?`, msgID) > 0
}

// AddMail records a message once.
func (s *Store) AddMail(m Mail) (int64, bool, error) {
	if m.State == "" {
		m.State = "new"
	}
	if m.At == 0 {
		m.At = s.now()
	}
	res, err := s.db.Exec(`INSERT INTO mails(msg_id, from_name, from_addr, subject, at, body, role_id, company_id, person_id, kind, summary, next, draft, state, created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(msg_id) DO NOTHING`,
		m.MsgID, m.FromName, m.FromAddr, m.Subject, m.At, m.Body, m.RoleID, m.CompanyID, m.PersonID, m.Kind, m.Summary, m.Next, m.Draft, m.State, s.now())
	if err != nil {
		return 0, false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, false, nil
	}
	id, _ := res.LastInsertId()
	s.Changed("mail", "today")
	return id, true, nil
}

func (s *Store) SaveMail(m Mail) error {
	_, err := s.db.Exec(`UPDATE mails SET role_id=?, company_id=?, person_id=?, kind=?, summary=?, next=?, draft=?, state=? WHERE id=?`,
		m.RoleID, m.CompanyID, m.PersonID, m.Kind, m.Summary, m.Next, m.Draft, m.State, m.ID)
	s.Changed("mail", "today")
	return err
}

func (s *Store) DeleteMail(id int64) error {
	_, err := s.db.Exec(`DELETE FROM mails WHERE id = ?`, id)
	s.Changed("mail", "today")
	return err
}

const mailCols = `m.id, m.msg_id, m.from_name, m.from_addr, m.subject, m.at, m.role_id, m.company_id, m.person_id, m.kind, m.summary, m.next, m.draft, m.state, m.created_at, COALESCE(r.title, ''), COALESCE(c.name, '')`
const mailFrom = ` FROM mails m LEFT JOIN roles r ON r.id = m.role_id LEFT JOIN companies c ON c.id = CASE WHEN m.company_id != 0 THEN m.company_id ELSE r.company_id END`

func scanMail(sc interface{ Scan(...any) error }, extra ...any) (Mail, error) {
	var m Mail
	dst := append([]any{&m.ID, &m.MsgID, &m.FromName, &m.FromAddr, &m.Subject, &m.At, &m.RoleID, &m.CompanyID, &m.PersonID, &m.Kind, &m.Summary, &m.Next, &m.Draft, &m.State, &m.CreatedAt, &m.Role, &m.Company}, extra...)
	err := sc.Scan(dst...)
	return m, err
}

// Mail returns one message with its text.
func (s *Store) Mail(id int64) (Mail, error) {
	var body string
	m, err := scanMail(s.db.QueryRow(`SELECT `+mailCols+`, m.body`+mailFrom+` WHERE m.id = ?`, id), &body)
	m.Body = body
	return m, notFound(err)
}

// MailFilter picks messages for a list.
type MailFilter struct {
	State  string // "", "new", "done"
	Kinds  []string
	RoleID int64
	Limit  int
	Offset int
}

// Mails lists messages, newest first, without their text.
func (s *Store) Mails(f MailFilter) ([]Mail, int, error) {
	w := []string{"1=1"}
	var args []any
	if f.State != "" {
		w = append(w, `m.state = ?`)
		args = append(args, f.State)
	}
	if f.RoleID != 0 {
		w = append(w, `m.role_id = ?`)
		args = append(args, f.RoleID)
	}
	if len(f.Kinds) > 0 {
		w = append(w, `m.kind IN (`+strings.TrimRight(strings.Repeat("?,", len(f.Kinds)), ",")+`)`)
		for _, k := range f.Kinds {
			args = append(args, k)
		}
	}
	where := strings.Join(w, " AND ")
	total := s.Count(`SELECT COUNT(*) FROM mails m WHERE `+where, args...)
	if f.Limit <= 0 {
		f.Limit = 50
	}
	rows, err := s.db.Query(`SELECT `+mailCols+mailFrom+` WHERE `+where+fmt.Sprintf(` ORDER BY m.at DESC, m.id DESC LIMIT %d OFFSET %d`, f.Limit, max(f.Offset, 0)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Mail
	for rows.Next() {
		m, err := scanMail(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, rows.Err()
}

// MailRole files a message under a role found for it afterwards.
func (s *Store) MailRole(id, roleID int64) error {
	_, err := s.db.Exec(`UPDATE mails SET role_id = ? WHERE id = ?`, roleID, id)
	s.Changed("mail")
	return err
}
