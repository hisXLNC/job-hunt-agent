package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/cv"
	"jobhunt/internal/office"
	"jobhunt/internal/store"
)

// Each CV's own controls: the titles and words it is meant for, its letter
// style, finding more titles, putting a new file in its place, and what
// happens to the roles waiting on it when it changes or goes.

// CVSet is what the person set for one CV.
type CVSet struct {
	Titles      []string `json:"titles"`
	Keywords    []string `json:"keywords"`
	LetterStyle string   `json:"letter_style"` // "" = the style under About you
}

func cvSetKey(id int64) string { return fmt.Sprintf("cvset:%d", id) }

// CVSet is what the person set for a CV.
func (e *Engine) CVSet(id int64) CVSet {
	var set CVSet
	e.S.Get(cvSetKey(id), &set)
	if !store.KnownLetterStyle(set.LetterStyle) {
		set.LetterStyle = ""
	}
	return set
}

func (e *Engine) fillCVSet(c *store.CV) {
	set := e.CVSet(c.ID)
	c.Titles, c.Keywords, c.LetterStyle = set.Titles, set.Keywords, set.LetterStyle
}

// tidyList trims, drops empties and repeats (in any case), and keeps at most n.
func tidyList(in []string, n int) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.Join(strings.Fields(s), " ")
		if r := []rune(s); len(r) > 80 {
			s = string(r[:80])
		}
		if s == "" || seen[strings.ToLower(s)] {
			continue
		}
		seen[strings.ToLower(s)] = true
		out = append(out, s)
		if len(out) == n {
			break
		}
	}
	return out
}

// SetCVSet saves what the person set for a CV. A title new to the search is
// added to the titles Job Hunt looks for, at the person's level.
func (e *Engine) SetCVSet(id int64, set CVSet) error {
	if _, err := e.S.CV(id); err != nil {
		return err
	}
	if set.LetterStyle != "" && !store.KnownLetterStyle(set.LetterStyle) {
		return errors.New("unknown letter style")
	}
	set.Titles, set.Keywords = tidyList(set.Titles, 20), tidyList(set.Keywords, 30)
	if err := e.S.Set(cvSetKey(id), set); err != nil {
		return err
	}
	p := e.S.Profile()
	have := map[string]bool{}
	for _, t := range p.Titles.All() {
		have[strings.ToLower(t.Title)] = true
	}
	added := false
	for _, t := range set.Titles {
		if !have[strings.ToLower(t)] {
			p.Titles.Level = append(p.Titles.Level, t)
			have[strings.ToLower(t)] = true
			added = true
		}
	}
	if added {
		if err := e.S.SaveProfile(p); err != nil {
			return err
		}
	}
	e.S.Changed("you")
	return nil
}

