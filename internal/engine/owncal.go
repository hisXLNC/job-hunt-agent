package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // a calendar names its time zones; Windows has no list of them

	"jobhunt/internal/trace"
)

// The person's own calendar, read-only. Google Calendar (and Outlook, and
// iCloud) give every calendar a private address that serves it as a
// calendar file. Job Hunt reads that address so it knows when the person is
// busy: it shows those hours on the month, warns when an interview lands on
// one, and offers times that are free. It cannot change the calendar, and
// what it reads stays on this computer: it is never given to Claude.

// OwnCal is the setting. The address works like a password, so it is never
// sent back to the pages.
type OwnCal struct {
	URL   string `json:"url,omitempty"`
	On    bool   `json:"on"`
	At    int64  `json:"at"`    // when it was last read
	Note  string `json:"note"`  // what went wrong the last time, if anything
	Count int    `json:"count"` // entries in the days ahead
}

// OwnEvent is one entry from the person's calendar.
type OwnEvent struct {
	Start  int64  `json:"start"`
	End    int64  `json:"end"`
	Title  string `json:"title"`
	AllDay bool   `json:"all_day,omitempty"`
	Free   bool   `json:"free,omitempty"` // the calendar says it doesn't block the time
}

const ownCalAhead = 120 * 24 * time.Hour

func (e *Engine) OwnCal() OwnCal {
	var c OwnCal
	e.S.Get("owncal", &c)
	return c
}

