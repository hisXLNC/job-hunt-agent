package sources

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strings"
)

// A careers page or job site the person pointed Job Hunt at is read as it
// stands, with no knowledge of who built it. Three things are looked for, in
// order: the postings a page describes to search engines (schema.org
// JobPosting), the job list some careers systems embed in the page, and
// links that look like postings. Whatever is found is followed only within
// the site the page is on.

const kindSite = "site"

// ErrNeedsBrowser means a page turned a plain request away, or builds its
// list with scripts, and no browser was available to read it with.
var ErrNeedsBrowser = errors.New("sources: this page only opens in a real web browser")

// Site is one page of jobs: an employer's careers page, a recruiter's
// search, a job board.
type Site struct {
	ID   string // a short label used in posting keys; "" = the page's host
	Name string // the employer shown when a posting names none
	// URL is the page's address. It may hold {title} and {place} where a job
	// title and a place go; {title-} and {place-} give the same words joined
	// by dashes, for sites that put them in the path.
	URL     string
	Link    string // optional regular expression: links that match are postings
	Browser bool   // the page is known to need a real browser
	Board   bool   // an employer's own careers page: its postings are Source "page"
}

// Searches reports whether the address has a place for a job title.
func (s Site) Searches() bool {
	return strings.Contains(s.URL, "{title}") || strings.Contains(s.URL, "{title-}")
}

// Address fills a title and a place into the site's address.
func (s Site) Address(title, place string) string {
	dash := func(v string) string {
		return strings.Join(strings.FieldsFunc(strings.ToLower(foldAccents.Replace(v)), func(r rune) bool {
			return (r < 'a' || r > 'z') && (r < '0' || r > '9')
		}), "-")
	}
	return strings.NewReplacer(
		"{title}", url.QueryEscape(strings.TrimSpace(title)), "{place}", url.QueryEscape(strings.TrimSpace(place)),
		"{title-}", dash(title), "{place-}", dash(place),
	).Replace(strings.TrimSpace(s.URL))
}

// ReadSite reads one page of a site and returns the postings on it. Those
// without a full description have NeedsDetail set.
func (c *Client) ReadSite(ctx context.Context, s Site, title, place string) ([]Posting, error) {
	addr := s.Address(title, place)
	u, ok := publicURL(addr)
	if !ok {
		return nil, fmt.Errorf("sources: %q is not a public web address", addr)
	}
	var link *regexp.Regexp
	if s.Link != "" {
		re, err := regexp.Compile("(?i)" + s.Link)
		if err != nil {
			return nil, fmt.Errorf("sources: the link pattern of %s is not valid: %w", firstNonEmpty(s.Name, u.Host), err)
		}
		link = re
	}
	body, final, rendered, err := c.open(ctx, u.String(), s.Browser)
	if err != nil {
		return nil, err
	}
	out := parsePage(body, final, s, link, place)
	if len(out) == 0 && !rendered && c.Render != nil {
		// Nothing in the page as sent: the list is probably built by scripts.
		if shown, rerr := c.Render(ctx, u.String()); rerr == nil {
			out = parsePage(shown, final, s, link, place)
		}
	}
	return out, nil
}

// open fetches a page, turning to the browser when the page asks for one.
func (c *Client) open(ctx context.Context, addr string, browserFirst bool) (body string, final *url.URL, rendered bool, err error) {
	final, _ = url.Parse(addr)
	if browserFirst && c.Render != nil {
		if body, err = c.Render(ctx, addr); err == nil && !challenged(body) {
			return body, final, true, nil
		}
	}
	fetch := addr
	if b := strings.TrimRight(c.Base[kindPage], "/"); b != "" && final != nil {
		fetch = b + final.RequestURI() // a test server stands in for the site
	}
	body, got, err := c.getHTML(ctx, fetch)
	if fetch != addr {
		got = final
	}
	if err == nil && !challenged(body) {
		return body, got, false, nil
	}
	var he *HTTPError
	blocked := err == nil || (errors.As(err, &he) && (he.Status == 403 || he.Status == 429 || he.Status == 503 || he.Status == 406))
	if !blocked {
		return "", nil, false, err
	}
	if c.Render == nil {
		if he != nil && he.Status == 429 {
			return "", nil, false, err // asked to slow down: a browser would not change that
		}
		return "", nil, false, ErrNeedsBrowser
	}
	if body, err = c.Render(ctx, addr); err != nil {
		return "", nil, false, err
	}
	if challenged(body) {
		return "", nil, false, ErrNeedsBrowser
	}
	return body, final, true, nil
}

