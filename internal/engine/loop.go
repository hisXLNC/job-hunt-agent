package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/store"
)

// Full searches run at these minutes after midnight; the fast check for
// brand-new postings runs all day in between.
var fullAt = []int{7 * 60, 12*60 + 30, 17*60 + 30}

const fastEvery = 20 * time.Minute

// nextTimes says when the next fast check and the next full search are due.
func (e *Engine) nextTimes() (fast, full int64) {
	st := e.searchState()
	now := e.Now()
	if st.LastFast == 0 {
		fast = now.Unix()
	} else {
		fast = st.LastFast + int64(fastEvery/time.Second)
	}
	return fast, nextFull(now, st.LastFull).Unix()
}

// nextFull is the first scheduled time after the last full search; if one was
// missed (the computer was off), that is now.
func nextFull(now time.Time, last int64) time.Time {
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
	now := e.Now()
	p := e.S.Profile()
	if !p.SetupDone {
		return
	}
	e.chores(now)
	if e.Paused() || e.Busy("search") {
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
		if e.S.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`) > 0 {
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
	if every("backup", 24*time.Hour) {
		go e.Backup()
	}
	if every("quiet", time.Hour) {
		e.letGoQuiet(now)
	}
	if e.MailSet().On && every("mail", 10*time.Minute) {
		e.Go("mail", "", func(ctx context.Context) error { return e.CheckMail(ctx) })
	}
	if every("boards", 24*time.Hour) {
		e.Go("boards", "", func(ctx context.Context) error { e.DetectBoards(ctx); return e.DescribeEmployers(ctx) })
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

// Backup writes today's copy of the data and keeps the last seven.
func (e *Engine) Backup() (string, error) {
	if e.Dir == "" {
		return "", errors.New("no data folder")
	}
	dir := filepath.Join(e.Dir, "backups")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, "jobhunt-"+e.Now().Format("2006-01-02")+".db")
	if err := e.S.Backup(dst); err != nil {
		return "", err
	}
	old, _ := filepath.Glob(filepath.Join(dir, "jobhunt-*.db"))
	sort.Strings(old)
	for len(old) > 7 {
		os.Remove(old[0])
		old = old[1:]
	}
	return dst, nil
}

// ---- phone notices ---------------------------------------------------------------

// PhoneSet is how notices reach the person's phone: a topic on an ntfy
// server they subscribe to in the ntfy app. Nothing is sent unless On.
type PhoneSet struct {
	On        bool   `json:"on"`
	Server    string `json:"server"`
	Topic     string `json:"topic"`
	MinFit    int    `json:"min_fit"`
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
	set := e.Phone()
	if set.Topic == "" {
		return errors.New("choose a topic first")
	}
	body, _ := json.Marshal(map[string]any{"topic": set.Topic, "title": title, "message": message, "click": click, "tags": []string{"briefcase"}})
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

// maybePush tells the phone about a strong role that is still fresh: the
// whole point is to apply while the applicant count is in single digits.
func (e *Engine) maybePush(r store.Role, fit, tailored int) {
	set := e.Phone()
	now := e.Now()
	if !set.On || set.Topic == "" || fit < set.MinFit || quiet(set, now.Hour()) {
		return
	}
	age := now.Sub(time.Unix(r.Age(), 0))
	if age > 6*time.Hour {
		return
	}
	parts := []string{fmt.Sprintf("Fit %d", fit)}
	if tailored > fit {
		parts[0] = fmt.Sprintf("Fit %d, %d tailored", fit, tailored)
	}
	parts = append(parts, "posted "+ago(age))
	if r.Applicants >= 0 {
		parts = append(parts, fmt.Sprintf("%d applicants so far", r.Applicants))
	}
	msg := strings.Join(parts, " · ") + ". CV and letter are ready on your computer."
	go func() {
		if err := e.Push(e.ctx, r.Title+" at "+r.Company, msg, firstOf(r.ApplyURL, r.URL)); err != nil {
			e.problem("Sending a phone notice", err)
		}
	}()
}
