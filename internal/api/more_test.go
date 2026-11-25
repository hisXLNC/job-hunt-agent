package api

import (
	"encoding/json"
	"strings"
	"testing"

	"jobhunt/internal/brain"
)

func TestThemeIsSetBeforeThePageDraws(t *testing.T) {
	srv, h := newServer(t)
	w := do(h, call{path: "/theme.js"})
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "javascript") || !strings.Contains(w.Body.String(), `dataset.theme = "light"`) {
		t.Fatalf("theme.js: %d %q %s", w.Code, w.Header().Get("Content-Type"), w.Body)
	}
	if got := do(h, call{method: "PUT", path: "/api/theme", body: `{"theme":"dark"}`}).Code; got != 403 {
		t.Errorf("a theme change without the page's marker: %d", got)
	}
	if got := do(h, call{method: "PUT", path: "/api/theme", body: `{"theme":"\";alert(1);//"}`, marker: true}).Code; got != 400 {
		t.Errorf("a made-up theme: %d", got)
	}
	if got := do(h, call{method: "PUT", path: "/api/theme", body: `{"theme":"dark"}`, marker: true}).Code; got != 200 {
		t.Fatalf("choosing dark: %d", got)
	}
	if body := do(h, call{path: "/theme.js"}).Body.String(); !strings.Contains(body, `dataset.theme = "dark"`) {
		t.Errorf("theme.js after choosing dark: %s", body)
	}
	if srv.state().Theme != "dark" {
		t.Errorf("the state says %q", srv.state().Theme)
	}
	if got := do(h, call{path: "/theme.js", host: "evil.example:47700"}).Code; got != 403 {
		t.Errorf("theme.js under another name: %d", got)
	}
}

func TestTheBell(t *testing.T) {
	srv, h := newServer(t)
	srv.E.Tell("<b>Tax Manager</b> at Acme", "Fit 90.", "#/roles/1")
	srv.E.Tell("Acme wrote to you", "Hello", "#/replies")
	var out struct {
		Notices []struct {
			ID    int64
			Title string
			Page  string
			Read  bool
		}
		Unread int
	}
	json.Unmarshal(do(h, call{path: "/api/notices"}).Body.Bytes(), &out)
	if len(out.Notices) != 2 || out.Unread != 2 || srv.state().Notices != 2 {
		t.Fatalf("notices: %+v, state %d", out, srv.state().Notices)
	}
	do(h, call{method: "POST", path: "/api/notices/read", body: `{"id":` + jsonInt(out.Notices[0].ID) + `}`, marker: true})
	if srv.state().Notices != 1 {
		t.Fatalf("after reading one: %d", srv.state().Notices)
	}
	do(h, call{method: "POST", path: "/api/notices/read", body: `{}`, marker: true})
	if srv.state().Notices != 0 {
		t.Fatalf("after mark all read: %d", srv.state().Notices)
	}
}