// challenged reports whether a page is a "prove you are a browser" screen
// rather than the page asked for.
func challenged(body string) bool {
	if len(body) > 200_000 {
		return false // those screens are small
	}
	low := strings.ToLower(body)
	for _, mark := range []string{"just a moment...", "cf-challenge", "cf_chl_", "px-captcha", "pardon our interruption", "access denied", "are you a robot", "verify you are human", "enable javascript and cookies", "incapsula incident"} {
		if strings.Contains(low, mark) {
			return true
		}
	}
	return false
}

// parsePage finds the postings in one page.
func parsePage(body string, base *url.URL, s Site, link *regexp.Regexp, place string) []Posting {
	source := kindSite
	if s.Board {
		source = kindPage
	}
	id := firstNonEmpty(s.ID, strings.TrimPrefix(strings.ToLower(base.Hostname()), "www."))
	var out []Posting
	seen := map[string]bool{}
	add := func(p Posting, own string) {
		if p.Title == "" || p.URL == "" {
			return
		}
		u, ok := publicURL(p.URL)
		if !ok || (!sameSite(u, base) && (link == nil || !link.MatchString(p.URL))) {
			return
		}
		p.Source = source
		p.Key = source + ":" + id + ":" + firstNonEmpty(own, idFromURL(u))
		if seen[p.Key] {
			return
		}
		seen[p.Key] = true
		p.Company = firstNonEmpty(p.Company, s.Name)
		p.Applicants = -1
		p.NeedsDetail = len(strings.Fields(p.Description)) < 40
		if p.Workplace == "" {
			p.Workplace = workplaceOf(p.Location + " " + p.Title)
		}
		out = append(out, p)
	}
	for _, j := range jsonLDPostings(body) {
		p, own := fromJSONLD(j, base)
		add(p, own)
	}
	if len(out) > 0 {
		return out
	}
	for _, p := range phenomJobs(body, base) {
		add(p.Posting, p.id)
	}
	if len(out) > 0 {
		return out
	}
	for _, p := range linkedJobs(body, base, link) {
		p.Location = place // where it was searched for, until its own page says
		add(p, "")
	}
	return out
}

// sameSite reports whether two addresses belong to one organisation's site:
// the same host, or hosts under the same registered name.
func sameSite(a, b *url.URL) bool {
	return siteName(a.Hostname()) == siteName(b.Hostname())
}

func siteName(host string) string {
	labels := strings.Split(strings.ToLower(strings.TrimSuffix(host, ".")), ".")
	n := 2
	if len(labels) >= 3 && len(labels[len(labels)-1]) == 2 {
		switch labels[len(labels)-2] {
		case "co", "com", "org", "net", "gov", "gc", "ac", "on", "qc", "bc", "ab":
			n = 3 // "example.co.uk", "example.on.ca"
		}
	}
	if len(labels) <= n {
		return strings.Join(labels, ".")
	}
	return strings.Join(labels[len(labels)-n:], ".")
}

var longNumberRE = regexp.MustCompile(`\d{4,}`)

// idFromURL names a posting by the number in its address, or failing that by
// a short digest of the address, so the same posting gets the same key on
// every search.
func idFromURL(u *url.URL) string {
	for _, k := range []string{"gh_jid", "jobId", "jobid", "job_id", "jid", "id", "reqId", "req"} {
		if v := u.Query().Get(k); v != "" && len(v) <= 64 {
			return v
		}
	}
	if m := longNumberRE.FindAllString(u.Path, -1); len(m) > 0 {
		return m[len(m)-1]
	}
	sum := sha1.Sum([]byte(strings.TrimRight(u.Path, "/") + "?" + u.RawQuery))
	return hex.EncodeToString(sum[:6])
}

// ---- schema.org JobPosting ----

var jsonLDRE = regexp.MustCompile(`(?is)<script[^>]*type\s*=\s*["']?application/ld\+json["']?[^>]*>(.*?)</script>`)

