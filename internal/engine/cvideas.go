package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"

	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

// An answer the person gives Job Hunt may belong on their CV for every
// application, not only on the one role that asked. After each answer Job
// Hunt asks Claude, once per CV, whether it would make the CV stronger; when
// it would, it tells the person (the bell and Today) and shows the change.
// Nothing is changed until they press "Put it on my CV", and that can be
// taken back.

const cvIdeasKey = "cv_ideas"

// CVIdea is one suggested change to one of the person's CVs.
type CVIdea struct {
	ID       int64     `json:"id"`
	At       int64     `json:"at"`
	CVID     int64     `json:"cv_id"`
	CVName   string    `json:"cv_name"`
	Question string    `json:"question"`
	Answer   string    `json:"answer"`
	Change   cv.Change `json:"change"`
	State    string    `json:"state"` // open, used, no
}

type cvIdeaBook struct {
	Next int64    `json:"next"`
	List []CVIdea `json:"list"` // oldest first; the newest 40 are kept
}

var cvIdeaMu sync.Mutex

// cvIdeaLooks names each look, so two answers in a row are both looked at.
var cvIdeaLooks atomic.Int64

func (e *Engine) cvIdeaBook() cvIdeaBook {
	var b cvIdeaBook
	e.S.Get(cvIdeasKey, &b)
	return b
}

// CVIdeas lists the suggestions still waiting for the person.
func (e *Engine) CVIdeas() []CVIdea {
	out := []CVIdea{}
	for _, x := range e.cvIdeaBook().List {
		if x.State == "open" {
			out = append(out, x)
		}
	}
	return out
}

// lookForCVIdeas asks, in the background, whether an answer belongs on the
// person's CVs.
func (e *Engine) lookForCVIdeas(question, answer string) {
	if strings.TrimSpace(answer) == "" || e.LLM().Engine == "" {
		return
	}
	cvs, _ := e.S.CVs()
	if len(cvs) == 0 {
		return
	}
	e.Go(fmt.Sprintf("cvidea:%d", cvIdeaLooks.Add(1)), "Seeing whether your answer belongs on your CV", func(ctx context.Context) error {
		p := e.Person()
		for i, c := range cvs {
			if i >= 3 || ctx.Err() != nil {
				break
			}
			m, err := e.CVModel(c.ID)
			if err != nil {
				continue
			}
			idea, err := e.brain.CVIdea(ctx, p, m, c.Name, question, answer)
			if err != nil {
				if stopsWork(err) {
					return err
				}
				continue
			}
			if idea.ID == "" {
				continue
			}
			before, err := cv.Get(m, idea.ID)
			if err != nil || norm(before) == norm(idea.After) {
				continue
			}
			ch := cv.Change{ID: idea.ID, Before: before, After: clipText(idea.After, 600), Why: clipText(idea.Why, 300)}
			if _, skipped := cv.Apply(m, []cv.Change{ch}); len(skipped) > 0 {
				continue
			}
			e.addCVIdea(CVIdea{CVID: c.ID, CVName: c.Name, Question: clipText(question, 300), Answer: clipText(answer, 1200), Change: ch})
		}
		return nil
	})
}

func (e *Engine) addCVIdea(x CVIdea) {
	cvIdeaMu.Lock()
	b := e.cvIdeaBook()
	for _, y := range b.List {
		if y.CVID == x.CVID && y.Change.ID == x.Change.ID && norm(y.Change.After) == norm(x.Change.After) {
			cvIdeaMu.Unlock()
			return
		}
	}
	b.Next++
	x.ID, x.At, x.State = b.Next, e.Now().Unix(), "open"
	b.List = append(b.List, x)
	if len(b.List) > 40 {
		b.List = b.List[len(b.List)-40:]
	}
	e.S.Set(cvIdeasKey, b)
	cvIdeaMu.Unlock()
	e.Keep("app", "Your answer could make your CV stronger", "See the change for your "+x.CVName+" on Today. Nothing changes until you put it on.", "#/today")
	e.S.Changed("today")
}

func (e *Engine) cvIdea(id int64) (CVIdea, cvIdeaBook, int, error) {
	b := e.cvIdeaBook()
	for i, x := range b.List {
		if x.ID == id {
			return x, b, i, nil
		}
	}
	return CVIdea{}, b, -1, store.ErrNotFound
}

