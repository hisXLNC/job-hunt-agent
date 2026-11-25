package sources

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestLinkedInSearchRequest(t *testing.T) {
	tests := []struct {
		name string
		q    Query
		want url.Values
	}{
		{
			name: "every filter",
			q:    Query{Keywords: "tax manager", Location: "Toronto, Ontario, Canada", Within: 24 * time.Hour, Remote: true, FewApplicants: true, Start: 25},
			want: url.Values{
				"keywords": {"tax manager"}, "location": {"Toronto, Ontario, Canada"},
				"f_TPR": {"r86400"}, "f_WT": {"2"}, "f_EA": {"true"}, "start": {"25"}, "sortBy": {"DD"},
			},
		},
		{
			name: "no filters",
			q:    Query{Keywords: "accountant"},
			want: url.Values{"keywords": {"accountant"}, "start": {"0"}, "sortBy": {"DD"}},
		},
		{
			name: "a negative start is the first page",
			q:    Query{Location: "Canada", Within: 90 * time.Minute, Start: -5},
			want: url.Values{"location": {"Canada"}, "f_TPR": {"r5400"}, "start": {"0"}, "sortBy": {"DD"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/jobs-guest/jobs/api/seeMoreJobPostings/search" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL)
				}
				if got := r.URL.Query(); got.Encode() != tt.want.Encode() {
					t.Errorf("query = %q, want %q", got.Encode(), tt.want.Encode())
				}
				// LinkedIn answers the page after the last one with an empty body.
			}), "linkedin")
			got, err := c.Search(context.Background(), tt.q)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != 0 {
				t.Errorf("got %d postings from an empty page", len(got))
			}
		})
	}
}

func TestLinkedInSearch(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(fixture(t, "linkedin_search.html"))
	}), "linkedin")

	got, err := c.Search(context.Background(), Query{Keywords: "tax", Location: "Toronto, Ontario, Canada"})
	if err != nil {
		t.Fatal(err)
	}
	want := []Posting{ // the repeated card and the sign-in promo are left out
		{
			Source:      "linkedin",
			Key:         "linkedin:4012345678",
			Company:     "Maple Leaf Advisory",
			Title:       "Senior Manager, Tax",
			Location:    "Toronto, Ontario, Canada",
			URL:         "https://www.linkedin.com/jobs/view/4012345678", // no tracking parameters
			PostedAt:    testNow.Add(-18 * time.Minute),
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "linkedin",
			Key:         "linkedin:4012345999",
			Company:     "Northern Trustco",
			Title:       "Manager, Tax & Estate Planning",
			Location:    "Greater Toronto Area, Canada (Hybrid)",
			Workplace:   "hybrid",
			URL:         "https://www.linkedin.com/jobs/view/4012345999",
			Pay:         "CA$95,000.00 - CA$120,000.00",
			PostedAt:    time.Date(2026, 11, 22, 0, 0, 0, 0, time.Local), // "1 day ago": the date is all there is
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "linkedin",
			Key:         "linkedin:4012346111",
			Company:     "Prairie Books Inc.",
			Title:       "Staff Accountant",
			Location:    "Canada",
			URL:         "https://www.linkedin.com/jobs/view/4012346111",
			PostedAt:    testNow.Add(-3 * time.Hour),
			Applicants:  -1,
			NeedsDetail: true,
		},
		{
			Source:      "linkedin",
			Key:         "linkedin:4012347222", // no data-entity-urn: the id comes from the link
			Company:     "Lakeshore CPA",
			Title:       "Junior Analyst",
			Location:    "Mississauga, Ontario, Canada",
			URL:         "https://www.linkedin.com/jobs/view/4012347222",
			PostedAt:    testNow.AddDate(0, 0, -14), // no datetime: estimated from "2 weeks ago"
			Applicants:  -1,
			NeedsDetail: true,
		},
	}
	checkPostings(t, got, want)

	// With the remote filter on, every result is a remote job.
	got, err = c.Search(context.Background(), Query{Keywords: "tax", Remote: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range got {
		if p.Workplace != "remote" {
			t.Errorf("%s: Workplace = %q, want remote", p.Key, p.Workplace)
		}
	}
}

// LinkedIn throttles with 429 or 999. Both come back as *HTTPError after a
// single request, so the caller can back off.
func TestLinkedInThrottled(t *testing.T) {
	for _, status := range []int{429, 999, 403} {
		requests := 0
		c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			w.WriteHeader(status)
		}), "linkedin")

		_, err := c.Search(context.Background(), Query{Keywords: "tax"})
		wantStatus(t, err, status)

		p := Posting{Source: "linkedin", Key: "linkedin:4012345678", NeedsDetail: true}
		wantStatus(t, c.Detail(context.Background(), &p), status)
		if !p.NeedsDetail {
			t.Errorf("status %d: a throttled Detail cleared NeedsDetail", status)
		}
		if requests != 2 {
			t.Errorf("status %d: %d requests, want 2 (one each, no retries)", status, requests)
		}
	}
}

