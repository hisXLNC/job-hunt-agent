// Package sources fetches job postings from places that need no login: the
// public endpoints of applicant tracking systems (Greenhouse, Lever, Ashby,
// SmartRecruiters, Workday, Workable, BambooHR, Recruitee), title searches
// (LinkedIn's public guest search, Canada's Job Bank, FreeHire), and any
// careers page or job site the person points it at. It also works out which
// of those systems an employer uses.
//
// Everything a posting carries is untrusted text from the internet. The
// package only ever converts it to plain text: nothing in it is executed.
// Follow-up requests go to hosts derived from a Board or a job id; for a page
// the person pointed at, they stay on that page's own site. No request is
// ever made to this computer or to a private network (see dial.go).
package sources

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// The systems this package knows, as they appear in Posting.Source and Board.Kind.
const (
	kindGreenhouse      = "greenhouse"
	kindLever           = "lever"
	kindAshby           = "ashby"
	kindSmartRecruiters = "smartrecruiters"
	kindWorkday         = "workday"
	kindLinkedIn        = "linkedin"
	kindWorkable        = "workable"
	kindBambooHR        = "bamboohr"
	kindRecruitee       = "recruitee"
	kindPage            = "page" // a careers page read as it stands; the token is its address
	kindJobBank         = "jobbank"
	kindFreeHire        = "freehire"
)

const (
	defaultTimeout   = 20 * time.Second
	defaultPageDelay = 300 * time.Millisecond
	maxBody          = 20 << 20 // largest response body read, in bytes
	acceptLanguage   = "en-CA,en;q=0.9"
	defaultUA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

	acceptJSON = "application/json"
	acceptHTML = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
)

// ErrNoBoard is returned by Detect when an employer has no job board on any
// supported system.
var ErrNoBoard = errors.New("sources: no public job board found")

// Posting is one job advert.
type Posting struct {
	Source      string    // "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday" | "linkedin"
	Key         string    // globally unique and stable: Source + ":" + board token + ":" + posting id (linkedin: "linkedin:" + job id)
	Company     string    // employer name as shown ("" for board sources where the caller already knows it)
	Title       string    //
	Location    string    // human text, e.g. "Toronto, ON"; several places are joined with " · "
	Workplace   string    // "remote" | "hybrid" | "onsite" | ""
	URL         string    // the page a person reads
	ApplyURL    string    // where to apply ("" if same as URL / unknown)
	Description string    // plain text: paragraphs separated by blank lines, list items prefixed "- "
	Pay         string    // human text if the source gives one, else ""
	PostedAt    time.Time // zero if unknown
	Applicants  int       // -1 if unknown
	NeedsDetail bool      // true when Description must be fetched with Detail
}

// Board identifies one employer's job board on one system.
type Board struct {
	Kind  string // "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday"
	Token string // greenhouse/lever/ashby/smartrecruiters: the company slug. workday: "tenant.wdN/site", e.g. "td.wd3/TD_Bank_Careers"
}

// Query is one search for a job title. Each source uses the parts it understands.
type Query struct {
	Keywords      string
	Location      string        // e.g. "Toronto, Ontario, Canada"
	Province      string        // two letters, e.g. "ON" (Job Bank)
	Country       string        // two letters, e.g. "CA" (FreeHire)
	Miles         int           // how far from Location to look (0 = LinkedIn's usual 25)
	Within        time.Duration // only postings newer than this (0 = any)
	Remote        bool          // remote jobs only
	FewApplicants bool          // LinkedIn's "under 10 applicants"
	Start         int           // paging offset
}

// Client talks to the job sources. The zero value is ready to use.
type Client struct {
	HTTP *http.Client // nil = a default with a 20s timeout
	UA   string       // "" = a normal desktop browser user agent

	// Base lets tests point each system at an httptest server. Keys:
	// "greenhouse", "lever", "ashby", "smartrecruiters", "linkedin", "workday".
	// For workday the base replaces "https://{tenant}.{wdN}.myworkdayjobs.com".
	// Empty or missing = the real host.
	Base map[string]string

	// Render, when set, loads a page in a real browser and returns what it
	// shows. It is used for pages that turn a plain request away or build
	// their list with scripts.
	Render func(ctx context.Context, url string) (string, error)

	httpOnce sync.Once
	http     *http.Client
	paceMu   sync.Mutex
	paced    map[string]time.Time

	// pageDelay is the pause between the pages of one listing. Zero means
	// defaultPageDelay against a real host and no pause against a Base
	// override (a test server needs no courtesy); negative means never.
	pageDelay time.Duration
	// workdayMax caps how many postings List reads from one Workday board;
	// zero means defaultWorkdayMax.
	workdayMax int
	// now replaces time.Now in tests.
	now func() time.Time
}

