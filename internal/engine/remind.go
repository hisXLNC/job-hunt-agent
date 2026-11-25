package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// Reminders: the things Job Hunt says without being asked, at the moment
// they are useful. Each is said once, kept under the bell, shown as a
// Windows notification and, when phone notices are on, sent to the phone.

// Say tells the person something on this computer and on their phone.
// urgent is for an interview or an offer: those reach the phone even when
// it is set to urgent notices only, and at a higher priority.
func (e *Engine) Say(urgent bool, plain, title, text, page string) {
	e.Tell(title, text, page)
	set := e.Phone()
	if !set.On || set.Topic == "" || quiet(set, e.Now().Hour()) || (set.Only == "urgent" && !urgent) {
		return
	}
	if !set.Detail {
		// The notice passes through a server that is not the person's own:
		// by default it says what kind of thing happened and nothing else.
		title, text = plain, "Open Job Hunt to see it."
	}
	click := ""
	if e.PhoneLink != nil {
		click = e.PhoneLink(phonePage(page))
	}
	prio := 3
	if urgent {
		prio = 4
	}
	go func() {
		if err := e.push(e.ctx, title, text, click, prio); err != nil {
			e.problem("Sending a phone notice", err)
		}
	}()
}

// phonePage is the phone's page for one of the computer's pages.
func phonePage(page string) string {
	switch {
	case strings.HasPrefix(page, "#/roles/"):
		return "#role/" + strings.TrimPrefix(page, "#/roles/")
	case strings.HasPrefix(page, "#/interviews"):
		return "#interviews"
	case strings.HasPrefix(page, "#/replies"):
		return "#replies"
	}
	return ""
}

func (e *Engine) saidOnce(key string) bool {
	k := "said:" + key
	if e.S.GetInt(k) != 0 {
		return false
	}
	e.S.Set(k, e.Now().Unix())
	return true
}

func talkWith(t store.Talk) string {
	return firstOf(t.Company, t.Person, "them")
}

func talkEnd(t store.Talk) time.Time {
	m := t.Minutes
	if m <= 0 {
		m = 45
	}
	return time.Unix(t.At, 0).Add(time.Duration(m) * time.Minute)
}

// remind runs every few minutes.
func (e *Engine) remind(now time.Time) {
	if !e.S.Profile().SetupDone {
		return
	}
	day := func(t time.Time) string { return t.Format("2006-01-02") }
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// The evening before a conversation, with the prep pack ready.
	if now.Hour() >= 18 {
		talks, _ := e.S.Talks(midnight.Add(24*time.Hour).Unix(), midnight.Add(48*time.Hour).Unix())
		for _, t := range talks {
			if !e.saidOnce(fmt.Sprintf("eve:%d:%d", t.ID, t.At)) {
				continue
			}
			text := "Your prep pack is ready: ten minutes with it tonight is worth more than an hour tomorrow."
			if len(t.Prep) < 5 {
				id := t.ID
				e.Go(fmt.Sprintf("prep:%d", id), "Preparing you for a conversation", func(ctx context.Context) error { return e.PrepTalk(ctx, id) })
				text = "Job Hunt is writing your prep pack now."
			}
			e.Say(true, "A conversation tomorrow", fmt.Sprintf("Tomorrow at %s: %s with %s", time.Unix(t.At, 0).In(now.Location()).Format("15:04"), strings.ToLower(firstOf(t.Title, "conversation")), talkWith(t)), text, fmt.Sprintf("#/interviews/%d", t.ID))
		}
	}

	// About an hour and a half after one: how did it go, and a thank-you.
	talks, _ := e.S.Talks(now.Add(-26*time.Hour).Unix(), now.Unix())
	for _, t := range talks {
		if now.Sub(talkEnd(t)) < 90*time.Minute || e.TalkWent(t.ID) != "" {
			continue
		}
		if e.saidOnce(fmt.Sprintf("after:%d:%d", t.ID, t.At)) {
			e.Say(false, "How did it go?", "How did it go with "+talkWith(t)+"?", "Say how it went. Write a thank-you to "+talkWith(t)+" while it is fresh? Press Write a thank-you and Job Hunt writes it.", fmt.Sprintf("#/interviews/%d", t.ID))
		}
	}

	// Two days before a posting stops taking applications.
	if roles, _ := e.S.RolesNamingADate(); len(roles) > 0 {
		for _, r := range roles {
			if r.Closed != "" || stageOrder(r.Stage) >= stageOrder("applied") || (r.LaterUntil > now.Unix()) {
				continue
			}
			t, ok := Closes(r.Description)
			if !ok {
				continue
			}
			left := int(time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, now.Location()).Sub(midnight).Hours() / 24)
			if left < 0 || left > 2 || !e.saidOnce(fmt.Sprintf("closes:%d", r.ID)) {
				continue
			}
			when := map[int]string{0: "today", 1: "tomorrow"}[left]
			if when == "" {
				when = "on " + t.Format("Monday")
			}
			e.Say(false, "A role closes soon", "Closes "+when+": "+r.Title+" at "+r.Company, "You have not applied yet.", fmt.Sprintf("#/roles/%d", r.ID))
		}
	}

	// The morning summary, once a day, only when there is something in it.
	if h := e.Desk().Morning; h >= 0 && now.Hour() >= h && now.Hour() < h+4 && e.saidOnce("morning:"+day(now)) {
		if title, text := e.morning(now); title != "" {
			e.Say(false, "Your morning summary", title, text, "#/today")
		}
	}
}

