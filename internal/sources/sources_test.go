package sources

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// testNow is "now" for every test that turns "3 days ago" into a time.
var testNow = time.Date(2026, 11, 23, 15, 0, 0, 0, time.UTC)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// serve starts a test server and returns a client whose given systems all
// point at it.
func serve(t *testing.T, h http.Handler, kinds ...string) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := &Client{Base: map[string]string{}, now: func() time.Time { return testNow }}
	for _, k := range kinds {
		c.Base[k] = srv.URL
	}
	return c
}

// checkPosting compares two postings field by field, times by instant.
func checkPosting(t *testing.T, got, want Posting) {
	t.Helper()
	if !got.PostedAt.Equal(want.PostedAt) {
		t.Errorf("%s: PostedAt = %v, want %v", want.Key, got.PostedAt, want.PostedAt)
	}
	got.PostedAt, want.PostedAt = time.Time{}, time.Time{}
	if got != want {
		t.Errorf("posting mismatch\n got: %+v\nwant: %+v", got, want)
	}
}

func checkPostings(t *testing.T, got, want []Posting) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d postings, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		checkPosting(t, got[i], want[i])
	}
}

func wantStatus(t *testing.T, err error, status int) {
	t.Helper()
	var he *HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("error = %v, want *HTTPError with status %d", err, status)
	}
	if he.Status != status {
		t.Fatalf("status = %d, want %d", he.Status, status)
	}
}

func TestListErrors(t *testing.T) {
	boards := []Board{
		{Kind: "greenhouse", Token: "acme"},
		{Kind: "lever", Token: "acme"},
		{Kind: "ashby", Token: "acme"},
		{Kind: "smartrecruiters", Token: "acme"},
		{Kind: "workday", Token: "acme.wd3/Acme_Careers"},
	}
	answers := []struct {
		name   string
		status int // 0 = answer 200 with a body that is not JSON
	}{
		{"gone", http.StatusNotFound},
		{"blocked", http.StatusForbidden},
		{"rate limited", http.StatusTooManyRequests},
		{"server error", http.StatusInternalServerError},
		{"not json", 0},
	}
	for _, b := range boards {
		for _, a := range answers {
			t.Run(b.Kind+"/"+a.name, func(t *testing.T) {
				var requests atomic.Int32
				c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests.Add(1)
					if a.status == 0 {
						w.Write([]byte("<html><body>Please sign in</body></html>"))
						return
					}
					http.Error(w, `{"error":"nope"}`, a.status)
				}), b.Kind)

				got, err := c.List(context.Background(), b)
				if err == nil {
					t.Fatalf("no error, got %d postings", len(got))
				}
				if a.status != 0 {
					wantStatus(t, err, a.status)
					if !strings.Contains(err.Error(), "HTTP") {
						t.Errorf("error text %q does not mention the status", err)
					}
				}
				if n := requests.Load(); n != 1 {
					t.Errorf("%d requests, want exactly 1 (no retries)", n)
				}
			})
		}
	}
}

func TestListBadBoards(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request to %s", r.URL)
	}), "greenhouse", "workday")
	for _, b := range []Board{
		{},
		{Kind: "greenhouse"},
		{Kind: "greenhouse", Token: "  "},
		{Kind: "monster", Token: "acme"},
		{Kind: "workday", Token: "acme"},
		{Kind: "workday", Token: "acme.wd3"},
		{Kind: "workday", Token: "evil.example.com/x.wd3/site"},
		{Kind: "workday", Token: "acme.wd3/a/b"},
	} {
		if _, err := c.List(context.Background(), b); err == nil {
			t.Errorf("List(%+v) gave no error", b)
		}
	}
	if _, err := c.ListWorkday(context.Background(), Board{Kind: "lever", Token: "acme"}, "", 0); err == nil {
		t.Error("ListWorkday accepted a lever board")
	}
}

