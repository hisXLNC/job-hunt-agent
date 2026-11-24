package sources

import (
	"crypto/sha1"
	"encoding/hex"
	"html"
	"net/url"
	"regexp"
	"strings"
)

// Job-alert e-mails. The big job sites send their members a list of new
// postings by mail; when the person lets Job Hunt read the inbox, those
// lists are one more place postings come from.
//
// An alert is untrusted text that anyone could have sent. Nothing in it is
// followed, opened or obeyed: the only things taken from it are links that
// lead to the job site the alert says it is from, and the few words printed
// beside each link (title, employer, place, pay). Where a link is wrapped in
// a tracking address that carries the real one in its query, the real one is
// taken out of it; a link that hides where it leads is left alone.

// alertPrefix starts the Source of a posting read from an alert e-mail:
// "alert:linkedin", "alert:indeed" and so on.
const alertPrefix = "alert:"

// maxAlertPostings is the most postings taken from one e-mail.
const maxAlertPostings = 40

type alertSite struct {
	id      string
	name    string
	domains []string // who it is sent from, and where its links may lead
	// sender narrows down which of the site's mail is an alert, for sites
	// that also write about applications. nil = all of it.
	sender func(local, domain string) bool
	// link returns a posting's id on the site and its plain address, or ""
	// for a link that is not a posting.
	link func(u *url.URL) (id, addr string)
}

var (
	indeedJobRE     = regexp.MustCompile(`^[0-9a-fA-F]{12,20}$`)
	jobBankPostRE   = regexp.MustCompile(`/jobposting/(\d{5,12})(?:[/;?#]|$)`)
	workopolisRE    = regexp.MustCompile(`/jobsearch/viewjob/([A-Za-z0-9_-]{6,40})`)
	elutaRE         = regexp.MustCompile(`^/(spl|direct|job|jobs)/[^/].*`)
	zipRE           = regexp.MustCompile(`^/(c/[^/]+/job|jobs?|k|km|ekm)/[^/].*`)
	glassdoorPathRE = regexp.MustCompile(`(?i)job-?listing`)
)

var alertSites = []alertSite{
	{id: kindLinkedIn, name: "LinkedIn", domains: []string{"linkedin.com"},
		sender: func(local, _ string) bool {
			return strings.HasPrefix(local, "jobalerts") || strings.HasPrefix(local, "jobs-")
		},
		link: func(u *url.URL) (string, string) {
			id := linkedInJobID(u.Path)
			if id == "" && strings.Contains(u.Path, "/jobs/") {
				id = u.Query().Get("currentJobId")
			}
			if !isDigits(id) {
				return "", ""
			}
			return id, linkedInHost + "/jobs/view/" + id
		}},
	{id: "indeed", name: "Indeed", domains: []string{"indeed.com"},
		sender: func(local, domain string) bool {
			return strings.Contains(local, "alert") || strings.HasPrefix(domain, "jobalert.") || strings.HasPrefix(domain, "match.")
		},
		link: func(u *url.URL) (string, string) {
			jk := u.Query().Get("jk")
			if !indeedJobRE.MatchString(jk) {
				return "", ""
			}
			// "ca.indeed.com" keeps its country; anything else is the main site.
			host := "www"
			if label, _, _ := strings.Cut(strings.ToLower(u.Hostname()), "."); len(label) == 2 {
				host = label
			}
			return strings.ToLower(jk), "https://" + host + ".indeed.com/viewjob?jk=" + strings.ToLower(jk)
		}},
	{id: "glassdoor", name: "Glassdoor", domains: []string{"glassdoor.com", "glassdoor.ca", "glassdoor.co.uk"},
		link: func(u *url.URL) (string, string) {
			q := u.Query()
			id := firstNonEmpty(q.Get("jobListingId"), q.Get("jl"))
			if !isDigits(id) || !glassdoorPathRE.MatchString(u.Path) {
				return "", ""
			}
			return id, "https://www." + ownDomain(u.Hostname(), "glassdoor.com", "glassdoor.ca", "glassdoor.co.uk") + "/job-listing/?jl=" + id
		}},
	{id: kindJobBank, name: "Job Bank", domains: []string{"jobbank.gc.ca", "guichetemplois.gc.ca"},
		link: func(u *url.URL) (string, string) {
			m := jobBankPostRE.FindStringSubmatch(u.Path)
			if m == nil {
				return "", ""
			}
			return m[1], jobBankHost + "/jobsearch/jobposting/" + m[1]
		}},
	{id: "eluta", name: "Eluta", domains: []string{"eluta.ca"},
		link: func(u *url.URL) (string, string) {
			if !elutaRE.MatchString(u.Path) {
				return "", ""
			}
			addr := "https://www.eluta.ca" + u.EscapedPath()
			if strings.HasPrefix(u.Path, "/direct/") && u.RawQuery != "" {
				addr += "?" + u.RawQuery // these name the posting in the query
			}
			return shortHash(addr), addr
		}},
	{id: "workopolis", name: "Workopolis", domains: []string{"workopolis.com"},
		link: func(u *url.URL) (string, string) {
			id := ""
			if m := workopolisRE.FindStringSubmatch(u.Path); m != nil {
				id = m[1]
			} else if jk := u.Query().Get("jk"); indeedJobRE.MatchString(jk) {
				id = jk
			}
			if id == "" {
				return "", ""
			}
			return id, "https://www.workopolis.com/jobsearch/viewjob/" + id
		}},
	{id: "ziprecruiter", name: "ZipRecruiter", domains: []string{"ziprecruiter.com", "ziprecruiter.ca", "ziprecruiter.co.uk"},
		link: func(u *url.URL) (string, string) {
			if !zipRE.MatchString(strings.ToLower(u.Path)) {
				return "", ""
			}
			addr := "https://" + strings.ToLower(u.Hostname()) + u.EscapedPath()
			if jid := u.Query().Get("jid"); jid != "" {
				return jid, addr + "?jid=" + url.QueryEscape(jid)
			}
			return shortHash(addr), addr
		}},
}