// morning puts the day into two lines. "" when nothing needs the person.
func (e *Engine) morning(now time.Time) (title, text string) {
	p := e.S.Profile()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	counts, _ := e.S.RoleCounts()
	var parts []string
	talks, _ := e.S.Talks(now.Unix(), midnight.Add(24*time.Hour).Unix())
	for _, t := range talks {
		parts = append(parts, fmt.Sprintf("%s at %s", strings.ToLower(firstOf(t.Title, "conversation")), time.Unix(t.At, 0).In(now.Location()).Format("15:04")))
	}
	if _, n, _ := e.S.Mails(store.MailFilter{State: "new", Limit: 1}); n > 0 {
		parts = append(parts, countWord(n, "reply")+" to answer")
	}
	if n := counts["ready"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d ready to send", n))
	}
	due, _ := e.S.NotesDue(now.Unix())
	if n := len(due) + len(e.quietApplications(p, now)); n > 0 {
		parts = append(parts, countWord(n, "follow-up")+" due")
	}
	var lines []string
	if now.Weekday() == time.Monday {
		// The week that just ended, Monday to Sunday.
		from, to := weekStart(now).AddDate(0, 0, -7).Unix(), weekStart(now).Unix()
		applied := e.S.Count(`SELECT COUNT(*) FROM roles WHERE applied_at >= ? AND applied_at < ?`, from, to)
		heard := e.S.Count(`SELECT COUNT(*) FROM mails WHERE at >= ? AND at < ? AND kind IN ('interview','assessment','question','offer','person')`, from, to)
		said := e.S.Count(`SELECT COUNT(*) FROM mails WHERE at >= ? AND at < ? AND kind = 'rejection'`, from, to)
		spoke := e.S.CountTalks(from, to)
		if applied+heard+said+spoke > 0 {
			lines = append(lines, fmt.Sprintf("Last week: %d applied, %s, %s, %d said no.", applied, countWord(heard, "reply"), countWord(spoke, "conversation"), said))
		}
	}
	if len(parts) == 0 && len(lines) == 0 {
		return "", ""
	}
	if len(parts) == 0 {
		return "Nothing needs you this morning", strings.Join(lines, " ")
	}
	return "Today: " + strings.Join(parts, ", "), strings.TrimSpace(strings.Join(lines, " ") + " Open Today to start with the freshest.")
}

// ---- after a conversation ----------------------------------------------------------

// TalkWent is what the person said about how a conversation went:
// "next", "offer", "no", "fine", or "" when they have not said.
func (e *Engine) TalkWent(id int64) string {
	return e.S.GetString(fmt.Sprintf("talk:went:%d", id))
}

// SetTalkWent records how a conversation went and moves the role with it.
// The person pressed the button, so closing the role here is their doing.
func (e *Engine) SetTalkWent(id int64, how string) error {
	t, err := e.S.Talk(id)
	if err != nil {
		return err
	}
	var text string
	switch how {
	case "next":
		text = "It went well: another round is coming"
	case "offer":
		text = "They are making an offer"
	case "no":
		text = "They said no after the conversation"
	case "fine":
		text = "The conversation happened; waiting to hear"
	default:
		return errors.New("say how it went: next, offer, no or fine")
	}
	e.S.Set(fmt.Sprintf("talk:went:%d", id), how)
	if t.RoleID != 0 {
		switch how {
		case "next":
			e.S.Advance(t.RoleID, "interview")
		case "offer":
			e.S.Advance(t.RoleID, "offer")
		case "no":
			e.S.CloseRole(t.RoleID, "rejected", "They said no after "+strings.ToLower(firstOf(t.Title, "the conversation"))+" on "+time.Unix(t.At, 0).Format("2 January"))
		}
	}
	e.S.Log(store.Activity{Kind: "talk", RoleID: t.RoleID, PersonID: t.PersonID, CompanyID: t.CompanyID, Text: text})
	e.S.Changed("talks", "today", "roles", "progress")
	return nil
}

// Thanks is a thank-you note for after a conversation. The person sends it.
type Thanks struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
	At      int64  `json:"at"`
}

func (e *Engine) TalkThanks(id int64) Thanks {
	var th Thanks
	e.S.Get(fmt.Sprintf("talk:thanks:%d", id), &th)
	return th
}

// WriteThanks drafts the thank-you for a conversation.
func (e *Engine) WriteThanks(ctx context.Context, id int64) error {
	t, err := e.S.Talk(id)
	if err != nil {
		return err
	}
	var post *brain.Posting
	if t.RoleID != 0 {
		if r, err := e.S.Role(t.RoleID); err == nil {
			x := postingOf(r)
			post = &x
		}
	}
	why := "You spoke on " + time.Unix(t.At, 0).Format("Monday 2 January") + " (" + strings.ToLower(firstOf(t.Title, "a conversation")) + ")."
	if n := strings.TrimSpace(t.Notes); n != "" {
		why += " The person's own notes from it: " + clipText(n, 1200)
	}
	target := brain.Target{Name: firstOf(t.Person, "the person you spoke with"), Company: t.Company, Kind: "contact", Why: why}
	if t.PersonID != 0 {
		if p, err := e.S.Person(t.PersonID); err == nil {
			target.Title, target.Kind = p.Title, p.Kind
		}
	}
	msg, err := e.brain.Note(ctx, e.Person(), target, brain.PurposeThanks, "email", post, "")
	if err != nil {
		return err
	}
	e.S.Set(fmt.Sprintf("talk:thanks:%d", id), Thanks{Subject: msg.Subject, Body: msg.Body, At: e.Now().Unix()})
	e.S.Changed("talks")
	return nil
}

// SaveThanks keeps the person's own wording.
func (e *Engine) SaveThanks(id int64, subject, body string) error {
	th := e.TalkThanks(id)
	th.Subject, th.Body = strings.TrimSpace(subject), strings.TrimSpace(body)
	return e.S.Set(fmt.Sprintf("talk:thanks:%d", id), th)
}
