package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestGreenhouseList(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/boards/acme/jobs" || r.URL.RawQuery != "content=true" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		w.Write(fixture(t, "greenhouse_jobs.json"))
	}), "greenhouse")

	got, err := c.List(context.Background(), Board{Kind: "greenhouse", Token: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	checkPostings(t, got, []Posting{
		{
			Source:   "greenhouse",
			Key:      "greenhouse:acme:4012345",
			Company:  "Acme Advisory",
			Title:    "Senior Manager, Tax",
			Location: "Toronto, ON",
			URL:      "https://boards.greenhouse.io/acme/jobs/4012345",
			Description: "Acme & Co is hiring.\n\n" +
				"What you will do\n\n" +
				"- Prepare corporate tax returns\n- Review T2 filings\n\n" +
				"Salary: $120,000 – $150,000",
			PostedAt:   time.Date(2026, 11, 19, 14, 30, 0, 0, time.UTC), // first_published wins over updated_at
			Applicants: -1,
		},
		{
			Source:      "greenhouse",
			Key:         "greenhouse:acme:4012346",
			Title:       "Tax Analyst",
			Location:    "Toronto, Ontario, Canada · Vancouver", // from the offices, the location being empty
			URL:         "https://careers.acme.example/jobs?gh_jid=4012346",
			Description: "Support the tax team.", // the script is gone
			PostedAt:    time.Date(2026, 11, 18, 21, 45, 0, 0, time.UTC),
			Applicants:  -1,
		},
		{
			Source:     "greenhouse",
			Key:        "greenhouse:acme:4012347",
			Title:      "Bookkeeper",
			Location:   "Remote - Canada",
			Workplace:  "remote",
			URL:        "https://boards.greenhouse.io/acme/jobs/4012347", // not the javascript: link
			Applicants: -1,
		},
	})
}

func TestLeverList(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v0/postings/acme" || r.URL.RawQuery != "mode=json" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		w.Write(fixture(t, "lever_postings.json"))
	}), "lever")

	got, err := c.List(context.Background(), Board{Kind: "lever", Token: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	checkPostings(t, got, []Posting{
		{
			Source:    "lever",
			Key:       "lever:acme:5ac21346-8e0c-4494-8e7a-3eb92ff77902",
			Title:     "Senior Tax Manager",
			Location:  "Toronto · Remote - Canada",
			Workplace: "hybrid",
			URL:       "https://jobs.lever.co/acme/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
			ApplyURL:  "https://jobs.lever.co/acme/5ac21346-8e0c-4494-8e7a-3eb92ff77902/apply",
			Description: "Acme is a tax advisory firm.\n\nWe are growing our Toronto team.\n\nJoin us.\n\n" +
				"Requirements\n- CPA designation\n- 5+ years in corporate tax\n\n" +
				"Nice to have\n- Experience with SR&ED claims\n\n" +
				"Acme is an equal opportunity employer.",
			Pay:        "CAD 100,000 – 140,000 per year",
			PostedAt:   time.UnixMilli(1763640000000),
			Applicants: -1,
		},
		{
			Source:      "lever",
			Key:         "lever:acme:0b6c8f6e-1f0a-4f55-9d2b-6f1f3f1f2a10",
			Title:       "Bookkeeper",
			Location:    "Remote - Canada",
			Workplace:   "remote", // "unspecified", so read from the location
			URL:         "https://jobs.lever.co/acme/0b6c8f6e-1f0a-4f55-9d2b-6f1f3f1f2a10",
			Description: "We need a bookkeeper.\n\nPart time.", // converted from the HTML
			Pay:         "CAD 32.50 – 40 per hour",
			Applicants:  -1,
		},
	})
}

func TestAshbyList(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/posting-api/job-board/acme" || r.URL.RawQuery != "includeCompensation=true" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		w.Write(fixture(t, "ashby_board.json"))
	}), "ashby")

	got, err := c.List(context.Background(), Board{Kind: "ashby", Token: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	checkPostings(t, got, []Posting{ // the unlisted one is left out
		{
			Source:      "ashby",
			Key:         "ashby:acme:7c1d0a52-3f3e-4b0e-9a3c-1b2d3e4f5a6b",
			Title:       "Senior Accountant",
			Location:    "Toronto · Remote",
			Workplace:   "hybrid",
			URL:         "https://jobs.ashbyhq.com/acme/7c1d0a52-3f3e-4b0e-9a3c-1b2d3e4f5a6b",
			ApplyURL:    "https://jobs.ashbyhq.com/acme/7c1d0a52-3f3e-4b0e-9a3c-1b2d3e4f5a6b/application",
			Description: "Own month-end close.\n\n- Reconcile accounts\n- Prepare HST returns",
			Pay:         "CA$120K – CA$150K",
			PostedAt:    time.Date(2026, 11, 20, 15, 4, 5, 0, time.UTC),
			Applicants:  -1,
		},
		{
			Source:      "ashby",
			Key:         "ashby:acme:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
			Title:       "Payroll Specialist",
			Location:    "Canada",
			Workplace:   "remote", // isRemote
			URL:         "https://jobs.ashbyhq.com/acme/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
			Description: "Run payroll for 300 people.\n\nKnow the CRA rules.",
			PostedAt:    time.Date(2026, 11, 21, 9, 0, 0, 0, time.UTC),
			Applicants:  -1,
		},
	})
}

func TestSmartRecruiters(t *testing.T) {
	var mu sync.Mutex
	var offsets []string
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/companies/Acme/postings":
			if r.URL.Query().Get("limit") != "100" {
				t.Errorf("limit = %q, want 100", r.URL.Query().Get("limit"))
			}
			mu.Lock()
			offsets = append(offsets, r.URL.Query().Get("offset"))
			mu.Unlock()
			switch r.URL.Query().Get("offset") {
			case "0":
				w.Write(fixture(t, "smartrecruiters_page1.json"))
			case "2":
				w.Write(fixture(t, "smartrecruiters_page2.json"))
			default:
				http.NotFound(w, r)
			}
		case "/v1/companies/Acme/postings/744000012345":
			w.Write(fixture(t, "smartrecruiters_detail.json"))
		default:
			http.NotFound(w, r)
		}
	}), "smartrecruiters")
	ctx := context.Background()

	got, err := c.List(ctx, Board{Kind: "smartrecruiters", Token: "Acme"})
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(offsets) != "[0 2]" {
		t.Errorf("paged with offsets %v, want [0 2]", offsets)
	}
	checkPostings(t, got, []Posting{
		{
			Source:      "smartrecruiters",
			Key:         "smartrecruiters:Acme:744000012345",
			Company:     "Acme",
			Title:       "Audit Senior",
			Location:    "Toronto, ON, Canada",
			Workplace:   "hybrid",
			URL:         "https://jobs.smartrecruiters.com/Acme/744000012345",
			PostedAt:    time.Date(2026, 11, 20, 14, 0, 0, 0, time.UTC),
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "smartrecruiters",
			Key:         "smartrecruiters:Acme:744000012346", // a numeric id reads the same
			Company:     "Acme",
			Title:       "Controller",
			Location:    "Montreal, QC, CA",
			Workplace:   "onsite",
			URL:         "https://jobs.smartrecruiters.com/Acme/744000012346",
			PostedAt:    time.Date(2026, 11, 18, 9, 30, 0, 0, time.UTC),
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "smartrecruiters",
			Key:         "smartrecruiters:Acme:744000012347",
			Company:     "Acme",
			Title:       "Tax Associate",
			Location:    "Calgary, AB, Canada",
			Workplace:   "remote",
			URL:         "https://jobs.smartrecruiters.com/Acme/744000012347",
			PostedAt:    time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC),
			Applicants:  -1,
			NeedsDetail: true,
		},
	})

	// Detail works on a copy rebuilt from storage: only Source, Key and URL matter.
	p := Posting{Source: got[0].Source, Key: got[0].Key, URL: got[0].URL, Applicants: -1, NeedsDetail: true}
	if err := c.Detail(ctx, &p); err != nil {
		t.Fatal(err)
	}
	checkPosting(t, p, Posting{
		Source:    "smartrecruiters",
		Key:       "smartrecruiters:Acme:744000012345",
		Company:   "Acme",
		Title:     "Audit Senior",
		Location:  "Toronto, ON, Canada",
		Workplace: "hybrid",
		URL:       "https://jobs.smartrecruiters.com/Acme/744000012345-audit-senior",
		ApplyURL:  "https://jobs.smartrecruiters.com/Acme/744000012345-audit-senior?oga=true",
		Description: "Company Description\n\nAcme is a national accounting firm.\n\n" +
			"Job Description\n\nYou will:\n\n- Lead audits\n- Coach juniors\n\n" +
			"Qualifications\n\n- CPA",
		PostedAt:   time.Date(2026, 11, 20, 14, 0, 0, 0, time.UTC),
		Applicants: -1,
	})

	// A posting that has since been taken down is a 404 and stays undetailed.
	gone := got[1]
	wantStatus(t, c.Detail(ctx, &gone), http.StatusNotFound)
	if !gone.NeedsDetail || gone.Description != "" {
		t.Errorf("a failed Detail changed the posting: %+v", gone)
	}
}