// HTTPError is returned for non-2xx answers so callers can tell "blocked or
// rate limited" (403, 429, 999) from "gone" (404).
type HTTPError struct {
	Status int
	URL    string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("sources: HTTP %d from %s", e.Status, e.URL)
}

// List returns every open posting on a company board, following the
// system's paging. Workday boards are capped (see ListWorkday for searching
// a very large tenant instead of walking it).
func (c *Client) List(ctx context.Context, b Board) ([]Posting, error) {
	if strings.TrimSpace(b.Token) == "" {
		return nil, fmt.Errorf("sources: %s board has no token", b.Kind)
	}
	switch b.Kind {
	case kindGreenhouse:
		return c.listGreenhouse(ctx, b)
	case kindLever:
		return c.listLever(ctx, b)
	case kindAshby:
		return c.listAshby(ctx, b)
	case kindSmartRecruiters:
		return c.listSmartRecruiters(ctx, b)
	case kindWorkday:
		return c.ListWorkday(ctx, b, "", c.workdayMax)
	case kindWorkable:
		return c.listWorkable(ctx, b)
	case kindBambooHR:
		return c.listBambooHR(ctx, b)
	case kindRecruitee:
		return c.listRecruitee(ctx, b)
	case kindPage:
		return c.ReadSite(ctx, Site{URL: b.Token, Board: true}, "", "")
	}
	return nil, fmt.Errorf("sources: unknown board kind %q", b.Kind)
}

// Detail fills in what a list or search result leaves out (Description, and
// where the source has them Applicants, Pay and ApplyURL) and clears
// NeedsDetail. It is a no-op for a posting that does not need it.
//
// Only Source, Key and URL are read to find the posting, so a Posting
// rebuilt from storage works as well as a fresh one.
func (c *Client) Detail(ctx context.Context, p *Posting) error {
	if p == nil || !p.NeedsDetail {
		return nil
	}
	switch p.Source {
	case kindSmartRecruiters:
		return c.detailSmartRecruiters(ctx, p)
	case kindWorkday:
		return c.detailWorkday(ctx, p)
	case kindLinkedIn:
		return c.detailLinkedIn(ctx, p)
	case kindBambooHR:
		return c.detailBambooHR(ctx, p)
	case kindJobBank:
		return c.detailJobBank(ctx, p)
	case kindPage, kindSite:
		return c.detailPage(ctx, p)
	}
	return fmt.Errorf("sources: no detail lookup for source %q", p.Source)
}

// ---- shared HTTP ----

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	c.httpOnce.Do(func() { c.http = c.publicOnly() })
	return c.http
}

// wait keeps at least gap between two requests to one source, however many
// searches are running. A test server (a Base override) is never waited for.
func (c *Client) wait(ctx context.Context, kind string, gap time.Duration) error {
	if c.Base[kind] != "" || gap <= 0 {
		return ctx.Err()
	}
	c.paceMu.Lock()
	if c.paced == nil {
		c.paced = map[string]time.Time{}
	}
	now := time.Now()
	at := c.paced[kind].Add(gap)
	if at.Before(now) {
		at = now
	}
	c.paced[kind] = at
	c.paceMu.Unlock()
	if d := time.Until(at); d > 0 {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
	return ctx.Err()
}

func (c *Client) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// base returns where a system's API lives: the test override, or the real host.
func (c *Client) base(kind, real string) string {
	if b := strings.TrimRight(c.Base[kind], "/"); b != "" {
		return b
	}
	return real
}

// pause waits between two pages of one listing, or until ctx ends.
func (c *Client) pause(ctx context.Context, kind string) error {
	d := c.pageDelay
	if d == 0 && c.Base[kind] == "" {
		d = defaultPageDelay
	}
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// fetch performs one request and returns the body (at most maxBody bytes)
// and the URL that finally answered, after redirects. A non-2xx answer is an
// *HTTPError. There are no retries: a throttled caller must back off.
func (c *Client) fetch(ctx context.Context, method, rawURL, accept string, body []byte) ([]byte, *url.URL, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rd)
	if err != nil {
		return nil, nil, fmt.Errorf("sources: %w", err)
	}
	ua := c.UA
	if ua == "" {
		ua = defaultUA
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", acceptLanguage)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("sources: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)) // lets the connection be reused
		return nil, nil, &HTTPError{Status: resp.StatusCode, URL: rawURL}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, nil, fmt.Errorf("sources: reading %s: %w", rawURL, err)
	}
	if len(data) > maxBody {
		return nil, nil, fmt.Errorf("sources: answer from %s is larger than %d MB", rawURL, maxBody>>20)
	}
	return data, resp.Request.URL, nil
}

