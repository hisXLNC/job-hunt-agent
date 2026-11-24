package sources

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Detect makes at most 12 requests: up to 4 pages of the employer's site,
// then up to 2 slug guesses against the 4 systems whose addresses can be
// guessed.
const maxSlugGuesses = 2

// careersPaths are tried, in order, under the employer's site.
var careersPaths = []string{"", "/careers", "/jobs", "/about/careers"}

// boardLinkRE finds addresses on the supported systems anywhere in a page:
// links, iframes, embed scripts and inline configuration alike.
var boardLinkRE = regexp.MustCompile(`(?i)(?:https?:)?//[a-z0-9.-]*(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com)[^\s"'<>\\)]*`)

// unescapeJS undoes the slash escapes of URLs embedded in scripts and JSON.
var unescapeJS = strings.NewReplacer(`\/`, "/", `/`, "/", `/`, "/")

// corporateWords are dropped from the end of an employer's name before
// guessing its slug.
var corporateWords = map[string]bool{
	"inc": true, "incorporated": true, "ltd": true, "limited": true, "llp": true, "llc": true, "lp": true,
	"corp": true, "corporation": true, "co": true, "company": true, "group": true, "holdings": true,
	"plc": true, "gmbh": true, "canada": true,
}

// foldAccents maps the accented letters common in employer names to ASCII.
var foldAccents = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ä", "a", "ã", "a", "å", "a", "ç", "c",
	"è", "e", "é", "e", "ê", "e", "ë", "e", "ì", "i", "í", "i", "î", "i", "ï", "i",
	"ñ", "n", "ò", "o", "ó", "o", "ô", "o", "ö", "o", "õ", "o", "ø", "o",
	"ù", "u", "ú", "u", "û", "u", "ü", "u", "ý", "y", "ÿ", "y", "ß", "ss", "æ", "ae", "œ", "oe",
)

// Detect works out which system an employer uses.
//
// With a site, its likely careers pages are read first and searched for a
// link to a supported board; this is the only way a Workday board is found,
// because its address cannot be guessed. Failing that, slugs guessed from
// the name are tried against Greenhouse, Lever, Ashby and SmartRecruiters,
// and one counts only when it answers with at least one open posting.
//
// ErrNoBoard means every lookup finished and found nothing. When the
// guessing was cut short by the network or by throttling, the error says so
// instead, so "we could not tell" is never mistaken for "there is none".
func (c *Client) Detect(ctx context.Context, name, site string) (Board, error) {
	if b, ok := ParseBoardURL(site); ok {
		return b, nil // the "site" already is a board
	}
	if root := siteRoot(site); root != "" {
		for _, path := range careersPaths {
			body, final, err := c.getHTML(ctx, root+path)
			if ctx.Err() != nil {
				return Board{}, ctx.Err()
			}
			if err != nil {
				continue // a missing or guarded page is not an answer
			}
			if b, ok := ParseBoardURL(final.String()); ok {
				return b, nil // the careers address redirects to the board
			}
			if b, ok := findBoardLink(body); ok {
				return b, nil
			}
		}
	}

	var inconclusive error
	for _, slug := range slugGuesses(name, site) {
		for _, kind := range []string{kindGreenhouse, kindLever, kindAshby, kindSmartRecruiters} {
			found, err := c.hasPostings(ctx, Board{Kind: kind, Token: slug})
			if ctx.Err() != nil {
				return Board{}, ctx.Err()
			}
			if found {
				return Board{Kind: kind, Token: slug}, nil
			}
			if err != nil && inconclusive == nil && !isAnswer(err) {
				inconclusive = err
			}
		}
	}
	if inconclusive != nil {
		return Board{}, fmt.Errorf("sources: could not finish looking for a job board: %w", inconclusive)
	}
	return Board{}, ErrNoBoard
}

