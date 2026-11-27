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
func (e *Engine) roleFacts(c *Card, r store.Role, desc string, rd *brain.Reading, p store.Profile, now time.Time) {
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
	if payBelow(p, r.Pay) {
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

// ---- pay named in the posting's own words ---------------------------------------------

const payCur = `(?:CAD|USD|AUD|NZD|GBP|EUR|CHF|SGD|C\$|CA\$|US\$|AU\$|A\$|\$|£|€)`
const payNum = `\d{1,3}(?:[,.\s]\d{3})+(?:\.\d{2})?|\d{2,3}(?:\.\d{1,2})?\s?[kK]|\d{2,6}(?:\.\d{1,2})?`
const payPer = `(?:\s?(?:per|a|an|each|/)\s?(?:hour|hr|h|year|yr|annum|month|week|day)\b|\s?(?:annually|hourly|yearly|p\.?a\.?)(?:\b|$))`

var (
	// "$85,000 - $105,000 a year", "CAD 40.50/hour", "£45k–£55k"
	payMarkedRe = regexp.MustCompile(`(?i)` + payCur + `\s?(?:` + payNum + `)` + payPer + `?(?:\s?(?:-|–|—|to|and)\s?` + payCur + `?\s?(?:` + payNum + `))?(?:\s?(?:CAD|USD|AUD|GBP|EUR))?` + payPer + `?`)
	// "110 000 $ – 130 000 $", the sign after the number as in French
	payTrailRe = regexp.MustCompile(`(?i)(?:` + payNum + `)\s?\$(?:\s?(?:-|–|—|to|à)\s?(?:` + payNum + `)\s?\$)?` + payPer + `?`)
	// "90,000 to 110,000 CAD per year", where no sign comes first
	payBareRe   = regexp.MustCompile(`(?i)(?:` + payNum + `)\s?(?:-|–|—|to)\s?(?:` + payNum + `)(?:\s?(?:CAD|USD|AUD|GBP|EUR|dollars))?` + payPer + `?`)
	payPerEndRe = regexp.MustCompile(`(?i)` + payPer + `$`)
	payWordRe   = regexp.MustCompile(`(?i)\b(salary|salaries|salaire|compensation|pay range|base pay|pay rate|pay:|wage|hourly rate|remuneration|pay band|pay scale|rate of pay|earn|OTE|on-target earnings|per hour|per year|annually|/hr|/hour|/yr|/year)\b`)
	// payLooseRe counts only next to a currency sign: "a range of 25,000 to
	// 50,000 users" is not pay, "the range for this role is $95,000" is.
	payLooseRe = regexp.MustCompile(`(?i)\b(range|pays|paying)\b`)
	// payThingRe: what a bare "$50,000 - $500,000" is about when it isn't pay.
	payThingRe = regexp.MustCompile(`(?i)\b(transactions?|deals?|loans?|accounts?|contracts?|projects?|clients?|claims?|invoices?|purchases?|spend|limits?|grants?|awards?|prizes?|donations?)\b`)
	payNotRe   = regexp.MustCompile(`(?i)\b(revenue|funding|raised|valuation|billion|million|customers|assets|portfolio|budget|turnover|sales of|ARR|bonus of|sign-?on|signing bonus|referral|allowance|stipend|reimburse|tuition|rrsp|401\(?k|coverage|benefit of|up to \$?\d+ (?:for|toward))`)
)

// PayFromText finds the pay a posting names in its own text, for the many
// postings whose source gives no pay of its own. "" when it names none it
// can be sure of: a wrong figure is worse than none.
func PayFromText(desc string) string {
	if len(desc) > 60000 {
		desc = desc[:60000]
	}
	best, bestScore := "", 0
	try := func(loc []int, marked bool) {
		got := strings.Join(strings.Fields(desc[loc[0]:loc[1]]), " ")
		from, to := max(0, loc[0]-90), min(len(desc), loc[1]+40)
		around := desc[from:to]
		hasPer := payPerEndRe.MatchString(got)
		worded := payWordRe.MatchString(around) || (marked && payLooseRe.MatchString(around))
		ranged := strings.ContainsAny(got, "-–—") || strings.Contains(strings.ToLower(got), " to ") || strings.Contains(got, " à ")
		// "$90K - $110K" on a line of its own is a pay line too.
		if !hasPer && !worded && !(marked && ranged && !payThingRe.MatchString(desc[max(0, loc[0]-45):min(len(desc), loc[1]+25)])) {
			return
		}
		if payNotRe.MatchString(desc[max(0, loc[0]-45):min(len(desc), loc[1]+25)]) {
			return
		}
		y := PayPerYear(got)
		if y < 20000 || y > 1500000 {
			return
		}
		score := 1
		if marked {
			score++
		}
		if hasPer {
			score++
		}
		if worded {
			score++
		}
		if ranged {
			score++ // a range is what a posting's pay line looks like
		}
		if score > bestScore {
			best, bestScore = got, score
		}
	}
	for _, loc := range payMarkedRe.FindAllStringIndex(desc, 40) {
		try(loc, true)
	}
	for _, loc := range payTrailRe.FindAllStringIndex(desc, 40) {
		try(loc, true)
	}
	for _, loc := range payBareRe.FindAllStringIndex(desc, 40) {
		try(loc, false)
	}
	if bestScore < 3 {
		return ""
	}
	return strings.TrimRight(best, " .,;")
}

// payBelow reports whether a posting's pay is under the person's floor. Pay in
// another currency than the one where the person will work is never compared:
// a role is not set aside on a guessed exchange rate.
func payBelow(p store.Profile, pay string) bool {
	floor, y := floorPerYear(p), PayPerYear(pay)
	if floor <= 0 || y <= 0 {
		return false
	}
	if c, home := payCurrency(pay), homeCurrency(p.Country); c != "" && home != "" && c != home {
		return false
	}
	return y < floor
}

var currencyWords = []struct{ code, re string }{
	{"USD", `\bUSD\b|US\$|\bU\.S\. dollars?`}, {"CAD", `\bCAD\b|C\$|CA\$|\bCanadian dollars?`},
	{"GBP", `£|\bGBP\b`}, {"EUR", `€|\bEUR\b|\beuros?\b`}, {"AUD", `\bAUD\b|A\$|AU\$`},
	{"AED", `\bAED\b|\bdirhams?\b`}, {"INR", `₹|\bINR\b|\blakhs?\b`}, {"SGD", `\bSGD\b|S\$`}, {"NZD", `\bNZD\b|NZ\$`},
	{"CHF", `\bCHF\b`}, {"SAR", `\bSAR\b|\briyals?\b`},
}

var currencyRes = func() []*regexp.Regexp {
	var out []*regexp.Regexp
	for _, c := range currencyWords {
		out = append(out, regexp.MustCompile(`(?i)`+c.re))
	}
	return out
}()

// payCurrency is the currency a pay line names, or "" when it names none (a
// bare $ is taken to be the local dollar).
func payCurrency(pay string) string {
	for i, re := range currencyRes {
		if re.MatchString(pay) {
			return currencyWords[i].code
		}
	}
	return ""
}

// homeCurrency is the currency of the country the person will work in.
func homeCurrency(country string) string {
	switch strings.ToLower(strings.TrimSpace(country)) {
	case "canada", "ca":
		return "CAD"
	case "united states", "usa", "us", "united states of america":
		return "USD"
	case "united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "great britain":
		return "GBP"
	case "ireland", "germany", "france", "netherlands", "spain", "italy", "belgium", "portugal", "austria", "finland", "luxembourg", "greece":
		return "EUR"
	case "australia":
		return "AUD"
	case "united arab emirates", "uae":
		return "AED"
	case "india":
		return "INR"
	case "singapore":
		return "SGD"
	case "new zealand":
		return "NZD"
	case "switzerland":
		return "CHF"
	case "saudi arabia":
		return "SAR"
	}
	return ""
}
