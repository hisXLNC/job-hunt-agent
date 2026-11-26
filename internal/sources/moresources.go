package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Three job searches that need a key the person gets for themselves:
//
//   - Adzuna, a job search engine with a free developer plan (an app ID and a key);
//   - Jooble, which gathers listings from many job sites (one key);
//   - JSearch, which reads Google for Jobs (a key from RapidAPI or OpenWeb Ninja).
//
// A key is only ever sent to the service it belongs to. It never appears in
// an error or in the debugging record: where the address itself holds the
// key, a stand-in is written in its place.

const (
	adzunaHost       = "https://api.adzuna.com"
	joobleHost       = "https://jooble.org"
	jsearchRapidHost = "https://jsearch.p.rapidapi.com"
	jsearchNinjaHost = "https://api.openwebninja.com"

	// Where a JSearch key was bought.
	FromRapidAPI     = "rapidapi"
	FromOpenWebNinja = "openwebninja"

	// How far around the person's city these searches reach, in kilometres.
	keyedRadiusKM = 40
)

// Keyed lists the searches that need a key.
var Keyed = []string{kindAdzuna, kindJooble, kindJSearch, kindApify}

var (
	// ErrNoKey means a search was asked for without its key.
	ErrNoKey = errors.New("sources: no key has been saved for this search")
	// ErrKeyRefused means the service did not accept the key.
	ErrKeyRefused = errors.New("sources: the service refused the key")
	// ErrOutOfRequests means the key's plan has no requests left for now.
	ErrOutOfRequests = errors.New("sources: the key has no requests left for now")
	// ErrBlockedHere means the service turns away requests from the country
	// this computer is in; the key may be fine.
	ErrBlockedHere = errors.New("sources: the service turns away requests from where this computer is")
	// ErrNoCountry means the service has no listings for the person's country.
	ErrNoCountry = errors.New("sources: this search has no listings for that country")
)

// Keys are what the keyed searches need. The zero value has none.
type Keys struct {
	AdzunaID    string
	AdzunaKey   string
	Jooble      string
	JSearch     string
	JSearchFrom string // FromRapidAPI (the default) or FromOpenWebNinja
	Apify       string // an Apify API token, for LinkedIn through a scraper there
	ApifyActor  string // the scraper, as "user/name"; empty means ApifyActor
}

// Has reports whether everything one search needs is there.
func (k Keys) Has(source string) bool {
	switch source {
	case kindAdzuna:
		return strings.TrimSpace(k.AdzunaID) != "" && strings.TrimSpace(k.AdzunaKey) != ""
	case kindJooble:
		return strings.TrimSpace(k.Jooble) != ""
	case kindJSearch:
		return strings.TrimSpace(k.JSearch) != ""
	case kindApify:
		return strings.TrimSpace(k.Apify) != ""
	}
	return false
}

// FindKeyed runs one search for a job title on a search that needs a key.
// Query.Keywords is the title, Location the city, Country two letters,
// Within how new the postings must be and Max how many are wanted.
func (c *Client) FindKeyed(ctx context.Context, source string, k Keys, q Query) ([]Posting, error) {
	if !k.Has(source) {
		return nil, ErrNoKey
	}
	var out []Posting
	var err error
	switch source {
	case kindAdzuna:
		out, err = c.findAdzuna(ctx, k, q)
	case kindJooble:
		out, err = c.findJooble(ctx, k, q)
	case kindJSearch:
		out, err = c.findJSearch(ctx, k, q)
	case kindApify:
		out, err = c.findApify(ctx, k, q)
	default:
		return nil, fmt.Errorf("sources: %q is not a search that takes a key", source)
	}
	if err != nil {
		return nil, keyedErr(source, err)
	}
	// Whatever the service understood by "recent", nothing older is passed on.
	if q.Within > 0 {
		cutoff, kept := c.clock().Add(-q.Within-24*time.Hour), out[:0]
		for _, p := range out {
			if p.PostedAt.IsZero() || !p.PostedAt.Before(cutoff) {
				kept = append(kept, p)
			}
		}
		out = kept
	}
	return out, nil
}

// keyedErr says what a service's refusal means.
func keyedErr(source string, err error) error {
	var he *HTTPError
	if !errors.As(err, &he) {
		return err
	}
	switch {
	case he.Status == 451, he.Status == 403 && blockedPage(he.Body):
		return fmt.Errorf("%w (%d)", ErrBlockedHere, he.Status)
	case he.Status == 401 || he.Status == 403, source == kindJooble && he.Status == 404:
		return fmt.Errorf("%w (%d)", ErrKeyRefused, he.Status)
	case source == kindApify && he.Status == 402:
		return fmt.Errorf("%w (%d)", ErrOutOfRequests, he.Status)
	case he.Status == 429:
		return fmt.Errorf("%w (%d)", ErrOutOfRequests, he.Status)
	}
	return err
}

