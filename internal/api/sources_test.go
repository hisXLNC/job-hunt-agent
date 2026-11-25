package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"jobhunt/internal/sources"
	"jobhunt/internal/trace"
)

// A key for one of the job searches goes in and never comes out: not in
// what the pages are sent, not in an error, not in the debugging record,
// and the assistant has no call that touches one.
func TestSourceKeysGoInAndNeverComeOut(t *testing.T) {
	srv, h := newServer(t)
	status := 200
	stand := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != 200 {
			w.WriteHeader(status)
			return
		}
		w.Write([]byte(`{"results":[{"id":"7","title":"Manager","description":"Manage.","created":"2026-11-23T10:00:00Z","redirect_url":"https://www.adzuna.co.uk/land/ad/7","company":{"display_name":"Harbour Trust"},"location":{"display_name":"London"}}],
			"jobs":[{"id":8,"title":"Manager","link":"https://jooble.org/desc/8","company":"Harbour Trust","location":"London","snippet":"Manage."}]}`))
	}))
	t.Cleanup(stand.Close)
	srv.E.Src = &sources.Client{Base: map[string]string{"adzuna": stand.URL, "jooble": stand.URL, "jsearch": stand.URL}}
	secrets := []string{"adzuna-secret-9", "app-id-9", "jooble-secret-9", "rapid-secret-9"}
	clean := func(what, text string) {
		t.Helper()
		for _, s := range secrets {
			if strings.Contains(text, s) {
				t.Errorf("%s gives away %s: %s", what, s, text)
			}
		}
	}
	more := func() map[string]map[string]any {
		t.Helper()
		w := do(h, call{path: "/api/connections"})
		clean("GET /api/connections", w.Body.String())
		var v struct {
			More []map[string]any `json:"more"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil || len(v.More) != 6 {
			t.Fatalf("connections: %v %s", err, w.Body.String())
		}
		out := map[string]map[string]any{}
		for _, m := range v.More {
			out[m["id"].(string)] = m
		}
		return out
	}

	if m := more(); m["adzuna"]["has_key"] != false || m["adzuna"]["state"] != "none" || m["alerts"]["state"] != "none" {
		t.Fatalf("before any key: %v", m)
	}
	// Half of Adzuna's pair, a write without the page's marker, and a source
	// that does not exist are all turned away.
	if w := do(h, call{method: "PUT", path: "/api/sources/adzuna", marker: true, body: `{"key":"adzuna-secret-9"}`}); w.Code != 400 {
		t.Errorf("Adzuna's key without its app ID: %d %s", w.Code, w.Body)
	} else {
		clean("the refusal", w.Body.String())
	}
	if w := do(h, call{method: "PUT", path: "/api/sources/jooble", body: `{"key":"jooble-secret-9"}`}); w.Code != 403 {
		t.Errorf("a write without the marker: %d", w.Code)
	}
	if w := do(h, call{method: "PUT", path: "/api/sources/jooble", origin: "https://evil.example", marker: true, body: `{"key":"jooble-secret-9"}`}); w.Code != 403 {
		t.Errorf("another site saved a key: %d", w.Code)
	}
	if w := do(h, call{method: "PUT", path: "/api/sources/nowhere", marker: true, body: `{"key":"x"}`}); w.Code != 404 {
		t.Errorf("an unknown source: %d", w.Code)
	}
	if w := do(h, call{method: "POST", path: "/api/sources/jooble/test", marker: true}); w.Code != 400 {
		t.Errorf("a test with no key saved: %d %s", w.Code, w.Body)
	}
	for id, body := range map[string]string{"adzuna": `{"app_id":"app-id-9","key":"adzuna-secret-9","on":true}`, "jooble": `{"key":"jooble-secret-9","on":true,"limit":30}`,
		"jsearch": `{"key":"rapid-secret-9","from":"openwebninja","on":false}`} {
		w := do(h, call{method: "PUT", path: "/api/sources/" + id, marker: true, body: body})
		if w.Code != 200 {
			t.Fatalf("saving %s: %d %s", id, w.Code, w.Body)
		}
		clean("saving "+id, w.Body.String())
	}
	m := more()
	if m["adzuna"]["has_key"] != true || m["jooble"]["limit"] != float64(30) || m["jsearch"]["from"] != "openwebninja" || m["jsearch"]["state"] != "off" {
		t.Errorf("after saving: %v", m)
	}

	// The Test button says what came back, or why nothing did.
	w := do(h, call{method: "POST", path: "/api/sources/adzuna/test", marker: true})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Working: 1 posting") {
		t.Errorf("test of Adzuna: %d %s", w.Code, w.Body)
	}
	status = 403
	w = do(h, call{method: "POST", path: "/api/sources/jooble/test", marker: true})
	if w.Code != 400 || !strings.Contains(w.Body.String(), "Jooble refused the key") {
		t.Errorf("test of a refused key: %d %s", w.Code, w.Body)
	}
	clean("the failed test", w.Body.String())
	if m := more(); m["adzuna"]["state"] != "working" || m["jooble"]["state"] != "problem" {
		t.Errorf("after the tests: %v", m)
	}
	// Radar's list of sources, and everything else a page can read.
	for _, path := range []string{"/api/sources", "/api/radar", "/api/state", "/api/app", "/api/places", "/api/you", "/api/debug"} {
		w := do(h, call{path: path})
		if w.Code != 200 {
			t.Errorf("%s: %d", path, w.Code)
		}
		clean("GET "+path, w.Body.String())
	}
	if w := do(h, call{path: "/api/sources"}); !strings.Contains(w.Body.String(), `"id":"alerts"`) || !strings.Contains(w.Body.String(), `"id":"boards"`) {
		t.Errorf("the list of sources: %s", w.Body)
	}
	clean("the debugging record", strings.Join(trace.Tail(0), "\n"))

	// Removing a key.
	if w := do(h, call{method: "DELETE", path: "/api/sources/jooble", marker: true}); w.Code != 200 {
		t.Errorf("removing Jooble's key: %d %s", w.Code, w.Body)
	}
	if m := more(); m["jooble"]["has_key"] != false || m["adzuna"]["has_key"] != true {
		t.Errorf("after removing Jooble's key: %v", m)
	}

	// None of this is on the assistant's list.
	for _, tl := range tools {
		if strings.HasPrefix(tl.Pattern, "/api/sources") {
			t.Errorf("%s %s is on the assistant's list; keys are the person's to enter", tl.Method, tl.Pattern)
		}
	}
}
