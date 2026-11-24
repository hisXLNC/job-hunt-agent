package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"jobhunt/internal/engine"
	"jobhunt/internal/store"
)

const testPort = 47700

func newServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	e := engine.New(s, t.TempDir())
	t.Cleanup(e.Stop)
	if err := e.SetLLM(engine.LLMSettings{Engine: "demo"}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{E: e, S: s, Port: testPort, Web: fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}}
	return srv, srv.Handler()
}

type call struct {
	method, path, host, origin, key, body, site string
	marker                                      bool
}

func do(h http.Handler, c call) *httptest.ResponseRecorder {
	if c.method == "" {
		c.method = "GET"
	}
	r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
	r.Host = "127.0.0.1:47700"
	if c.host != "" {
		r.Host = c.host
	}
	if c.origin != "" {
		r.Header.Set("Origin", c.origin)
	}
	if c.key != "" {
		r.Header.Set("X-JobHunt-Ext", c.key)
	}
	if c.marker {
		r.Header.Set("X-JobHunt", "1")
	}
	if c.site != "" {
		r.Header.Set("Sec-Fetch-Site", c.site)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestOnlyThisComputersPagesGetIn(t *testing.T) {
	_, h := newServer(t)
	cases := []struct {
		name string
		c    call
		want int
	}{
		{"own page reads", call{path: "/api/state"}, 200},
		{"own page reads, with its origin", call{path: "/api/state", origin: "http://127.0.0.1:47700"}, 200},
		{"a name pointed at this computer", call{path: "/api/state", host: "evil.example:47700"}, 403},
		{"another site reads", call{path: "/api/state", origin: "https://evil.example"}, 403},
		{"another site changes something", call{method: "POST", path: "/api/pause", origin: "https://evil.example", marker: true}, 403},
		{"a plain form post, no marker", call{method: "POST", path: "/api/pause", body: "{}"}, 403},
		{"own page changes something", call{method: "POST", path: "/api/pause", body: `{"paused":true}`, marker: true}, 200},
		{"own page reaching the extension's routes", call{path: "/api/ext/next"}, 403},
		{"an extension reaching the app's routes", call{path: "/api/state", origin: "chrome-extension://" + strings.Repeat("a", 32), key: strings.Repeat("k", 40)}, 403},
		{"an image tag on another site pointed here", call{path: "/api/roles", site: "cross-site"}, 403},
		{"a page on another port of this computer", call{path: "/api/roles", site: "same-site"}, 403},
		{"own page, as the browser marks it", call{path: "/api/roles", site: "same-origin"}, 200},
		{"the page itself", call{path: "/"}, 200},
	}
	for _, c := range cases {
		if got := do(h, c.c).Code; got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
	if csp := do(h, call{path: "/"}).Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("the page has no content policy: %q", csp)
	}
}

func TestExtensionNeedsApproval(t *testing.T) {
	srv, h := newServer(t)
	origin := "chrome-extension://" + strings.Repeat("b", 32)
	key, other := strings.Repeat("k", 40), strings.Repeat("z", 40)

	if got := do(h, call{path: "/api/ext/next", origin: origin, key: key}).Code; got != 403 {
		t.Fatalf("before approval: got %d, want 403", got)
	}
	if got := do(h, call{path: "/api/ext/next", origin: origin}).Code; got != 403 {
		t.Fatalf("without a key: got %d, want 403", got)
	}
	// Nothing is waiting until the panel says hello.
	if got := do(h, call{method: "POST", path: "/api/ext/pair", marker: true}).Code; got != 400 {
		t.Fatalf("approving nothing: got %d, want 400", got)
	}
	w := do(h, call{method: "POST", path: "/api/ext/hello", origin: origin, key: key, body: "{}"})
	if w.Code != 403 || !strings.Contains(w.Body.String(), `"pair":"pending"`) {
		t.Fatalf("hello before approval: %d %s", w.Code, w.Body)
	}
	// The app shows the same code the panel works out from its key.
	var conn struct {
		Pending string `json:"ext_pending"`
	}
	json.Unmarshal(do(h, call{path: "/api/connections"}).Body.Bytes(), &conn)
	if want := strings.ToUpper(hashKey(key)[:6]); conn.Pending != want {
		t.Fatalf("code shown %q, want %q", conn.Pending, want)
	}
	// Another site cannot approve it.
	if got := do(h, call{method: "POST", path: "/api/ext/pair", origin: "https://evil.example", marker: true}).Code; got != 403 {
		t.Fatalf("another site approving: got %d", got)
	}
	if got := do(h, call{method: "POST", path: "/api/ext/pair", marker: true}).Code; got != 200 {
		t.Fatalf("approving: got %d", got)
	}
	if srv.ext().KeyHash != hashKey(key) {
		t.Fatal("the key was not remembered")
	}
	// Approved: works with or without the browser naming where it came from.
	for _, c := range []call{{path: "/api/ext/next", origin: origin, key: key}, {path: "/api/ext/next", key: key}, {method: "POST", path: "/api/ext/hello", origin: origin, key: key, body: "{}"}} {
		if got := do(h, c).Code; got != 200 {
			t.Errorf("approved %s %s: got %d", c.method, c.path, got)
		}
	}
	// A different extension with its own key stays out, and still cannot reach the app.
	if got := do(h, call{path: "/api/ext/next", origin: "chrome-extension://" + strings.Repeat("c", 32), key: other}).Code; got != 403 {
		t.Errorf("another extension: got %d", got)
	}
	if got := do(h, call{path: "/api/state", key: key}).Code; got != 403 {
		t.Errorf("approved extension reading the app's routes: got %d", got)
	}
	// The key never comes back out.
	if body := do(h, call{path: "/api/connections"}).Body.String(); strings.Contains(body, hashKey(key)) || strings.Contains(body, key) {
		t.Error("the connections answer gives the key away")
	}
	do(h, call{method: "POST", path: "/api/ext/unpair", marker: true})
	if got := do(h, call{path: "/api/ext/next", origin: origin, key: key}).Code; got != 403 {
		t.Errorf("after disconnecting: got %d", got)
	}
}

func TestEmptyListsOnAFreshStart(t *testing.T) {
	_, h := newServer(t)
	for _, p := range []string{"/api/roles", "/api/people", "/api/mail", "/api/talks", "/api/you", "/api/radar", "/api/today", "/api/progress", "/api/board", "/api/connections", "/api/app", "/api/arriving", "/api/activity"} {
		w := do(h, call{path: p})
		if w.Code != 200 {
			t.Errorf("%s: %d %s", p, w.Code, w.Body)
			continue
		}
		if strings.Contains(w.Body.String(), ":null") && p != "/api/arriving" && p != "/api/today" {
			t.Logf("%s still sends null somewhere: %.300s", p, w.Body)
		}
	}
}
