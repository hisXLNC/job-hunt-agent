package engine

import (
	"sort"
	"time"
)

// Search times suggested from the person's own postings: the hours the roles
// Job Hunt found for them were posted, so the full searches run just after
// the busiest of them and the quick checks cover the hours that matter. Being
// early is what puts the person among the first ten applicants.

const (
	suggestDays   = 90 // roles found in this many days are counted
	suggestLeast  = 20 // postings with a time of day needed before suggesting anything
	suggestPeaks  = 3  // full searches suggested
	suggestMinute = 40 // a full search this many minutes into a busy hour
)

// HourCount is how many postings went up in one hour of the day.
type HourCount struct {
	Hour int `json:"hour"`
	N    int `json:"n"`
}

// TimesSuggestion is the schedule suggested from the person's own postings.
type TimesSuggestion struct {
	Seen  int         `json:"seen"`  // postings with a time of day, counted
	Need  int         `json:"need"`  // how many are needed before a suggestion
	Ready bool        `json:"ready"` // enough were seen to suggest anything
	Hours []HourCount `json:"hours"` // all 24, in order
	Peaks []int       `json:"peaks"` // the busiest hours, earliest first
	Full  []int       `json:"full"`  // suggested full searches, minutes after midnight
	From  int         `json:"from"`  // suggested hours for quick checks; equal = all day
	To    int         `json:"to"`
	Same  bool        `json:"same"` // the schedule already follows the suggestion
}

// SuggestTimes reads when the roles found lately were posted and suggests
// when to search. Postings that give only a date (no time of day) say nothing
// about the hour and are left out.
func (e *Engine) SuggestTimes() TimesSuggestion {
	now := e.Now()
	since := now.Add(-suggestDays * 24 * time.Hour).Unix()
	rows, _ := e.S.Pairs(`SELECT '', posted_at FROM roles WHERE posted_at > 0 AND first_seen_at >= ? AND closed != 'screened'`, since)
	var at []time.Time
	for _, r := range rows {
		t := time.Unix(int64(r.N), 0)
		if u := t.UTC(); u.Hour() == 0 && u.Minute() == 0 && u.Second() == 0 {
			continue // a date only
		}
		if l := t.In(now.Location()); l.Hour() == 0 && l.Minute() == 0 && l.Second() == 0 {
			continue
		}
		at = append(at, t.In(now.Location()))
	}
	sg := suggestFrom(at)
	sc := e.Schedule()
	if sg.Ready {
		same := len(sc.Full) == len(sg.Full) && sc.From == sg.From && sc.To == sg.To
		for i := range sg.Full {
			same = same && sc.Full[i] == sg.Full[i]
		}
		sg.Same = same
	}
	return sg
}

// suggestFrom suggests search times from the moments postings went up.
func suggestFrom(at []time.Time) TimesSuggestion {
	sg := TimesSuggestion{Seen: len(at), Need: suggestLeast}
	count := make([]int, 24)
	for _, t := range at {
		count[t.Hour()]++
	}
	for h, n := range count {
		sg.Hours = append(sg.Hours, HourCount{h, n})
	}
	if len(at) < suggestLeast {
		return sg
	}
	sg.Ready = true

	// The busiest hours, each weighed with its neighbours so one odd posting
	// does not make a peak, and at least three hours apart.
	weight := func(h int) float64 {
		return float64(count[h]) + 0.5*float64(count[(h+23)%24]+count[(h+1)%24])
	}
	hours := make([]int, 24)
	for h := range hours {
		hours[h] = h
	}
	sort.SliceStable(hours, func(i, j int) bool { return weight(hours[i]) > weight(hours[j]) })
	for _, h := range hours {
		if len(sg.Peaks) == suggestPeaks || count[h] == 0 {
			break
		}
		near := false
		for _, p := range sg.Peaks {
			d := (h - p + 24) % 24
			near = near || d < 3 || d > 21
		}
		if !near {
			sg.Peaks = append(sg.Peaks, h)
		}
	}
	sort.Ints(sg.Peaks)
	for _, h := range sg.Peaks {
		sg.Full = append(sg.Full, h*60+suggestMinute)
	}

	// Quick checks: the fewest hours in a row that hold nine in ten postings.
	need := (len(at)*9 + 9) / 10
	bestLen, bestFrom := 24, 0
	for from := 0; from < 24; from++ {
		n := 0
		for l := 1; l <= 24; l++ {
			n += count[(from+l-1)%24]
			if n >= need {
				if l < bestLen {
					bestLen, bestFrom = l, from
				}
				break
			}
		}
	}
	if bestLen < 20 {
		// An hour's margin either side: a quick check finds postings up to two hours old.
		sg.From, sg.To = (bestFrom+23)%24, (bestFrom+bestLen+1)%24
	}
	return sg
}
