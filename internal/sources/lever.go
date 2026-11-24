package sources

import (
	"context"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const leverAPI = "https://api.lever.co"

type leverPosting struct {
	ID         string  `json:"id"`
	Text       string  `json:"text"`
	HostedURL  string  `json:"hostedUrl"`
	ApplyURL   string  `json:"applyUrl"`
	CreatedAt  float64 `json:"createdAt"` // milliseconds since 1970
	Categories struct {
		Location     string   `json:"location"`
		AllLocations []string `json:"allLocations"`
	} `json:"categories"`
	WorkplaceType    string `json:"workplaceType"`
	DescriptionPlain string `json:"descriptionPlain"`
	Description      string `json:"description"`
	Lists            []struct {
		Text    string `json:"text"`
		Content string `json:"content"`
	} `json:"lists"`
	AdditionalPlain        string       `json:"additionalPlain"`
	Additional             string       `json:"additional"`
	SalaryRange            *leverSalary `json:"salaryRange"`
	SalaryDescriptionPlain string       `json:"salaryDescriptionPlain"`
}

type leverSalary struct {
	Min      float64 `json:"min"`
	Max      float64 `json:"max"`
	Currency string  `json:"currency"`
	Interval string  `json:"interval"`
}

func (c *Client) leverPostingsURL(token string) string {
	return c.base(kindLever, leverAPI) + "/v0/postings/" + url.PathEscape(token) + "?mode=json"
}

// listLever reads a whole board in one request; descriptions come with it.
func (c *Client) listLever(ctx context.Context, b Board) ([]Posting, error) {
	var res []leverPosting
	if err := c.getJSON(ctx, c.leverPostingsURL(b.Token), &res); err != nil {
		return nil, err
	}
	out := make([]Posting, 0, len(res))
	for _, j := range res {
		if j.ID == "" {
			continue
		}
		location := joinLocations(j.Categories.AllLocations...)
		if location == "" {
			location = joinLocations(j.Categories.Location)
		}
		p := Posting{
			Source:      kindLever,
			Key:         postingKey(b, j.ID),
			Title:       j.Text,
			Location:    location,
			Workplace:   firstNonEmpty(workplaceOf(j.WorkplaceType), workplaceOf(location)),
			URL:         firstNonEmpty(webURL(j.HostedURL), "https://jobs.lever.co/"+url.PathEscape(b.Token)+"/"+url.PathEscape(j.ID)),
			ApplyURL:    webURL(j.ApplyURL),
			Description: leverDescription(j),
			Pay:         firstNonEmpty(j.SalaryRange.String(), tidyText(j.SalaryDescriptionPlain)),
			Applicants:  -1,
		}
		if j.CreatedAt > 0 {
			p.PostedAt = time.UnixMilli(int64(j.CreatedAt))
		}
		out = append(out, p)
	}
	return out, nil
}

// leverDescription stitches Lever's pieces together: the opening text, each
// list under its heading, then the closing text.
func leverDescription(j leverPosting) string {
	blocks := []string{plainOrHTML(j.DescriptionPlain, j.Description)}
	for _, l := range j.Lists {
		blocks = append(blocks, strings.TrimSpace(tidyText(l.Text)+"\n"+HTMLToText(l.Content)))
	}
	blocks = append(blocks, plainOrHTML(j.AdditionalPlain, j.Additional))
	return joinSections(blocks...)
}

// plainOrHTML prefers a source's own plain-text rendering and converts the
// HTML one when there is none.
func plainOrHTML(plain, markup string) string {
	if t := tidyText(plain); t != "" {
		return t
	}
	return HTMLToText(markup)
}

// String renders a salary range for people, e.g. "CAD 100,000 – 140,000 per year".
func (s *leverSalary) String() string {
	if s == nil || (s.Min <= 0 && s.Max <= 0) {
		return ""
	}
	amount := formatAmount(s.Min) + " – " + formatAmount(s.Max)
	switch {
	case s.Min <= 0 || s.Min == s.Max:
		amount = formatAmount(s.Max)
	case s.Max <= 0:
		amount = formatAmount(s.Min)
	}
	// "per-year-salary", "per-hour-wage" → "per year", "per hour"
	interval := strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(s.Interval), "-salary"), "-wage")
	interval = strings.ReplaceAll(interval, "-", " ")
	return strings.Join(strings.Fields(strings.ToUpper(s.Currency)+" "+amount+" "+interval), " ")
}

// formatAmount writes 140000 as "140,000" and 55.5 as "55.50".
func formatAmount(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) >= 1e15 {
		return "0"
	}
	digits, frac := strconv.FormatFloat(v, 'f', 2, 64), ""
	digits, frac, _ = strings.Cut(digits, ".")
	if frac == "00" {
		frac = ""
	}
	var b strings.Builder
	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 && digits[i-1] != '-' {
			b.WriteByte(',')
		}
		b.WriteRune(d)
	}
	if frac != "" {
		b.WriteString("." + frac)
	}
	return b.String()
}