// MoreTitles asks Claude for job titles this CV suits that are not yet on
// its list or searched for. Nothing is added until the person picks them.
func (e *Engine) MoreTitles(ctx context.Context, id int64) ([]string, error) {
	c, err := e.S.CV(id)
	if err != nil {
		return nil, err
	}
	p := e.S.Profile()
	prop, err := e.brain.Propose(ctx, c.Text, strings.TrimSpace(p.City+" "+p.Country))
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, t := range p.Titles.All() {
		have[strings.ToLower(strings.TrimSpace(t.Title))] = true
	}
	for _, t := range e.CVSet(id).Titles {
		have[strings.ToLower(strings.TrimSpace(t))] = true
	}
	var out []string
	for _, t := range append(append(prop.Level, prop.StepUp...), prop.Sideways...) {
		t = strings.Join(strings.Fields(t), " ")
		if t != "" && !have[strings.ToLower(t)] {
			have[strings.ToLower(t)] = true
			out = append(out, t)
		}
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out, nil
}

// CVLook is what the CV page shows about one CV.
type CVLook struct {
	CV       store.CV   `json:"cv"`
	Model    cv.CV      `json:"model"`
	ATS      []ReadNote `json:"ats"`
	Set      CVSet      `json:"set"`
	Waiting  int        `json:"waiting"`  // roles waiting that use it
	Redoing  bool       `json:"redoing"`  // those are being scored and tailored again now
	Readable bool       `json:"readable"` // what Claude read could be shown
}

// LookAtCV gathers a CV's controls for the page: what Claude read from it,
// whether a screening system reads it, and what the person set.
func (e *Engine) LookAtCV(id int64) (CVLook, error) {
	c, err := e.S.CV(id)
	if err != nil {
		return CVLook{}, err
	}
	c.Text, c.Model = "", nil
	out := CVLook{CV: c, Set: e.CVSet(id), Waiting: len(e.waitingOn(id)), Redoing: e.Busy("cvredo")}
	if m, err := e.CVModel(id); err == nil {
		out.Model, out.ATS, out.Readable = m, Readable(m), true
	}
	return out, nil
}

// ReplaceCV puts a new file in place of a CV. Its name and what the person
// set for it stay; the roles waiting on it are scored and tailored again.
func (e *Engine) ReplaceCV(ctx context.Context, id int64, filename string, data []byte) (int, error) {
	if _, err := e.S.CV(id); err != nil {
		return 0, err
	}
	text, err := office.ExtractText(filename, data)
	if err != nil {
		return 0, err
	}
	if len(strings.Fields(text)) < 60 {
		return 0, errors.New("that file has very little text in it. Is it the right one?")
	}
	model, err := e.brain.StructureCV(ctx, text)
	if err != nil {
		return 0, err
	}
	mb, _ := json.Marshal(model)
	if err := e.S.ReplaceCVFile(id, filename, data, text, mb); err != nil {
		return 0, err
	}
	e.S.Log(store.Activity{Kind: "cv", Text: fmt.Sprintf("Put %q in place of your %s", filename, e.cvName(id))})
	return e.RedoForCV(id), nil
}

// RemoveCV removes a CV. The roles waiting on it are scored and tailored
// again from the CVs that are left.
func (e *Engine) RemoveCV(id int64) (int, error) {
	cvs, _ := e.S.CVs()
	if len(cvs) <= 1 {
		return 0, errors.New("Keep at least one CV. Add the new one first, then remove this one.")
	}
	name := e.cvName(id)
	waiting := e.waitingOn(id)
	if err := e.S.DeleteCV(id); err != nil {
		return 0, err
	}
	e.S.Set(cvSetKey(id), nil)
	e.S.Log(store.Activity{Kind: "cv", Text: "Removed your " + name})
	return e.redo(waiting), nil
}

// waitingOn lists the roles not yet applied to that were read against or
// tailored from a CV.
func (e *Engine) waitingOn(cvID int64) []int64 {
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"found", "ready"}, Sort: "age", Limit: 500})
	var out []int64
	for _, x := range roles {
		if x.AppliedAt != 0 || x.Closed != "" {
			continue
		}
		r, err := e.S.Role(x.ID)
		if err != nil {
			continue
		}
		used := readingOf(r).CVID == cvID
		var doc TailoredCV
		if ok, _ := e.S.Doc(r.ID, "cv", &doc); ok && doc.CVID == cvID {
			used = true
		}
		if used {
			out = append(out, r.ID)
		}
	}
	return out
}

const redoKey = "cvredo:waiting"

// RedoForCV scores and tailors again, in the background, the roles waiting
// on a CV that changed. It returns how many there are.
func (e *Engine) RedoForCV(cvID int64) int { return e.redo(e.waitingOn(cvID)) }

func (e *Engine) redo(ids []int64) int {
	if len(ids) == 0 {
		return 0
	}
	// Kept in the data, so a later change joins the work already under way
	// and nothing is lost if Job Hunt stops half way.
	var queue []int64
	e.S.Get(redoKey, &queue)
	seen := map[int64]bool{}
	for _, id := range queue {
		seen[id] = true
	}
	for _, id := range ids {
		if !seen[id] {
			queue = append(queue, id)
			seen[id] = true
		}
	}
	e.S.Set(redoKey, queue)
	e.RunRedo()
	return len(ids)
}

// RunRedo starts the waiting re-scoring, if there is any and Claude is there.
func (e *Engine) RunRedo() {
	var queue []int64
	if e.S.Get(redoKey, &queue); len(queue) == 0 || e.LLM().Engine == "" {
		return
	}
	e.Go("cvredo", "Scoring and tailoring again for your changed CV", func(ctx context.Context) error {
		done := 0
		for {
			var queue []int64
			e.S.Get(redoKey, &queue)
			if len(queue) == 0 || ctx.Err() != nil {
				break
			}
			e.Report(ctx, done, done+len(queue), "")
			if err := e.redoRole(ctx, queue[0]); err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				e.problem("Scoring a role again for your changed CV", err)
			}
			e.S.Get(redoKey, &queue)
			if len(queue) > 0 {
				queue = queue[1:]
			}
			e.S.Set(redoKey, queue)
			done++
		}
		e.S.Changed("roles", "today", "you")
		return nil
	})
}

