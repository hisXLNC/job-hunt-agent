package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"jobhunt/web"
)

func phoneDo(h http.Handler, method, path, cookie string, marker bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader("{}"))
	r.Host = "192.168.1.20:47701"
	if cookie != "" {
		r.AddCookie(&http.Cookie{Name: phoneCookie, Value: cookie})
	}
	if marker {
		r.Header.Set("X-JobHunt", "1")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func pairPhone(t *testing.T, s *Server, h http.Handler) string {
	t.Helper()
	s.phone.mu.Lock()
	s.phone.code, s.phone.codeAt = "c0de", time.Now()
	s.phone.mu.Unlock()
	w := phoneDo(h, "GET", "/pair?c=c0de", "", false)
	for _, c := range w.Result().Cookies() {
		if c.Name == phoneCookie {
			if !c.HttpOnly {
				t.Fatal("the phone's key must not be readable by a page's script")
			}
			return c.Value
		}
	}
	t.Fatalf("pairing gave no key (status %d)", w.Code)
	return ""
}

func TestThePhonesDoorIsShutUntilOpenedAndPaired(t *testing.T) {
	s, _ := newServer(t)
	h := s.phoneHandler()
	if w := phoneDo(h, "GET", "/api/today", "", false); w.Code != 403 {
		t.Fatalf("with phone access off the door answered %d", w.Code)
	}
	s.S.Set("phoneaccess", PhoneAccess{On: true})
	if w := phoneDo(h, "GET", "/api/today", "", false); w.Code != 401 {
		t.Fatalf("an unpaired phone got %d", w.Code)
	}
	if w := phoneDo(h, "GET", "/api/today", strings.Repeat("a", 64), false); w.Code != 401 {
		t.Fatalf("a made-up key got %d", w.Code)
	}
	// A wrong code pairs nothing, and enough of them withdraw the code.
	s.phone.code, s.phone.codeAt = "c0de", time.Now()
	for i := 0; i < 10; i++ {
		if w := phoneDo(h, "GET", "/pair?c=guess", "", false); len(w.Result().Cookies()) != 0 {
			t.Fatal("a wrong code was given a key")
		}
	}
	if w := phoneDo(h, "GET", "/pair?c=c0de", "", false); len(w.Result().Cookies()) != 0 {
		t.Fatal("the code still worked after ten wrong guesses")
	}
	// An old code is no good either.
	s.phone.code, s.phone.codeAt, s.phone.misses = "c0de", time.Now().Add(-11*time.Minute), 0
	if w := phoneDo(h, "GET", "/pair?c=c0de", "", false); len(w.Result().Cookies()) != 0 {
		t.Fatal("a code older than ten minutes worked")
	}

	key := pairPhone(t, s, h)
	if w := phoneDo(h, "GET", "/pair?c=c0de", "", false); len(w.Result().Cookies()) != 0 {
		t.Fatal("a code worked twice")
	}
	if p := s.phoneAccess(); len(p.Devices) != 1 || p.Devices[0].Hash == key || p.Devices[0].Hash != hashKey(key) {
		t.Fatalf("only the key's hash is kept: %+v", p.Devices)
	}
	if w := phoneDo(h, "GET", "/api/today", key, false); w.Code != 200 {
		t.Fatalf("a paired phone couldn't read Today: %d %s", w.Code, w.Body)
	}
	if w := phoneDo(h, "GET", "/api/phone/me", key, false); w.Code != 200 {
		t.Fatalf("me: %d", w.Code)
	}
}

func TestAPhoneCanOnlyMakeItsOwnFewCalls(t *testing.T) {
	s, _ := newServer(t)
	h := s.phoneHandler()
	s.S.Set("phoneaccess", PhoneAccess{On: true})
	key := pairPhone(t, s, h)
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/connections"}, {"GET", "/api/profile"}, {"PUT", "/api/llm"}, {"PUT", "/api/mailset"}, {"GET", "/api/backups"},
		{"POST", "/api/backups/restore"}, {"POST", "/api/quit"}, {"POST", "/api/assistant"}, {"GET", "/api/phoneaccess"}, {"PUT", "/api/phoneaccess"},
		{"GET", "/api/owncal"}, {"PUT", "/api/owncal"}, {"POST", "/api/update/install"}, {"GET", "/api/debug/report"}, {"POST", "/api/roles/1/reopen"},
		{"POST", "/api/roles/1/close"}, {"DELETE", "/api/people/1"}, {"GET", "/api/ext/me"}, {"GET", "/api/roles.csv"}, {"GET", "/api/state"},
	} {
		if w := phoneDo(h, c.method, c.path, key, true); w.Code != 403 {
			t.Errorf("a phone asked %s %s and got %d", c.method, c.path, w.Code)
		}
	}
	// Changing something needs the marker a form on another site can't send.
	if w := phoneDo(h, "POST", "/api/roles/1/later", key, false); w.Code != 403 {
		t.Errorf("a change without the marker got %d", w.Code)
	}
	for _, c := range [][2]string{{"POST", "/api/roles/1/own/cv"}, {"DELETE", "/api/roles/1/own/cv"}, {"POST", "/api/profile/signature-picture"}, {"POST", "/api/roles/1/check"}, {"POST", "/api/roles/1/offer"}, {"POST", "/api/roles/1/findsite"}} {
		if phoneMay(c[0], c[1]) {
			t.Errorf("a phone may make %s %s", c[0], c[1])
		}
	}
	if phoneMay("POST", "/api/roles/1/applied/../../quit") || phoneMay("GET", "/api/roles/1/cv.docx") || !phoneMay("GET", "/api/roles/12/both.pdf") {
		t.Error("the phone's list matches the wrong things")
	}
	// A phone the person removed is out at once.
	s.S.Set("phoneaccess", PhoneAccess{On: true})
	if w := phoneDo(h, "GET", "/api/today", key, false); w.Code != 401 {
		t.Errorf("a removed phone still got %d", w.Code)
	}
}

