package api

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// The side panel learns which version of itself Job Hunt holds, so it can
// reload itself when the installer has put a newer one in place.
func TestTheSidePanelIsToldItsNewestVersion(t *testing.T) {
	_, h := newServer(t)
	panel := approvedPanel(t, h)
	w := panel("POST", "/api/ext/hello", "{}")
	var got struct {
		Version    string `json:"version"`
		ExtVersion string `json:"ext_version"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || got.ExtVersion == "" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// The hiring team the person sees on a LinkedIn posting is added to People
// through the approved side panel only.
func TestTheSidePanelAddsTheHiringTeam(t *testing.T) {
	srv, h := newServer(t)
	c, _, _ := srv.S.UpsertCompany(store.Company{Name: "Acme", State: "following"})
	id, _ := srv.S.AddRole(store.Role{CompanyID: c.ID, Key: "linkedin:1", Title: "Tax Manager", Applicants: -1})
	path := fmt.Sprintf("/api/ext/role/%d/team", id)
	body := `{"people":[{"name":"Dana Lee","title":"Talent Partner","url":"https://www.linkedin.com/in/dana-lee-example"},{"name":"Ravi Patel","title":"Director of Tax","url":"https://www.linkedin.com/in/ravi-example"}]}`
	if got := do(h, call{method: "POST", path: path, body: body, marker: true}).Code; got != 403 {
		t.Fatalf("own page adding the team: got %d, want 403", got)
	}
	panel := approvedPanel(t, h)
	w := panel("POST", path, body)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"added":2`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	people, _ := srv.S.People(store.PeopleFilter{CompanyID: c.ID})
	if len(people) != 2 {
		t.Fatalf("people: %+v", people)
	}
	if w := panel("POST", path, `{"people":[]}`); w.Code != 400 {
		t.Errorf("no one to add: %d", w.Code)
	}
}

func TestFilesFolderAndThisComputer(t *testing.T) {
	srv, h := newServer(t)
	dir := filepath.Join(t.TempDir(), "Job Hunt")
	if w := do(h, call{method: "PUT", path: "/api/files", body: fmt.Sprintf(`{"dir":%q}`, dir), marker: true}); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if _, got := srv.E.Files(); got != dir {
		t.Fatalf("files kept in %q", got)
	}
	if w := do(h, call{method: "GET", path: "/api/files"}); w.Code != 200 || !strings.Contains(w.Body.String(), `"folders":[]`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := do(h, call{method: "POST", path: "/api/files/show", body: `{"folder":"../.."}`, marker: true}); w.Code != 400 {
		t.Errorf("a folder outside is never opened: %d", w.Code)
	}
	// Without Windows: each says so instead of doing anything.
	for _, p := range []string{"/api/pick-folder", "/api/desk/allow-wake", "/api/claude-code/install"} {
		if w := do(h, call{method: "POST", path: p, body: "{}", marker: true}); w.Code != 400 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	// Reading a posting from its link never opens this computer's own addresses.
	if w := do(h, call{method: "POST", path: "/api/peek", body: `{"url":"http://127.0.0.1:47700/api/state"}`, marker: true}); w.Code != 400 {
		t.Errorf("peek at this computer: %d", w.Code)
	}
	// A page on another site cannot use them.
	if w := do(h, call{method: "POST", path: "/api/peek", body: `{"url":"https://example.com/jobs/1"}`, marker: true, site: "cross-site"}); w.Code != 403 {
		t.Errorf("peek from another site: %d", w.Code)
	}
	if w := do(h, call{method: "GET", path: "/api/connections"}); w.Code != 200 || !strings.Contains(w.Body.String(), `"pc":`) {
		t.Errorf("connections: %d", w.Code)
	}
}

// The assistant cannot change folders, power settings or install anything.
func TestAssistantCannotTouchThisComputer(t *testing.T) {
	srv, h, sc := withScript(t, calls(
		brain.AssistCall{Method: "PUT", Path: "/api/files", Body: `{"off":true}`},
		brain.AssistCall{Method: "POST", Path: "/api/pick-folder", Body: `{}`},
		brain.AssistCall{Method: "POST", Path: "/api/desk/allow-wake", Body: `{}`},
		brain.AssistCall{Method: "POST", Path: "/api/claude-code/install", Body: `{}`},
		brain.AssistCall{Method: "POST", Path: "/api/peek", Body: `{"url":"https://example.com/jobs/1"}`},
	), brain.AssistStep{Say: "I can't do those."})
	tell(t, h, "turn off the files folder and install claude", "#/you/app")
	for _, n := range sc.seen[1].Notes[1:] {
		if !strings.HasPrefix(n.Result, "Not made") {
			t.Errorf("%s went through: %s", n.Call, n.Result)
		}
	}
	if set, _ := srv.E.Files(); set.Off {
		t.Fatal("the files folder was switched off")
	}
}