func TestRequestHeaders(t *testing.T) {
	for _, ua := range []string{"", "jobhunt-test/1.0"} {
		var got http.Header
		c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got = r.Header.Clone()
			w.Write([]byte(`{"jobs":[]}`))
		}), "greenhouse")
		c.UA = ua
		if _, err := c.List(context.Background(), Board{Kind: "greenhouse", Token: "acme"}); err != nil {
			t.Fatal(err)
		}
		wantUA := ua
		if wantUA == "" {
			wantUA = defaultUA
		}
		if got.Get("User-Agent") != wantUA {
			t.Errorf("User-Agent = %q, want %q", got.Get("User-Agent"), wantUA)
		}
		if got.Get("Accept-Language") != "en-CA,en;q=0.9" {
			t.Errorf("Accept-Language = %q", got.Get("Accept-Language"))
		}
		if got.Get("Accept") != "application/json" {
			t.Errorf("Accept = %q", got.Get("Accept"))
		}
	}
}

func TestContextCancelled(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jobs":[]}`))
	}), "greenhouse", "linkedin")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := c.List(ctx, Board{Kind: "greenhouse", Token: "acme"}); !errors.Is(err, context.Canceled) {
		t.Errorf("List error = %v, want context.Canceled", err)
	}
	if _, err := c.Search(ctx, Query{Keywords: "tax"}); !errors.Is(err, context.Canceled) {
		t.Errorf("Search error = %v, want context.Canceled", err)
	}
	if _, err := c.Detect(ctx, "Acme", ""); !errors.Is(err, context.Canceled) {
		t.Errorf("Detect error = %v, want context.Canceled", err)
	}
}

// A listing that is waiting between two pages stops as soon as its context does.
func TestPauseHonoursContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(fixture(t, "smartrecruiters_page1.json"))
		cancel() // while the client is about to pause before page 2
	}), "smartrecruiters")
	c.pageDelay = time.Hour

	start := time.Now()
	_, err := c.List(ctx, Board{Kind: "smartrecruiters", Token: "acme"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("List kept waiting after its context was cancelled")
	}
}

func TestPause(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name  string
		c     Client
		least time.Duration
		most  time.Duration
	}{
		{"test server: none", Client{Base: map[string]string{"workday": "http://127.0.0.1:1"}}, 0, 200 * time.Millisecond},
		{"switched off", Client{pageDelay: -1}, 0, 200 * time.Millisecond},
		{"explicit", Client{pageDelay: 30 * time.Millisecond, Base: map[string]string{"workday": "http://127.0.0.1:1"}}, 30 * time.Millisecond, 5 * time.Second},
		{"real host: default", Client{}, defaultPageDelay, 5 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start := time.Now()
			if err := tt.c.pause(ctx, "workday"); err != nil {
				t.Fatal(err)
			}
			if d := time.Since(start); d < tt.least || d > tt.most {
				t.Errorf("paused %v, want between %v and %v", d, tt.least, tt.most)
			}
		})
	}
}

func TestBodyCap(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chunk := []byte(strings.Repeat(" ", 1<<20))
		w.Write([]byte(`{"jobs":[`))
		for i := 0; i <= maxBody>>20; i++ {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
		w.Write([]byte(`]}`))
	}), "greenhouse")
	_, err := c.List(context.Background(), Board{Kind: "greenhouse", Token: "acme"})
	if err == nil || !strings.Contains(err.Error(), "larger than") {
		t.Fatalf("error = %v, want a too-large error", err)
	}
}