func TestTheAssistantCannotReachPhoneAccessOrTheCalendarAddress(t *testing.T) {
	for _, c := range tools {
		if strings.Contains(c.Pattern, "phoneaccess") || strings.Contains(c.Pattern, "owncal") || strings.Contains(c.Pattern, "backups/cloud") {
			t.Errorf("%s %s is on the assistant's list", c.Method, c.Pattern)
		}
	}
}

func TestPagesNeverGetTheCalendarAddressBack(t *testing.T) {
	s, h := newServer(t)
	s.E.OwnCalFetch = func(string) ([]byte, error) { return []byte("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"), nil }
	w := do(h, call{method: "PUT", path: "/api/owncal", marker: true, body: `{"url":"https://calendar.google.com/calendar/ical/x/private-secret/basic.ics"}`})
	if w.Code != 200 || strings.Contains(w.Body.String(), "private-secret") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := do(h, call{path: "/api/owncal"}); strings.Contains(w.Body.String(), "private-secret") || !strings.Contains(w.Body.String(), `"has_url":true`) {
		t.Fatalf("%s", w.Body)
	}
	if w := do(h, call{method: "PUT", path: "/api/owncal", marker: true, body: `{"url":"http://127.0.0.1/x.ics"}`}); w.Code != 400 {
		t.Fatalf("an address on this computer was accepted: %d", w.Code)
	}
}

