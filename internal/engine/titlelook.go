package engine

import (
	"context"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// titleAside is why a role was set aside when only its title's wording missed.
const titleAside = "Title isn't in your field"

// titleLookMax caps the titles given a second look in one search.
const titleLookMax = 120

// secondLook asks Claude about titles the word rules set aside in this
// search: one worded in a way the rules don't know (another country's word
// for the job, an internal title) is brought back and read. Only titles are
// sent. It returns the roles brought back.
func (e *Engine) secondLook(ctx context.Context, p store.Profile, stats *RunStats) []int64 {
	ids := stats.titleAside
	stats.titleAside = nil
	var back []int64
	// What stays set aside keeps no text, like any role the rules set aside.
	defer func() {
		kept := map[int64]bool{}
		for _, id := range back {
			kept[id] = true
		}
		for _, id := range ids {
			if !kept[id] {
				e.S.DropText(id)
			}
		}
	}()
	if len(ids) == 0 || ctx.Err() != nil {
		return nil
	}
	all := ids
	if len(all) > titleLookMax {
		all = all[len(all)-titleLookMax:]
	}
	var wanted []string
	for _, t := range p.Titles.All() {
		wanted = append(wanted, t.Title)
	}
	if len(wanted) == 0 {
		return nil
	}
	// One question per title: the same title from several places is asked once.
	byTitle := map[string][]int64{}
	var titles []string
	for _, id := range all {
		r, err := e.S.Role(id)
		if err != nil || r.Closed != "screened" {
			continue
		}
		if _, ok := byTitle[r.Title]; !ok {
			titles = append(titles, r.Title)
		}
		byTitle[r.Title] = append(byTitle[r.Title], id)
	}
	for start := 0; start < len(titles); start += 60 {
		end := min(start+60, len(titles))
		part := titles[start:end]
		keep, err := e.brain.TitlesInField(ctx, wanted, p.Domain, part)
		if err != nil {
			trace.Log("search", "second look at titles: %v", err)
			break
		}
		for _, i := range keep {
			for _, id := range byTitle[part[i]] {
				if ok, _ := e.S.Unscreen(id); ok {
					back = append(back, id)
					stats.Cleared--
					if stats.ClearedBy[titleAside] > 0 {
						stats.ClearedBy[titleAside]--
					}
				}
			}
		}
	}
	stats.broughtBack(back)
	if len(back) > 0 {
		trace.Log("search", "second look at titles brought back %d of %d", len(back), len(all))
	}
	return back
}