// notAlertRE matches subjects of mail a job site sends about an application
// or an account: those are for the person, not lists of postings.
var notAlertRE = regexp.MustCompile(`(?i)\b(your application|you applied|application (?:was|has been|submitted|received|sent|viewed|update)|applied to|interview|message from|messaged you|sent you a|accepted your|viewed your|password|verify|verification|security|sign[- ]in|receipt|invoice|welcome to)\b`)

func alertSiteByID(id string) *alertSite {
	for i := range alertSites {
		if alertSites[i].id == id {
			return &alertSites[i]
		}
	}
	return nil
}

// AlertSite says which job site a message is a job alert from, going by who
// sent it and its subject: "linkedin", "indeed", "glassdoor", "jobbank",
// "eluta", "workopolis" or "ziprecruiter". It is "" for any other mail,
// including what those sites write about an application. Whether the message
// really lists postings is for ParseAlert to say.
func AlertSite(fromAddr, subject string) string {
	local, domain, ok := strings.Cut(strings.ToLower(strings.TrimSpace(fromAddr)), "@")
	if !ok || domain == "" || notAlertRE.MatchString(subject) {
		return ""
	}
	for _, s := range alertSites {
		if onDomain(domain, s.domains...) && (s.sender == nil || s.sender(local, domain)) {
			return s.id
		}
	}
	return ""
}

// AlertName is a job site's name as people write it.
func AlertName(site string) string {
	if s := alertSiteByID(site); s != nil {
		return s.name
	}
	return site
}

// onDomain reports whether a host is one of the domains or inside one.
func onDomain(host string, domains ...string) bool {
	return ownDomain(host, domains...) != ""
}

func ownDomain(host string, domains ...string) string {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	for _, d := range domains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return d
		}
	}
	return ""
}

func shortHash(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:8])
}