// A board that keeps saying there is more must not be paged forever.
func TestSmartRecruitersStopsOnEmptyPage(t *testing.T) {
	requests := 0
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Query().Get("offset") == "0" {
			w.Write([]byte(`{"totalFound": 500, "content": [{"id": "1", "name": "One"}, {"id": "1", "name": "One again"}]}`))
			return
		}
		w.Write([]byte(`{"totalFound": 500, "content": []}`))
	}), "smartrecruiters")
	got, err := c.List(context.Background(), Board{Kind: "smartrecruiters", Token: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || requests != 2 {
		t.Errorf("got %d postings in %d requests, want 1 in 2", len(got), requests)
	}
}

// workdayTenant serves a made-up tenant with n postings, twenty to a page.
// Like some real tenants it reports the total on the first page only.
type workdayTenant struct {
	t        *testing.T
	n        int
	mu       sync.Mutex
	requests []workdayQuery
}

func (wt *workdayTenant) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	t := wt.t
	if r.Method != http.MethodPost || r.URL.Path != "/wday/cxs/td/TD_Bank_Careers/jobs" {
		t.Errorf("unexpected request %s %s", r.Method, r.URL)
	}
	if got := r.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := r.Header.Get("Accept"); got != "application/json" {
		t.Errorf("Accept = %q", got)
	}
	raw, _ := io.ReadAll(r.Body)
	var q workdayQuery
	if err := json.Unmarshal(raw, &q); err != nil {
		t.Errorf("request body %s: %v", raw, err)
	}
	var shape map[string]json.RawMessage
	_ = json.Unmarshal(raw, &shape)
	if string(shape["appliedFacets"]) != "{}" {
		t.Errorf("appliedFacets = %s, want {}", shape["appliedFacets"])
	}
	wt.mu.Lock()
	wt.requests = append(wt.requests, q)
	wt.mu.Unlock()

	type posting struct {
		Title         string `json:"title"`
		ExternalPath  string `json:"externalPath"`
		LocationsText string `json:"locationsText"`
		PostedOn      string `json:"postedOn"`
	}
	page := struct {
		Total       int       `json:"total"`
		JobPostings []posting `json:"jobPostings"`
	}{JobPostings: []posting{}}
	if q.Offset == 0 {
		page.Total = wt.n
	}
	for i := q.Offset; i < wt.n && i < q.Offset+q.Limit; i++ {
		page.JobPostings = append(page.JobPostings, posting{
			Title:         "Role " + strconv.Itoa(i),
			ExternalPath:  "/job/Toronto-ON/Role-" + strconv.Itoa(i) + "_R-" + strconv.Itoa(1000+i),
			LocationsText: "Toronto, ON",
			PostedOn:      "Posted " + strconv.Itoa(i+2) + " Days Ago",
		})
	}
	json.NewEncoder(w).Encode(page)
}

