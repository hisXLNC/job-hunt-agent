package sources

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadLinkFromAPostingsOwnPage(t *testing.T) {
	body := strings.Repeat("You will own the indirect tax engine and work with finance teams across the group. ", 6)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/jobs/42":
			w.Write([]byte(`<html><head><title>Careers</title><script type="application/ld+json">{"@type":"JobPosting","title":"Tax Technology Manager","hiringOrganization":{"name":"Acme Corp"},
				"jobLocation":{"address":{"addressLocality":"Toronto","addressRegion":"ON"}},"description":"<p>` + body + `</p>"}</script></head><body>x</body></html>`))
		case "/plain":
			w.Write([]byte(`<html><head><meta property="og:title" content="Senior VAT Analyst | Borealis"><meta property="og:site_name" content="Borealis Energy"></head>
				<body><main><h1>Senior VAT Analyst</h1><div class="job-description"><p>` + body + `</p></div></main></body></html>`))
		case "/empty":
			w.Write([]byte(`<html><head><title>Sign in</title></head><body>Sign in to continue</body></html>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c := &Client{Base: map[string]string{"page": srv.URL}}
	ctx := context.Background()

	p, err := c.ReadLink(ctx, "https://careers.acme.example/jobs/42")
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "Tax Technology Manager" || p.Company != "Acme Corp" || !strings.Contains(p.Location, "Toronto") || !strings.Contains(p.Description, "indirect tax engine") || p.URL != "https://careers.acme.example/jobs/42" {
		t.Fatalf("from the page's own description: %+v", p)
	}
	p, err = c.ReadLink(ctx, "https://jobs.borealis.example/plain")
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "Senior VAT Analyst" || p.Company != "Borealis Energy" || !strings.Contains(p.Description, "finance teams") {
		t.Fatalf("from what the page calls itself: %+v", p)
	}
	if _, err := c.ReadLink(ctx, "https://jobs.borealis.example/empty"); err == nil {
		t.Error("a page with no posting on it was read as one")
	}
	for _, bad := range []string{"http://127.0.0.1/jobs/1", "http://192.168.1.5/x", "file:///etc/passwd", "javascript:alert(1)"} {
		if _, err := c.ReadLink(ctx, bad); err == nil {
			t.Errorf("opened %s", bad)
		}
	}
}