func jsonInt(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestSavedCopiesOverTheInterface(t *testing.T) {
	srv, h := newServer(t)
	type view struct {
		Dir    string
		Keep   int
		Copies []struct{ Name string }
		Staged *struct{ Name string }
		Can    bool `json:"can_restart"`
	}
	get := func() view {
		var v view
		json.Unmarshal(do(h, call{path: "/api/backups"}).Body.Bytes(), &v)
		return v
	}
	if v := get(); v.Keep != 7 || len(v.Copies) != 0 || v.Staged != nil || v.Can {
		t.Fatalf("fresh: %+v", v)
	}
	if w := do(h, call{method: "POST", path: "/api/backup", marker: true}); w.Code != 200 {
		t.Fatalf("backup: %d %s", w.Code, w.Body)
	}
	v := get()
	if len(v.Copies) != 1 {
		t.Fatalf("one copy expected: %+v", v)
	}
	if got := do(h, call{method: "PUT", path: "/api/backups", body: `{"dir":"/no/such/folder/anywhere","keep":7}`, marker: true}).Code; got != 400 {
		t.Errorf("a folder that isn't there: %d", got)
	}
	if got := do(h, call{method: "PUT", path: "/api/backups", body: `{"keep":30}`, marker: true}).Code; got != 200 || get().Keep != 30 {
		t.Errorf("keeping 30: %d %+v", got, get())
	}
	for _, c := range []call{
		{method: "POST", path: "/api/backups/restore", body: `{"name":"` + v.Copies[0].Name + `"}`},
		{method: "POST", path: "/api/backups/restore", body: `{"name":"` + v.Copies[0].Name + `"}`, marker: true, origin: "https://evil.example"},
		{method: "POST", path: "/api/restart"},
	} {
		if got := do(h, c).Code; got != 403 {
			t.Errorf("%s %s from outside: %d", c.method, c.path, got)
		}
	}
	if got := do(h, call{method: "POST", path: "/api/backups/restore", body: `{"name":"../jobhunt.db"}`, marker: true}).Code; got != 400 {
		t.Errorf("a path instead of a copy's name: %d", got)
	}
	if w := do(h, call{method: "POST", path: "/api/backups/restore", body: `{"name":"` + v.Copies[0].Name + `"}`, marker: true}); w.Code != 200 {
		t.Fatalf("staging: %d %s", w.Code, w.Body)
	}
	if v := get(); v.Staged == nil || v.Staged.Name != v.Copies[0].Name {
		t.Fatalf("staged: %+v", v)
	}
	// This program can't start itself again in a test: the page is told so.
	if w := do(h, call{method: "POST", path: "/api/restart", marker: true}); w.Code != 400 || !strings.Contains(w.Body.String(), "Start menu") {
		t.Errorf("restart: %d %s", w.Code, w.Body)
	}
	do(h, call{method: "DELETE", path: "/api/backups/restore", marker: true})
	if v := get(); v.Staged != nil {
		t.Fatalf("still staged after taking it back: %+v", v)
	}
	_ = srv
}

// Putting a copy back, moving the copies, the look of the pages and starting
// again are the person's own buttons.
func TestAssistantCannotRestoreOrRestart(t *testing.T) {
	srv, h, sc := withScript(t, calls(
		brain.AssistCall{Method: "POST", Path: "/api/backups/restore", Body: `{"name":"jobhunt-2026-01-01.db"}`},
		brain.AssistCall{Method: "DELETE", Path: "/api/backups/restore"},
		brain.AssistCall{Method: "PUT", Path: "/api/backups", Body: `{"dir":"/tmp","keep":7}`},
		brain.AssistCall{Method: "GET", Path: "/api/backups"},
		brain.AssistCall{Method: "POST", Path: "/api/restart"},
		brain.AssistCall{Method: "PUT", Path: "/api/theme", Body: `{"theme":"dark"}`},
		brain.AssistCall{Method: "POST", Path: "/api/notices/read", Body: `{}`},
		brain.AssistCall{Method: "GET", Path: "/api/calendar.ics"},
	), brain.AssistStep{Say: "I can't do those."})
	srv.E.Tell("Something", "happened", "#/today")
	v := tell(t, h, "put back yesterday's copy and restart", "#/settings/app")
	for _, n := range sc.seen[1].Notes[1:] {
		if !strings.HasPrefix(n.Result, "Not made") {
			t.Errorf("%s went through: %s", n.Call, n.Result)
		}
	}
	if last := v.Turns[len(v.Turns)-1]; len(last.Extra.Did)+len(last.Extra.Held) != 0 {
		t.Fatalf("something was done or offered: %+v", last.Extra)
	}
	if srv.E.Theme() != "light" || srv.E.BackupSet().Dir != "" || srv.E.StagedRestore() != nil || srv.E.UnreadNotices() != 1 {
		t.Fatal("something changed")
	}
}

// Reading the bell and the calendar is looking.
func TestAssistantMayReadTheBellAndCalendar(t *testing.T) {
	srv, h, sc := withScript(t, calls(
		brain.AssistCall{Method: "GET", Path: "/api/notices"},
		brain.AssistCall{Method: "GET", Path: "/api/calendar"},
	), brain.AssistStep{Say: "Here is what is new."})
	srv.E.Tell("Acme wrote to you", "Hello", "#/replies")
	tell(t, h, "what did I miss?", "#/today")
	for _, n := range sc.seen[1].Notes[1:] {
		if strings.HasPrefix(n.Result, "Not made") {
			t.Errorf("%s was refused: %s", n.Call, n.Result)
		}
	}
}
