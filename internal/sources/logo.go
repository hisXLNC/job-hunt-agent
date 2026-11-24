package sources

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// An employer's picture is its own icon, taken from its own website the way
// a browser takes the icon for a tab. No outside service is asked.

// Sites that host many employers' postings: their icon is theirs, not the employer's.
var hostsOfMany = []string{"myworkdayjobs.com", "myworkdaysite.com", "icims.com", "taleo.net", "greenhouse.io", "lever.co", "ashbyhq.com",
	"smartrecruiters.com", "workable.com", "bamboohr.com", "successfactors.", "oraclecloud.com", "ultipro.com", "adp.com", "jobvite.com", "breezy.hr",
	"recruitee.com", "teamtailor.com", "applytojob.com", "paylocity.com", "dayforcehcm.com", "csod.com", "eightfold.ai", "avature.net", "phenompeople.com",
	"jazz.co", "jazzhr.com", "njoyn.com", "hrmdirect.com", "pinpointhq.com", "rippling.com", "gusto.com", "freehire.", "linkedin.com", "indeed.", "glassdoor.",
	"jobbank.gc.ca", "t.me", "telegram.", "wa.me", "facebook.com", "twitter.com", "x.com", "instagram.com", "reddit.com", "workday.com", "builtin.com", "wellfound.com", "dice.com", "simplyhired.", "careerjet.", "jobillico.", "careerbeacon.", "hiring.cafe", "jobright.", "otta.com", "welcometothejungle.", "remoteok.", "weworkremotely.", "ziprecruiter.", "monster.", "workopolis.", "eluta.", "talent.com", "jooble.", "adzuna.", "google.", "bit.ly", "lnkd.in"}

// OwnSite is the employer's own site a link is on, without the part that
// names its careers pages ("careers.bmo.com" is bmo.com); "" for a job board
// or a site that hosts many employers.
func OwnSite(link string) string {
	if !strings.Contains(link, "://") {
		link = "https://" + strings.TrimSpace(link)
	}
	u, err := url.Parse(link)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || !strings.Contains(host, ".") {
		return ""
	}
	for _, h := range hostsOfMany {
		if strings.HasSuffix(h, ".") && strings.Contains(host, h) || host == h || strings.HasSuffix(host, "."+h) {
			return ""
		}
	}
	for _, p := range []string{"www.", "careers.", "career.", "jobs.", "job.", "apply.", "recruiting.", "talent.", "join.", "work.", "emplois.", "carrieres.", "www."} {
		if rest, ok := strings.CutPrefix(host, p); ok && strings.Contains(rest, ".") {
			host = rest
		}
	}
	return host
}

var (
	linkTagRe = regexp.MustCompile(`(?is)<link\b[^>]*>`)
	attrRe    = regexp.MustCompile(`(?is)\b(rel|href|sizes|type)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`)
)

// Logo fetches the icon of the site at host: the picture and its kind
// ("image/png" and the like). Only ordinary pictures are accepted.
//
// When mustName is given the site is only a guess: its home page has to load
// and name the employer in its title before its icon is taken.
func (c *Client) Logo(ctx context.Context, host, mustName string) ([]byte, string, error) {
	base, err := url.Parse("https://" + host + "/")
	if err != nil || OwnSite(host) == "" {
		return nil, "", errors.New("sources: not an employer's own site")
	}
	if b := c.Base["logo"]; b != "" { // tests point this at their own server
		if u, err := url.Parse(b + "/"); err == nil {
			base = u
		}
	}
	var tries []string
	page, final, err := c.fetch(ctx, "GET", base.String(), "text/html", nil)
	if mustName != "" && (err != nil || !pageNames(page, mustName) || final != nil && OwnSite(final.String()) == "") {
		return nil, "", errors.New("sources: not the employer's site")
	}
	if err == nil {
		if final != nil {
			base = final
		}
		type cand struct {
			href  string
			score int
		}
		var best []cand
		head := string(page)
		if len(head) > 200000 {
			head = head[:200000]
		}
		for _, tag := range linkTagRe.FindAllString(head, 60) {
			at := map[string]string{}
			for _, m := range attrRe.FindAllStringSubmatch(tag, -1) {
				at[strings.ToLower(m[1])] = m[3] + m[4] + m[5]
			}
			rel := strings.ToLower(at["rel"])
			if at["href"] == "" || !strings.Contains(rel, "icon") || strings.Contains(strings.ToLower(at["href"]), ".svg") || strings.Contains(at["type"], "svg") {
				continue
			}
			score := 1
			if strings.Contains(rel, "apple-touch") {
				score = 5
			}
			switch {
			case strings.Contains(at["sizes"], "180"), strings.Contains(at["sizes"], "192"), strings.Contains(at["sizes"], "152"):
				score += 4
			case strings.Contains(at["sizes"], "96"), strings.Contains(at["sizes"], "120"), strings.Contains(at["sizes"], "64"):
				score += 3
			case strings.Contains(at["sizes"], "32"), strings.Contains(at["sizes"], "48"):
				score += 2
			}
			best = append(best, cand{at["href"], score})
		}
		for len(best) > 0 && len(tries) < 3 {
			top := 0
			for i := range best {
				if best[i].score > best[top].score {
					top = i
				}
			}
			if u, err := base.Parse(best[top].href); err == nil && (u.Scheme == "https" || u.Scheme == "http") {
				tries = append(tries, u.String())
			}
			best = append(best[:top], best[top+1:]...)
		}
	}
	for _, p := range []string{"/apple-touch-icon.png", "/favicon.ico"} {
		if u, err := base.Parse(p); err == nil {
			tries = append(tries, u.String())
		}
	}
	for _, t := range tries {
		b, _, err := c.fetch(ctx, "GET", t, "image/*", nil)
		if err != nil || len(b) < 70 || len(b) > 400<<10 {
			continue
		}
		kind := http.DetectContentType(b)
		switch kind {
		case "image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/bmp":
			return b, kind, nil
		}
	}
	return nil, "", errors.New("sources: the site has no icon that could be used")
}