func TestLinkedInDetail(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/jobs-guest/jobs/api/jobPosting/4012345678":
			w.Write(fixture(t, "linkedin_detail.html"))
		case "/jobs-guest/jobs/api/jobPosting/4012346111":
			w.Write(fixture(t, "linkedin_detail_early.html"))
		case "/jobs-guest/jobs/api/jobPosting/4012340000":
			w.Write([]byte(`<html><body><h1>Sign in to view this job</h1></body></html>`))
		default:
			http.NotFound(w, r)
		}
	}), "linkedin")
	ctx := context.Background()
	searched := time.Date(2026, 11, 23, 0, 0, 0, 0, time.Local)

	t.Run("off-site apply, pay, many applicants", func(t *testing.T) {
		p := Posting{
			Source: "linkedin", Key: "linkedin:4012345678", Company: "Maple Leaf Advisory", Title: "Senior Manager, Tax",
			Location: "Toronto, Ontario, Canada", URL: "https://www.linkedin.com/jobs/view/4012345678",
			PostedAt: searched, Applicants: -1, NeedsDetail: true,
		}
		if err := c.Detail(ctx, &p); err != nil {
			t.Fatal(err)
		}
		checkPosting(t, p, Posting{
			Source:   "linkedin",
			Key:      "linkedin:4012345678",
			Company:  "Maple Leaf Advisory",
			Title:    "Senior Manager, Tax",
			Location: "Toronto, Ontario, Canada",
			URL:      "https://www.linkedin.com/jobs/view/4012345678",
			ApplyURL: "https://mapleleafadvisory.example/careers/123?source=LinkedIn",
			Description: "About the role\n\n" +
				"Maple Leaf Advisory helps owner-managed businesses with tax & estate planning.\n\n" +
				"What you will do\n" +
				"- Review corporate and personal returns\n" +
				"- Advise on reorganizations\nincluding section 85 rollovers\n\n" +
				"We thank all applicants.",
			Pay:        "CA$120,000.00/yr - CA$150,000.00/yr",
			PostedAt:   testNow.Add(-2 * time.Hour), // "2 hours ago" is sharper than the search's date
			Applicants: 201,
		})
	})

	t.Run("early applicant, applying on LinkedIn", func(t *testing.T) {
		p := Posting{Source: "linkedin", Key: "linkedin:4012346111", PostedAt: searched, Applicants: -1, NeedsDetail: true}
		if err := c.Detail(ctx, &p); err != nil {
			t.Fatal(err)
		}
		checkPosting(t, p, Posting{
			Source:      "linkedin",
			Key:         "linkedin:4012346111",
			Company:     "Prairie Books Inc.", // a posting known only by its id gets its headline too
			Title:       "Staff Accountant",
			Location:    "Canada",
			URL:         "https://www.linkedin.com/jobs/view/4012346111",
			Description: "Keep the books for a growing retailer.\n\nFull cycle A/P & A/R.",
			PostedAt:    searched, // "3 days ago" is vaguer than what we had
			Applicants:  24,       // "Be among the first 25"
		})
	})

	t.Run("a page without a description is an error", func(t *testing.T) {
		p := Posting{Source: "linkedin", Key: "linkedin:4012340000", Applicants: -1, NeedsDetail: true}
		err := c.Detail(ctx, &p)
		if err == nil || !strings.Contains(err.Error(), "no description") {
			t.Fatalf("error = %v, want a no-description error", err)
		}
		if !p.NeedsDetail {
			t.Error("NeedsDetail was cleared")
		}
	})

	t.Run("gone", func(t *testing.T) {
		p := Posting{Source: "linkedin", Key: "linkedin:1", NeedsDetail: true}
		wantStatus(t, c.Detail(ctx, &p), http.StatusNotFound)
	})
}