func (c *Client) getJSON(ctx context.Context, rawURL string, v any) error {
	data, _, err := c.fetch(ctx, http.MethodGet, rawURL, acceptJSON, nil)
	if err != nil {
		return err
	}
	return decodeJSON(rawURL, data, v)
}

func (c *Client) postJSON(ctx context.Context, rawURL string, in, v any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("sources: %w", err)
	}
	data, _, err := c.fetch(ctx, http.MethodPost, rawURL, acceptJSON, body)
	if err != nil {
		return err
	}
	return decodeJSON(rawURL, data, v)
}

func (c *Client) getHTML(ctx context.Context, rawURL string) (string, *url.URL, error) {
	data, final, err := c.fetch(ctx, http.MethodGet, rawURL, acceptHTML, nil)
	if err != nil {
		return "", nil, err
	}
	return string(data), final, nil
}

func decodeJSON(rawURL string, data []byte, v any) error {
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("sources: unreadable answer from %s: %w", rawURL, err)
	}
	return nil
}

// ---- shared field helpers ----

// flexID reads a JSON id that may be written as a number or as a string.
type flexID string

func (f *flexID) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	switch {
	case s == "" || s == "null" || s[0] == '{' || s[0] == '[':
		*f = ""
	case s[0] == '"':
		var v string
		if err := json.Unmarshal(b, &v); err != nil {
			return err
		}
		*f = flexID(strings.TrimSpace(v))
	default:
		*f = flexID(s) // a number, kept exactly as written
	}
	return nil
}

// postingKey builds the stable identity of a board posting.
func postingKey(b Board, id string) string {
	return b.Kind + ":" + b.Token + ":" + id
}

// splitKey takes a board posting's Key apart again.
func splitKey(p *Posting) (token, id string, err error) {
	rest, ok := strings.CutPrefix(p.Key, p.Source+":")
	if ok {
		// The id is last and the token never holds a colon.
		token, id, ok = strings.Cut(rest, ":")
	}
	if !ok || token == "" || id == "" {
		return "", "", fmt.Errorf("sources: posting key %q is not %s:<board>:<id>", p.Key, p.Source)
	}
	return token, id, nil
}

var timeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05.999999999Z0700",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
}

// parseTime reads the timestamp formats the sources use. A bare date means
// the start of that day here. Anything unreadable is the zero time.
func parseTime(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, layout := range timeLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	if t, err := time.ParseInLocation("2006-01-02", s, time.Local); err == nil {
		return t
	}
	return time.Time{}
}

// joinLocations joins the distinct, non-empty places with " · ".
func joinLocations(places ...string) string {
	var out []string
	seen := make(map[string]bool, len(places))
	for _, p := range places {
		p = strings.Join(strings.Fields(p), " ")
		if k := strings.ToLower(p); p != "" && !seen[k] {
			seen[k] = true
			out = append(out, p)
		}
	}
	return strings.Join(out, " · ")
}

// workplaceOf maps a source's own wording ("Hybrid", "on-site", "OnSite",
// "Remote - Canada") to "remote", "hybrid", "onsite" or "".
func workplaceOf(s string) string {
	found := ""
	for _, m := range workplaceRE.FindAllString(strings.ToLower(s), -1) {
		switch {
		case m == "hybrid":
			return "hybrid" // "hybrid remote" is hybrid
		case m == "remote":
			found = "remote"
		case found == "":
			found = "onsite"
		}
	}
	return found
}

// firstNonEmpty returns the first argument that is not blank.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// webURL returns s when it is an absolute http(s) address, and "" otherwise,
// so a posting can never smuggle in a javascript: or file: link.
func webURL(s string) string {
	s = strings.TrimSpace(s)
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return s
}

// joinSections joins the non-empty blocks of a description with blank lines.
func joinSections(blocks ...string) string {
	var out []string
	for _, b := range blocks {
		if b = strings.TrimSpace(b); b != "" {
			out = append(out, b)
		}
	}
	return strings.Join(out, "\n\n")
}
