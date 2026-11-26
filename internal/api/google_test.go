package api

import (
	"strings"
	"testing"
)

// The assistant may look at, test and sync Google Calendar; the client
// secret is never its to set and leaving Google waits for the button. A
// phone has none of it, and nothing that works as a key comes back.
func TestGoogleCalendarCallsStayWithThePerson(t *testing.T) {
	for _, c := range tools {
		if c.Pattern == "/api/google" && c.Method == "PUT" {
			t.Errorf("%s %s is on the assistant's list", c.Method, c.Pattern)
		}
		if (c.Pattern == "/api/google" && c.Method == "DELETE" || c.Pattern == "/api/google/signout") && c.Class != mustAsk {
			t.Errorf("%s %s is made without the person's button", c.Method, c.Pattern)
		}
	}
	for _, c := range [][2]string{{"GET", "/api/google"}, {"PUT", "/api/google"}, {"POST", "/api/google/signin"}, {"POST", "/api/google/sync"}, {"GET", "/api/google/lookalikes"}, {"POST", "/api/google/lookalikes/abc/link"}} {
		if phoneMay(c[0], c[1]) {
			t.Errorf("a phone may make %s %s", c[0], c[1])
		}
	}

	// The entry an interview lands on is the person's own calendar: never shown to Claude.
	var seen strings.Builder
	got := prune(map[string]any{"talk": map[string]any{"title": "Interview"}, "clash": map[string]any{"title": "Private entry"}}, 500, 50, &seen)
	if _, ok := got.(map[string]any)["clash"]; ok || strings.Contains(seen.String(), "Private entry") {
		t.Error("the assistant would see a calendar entry")
	}

	_, h := newServer(t)
	const id, secret = "1234567890-fakeclient.apps.googleusercontent.com", "GOCSPX-fake-secret-value"
	if w := do(h, call{method: "PUT", path: "/api/google", marker: true, body: `{"client_id":"nope","client_secret":"x"}`}); w.Code != 400 {
		t.Errorf("a wrong client ID: %d", w.Code)
	}
	w := do(h, call{method: "PUT", path: "/api/google", marker: true, body: `{"client_id":"` + id + `","client_secret":"` + secret + `"}`})
	if w.Code != 200 || strings.Contains(w.Body.String(), secret) || !strings.Contains(w.Body.String(), `"has_client":true`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	for _, p := range []string{"/api/google", "/api/connections", "/api/owncal"} {
		if body := do(h, call{path: p}).Body.String(); strings.Contains(body, secret) {
			t.Errorf("%s gives the client secret away", p)
		}
	}
	// A page on another site can't start a sign-in.
	if w := do(h, call{method: "POST", path: "/api/google/signin"}); w.Code != 403 {
		t.Errorf("a sign-in without the marker got %d", w.Code)
	}
	if w := do(h, call{method: "POST", path: "/api/google/signin", origin: "https://example.com", marker: true}); w.Code != 403 {
		t.Errorf("a sign-in from another site got %d", w.Code)
	}
	w = do(h, call{method: "POST", path: "/api/google/signin", marker: true})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "accounts.google.com") || strings.Contains(w.Body.String(), secret) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := do(h, call{method: "POST", path: "/api/google/sync", marker: true}); w.Code != 400 {
		t.Errorf("syncing before signing in got %d", w.Code)
	}
	if w := do(h, call{method: "DELETE", path: "/api/google", marker: true}); w.Code != 200 || !strings.Contains(w.Body.String(), `"has_client":false`) {
		t.Errorf("forgetting: %d %s", w.Code, w.Body)
	}
}
