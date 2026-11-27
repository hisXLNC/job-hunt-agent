package engine

import (
	"strings"
	"testing"
	"time"

	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

// An answer worth having on the CV is offered as a change, put on only when
// the person presses, and can be taken back; a plain answer offers nothing.
func TestAnswerOfferedForTheCV(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	cvs, _ := e.S.CVs()
	id := cvs[0].ID
	before, _ := e.CVModel(id)

	ask := func(text, answer string) {
		t.Helper()
		e.S.Ask(store.Question{Key: "tailor:" + store.QuestionKey(text), Text: text, Weight: 10})
		qs, _ := e.S.OpenQuestions()
		for _, q := range qs {
			if q.Text == text {
				if err := e.Answer(q.ID, answer); err != nil {
					t.Fatal(err)
				}
				return
			}
		}
		t.Fatal("question not queued")
	}
	ask("Have you led a team?", "No")
	ask("Did you configure Vertex O Series tax rules yourself?", "Yes, I configured the Vertex O Series tax rules for 14 countries")

	var ideas []CVIdea
	for i := 0; i < 300 && len(ideas) == 0; i++ {
		time.Sleep(10 * time.Millisecond)
		ideas = e.CVIdeas()
	}
	if len(ideas) != 1 || !strings.Contains(ideas[0].Change.After, "Vertex O Series") {
		t.Fatalf("ideas: %+v", ideas)
	}
	if after, _ := e.CVModel(id); cv.Text(after) != cv.Text(before) {
		t.Fatal("the CV changed before the person pressed anything")
	}
	if b := e.Today(); len(b.CVIdeas) != 1 {
		t.Errorf("Today shows %d", len(b.CVIdeas))
	}
	x := ideas[0]
	if err := e.UseCVIdea(x.ID, ""); err != nil {
		t.Fatal(err)
	}
	m, _ := e.CVModel(id)
	if got, _ := cv.Get(m, x.Change.ID); got != x.Change.After {
		t.Errorf("not on the CV: %q", got)
	}
	if c, _ := e.S.CV(id); !strings.Contains(c.Text, "Vertex O Series") {
		t.Error("the text Claude reads didn't change")
	}
	if len(e.CVIdeas()) != 0 {
		t.Error("still offered after it was put on")
	}
	if look, _ := e.LookAtCV(id); len(look.FromAnswers) != 1 {
		t.Errorf("not listed under the CV: %+v", look.FromAnswers)
	}
	if err := e.UndoCVIdea(x.ID); err != nil {
		t.Fatal(err)
	}
	if m, _ := e.CVModel(id); cv.Text(m) != cv.Text(before) {
		t.Error("taking it back didn't restore the CV")
	}
	if len(e.CVIdeas()) != 1 {
		t.Error("not offered again after taking it back")
	}
	if err := e.NoCVIdea(x.ID); err != nil || len(e.CVIdeas()) != 0 {
		t.Errorf("no thanks: %v", err)
	}
}