// redoRole reads one waiting role again against the CVs as they are now
// and, when it had documents, writes them again, keeping what the person
// changed by hand: their own wording of a line, the changes they switched
// off, and a letter they edited.
func (e *Engine) redoRole(ctx context.Context, id int64) error {
	r, err := e.S.Role(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return err
	}
	if r.Closed != "" || r.AppliedAt != 0 {
		return nil
	}
	var oldCV TailoredCV
	hadCV, _ := e.S.Doc(id, "cv", &oldCV)
	var oldLetter LetterDoc
	hadLetter, _ := e.S.Doc(id, "letter", &oldLetter)

	p := e.Person()
	if len(p.CVs) == 0 {
		return errors.New("add a CV first")
	}
	post := postingOf(r)
	if co, err := e.S.Company(r.CompanyID); err == nil {
		post.About = co.About
	}
	rctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	reading, err := e.brain.ReadRole(rctx, p, post)
	cancel()
	if err != nil {
		return err
	}
	band := reading.Band
	if band == "other" || band == "" {
		band = r.Band
	}
	if err := e.S.SetReading(id, reading.Fit, band, reading); err != nil {
		return err
	}
	e.payFromReading(r, reading)
	text := fmt.Sprintf("Scored again against your %s: %d", e.cvName(reading.CVID), reading.Fit)
	if hadCV {
		if err := e.Prepare(ctx, id); err != nil {
			return err
		}
		e.keepOwnEdits(id, oldCV, hadLetter, oldLetter)
		text += ", and the CV and letter written again with your own edits kept"
	}
	e.S.Log(store.Activity{Kind: "read", RoleID: id, CompanyID: r.CompanyID, Text: text + ", because your CV changed"})
	return nil
}

// keepOwnEdits puts the person's own edits back after the documents were
// written again.
func (e *Engine) keepOwnEdits(id int64, oldCV TailoredCV, hadLetter bool, oldLetter LetterDoc) {
	if hadLetter && oldLetter.Own && strings.TrimSpace(oldLetter.Text) != "" {
		var now LetterDoc
		if ok, _ := e.S.Doc(id, "letter", &now); ok {
			now.Text, now.Own = oldLetter.Text, true
			e.S.SaveDoc(id, "letter", now)
		}
	}
	var doc TailoredCV
	if ok, _ := e.S.Doc(id, "cv", &doc); !ok {
		return
	}
	base, err := e.CVModel(doc.CVID)
	if err != nil {
		return
	}
	units := map[string]string{} // text → address in the CV now
	for _, u := range cv.Units(base) {
		if _, ok := units[norm(u.Text)]; !ok {
			units[norm(u.Text)] = u.ID
		}
	}
	changed := false
	for _, old := range oldCV.Changes {
		if !old.Mine && !old.Off {
			continue
		}
		j := -1
		for i, c := range doc.Changes {
			if norm(c.Before) == norm(old.Before) && (j < 0 || c.ID == old.ID) {
				j = i
			}
		}
		switch {
		case j >= 0:
			if old.Off {
				doc.Changes[j].Off = true
			}
			if old.Mine {
				doc.Changes[j].After, doc.Changes[j].Mine, doc.Changes[j].Off = old.After, true, old.Off
			}
			changed = true
		case old.Mine && units[norm(old.Before)] != "":
			// A line the person reworded that the new tailoring left alone.
			doc.Changes = append(doc.Changes, cv.Change{ID: units[norm(old.Before)], Before: old.Before, After: old.After, Why: old.Why, Off: old.Off, Mine: true})
			changed = true
		}
	}
	if changed {
		e.S.SaveDoc(id, "cv", doc)
	}
}

func norm(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

// ---- follow-ups, all at once ----------------------------------------------------------------

// ChasesToWrite are the applications due a follow-up that has none written yet.
func (e *Engine) ChasesToWrite() []int64 {
	var out []int64
	for _, r := range e.quietApplications(e.S.Profile(), e.Now()) {
		var ch ChaseDoc
		if ok, _ := e.S.Doc(r.ID, "chase", &ch); ok && (ch.Body != "" || ch.SentAt > 0 || ch.DroppedAt > 0) {
			continue
		}
		if r.AppliedAt == 0 || r.Closed != "" {
			continue
		}
		out = append(out, r.ID)
	}
	return out
}

// WriteAllChases writes every follow-up that is due, one after another, in
// the background. Nothing is sent: each waits for the person to read it.
func (e *Engine) WriteAllChases() (int, error) {
	ids := e.ChasesToWrite()
	if len(ids) == 0 {
		return 0, errors.New("There are no follow-ups to write.")
	}
	if !e.Go("chases", "Writing your follow-ups", func(ctx context.Context) error {
		for i, id := range ids {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			e.Report(ctx, i, len(ids), "")
			if err := e.WriteChase(ctx, id); err != nil && ctx.Err() == nil {
				e.problem("Writing a follow-up", err)
			}
			e.S.Changed("today", "roles")
		}
		return nil
	}) {
		return 0, errors.New("Follow-ups are being written already.")
	}
	return len(ids), nil
}
