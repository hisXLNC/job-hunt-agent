package brain

import (
	"context"
	"fmt"
	"strings"

	"jobhunt/internal/cv"
	"jobhunt/internal/llm"
)

// When the person answers a question Job Hunt asked, the answer may be
// something their CV should say for every application, not only for the one
// role that prompted it. CVIdea looks at one answer against one CV and, when
// it would make the CV stronger for the roles they want, proposes the one
// change that says it. Job Hunt only shows the change; the person puts it on.

type cvIdeaInput struct {
	Question, Answer, CVName string
	Units                    []cv.Unit
}

// CVIdea is the proposed change, or Worth false.
type CVIdea struct {
	Worth bool   `json:"worth"`
	ID    string `json:"id"`    // the address of the text it changes, or "sN.iM.b+" for a new bullet
	After string `json:"after"` // the full new text
	Why   string `json:"why"`   // one sentence, in plain words, for the person
}

var cvIdeaShape = llm.Obj(
	"worth", llm.Bool("true only if putting this answer on the CV would clearly help with the roles they want"),
	"id", llm.Str("the address of the one piece of text to change, as given in brackets, or sN.iM.b+ to add a bullet to item M of section N; empty when not worth it"),
	"after", llm.Str("the full new text of that piece, in the CV's own style; empty when not worth it"),
	"why", llm.Str("one plain sentence for the person: what this adds and for which kind of role; empty when not worth it"),
)

// CVIdea decides whether an answer the person gave belongs on one of their CVs.
func (b *Brain) CVIdea(ctx context.Context, p Person, base cv.CV, cvName, question, answer string) (CVIdea, error) {
	units := cv.Units(base)
	var lines strings.Builder
	for _, u := range units {
		fmt.Fprintf(&lines, "[%s] %s\n", u.ID, u.Text)
	}
	prompt := "# The question Job Hunt asked\n" + clip(question, 400) +
		"\n\n# The person's answer (true; their own words)\n" + clip(answer, 1200) +
		"\n\n# Their CV " + fmt.Sprintf("%q", cvName) + ", one addressed piece of text per line\n" + lines.String()
	out, _, err := llm.JSON[CVIdea](ctx, b.LLM, llm.Request{
		Task: "cv_idea",
		System: house + `

Your task: the person just answered a question Job Hunt asked them. Decide whether the answer is something this CV should say for every application, and if so write the one change that says it.

Worth it only when the answer is a skill, tool, certification, responsibility, scale or result that employers for the roles they want look for, and the CV does not already say it. Not worth it for availability, notice period, pay, right to work, relocation, preferences, a plain "no", or anything the CV already shows.
The change uses only what the answer and the CV say; never add a number, tool, title or duty the answer does not give. Prefer working it into the bullet or line it belongs to (keep that text and add to it, at most a third longer); add a new bullet to the right job only when it fits nowhere. Keep the CV's own tense and style.

` + p.Block(),
		Prompt: prompt,
		Schema: cvIdeaShape,
		Effort: "low",
		Input:  cvIdeaInput{Question: question, Answer: answer, CVName: cvName, Units: units},
	})
	if err != nil {
		return CVIdea{}, err
	}
	out.ID, out.After, out.Why = strings.TrimSpace(out.ID), strings.TrimSpace(out.After), strings.TrimSpace(out.Why)
	if !out.Worth || out.ID == "" || out.After == "" {
		return CVIdea{}, nil
	}
	return out, nil
}
