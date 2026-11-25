package engine

import (
	"jobhunt/internal/store"
)

// What each search decided about each posting, kept per kind of source until
// that source is asked again, so the person can see every posting a source
// gave last time: new, already here, or skipped and why. Nothing is asked of
// any source for this; it is what the search decided anyway.

// PostingOutcome is what one search decided about one posting.
type PostingOutcome struct {
	RoleID   int64  `json:"role_id,omitempty"` // none when no role was kept (a muted employer)
	Title    string `json:"title"`
	Company  string `json:"company"`
	Location string `json:"location,omitempty"`
	From     string `json:"from,omitempty"` // where in the source: an employer, "Tax Manager in Hamilton"
	Outcome  string `json:"outcome"`        // "new" | "here" | "skipped"
	Why      string `json:"why,omitempty"`  // why it was skipped
}

// SourceLog is every posting one kind of source gave in the last search that
// asked it.
type SourceLog struct {
	At       int64            `json:"at"`
	Run      string           `json:"run"`   // "full" or "fast"
	Total    int              `json:"total"` // postings, kept or not
	Counts   map[string]int   `json:"counts"`
	Postings []PostingOutcome `json:"postings"`
}

// mostKept is how many postings of one source are kept for the list; the
// counts cover them all.
const mostKept = 1000

func outcomeKey(kind string) string { return "searchlog:" + kind }

// reading notes which source, and which part of it, the next postings come from.
func (st *RunStats) reading(kind, from string) { st.src, st.from = kind, from }

// decided notes what was decided about one posting.
func (st *RunStats) decided(o PostingOutcome) {
	if st.src == "" {
		return
	}
	if st.outcomes == nil {
		st.outcomes = map[string]*SourceLog{}
	}
	l := st.outcomes[st.src]
	if l == nil {
		l = &SourceLog{Counts: map[string]int{}}
		st.outcomes[st.src] = l
	}
	l.Total++
	l.Counts[o.Outcome]++
	if len(l.Postings) < mostKept {
		o.From = st.from
		l.Postings = append(l.Postings, o)
	}
}

// keepOutcomes stores, for each kind of source this search asked, what it
// decided about each posting, in place of what the last search that asked it
// decided.
func (e *Engine) keepOutcomes(stats *RunStats) {
	at := e.Now().Unix()
	for kind := range stats.BySource {
		l := stats.outcomes[kind]
		if l == nil {
			l = &SourceLog{Counts: map[string]int{}}
		}
		l.At, l.Run = at, stats.Kind
		e.S.Set(outcomeKey(kind), l)
	}
}

// SourcePosting is one row of a source's list: what the search decided, and
// where the role stands now.
type SourcePosting struct {
	PostingOutcome
	Fit       int    `json:"fit"` // -1 when not read
	Stage     string `json:"stage,omitempty"`
	Closed    string `json:"closed,omitempty"`
	ClosedWhy string `json:"closed_why,omitempty"`
	Saying    string `json:"saying"` // the outcome in words
}

// SourcePostings is the list of one source's postings from its last search.
type SourcePostings struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	At       int64           `json:"at"`
	Run      string          `json:"run"`
	Total    int             `json:"total"`  // postings the search saw
	Counts   map[string]int  `json:"counts"` // by outcome
	Kept     int             `json:"kept"`   // of those, kept for the list
	Shown    int             `json:"shown"`  // of those kept, how many match the filter
	Postings []SourcePosting `json:"postings"`
}

// sourceName names a kind of source the way Radar does.
func (e *Engine) sourceName(kind string) string {
	switch kind {
	case srcBoards:
		return "Employers' own job boards"
	case srcSites:
		return "Recruiters and job sites"
	case "linkedin":
		return "LinkedIn public search"
	}
	if n, ok := finderNames[kind]; ok {
		return n[0]
	}
	if k, ok := keyedSources[kind]; ok {
		return k.name
	}
	return ""
}

// PostingsFrom lists the postings one kind of source gave the last time it
// was asked, with what was decided about each and where its role stands now.
// show narrows it to "new", "here" or "skipped"; limit counts from the top.
func (e *Engine) PostingsFrom(kind, show string, limit int) (SourcePostings, error) {
	name := e.sourceName(kind)
	if name == "" {
		return SourcePostings{}, store.ErrNotFound
	}
	var l SourceLog
	e.S.Get(outcomeKey(kind), &l)
	out := SourcePostings{ID: kind, Name: name, At: l.At, Run: l.Run, Total: l.Total, Counts: l.Counts, Kept: len(l.Postings), Postings: []SourcePosting{}}
	if out.Counts == nil {
		out.Counts = map[string]int{}
	}
	for _, o := range l.Postings {
		if show != "" && o.Outcome != show {
			continue
		}
		out.Shown++
		if limit > 0 && len(out.Postings) >= limit {
			continue
		}
		row := SourcePosting{PostingOutcome: o, Fit: -1}
		if o.RoleID > 0 {
			if r, err := e.S.Role(o.RoleID); err == nil {
				row.Fit, row.Stage, row.Closed, row.ClosedWhy = r.Fit, r.Stage, r.Closed, r.ClosedWhy
			}
		}
		row.Saying = saying(row)
		out.Postings = append(out.Postings, row)
	}
	return out, nil
}

// saying puts what happened to a posting in words.
func saying(r SourcePosting) string {
	switch r.Outcome {
	case "skipped":
		return "Skipped: " + firstOf(r.Why, "by the rules")
	case "here":
		if r.Closed == "no" {
			return "Already here: you said no to it"
		}
		return "Already here"
	}
	switch {
	case r.Closed == "screened":
		return "New, then set aside: " + firstOf(r.ClosedWhy, "by the rules")
	case r.Closed == "no":
		return "New; you said no to it since"
	case r.Fit < 0 && r.Stage == "new":
		return "New, waiting to be read"
	}
	return "New"
}