func (wt *workdayTenant) offsets() []int {
	wt.mu.Lock()
	defer wt.mu.Unlock()
	var out []int
	for _, q := range wt.requests {
		out = append(out, q.Offset)
	}
	return out
}

func TestWorkdayPaging(t *testing.T) {
	board := Board{Kind: "workday", Token: "td.wd3/TD_Bank_Careers"}
	tests := []struct {
		name        string
		postings    int // on the tenant
		cap         int // Client.workdayMax; 0 = default
		search      string
		max         int // ListWorkday's max; -1 = call List instead
		want        int
		wantOffsets string
	}{
		{name: "one short page", postings: 5, max: -1, want: 5, wantOffsets: "[0]"},
		{name: "exactly one page", postings: 20, max: -1, want: 20, wantOffsets: "[0]"},
		{name: "three pages, total only on the first", postings: 45, max: -1, want: 45, wantOffsets: "[0 20 40]"},
		{name: "empty board", postings: 0, max: -1, want: 0, wantOffsets: "[0]"},
		{name: "List stops at its cap", postings: 100, cap: 30, max: -1, want: 30, wantOffsets: "[0 20]"},
		{name: "List's default cap is 400", postings: 450, max: -1, want: 400, wantOffsets: "[0 20 40 60 80 100 120 140 160 180 200 220 240 260 280 300 320 340 360 380]"},
		{name: "ListWorkday with its own max", postings: 100, max: 10, search: "tax", want: 10, wantOffsets: "[0]"},
		{name: "ListWorkday max 0 means the default", postings: 45, max: 0, want: 45, wantOffsets: "[0 20 40]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenant := &workdayTenant{t: t, n: tt.postings}
			c := serve(t, tenant, "workday")
			c.workdayMax = tt.cap

			var got []Posting
			var err error
			if tt.max < 0 {
				got, err = c.List(context.Background(), board)
			} else {
				got, err = c.ListWorkday(context.Background(), board, tt.search, tt.max)
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != tt.want {
				t.Errorf("got %d postings, want %d", len(got), tt.want)
			}
			if offsets := fmt.Sprint(tenant.offsets()); offsets != tt.wantOffsets {
				t.Errorf("offsets = %s, want %s", offsets, tt.wantOffsets)
			}
			keys := map[string]bool{}
			for _, p := range got {
				keys[p.Key] = true
			}
			if len(keys) != len(got) {
				t.Errorf("%d postings but only %d distinct keys", len(got), len(keys))
			}
			for _, q := range tenant.requests {
				if q.Limit != 20 || q.SearchText != tt.search {
					t.Errorf("request %+v: want limit 20 and searchText %q", q, tt.search)
				}
			}
		})
	}
}

