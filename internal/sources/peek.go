package sources

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

var (
	ogTitleRE = regexp.MustCompile(`(?is)<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)`)
	ogSiteRE  = regexp.MustCompile(`(?is)<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)`)
	h1RE      = regexp.MustCompile(`(?is)<h1[^>]*>(.*?)</h1>`)
	pageTitle = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

// Peek reads one posting's own page for what a person adding it by hand
// would type: the title, the employer, the place and the text. Only pages on
// the public internet are opened; what comes back is the page's own words,
// to be shown to the person before anything is kept.
func (c *Client) Peek(ctx context.Context, raw string) (Posting, error) {
	u, ok := publicURL(raw)
	if !ok {
		return Posting{}, errors.New("that is not a web address Job Hunt can open")
	}
	body, final, _, err := c.open(ctx, u.String(), false)
	if err != nil {
		return Posting{}, err
	}
	if final == nil {
		final = u
	}
	p := Posting{URL: u.String(), Applicants: -1}
	for _, j := range jsonLDPostings(body) {
		got, _ := fromJSONLD(j, final)
		if len(got.Description) < len(p.Description) && p.Title != "" {
			continue
		}
		p.Title, p.Company, p.Location, p.Pay = firstNonEmpty(got.Title, p.Title), firstNonEmpty(got.Company, p.Company), firstNonEmpty(got.Location, p.Location), firstNonEmpty(got.Pay, p.Pay)
		p.Description = got.Description
	}
	if p.Title == "" {
		for _, re := range []*regexp.Regexp{ogTitleRE, h1RE, pageTitle} {
			if m := re.FindStringSubmatch(body); m != nil {
				if t := plainLine(HTMLToText(m[1])); t != "" {
					p.Title = t
					break
				}
			}
		}
	}
	if p.Company == "" {
		if m := ogSiteRE.FindStringSubmatch(body); m != nil {
			p.Company = plainLine(HTMLToText(m[1]))
		}
	}
	if len(strings.Fields(p.Description)) < 40 {
		if t := mainText(body); len(strings.Fields(t)) > len(strings.Fields(p.Description)) {
			p.Description = t
		}
	}
	if len(p.Title) > 200 {
		p.Title = p.Title[:200]
	}
	if len(p.Company) > 120 {
		p.Company = p.Company[:120]
	}
	if len(p.Description) > 30000 {
		p.Description = p.Description[:30000]
	}
	if p.Title == "" && p.Description == "" {
		return p, errChanged(final.Hostname())
	}
	return p, nil
}
