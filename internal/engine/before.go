package engine

import (
	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

// EarlierRef names the CV the employer already has from the person: the one
// sent with their last application there.
type EarlierRef struct {
	RoleID int64  `json:"role_id"`
	Title  string `json:"title"`
	At     int64  `json:"at"`
}

type earlier struct {
	EarlierRef
	text string
}

// EarlierHere finds the CV the person sent this employer last time, so a new
// one can stay close to it. Nil when they have not applied there before.
func (e *Engine) EarlierHere(r store.Role) *earlier {
	if r.CompanyID == 0 {
		return nil
	}
	id, title, at := e.S.AppliedBefore(r.CompanyID, r.ID)
	if id == 0 {
		return nil
	}
	_, sent, _, err := e.RoleCV(id)
	if err != nil {
		return nil
	}
	text := cv.Text(sent)
	if text == "" {
		return nil
	}
	return &earlier{EarlierRef{RoleID: id, Title: title, At: at}, text}
}