// jobLink works out whether an address from an alert leads to a posting on
// the alert's own site. The address may be wrapped: a tracking address with
// the real one in its query is opened up, a few layers deep. Nothing is
// fetched to find out.
func (s *alertSite) jobLink(raw string, depth int) (id, addr string) {
	raw = strings.TrimSpace(raw)
	if len(raw) > 4000 {
		return "", ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return "", ""
	}
	if onDomain(u.Hostname(), s.domains...) {
		if id, addr = s.link(u); id != "" {
			return id, addr
		}
	}
	if depth >= 3 {
		return "", ""
	}
	for _, vals := range u.Query() {
		for _, v := range vals {
			if !strings.HasPrefix(v, "http://") && !strings.HasPrefix(v, "https://") {
				// Some wrap it twice.
				if un, err := url.QueryUnescape(v); err != nil || un == v || !strings.HasPrefix(un, "http") {
					continue
				} else {
					v = un
				}
			}
			if id, addr = s.jobLink(v, depth+1); id != "" {
				return id, addr
			}
		}
	}
	return "", ""
}

// alertLine is one line of an alert's text, and the posting (by its place
// in the list found so far) whose link the line was printed inside, or -1.
type alertLine struct {
	text string
	job  int
}

// alertEnd, as a line's job, marks where a posting's words stop.
const alertEnd = -2

type alertJob struct {
	id, addr string
	linked   []string // the lines printed inside its link, in order
	after    []string // the lines that follow, up to the next posting's link
}

// ParseAlert reads the postings out of a job alert from the given site (see
// AlertSite). htmlBody and plainBody are the message's two forms; either may
// be empty. A message with no posting links gives nothing, which is how a
// message that only looked like an alert is told apart.
//
// Postings come back with Source "alert:<site>", their title, and employer,
// place and pay where the message printed them. They carry no description:
// use Detail.
func ParseAlert(site, htmlBody, plainBody string) []Posting {
	s := alertSiteByID(site)
	if s == nil {
		return nil
	}
	jobs := s.fromLines(alertHTMLLines(s, htmlBody))
	if len(jobs) == 0 {
		jobs = s.fromLines(alertPlainLines(s, plainBody))
	}
	return jobs
}

var blockTags = map[string]bool{"td": true, "th": true, "tr": true, "table": true, "p": true, "div": true, "br": true, "li": true, "ul": true, "ol": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "a": true, "hr": true, "section": true, "article": true, "center": true, "blockquote": true}

// alertHTMLLines lays an HTML message out as lines of text, remembering for
// each which posting's link it stood inside.
func alertHTMLLines(s *alertSite, body string) (lines []alertLine, jobs []*alertJob) {
	if strings.TrimSpace(body) == "" {
		return nil, nil
	}
	if len(body) > 600<<10 {
		body = body[:600<<10]
	}
	index := map[string]int{}
	var buf strings.Builder
	cur, bufJob := -1, -1
	flush := func() {
		if t := cleanAlertLine(html.UnescapeString(buf.String())); t != "" {
			lines = append(lines, alertLine{t, bufJob})
		}
		buf.Reset()
		bufJob = -1
	}
	for _, t := range tokenize(body) {
		switch t.kind {
		case tokText:
			if strings.TrimSpace(t.raw) != "" && bufJob < 0 {
				bufJob = cur
			}
			buf.WriteString(t.raw)
		case tokStart, tokEnd:
			if !blockTags[t.name] {
				continue
			}
			flush()
			if t.name != "a" {
				continue
			}
			cur = -1
			if t.kind == tokStart {
				if id, addr := s.jobLink(t.attr("href"), 0); id != "" {
					n, ok := index[id]
					if !ok && len(jobs) < maxAlertPostings {
						n, ok = len(jobs), true
						index[id] = n
						jobs = append(jobs, &alertJob{id: id, addr: addr})
					}
					if ok {
						cur = n
					}
				}
			}
		}
	}
	flush()
	return lines, jobs
}

var (
	plainURLRE   = regexp.MustCompile(`https?://[^\s<>"'\])]+`)
	plainRuleRE  = regexp.MustCompile(`^[-=_*~\s]{5,}$`)
	plainLabelRE = regexp.MustCompile(`(?i)^(view|see|open|apply)\b[^:]{0,20}:?\s*$`)
)

