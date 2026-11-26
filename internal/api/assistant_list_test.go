package api

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var routeIn = regexp.MustCompile(`(?:h|HandleFunc|Handle)\("(GET|POST|PUT|DELETE) (/api/[^"]+)"`)

// sameCall reports whether a route (whose {x} stand for anything) is one a
// pattern on a list names.
func sameCall(route, pattern string) bool {
	a, b := strings.Split(route, "/"), strings.Split(pattern, "/")
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if strings.HasPrefix(a[i], "{") || strings.HasPrefix(b[i], "{") {
			continue
		}
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The assistant is meant to reach everything. Every call the app answers
// is either on its list or named in notForAssistant with the reason, so a
// new route can be neither forgotten nor reachable by accident.
func TestEveryCallIsOnTheAssistantsListOrNamedAsLeftOut(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	seen := 0
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range routeIn.FindAllStringSubmatch(string(src), -1) {
			seen++
			method, route := m[1], m[2]
			on := false
			for _, tl := range tools {
				if tl.Method == method && sameCall(route, tl.Pattern) {
					on = true
					break
				}
			}
			_, off := notForAssistant[method+" "+route]
			switch {
			case !on && !off:
				t.Errorf("%s %s (%s) is neither on the assistant's list nor in notForAssistant", method, route, f)
			case on && off && !strings.Contains(route, "{action}") && !strings.Contains(route, "{kind}"):
				t.Errorf("%s %s is both on the assistant's list and in notForAssistant", method, route)
			}
		}
	}
	if seen < 150 {
		t.Fatalf("only %d routes were found in the source; the pattern no longer matches how they are registered", seen)
	}
	// What must never be on the list, whatever else changes.
	for _, tl := range tools {
		for _, never := range []string{"/api/assistant", "/api/ext/", "/api/owncal", "/api/phoneaccess", "/api/quit", "/api/setup/", "/api/pick-folder"} {
			if strings.HasPrefix(tl.Pattern, never) {
				t.Errorf("%s %s is on the assistant's list", tl.Method, tl.Pattern)
			}
		}
		for _, secret := range []struct{ method, pattern string }{{"PUT", "/api/vpn"}, {"PUT", "/api/google"}, {"PUT", "/api/otherai"}, {"PUT", "/api/mailset"}} {
			if tl.Method == secret.method && tl.Pattern == secret.pattern {
				t.Errorf("%s %s takes a secret and is on the assistant's list", tl.Method, tl.Pattern)
			}
		}
		// A call that can carry a key takes only its named, harmless fields.
		if (tl.Pattern == "/api/sources/{key}" && tl.Method == "PUT") || tl.Pattern == "/api/llm" && tl.Method == "PUT" || tl.Pattern == "/api/mailset/switches" {
			if !tl.Only {
				t.Errorf("%s %s must take only its shown fields", tl.Method, tl.Pattern)
			}
			for _, f := range tl.Show {
				if f == "key" || f == "app_id" || f == "pass" || f == "user" || f == "host" || f == "engine" || f == "cli" {
					t.Errorf("%s %s lets %q through", tl.Method, tl.Pattern, f)
				}
			}
		}
		// Sending to someone, and anything that can't be put back, waits for the button.
		for _, held := range []string{"/api/mail/send", "/api/update/install", "/api/restart", "/api/backups/restore", "/api/roles/{id}/no", "/api/roles/{id}/close", "/api/roles/{id}/reopen", "/api/profile"} {
			if tl.Pattern == held && tl.Method != "GET" && tl.Class != mustAsk {
				t.Errorf("%s %s is made without the person's button", tl.Method, tl.Pattern)
			}
		}
		if tl.Method == "DELETE" && tl.Class != mustAsk {
			t.Errorf("%s %s removes something without the person's button", tl.Method, tl.Pattern)
		}
	}
}