func TestAPhoneCanDoMoreOfTheAppButNeverTheForbiddenParts(t *testing.T) {
	s, _ := newServer(t)
	h := s.phoneHandler()
	s.S.Set("phoneaccess", PhoneAccess{On: true})
	key := pairPhone(t, s, h)
	send := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Host = "192.168.1.20:47701"
		r.AddCookie(&http.Cookie{Name: phoneCookie, Value: key})
		r.Header.Set("X-JobHunt", "1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	id, err := s.E.AddRole("Acme", "Tax Manager", "Toronto", "https://acme.example/jobs/1", "", "manual")
	if err != nil {
		t.Fatal(err)
	}
	// Editing the letter, asking for changes, follow-ups, notes, people,
	// adding a posting, searching now: each reaches Job Hunt from the phone.
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/roles/1/letter"}, {"POST", "/api/roles/1/askletter"}, {"POST", "/api/roles/1/askcv"}, {"POST", "/api/roles/1/undoletter"},
		{"POST", "/api/roles/1/undocv"}, {"POST", "/api/roles/1/change"}, {"POST", "/api/roles/1/notes"}, {"POST", "/api/roles/1/chase"},
		{"POST", "/api/roles/1/chasesave"}, {"POST", "/api/roles/1/chasesent"}, {"POST", "/api/roles/1/chasedrop"}, {"POST", "/api/roles/chaseall"},
		{"POST", "/api/roles/link"}, {"POST", "/api/search"}, {"GET", "/api/people"}, {"GET", "/api/people/1"}, {"POST", "/api/people/1/note"},
		{"PUT", "/api/notes/1"}, {"POST", "/api/notes/1/sent"}, {"POST", "/api/notes/1/replied"},
	} {
		if !phoneMay(c.method, c.path) {
			t.Errorf("a phone may not make %s %s", c.method, c.path)
		}
	}
	if w := send("POST", "/api/roles/1/notes", `{"text":"Referred by Lee"}`); w.Code != 200 {
		t.Fatalf("notes from the phone: %d %s", w.Code, w.Body)
	}
	if w := send("GET", "/api/people", ""); w.Code != 200 {
		t.Fatalf("people from the phone: %d %s", w.Code, w.Body)
	}
	if w := send("POST", "/api/roles/link", `{"text":"Tax Manager at Acme https://acme.example/jobs/1"}`); w.Code != 200 || !strings.Contains(w.Body.String(), `"id":`) {
		t.Fatalf("adding from a link on the phone: %d %s", w.Code, w.Body)
	}
	s.E.NotInterested(id, "")
	if w := send("POST", "/api/roles/link", `{"text":"https://acme.example/jobs/1"}`); w.Code != 400 || !strings.Contains(w.Body.String(), "not interested") {
		t.Fatalf("a role you said no to came back from the phone: %d %s", w.Code, w.Body)
	}
	if r, _ := s.S.Role(id); r.Closed != "no" {
		t.Fatalf("the phone reopened a role you said no to: %q", r.Closed)
	}
	// Never settings, keys, connections, saved copies, the assistant, or
	// removing, closing and reopening.
	for _, c := range []struct{ method, path string }{
		{"PUT", "/api/profile"}, {"GET", "/api/cvs"}, {"POST", "/api/cvs/1/file"}, {"PUT", "/api/cvs/1"}, {"DELETE", "/api/cvs/1"},
		{"POST", "/api/backups/handover"}, {"POST", "/api/backups/continue"}, {"POST", "/api/backups/stay"}, {"GET", "/api/backups"},
		{"PUT", "/api/llm"}, {"PUT", "/api/phone"}, {"POST", "/api/ext/pair"}, {"POST", "/api/assistant"}, {"GET", "/api/assistant"},
		{"DELETE", "/api/notes/1"}, {"DELETE", "/api/people/1"}, {"PUT", "/api/people/1"}, {"POST", "/api/roles/1/reopen"},
		{"POST", "/api/roles/1/close"}, {"POST", "/api/roles/1/stage"}, {"POST", "/api/roles/1/cv"}, {"POST", "/api/roles"},
		{"POST", "/api/pause"}, {"PUT", "/api/sources/1"}, {"POST", "/api/update/check"}, {"POST", "/api/import/old"},
	} {
		if w := send(c.method, c.path, "{}"); w.Code != 403 {
			t.Errorf("a phone asked %s %s and got %d", c.method, c.path, w.Code)
		}
	}
	if phoneMay("POST", "/api/roles/1/letter/x") || phoneMay("POST", "/api/roles/x/letter") || phoneMay("POST", "/api/roles/linkx") {
		t.Error("the phone's list matches the wrong things")
	}
}

func TestTheAssistantCannotHandTheDataOver(t *testing.T) {
	for _, c := range tools {
		for _, p := range []string{"/api/backups/handover", "/api/backups/continue", "/api/backups/stay", "/api/backups/cloud"} {
			if c.Pattern == p {
				t.Errorf("%s %s is on the assistant's list", c.Method, c.Pattern)
			}
		}
		// A new file in place of a CV waits for the person's button.
		if c.Pattern == "/api/cvs/{id}/file" && c.Class != mustAsk {
			t.Errorf("%s %s is made without the person's button", c.Method, c.Pattern)
		}
	}
}

// The phone's page can be put on the home screen, with the app's icon, and
// a link shared to it from another app opens the page with the link in it.
func TestThePhonesPageCanBeInstalledAndSharedTo(t *testing.T) {
	s, _ := newServer(t)
	s.Web = web.FS
	h := s.phoneHandler()
	s.S.Set("phoneaccess", PhoneAccess{On: true})
	w := phoneDo(h, "GET", "/manifest.json", "", false)
	if w.Code != 200 {
		t.Fatalf("the manifest answered %d", w.Code)
	}
	var m struct {
		Icons []struct{ Src string } `json:"icons"`
		Share struct {
			Action, Method string
			Params         map[string]string
		} `json:"share_target"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if m.Share.Action != "/" || m.Share.Method != "GET" || m.Share.Params["url"] != "url" || m.Share.Params["text"] != "text" {
		t.Fatalf("sharing to the page isn't set up: %+v", m.Share)
	}
	for _, i := range append(m.Icons, struct{ Src string }{"/touch-icon.png"}) {
		if w := phoneDo(h, "GET", i.Src, "", false); w.Code != 200 || w.Body.Len() < 100 {
			t.Errorf("icon %s answered %d", i.Src, w.Code)
		}
	}
	page := phoneDo(h, "GET", "/?url=https%3A%2F%2Facme.example%2Fjobs%2F1&text=Look", "", false)
	if page.Code != 200 || !strings.Contains(page.Body.String(), `rel="manifest"`) || !strings.Contains(page.Body.String(), "apple-touch-icon") {
		t.Fatalf("a shared link didn't open the page (%d)", page.Code)
	}
	if csp := page.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Fatalf("the page lost its policy: %q", csp)
	}
}
