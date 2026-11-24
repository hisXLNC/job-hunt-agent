package engine

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// CalItem is one thing on the month calendar: an interview, a booked
// conversation, the day a follow-up is due, or the day a posting closes.
type CalItem struct {
	Kind  string `json:"kind"`  // interview, chat, follow, closes
	Day   string `json:"day"`   // 2026-11-24, in this computer's time
	At    int64  `json:"at"`    // the moment, for interviews and conversations; 0 for whole-day items
	Title string `json:"title"` // outside text: a posting's or a person's words
	Sub   string `json:"sub"`
	Go    string `json:"go"` // the page it opens
	ID    int64  `json:"id"` // the interview's number, for its calendar file
}

// Calendar lists everything dated between two moments, in order.
func (e *Engine) Calendar(from, to int64) []CalItem {
	loc := e.Now().Location()
	day := func(ts int64) string { return time.Unix(ts, 0).In(loc).Format("2006-01-02") }
	out := []CalItem{}
	talks, _ := e.S.Talks(from, to)
	for _, t := range talks {
		kind := "interview"
		if t.Kind == "chat" {
			kind = "chat"
		}
		out = append(out, CalItem{Kind: kind, Day: day(t.At), At: t.At, Title: t.Title, Sub: joinNonEmpty(" · ", t.Person, t.Company), Go: fmt.Sprintf("#/interviews/%d", t.ID), ID: t.ID})
	}
	notes, _ := e.S.NotesInState("sent")
	for _, n := range notes {
		if n.NudgeAt < from || n.NudgeAt >= to {
			continue
		}
		p, err := e.S.Person(n.PersonID)
		if err != nil {
			continue
		}
		out = append(out, CalItem{Kind: "follow", Day: day(n.NudgeAt), Title: "Follow up with " + p.Name, Sub: joinNonEmpty(" · ", p.Title, p.Company), Go: fmt.Sprintf("#/people/%d", p.ID)})
	}
	roles, _ := e.S.RolesNamingADate()
	fromDay, toDay := day(from), day(to)
	for _, r := range roles {
		t, ok := Closes(r.Description)
		if !ok {
			continue
		}
		// The posting names a date, not a moment: it is that date here.
		d := t.Format("2006-01-02")
		if d < fromDay || d >= toDay {
			continue
		}
		out = append(out, CalItem{Kind: "closes", Day: d, Title: "Closes: " + r.Title, Sub: r.Company, Go: fmt.Sprintf("#/roles/%d", r.ID)})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Day != out[j].Day {
			return out[i].Day < out[j].Day
		}
		// Whole-day items sit under the timed ones.
		if (out[i].At == 0) != (out[j].At == 0) {
			return out[j].At == 0
		}
		return out[i].At < out[j].At
	})
	return out
}

var icsEsc = strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\n", `\n`, "\r", "")

// CalendarICS is one calendar file with everything dated in the days ahead,
// for a calendar program on this computer to read.
func (e *Engine) CalendarICS(days int) []byte {
	now := e.Now()
	items := e.Calendar(dayStart(now).Unix(), dayStart(now).AddDate(0, 0, days).Unix())
	const f = "20060102T150405Z"
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Job Hunt//EN\r\nX-WR-CALNAME:Job Hunt\r\n")
	for _, it := range items {
		b.WriteString("BEGIN:VEVENT\r\n")
		title := it.Title
		if it.Sub != "" && it.At != 0 {
			title += ": " + it.Sub
		}
		if it.At != 0 {
			start := time.Unix(it.At, 0).UTC()
			minutes := 30
			if t, err := e.S.Talk(it.ID); err == nil {
				minutes = max(t.Minutes, 15)
			}
			// The same UID as the single file for this conversation, so a
			// calendar that has both shows it once.
			fmt.Fprintf(&b, "UID:jobhunt-talk-%d@local\r\nDTSTART:%s\r\nDTEND:%s\r\n", it.ID, start.Format(f), start.Add(time.Duration(minutes)*time.Minute).Format(f))
		} else {
			d, err := time.Parse("2006-01-02", it.Day)
			if err != nil {
				d = now
			}
			ref := strings.NewReplacer("#/", "", "/", "-").Replace(it.Go)
			fmt.Fprintf(&b, "UID:jobhunt-%s-%s-%s@local\r\nDTSTART;VALUE=DATE:%s\r\nDTEND;VALUE=DATE:%s\r\n", it.Kind, ref, d.Format("20060102"), d.Format("20060102"), d.AddDate(0, 0, 1).Format("20060102"))
		}
		fmt.Fprintf(&b, "DTSTAMP:%s\r\nSUMMARY:%s\r\nDESCRIPTION:%s\r\nEND:VEVENT\r\n", now.UTC().Format(f), icsEsc.Replace(title), icsEsc.Replace(strings.TrimSpace(it.Sub+"\n"+e.BaseURL+it.Go)))
	}
	b.WriteString("END:VCALENDAR\r\n")
	return []byte(b.String())
}