// ---- whose site it is ----------------------------------------------------------------

var (
	nameCutRe   = regexp.MustCompile(`\s*(,|\(|\||/| - | – | — ).*$`)
	nameParenRe = regexp.MustCompile(`\(([A-Za-z0-9&]{2,8})\)`)
	legalWords  = map[string]bool{"inc": true, "ltd": true, "llc": true, "llp": true, "corp": true, "corporation": true, "limited": true, "co": true, "company": true, "plc": true, "the": true, "group": true, "holdings": true, "ulc": true, "lp": true}
)

// employerWords are the words of an employer's name, lower case, without "Inc."
// and the like, cut before a comma or bracket ("Legrand, North America" is
// "legrand").
func employerWords(name string) []string {
	name = nameCutRe.ReplaceAllString(strings.TrimSpace(name), "")
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(name), func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '&') }) {
		w = strings.ReplaceAll(w, "&", "")
		if w != "" && !legalWords[w] {
			out = append(out, w)
		}
	}
	return out
}

func letters(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// siteLabel is the part of a host that names its owner: "bmo" in "bmo.com",
// "scotiabank" in "jobs.scotiabank.com", "rbc" in "rbc.co.uk".
func siteLabel(host string) string {
	parts := strings.Split(strings.ToLower(host), ".")
	if len(parts) < 2 {
		return ""
	}
	i := len(parts) - 2
	if i > 0 && len(parts[len(parts)-1]) == 2 && (parts[i] == "co" || parts[i] == "com" || parts[i] == "org" || parts[i] == "gc" || parts[i] == "on") {
		i--
	}
	return parts[i]
}

// Belongs tells whether host looks like the named employer's own site:
// "cibc.com" for "Canadian Imperial Bank of Commerce (CIBC)", "rogers.com"
// for "Rogers Communications", not "t.me" for "EMCD".
func Belongs(host, name string) bool {
	label := letters(siteLabel(host))
	if len(label) < 2 {
		return false
	}
	words := employerWords(name)
	if len(words) == 0 {
		return false
	}
	all := strings.Join(words, "")
	if label == all || label == words[0] || (len(label) >= 4 && strings.HasPrefix(all, label)) {
		return true
	}
	init := ""
	for _, w := range words {
		if w != "of" && w != "and" && w != "for" {
			init += w[:1]
		}
	}
	if len(init) >= 2 && (label == init || strings.HasPrefix(label, init) && len(label) <= len(init)+3) {
		return true
	}
	if m := nameParenRe.FindStringSubmatch(name); m != nil && label == letters(m[1]) {
		return true
	}
	return len(words) == 1 && len(label) >= 2 && len(label) <= 4 && label == all
}

// Guesses are the addresses an employer's own site most likely has, from
// its name alone: "facilityos.com", "cibc.com". The caller checks the page
// before trusting one.
func Guesses(name string) []string {
	var heads []string
	if m := nameParenRe.FindStringSubmatch(name); m != nil {
		heads = append(heads, letters(m[1]))
	}
	if words := employerWords(name); len(words) > 0 && len(words) <= 3 {
		heads = append(heads, strings.Join(words, ""))
	}
	var out []string
	seen := map[string]bool{}
	for _, h := range heads {
		if len(h) < 3 || seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h+".com", h+".ca")
	}
	return out
}

var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>|<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)`)

// pageNames tells whether the page names the employer in its title.
func pageNames(page []byte, name string) bool {
	head := page
	if len(head) > 200000 {
		head = head[:200000]
	}
	words := employerWords(name)
	want := strings.Join(words, "")
	var paren string
	if m := nameParenRe.FindStringSubmatch(name); m != nil {
		paren = letters(m[1])
	}
	for _, m := range titleRe.FindAllSubmatch(head, 4) {
		t := letters(string(m[1]) + " " + string(m[2]))
		if want != "" && strings.Contains(t, want) || paren != "" && strings.Contains(t, paren) {
			return true
		}
	}
	return false
}
