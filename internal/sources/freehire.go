package sources

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// FreeHire is a free index of postings gathered from employers' own boards.
// It needs no key and answers in JSON, description included.

const freeHireHost = "https://freehire.me"

type freeHireAnswer struct {
	Data []struct {
		Title      string `json:"title"`
		Company    string `json:"company"`
		URL        string `json:"url"`
		Slug       string `json:"public_slug"`
		ExternalID flexID `json:"external_id"`
		Location   string `json:"location"`
		WorkMode   string `json:"work_mode"`
		Desc       string `json:"description"`
		PostedAt   string `json:"posted_at"`
		Enrichment struct {
			Min      *float64 `json:"salary_min"`
			Max      *float64 `json:"salary_max"`
			Currency string   `json:"salary_currency"`
			Period   string   `json:"salary_period"`
			Summary  string   `json:"summary"`
		} `json:"enrichment"`
	} `json:"data"`
}

// findFreeHire returns the newest postings for a title in a country.
func (c *Client) findFreeHire(ctx context.Context, q Query) ([]Posting, error) {
	v := url.Values{}
	v.Set("q", strings.TrimSpace(q.Keywords))
	v.Set("limit", "100")
	v.Set("sort", "posted_at")
	v.Set("order", "desc")
	v.Set("description_format", "markdown")
	if cc := strings.ToUpper(strings.TrimSpace(q.Country)); len(cc) == 2 {
		v.Set("countries", cc)
	}
	var res freeHireAnswer
	if err := c.getJSON(ctx, c.base(kindFreeHire, freeHireHost)+"/api/v1/agent/jobs/search?"+v.Encode(), &res); err != nil {
		return nil, err
	}
	var out []Posting
	cutoff := c.clock().Add(-q.Within)
	for _, j := range res.Data {
		link := webURL(dropParam(j.URL, "utm_source"))
		id := firstNonEmpty(j.Slug, string(j.ExternalID))
		if strings.TrimSpace(j.Title) == "" || strings.TrimSpace(j.Company) == "" || link == "" || id == "" {
			continue
		}
		p := Posting{
			Source:      kindFreeHire,
			Key:         kindFreeHire + ":" + id,
			Company:     strings.TrimSpace(j.Company),
			Title:       strings.TrimSpace(j.Title),
			Location:    strings.TrimSpace(j.Location),
			URL:         link,
			Description: markdownToText(firstNonEmpty(j.Desc, j.Enrichment.Summary)),
			PostedAt:    parseTime(j.PostedAt),
			Applicants:  -1,
		}
		p.Workplace = firstNonEmpty(workplaceOf(j.WorkMode), workplaceOf(p.Location))
		p.Pay = payText(j.Enrichment.Min, j.Enrichment.Max, j.Enrichment.Currency, j.Enrichment.Period)
		if q.Within > 0 && !p.PostedAt.IsZero() && p.PostedAt.Before(cutoff) {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// dropParam removes one query parameter from an address.
func dropParam(raw, name string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return raw
	}
	q := u.Query()
	if !q.Has(name) {
		return raw
	}
	q.Del(name)
	u.RawQuery = q.Encode()
	return u.String()
}

// payText writes a salary range the way a person would.
func payText(lo, hi *float64, currency, period string) string {
	money := func(x float64) string { return thousands(int64(x + 0.5)) }
	amount := ""
	switch {
	case lo != nil && hi != nil && *lo > 0 && *hi > *lo:
		amount = money(*lo) + " to " + money(*hi)
	case hi != nil && *hi > 0:
		amount = money(*hi)
		if lo == nil || *lo <= 0 {
			amount = "up to " + amount
		}
	case lo != nil && *lo > 0:
		amount = "from " + money(*lo)
	default:
		return ""
	}
	out := strings.TrimSpace(strings.ToUpper(strings.TrimSpace(currency)) + " " + amount)
	switch p := strings.ToLower(strings.TrimSpace(period)); p {
	case "":
	case "year", "yearly", "annual", "annually":
		out += " a year"
	case "hour", "hourly":
		out += " an hour"
	default:
		out += " a " + strings.TrimSuffix(p, "ly")
	}
	return out
}

func thousands(n int64) string {
	s := fmt.Sprint(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// markdownToText keeps a markdown description readable as plain text: list
// markers become "- ", headings and emphasis lose their marks.
func markdownToText(s string) string {
	var out []string
	for _, l := range strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n") {
		t := strings.TrimSpace(l)
		t = strings.TrimLeft(t, "#")
		t = strings.TrimSpace(t)
		if strings.HasPrefix(t, "* ") || strings.HasPrefix(t, "+ ") || strings.HasPrefix(t, "• ") {
			t = "- " + strings.TrimSpace(t[2:])
		}
		t = strings.NewReplacer("**", "", "__", "", "`", "").Replace(t)
		out = append(out, t)
	}
	return tidyText(strings.Join(out, "\n"))
}