func TestParseApplicants(t *testing.T) {
	tests := []struct {
		in   string
		want int
		ok   bool
	}{
		{"47 applicants", 47, true},
		{"1 applicant", 1, true},
		{"Over 200 applicants", 201, true},
		{"Over 100 applicants", 101, true},
		{"Over 100 people clicked apply", 101, true},
		{"1,024 applicants", 1024, true},
		{"Be among the first 25 applicants", 24, true},
		{"", 0, false},
		{"Actively hiring", 0, false},
		{"applicants", 0, false},
		{"12 people clicked apply", 12, true},
		{"Promoted by hirer", 0, false},
	}
	for _, tt := range tests {
		if got, ok := ParseApplicants(tt.in); got != tt.want || ok != tt.ok {
			t.Errorf("ParseApplicants(%q) = %d, %v; want %d, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestLinkedInApplyURL(t *testing.T) {
	for in, want := range map[string]string{
		`"https://www.linkedin.com/jobs/view/externalApply/4012345678?url=https%3A%2F%2Fcompany.com%2Fcareers%2F123&urlHash=abc"`:     "https://company.com/careers/123",
		`"https://www.linkedin.com/jobs/view/externalApply/4012345678?url=https%3A%2F%2Fcompany.com%2Fcareers%2F123&amp;urlHash=abc"`: "https://company.com/careers/123",
		`"https://www.linkedin.com/jobs/view/externalApply/1?url=javascript%3Aalert(1)&urlHash=abc"`:                                  "",
		`"https://www.linkedin.com/jobs/view/4012345678"`:                                                                             "",
		`"https://boards.greenhouse.io/acme/jobs/1"`:                                                                                  "https://boards.greenhouse.io/acme/jobs/1",
		`https://www.linkedin.com/jobs/view/externalApply/1?url=https%3A%2F%2Fcompany.com%2Fapply`:                                    "https://company.com/apply",
		``:          "",
		`"`:         "",
		`"%zz"`:     "",
		`not a url`: "",
	} {
		if got := linkedInApplyURL(in); got != want {
			t.Errorf("linkedInApplyURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseAgo(t *testing.T) {
	tests := []struct {
		in      string
		want    time.Time
		precise bool
	}{
		{"18 minutes ago", testNow.Add(-18 * time.Minute), true},
		{"1 minute ago", testNow.Add(-time.Minute), true},
		{"3 hours ago", testNow.Add(-3 * time.Hour), true},
		{"Just now", testNow, true},
		{"1 day ago", testNow.AddDate(0, 0, -1), false},
		{"2 weeks ago", testNow.AddDate(0, 0, -14), false},
		{"1 month ago", testNow.AddDate(0, 0, -30), false},
		{"", time.Time{}, false},
		{"Reposted", time.Time{}, false},
		{"999999999999999999999 hours ago", time.Time{}, false},
	}
	for _, tt := range tests {
		got, precise := parseAgo(tt.in, testNow)
		if !got.Equal(tt.want) || precise != tt.precise {
			t.Errorf("parseAgo(%q) = %v, %v; want %v, %v", tt.in, got, precise, tt.want, tt.precise)
		}
	}
}

// Fragments LinkedIn never sends must still not panic or invent postings.
func TestLinkedInMalformed(t *testing.T) {
	for _, in := range []string{
		"",
		"<li>",
		"<li><div data-entity-urn=",
		`<li><div data-entity-urn="urn:li:jobPosting:abc"></div></li>`,
		`<li><div data-entity-urn="urn:li:jobPosting:"><a href="/jobs/view/not-a-number"></a></div></li>`,
		`<li><time datetime="garbage">eventually</time></li>`,
		strings.Repeat("<li><div>", 2000),
		"<<<<>>>>&&&&",
	} {
		if got := parseLinkedInSearch(in, testNow); len(got) != 0 {
			t.Errorf("parseLinkedInSearch(%.40q) invented %d postings", in, len(got))
		}
		var p Posting
		applyLinkedInDetail(in, &p, testNow)
	}

	// A card with only an id still comes through, with its other fields empty.
	got := parseLinkedInSearch(`<div data-entity-urn="urn:li:jobPosting:42"></div>`, testNow)
	if len(got) != 1 || got[0].Key != "linkedin:42" || got[0].Title != "" || !got[0].PostedAt.IsZero() {
		t.Errorf("bare card = %+v", got)
	}
}
