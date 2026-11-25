package brain

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"jobhunt/internal/llm"
)

// GroupSize is how many postings one grouped reading holds.
const GroupSize = 4

var readingsShape = llm.Obj(
	"readings", llm.Arr("one reading for each posting, in the order given", llm.Obj(
		"posting", llm.Int("the number of the posting this reading is for, starting at 1"),
		"reading", readingShape,
	)),
)

type readGroupInput struct {
	Person   Person
	Postings []Posting
}

// ErrGroupMismatch: the grouped answer did not hold one reading per posting.
var ErrGroupMismatch = errors.New("the grouped reading didn't match the postings")

// ReadRoles reads several postings against the person in one request. It is
// cheaper than one request each, and slower for the first of them. Each
// posting is judged on its own; the answer must hold exactly one reading for
// each, or ErrGroupMismatch is returned and the caller reads them one by one.
func (b *Brain) ReadRoles(ctx context.Context, p Person, posts []Posting) ([]Reading, error) {
	if len(posts) == 0 {
		return nil, nil
	}
	var prompt strings.Builder
	for i, post := range posts {
		fmt.Fprintf(&prompt, "Posting %d:\n%s\n\n", i+1, post.block())
	}
	type item struct {
		Posting int     `json:"posting"`
		Reading Reading `json:"reading"`
	}
	out, _, err := llm.JSON[struct {
		Readings []item `json:"readings"`
	}](ctx, b.LLM, llm.Request{
		Task: "read_roles",
		System: house + `

Your task: read each of several job postings against this person and say honestly how well they fit. Judge every posting on its own, as if it were the only one: never compare them with each other or let one change the score of another. For each requirement, point to the specific line of their CV that shows it; if nothing does, say so.

` + fitRubric + "\n\n" + p.Block(),
		Prompt: strings.TrimSpace(prompt.String()),
		Schema: readingsShape,
		Effort: "medium",
		Input:  readGroupInput{p, posts},
	})
	if err != nil {
		return nil, err
	}
	got := make([]Reading, len(posts))
	seen := make([]bool, len(posts))
	for _, it := range out.Readings {
		i := it.Posting - 1
		if i < 0 || i >= len(posts) || seen[i] {
			return nil, ErrGroupMismatch
		}
		seen[i] = true
		r := it.Reading
		r.Fit = min(max(r.Fit, 0), 100)
		r.Employer, r.Division = brief(r.Employer, 420), brief(r.Division, 520)
		if !knownCV(p.CVs, r.CVID) && len(p.CVs) > 0 {
			r.CVID = p.CVs[0].ID
		}
		got[i] = r
	}
	for _, ok := range seen {
		if !ok {
			return nil, ErrGroupMismatch
		}
	}
	return got, nil
}
