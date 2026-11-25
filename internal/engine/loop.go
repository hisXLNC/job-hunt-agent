package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// Full searches run at these minutes after midnight; the fast check for
// brand-new postings runs all day in between.
var fullAt = []int{7 * 60, 12*60 + 30, 17*60 + 30}

const fastEvery = 20 * time.Minute

// Schedule is when Job Hunt searches, as the person set it.
type Schedule struct {
	Full        []int `json:"full"`         // full searches, minutes after midnight
	FastMinutes int   `json:"fast_minutes"` // the quick check for brand-new postings; 0 = off
	From        int   `json:"from"`         // quick checks only between these hours; equal = all day
	To          int   `json:"to"`
}

func (e *Engine) Schedule() Schedule {
	sc := Schedule{Full: fullAt, FastMinutes: int(fastEvery / time.Minute)}
	e.S.Get("schedule", &sc)
	return sc
}

func (e *Engine) SetSchedule(sc Schedule) error {
	var full []int
	seen := map[int]bool{}
	for _, m := range sc.Full {
		if m >= 0 && m < 24*60 && !seen[m] {
			seen[m] = true
			full = append(full, m)
		}
	}
	if len(full) == 0 {
		return errors.New("Keep at least one full search a day.")
	}
	if len(full) > 6 {
		return errors.New("Six full searches a day is the most; the quick check covers the time between.")
	}
	sort.Ints(full)
	sc.Full = full
	if sc.FastMinutes != 0 && (sc.FastMinutes < 10 || sc.FastMinutes > 240) {
		return errors.New("The quick check can run every 10 minutes to every 4 hours, or be off.")
	}
	sc.From, sc.To = min(max(sc.From, 0), 23), min(max(sc.To, 0), 23)
	if err := e.S.Set("schedule", sc); err != nil {
		return err
	}
	e.S.Changed("status", "radar")
	return nil
}

// nextTimes says when the next fast check and the next full search are due.
func (e *Engine) nextTimes() (fast, full int64) {
	st := e.searchState()
	now := e.Now()
	sc := e.Schedule()
	switch {
	case sc.FastMinutes == 0:
		fast = now.Add(24 * time.Hour).Unix()
	case st.LastFast == 0:
		fast = now.Unix()
	default:
		fast = st.LastFast + int64(sc.FastMinutes)*60
	}
	// Outside the hours the person chose, the quick check waits for them.
	if sc.FastMinutes != 0 && sc.From != sc.To {
		at := time.Unix(max(fast, now.Unix()), 0).In(now.Location())
		h := at.Hour()
		in := (sc.From < sc.To && h >= sc.From && h < sc.To) || (sc.From > sc.To && (h >= sc.From || h < sc.To))
		if !in {
			next := time.Date(at.Year(), at.Month(), at.Day(), sc.From, 0, 0, 0, at.Location())
			if !next.After(at) {
				next = next.AddDate(0, 0, 1)
			}
			fast = next.Unix()
		}
	}
	return fast, nextFullAt(now, st.LastFull, sc.Full).Unix()
}

// nextFull is the first scheduled time after the last full search; if one was
// missed (the computer was off), that is now.
func nextFull(now time.Time, last int64) time.Time { return nextFullAt(now, last, fullAt) }

func nextFullAt(now time.Time, last int64, fullAt []int) time.Time {
	day := dayStart(now)
	var prev time.Time // the most recent scheduled time at or before now
	for d := -1; d <= 0; d++ {
		for _, m := range fullAt {
			t := day.AddDate(0, 0, d).Add(time.Duration(m) * time.Minute)
			if !t.After(now) {
				prev = t
			}
		}
	}
	if last < prev.Unix() {
		return now
	}
	for d := 0; d <= 1; d++ {
		for _, m := range fullAt {
			t := day.AddDate(0, 0, d).Add(time.Duration(m) * time.Minute)
			if t.After(now) {
				return t
			}
		}
	}
	return now.Add(8 * time.Hour)
}