// alertPlainLines does the same for a plain-text message, where each
// posting's words come first and its link after them.
func alertPlainLines(s *alertSite, body string) (lines []alertLine, jobs []*alertJob) {
	if strings.TrimSpace(body) == "" {
		return nil, nil
	}
	if len(body) > 300<<10 {
		body = body[:300<<10]
	}
	index := map[string]int{}
	var block, prev []string
	for raw := range strings.SplitSeq(strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(body), "\n") {
		found := -1
		for _, link := range plainURLRE.FindAllString(raw, -1) {
			if id, addr := s.jobLink(strings.TrimRight(link, ".,;>"), 0); id != "" {
				n, ok := index[id]
				if !ok && len(jobs) < maxAlertPostings {
					n, ok = len(jobs), true
					index[id] = n
					jobs = append(jobs, &alertJob{id: id, addr: addr})
				}
				if ok {
					found = n
				}
				break
			}
		}
		text := cleanAlertLine(plainURLRE.ReplaceAllString(raw, ""))
		switch {
		case found >= 0:
			if text != "" && !plainLabelRE.MatchString(text) {
				block = append(block, text)
			}
			if len(block) == 0 {
				block = prev
			}
			if len(block) > 5 {
				block = block[len(block)-5:] // a heading ran into the first posting
			}
			for i, l := range block {
				// The first line is the title: it stands where a link's words
				// would in the HTML form. The rest follow it.
				job := -1
				if i == 0 {
					job = found
				}
				lines = append(lines, alertLine{l, job})
			}
			// Closes the posting, so that what follows is not taken for more of it.
			lines = append(lines, alertLine{"", alertEnd})
			block, prev = nil, nil
		case text == "" || plainRuleRE.MatchString(raw):
			if len(block) > 0 {
				prev, block = block, nil
			}
		default:
			block = append(block, text)
		}
	}
	return lines, jobs
}

// fromLines turns the lines around each posting's link into postings.
func (s *alertSite) fromLines(lines []alertLine, jobs []*alertJob) []Posting {
	if len(jobs) == 0 {
		return nil
	}
	active := -1
	for _, l := range lines {
		switch {
		case l.job == alertEnd:
			active = -1
		case l.job >= 0:
			active = l.job
			jobs[active].linked = append(jobs[active].linked, l.text)
		case active >= 0 && len(jobs[active].after) < 8:
			jobs[active].after = append(jobs[active].after, l.text)
		}
	}
	var out []Posting
	for _, j := range jobs {
		title, company, place, pay := alertFields(j.linked, j.after)
		if title == "" {
			continue
		}
		key := alertPrefix + s.id + ":" + j.id
		// The same posting found by the site's own search is the same posting.
		if s.id == kindLinkedIn || s.id == kindJobBank {
			key = s.id + ":" + j.id
		}
		p := Posting{Source: alertPrefix + s.id, Key: key, Company: company, Title: title, Location: place, URL: j.addr, Pay: pay, Applicants: -1, NeedsDetail: true}
		if s.id == kindJobBank {
			p.Location = jobBankPlace(p.Location)
		}
		p.Workplace = firstNonEmpty(workplaceOf(p.Location), workplaceOf(p.Title))
		out = append(out, p)
	}
	return out
}

