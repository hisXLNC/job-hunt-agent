package engine

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/trace"
)

// What holds the person's fit back: the requirements the readings of the
// last 60 days' roles found missing or only partly shown, counted by Job Hunt
// and grouped into themes by Claude. A theme the CV already shows under other
// words comes with a true sentence the person can keep as a fact; every later
// reading and tailoring uses their facts.

const (
	fitGapsKey  = "fit_gaps"
	fitGapsDays = 60
	// fitGapsLeast is how many read roles there must be before the themes say anything.
	fitGapsLeast = 8
)

// FitGapView is one theme as the page shows it.
type FitGapView struct {
	Theme    string   `json:"theme"`
	Roles    int      `json:"roles"` // how many roles ask for it
	Kind     string   `json:"kind"`  // shown, real
	Why      string   `json:"why"`
	Fact     string   `json:"fact,omitempty"`
	Close    string   `json:"close,omitempty"`
	Examples []string `json:"examples"` // the postings' own words, a few
	Kept     bool     `json:"kept"`     // the fact is among the person's facts
}

// FitGapsView is the section on Career path.
type FitGapsView struct {
	Has     bool         `json:"has"`
	At      int64        `json:"at"`
	Roles   int          `json:"roles"` // read roles the themes come from
	Gaps    []FitGapView `json:"gaps"`
	Busy    bool         `json:"busy"`
	CanLook bool         `json:"can_look"`
	Enough  bool         `json:"enough"` // there are enough read roles to look
}

type fitGapsDoc struct {
	At    int64        `json:"at"`
	Roles int          `json:"roles"`
	Gaps  []FitGapView `json:"gaps"`
}

// gapItems counts, over the roles read in the last 60 days, each requirement
// the reading marked as a gap or partly shown. The roles the person said no
// to are left out: they say nothing about what they want.
func (e *Engine) gapItems() (items []brain.GapItem, ids [][]int, roles int) {
	since := e.Now().Add(-fitGapsDays * 24 * time.Hour).Unix()
	rows, _ := e.S.Pairs(`SELECT reading, id FROM roles WHERE fit >= 0 AND first_seen_at >= ? AND closed != 'no' ORDER BY id DESC LIMIT 600`, since)
	type count struct {
		ask            string
		roles, missing int
		ids            []int
	}
	by := map[string]*count{}
	for _, row := range rows {
		var rd brain.Reading
		if json.Unmarshal([]byte(row.Label), &rd) != nil || len(rd.Asks) == 0 {
			continue
		}
		roles++
		seen := map[string]bool{}
		for _, a := range rd.Asks {
			if a.Strength != "gap" && a.Strength != "partly" {
				continue
			}
			ask := strings.Join(strings.Fields(a.Ask), " ")
			key := strings.ToLower(strings.TrimRight(ask, ". "))
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			c := by[key]
			if c == nil {
				c = &count{ask: ask}
				by[key] = c
			}
			c.roles++
			c.ids = append(c.ids, row.N)
			if a.Strength == "gap" {
				c.missing++
			}
		}
	}
	list := make([]*count, 0, len(by))
	for _, c := range by {
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].roles != list[j].roles {
			return list[i].roles > list[j].roles
		}
		return list[i].ask < list[j].ask
	})
	if len(list) > 150 {
		list = list[:150]
	}
	for _, c := range list {
		items = append(items, brain.GapItem{Ask: c.ask, Roles: c.roles, Missing: c.missing})
		ids = append(ids, c.ids)
	}
	return items, ids, roles
}

// FitGaps is what the page shows: the last look, with which facts are kept.
func (e *Engine) FitGaps() FitGapsView {
	v := FitGapsView{Busy: e.Busy("fitgaps"), CanLook: e.LLM().Engine != "", Gaps: []FitGapView{}}
	var doc fitGapsDoc
	if ok, _ := e.S.Get(fitGapsKey, &doc); ok && doc.At > 0 {
		v.Has, v.At, v.Roles, v.Gaps = true, doc.At, doc.Roles, doc.Gaps
	}
	if v.Gaps == nil {
		v.Gaps = []FitGapView{}
	}
	facts, _ := e.S.Facts()
	for i, g := range v.Gaps {
		for _, f := range facts {
			if g.Fact != "" && strings.EqualFold(strings.TrimSpace(f.Text), strings.TrimSpace(g.Fact)) {
				v.Gaps[i].Kept = true
			}
		}
	}
	if !v.Has {
		_, _, n := e.gapItems()
		v.Enough = n >= fitGapsLeast
	} else {
		v.Enough = true
	}
	return v
}

// LookFitGaps asks Claude to group what the readings found missing. One request.
func (e *Engine) LookFitGaps() error {
	items, ids, roles := e.gapItems()
	if roles < fitGapsLeast {
		return errors.New("Job Hunt has read only " + countWord(roles, "role") + " in the last 60 days; it needs " + countWord(fitGapsLeast, "role") + " to see what comes up again and again")
	}
	e.Go("fitgaps", "Finding what holds your fit back", func(ctx context.Context) error {
		got, err := e.brain.FitGaps(ctx, brain.FitGapsInput{Person: e.Person(), Items: items, Roles: roles})
		if err != nil {
			return err
		}
		doc := fitGapsDoc{At: e.Now().Unix(), Roles: roles}
		for _, g := range got {
			v := FitGapView{Theme: clipText(g.Theme, 120), Kind: g.Kind, Why: clipText(g.Why, 400), Examples: []string{}}
			if g.Kind == "shown" {
				v.Fact = clipText(g.Fact, 400)
			} else {
				v.Kind, v.Close = "real", clipText(g.Close, 400)
			}
			// The count is Job Hunt's own: the roles that asked for any line
			// of the theme, each once.
			in := map[int]bool{}
			for _, n := range g.Items {
				if n >= 1 && n <= len(items) {
					for _, id := range ids[n-1] {
						in[id] = true
					}
					if len(v.Examples) < 3 {
						v.Examples = append(v.Examples, items[n-1].Ask)
					}
				}
			}
			if len(in) == 0 || strings.TrimSpace(v.Theme) == "" {
				continue
			}
			v.Roles = len(in)
			doc.Gaps = append(doc.Gaps, v)
		}
		sort.SliceStable(doc.Gaps, func(i, j int) bool { return doc.Gaps[i].Roles > doc.Gaps[j].Roles })
		trace.Log("did", "found %d things that hold the fit back, over %d roles", len(doc.Gaps), roles)
		return e.S.Set(fitGapsKey, doc)
	})
	return nil
}
