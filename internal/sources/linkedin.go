package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	linkedInHost   = "https://www.linkedin.com"
	linkedInURNKey = "urn:li:jobPosting:"
)

var (
	linkedInViewRE = regexp.MustCompile(`/jobs/view/(?:[^/?#]*-)?(\d+)/?(?:[?#]|$)`)
	agoRE          = regexp.MustCompile(`(?i)(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago`)
	countRE        = regexp.MustCompile(`\d[\d,]*`)
)

// Search runs one page (25 results) of LinkedIn's public guest job search,
// newest first. Results carry no description: use Detail.
//
// LinkedIn answers 429 or 999 when it is throttling. That comes back as an
// *HTTPError and is never retried here, so the caller can back off.
func (c *Client) Search(ctx context.Context, q Query) ([]Posting, error) {
	v := url.Values{}
	if s := strings.TrimSpace(q.Keywords); s != "" {
		v.Set("keywords", s)
	}
	if s := strings.TrimSpace(q.Location); s != "" {
		v.Set("location", s)
	}
	if q.Within > 0 {
		v.Set("f_TPR", "r"+strconv.FormatInt(max(int64(q.Within/time.Second), 1), 10))
	}
	if q.Remote {
		v.Set("f_WT", "2")
	}
	if q.FewApplicants {
		v.Set("f_EA", "true")
	}
	v.Set("start", strconv.Itoa(max(q.Start, 0)))
	v.Set("sortBy", "DD")

	u := c.base(kindLinkedIn, linkedInHost) + "/jobs-guest/jobs/api/seeMoreJobPostings/search?" + v.Encode()
	body, _, err := c.getHTML(ctx, u)
	if err != nil {
		return nil, err
	}
	out := parseLinkedInSearch(body, c.clock())
	if q.Remote {
		for i := range out {
			out[i].Workplace = "remote" // the filter guarantees it
		}
	}
	return out, nil
}

// parseLinkedInSearch reads the result cards out of a search fragment.
func parseLinkedInSearch(body string, now time.Time) []Posting {
	d := parseHTML(body)

	// One card per <li>; without any, one card per element that names a job.
	isCard := func(t token) bool { return t.name == "li" }
	if d.find(0, len(d.toks), isCard) < 0 {
		isCard = func(t token) bool { return strings.HasPrefix(t.attr("data-entity-urn"), linkedInURNKey) }
	}
	var starts []int
	for i := d.find(0, len(d.toks), isCard); i >= 0; i = d.find(i+1, len(d.toks), isCard) {
		starts = append(starts, i)
	}

	var out []Posting
	seen := map[string]bool{}
	for n, lo := range starts {
		hi := len(d.toks)
		if n+1 < len(starts) {
			hi = starts[n+1]
		}
		if p, ok := linkedInCard(d, lo, hi, now); ok && !seen[p.Key] {
			seen[p.Key] = true
			out = append(out, p)
		}
	}
	return out
}

// linkedInCard reads one search result from toks[lo:hi].
func linkedInCard(d htmlDoc, lo, hi int, now time.Time) (Posting, bool) {
	id := ""
	if i := d.find(lo, hi, func(t token) bool { return strings.HasPrefix(t.attr("data-entity-urn"), linkedInURNKey) }); i >= 0 {
		id = strings.TrimPrefix(d.toks[i].attr("data-entity-urn"), linkedInURNKey)
	}
	if !isDigits(id) {
		// Fall back to the id at the end of the card's link.
		link := d.find(lo, hi, func(t token) bool { return t.name == "a" && linkedInJobID(t.attr("href")) != "" })
		if link < 0 {
			return Posting{}, false
		}
		id = linkedInJobID(d.toks[link].attr("href"))
	}

	p := Posting{
		Source:      kindLinkedIn,
		Key:         kindLinkedIn + ":" + id,
		Company:     d.textOf(lo, hi, withClass("base-search-card__subtitle")),
		Title:       d.textOf(lo, hi, withClass("base-search-card__title")),
		Location:    d.textOf(lo, hi, withClass("job-search-card__location")),
		URL:         linkedInHost + "/jobs/view/" + id, // canonical: no tracking parameters
		Pay:         d.textOf(lo, hi, withClass("job-search-card__salary-info")),
		Applicants:  -1,
		NeedsDetail: true,
	}
	p.Workplace = workplaceOf(p.Location)
	if i := d.find(lo, hi, func(t token) bool { return t.name == "time" }); i >= 0 {
		p.PostedAt = linkedInPostedAt(d.text(i), d.toks[i].attr("datetime"), now)
	}
	return p, true
}

// linkedInPostedAt prefers the card's wording when it is precise ("18
// minutes ago", "3 hours ago") and otherwise the date it carries.
func linkedInPostedAt(text, date string, now time.Time) time.Time {
	approx, precise := parseAgo(text, now)
	if precise {
		return approx
	}
	if t := parseTime(date); !t.IsZero() {
		if t.After(now) {
			return now // a date in a time zone ahead of ours
		}
		return t
	}
	return approx
}

