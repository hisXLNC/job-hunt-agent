package engine

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// Quick facts about a role, worked out by rule from the posting so that a
// list can show them at a glance. No Claude call is made for any of this.

// Tag is one short thing worth knowing about a row, with how loudly to say it.
type Tag struct {
	Text string `json:"text"`
	Tone string `json:"tone,omitempty"` // "", info, good, warn, crit
}

var (
	partRe     = regexp.MustCompile(`(?i)\bpart[- ]time\b`)
	fullRe     = regexp.MustCompile(`(?i)\b(full[- ]time|permanent)\b`)
	contractRe = regexp.MustCompile(`(?i)\b(contract(or)?( position| role| opportunity)?|fixed[- ]term|temporary|maternity (leave )?(cover|contract)|parental leave (cover|contract))\b`)
	internRe   = regexp.MustCompile(`(?i)\b(intern(ship)?|co-?op|summer student)\b`)
	monthsRe   = regexp.MustCompile(`(?i)\b(\d{1,2})[- ]?(?:\+ ?)?month(?:s)?\b`)
	typeLineRe = regexp.MustCompile(`(?i)(employment type|job type|position type|type of (?:employment|position)|work type|status)\s*[:\-]\s*([^\n.;|]{3,40})`)
)

// JobType says whether a posting is full-time, part-time, a contract or an
// internship; "" when it does not say.
func JobType(title, desc string) string {
	if len(desc) > 6000 {
		desc = desc[:6000]
	}
	months := func(s string) string {
		if m := monthsRe.FindStringSubmatch(s); m != nil {
			return ", " + m[1] + " mo"
		}
		return ""
	}
	if internRe.MatchString(title) {
		return "Internship"
	}
	if contractRe.MatchString(title) {
		return "Contract" + months(title)
	}
	if partRe.MatchString(title) {
		return "Part-time"
	}
	// A labelled line in the posting is the most trustworthy.
	if m := typeLineRe.FindStringSubmatch(desc); m != nil {
		v := m[2]
		switch {
		case partRe.MatchString(v):
			return "Part-time"
		case contractRe.MatchString(v):
			return "Contract" + months(desc)
		case internRe.MatchString(v):
			return "Internship"
		case fullRe.MatchString(v):
			return "Full-time"
		}
	}
	switch {
	case partRe.MatchString(desc) && !fullRe.MatchString(desc):
		return "Part-time"
	case regexp.MustCompile(`(?i)\b(\d{1,2})[- ]?month (contract|term|assignment)|contract (position|role|opportunity)|fixed[- ]term\b`).MatchString(desc):
		return "Contract" + months(desc)
	case fullRe.MatchString(desc):
		return "Full-time"
	}
	return ""
}

var moneyRe = regexp.MustCompile(`(?i)\$?\s*(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(k)?`)

// PayPerYear reads the top of a pay range as a yearly amount; 0 when the
// posting names no pay it can read.
func PayPerYear(pay string) int {
	if strings.TrimSpace(pay) == "" {
		return 0
	}
	low := strings.ToLower(pay)
	top := 0.0
	for _, m := range moneyRe.FindAllStringSubmatch(pay, -1) {
		n, err := strconv.ParseFloat(strings.NewReplacer(",", "", " ", "").Replace(m[1]), 64)
		if err != nil {
			continue
		}
		if m[2] != "" {
			n *= 1000
		}
		if n > top {
			top = n
		}
	}
	switch {
	case top == 0:
		return 0
	case strings.Contains(low, "hour") || strings.Contains(low, "/hr") || strings.Contains(low, "/h") || top < 400:
		return int(top * 2080)
	case strings.Contains(low, "day") && top < 5000:
		return int(top * 230)
	case strings.Contains(low, "month") && top < 40000:
		return int(top * 12)
	}
	return int(top)
}

var closesRe = regexp.MustCompile(`(?i)(?:closing date|closes(?: on)?|apply by|applications? (?:close|due|deadline)(?: on)?|deadline(?: to apply)?(?: is)?|posting end date)\s*[:\-]?\s*(?:is\s+)?((?:\d{4}-\d{2}-\d{2})|(?:[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})|(?:\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9}\.?,? \d{4}))`)

// Closes finds the date a posting says it stops taking applications.
func Closes(desc string) (time.Time, bool) {
	m := closesRe.FindStringSubmatch(desc)
	if m == nil {
		return time.Time{}, false
	}
	v := regexp.MustCompile(`(\d)(st|nd|rd|th)`).ReplaceAllString(strings.NewReplacer(",", "", ".", "").Replace(m[1]), "$1")
	for _, f := range []string{"2006-01-02", "January 2 2006", "Jan 2 2006", "2 January 2006", "2 Jan 2006"} {
		if t, err := time.Parse(f, v); err == nil {
			return t.Add(23 * time.Hour), true
		}
	}
	return time.Time{}, false
}

// roleFacts fills the at-a-glance columns and the "worth knowing" tags of a card.
func (e *Engine) roleFacts(c *Card, r store.Role, desc string, rd *brain.Reading, payFloor int, now time.Time) {
	c.Company, c.CompanyID, c.Place, c.Workplace, c.Pay = r.Company, r.CompanyID, r.Location, r.Workplace, r.Pay
	c.JobType = JobType(r.Title, desc)
	c.PayYear = PayPerYear(r.Pay)
	add := func(text, tone string) { c.Tags = append(c.Tags, Tag{Text: text, Tone: tone}) }
	if r.CompanyID != 0 {
		if n := e.S.Count(`SELECT COUNT(*) FROM roles WHERE company_id = ? AND id <> ? AND applied_at > 0`, r.CompanyID, r.ID); n > 0 {
			add("Applied here "+times(n), "info")
		}
		if n := e.S.Count(`SELECT COUNT(*) FROM roles WHERE company_id = ? AND id <> ? AND lower(title) = lower(?)`, r.CompanyID, r.ID, r.Title); n > 0 {
			add(fmt.Sprintf("Posted %d times", n+1), "warn")
		}
	}
	if t, ok := Closes(desc); ok {
		switch d := t.Sub(now); {
		case d < 0:
			add("Closed "+t.Format("2 Jan"), "crit")
		case d < 5*24*time.Hour:
			add("Closes "+t.Format("Mon 2 Jan"), "warn")
		default:
			add("Closes "+t.Format("2 Jan"), "")
		}
	}
	if y := PayPerYear(r.Pay); payFloor > 0 && y > 0 && y < payFloor {
		add("Under your pay floor", "crit")
	}
	switch c.JobType {
	case "Part-time", "Internship":
		add(c.JobType, "warn")
	}
	if age := now.Sub(time.Unix(r.Age(), 0)); age > 30*24*time.Hour {
		add(fmt.Sprintf("Open %d days", int(age.Hours()/24)), "warn")
	}
	switch r.Band {
	case "step_up":
		add("A step up", "")
	case "sideways":
		add("Sideways", "")
	}
	if rd != nil {
		if rd.Agency {
			add("Through a recruiter", "")
		}
		for _, a := range rd.Asks {
			if a.Strength == "gap" && len(a.Ask) <= 34 {
				add("Gap: "+a.Ask, "warn")
				break
			}
		}
	}
	if len(c.Tags) > 3 {
		c.Tags = c.Tags[:3]
	}
}

func times(n int) string {
	switch n {
	case 1:
		return "once"
	case 2:
		return "twice"
	}
	return fmt.Sprintf("%d times", n)
}