// UseCVIdea puts a suggested change on the CV, in the person's own wording
// when they gave one. The CV is used this way for every role prepared after.
func (e *Engine) UseCVIdea(id int64, wording string) error {
	cvIdeaMu.Lock()
	defer cvIdeaMu.Unlock()
	x, b, i, err := e.cvIdea(id)
	if err != nil {
		return err
	}
	if x.State == "used" {
		return nil
	}
	ch := x.Change
	if w := strings.TrimSpace(wording); w != "" {
		ch.After, ch.Mine = clipText(w, 600), true
	}
	if err := e.changeCV(x.CVID, ch); err != nil {
		return err
	}
	b.List[i].State, b.List[i].Change = "used", ch
	e.S.Set(cvIdeasKey, b)
	e.S.Log(store.Activity{Kind: "cv", Text: "Put on your " + x.CVName + ": " + clipText(ch.After, 140)})
	e.S.Changed("today", "you")
	return nil
}

// UndoCVIdea takes a change back off the CV and offers it again.
func (e *Engine) UndoCVIdea(id int64) error {
	cvIdeaMu.Lock()
	defer cvIdeaMu.Unlock()
	x, b, i, err := e.cvIdea(id)
	if err != nil {
		return err
	}
	if x.State != "used" {
		return nil
	}
	back := cv.Change{ID: x.Change.ID, Before: x.Change.After, After: x.Change.Before}
	if prefix, ok := strings.CutSuffix(x.Change.ID, "b+"); ok {
		// The added bullet is wherever it ended up in that job.
		m, err := e.CVModel(x.CVID)
		if err != nil {
			return err
		}
		back.ID = ""
		for _, u := range cv.Units(m) {
			if strings.HasPrefix(u.ID, prefix+"b") && norm(u.Text) == norm(x.Change.After) {
				back = cv.Change{ID: u.ID, Before: u.Text, After: ""}
			}
		}
		if back.ID == "" {
			return errors.New("that line is no longer on your CV")
		}
	}
	if err := e.changeCV(x.CVID, back); err != nil {
		return err
	}
	b.List[i].State = "open"
	e.S.Set(cvIdeasKey, b)
	e.S.Log(store.Activity{Kind: "cv", Text: "Took back off your " + x.CVName + ": " + clipText(x.Change.After, 140)})
	e.S.Changed("today", "you")
	return nil
}

// NoCVIdea sets a suggestion aside.
func (e *Engine) NoCVIdea(id int64) error {
	cvIdeaMu.Lock()
	defer cvIdeaMu.Unlock()
	_, b, i, err := e.cvIdea(id)
	if err != nil {
		return err
	}
	b.List[i].State = "no"
	e.S.Set(cvIdeasKey, b)
	e.S.Changed("today")
	return nil
}

// changeCV makes one change to a CV's structure and to the text Claude reads.
// The text where it was is checked first: a CV that changed since says so.
func (e *Engine) changeCV(cvID int64, ch cv.Change) error {
	c, err := e.S.CV(cvID)
	if err != nil {
		return err
	}
	m, err := e.CVModel(cvID)
	if err != nil {
		return err
	}
	if !strings.HasSuffix(ch.ID, "b+") {
		now, err := cv.Get(m, ch.ID)
		if err != nil || norm(now) != norm(ch.Before) {
			return errors.New("that part of your CV has changed since, so this no longer fits it")
		}
	}
	out, skipped := cv.Apply(m, []cv.Change{ch})
	if len(skipped) > 0 {
		return errors.New("that part of your CV is no longer there")
	}
	mb, err := json.Marshal(out)
	if err != nil {
		return err
	}
	c.Model = mb
	switch {
	case ch.Before != "" && strings.Contains(c.Text, ch.Before):
		c.Text = strings.Replace(c.Text, ch.Before, ch.After, 1)
	case ch.Before == "" && ch.After != "":
		c.Text = strings.TrimRight(c.Text, "\n") + "\n" + ch.After + "\n"
	default:
		c.Text = cv.Text(out)
	}
	return e.S.UpdateCV(c)
}