// Run keeps Job Hunt working until the engine is stopped: searches on time,
// reads what is unread, checks mail, backs up.
func (e *Engine) Run() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	e.resumeSearch()
	if e.S.Profile().SetupDone {
		// Limits changed before this version only applied to new postings.
		e.ApplyLimits()
	}
	e.tick()
	for {
		select {
		case <-e.ctx.Done():
			return
		case <-t.C:
			e.tick()
		}
	}
}

func (e *Engine) tick() {
	defer func() { recover() }()
	// A version waiting to be installed goes in the moment nothing is
	// running, and nothing new is started until it has.
	if e.Busy("update") {
		return
	}
	if e.UpdateWaiting() != "" {
		if !e.anyJobBut("update") {
			e.InstallUpdate()
		}
		return
	}
	now := e.Now()
	p := e.S.Profile()
	if !p.SetupDone {
		return
	}
	e.chores(now)
	e.clearOldOnce()
	e.oldKeysOnce()
	if e.Paused() || e.Busy("search") || e.heldBack("search") {
		return
	}
	if e.LLM().Engine == "" {
		return
	}
	fast, full := e.nextTimes()
	switch {
	case now.Unix() >= full:
		e.StartSearch("full")
	case now.Unix() >= fast:
		e.StartSearch("fast")
	default:
		if rest, _, _ := e.meter.Resting(); rest {
			return
		}
		if !e.heldBack("read") && e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`) > 0 {
			e.Go("read", "Reading new roles", func(ctx context.Context) error {
				e.ReadUnread(ctx)
				return nil
			})
		}
	}
}

// chores are the small regular jobs that are not searching.
func (e *Engine) chores(now time.Time) {
	every := func(key string, d time.Duration) bool {
		last := e.S.GetInt("chore:" + key)
		if now.Unix()-last < int64(d/time.Second) {
			return false
		}
		e.S.Set("chore:"+key, now.Unix())
		return true
	}
	// Copies kept in a folder that a cloud drive carries elsewhere are
	// refreshed through the day, so the other place is never far behind.
	often := 24 * time.Hour
	if e.BackupSet().Dir != "" {
		often = 3 * time.Hour
	}
	if every("backup", often) {
		go e.Backup()
	}
	if e.OwnCal().On && every("owncal", 30*time.Minute) {
		go e.ReadOwnCal(e.ctx)
	}
	// Google Calendar: everything every half hour, and a conversation
	// changed here goes there within a couple of minutes.
	if e.GoogleOn() && (every("google", 30*time.Minute) || e.googleDirty() && every("google-push", 2*time.Minute)) {
		e.GoogleSoon()
	}
	if every("update", 30*time.Minute) {
		go e.CheckUpdate(e.ctx)
	} else if u := e.NewerVersion(); u != nil && e.AutoUpdate() && e.CanInstall() && !e.anyJobBut("") && every("update-try:"+u.Version, 6*time.Hour) {
		// A version found while Job Hunt was busy is installed once it is idle.
		e.InstallUpdate()
	}
	if e.S.GetInt("paytext") == 0 {
		e.S.Set("paytext", now.Unix())
		go e.fillPay()
	}
	if every("remind", 5*time.Minute) {
		e.remind(now)
	}
	if every("quiet", time.Hour) {
		e.letGoQuiet(now)
	}
	if e.MailSet().On && !e.heldBack("mail") && every("mail", e.MailSet().Often()) {
		e.Go("mail", "Checking your inbox", func(ctx context.Context) error { return e.CheckMail(ctx) })
	}
	// Career path is read again each week, from Monday; a failed try waits six hours.
	if e.LLM().Engine != "" && !e.heldBack("career") && e.careerDue(now) && every("career", 6*time.Hour) {
		if cvs, _ := e.S.CVs(); len(cvs) > 0 {
			e.Go("career", "Reading where your CV can go", func(ctx context.Context) error { return e.readCareer(ctx) })
		}
	}
	if !e.heldBack("boards") && every("boards", 24*time.Hour) {
		e.Go("boards", "Looking for employers' job boards", func(ctx context.Context) error { e.DetectBoards(ctx); return e.DescribeEmployers(ctx) })
	}
}

// letGoQuiet stops chasing notes that had two follow-ups and no answer.
func (e *Engine) letGoQuiet(now time.Time) {
	notes, _ := e.S.NotesInState("sent")
	for _, n := range notes {
		if n.SentAt > 0 && now.Unix()-n.SentAt > 21*86400 {
			e.S.NoteNudged(n.ID, 0)
		}
	}
}

// ---- phone notices ---------------------------------------------------------------

// PhoneSet is how notices reach the person's phone: a topic on an ntfy
// server they subscribe to in the ntfy app. Nothing is sent unless On.
type PhoneSet struct {
	On     bool   `json:"on"`
	Server string `json:"server"`
	Topic  string `json:"topic"`
	MinFit int    `json:"min_fit"`
	// Detail: the notice names the role and the employer. Off by default,
	// because it passes through a server that is not the person's own.
	Detail bool `json:"detail"`
	// Only: "" for every notice, "urgent" for interviews and offers alone.
	Only      string `json:"only"`
	QuietFrom int    `json:"quiet_from"` // hour of day, 0-23
	QuietTo   int    `json:"quiet_to"`
}

func (e *Engine) Phone() PhoneSet {
	set := PhoneSet{MinFit: 75, QuietFrom: 22, QuietTo: 7}
	e.S.Get("phone", &set)
	if set.Server == "" {
		set.Server = "https://ntfy.sh"
	}
	return set
}

func (e *Engine) SetPhone(set PhoneSet) error {
	set.Topic = strings.TrimSpace(set.Topic)
	set.Server = strings.TrimRight(strings.TrimSpace(set.Server), "/")
	if set.On && len(set.Topic) < 12 {
		return errors.New("the topic works like a password: use at least 12 letters and numbers nobody would guess")
	}
	if err := e.S.Set("phone", set); err != nil {
		return err
	}
	e.S.Changed("connections")
	return nil
}

func quiet(set PhoneSet, hour int) bool {
	if set.QuietFrom == set.QuietTo {
		return false
	}
	if set.QuietFrom < set.QuietTo {
		return hour >= set.QuietFrom && hour < set.QuietTo
	}
	return hour >= set.QuietFrom || hour < set.QuietTo
}

// Push sends one notice to the phone.
func (e *Engine) Push(ctx context.Context, title, message, click string) error {
	return e.push(ctx, title, message, click, 3)
}

func (e *Engine) push(ctx context.Context, title, message, click string, priority int) error {
	set := e.Phone()
	if set.Topic == "" {
		return errors.New("choose a topic first")
	}
	body, _ := json.Marshal(map[string]any{"topic": set.Topic, "title": title, "message": message, "click": click, "priority": priority, "tags": []string{"briefcase"}})
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", set.Server, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("couldn't reach %s", strings.TrimPrefix(set.Server, "https://"))
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s answered %d", strings.TrimPrefix(set.Server, "https://"), resp.StatusCode)
	}
	return nil
}

func ago(d time.Duration) string {
	switch {
	case d < 90*time.Second:
		return "just now"
	case d < 90*time.Minute:
		return fmt.Sprintf("%d min ago", int(d.Minutes()+0.5))
	case d < 36*time.Hour:
		return fmt.Sprintf("%d h ago", int(d.Hours()+0.5))
	}
	return fmt.Sprintf("%d days ago", int(d.Hours()/24+0.5))
}

// DeskSet is what Job Hunt does on this computer besides its window.
type DeskSet struct {
	Notify bool `json:"notify"` // Windows notifications for fresh strong roles and replies
	// Morning is the hour the day's summary is said at; -1 for never.
	Morning int    `json:"morning"`
	Awake   string `json:"awake"` // "off", "working" (while it is busy), "always"
}

func (e *Engine) Desk() DeskSet {
	set := DeskSet{Notify: true, Awake: "working", Morning: 8}
	e.S.Get("desk", &set)
	return set
}

func (e *Engine) SetDesk(set DeskSet) error {
	if set.Awake != "off" && set.Awake != "always" {
		set.Awake = "working"
	}
	err := e.S.Set("desk", set)
	e.S.Changed("connections")
	return err
}

// WantsAwake says whether the computer should be kept from sleeping right now.
func (e *Engine) WantsAwake() bool {
	switch e.Desk().Awake {
	case "always":
		return !e.Paused()
	case "off":
		return false
	}
	return e.anyJobBut("")
}

// Tell shows a notification on this computer, if they are on, and keeps it
// under the bell either way. page is the part of Job Hunt it opens, like
// "#/roles/12".
func (e *Engine) Tell(title, text, page string) {
	e.Keep(noticeKind(page), title, text, page)
	if e.Notify == nil || !e.Desk().Notify {
		return
	}
	go func() {
		if err := e.Notify(title, text, e.BaseURL+page); err != nil {
			trace.Log("problem", "notification: %v", err)
		}
	}()
}

// maybePush tells the person about a strong role that is still fresh, on
// this computer and on their phone: the whole point is to apply while the
// applicant count is in single digits.
func (e *Engine) maybePush(r store.Role, fit, tailored int) {
	set := e.Phone()
	now := e.Now()
	age := now.Sub(time.Unix(r.Age(), 0))
	if age <= 6*time.Hour && fit >= set.MinFit {
		line := fmt.Sprintf("Fit %d · posted %s", fit, ago(age))
		if r.Applicants >= 0 {
			line += " · " + ApplicantsText(r.Applicants) + " applicants so far"
		}
		e.Tell(r.Title+" at "+r.Company, line+". Your CV and letter are ready.", fmt.Sprintf("#/roles/%d", r.ID))
	}
	if !set.On || set.Topic == "" || fit < set.MinFit || quiet(set, now.Hour()) {
		return
	}
	if age > 6*time.Hour {
		return
	}
	parts := []string{fmt.Sprintf("Fit %d", fit)}
	if tailored > fit {
		parts[0] = fmt.Sprintf("Fit %d, %d tailored", fit, tailored)
	}
	parts = append(parts, "posted "+ago(age))
	if r.Applicants >= 0 {
		parts = append(parts, ApplicantsText(r.Applicants)+" applicants so far")
	}
	msg := strings.Join(parts, " · ") + ". CV and letter are ready on your computer."
	title := r.Title + " at " + r.Company
	if !set.Detail {
		title = "A strong role, just posted"
	}
	if set.Only == "urgent" {
		return
	}
	go func() {
		click := firstOf(r.ApplyURL, r.URL)
		if e.PhoneLink != nil {
			// With phone access on, the notice opens the role in Job Hunt on the phone.
			click = firstOf(e.PhoneLink(fmt.Sprintf("#role/%d", r.ID)), click)
		}
		if !set.Detail && e.PhoneLink == nil {
			click = "" // the posting's address would name the employer
		}
		if err := e.Push(e.ctx, title, msg, click); err != nil {
			e.problem("Sending a phone notice", err)
		}
	}()
}

// resumeSearch runs again the search that was under way when Job Hunt last
// stopped (an update, a restart, the computer shutting down), so nothing it
// had not reached yet is missed. Postings it had already taken in are known
// and are not taken twice.
func (e *Engine) resumeSearch() {
	var kind string
	e.S.Get("search:open", &kind)
	if kind == "" || e.Paused() || !e.S.Profile().SetupDone || e.LLM().Engine == "" {
		return
	}
	trace.Log("search", "picking up the %s search that was cut short when Job Hunt last stopped", kind)
	e.StartSearch(kind)
}

// clearOldOnce clears out, once, the jobs brought over from the old Job Hunt
// that were never applied to.
func (e *Engine) clearOldOnce() {
	var last OldResult
	if e.oldWasCleared() || e.Busy("old") {
		return
	}
	if ok, _ := e.S.Get(oldDoneKey, &last); !ok {
		return
	}
	if _, err := e.ClearOld(); err != nil {
		trace.Log("problem", "clearing the old Job Hunt's jobs: %v", err)
	}
}
