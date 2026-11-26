package sources

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// Finding an employer's website from its name, for its logo. Clearbit's
// free company suggestions name a company's domain; a suggestion is taken
// only when its name is the employer's own (legal endings and a trailing
// country left out on both sides), so "Everforth Advisory" is never given
// the logo of another Everforth. Only the employer's name is sent.

const suggestHost = "https://autocomplete.clearbit.com"

var (
	suffixWords  = map[string]bool{"inc": true, "incorporated": true, "ltd": true, "limited": true, "llc": true, "llp": true, "lp": true, "corp": true, "corporation": true, "co": true, "company": true, "plc": true, "ulc": true, "gmbh": true, "sa": true, "ag": true, "the": true, "international": true, "group": true}
	countryWords = map[string]bool{"canada": true, "usa": true, "us": true, "uk": true, "america": true, "north": true, "ca": true}
	// Domains that name a company's own site; a foreign country's domain or a
	// jobs-only one is more often someone else's.
	ownEndings = []string{".com", ".ca", ".org", ".net", ".io", ".co", ".ai", ".us", ".app", ".tech", ".dev", ".bank", ".gc.ca", ".gov"}
)

// nameKey is a company name reduced for matching: lower case, letters and
// digits, legal endings left out.
func nameKey(name string) []string {
	f := strings.FieldsFunc(strings.ToLower(strings.ReplaceAll(name, "&", " and ")), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	var out []string
	for _, w := range f {
		if !suffixWords[w] {
			out = append(out, w)
		}
	}
	return out
}

// nameForms are the ways to ask for a name: as it is, then without a
// trailing country ("PwC Canada" is PwC).
func nameForms(name string) []string {
	k := nameKey(name)
	if len(k) == 0 {
		return nil
	}
	forms := []string{strings.Join(k, " ")}
	for len(k) > 1 && countryWords[k[len(k)-1]] {
		k = k[:len(k)-1]
		forms = append(forms, strings.Join(k, " "))
	}
	return forms
}

func ownEnding(domain string) bool {
	for _, e := range ownEndings {
		if strings.HasSuffix(domain, e) {
			return true
		}
	}
	return false
}

// FindDomain names an employer's own domain, or "" when none is surely it.
// Among the suggestions named exactly like the employer, one whose domain
// spells the name ("aircanada.com") is surest, then one that starts with it
// ("rbcroyalbank.com"); otherwise the first for the full name. A name
// without its country is only taken in the first two ways, so "Deloitte
// Canada" is deloitte.com, not a training site called Deloitte Canada.
func (c *Client) FindDomain(ctx context.Context, name string) (string, error) {
	ctx = withVia(ctx, KindLogos)
	var lastErr error
	weak, starts := "", ""
	for i, form := range nameForms(name) {
		var got []struct {
			Name   string `json:"name"`
			Domain string `json:"domain"`
		}
		err := c.getJSON(ctx, c.base("suggest", suggestHost)+"/v1/companies/suggest?query="+url.QueryEscape(form), &got)
		if err != nil {
			lastErr = err
			continue
		}
		spelled := strings.ReplaceAll(form, " ", "")
		for _, g := range got {
			d := OwnSite(strings.ToLower(strings.TrimSpace(g.Domain)))
			if d == "" || !ownEnding(d) || strings.Join(nameKey(g.Name), " ") != form {
				continue
			}
			label, _, _ := strings.Cut(d, ".")
			switch {
			case label == spelled:
				return d, nil
			case strings.HasPrefix(label, spelled) && starts == "":
				starts = d
			case i == 0 && weak == "" && Plausible(name, d):
				weak = d
			}
		}
	}
	if d := firstNonEmpty(starts, weak); d != "" {
		return d, nil
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", errors.New("sources: no website found for the name")
}

// IconOf fetches the icon of a domain known to be the employer's: from the
// site itself, else Google's icon service, which keeps a copy of most
// sites' icons and answers when the site turns plain requests away.
func (c *Client) IconOf(ctx context.Context, domain string) ([]byte, string, error) {
	// Each place gets a few seconds of its own, so a site that hangs doesn't
	// use up the time of the ones after it.
	step := func(f func(ctx context.Context) ([]byte, string, error)) ([]byte, string, error) {
		sctx, cancel := context.WithTimeout(ctx, 6*time.Second)
		defer cancel()
		return f(sctx)
	}
	b, kind, err := step(func(ctx context.Context) ([]byte, string, error) { return c.Logo(ctx, domain, "") })
	if err == nil {
		return b, kind, nil
	}
	if b, kind, err = step(func(ctx context.Context) ([]byte, string, error) {
		return c.LogoFrom(ctx, "https://www.google.com/s2/favicons?sz=128&domain="+url.QueryEscape(domain))
	}); err == nil {
		return b, kind, nil
	}
	return step(func(ctx context.Context) ([]byte, string, error) {
		return c.LogoFrom(ctx, "https://icons.duckduckgo.com/ip3/"+url.PathEscape(domain)+".ico")
	})
}

// KindLogos marks the requests made for employers' logos (their websites,
// icons, the company lookup), which a VPN can carry like a job source's.
const KindLogos = "logos"

// Plausible says whether a domain could be the named employer's: its name
// spelled out, its initials, or one of its longer words is in it. It guards
// a website named by Claude, which can be wrong.
func Plausible(name, domain string) bool {
	d := OwnSite(strings.ToLower(strings.TrimSpace(domain)))
	if d == "" || !ownEnding(d) {
		return false
	}
	label, _, _ := strings.Cut(d, ".")
	words := nameKey(name)
	if len(words) == 0 {
		return false
	}
	initials := ""
	for _, w := range words {
		initials += w[:1]
		if len(w) >= 3 && strings.Contains(label, w) {
			return true
		}
	}
	spelled := strings.Join(words, "")
	return label == initials || strings.HasPrefix(spelled, label) && len(label) >= 2 || strings.HasPrefix(label, spelled)
}