var (
	alertNoise = map[string]bool{"new": true, "promoted": true, "sponsored": true, "easy apply": true, "easily apply": true, "quick apply": true, "actively recruiting": true,
		"actively hiring": true, "be an early applicant": true, "save job": true, "unsubscribe": true, "manage alerts": true, "manage job alerts": true, "edit alert": true, "help": true,
		"privacy": true, "just posted": true, "today": true, "yesterday": true, "urgently hiring": true, "hiring multiple candidates": true, "responsive employer": true, "see job": true,
		"view job": true, "view jobs": true, "apply on company site": true, "see more jobs": true, "see all": true, "view all": true, "top applicant": true, "hot": true, "featured": true,
		"verified": true, "direct apply": true, "apply with your profile": true}
	alertAgoRE     = regexp.MustCompile(`(?i)^(?:posted |active |reposted )?(?:\d+\+?|an?|a few) (?:second|minute|hour|day|week|month)s? ago$`)
	alertPeopleRE  = regexp.MustCompile(`(?i)^\d+\+? (?:school |company )?(?:alumni|alum|connections?|applicants?)\b`)
	alertRatingRE  = regexp.MustCompile(`\s*\b[1-5]\.\d\s*(?:★|stars?)?$`)
	alertPayRE     = regexp.MustCompile(`(?i)(?:[$£€]\s?\d|\b\d[\d,.]*\s?k\b.*\b(?:year|yr|hour|hr|annum)\b|\b\d[\d,]*(?:\.\d+)?\s?(?:an?|per|/)\s?(?:hour|hr|year|yr|annum)\b)`)
	alertRegionRE  = regexp.MustCompile(`\b[A-Z]{2}\b`)
	alertEdgesRE   = regexp.MustCompile(`^[\s|•·\-–—>*:]+|[\s|•·\-–—>:]+$`)
	alertDotSplit  = regexp.MustCompile(`\s+[·•|]\s+`)
	alertDashSplit = regexp.MustCompile(`\s+[-–—]\s+`)
)

// cleanAlertLine makes one tidy line: spaces collapsed, invisible padding
// and leading or trailing bullets dropped.
func cleanAlertLine(s string) string {
	s = strings.Join(strings.FieldsFunc(strings.Map(dropInvisible, s), isBlank), " ")
	s = alertEdgesRE.ReplaceAllString(s, "")
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}

// alertChaff reports whether a line is one of the labels alerts print
// around a posting rather than something about it.
func alertChaff(s string) bool {
	low := strings.ToLower(s)
	return s == "" || alertNoise[low] || notTitles[low] || alertAgoRE.MatchString(s) || alertPeopleRE.MatchString(s) || alertRatingRE.ReplaceAllString(s, "") == ""
}

// placeLike reports whether a line reads like a place rather than a sentence.
func placeLike(s string, lenient bool) bool {
	words := len(strings.Fields(s))
	if len(s) > 60 || words > 7 || alertPayRE.MatchString(s) {
		return false
	}
	if strings.Contains(s, ",") || alertRegionRE.MatchString(s) || workplaceOf(strings.ToLower(s)) != "" {
		return true
	}
	return lenient && words <= 4 && len(s) <= 40
}

// alertFields picks the title, employer, place and pay out of the lines
// printed inside a posting's link and after it.
func alertFields(linked, after []string) (title, company, place, pay string) {
	keep := func(in []string) (out []string) {
		for _, l := range in {
			if !alertChaff(l) {
				out = append(out, l)
			}
		}
		return out
	}
	linked, after = keep(linked), keep(after)
	if len(linked) == 0 {
		return "", "", "", ""
	}
	// Some sites print the employer and its rating above the title, inside the same link.
	if len(linked) > 1 && alertRatingRE.MatchString(linked[0]) {
		company = alertRatingRE.ReplaceAllString(linked[0], "")
		linked = linked[1:]
	}
	title = linked[0]
	if len(title) > 140 || len(strings.Fields(title)) > 18 || strings.ContainsAny(title, "<>") {
		return "", "", "", ""
	}
	rest := append(append([]string{}, linked[1:]...), after...)
	if len(rest) > 5 {
		rest = rest[:5]
	}
	for _, l := range rest {
		switch {
		case alertPayRE.MatchString(l) && len(l) <= 80:
			if pay == "" {
				pay = l
			}
		case company == "":
			l = alertRatingRE.ReplaceAllString(l, "")
			if parts := alertDotSplit.Split(l, 3); len(parts) >= 2 {
				company, place = parts[0], parts[1]
			} else if parts := alertDashSplit.Split(l, 2); len(parts) == 2 && placeLike(parts[1], false) {
				company, place = parts[0], parts[1]
			} else if len(l) <= 80 && len(strings.Fields(l)) <= 8 {
				company = l
			} else {
				return title, company, place, pay // a sentence: the posting's own words have begun
			}
		case place == "":
			if !placeLike(l, true) {
				return title, company, place, pay
			}
			place = l
		default:
			return title, company, place, pay
		}
	}
	return title, company, place, pay
}
