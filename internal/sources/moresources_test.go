package sources

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"jobhunt/internal/trace"
)

// The answers below have the shape each service sends, cut down to two or
// three postings. Nothing here asks the real services.

const adzunaSample = `{"__CLASS__":"Adzuna::API::Response::JobSearchResults","count":2,"mean":104000.5,"results":[
 {"__CLASS__":"Adzuna::API::Response::Job","id":"4912345678","adref":"eyJhbGciOi","title":"Senior <strong>Tax</strong> Technology Manager",
  "description":"Own the indirect <strong>tax</strong> engine on SAP S/4HANA. You will lead e-invoicing and VAT automation across the group…",
  "created":"2026-11-22T14:03:11Z","redirect_url":"https://www.adzuna.ca/land/ad/4912345678?se=abc&utm_medium=api&utm_source=1a2b3c4d&v=XYZ",
  "company":{"__CLASS__":"Adzuna::API::Response::Company","display_name":"Maple Bank"},
  "location":{"__CLASS__":"Adzuna::API::Response::Location","display_name":"Toronto, Ontario","area":["Canada","Ontario","Toronto Region","Toronto"]},
  "category":{"label":"Accounting & Finance Jobs","tag":"accounting-finance-jobs"},
  "salary_min":95000,"salary_max":120000,"salary_is_predicted":"0","contract_type":"permanent","contract_time":"full_time","latitude":43.65,"longitude":-79.38},
 {"id":4912345999,"title":"Tax Analyst (Remote)","description":"Prepare returns.","created":"2026-11-22T09:00:00Z",
  "redirect_url":"https://www.adzuna.ca/land/ad/4912345999?se=def","company":{"display_name":"Polar Freight"},
  "location":{"display_name":"Mississauga, Peel region"},"salary_min":70123.5,"salary_max":70123.5,"salary_is_predicted":"1"},
 {"id":"1","title":"","redirect_url":"https://www.adzuna.ca/land/ad/1"},
 {"id":"2","title":"A link that is no web address","redirect_url":"javascript:alert(1)"}]}`