// daysWithin turns "newer than" into whole days, at least one.
func daysWithin(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return max(int((d+24*time.Hour-1)/(24*time.Hour)), 1)
}

// ---- Adzuna ----

// adzunaCurrency lists the countries Adzuna covers, with the currency its
// salaries are in.
var adzunaCurrency = map[string]string{
	"at": "EUR", "au": "AUD", "be": "EUR", "br": "BRL", "ca": "CAD", "ch": "CHF", "de": "EUR", "es": "EUR", "fr": "EUR", "gb": "GBP",
	"in": "INR", "it": "EUR", "mx": "MXN", "nl": "EUR", "nz": "NZD", "pl": "PLN", "sg": "SGD", "us": "USD", "za": "ZAR",
}

// AdzunaCovers reports whether Adzuna has listings for a country (two letters).
func AdzunaCovers(country string) bool {
	return adzunaCurrency[strings.ToLower(strings.TrimSpace(country))] != ""
}

type adzunaAnswer struct {
	Results []struct {
		ID          flexID `json:"id"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Created     string `json:"created"`
		RedirectURL string `json:"redirect_url"`
		Company     struct {
			Name string `json:"display_name"`
		} `json:"company"`
		Location struct {
			Name string `json:"display_name"`
		} `json:"location"`
		SalaryMin *float64 `json:"salary_min"`
		SalaryMax *float64 `json:"salary_max"`
		Predicted flexID   `json:"salary_is_predicted"`
	} `json:"results"`
}

// findAdzuna asks for the newest postings for a title near a city.
// https://developer.adzuna.com/docs/search
func (c *Client) findAdzuna(ctx context.Context, k Keys, q Query) ([]Posting, error) {
	cc := strings.ToLower(strings.TrimSpace(q.Country))
	currency := adzunaCurrency[cc]
	if currency == "" {
		return nil, ErrNoCountry
	}
	v := url.Values{}
	v.Set("what", strings.TrimSpace(q.Keywords))
	v.Set("sort_by", "date")
	v.Set("results_per_page", itoa(pageSize(q.Max, 50)))
	v.Set("content-type", "application/json")
	if days := daysWithin(q.Within); days > 0 {
		v.Set("max_days_old", itoa(days))
	}
	if where := strings.TrimSpace(q.Location); where != "" {
		// Adzuna's own reach is 5 km, which misses most of a city's suburbs.
		v.Set("where", where)
		v.Set("distance", itoa(keyedRadiusKM))
	}
	shown := "api.adzuna.com/v1/api/jobs/" + cc + "/search/1?" + v.Encode()
	v.Set("app_id", strings.TrimSpace(k.AdzunaID))
	v.Set("app_key", strings.TrimSpace(k.AdzunaKey))
	var res adzunaAnswer
	if err := c.keyedJSON(ctx, http.MethodGet, c.base(kindAdzuna, adzunaHost)+"/v1/api/jobs/"+cc+"/search/1?"+v.Encode(), shown, nil, nil, &res); err != nil {
		return nil, err
	}
	var out []Posting
	for _, j := range res.Results {
		title, link, id := plainLine(j.Title), webURL(j.RedirectURL), string(j.ID)
		if title == "" || link == "" || id == "" {
			continue
		}
		p := Posting{
			Source:      kindAdzuna,
			Key:         kindAdzuna + ":" + id,
			Company:     plainLine(j.Company.Name),
			Title:       title,
			Location:    plainLine(j.Location.Name),
			URL:         link,
			Description: HTMLToText(j.Description),
			PostedAt:    parseTime(j.Created),
			Applicants:  -1,
		}
		p.Workplace = firstNonEmpty(workplaceOf(p.Title), workplaceOf(p.Location))
		// Adzuna's own guess at the pay is not the posting's pay.
		if s := string(j.Predicted); s != "1" && s != "true" {
			p.Pay = payText(j.SalaryMin, j.SalaryMax, currency, "year")
		}
		out = append(out, p)
	}
	return out, nil
}

// ---- Jooble ----

type joobleAsk struct {
	Keywords string `json:"keywords"`
	Location string `json:"location,omitempty"`
	Radius   string `json:"radius,omitempty"`
	Page     string `json:"page"`
	PerPage  string `json:"ResultOnPage"`
	From     string `json:"datecreatedfrom,omitempty"`
}

type joobleAnswer struct {
	Jobs []struct {
		ID       flexID `json:"id"`
		Title    string `json:"title"`
		Location string `json:"location"`
		Snippet  string `json:"snippet"`
		Salary   string `json:"salary"`
		Link     string `json:"link"`
		Company  string `json:"company"`
		Updated  string `json:"updated"`
	} `json:"jobs"`
}

// findJooble asks Jooble for a title near a city. The key is part of the
// address, so the address is never written anywhere. Jooble gives a short
// excerpt of each posting, not its text.
// https://jooble.org/api/about
func (c *Client) findJooble(ctx context.Context, k Keys, q Query) ([]Posting, error) {
	ask := joobleAsk{Keywords: strings.TrimSpace(q.Keywords), Page: "1", PerPage: itoa(pageSize(q.Max, 50))}
	if where := strings.TrimSpace(q.Location); where != "" {
		// Jooble takes a reach of 0, 8, 16, 24, 40 or 80 km.
		ask.Location, ask.Radius = where, itoa(keyedRadiusKM)
	}
	if q.Within > 0 {
		ask.From = c.clock().Add(-time.Duration(daysWithin(q.Within)) * 24 * time.Hour).Format("2006-01-02")
	}
	var res joobleAnswer
	addr := c.base(kindJooble, joobleHost) + "/api/" + url.PathEscape(strings.TrimSpace(k.Jooble))
	if err := c.keyedJSON(ctx, http.MethodPost, addr, "jooble.org/api/[key]", nil, ask, &res); err != nil {
		return nil, err
	}
	var out []Posting
	for _, j := range res.Jobs {
		title, link := plainLine(j.Title), webURL(j.Link)
		id := firstNonEmpty(string(j.ID), link)
		if title == "" || link == "" {
			continue
		}
		p := Posting{
			Source:      kindJooble,
			Key:         kindJooble + ":" + id,
			Company:     plainLine(j.Company),
			Title:       title,
			Location:    plainLine(j.Location),
			URL:         link,
			Description: HTMLToText(j.Snippet),
			Pay:         plainLine(j.Salary),
			PostedAt:    parseTime(j.Updated),
			Applicants:  -1,
			NeedsDetail: true, // the excerpt is a few lines; the page has the rest
		}
		p.Workplace = firstNonEmpty(workplaceOf(p.Title), workplaceOf(p.Location))
		out = append(out, p)
	}
	return out, nil
}

// ---- JSearch (Google for Jobs) ----

type jsearchAnswer struct {
	Data []struct {
		ID          string   `json:"job_id"`
		Employer    string   `json:"employer_name"`
		EmpLogo     string   `json:"employer_logo"`
		EmpSite     string   `json:"employer_website"`
		Title       string   `json:"job_title"`
		ApplyLink   string   `json:"job_apply_link"`
		ApplyDirect bool     `json:"job_apply_is_direct"`
		GoogleLink  string   `json:"job_google_link"`
		Description string   `json:"job_description"`
		Remote      bool     `json:"job_is_remote"`
		PostedAt    string   `json:"job_posted_at_datetime_utc"`
		PostedUnix  *float64 `json:"job_posted_at_timestamp"`
		Location    string   `json:"job_location"`
		City        string   `json:"job_city"`
		State       string   `json:"job_state"`
		Country     string   `json:"job_country"`
		MinSalary   *float64 `json:"job_min_salary"`
		MaxSalary   *float64 `json:"job_max_salary"`
		Currency    string   `json:"job_salary_currency"`
		Period      string   `json:"job_salary_period"`
		Options     []struct {
			Link   string `json:"apply_link"`
			Direct bool   `json:"is_direct"`
		} `json:"apply_options"`
		Highlights map[string][]string `json:"job_highlights"`
	} `json:"data"`
}

// jsearchDate maps "newer than" onto the periods JSearch knows.
func jsearchDate(d time.Duration) string {
	switch day := 24 * time.Hour; {
	case d <= 0:
		return "all"
	case d <= day:
		return "today"
	case d <= 3*day:
		return "3days"
	case d <= 7*day:
		return "week"
	case d <= 31*day:
		return "month"
	}
	return "all"
}

// findJSearch asks Google for Jobs, through JSearch, for a title in a city.
// The key travels in a header, which is never written anywhere.
func (c *Client) findJSearch(ctx context.Context, k Keys, q Query) ([]Posting, error) {
	query := strings.TrimSpace(q.Keywords)
	v := url.Values{}
	if where := strings.TrimSpace(q.Location); where != "" {
		query += " in " + where
		v.Set("radius", itoa(keyedRadiusKM))
	}
	v.Set("query", query)
	v.Set("page", "1")
	v.Set("num_pages", "1")
	v.Set("date_posted", jsearchDate(q.Within))
	if cc := strings.ToLower(strings.TrimSpace(q.Country)); len(cc) == 2 {
		v.Set("country", cc)
	}
	key := strings.TrimSpace(k.JSearch)
	host, path, headers := jsearchRapidHost, "/search", map[string]string{"X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"}
	if k.JSearchFrom == FromOpenWebNinja {
		host, path, headers = jsearchNinjaHost, "/jsearch/search", map[string]string{"X-API-Key": key}
	}
	shown := strings.TrimPrefix(host, "https://") + path + "?" + v.Encode()
	var res jsearchAnswer
	if err := c.keyedJSON(ctx, http.MethodGet, c.base(kindJSearch, host)+path+"?"+v.Encode(), shown, headers, nil, &res); err != nil {
		return nil, err
	}
	var out []Posting
	for _, j := range res.Data {
		title, link := plainLine(j.Title), firstNonEmpty(webURL(j.ApplyLink), webURL(j.GoogleLink))
		id := firstNonEmpty(strings.TrimSpace(j.ID), link)
		if title == "" || link == "" {
			continue
		}
		p := Posting{
			Source:      kindJSearch,
			Key:         kindJSearch + ":" + id,
			Company:     plainLine(j.Employer),
			Title:       title,
			Location:    firstNonEmpty(joinPlace(j.City, j.State, j.Country), plainLine(j.Location)),
			URL:         link,
			Description: jsearchText(j.Description, j.Highlights),
			PostedAt:    parseTime(j.PostedAt),
			Applicants:  -1,
			Logo:        LogoURL(j.EmpLogo),
			Site:        OwnSite(j.EmpSite),
		}
		if p.PostedAt.IsZero() && j.PostedUnix != nil && *j.PostedUnix > 0 {
			p.PostedAt = time.Unix(int64(*j.PostedUnix), 0)
		}
		if j.Remote {
			p.Workplace = "remote"
		} else {
			p.Workplace = firstNonEmpty(workplaceOf(p.Title), workplaceOf(p.Location))
		}
		p.Pay = payText(j.MinSalary, j.MaxSalary, j.Currency, j.Period)
		// Google lists every place to apply and marks the employer's own page.
		for _, o := range j.Options {
			if a := webURL(o.Link); o.Direct && a != "" && a != link {
				p.ApplyURL = a
				break
			}
		}
		p.NeedsDetail = len(strings.Fields(p.Description)) < 40
		out = append(out, p)
	}
	return out, nil
}

// jsearchText is a posting's text; a short one is filled out with the
// lists Google drew from it.
func jsearchText(desc string, highlights map[string][]string) string {
	blocks := []string{HTMLToText(desc)}
	if len(strings.Fields(desc)) < 60 {
		for _, name := range []string{"Qualifications", "Responsibilities", "Benefits"} {
			var items []string
			for _, it := range highlights[name] {
				if it = plainLine(it); it != "" {
					items = append(items, "- "+it)
				}
			}
			if len(items) > 0 {
				blocks = append(blocks, name+"\n"+strings.Join(items, "\n"))
			}
		}
	}
	return joinSections(blocks...)
}

// pageSize is how many results to ask for: what the caller wants, within
// what the service gives on one page.
func pageSize(want, most int) int {
	if want <= 0 || want > most {
		return most
	}
	return want
}

// keyedJSON performs one request to a service that takes a key and decodes
// its answer. shown stands for the address wherever it would be written.
func (c *Client) keyedJSON(ctx context.Context, method, addr, shown string, headers map[string]string, in, v any) error {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return fmt.Errorf("sources: %w", err)
		}
	}
	data, _, err := c.do(ctx, method, addr, acceptJSON, body, headers, shown)
	if err != nil {
		return err
	}
	return decodeJSON(shown, data, v)
}

// blockedPage tells a refusal by country (a web page saying so, from the
// service or the network in front of it) from a refused key (the service's
// own answer, which is JSON).
func blockedPage(body string) bool {
	b := strings.ToLower(strings.TrimSpace(body))
	if b == "" || strings.HasPrefix(b, "{") || strings.HasPrefix(b, "[") {
		return false
	}
	for _, w := range []string{"country", "region", "location", "geo", "not available", "unavailable", "access denied", "forbidden", "cloudflare", "blocked"} {
		if strings.Contains(b, w) {
			return true
		}
	}
	return strings.HasPrefix(b, "<")
}
