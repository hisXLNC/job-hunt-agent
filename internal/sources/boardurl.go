package sources

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	slugRE          = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)
	workdayHostRE   = regexp.MustCompile(`^([a-z0-9][a-z0-9-]*)\.(wd[0-9]+)\.myworkdayjobs\.com$`)
	workdayLocaleRE = regexp.MustCompile(`^[a-z]{2}-[A-Z]{2}$`) // "en-US", "fr-CA"
)

// ParseBoardURL recognises a careers page, posting page or API address of
// any supported system and returns the board it belongs to. The scheme may
// be missing ("jobs.lever.co/acme").
func ParseBoardURL(raw string) (Board, bool) {
	raw = strings.TrimSpace(raw)
	switch {
	case raw == "":
		return Board{}, false
	case strings.HasPrefix(raw, "//"):
		raw = "https:" + raw
	case !strings.Contains(raw, "://"):
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return Board{}, false
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	var segs []string
	for s := range strings.SplitSeq(u.Path, "/") {
		if s != "" {
			segs = append(segs, s)
		}
	}
	first := ""
	if len(segs) > 0 {
		first = segs[0]
	}

	switch host {
	case "boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io":
		if first == "embed" { // /embed/job_board?for=acme, /embed/job_app?for=acme&token=123
			return slugBoard(kindGreenhouse, u.Query().Get("for"), true)
		}
		return slugBoard(kindGreenhouse, first, true)
	case "boards-api.greenhouse.io", "api.greenhouse.io":
		return slugBoard(kindGreenhouse, segmentAfter(segs, "boards"), true)

	case "jobs.lever.co", "jobs.eu.lever.co":
		return slugBoard(kindLever, first, true)
	case "api.lever.co", "api.eu.lever.co":
		return slugBoard(kindLever, segmentAfter(segs, "postings"), true)

	case "jobs.ashbyhq.com":
		return slugBoard(kindAshby, first, false)
	case "api.ashbyhq.com":
		return slugBoard(kindAshby, segmentAfter(segs, "job-board"), false)

	case "jobs.smartrecruiters.com", "careers.smartrecruiters.com":
		if first == "oneclick-ui" { // /oneclick-ui/company/Acme/publication/...
			return slugBoard(kindSmartRecruiters, segmentAfter(segs, "company"), false)
		}
		return slugBoard(kindSmartRecruiters, first, false)
	case "api.smartrecruiters.com":
		return slugBoard(kindSmartRecruiters, segmentAfter(segs, "companies"), false)
	}

	if m := workdayHostRE.FindStringSubmatch(host); m != nil {
		site := first
		switch {
		case first == "wday": // /wday/cxs/{tenant}/{site}/...
			site = ""
			if len(segs) >= 4 && segs[1] == "cxs" {
				site = segs[3]
			}
		case workdayLocaleRE.MatchString(first): // /en-US/{site}/...
			site = ""
			if len(segs) >= 2 {
				site = segs[1]
			}
		}
		if !slugRE.MatchString(site) {
			return Board{}, false
		}
		return Board{Kind: kindWorkday, Token: m[1] + "." + m[2] + "/" + site}, true
	}
	return Board{}, false
}

// slugBoard accepts a company slug when it looks like one. Greenhouse and
// Lever slugs are lower case; the other systems keep theirs as written.
func slugBoard(kind, slug string, lower bool) (Board, bool) {
	if !slugRE.MatchString(slug) {
		return Board{}, false
	}
	if lower {
		slug = strings.ToLower(slug)
	}
	return Board{Kind: kind, Token: slug}, true
}

// segmentAfter returns the path segment that follows marker, or "".
func segmentAfter(segs []string, marker string) string {
	for i, s := range segs[:max(len(segs)-1, 0)] {
		if s == marker {
			return segs[i+1]
		}
	}
	return ""
}

// BoardURL is the human careers page for a board, or "" for a board this
// package cannot place.
func BoardURL(b Board) string {
	token := url.PathEscape(b.Token)
	if strings.TrimSpace(b.Token) == "" {
		return ""
	}
	switch b.Kind {
	case kindGreenhouse:
		return "https://boards.greenhouse.io/" + token
	case kindLever:
		return "https://jobs.lever.co/" + token
	case kindAshby:
		return "https://jobs.ashbyhq.com/" + token
	case kindSmartRecruiters:
		return "https://careers.smartrecruiters.com/" + token
	case kindWorkday:
		if w, err := parseWorkdayToken(b.Token); err == nil {
			return w.host() + "/" + w.site
		}
	}
	return ""
}
