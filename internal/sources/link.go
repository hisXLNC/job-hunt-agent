package sources

import (
	"context"
	"fmt"
	"strings"
)

// ReadLink reads one posting from its own page, for a link the person
// shared (from their phone, say). Only pages on the public internet are
// opened. The title and employer come from the page's own description of
// the posting when it has one, else from what the page calls itself.
func (c *Client) ReadLink(ctx context.Context, raw string) (Posting, error) {
	u, ok := publicURL(strings.TrimSpace(raw))
	if !ok {
		return Posting{}, fmt.Errorf("sources: %q is not a public web address", raw)
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
		if got.Title == "" || len(got.Description) < len(p.Description) {
			continue
		}
		p.Title, p.Company, p.Location, p.Pay, p.Workplace, p.PostedAt, p.Description = got.Title, got.Company, got.Location, got.Pay, got.Workplace, got.PostedAt, got.Description
	}
	if len(strings.Fields(p.Description)) < 40 {
		if t := mainText(body); len(strings.Fields(t)) > len(strings.Fields(p.Description)) {
			p.Description = t
		}
	}
	d := parseHTML(body)
	meta := func(key string) string {
		i := d.find(0, len(d.toks), func(t token) bool {
			return t.name == "meta" && (strings.EqualFold(t.attr("property"), key) || strings.EqualFold(t.attr("name"), key))
		})
		if i < 0 {
			return ""
		}
		return d.toks[i].attr("content")
	}
	if p.Title == "" {
		t := firstNonEmpty(meta("og:title"), d.textOf(0, len(d.toks), func(t token) bool { return t.name == "h1" }), d.textOf(0, len(d.toks), func(t token) bool { return t.name == "title" }))
		if i := strings.Index(t, " | "); i > 0 {
			t = t[:i]
		}
		p.Title = plainLine(t)
	}
	if p.Company == "" {
		p.Company = plainLine(meta("og:site_name"))
	}
	if p.Company == "" {
		name := strings.Split(siteName(final.Hostname()), ".")[0]
		if name != "" {
			p.Company = strings.ToUpper(name[:1]) + name[1:]
		}
	}
	if p.Title == "" || len(strings.Fields(p.Description)) < 20 {
		return Posting{}, errChanged(final.Hostname())
	}
	if len(p.Description) > 30000 {
		p.Description = p.Description[:30000]
	}
	if p.Workplace == "" {
		p.Workplace = workplaceOf(p.Location + " " + p.Title)
	}
	return p, nil
}
