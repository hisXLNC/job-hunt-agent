package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"jobhunt/internal/store"
)

// elsewhere stands in for Job Bank, FreeHire and a recruiter's site.
type elsewhere struct {
	mu         sync.Mutex
	hits       map[string]int
	siteStatus int
}

func (w *elsewhere) count(k string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.hits[k]
}

func otherPlaces(t *testing.T, e *Engine) *elsewhere {
	t.Helper()
	w := &elsewhere{hits: map[string]int{}, siteStatus: 200}
	long := strings.Repeat("Own the indirect tax engine on SAP S/4HANA with Vertex and e-invoicing. ", 8)
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.mu.Lock()
		defer w.mu.Unlock()
		switch {
		case r.URL.Path == "/jobsearch/jobsearch":
			w.hits["jobbank"]++
			if r.URL.Query().Get("fprov") != "ON" {
				t.Errorf("Job Bank was not asked for Ontario: %s", r.URL.RawQuery)
			}
			rw.Write([]byte(`<span class="found" id="results-count">2</span>
<article id="article-44640615"><a href="/jobsearch/jobposting/44640615?source=searchresults" class="resultJobItem"><h3 class="title"><span class="noctitle"> tax technology manager </span></h3>
 <ul class="list-unstyled"><li class="date">November 20, 2026</li><li class="business">Maple Accounting Ltd.</li><li class="location"><span class="wb-inv">Location</span> Toronto (ON)</li></ul></a></article>
<article id="article-44650001"><a href="/jobsearch/jobposting/44650001?source=searchresults" class="resultJobItem"><h3 class="title"><span class="noctitle">line cook</span></h3>
 <ul class="list-unstyled"><li class="date">November 20, 2026</li><li class="business">Corner Diner</li><li class="location"><span class="wb-inv">Location</span> Toronto (ON)</li></ul></a></article>`))
		case strings.HasPrefix(r.URL.Path, "/jobsearch/jobposting/"):
			rw.Write([]byte(`<div typeof="JobPosting"><h1 property="title">tax technology manager</h1><div class="job-posting-detail-requirements"><h3>Responsibilities</h3><p>` + long + `</p></div></div>`))
		case r.URL.Path == "/api/v1/agent/jobs/search":
			w.hits["freehire"]++
			if r.URL.Query().Get("countries") != "CA" {
				t.Errorf("FreeHire was not asked for Canada: %s", r.URL.RawQuery)
			}
			json.NewEncoder(rw).Encode(map[string]any{"data": []map[string]any{{"title": "Senior Tax Technology Manager", "company": "Polar Freight", "url": "https://polar.example/jobs/1?utm_source=x",
				"public_slug": "polar-1", "location": "Toronto, ON, Canada", "description": long, "posted_at": time.Now().Add(-3 * time.Hour).Format(time.RFC3339)}}})
		case r.URL.Path == "/jobs":
			w.hits["site"]++
			if w.siteStatus != 200 {
				rw.WriteHeader(w.siteStatus)
				return
			}
			if r.URL.Query().Get("q") == "" {
				t.Errorf("the site was not asked for a title: %s", r.URL.RawQuery)
			}
			rw.Write([]byte(`<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Tax Technology Manager (contract)","url":"/jobs/770011-tax-technology-manager",
				"identifier":{"@type":"PropertyValue","value":"770011"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Toronto","addressRegion":"ON"}},"description":"` + long + `"}</script></head><body></body></html>`))
		case r.URL.Path == "/careers":
			w.hits["careers"]++
			rw.Write([]byte(`<html><body><ul><li><a href="/careers/jobs/55012-tax-technology-manager">Tax Technology Manager</a></li><li><a href="/careers/jobs/55013-payroll-clerk">Payroll Clerk</a></li></ul></body></html>`))
		default:
			rw.Write([]byte(`<html><body><main><div class="job-description"><p>` + long + `</p></div></main></body></html>`))
		}
	}))
	t.Cleanup(srv.Close)
	for _, k := range []string{"jobbank", "freehire", "page"} {
		e.Src.Base[k] = srv.URL
	}
	return w
}