// jsonLDPostings returns every JobPosting a page describes.
func jsonLDPostings(body string) []map[string]any {
	var out []map[string]any
	var walk func(v any, depth int)
	walk = func(v any, depth int) {
		if depth > 6 || len(out) >= 300 {
			return
		}
		switch x := v.(type) {
		case []any:
			for _, e := range x {
				walk(e, depth+1)
			}
		case map[string]any:
			if strings.Contains(fmt.Sprint(x["@type"]), "JobPosting") {
				out = append(out, x)
				return
			}
			for _, k := range []string{"@graph", "itemListElement", "item", "mainEntity", "mainEntityOfPage"} {
				if e, ok := x[k]; ok {
					walk(e, depth+1)
				}
			}
		}
	}
	for _, m := range jsonLDRE.FindAllStringSubmatch(body, 40) {
		raw := strings.TrimSpace(m[1])
		var v any
		if json.Unmarshal([]byte(raw), &v) != nil {
			// Some sites leave raw line breaks inside strings.
			if json.Unmarshal([]byte(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(raw)), &v) != nil {
				continue
			}
		}
		walk(v, 0)
	}
	return out
}

// ldText reads a value that may be a string, a thing with a name, or a list.
func ldText(v any) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case float64:
		return strings.TrimSuffix(fmt.Sprintf("%.2f", x), ".00")
	case map[string]any:
		return firstNonEmpty(ldText(x["name"]), ldText(x["value"]), ldText(x["@id"]))
	case []any:
		var parts []string
		for _, e := range x {
			if t := ldText(e); t != "" {
				parts = append(parts, t)
			}
		}
		return strings.Join(parts, "; ")
	}
	return ""
}

func ldNumber(v any) *float64 {
	switch x := v.(type) {
	case float64:
		return &x
	case string:
		var f float64
		if _, err := fmt.Sscanf(strings.ReplaceAll(strings.TrimSpace(x), ",", ""), "%g", &f); err == nil {
			return &f
		}
	}
	return nil
}

func ldMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// fromJSONLD turns one JobPosting into a Posting, with the posting's own id
// when it states one.
func fromJSONLD(j map[string]any, base *url.URL) (Posting, string) {
	p := Posting{Title: plainLine(ldText(j["title"]))}
	if p.Title == "" {
		p.Title = plainLine(ldText(j["name"]))
	}
	link := firstNonEmpty(ldText(j["url"]), ldText(j["sameAs"]))
	if u, err := base.Parse(link); err == nil && link != "" {
		p.URL = u.String()
	} else {
		p.URL = base.String()
	}
	p.Company = plainLine(ldText(j["hiringOrganization"]))
	p.Description = HTMLToText(html.UnescapeString(ldText(j["description"])))
	if strings.Contains(ldText(j["description"]), "<") {
		p.Description = HTMLToText(ldText(j["description"]))
	}
	p.PostedAt = parseTime(ldText(j["datePosted"]))

	var places []string
	locs, _ := j["jobLocation"].([]any)
	if locs == nil && j["jobLocation"] != nil {
		locs = []any{j["jobLocation"]}
	}
	for _, l := range locs {
		a := ldMap(l)["address"]
		if s, ok := a.(string); ok {
			places = append(places, s)
			continue
		}
		am := ldMap(a)
		if am == nil {
			am = ldMap(l)
		}
		if pl := joinPlace(ldText(am["addressLocality"]), ldText(am["addressRegion"]), ldText(am["addressCountry"])); pl != "" {
			places = append(places, pl)
		}
	}
	if len(places) > 4 {
		places = places[:4]
	}
	p.Location = joinLocations(places...)
	if strings.Contains(strings.ToUpper(ldText(j["jobLocationType"])), "TELECOMMUTE") {
		p.Workplace = "remote"
		if p.Location == "" {
			p.Location = firstNonEmpty(ldText(j["applicantLocationRequirements"]), "Remote")
		}
	}
	if b := ldMap(j["baseSalary"]); b != nil {
		val := ldMap(b["value"])
		if val == nil {
			val = b
		}
		lo, hi := ldNumber(val["minValue"]), ldNumber(val["maxValue"])
		if lo == nil && hi == nil {
			hi = ldNumber(val["value"])
		}
		p.Pay = payText(lo, hi, firstNonEmpty(ldText(b["currency"]), ldText(val["currency"])), ldText(val["unitText"]))
	}
	own := ldText(j["identifier"])
	if m := ldMap(j["identifier"]); m != nil {
		own = firstNonEmpty(ldText(m["value"]), ldText(m["@id"]))
	}
	return p, plainLine(own)
}