// parseAgo reads "N units ago". precise is true when the unit is hours or
// smaller; without a readable age the time is zero.
func parseAgo(s string, now time.Time) (t time.Time, precise bool) {
	if strings.Contains(strings.ToLower(s), "just now") {
		return now, true
	}
	m := agoRE.FindStringSubmatch(s)
	if m == nil {
		return time.Time{}, false
	}
	n, err := strconv.Atoi(m[1])
	if err != nil || n > 100000 {
		return time.Time{}, false
	}
	unit := map[string]time.Duration{
		"second": time.Second,
		"minute": time.Minute,
		"hour":   time.Hour,
		"day":    24 * time.Hour,
		"week":   7 * 24 * time.Hour,
		"month":  30 * 24 * time.Hour,
		"year":   365 * 24 * time.Hour,
	}[strings.ToLower(m[2])]
	return now.Add(-time.Duration(n) * unit), unit <= time.Hour
}

// linkedInJobID returns the numeric job id of a /jobs/view/ link, or "".
func linkedInJobID(href string) string {
	if m := linkedInViewRE.FindStringSubmatch(href); m != nil {
		return m[1]
	}
	return ""
}

func isDigits(s string) bool {
	if s == "" || len(s) > 20 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func (c *Client) detailLinkedIn(ctx context.Context, p *Posting) error {
	id := strings.TrimPrefix(p.Key, kindLinkedIn+":")
	if !isDigits(id) {
		id = linkedInJobID(p.URL)
	}
	if !isDigits(id) {
		return fmt.Errorf("sources: posting key %q is not linkedin:<job id>", p.Key)
	}
	body, _, err := c.getHTML(ctx, c.base(kindLinkedIn, linkedInHost)+"/jobs-guest/jobs/api/jobPosting/"+id)
	if err != nil {
		return err
	}
	if !applyLinkedInDetail(body, p, c.clock()) {
		return fmt.Errorf("sources: linkedin posting %s: the answer holds no description", id)
	}
	p.NeedsDetail = false
	return nil
}

// applyLinkedInDetail copies what a job page fragment holds into p. It
// reports whether the fragment had a description at all.
func applyLinkedInDetail(body string, p *Posting, now time.Time) bool {
	d := parseHTML(body)
	all := len(d.toks)

	markup := d.find(0, all, withClass("show-more-less-html__markup"))
	if markup < 0 {
		return false
	}
	p.Description = HTMLToText(d.inner(markup))

	if n, ok := parseApplicants(d.textOf(0, all, withClass("num-applicants__caption"))); ok {
		p.Applicants = n
	}
	if pay := d.textOf(0, all, withClass("compensation__salary")); pay != "" {
		p.Pay = pay
	}
	if t, precise := parseAgo(d.textOf(0, all, withClass("posted-time-ago__text")), now); !t.IsZero() && (precise || p.PostedAt.IsZero()) {
		p.PostedAt = t
	}
	if i := d.find(0, all, func(t token) bool { return t.name == "code" && t.attr("id") == "applyUrl" }); i >= 0 {
		for j, end := i+1, d.closeOf(i); j < end; j++ {
			if d.toks[j].kind == tokComment {
				if u := linkedInApplyURL(d.toks[j].raw); u != "" {
					p.ApplyURL = u
				}
				break
			}
		}
	}

	// A posting known only by its id gets its headline fields too.
	if p.Title == "" {
		p.Title = d.textOf(0, all, withClass("top-card-layout__title", "topcard__title"))
	}
	if p.Company == "" {
		p.Company = d.textOf(0, all, withClass("topcard__org-name-link"))
	}
	if p.Location == "" {
		p.Location = d.textOf(0, all, withClass("topcard__flavor--bullet"))
	}
	if p.URL == "" {
		p.URL = linkedInHost + "/jobs/view/" + strings.TrimPrefix(p.Key, kindLinkedIn+":")
	}
	return true
}

// parseApplicants reads LinkedIn's applicant captions: "47 applicants" is
// 47, "Over 200 applicants" is 200, and "Be among the first 25 applicants"
// is 24, the most there can be.
func parseApplicants(s string) (int, bool) {
	lower := strings.ToLower(s)
	if !strings.Contains(lower, "applicant") {
		return 0, false
	}
	n, err := strconv.Atoi(strings.ReplaceAll(countRE.FindString(s), ",", ""))
	if err != nil {
		return 0, false
	}
	if strings.Contains(lower, "among the first") && n > 0 {
		n--
	}
	return n, true
}

// linkedInApplyURL digs the employer's own apply page out of the hidden
// "applyUrl" comment, whose body is a quoted LinkedIn redirect link with the
// real address in its "url" parameter. It returns "" when applying happens
// on LinkedIn itself.
func linkedInApplyURL(comment string) string {
	raw := strings.TrimSpace(comment)
	var quoted string
	if json.Unmarshal([]byte(raw), &quoted) == nil {
		raw = quoted
	} else {
		raw = strings.Trim(raw, `"'`)
	}
	raw = html.UnescapeString(raw)
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if target := webURL(u.Query().Get("url")); target != "" {
		return target
	}
	if host := strings.ToLower(u.Hostname()); host != "linkedin.com" && !strings.HasSuffix(host, ".linkedin.com") {
		return webURL(raw)
	}
	return ""
}