func TestOtherPlacesAreSearched(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	w := otherPlaces(t, e)
	ctx := context.Background()

	e.S.Set(placesKey, placeSet{}) // as on a real start: everything on
	view := e.Places()
	var names []string
	for _, p := range view.Places {
		names = append(names, p.ID)
		if !p.On {
			t.Errorf("%s should start switched on", p.ID)
		}
	}
	if strings.Join(names, ",") != "linkedin,jobbank,freehire" || len(view.Suggested) == 0 {
		t.Fatalf("places = %v, suggested %d", names, len(view.Suggested))
	}

	// A site added by its address is tried at once.
	if _, _, _, err := e.AddSite(ctx, "", "", "http://127.0.0.1:9/jobs?q={title}"); err == nil {
		t.Fatal("an address on this computer was accepted")
	}
	place, found, note, err := e.AddSite(ctx, "", "Northstar Recruiting", "recruiter.example/jobs?q={title}")
	if err != nil || found != 1 || note != "" || !place.Mine {
		t.Fatalf("AddSite: %+v found=%d note=%q err=%v", place, found, note, err)
	}
	if _, _, _, err := e.AddSite(ctx, "", "Northstar Recruiting", "recruiter.example/jobs?q={title}"); err == nil {
		t.Fatal("the same site was added twice")
	}

	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	for key, company := range map[string]string{"jobbank:44640615": "Maple Accounting Ltd.", "freehire:polar-1": "Polar Freight"} {
		id, closed, ok := e.S.SeenRole(key)
		if !ok || closed != "" {
			t.Errorf("%s was not kept (ok=%v closed=%q)", key, ok, closed)
			continue
		}
		if r, _ := e.S.Role(id); r.Company != company || r.Fit < 0 || !strings.Contains(r.Description, "indirect tax engine") {
			t.Errorf("%s: %+v", key, r)
		}
	}
	// A posting with no employer named belongs to the recruiter whose site showed it.
	roles, _, _ := e.S.Roles(store.RoleFilter{Closed: []string{"*"}, Limit: 100})
	var fromSite *store.Role
	for i := range roles {
		if roles[i].Company == "Northstar Recruiting" {
			fromSite = &roles[i]
		}
	}
	if fromSite == nil || fromSite.Closed != "" || !strings.HasPrefix(fromSite.URL, "https://recruiter.example/jobs/770011") {
		t.Fatalf("the recruiter's posting: %+v", fromSite)
	}
	if _, closed, ok := e.S.SeenRole("jobbank:44650001"); !ok || closed != "screened" {
		t.Fatalf("a loose match from Job Bank was not set aside by the title rules: ok=%v closed=%q", ok, closed)
	}
	view = e.Places()
	for _, p := range view.Places {
		if (p.ID == "jobbank" || p.ID == "freehire" || p.Mine) && (p.Seen == 0 || p.Note != "") {
			t.Errorf("%s: seen %d, note %q", p.ID, p.Seen, p.Note)
		}
	}

	// A quick check leaves the slower places alone.
	jb, fh, site := w.count("jobbank"), w.count("freehire"), w.count("site")
	e.Search(ctx, "fast")
	if w.count("jobbank") != jb || w.count("freehire") != fh || w.count("site") != site {
		t.Fatal("a quick check asked the slow places")
	}

	// Switched off means not asked.
	if err := e.SetPlaceOn("freehire", false); err != nil {
		t.Fatal(err)
	}
	// A site that says slow down is left alone until later, and says so.
	w.mu.Lock()
	w.siteStatus = 429
	w.mu.Unlock()
	e.Search(ctx, "full")
	if w.count("freehire") != fh {
		t.Fatal("FreeHire was asked while switched off")
	}
	afterBlock := w.count("site")
	if afterBlock != site+1 {
		t.Fatalf("the site was asked %d more times after it said slow down", afterBlock-site)
	}
	var resting Place
	for _, p := range e.Places().Places {
		if p.Mine {
			resting = p
		}
	}
	if !strings.Contains(resting.Note, "slow down") || resting.RestUntil <= e.Now().Unix() {
		t.Fatalf("the rest is not shown: %+v", resting)
	}
	e.Search(ctx, "full")
	if w.count("site") != afterBlock {
		t.Fatal("a resting site was asked again")
	}
	// Switching it on again is asking to try again.
	e.SetPlaceOn(resting.ID, true)
	w.mu.Lock()
	w.siteStatus = 200
	w.mu.Unlock()
	e.Search(ctx, "full")
	if w.count("site") == afterBlock {
		t.Fatal("the site was not tried again")
	}
	if err := e.RemoveSite(resting.ID); err != nil || len(e.Places().Places) != 3 {
		t.Fatalf("remove: %v", err)
	}
	if e.SetPlaceOn("nowhere", true) == nil || e.RemoveSite("nowhere") == nil {
		t.Fatal("an unknown place was accepted")
	}

	// An employer on no job system: its own careers page is read as it stands.
	co, _, _ := e.S.UpsertCompany(store.Company{Name: "Harbour Works", State: "following"})
	if err := e.SetBoardFromURL(co.ID, "https://harbour.example/careers"); err != nil {
		t.Fatal(err)
	}
	if co, _ = e.S.Company(co.ID); co.BoardKind != "page" || co.BoardToken != "https://harbour.example/careers" {
		t.Fatalf("board = %+v", co)
	}
	if err := e.SetBoardFromURL(co.ID, "https://harbour.example/nothing-here"); err == nil {
		t.Fatal("a page with no postings was accepted as a job board")
	}
	e.Search(ctx, "full")
	if _, closed, ok := e.S.SeenRole("page:harbour.example:55012"); !ok || closed != "" {
		t.Fatalf("the careers page's matching role: ok=%v closed=%q", ok, closed)
	}
	if _, closed, ok := e.S.SeenRole("page:harbour.example:55013"); !ok || closed != "screened" {
		t.Fatalf("the careers page's other role: ok=%v closed=%q", ok, closed)
	}
}