// plainLine makes one clean line of text out of a value that may hold markup.
func plainLine(s string) string {
	if strings.ContainsAny(s, "<&") {
		s = HTMLToText(s)
	}
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// ---- job lists embedded by careers systems ----

type keyed struct {
	Posting
	id string
}

// phenomJobs reads the job list a Phenom careers site embeds in its pages.
func phenomJobs(body string, base *url.URL) []keyed {
	at := strings.Index(body, `"eagerLoadRefineSearch"`)
	if at < 0 {
		return nil
	}
	i := strings.Index(body[at:], `"jobs":[`)
	if i < 0 {
		return nil
	}
	var jobs []map[string]any
	if json.NewDecoder(strings.NewReader(body[at+i+len(`"jobs":`):])).Decode(&jobs) != nil {
		return nil
	}
	// A Phenom site lives under "/{country}/{language}".
	var prefix []string
	for _, seg := range strings.Split(base.Path, "/") {
		if seg != "" && len(prefix) < 2 {
			prefix = append(prefix, seg)
		}
	}
	var out []keyed
	for _, j := range jobs {
		id := firstNonEmpty(ldText(j["jobId"]), ldText(j["reqId"]), ldText(j["jobSeqNo"]))
		title := plainLine(ldText(j["title"]))
		if id == "" || title == "" {
			continue
		}
		u, err := base.Parse("/" + strings.Join(append(prefix, "job", url.PathEscape(id)), "/"))
		if err != nil {
			continue
		}
		out = append(out, keyed{Posting{
			Title:    title,
			Location: firstNonEmpty(ldText(j["cityStateCountry"]), ldText(j["location"])),
			URL:      u.String(),
			PostedAt: parseTime(firstNonEmpty(ldText(j["postedDate"]), ldText(j["dateCreated"]))),
		}, id})
	}
	return out
}

// ---- links that look like postings ----

var (
	// A path into a jobs section that ends in a number or a long slug: a
	// posting, never a category page such as "/jobs/finance/".
	jobPathRE  = regexp.MustCompile(`(?i)/(?:jobs?|job-detail|job-post|careers?|opportunit(?:y|ies)|postings?|vacanc(?:y|ies)|positions?|openings?|offres?|emplois?)/(?:[^?#]*\d{4,}|[a-z0-9]+(?:-[a-z0-9]+){2,})`)
	jobQueryRE = regexp.MustCompile(`(?i)(?:^|&)(?:gh_jid|jobid|job_id|jid|reqid|requisitionid|posting_id)=[\w-]{3,}`)
	notTitles  = map[string]bool{"apply": true, "apply now": true, "view job": true, "view details": true, "read more": true, "learn more": true, "more": true, "details": true, "jobs": true, "all jobs": true, "search jobs": true, "next": true, "previous": true, "share": true, "save": true, "view all jobs": true, "see all jobs": true, "job alerts": true, "sign in": true}
)

// linkedJobs returns the links in a page that lead to postings, with the
// link's own words as the title.
func linkedJobs(body string, base *url.URL, own *regexp.Regexp) []Posting {
	d := parseHTML(body)
	var out []Posting
	isLink := func(t token) bool { return t.name == "a" && t.attr("href") != "" }
	for i := d.find(0, len(d.toks), isLink); i >= 0 && len(out) < 200; i = d.find(i+1, len(d.toks), isLink) {
		href := strings.TrimSpace(d.toks[i].attr("href"))
		if strings.HasPrefix(href, "#") || strings.HasPrefix(strings.ToLower(href), "javascript:") || strings.HasPrefix(strings.ToLower(href), "mailto:") {
			continue
		}
		u, err := base.Parse(href)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			continue
		}
		u.Fragment = ""
		fits := false
		if own != nil {
			fits = own.MatchString(u.String())
		} else {
			fits = jobPathRE.MatchString(u.Path) || jobQueryRE.MatchString(u.RawQuery)
		}
		title := d.text(i)
		words := len(strings.Fields(title))
		if !fits || len(title) > 140 || notTitles[strings.ToLower(title)] || words < 1 || (own == nil && (words < 2 || words > 16)) {
			continue
		}
		out = append(out, Posting{Title: title, URL: u.String()})
	}
	return out
}

// ---- one posting's own page ----