// A tenant that never reports a total is walked until it runs dry.
func TestWorkdayWithoutTotal(t *testing.T) {
	requests := 0
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var q workdayQuery
		json.NewDecoder(r.Body).Decode(&q)
		if q.Offset >= 4 {
			w.Write([]byte(`{"total":0,"jobPostings":[]}`))
			return
		}
		fmt.Fprintf(w, `{"total":0,"jobPostings":[{"title":"A","externalPath":"/job/a_R-%d"},{"title":"B","externalPath":"/job/b_R-%d"}]}`, q.Offset, q.Offset+1)
	}), "workday")
	got, err := c.List(context.Background(), Board{Kind: "workday", Token: "td.wd3/TD_Bank_Careers"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 || requests != 3 {
		t.Errorf("got %d postings in %d requests, want 4 in 3", len(got), requests)
	}
}

func TestWorkdayListAndDetail(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/wday/cxs/td/TD_Bank_Careers/jobs":
			w.Write(fixture(t, "workday_jobs.json"))
		case r.Method == http.MethodGet && r.URL.Path == "/wday/cxs/td/TD_Bank_Careers/job/Toronto-ON/Senior-Manager-Tax_R-12345":
			w.Write(fixture(t, "workday_detail.json"))
		default:
			http.NotFound(w, r)
		}
	}), "workday")
	ctx := context.Background()
	const site = "https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers"

	got, err := c.List(ctx, Board{Kind: "workday", Token: "td.wd3/TD_Bank_Careers"})
	if err != nil {
		t.Fatal(err)
	}
	checkPostings(t, got, []Posting{ // the posting without a path is left out
		{
			Source:      "workday",
			Key:         "workday:td.wd3/TD_Bank_Careers:R-12345",
			Title:       "Senior Manager, Tax",
			Location:    "Toronto, ON",
			URL:         site + "/job/Toronto-ON/Senior-Manager-Tax_R-12345",
			PostedAt:    testNow,
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "workday",
			Key:         "workday:td.wd3/TD_Bank_Careers:R-12399-1",
			Title:       "Tax Analyst",
			Location:    "2 Locations",
			Workplace:   "remote",
			URL:         site + "/job/Remote---Canada/Tax-Analyst_R-12399-1",
			PostedAt:    testNow.AddDate(0, 0, -3),
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "workday",
			Key:         "workday:td.wd3/TD_Bank_Careers:R-11001",
			Title:       "Director, Internal Audit",
			Location:    "Montreal, QC",
			URL:         site + "/job/Montreal-QC/Director-Internal-Audit_R-11001",
			PostedAt:    testNow.AddDate(0, 0, -31), // "30+ Days Ago"
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "workday",
			Key:         "workday:td.wd3/TD_Bank_Careers:/job/Toronto-ON/accounting-coop", // no "_": the whole path
			Title:       "Accounting Co-op",
			Location:    "Toronto, ON",
			URL:         site + "/job/Toronto-ON/accounting-coop",
			PostedAt:    testNow.Add(-24 * time.Hour),
			Applicants:  -1,
			NeedsDetail: true,
		},
	})

	// Detail works on a copy rebuilt from storage: only Source, Key and URL matter.
	p := Posting{Source: got[0].Source, Key: got[0].Key, URL: got[0].URL, Title: got[0].Title, Applicants: -1, NeedsDetail: true}
	if err := c.Detail(ctx, &p); err != nil {
		t.Fatal(err)
	}
	checkPosting(t, p, Posting{
		Source:    "workday",
		Key:       "workday:td.wd3/TD_Bank_Careers:R-12345",
		Company:   "TD Bank",
		Title:     "Senior Manager, Tax",
		Location:  "Toronto, ON · Remote",
		Workplace: "hybrid",
		URL:       site + "/job/Toronto-ON/Senior-Manager-Tax_R-12345",
		Description: "Department Overview\n\nThe Tax group advises the bank.\n\n" +
			"- Lead a team of six\n- Own the quarterly provision\n\n" +
			"Pay: $110,000 – $150,000 CAD",
		PostedAt:   time.Date(2026, 11, 20, 0, 0, 0, 0, time.Local), // startDate beats "Posted Today"
		Applicants: -1,
	})

	// Calling it again does nothing; a posting that is gone is a 404.
	if err := c.Detail(ctx, &p); err != nil {
		t.Errorf("second Detail = %v", err)
	}
	gone := got[2]
	wantStatus(t, c.Detail(ctx, &gone), http.StatusNotFound)
	if !gone.NeedsDetail {
		t.Error("a failed Detail cleared NeedsDetail")
	}
}

func TestWorkdayPostedAt(t *testing.T) {
	day := 24 * time.Hour
	for in, want := range map[string]time.Time{
		"Posted Today":                         testNow,
		"posted today":                         testNow,
		"Posted Yesterday":                     testNow.Add(-day),
		"Posted 1 Day Ago":                     testNow.Add(-day),
		"Posted 3 Days Ago":                    testNow.Add(-3 * day),
		"Posted 30+ Days Ago":                  testNow.Add(-31 * day),
		"":                                     {},
		"Recently":                             {},
		"Posted 99999999999999999999 Days Ago": {},
	} {
		if got := workdayPostedAt(in, testNow); !got.Equal(want) {
			t.Errorf("workdayPostedAt(%q) = %v, want %v", in, got, want)
		}
	}
}
