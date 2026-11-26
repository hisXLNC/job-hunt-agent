package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// Hiring posts come in through the side panel's own door only; the Leads
// page is the app's; neither the assistant nor a phone can reach them.
func TestLeadsDoors(t *testing.T) {
	_, h := newServer(t)
	origin := "chrome-extension://" + strings.Repeat("d", 32)
	key := strings.Repeat("q", 40)
	do(h, call{method: "POST", path: "/api/ext/hello", origin: origin, key: key, body: "{}"})
	if got := do(h, call{method: "POST", path: "/api/ext/pair", marker: true}).Code; got != 200 {
		t.Fatalf("approving: %d", got)
	}
	posts := `{"posts":[{"author":"Hannah","headline":"VP Finance at Brightwater","text":"We're hiring a tax technology lead in Toronto. <script>alert(1)</script>","url":"https://www.linkedin.com/feed/update/urn:li:activity:9/"},{"author":"Kim","text":"A lovely day for a walk by the lake."}]}`
	w := do(h, call{method: "POST", path: "/api/ext/leads", origin: origin, key: key, body: posts})
	var took struct{ Seen, Hiring, Added int }
	if json.Unmarshal(w.Body.Bytes(), &took); w.Code != 200 || took.Seen != 2 || took.Added != 1 {
		t.Fatalf("panel sending posts: %d %s", w.Code, w.Body)
	}
	// The app's own page cannot use the panel's door, and the panel cannot read the app's.
	if got := do(h, call{method: "POST", path: "/api/ext/leads", marker: true, body: posts}).Code; got != 403 {
		t.Errorf("own page on the panel's route: %d", got)
	}
	if got := do(h, call{path: "/api/leads", origin: origin, key: key}).Code; got != 403 {
		t.Errorf("panel reading the Leads page: %d", got)
	}
	w = do(h, call{path: "/api/leads"})
	var pg struct {
		Leads []struct {
			ID int64 `json:"id"`
		} `json:"leads"`
		Total int `json:"total"`
	}
	if json.Unmarshal(w.Body.Bytes(), &pg); w.Code != 200 || pg.Total != 1 {
		t.Fatalf("leads page: %d %s", w.Code, w.Body)
	}
	// Another site cannot add a lead.
	if got := do(h, call{method: "POST", path: "/api/leads", origin: "https://evil.example", marker: true, body: `{"text":"We're hiring, call this number now please."}`}).Code; got != 403 {
		t.Errorf("another site adding a lead: %d", got)
	}
	if got := do(h, call{method: "POST", path: "/api/leads", marker: true, body: `{"text":"Initech is opening a Toronto office and hiring its finance team."}`}).Code; got != 200 {
		t.Errorf("adding a lead: %d", got)
	}
	// The assistant reaches Leads by named actions only, never the open
	// "{action}" door, and never the side panel's way in.
	for _, tl := range tools {
		if strings.Contains(tl.Pattern, "{action}") || strings.HasPrefix(tl.Pattern, "/api/ext/") {
			t.Errorf("the assistant can reach %s %s", tl.Method, tl.Pattern)
		}
	}
	if tl, _ := findTool("GET", "/api/leads"); tl == nil {
		t.Error("the assistant cannot read Leads")
	}
	for _, p := range []string{"GET /api/leads", "POST /api/leads/1/sent", "GET /api/insights", "POST /api/ext/leads"} {
		m, path, _ := strings.Cut(p, " ")
		if phoneMay(m, path) {
			t.Errorf("a phone can call %s", p)
		}
	}
}
