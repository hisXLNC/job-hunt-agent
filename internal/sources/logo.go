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
	"jobbank.gc.ca", "ziprecruiter.", "monster.", "workopolis.", "eluta.", "talent.com", "jooble.", "adzuna.", "google.", "bit.ly", "lnkd.in"}

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
		if strings.Contains(host, h) {
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
func (c *Client) Logo(ctx context.Context, host string) ([]byte, string, error) {
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
	if page, final, err := c.fetch(ctx, "GET", base.String(), "text/html", nil); err == nil {
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
