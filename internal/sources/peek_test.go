package sources

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestPeek(t *testing.T) {
	ld := `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Senior Analyst","hiringOrganization":{"@type":"Organization","name":"Acme Example"},
"jobLocation":{"@type":"Place","address":{"addressLocality":"Toronto","addressRegion":"ON"}},"description":"<p>` + strings.Repeat("Build the reports the finance team reads. ", 12) + `</p>"}</script></head><body>x</body></html>`
	plain := `<html><head><meta property="og:title" content="Payroll Lead"><meta property="og:site_name" content="Borealis"></head><body><main><div class="job-description">` + strings.Repeat("Run payroll for four provinces. ", 15) + `</div></main></body></html>`
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/jobs/1":
			w.Write([]byte(ld))
		case "/jobs/2":
			w.Write([]byte(plain))
		default:
			http.NotFound(w, r)
		}
	}), "page")
	ctx := context.Background()
	p, err := c.Peek(ctx, "https://careers.acme.example.com/jobs/1")
	if err != nil || p.Title != "Senior Analyst" || p.Company != "Acme Example" || !strings.Contains(p.Location, "Toronto") || !strings.Contains(p.Description, "finance team") {
		t.Fatalf("from the posting's own data: %+v %v", p, err)
	}
	p, err = c.Peek(ctx, "https://www.borealis.example.com/jobs/2")
	if err != nil || p.Title != "Payroll Lead" || p.Company != "Borealis" || !strings.Contains(p.Description, "payroll") {
		t.Fatalf("from the page itself: %+v %v", p, err)
	}
	if _, err := c.Peek(ctx, "http://127.0.0.1:47700/api/state"); err == nil {
		t.Error("an address on this computer is never opened")
	}
}
