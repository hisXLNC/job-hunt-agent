package engine

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Saving an Apify token only checks it (free); the person's Test runs the
// scraper for real, and a source that answered says Working.
func TestApifyTestRunsARealSearch(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	var mu sync.Mutex
	runs, checks := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer apify-token-1" {
			w.WriteHeader(401)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.URL.Path == "/v2/users/me":
			checks++
			io.WriteString(w, `{"data":{"id":"u1"}}`)
		case r.Method == "POST" && strings.HasPrefix(r.URL.Path, "/v2/acts/"):
			runs++
			io.WriteString(w, `{"data":{"id":"run1","status":"RUNNING","defaultDatasetId":"ds1"}}`)
		case r.URL.Path == "/v2/actor-runs/run1":
			io.WriteString(w, `{"data":{"id":"run1","status":"SUCCEEDED","defaultDatasetId":"ds1"}}`)
		case r.URL.Path == "/v2/datasets/ds1/items":
			io.WriteString(w, `[{"title":"Tax Technology Manager","link":"https://ca.linkedin.com/jobs/view/4012345678","companyName":"Maple Bank","location":"Toronto, Ontario, Canada","descriptionText":"Own the tax engine.","postedAt":"2026-11-25"}]`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	e.Src.Base["apify"] = srv.URL
	ctx := context.Background()

	if _, err := e.SetSource(ctx, "apify", SourceKeyInput{Key: "apify-token-1", On: on(true)}); err != nil {
		t.Fatal(err)
	}
	if runs != 0 || checks != 1 {
		t.Fatalf("saving ran the scraper %d times and checked the token %d times", runs, checks)
	}
	n, err := e.TestSource(ctx, "apify")
	if err != nil || n != 1 || runs != 1 {
		t.Fatalf("Test: %d postings, %v, %d runs", n, err, runs)
	}
	for _, m := range e.MoreSources() {
		if m.ID == "apify" && m.State != "working" {
			t.Fatalf("after a Test that found postings, LinkedIn through Apify is %q (%s)", m.State, m.Note)
		}
	}
}