// detailPage reads a posting's own page for its text. Only pages on the
// public internet are opened; see dial.go.
func (c *Client) detailPage(ctx context.Context, p *Posting) error {
	u, ok := publicURL(p.URL)
	if !ok {
		return fmt.Errorf("sources: %q is not a public web address", p.URL)
	}
	body, final, _, err := c.open(ctx, u.String(), false)
	if err != nil {
		return err
	}
	if final == nil {
		final = u
	}
	text := ""
	for _, j := range jsonLDPostings(body) {
		got, _ := fromJSONLD(j, final)
		if len(got.Description) <= len(text) {
			continue
		}
		text = got.Description
		p.Location = firstNonEmpty(p.Location, got.Location)
		p.Pay = firstNonEmpty(p.Pay, got.Pay)
		p.Company = firstNonEmpty(p.Company, got.Company)
		p.Workplace = firstNonEmpty(got.Workplace, p.Workplace)
		if p.PostedAt.IsZero() {
			p.PostedAt = got.PostedAt
		}
	}
	if len(strings.Fields(text)) < 40 {
		if t := mainText(body); len(strings.Fields(t)) > len(strings.Fields(text)) {
			text = t
		}
	}
	if len(strings.Fields(text)) < 40 {
		return errChanged(final.Hostname())
	}
	if len(text) > 30000 {
		text = text[:30000]
	}
	p.Description, p.NeedsDetail = text, false
	if p.Workplace == "" {
		p.Workplace = workplaceOf(p.Location)
	}
	return nil
}

var descClassRE = regexp.MustCompile(`(?i)job[-_ ]?(?:description|details?|content|body|posting)|posting[-_ ]?(?:description|body|content)|description`)

// mainText returns the part of a page most likely to be the posting: the
// element marked as its description, else the main part of the page.
func mainText(body string) string {
	d := parseHTML(body)
	best := ""
	consider := func(match func(token) bool) {
		for i := d.find(0, len(d.toks), match); i >= 0; i = d.find(i+1, len(d.toks), match) {
			if t := HTMLToText(d.inner(i)); len(t) > len(best) {
				best = t
			}
		}
	}
	consider(func(t token) bool {
		return (t.name == "div" || t.name == "section" || t.name == "article") && (descClassRE.MatchString(t.attr("class")) || descClassRE.MatchString(t.attr("id")) || t.attr("itemprop") == "description")
	})
	if len(strings.Fields(best)) >= 40 {
		return best
	}
	consider(func(t token) bool { return t.name == "main" || t.name == "article" })
	return best
}

// ---- searching by title ----

// Finders are the places that can be searched for a job title without
// naming an employer.
var Finders = []string{kindLinkedIn, kindJobBank, kindFreeHire}

// Find runs one search for a job title on a title-searched source.
func (c *Client) Find(ctx context.Context, source string, q Query) ([]Posting, error) {
	switch source {
	case kindLinkedIn:
		return c.Search(ctx, q)
	case kindJobBank:
		return c.findJobBank(ctx, q)
	case kindFreeHire:
		return c.findFreeHire(ctx, q)
	}
	return nil, fmt.Errorf("sources: %q cannot be searched by title", source)
}

// PublicURL reports whether raw is an http(s) address that is not on this
// computer or a private network, and returns it tidied.
func PublicURL(raw string) (string, bool) {
	u, ok := publicURL(strings.TrimSpace(raw))
	if !ok {
		return "", false
	}
	return u.String(), true
}

// DetectPage looks for an employer's own careers page that can be read as it
// stands, for employers on no job system Job Hunt knows. It returns the
// board to watch and how many postings it showed.
func (c *Client) DetectPage(ctx context.Context, site string) (Board, int, error) {
	root := siteRoot(site)
	if root == "" {
		return Board{}, 0, ErrNoBoard
	}
	tries := []string{strings.TrimSpace(site)}
	for _, p := range careersPaths {
		if p != "" {
			tries = append(tries, root+p)
		}
	}
	seen := map[string]bool{}
	for _, addr := range tries {
		if !strings.Contains(addr, "://") {
			addr = "https://" + addr
		}
		if seen[addr] {
			continue
		}
		seen[addr] = true
		posts, err := c.ReadSite(ctx, Site{URL: addr, Board: true}, "", "")
		if ctx.Err() != nil {
			return Board{}, 0, ctx.Err()
		}
		// One link that looks like a job proves little; two is a list.
		if err == nil && len(posts) >= 2 {
			return Board{Kind: kindPage, Token: addr}, len(posts), nil
		}
	}
	return Board{}, 0, ErrNoBoard
}
