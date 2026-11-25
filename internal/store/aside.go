package store

import "strings"

// Roles the program may put aside by itself: open, never prepared, applied
// to, saved or saved for later, and not added by the person. A role the
// person said no to is closed already and is never touched.
const unacted = `closed = '' AND stage IN ('new','found') AND applied_at = 0 AND saved = 0 AND later_until = 0
	AND source NOT IN ('manual','extension')
	AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.role_id = roles.id)`

// SetAsideUnacted closes (never deletes) the roles nobody has acted on that
// were first seen, and last changed, before a moment. They are set aside with
// the reason and can be brought back. It reports how many.
func (s *Store) SetAsideUnacted(before int64, why string) (int, error) {
	res, err := s.db.Exec(`UPDATE roles SET closed = 'screened', closed_why = ?, stage_at = ?, later_until = 0
		WHERE `+unacted+` AND first_seen_at < ? AND stage_at < ?`, why, s.now(), before, before)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.Changed("roles", "today", "progress")
	}
	return int(n), nil
}

// CountUnacted counts the roles SetAsideUnacted would close.
func (s *Store) CountUnacted(before int64) int {
	return s.Count(`SELECT COUNT(*) FROM roles WHERE `+unacted+` AND first_seen_at < ? AND stage_at < ?`, before, before)
}

// SetAsideUnread closes, as set aside with the reason, the open roles still
// waiting to be read (never the person's own). It reports how many.
func (s *Store) SetAsideUnread(why string) (int, error) {
	res, err := s.db.Exec(`UPDATE roles SET closed = 'screened', closed_why = ?, stage_at = ?, later_until = 0
		WHERE closed = '' AND stage = 'new' AND saved = 0 AND source NOT IN ('manual','extension')`, why, s.now())
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	s.Changed("roles", "today", "progress")
	return int(n), nil
}

// RoleIDsAtEmployers lists the roles at the given employers that the hard
// limits may set aside or bring back: open and untouched, or set aside.
func (s *Store) RoleIDsAtEmployers(ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.Query(`SELECT id FROM roles WHERE company_id IN (?`+strings.Repeat(",?", len(ids)-1)+`) AND saved = 0 AND applied_at = 0
		AND source NOT IN ('manual','extension')
		AND ((closed = '' AND stage IN ('new','found','ready')) OR closed = 'screened')`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
