package store

// ResultRow is the little of an application that Progress counts with.
type ResultRow struct {
	ID        int64
	Title     string
	Company   string
	Source    string
	Band      string
	Stage     string
	Closed    string
	ClosedWhy string
	Fit       int
	Pay       string
	CVID      int64
	OwnCV     bool // the person sent their own CV file
	AppliedAt int64
	StageAt   int64
	Said      string // what the "no" mail said, in a line
}

// AppliedSince lists roles applied to since a moment (0 for all), newest first.
func (s *Store) AppliedSince(since int64) ([]ResultRow, error) {
	rows, err := s.db.Query(`SELECT r.id, r.title, COALESCE(c.name, ''), r.source, r.band, r.stage, r.closed, r.closed_why, r.fit, r.pay,
		COALESCE((SELECT CAST(json_extract(d.body, '$.cv_id') AS INTEGER) FROM docs d WHERE d.role_id = r.id AND d.kind = 'cv'), CAST(json_extract(r.reading, '$.cv_id') AS INTEGER), 0),
		EXISTS (SELECT 1 FROM docs d WHERE d.role_id = r.id AND d.kind = 'owncv'),
		r.applied_at, r.stage_at,
		COALESCE((SELECT m.summary FROM mails m WHERE m.role_id = r.id AND m.kind = 'rejection' ORDER BY m.at DESC LIMIT 1), '')
		FROM roles r LEFT JOIN companies c ON c.id = r.company_id
		WHERE r.applied_at > 0 AND r.applied_at >= ? ORDER BY r.applied_at DESC`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ResultRow
	for rows.Next() {
		var r ResultRow
		var own int
		var cvID *int64
		if err := rows.Scan(&r.ID, &r.Title, &r.Company, &r.Source, &r.Band, &r.Stage, &r.Closed, &r.ClosedWhy, &r.Fit, &r.Pay, &cvID, &own, &r.AppliedAt, &r.StageAt, &r.Said); err != nil {
			return nil, err
		}
		if cvID != nil {
			r.CVID = *cvID
		}
		r.OwnCV = own != 0
		out = append(out, r)
	}
	return out, rows.Err()
}

// SeenRow is a role first seen in a period: its title, pay and fit.
type SeenRow struct {
	Title  string
	Pay    string
	Fit    int
	Closed string
}

// SeenSince lists roles first seen since a moment.
func (s *Store) SeenSince(since, until int64) ([]SeenRow, error) {
	rows, err := s.db.Query(`SELECT title, pay, fit, closed FROM roles WHERE first_seen_at >= ? AND first_seen_at < ?`, since, until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SeenRow
	for rows.Next() {
		var r SeenRow
		if err := rows.Scan(&r.Title, &r.Pay, &r.Fit, &r.Closed); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