func TestAdzuna(t *testing.T) {
	var got *http.Request
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		io.WriteString(w, adzunaSample)
	}), "adzuna")
	keys := Keys{AdzunaID: "app-1", AdzunaKey: "adzuna-secret-1"}
	posts, err := c.FindKeyed(context.Background(), "adzuna", keys, Query{Keywords: "tax technology manager", Location: "Toronto", Country: "CA", Within: 26 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if got.URL.Path != "/v1/api/jobs/ca/search/1" {
		t.Errorf("path = %s", got.URL.Path)
	}
	q := got.URL.Query()
	for k, want := range map[string]string{"app_id": "app-1", "app_key": "adzuna-secret-1", "what": "tax technology manager", "where": "Toronto", "distance": "40",
		"sort_by": "date", "max_days_old": "2", "results_per_page": "50", "content-type": "application/json"} {
		if q.Get(k) != want {
			t.Errorf("%s = %q, want %q", k, q.Get(k), want)
		}
	}
	checkPostings(t, posts, []Posting{
		{Source: "adzuna", Key: "adzuna:4912345678", Company: "Maple Bank", Title: "Senior Tax Technology Manager", Location: "Toronto, Ontario",
			URL:         "https://www.adzuna.ca/land/ad/4912345678?se=abc&utm_medium=api&utm_source=1a2b3c4d&v=XYZ",
			Description: "Own the indirect tax engine on SAP S/4HANA. You will lead e-invoicing and VAT automation across the group…",
			Pay:         "CAD 95,000 to 120,000 a year", PostedAt: time.Date(2026, 11, 22, 14, 3, 11, 0, time.UTC), Applicants: -1},
		// Adzuna's own guess at the pay is left out.
		{Source: "adzuna", Key: "adzuna:4912345999", Company: "Polar Freight", Title: "Tax Analyst (Remote)", Location: "Mississauga, Peel region", Workplace: "remote",
			URL: "https://www.adzuna.ca/land/ad/4912345999?se=def", Description: "Prepare returns.", PostedAt: time.Date(2026, 11, 22, 9, 0, 0, 0, time.UTC), Applicants: -1},
	})

	// A tiny query asks for one result; no city means no reach.
	if _, err := c.FindKeyed(context.Background(), "adzuna", keys, Query{Keywords: "manager", Country: "GB", Max: 1}); err != nil {
		t.Fatal(err)
	}
	if q := got.URL.Query(); q.Get("results_per_page") != "1" || q.Has("where") || q.Has("max_days_old") || got.URL.Path != "/v1/api/jobs/gb/search/1" {
		t.Errorf("tiny query: %s %s", got.URL.Path, got.URL.RawQuery)
	}
	if _, err := c.FindKeyed(context.Background(), "adzuna", keys, Query{Keywords: "manager", Country: "AE"}); !errors.Is(err, ErrNoCountry) {
		t.Errorf("a country Adzuna has no listings for: %v", err)
	}
	if _, err := c.FindKeyed(context.Background(), "adzuna", Keys{AdzunaKey: "only-half"}, Query{Keywords: "manager", Country: "CA"}); !errors.Is(err, ErrNoKey) {
		t.Errorf("without the app ID: %v", err)
	}
}

const joobleSample = `{"totalCount":812,"jobs":[
 {"title":"<b>Tax</b> Technology Manager","location":"Toronto, ON","snippet":"&nbsp;...own our indirect <b>tax</b> engine and e-invoicing.&nbsp;...&nbsp;Hybrid, three days in the office...&nbsp;",
  "salary":"$95k - $110k","source":"workopolis.com","type":"Full-time","link":"https://jooble.org/desc/-7741234567890123456?ckey=tax&rgn=1","company":"Maple Bank",
  "updated":"2026-11-22T00:00:00.0000000","id":-7741234567890123456},
 {"title":"Old posting","location":"Toronto, ON","snippet":"","salary":"","link":"https://jooble.org/desc/55?ckey=tax","company":"Corner Diner","updated":"2026-10-01T00:00:00.0000000","id":55},
 {"title":"No link","link":"","id":56}]}`

func TestJooble(t *testing.T) {
	var path string
	var ask map[string]string
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.Method + " " + r.URL.Path
		ask = nil
		json.NewDecoder(r.Body).Decode(&ask)
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		io.WriteString(w, joobleSample)
	}), "jooble")
	posts, err := c.FindKeyed(context.Background(), "jooble", Keys{Jooble: "jooble-secret-1"}, Query{Keywords: "tax technology manager", Location: "Toronto", Within: 3 * 24 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if path != "POST /api/jooble-secret-1" {
		t.Errorf("asked %s", path)
	}
	for k, want := range map[string]string{"keywords": "tax technology manager", "location": "Toronto", "radius": "40", "page": "1", "ResultOnPage": "50", "datecreatedfrom": "2026-11-20"} {
		if ask[k] != want {
			t.Errorf("%s = %q, want %q", k, ask[k], want)
		}
	}
	// The posting from October is older than asked for and is dropped here,
	// whatever Jooble made of the date.
	checkPostings(t, posts, []Posting{{Source: "jooble", Key: "jooble:-7741234567890123456", Company: "Maple Bank", Title: "Tax Technology Manager", Location: "Toronto, ON",
		URL: "https://jooble.org/desc/-7741234567890123456?ckey=tax&rgn=1", Description: "...own our indirect tax engine and e-invoicing. ... Hybrid, three days in the office...",
		Pay: "$95k - $110k", PostedAt: time.Date(2026, 11, 22, 0, 0, 0, 0, time.UTC), Applicants: -1, NeedsDetail: true}})
}

const jsearchSample = `{"status":"OK","request_id":"0a1b2c","parameters":{"query":"tax technology manager in toronto","page":1,"num_pages":1,"date_posted":"today","country":"ca"},"data":[
 {"job_id":"aBcD123_xyz==","employer_name":"Maple Bank","employer_logo":null,"employer_website":"https://maplebank.example","job_publisher":"LinkedIn","job_employment_type":"FULLTIME",
  "job_title":"Tax Technology Manager","job_apply_link":"https://www.linkedin.com/jobs/view/tax-technology-manager-at-maple-bank-4012345678","job_apply_is_direct":false,
  "apply_options":[{"publisher":"LinkedIn","apply_link":"https://www.linkedin.com/jobs/view/tax-technology-manager-at-maple-bank-4012345678","is_direct":false},
                   {"publisher":"Maple Bank Careers","apply_link":"https://careers.maplebank.example/jobs/881","is_direct":true}],
  "job_description":"We are hiring.\n\nShort.","job_is_remote":false,"job_posted_at_timestamp":1795428000,"job_posted_at_datetime_utc":"2026-11-23T10:00:00.000Z",
  "job_location":"Toronto, ON","job_city":"Toronto","job_state":"Ontario","job_country":"CA","job_google_link":"https://www.google.com/search?q=jobs&htidocid=aBcD123",
  "job_min_salary":48,"job_max_salary":55,"job_salary_currency":"CAD","job_salary_period":"HOUR",
  "job_highlights":{"Qualifications":["Ten years in indirect tax","SAP S/4HANA"],"Responsibilities":["Own the tax engine"]}},
 {"job_id":"","employer_name":"Polar Freight","job_title":"Remote Tax Lead","job_apply_link":"","job_google_link":"https://www.google.com/search?q=jobs&htidocid=zz9",
  "job_description":"Lead.","job_is_remote":true,"job_posted_at_timestamp":1795420000,"job_posted_at_datetime_utc":null,"job_location":"Anywhere","job_city":null,"job_state":null,"job_country":null,
  "job_min_salary":null,"job_max_salary":null,"job_salary_currency":null,"job_salary_period":null,"job_highlights":{}}]}`

func TestJSearch(t *testing.T) {
	var got *http.Request
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		io.WriteString(w, jsearchSample)
	}), "jsearch")
	posts, err := c.FindKeyed(context.Background(), "jsearch", Keys{JSearch: "rapid-secret-1"}, Query{Keywords: "tax technology manager", Location: "Toronto", Country: "CA", Within: 2 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if got.URL.Path != "/search" || got.Header.Get("X-RapidAPI-Key") != "rapid-secret-1" || got.Header.Get("X-RapidAPI-Host") != "jsearch.p.rapidapi.com" {
		t.Errorf("asked %s with %v", got.URL.Path, got.Header)
	}
	if strings.Contains(got.URL.String(), "rapid-secret-1") {
		t.Error("the key belongs in the header, not the address")
	}
	q := got.URL.Query()
	for k, want := range map[string]string{"query": "tax technology manager in Toronto", "date_posted": "today", "country": "ca", "page": "1", "num_pages": "1", "radius": "40"} {
		if q.Get(k) != want {
			t.Errorf("%s = %q, want %q", k, q.Get(k), want)
		}
	}
	checkPostings(t, posts, []Posting{
		{Source: "jsearch", Key: "jsearch:aBcD123_xyz==", Company: "Maple Bank", Title: "Tax Technology Manager", Location: "Toronto, Ontario, CA",
			URL: "https://www.linkedin.com/jobs/view/tax-technology-manager-at-maple-bank-4012345678", ApplyURL: "https://careers.maplebank.example/jobs/881",
			Description: "We are hiring.\n\nShort.\n\nQualifications\n- Ten years in indirect tax\n- SAP S/4HANA\n\nResponsibilities\n- Own the tax engine",
			Pay:         "CAD 48 to 55 an hour", PostedAt: time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC), Applicants: -1, NeedsDetail: true},
		{Source: "jsearch", Key: "jsearch:https://www.google.com/search?q=jobs&htidocid=zz9", Company: "Polar Freight", Title: "Remote Tax Lead", Location: "Anywhere", Workplace: "remote",
			URL: "https://www.google.com/search?q=jobs&htidocid=zz9", Description: "Lead.", PostedAt: time.Unix(1795420000, 0), Applicants: -1, NeedsDetail: true},
	})

	// Three days back on a full search; a key from OpenWeb Ninja goes to its own door.
	if _, err := c.FindKeyed(context.Background(), "jsearch", Keys{JSearch: "ninja-secret-1", JSearchFrom: FromOpenWebNinja}, Query{Keywords: "tax manager", Within: 60 * time.Hour}); err != nil {
		t.Fatal(err)
	}
	if got.URL.Path != "/jsearch/search" || got.Header.Get("X-API-Key") != "ninja-secret-1" || got.Header.Get("X-RapidAPI-Key") != "" {
		t.Errorf("OpenWeb Ninja: %s %v", got.URL.Path, got.Header)
	}
	if q := got.URL.Query(); q.Get("date_posted") != "3days" || q.Get("query") != "tax manager" || q.Has("radius") {
		t.Errorf("OpenWeb Ninja query: %s", got.URL.RawQuery)
	}
}