func TestDetailNoOp(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request to %s", r.URL)
	}), "greenhouse", "linkedin", "workday", "smartrecruiters")
	ctx := context.Background()

	if err := c.Detail(ctx, nil); err != nil {
		t.Errorf("Detail(nil) = %v", err)
	}
	p := Posting{Source: "greenhouse", Key: "greenhouse:acme:1", Description: "already here"}
	if err := c.Detail(ctx, &p); err != nil || p.Description != "already here" {
		t.Errorf("Detail on a complete posting: err = %v, posting = %+v", err, p)
	}

	// Postings that claim to need detail but cannot be located are errors, not requests.
	for _, p := range []Posting{
		{Source: "greenhouse", Key: "greenhouse:acme:1", NeedsDetail: true},
		{Source: "linkedin", Key: "linkedin:../../etc/passwd", NeedsDetail: true},
		{Source: "linkedin", Key: "", NeedsDetail: true},
		{Source: "workday", Key: "workday:td.wd3/Site", NeedsDetail: true},
		{Source: "workday", Key: "workday:td.wd3/Site:R-1", URL: "https://elsewhere.example/x", NeedsDetail: true},
		{Source: "workday", Key: "workday:not a token:R-1", URL: "https://td.wd3.myworkdayjobs.com/en-US/Site/job/x_R-1", NeedsDetail: true},
		{Source: "smartrecruiters", Key: "lever:acme:1", NeedsDetail: true},
		{Source: "smartrecruiters", Key: "smartrecruiters:acme", NeedsDetail: true},
	} {
		if err := c.Detail(ctx, &p); err == nil {
			t.Errorf("Detail(%+v) gave no error", p)
		}
		if !p.NeedsDetail {
			t.Errorf("Detail(%+v) cleared NeedsDetail without fetching anything", p)
		}
	}
}

func TestHelpers(t *testing.T) {
	t.Run("workplaceOf", func(t *testing.T) {
		for in, want := range map[string]string{
			"":                         "",
			"Toronto, ON":              "",
			"unspecified":              "",
			"Remote":                   "remote",
			"Remote - Canada":          "remote",
			"Fully Remote":             "remote",
			"hybrid":                   "hybrid",
			"Hybrid Remote":            "hybrid",
			"Toronto (Hybrid)":         "hybrid",
			"on-site":                  "onsite",
			"OnSite":                   "onsite",
			"On Site":                  "onsite",
			"In-Office":                "onsite",
			"Fremont, CA":              "",
			"Premoteville":             "",
			"Remote or Toronto onsite": "remote",
		} {
			if got := workplaceOf(in); got != want {
				t.Errorf("workplaceOf(%q) = %q, want %q", in, got, want)
			}
		}
	})
	t.Run("parseTime", func(t *testing.T) {
		for in, want := range map[string]time.Time{
			"2026-11-20T10:00:00-05:00":     time.Date(2026, 11, 20, 15, 0, 0, 0, time.UTC),
			"2026-11-20T15:04:05.000+00:00": time.Date(2026, 11, 20, 15, 4, 5, 0, time.UTC),
			"2026-11-20T14:00:00.000Z":      time.Date(2026, 11, 20, 14, 0, 0, 0, time.UTC),
			"2026-11-20T14:00:00.000+0000":  time.Date(2026, 11, 20, 14, 0, 0, 0, time.UTC),
			"2026-11-20":                    time.Date(2026, 11, 20, 0, 0, 0, 0, time.Local),
			"":                              {},
			"yesterday":                     {},
			"2026-13-45":                    {},
		} {
			if got := parseTime(in); !got.Equal(want) {
				t.Errorf("parseTime(%q) = %v, want %v", in, got, want)
			}
		}
	})
	t.Run("joinLocations", func(t *testing.T) {
		if got := joinLocations(" Toronto ", "", "Remote", "toronto", "New   York"); got != "Toronto · Remote · New York" {
			t.Errorf("joinLocations = %q", got)
		}
	})
	t.Run("webURL", func(t *testing.T) {
		for in, want := range map[string]string{
			"https://example.com/a?b=c": "https://example.com/a?b=c",
			"http://example.com":        "http://example.com",
			"javascript:alert(1)":       "",
			"file:///etc/passwd":        "",
			"/relative":                 "",
			"":                          "",
			"https://":                  "",
		} {
			if got := webURL(in); got != want {
				t.Errorf("webURL(%q) = %q, want %q", in, got, want)
			}
		}
	})
	t.Run("formatAmount", func(t *testing.T) {
		for in, want := range map[float64]string{
			0: "0", 999: "999", 1000: "1,000", 140000: "140,000", 1234567: "1,234,567", 32.5: "32.50", 1234.567: "1,234.57",
		} {
			if got := formatAmount(in); got != want {
				t.Errorf("formatAmount(%v) = %q, want %q", in, got, want)
			}
		}
	})
}