// calendarAddress tidies what the person pasted and refuses anything that
// isn't a calendar address on the internet.
func calendarAddress(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(strings.ToLower(raw), "webcal://") {
		raw = "https://" + raw[len("webcal://"):]
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return "", errors.New("That isn't a calendar address. It starts with https:// and usually ends in .ics.")
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil || host == "localhost" || !strings.Contains(host, ".") {
		return "", errors.New("That address isn't on the internet. Copy the secret address from your calendar's settings.")
	}
	if strings.Contains(host, "calendar.google.com") && strings.Contains(u.Path, "/embed") {
		return "", errors.New("That is the address for showing the calendar on a web page. Copy the one named \"Secret address in iCal format\".")
	}
	return u.String(), nil
}

// SetOwnCal saves the address and reads the calendar once, so a wrong
// address is found out now.
func (e *Engine) SetOwnCal(ctx context.Context, raw string) (OwnCal, error) {
	c := e.OwnCal()
	if strings.TrimSpace(raw) != "" {
		addr, err := calendarAddress(raw)
		if err != nil {
			return c, err
		}
		c.URL = addr
	}
	if c.URL == "" {
		return c, errors.New("Paste your calendar's secret address first.")
	}
	events, err := e.fetchOwnCal(ctx, c.URL)
	if err != nil {
		return c, err
	}
	c.On, c.At, c.Note, c.Count = true, e.Now().Unix(), "", len(events)
	e.S.Set("owncal:events", events)
	if err := e.S.Set("owncal", c); err != nil {
		return c, err
	}
	e.S.Changed("talks", "connections")
	return c, nil
}

// ForgetOwnCal removes the address and everything read from it.
func (e *Engine) ForgetOwnCal() error {
	e.S.Set("owncal:events", []OwnEvent{})
	err := e.S.Set("owncal", OwnCal{})
	e.S.Changed("talks", "connections")
	return err
}

// ReadOwnCal reads the calendar again. A failure keeps what was read before.
func (e *Engine) ReadOwnCal(ctx context.Context) error {
	c := e.OwnCal()
	if !c.On || c.URL == "" {
		return nil
	}
	events, err := e.fetchOwnCal(ctx, c.URL)
	if err != nil {
		c.Note = err.Error()
		e.S.Set("owncal", c)
		trace.Log("calendar", "reading the person's calendar failed: %v", err)
		return err
	}
	c.At, c.Note, c.Count = e.Now().Unix(), "", len(events)
	e.S.Set("owncal:events", events)
	e.S.Set("owncal", c)
	e.S.Changed("talks")
	return nil
}

func (e *Engine) fetchOwnCal(ctx context.Context, addr string) ([]OwnEvent, error) {
	if e.OwnCalFetch != nil {
		b, err := e.OwnCalFetch(addr)
		if err != nil {
			return nil, err
		}
		return ParseCalendar(b, e.Now().Add(-48*time.Hour), e.Now().Add(ownCalAhead), e.Now().Location())
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", addr, nil)
	if err != nil {
		return nil, errors.New("That isn't a calendar address.")
	}
	req.Header.Set("User-Agent", "JobHunt")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, errors.New("Couldn't reach your calendar. Check the internet connection, then try again.")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 403 || resp.StatusCode == 401 {
		return nil, errors.New("Your calendar refused that address. If you reset the secret address, paste the new one.")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Your calendar answered with an error (%d). Try again later.", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, errors.New("Reading your calendar was cut off. Try again.")
	}
	return ParseCalendar(b, e.Now().Add(-48*time.Hour), e.Now().Add(ownCalAhead), e.Now().Location())
}

// OwnEvents are the person's own entries between two moments.
func (e *Engine) OwnEvents(from, to int64) []OwnEvent {
	out := []OwnEvent{}
	if !e.OwnCal().On {
		return out
	}
	var all []OwnEvent
	e.S.Get("owncal:events", &all)
	for _, ev := range all {
		if ev.End > from && ev.Start < to {
			out = append(out, ev)
		}
	}
	return out
}

// Clash is the entry in the person's calendar that a conversation at this
// time would land on, if there is one.
func (e *Engine) Clash(at int64, minutes int) *OwnEvent {
	end := at + int64(max(minutes, 15))*60
	for _, ev := range e.OwnEvents(at, end) {
		if !ev.Free {
			return &ev
		}
	}
	return nil
}

// Slot is a stretch the person is free.
type Slot struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// TalkSet is when the person can do interviews and what to offer an
// employer who asks.
type TalkSet struct {
	From    int `json:"from"`    // first hour of the day, 0-23
	To      int `json:"to"`      // the hour it ends
	Minutes int `json:"minutes"` // how long one is
	Offer   int `json:"offer"`   // how many times to offer
}

func (e *Engine) TalkSet() TalkSet {
	set := TalkSet{From: 9, To: 17, Minutes: 60, Offer: 3}
	e.S.Get("talkset", &set)
	if set.From < 0 || set.From > 22 || set.To <= set.From || set.To > 24 {
		set.From, set.To = 9, 17
	}
	if set.Minutes < 15 || set.Minutes > 240 {
		set.Minutes = 60
	}
	if set.Offer < 1 || set.Offer > 6 {
		set.Offer = 3
	}
	return set
}

func (e *Engine) SetTalkSet(set TalkSet) error {
	if set.From < 0 || set.From > 22 || set.To <= set.From || set.To > 24 {
		return errors.New("interview hours run from an hour to a later hour, like 9 to 17")
	}
	if set.Minutes < 15 || set.Minutes > 240 {
		return errors.New("an interview is 15 to 240 minutes long")
	}
	if set.Offer < 1 || set.Offer > 6 {
		return errors.New("offer between 1 and 6 times")
	}
	if err := e.S.Set("talkset", set); err != nil {
		return err
	}
	e.S.Changed("connections")
	return nil
}

// OfferTimes writes free times the way a person would in a reply.
func (e *Engine) OfferTimes(n int) []string {
	var out []string
	loc := e.Now().Location()
	for _, s := range e.FreeTimes(n) {
		a, b := time.Unix(s.Start, 0).In(loc), time.Unix(s.End, 0).In(loc)
		out = append(out, a.Format("Monday 2 January")+", "+a.Format("15:04")+" to "+b.Format("15:04"))
	}
	return out
}

var timeGapRe = regexp.MustCompile(`\[(?:time|slot|option) ?(\d)\]`)

// fillTimes puts the person's free times into a drafted reply that left
// [time 1] style gaps. With no calendar connected the gaps stay, because
// only the person knows.
func (e *Engine) fillTimes(reply string) string {
	if !timeGapRe.MatchString(reply) {
		return reply
	}
	times := e.OfferTimes(e.TalkSet().Offer)
	if len(times) == 0 {
		return reply
	}
	out := timeGapRe.ReplaceAllStringFunc(reply, func(m string) string {
		i := int(timeGapRe.FindStringSubmatch(m)[1][0] - '1')
		if i >= 0 && i < len(times) {
			return times[i]
		}
		return m
	})
	// A line left with a gap nobody can fill is dropped.
	var keep []string
	for _, line := range strings.Split(out, "\n") {
		if timeGapRe.MatchString(line) && strings.TrimSpace(timeGapRe.ReplaceAllString(line, "")) == "-" {
			continue
		}
		keep = append(keep, line)
	}
	return strings.Join(keep, "\n")
}

// FreeTimes offers up to n one-hour stretches in working hours over the
// coming working days that touch nothing in the person's calendar or in
// Job Hunt's own list of conversations, at most two a day.
func (e *Engine) FreeTimes(n int) []Slot {
	out := []Slot{}
	if !e.OwnCal().On {
		return out
	}
	now := e.Now()
	day := dayStart(now)
	set := e.TalkSet()
	long := time.Duration(set.Minutes) * time.Minute
	for d := 1; d <= 14 && len(out) < n; d++ {
		at := day.AddDate(0, 0, d)
		if wd := at.Weekday(); wd == time.Saturday || wd == time.Sunday {
			continue
		}
		open := time.Date(at.Year(), at.Month(), at.Day(), set.From, 0, 0, 0, at.Location())
		shut := time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, at.Location()).Add(time.Duration(set.To) * time.Hour)
		type span struct{ a, b int64 }
		busy := []span{}
		for _, ev := range e.OwnEvents(open.Unix(), shut.Unix()) {
			if !ev.Free {
				busy = append(busy, span{ev.Start - 15*60, ev.End + 15*60})
			}
		}
		talks, _ := e.S.Talks(open.Unix()-8*3600, shut.Unix())
		for _, t := range talks {
			busy = append(busy, span{t.At - 15*60, t.At + int64(max(t.Minutes, 15))*60 + 15*60})
		}
		taken := 0
		for t := open; taken < 2 && len(out) < n && !t.Add(long).After(shut); t = t.Add(30 * time.Minute) {
			a, b := t.Unix(), t.Add(long).Unix()
			clear := true
			for _, s := range busy {
				if s.a < b && s.b > a {
					clear = false
					break
				}
			}
			if clear {
				out = append(out, Slot{a, b})
				taken++
				t = t.Add(150 * time.Minute) // the day's second offer is a different part of the day
			}
		}
	}
	return out
}

// ---- reading a calendar file ---------------------------------------------------

type icsProp struct {
	name   string
	params map[string]string
	value  string
}

func icsLine(line string) icsProp {
	head, value, _ := strings.Cut(line, ":")
	// A quoted parameter may hold a colon (TZID="a:b"); rare enough to split simply.
	parts := strings.Split(head, ";")
	p := icsProp{name: strings.ToUpper(parts[0]), params: map[string]string{}, value: value}
	for _, kv := range parts[1:] {
		k, v, _ := strings.Cut(kv, "=")
		p.params[strings.ToUpper(k)] = strings.Trim(v, `"`)
	}
	return p
}

func icsTime(p icsProp, loc *time.Location) (time.Time, bool, bool) {
	v := strings.TrimSpace(p.value)
	if p.params["VALUE"] == "DATE" || len(v) == 8 {
		t, err := time.ParseInLocation("20060102", v, loc)
		return t, true, err == nil
	}
	if strings.HasSuffix(v, "Z") {
		t, err := time.Parse("20060102T150405Z", v)
		return t, false, err == nil
	}
	zone := loc
	if id := p.params["TZID"]; id != "" {
		if l, err := time.LoadLocation(id); err == nil {
			zone = l
		}
	}
	t, err := time.ParseInLocation("20060102T150405", v, zone)
	return t, false, err == nil
}

var icsUnesc = strings.NewReplacer(`\n`, " ", `\N`, " ", `\,`, ",", `\;`, ";", `\\`, `\`)

var icsDays = map[string]time.Weekday{"SU": 0, "MO": 1, "TU": 2, "WE": 3, "TH": 4, "FR": 5, "SA": 6}

// ParseCalendar reads a calendar file and returns the entries that touch
// the time between from and to, repeating ones written out one by one.
func ParseCalendar(data []byte, from, to time.Time, loc *time.Location) ([]OwnEvent, error) {
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	if !strings.Contains(text, "BEGIN:VCALENDAR") {
		return nil, errors.New("That address didn't give a calendar. Copy the one named \"Secret address in iCal format\".")
	}
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\n ", ""), "\n\t", "")
	out := []OwnEvent{}
	type event struct {
		start, end     time.Time
		allDay, hasEnd bool
		title, rrule   string
		free, dead, ok bool
		skip           map[int64]bool
		override       bool
	}
	var cur *event
	add := func(ev *event) {
		if !ev.ok || ev.dead || ev.override && ev.rrule != "" {
			return
		}
		if !ev.hasEnd {
			if ev.allDay {
				ev.end = ev.start.AddDate(0, 0, 1)
			} else {
				ev.end = ev.start.Add(time.Hour)
			}
		}
		length := ev.end.Sub(ev.start)
		if length <= 0 {
			length = time.Hour
		}
		title := strings.TrimSpace(icsUnesc.Replace(ev.title))
		if len(title) > 200 {
			title = title[:200]
		}
		put := func(s time.Time) {
			if len(out) >= 4000 || ev.skip[s.Unix()] {
				return
			}
			if s.Add(length).After(from) && s.Before(to) {
				out = append(out, OwnEvent{Start: s.Unix(), End: s.Add(length).Unix(), Title: title, AllDay: ev.allDay, Free: ev.free})
			}
		}
		if ev.rrule == "" {
			put(ev.start)
			return
		}
		rule := map[string]string{}
		for _, kv := range strings.Split(ev.rrule, ";") {
			k, v, _ := strings.Cut(kv, "=")
			rule[strings.ToUpper(k)] = v
		}
		every, _ := strconv.Atoi(rule["INTERVAL"])
		if every < 1 {
			every = 1
		}
		count, _ := strconv.Atoi(rule["COUNT"])
		until := to
		if u := rule["UNTIL"]; u != "" {
			if t, _, ok := icsTime(icsProp{value: u, params: map[string]string{}}, ev.start.Location()); ok {
				if len(u) == 8 {
					t = t.AddDate(0, 0, 1)
				}
				if t.Before(until) {
					until = t
				}
			}
		}
		var days []time.Weekday
		for _, d := range strings.Split(rule["BYDAY"], ",") {
			if len(d) == 2 {
				if wd, ok := icsDays[strings.ToUpper(d)]; ok {
					days = append(days, wd)
				}
			} else if d != "" && rule["FREQ"] != "WEEKLY" {
				return // "the second Tuesday" and the like: left out rather than shown on the wrong day
			}
		}
		made := 0
		emit := func(s time.Time) bool {
			if s.After(until) || count > 0 && made >= count {
				return false
			}
			made++
			put(s)
			return true
		}
		s := ev.start
		switch rule["FREQ"] {
		case "DAILY":
			for i := 0; i < 5000; i++ {
				if len(days) > 0 && !hasDay(days, s.Weekday()) {
					s = s.AddDate(0, 0, every)
					continue
				}
				if !emit(s) {
					break
				}
				s = s.AddDate(0, 0, every)
			}
		case "WEEKLY":
			if len(days) == 0 {
				days = []time.Weekday{s.Weekday()}
			}
			// The week the first one is in, from its Monday.
			week := s.AddDate(0, 0, -((int(s.Weekday()) + 6) % 7))
		weeks:
			for i := 0; i < 1500; i++ {
				for d := 0; d < 7; d++ {
					day := week.AddDate(0, 0, d)
					if day.Before(ev.start) || !hasDay(days, day.Weekday()) {
						continue
					}
					if !emit(day) {
						break weeks
					}
				}
				week = week.AddDate(0, 0, 7*every)
			}
		case "MONTHLY":
			for i := 0; i < 600; i++ {
				n := ev.start.AddDate(0, i*every, 0)
				if n.Day() != ev.start.Day() {
					continue // no 31st this month
				}
				if !emit(n) {
					break
				}
			}
		case "YEARLY":
			for i := 0; i < 60; i++ {
				if !emit(ev.start.AddDate(i*every, 0, 0)) {
					break
				}
			}
		}
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, " ")
		switch {
		case line == "BEGIN:VEVENT":
			cur = &event{skip: map[int64]bool{}}
			continue
		case line == "END:VEVENT":
			if cur != nil {
				add(cur)
			}
			cur = nil
			continue
		}
		if cur == nil {
			continue
		}
		p := icsLine(line)
		switch p.name {
		case "DTSTART":
			cur.start, cur.allDay, cur.ok = icsTime(p, loc)
		case "DTEND":
			if t, _, ok := icsTime(p, loc); ok {
				cur.end, cur.hasEnd = t, true
			}
		case "SUMMARY":
			cur.title = p.value
		case "RRULE":
			cur.rrule = p.value
		case "RECURRENCE-ID":
			cur.override = true
		case "EXDATE":
			for _, v := range strings.Split(p.value, ",") {
				if t, _, ok := icsTime(icsProp{value: v, params: p.params}, loc); ok {
					cur.skip[t.Unix()] = true
				}
			}
		case "STATUS":
			cur.dead = strings.EqualFold(strings.TrimSpace(p.value), "CANCELLED")
		case "TRANSP":
			cur.free = strings.EqualFold(strings.TrimSpace(p.value), "TRANSPARENT")
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out, nil
}

func hasDay(days []time.Weekday, d time.Weekday) bool {
	for _, x := range days {
		if x == d {
			return true
		}
	}
	return false
}

// GoogleCalendarLink opens Google Calendar's own "new event" page with a
// conversation filled in. The person presses Save there; Job Hunt adds
// nothing by itself.
func GoogleCalendarLink(title string, at int64, minutes int, where, details string) string {
	const f = "20060102T150405Z"
	start := time.Unix(at, 0).UTC()
	q := url.Values{}
	q.Set("action", "TEMPLATE")
	q.Set("text", title)
	q.Set("dates", start.Format(f)+"/"+start.Add(time.Duration(max(minutes, 15))*time.Minute).Format(f))
	if where != "" {
		q.Set("location", where)
	}
	if details != "" {
		q.Set("details", details)
	}
	return "https://calendar.google.com/calendar/render?" + q.Encode()
}