// What each service says when it will not answer becomes one of three plain
// errors, and no key is ever written down: not in the error, not in the
// debugging record.
func TestKeyedRefusalsAndSecrets(t *testing.T) {
	status := 401
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/moved" {
			t.Error("a request carrying a key followed a redirect")
		}
		if status == 302 {
			w.Header().Set("Location", "/moved")
		}
		w.WriteHeader(status)
	}), "adzuna", "jooble", "jsearch")
	keys := Keys{AdzunaID: "app-id-77", AdzunaKey: "adzuna-secret-77", Jooble: "jooble-secret-77", JSearch: "rapid-secret-77"}
	q := Query{Keywords: "manager", Country: "CA", Location: "Toronto"}
	var said []string
	for _, tc := range []struct {
		source string
		status int
		want   error
	}{
		{"adzuna", 401, ErrKeyRefused}, {"adzuna", 429, ErrOutOfRequests}, {"jooble", 403, ErrKeyRefused}, {"jooble", 404, ErrKeyRefused},
		{"jsearch", 403, ErrKeyRefused}, {"jsearch", 429, ErrOutOfRequests}, {"adzuna", 500, nil}, {"jsearch", 302, nil}, {"jooble", 302, nil},
	} {
		status = tc.status
		_, err := c.FindKeyed(context.Background(), tc.source, keys, q)
		if err == nil {
			t.Fatalf("%s %d: no error", tc.source, tc.status)
		}
		if tc.want != nil && !errors.Is(err, tc.want) {
			t.Errorf("%s %d: %v, want %v", tc.source, tc.status, err, tc.want)
		}
		if tc.want == nil {
			wantStatus(t, err, tc.status)
		}
		said = append(said, err.Error())
	}
	// A service that cannot be reached at all.
	dead := &Client{Base: map[string]string{"jooble": "http://127.0.0.1:1", "adzuna": "http://127.0.0.1:1"}}
	for _, source := range []string{"jooble", "adzuna"} {
		_, err := dead.FindKeyed(context.Background(), source, keys, q)
		if err == nil {
			t.Fatal("an unreachable service gave no error")
		}
		said = append(said, err.Error())
	}
	said = append(said, trace.Tail(200)...)
	for _, line := range said {
		for _, secret := range []string{"adzuna-secret-77", "jooble-secret-77", "rapid-secret-77", "app-id-77"} {
			if strings.Contains(line, secret) {
				t.Errorf("a key was written down: %s", line)
			}
		}
	}
	var traced bool
	for _, line := range trace.Tail(200) {
		traced = traced || strings.Contains(line, "jooble.org/api/[key]")
	}
	if !traced {
		t.Error("the request to Jooble is missing from the debugging record")
	}
}