// hasPostings asks a system, as cheaply as it allows, whether a board
// exists and has at least one open posting.
func (c *Client) hasPostings(ctx context.Context, b Board) (bool, error) {
	switch b.Kind {
	case kindGreenhouse:
		var res greenhouseJobs
		err := c.getJSON(ctx, c.greenhouseJobsURL(b.Token), &res) // without the descriptions
		return len(res.Jobs) > 0, err
	case kindLever:
		var res []leverPosting
		err := c.getJSON(ctx, c.leverPostingsURL(b.Token)+"&limit=1", &res)
		return len(res) > 0, err
	case kindAshby:
		var res ashbyBoard
		err := c.getJSON(ctx, c.ashbyBoardURL(b.Token), &res)
		for _, j := range res.Jobs {
			if j.listed() {
				return true, err
			}
		}
		return false, err
	case kindSmartRecruiters:
		// SmartRecruiters answers 200 with nothing for any name at all.
		var res smartRecruitersPage
		err := c.getJSON(ctx, c.smartRecruitersURL(b.Token)+"?limit=1", &res)
		return res.TotalFound > 0 || len(res.Content) > 0, err
	}
	return false, nil
}

// isAnswer reports whether a failed probe still tells us the board is not
// there (a 404, or any other refusal that is not throttling), as opposed to
// leaving the question open (no network, a timeout, 429).
func isAnswer(err error) bool {
	var he *HTTPError
	if errors.As(err, &he) {
		return he.Status != http.StatusTooManyRequests
	}
	var ne net.Error
	var ue *url.Error
	return !errors.As(err, &ne) && !errors.As(err, &ue) // e.g. a 200 that is not JSON
}

// siteRoot normalises an employer's site to "scheme://host[/path]" with no
// trailing slash, or "" when it is not a web address.
func siteRoot(site string) string {
	site = strings.TrimSpace(site)
	if site == "" {
		return ""
	}
	if !strings.Contains(site, "://") {
		site = "https://" + site
	}
	u, err := url.Parse(site)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	u.RawQuery, u.Fragment = "", ""
	return strings.TrimRight(u.String(), "/")
}

// findBoardLink returns the first address in a page that belongs to a
// supported board.
func findBoardLink(body string) (Board, bool) {
	body = html.UnescapeString(unescapeJS.Replace(body))
	for _, link := range boardLinkRE.FindAllString(body, -1) {
		if b, ok := ParseBoardURL(strings.TrimRight(link, ".,;")); ok {
			return b, true
		}
	}
	return Board{}, false
}

// slugGuesses turns an employer's name into the slugs it most likely uses:
// "Thomson Reuters Canada Ltd." gives "thomsonreuters" and
// "thomson-reuters". When that leaves room, the name in the site's domain
// is a guess too.
func slugGuesses(name, site string) []string {
	var guesses []string
	add := func(s string) {
		if len(guesses) >= maxSlugGuesses || !slugRE.MatchString(s) {
			return
		}
		for _, g := range guesses {
			if g == s {
				return
			}
		}
		guesses = append(guesses, s)
	}

	words := nameWords(name)
	add(strings.Join(words, ""))
	add(strings.Join(words, "-"))
	add(domainName(site))
	return guesses
}

// nameWords lower-cases a name, drops punctuation, a leading "the" and
// trailing corporate words, and returns what is left.
func nameWords(name string) []string {
	name = foldAccents.Replace(strings.ToLower(name))
	name = strings.NewReplacer("'", "", "’", "", ".", "").Replace(name)
	words := strings.FieldsFunc(name, func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	})
	if len(words) > 1 && words[0] == "the" {
		words = words[1:]
	}
	for len(words) > 1 && corporateWords[words[len(words)-1]] {
		words = words[:len(words)-1]
	}
	return words
}

// domainName returns the employer's own label of a site's host:
// "wealthsimple" for "https://www.wealthsimple.com/en-ca".
func domainName(site string) string {
	root := siteRoot(site)
	if root == "" {
		return ""
	}
	u, err := url.Parse(root)
	if err != nil || net.ParseIP(u.Hostname()) != nil {
		return ""
	}
	labels := strings.Split(strings.ToLower(u.Hostname()), ".")
	if len(labels) < 2 {
		return ""
	}
	labels = labels[:len(labels)-1] // the top-level domain
	if n := len(labels); n > 1 {
		switch labels[n-1] {
		case "co", "com", "org", "net", "gov", "ac": // "example.co.uk"
			labels = labels[:n-1]
		}
	}
	return labels[len(labels)-1]
}
