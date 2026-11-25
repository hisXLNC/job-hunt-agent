package engine

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// fakeGoogle stands in for Google's sign-in and Calendar. Nothing in these
// tests leaves this computer, and every name and address in them is made up.
type fakeGoogle struct {
	mu        sync.Mutex
	challenge string
	redirect  string
	events    map[string]map[string]any
	next      int
	revoked   []string
	refuse    bool // the refresh token was taken back
	calls     []string
}

const (
	fakeClient  = "1234567890-fakeclient.apps.googleusercontent.com"
	fakeSecret  = "GOCSPX-fake-secret-value"
	fakeRefresh = "1//fake-refresh-token-value"
	fakeAccess  = "ya29.fake-access-token-value"
	fakeCode    = "4/0Afake-sign-in-code"
)

func (g *fakeGoogle) serve(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.calls = append(g.calls, r.Method+" "+r.URL.Path)
	switch {
	case r.URL.Path == "/token":
		r.ParseForm()
		f := r.PostForm
		if f.Get("client_id") != fakeClient || f.Get("client_secret") != fakeSecret {
			w.WriteHeader(401)
			fmt.Fprint(w, `{"error":"invalid_client"}`)
			return
		}
		switch f.Get("grant_type") {
		case "authorization_code":
			sum := sha256.Sum256([]byte(f.Get("code_verifier")))
			if f.Get("code") != fakeCode || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge || f.Get("redirect_uri") != g.redirect {
				w.WriteHeader(400)
				fmt.Fprint(w, `{"error":"invalid_grant"}`)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"access_token": fakeAccess, "refresh_token": fakeRefresh, "expires_in": 3599, "scope": GoogleScope})
		case "refresh_token":
			if g.refuse || f.Get("refresh_token") != fakeRefresh {
				w.WriteHeader(400)
				fmt.Fprint(w, `{"error":"invalid_grant"}`)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"access_token": fakeAccess, "expires_in": 3599})
		}
		return
	case r.URL.Path == "/revoke":
		r.ParseForm()
		g.revoked = append(g.revoked, r.PostForm.Get("token"))
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+fakeAccess {
		w.WriteHeader(401)
		return
	}
	const base = "/calendar/v3/calendars/primary/events"
	if r.URL.Path == base {
		switch r.Method {
		case "GET":
			items := []map[string]any{}
			for _, ev := range g.events {
				items = append(items, ev)
			}
			json.NewEncoder(w).Encode(map[string]any{"items": items})
		case "POST":
			var ev map[string]any
			json.NewDecoder(r.Body).Decode(&ev)
			g.next++
			ev["id"] = fmt.Sprintf("ev%d", g.next)
			ev["status"] = "confirmed"
			g.events[ev["id"].(string)] = ev
			json.NewEncoder(w).Encode(ev)
		}
		return
	}
	id := strings.TrimPrefix(r.URL.Path, base+"/")
	ev, ok := g.events[id]
	if !ok {
		w.WriteHeader(404)
		return
	}
	switch r.Method {
	case "GET":
		json.NewEncoder(w).Encode(ev)
	case "PATCH":
		var ch map[string]any
		json.NewDecoder(r.Body).Decode(&ch)
		for k, v := range ch {
			ev[k] = v
		}
		json.NewEncoder(w).Encode(ev)
	case "DELETE":
		ev["status"] = "cancelled"
		w.WriteHeader(204)
	}
}

func (g *fakeGoogle) event(id string) map[string]any {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.events[id]
}

func (g *fakeGoogle) put(id string, ev map[string]any) {
	g.mu.Lock()
	defer g.mu.Unlock()
	ev["id"] = id
	if ev["status"] == nil {
		ev["status"] = "confirmed"
	}
	g.events[id] = ev
}

func evStart(ev map[string]any) time.Time {
	t, _ := time.Parse(time.RFC3339, ev["start"].(map[string]any)["dateTime"].(string))
	return t
}

func when(t time.Time) map[string]any { return map[string]any{"dateTime": t.Format(time.RFC3339)} }

// waitGoogle waits for a sync started in the background to finish.
func waitGoogle(t *testing.T, e *Engine) {
	t.Helper()
	for i := 0; i < 500 && e.Busy("google"); i++ {
		time.Sleep(10 * time.Millisecond)
	}
}

func signedInToFakeGoogle(t *testing.T) (*Engine, *fakeGoogle) {
	t.Helper()
	e, _ := newEngine(t)
	g := &fakeGoogle{events: map[string]map[string]any{}}
	srv := httptest.NewServer(http.HandlerFunc(g.serve))
	t.Cleanup(srv.Close)
	e.GoogleHosts = GoogleHosts{Auth: srv.URL + "/auth", Token: srv.URL + "/token", API: srv.URL + "/calendar/v3", Revoke: srv.URL + "/revoke"}
	e.BaseURL = "http://127.0.0.1:47700/"

	if err := e.SetGoogleClient(GoogleClientInput{ClientID: "not-a-client", Secret: "x"}); err == nil {
		t.Error("a wrong client ID was taken")
	}
	if err := e.SetGoogleClient(GoogleClientInput{File: `{"web":{"client_id":"` + fakeClient + `","client_secret":"s"}}`}); err == nil || !strings.Contains(err.Error(), "Desktop app") {
		t.Errorf("a web client was taken: %v", err)
	}
	if err := e.SetGoogleClient(GoogleClientInput{File: `{"installed":{"client_id":"` + fakeClient + `","client_secret":"` + fakeSecret + `"}}`}); err != nil {
		t.Fatal(err)
	}
	addr, err := e.GoogleSignIn()
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(addr)
	q := u.Query()
	if q.Get("scope") != GoogleScope || q.Get("code_challenge_method") != "S256" || q.Get("client_id") != fakeClient || !strings.HasPrefix(q.Get("redirect_uri"), "http://127.0.0.1:") || q.Get("access_type") != "offline" {
		t.Fatalf("the sign-in address asks for the wrong things: %s", addr)
	}
	if strings.Contains(addr, fakeSecret) {
		t.Fatal("the client secret is in the sign-in address")
	}
	g.mu.Lock()
	g.challenge, g.redirect = q.Get("code_challenge"), q.Get("redirect_uri")
	g.mu.Unlock()
	if !e.Google().Waiting {
		t.Error("the page isn't told a sign-in is under way")
	}
	// Another page sending the browser back with a code of its own is turned away.
	resp, err := http.Get(q.Get("redirect_uri") + "?state=someone-else&code=" + url.QueryEscape(fakeCode))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 400 || e.GoogleOn() {
		t.Fatalf("a sign-in with the wrong state was taken: %d", resp.StatusCode)
	}
	resp, err = http.Get(q.Get("redirect_uri") + "?state=" + q.Get("state") + "&code=" + url.QueryEscape(fakeCode) + "&scope=" + url.QueryEscape(GoogleScope))
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(page), "Signed in") || !e.GoogleOn() {
		t.Fatalf("signing in failed: %d %s", resp.StatusCode, page)
	}
	waitGoogle(t, e)
	return e, g
}

func TestGoogleCalendarBothWays(t *testing.T) {
	e, g := signedInToFakeGoogle(t)
	loc := e.Now().Location()
	co, _, _ := e.S.UpsertCompany(store.Company{Name: "Northwind Ltd", State: "following"})
	rid, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "gc:1", Title: "Tax Manager", Stage: "applied"})
	day := dayStart(e.Now()).AddDate(0, 0, 3)
	at := day.Add(14 * time.Hour)

	// An interview added here goes into Google Calendar with its prep block and reminders.
	tid, err := e.AddTalk(store.Talk{Kind: "interview", RoleID: rid, Title: "Interview", At: at.Unix(), Minutes: 45})
	if err != nil {
		t.Fatal(err)
	}
	if !e.googleDirty() {
		t.Error("a new interview isn't seen as waiting to go to Google")
	}
	if err := e.SyncGoogle(context.Background()); err != nil {
		t.Fatal(err)
	}
	l := e.gLinks()[tid]
	main, prep := g.event(l.Event), g.event(l.Prep)
	if main == nil || prep == nil {
		t.Fatalf("not put into Google Calendar: %+v", l)
	}
	if !strings.Contains(main["summary"].(string), "Northwind") || !evStart(main).Equal(at) {
		t.Errorf("the entry is wrong: %v", main)
	}
	if !evStart(prep).Equal(at.Add(-gPrepMinutes*time.Minute)) || !strings.HasPrefix(prep["summary"].(string), "Prep: ") {
		t.Errorf("the prep block is wrong: %v", prep)
	}
	rem, _ := json.Marshal(main["reminders"])
	eve := int(at.Sub(day.AddDate(0, 0, -1).Add(18 * time.Hour)).Minutes())
	if !strings.Contains(string(rem), `"minutes":30`) || !strings.Contains(string(rem), fmt.Sprintf(`"minutes":%d`, eve)) {
		t.Errorf("the reminders aren't the evening before and half an hour before: %s", rem)
	}
	if e.googleDirty() || !e.TalkInGoogle(tid) {
		t.Error("after syncing, something still looks unsent")
	}

	// Changed here: changed there, prep block with it.
	tk, _ := e.S.Talk(tid)
	tk.At += 3600
	e.S.SaveTalk(tk)
	if !e.googleDirty() {
		t.Error("a move here isn't noticed")
	}
	if err := e.SyncGoogle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !evStart(g.event(l.Event)).Equal(at.Add(time.Hour)) || !evStart(g.event(l.Prep)).Equal(at.Add(time.Hour-gPrepMinutes*time.Minute)) {
		t.Errorf("the move here didn't reach Google: %v", g.event(l.Event)["start"])
	}

	// Moved in Google Calendar: moved here, with a note on the role.
	moved := at.AddDate(0, 0, 1)
	ev := g.event(l.Event)
	g.mu.Lock()
	ev["start"], ev["end"] = when(moved), when(moved.Add(time.Hour))
	g.mu.Unlock()
	if err := e.SyncGoogle(context.Background()); err != nil {
		t.Fatal(err)
	}
	tk, _ = e.S.Talk(tid)
	if tk.At != moved.Unix() || tk.Minutes != 60 {
		t.Errorf("the move in Google didn't come back: %v %d", time.Unix(tk.At, 0).In(loc), tk.Minutes)
	}
	if !evStart(g.event(l.Prep)).Equal(moved.Add(-gPrepMinutes * time.Minute)) {
		t.Error("the prep block didn't follow the move")
	}
	acts, _ := e.S.ActivityList(store.ActivityFilter{RoleID: rid, Limit: 20})
	if !hasActivity(acts, "Moved in Google Calendar") {
		t.Errorf("no note on the role about the move: %+v", acts)
	}

	// An entry Job Hunt didn't make that names the employer is offered;
	// one that doesn't, isn't. Both count as busy time.
	g.put("theirs", map[string]any{"summary": "Chat <b>with</b> the Northwind team", "start": when(at.Add(48 * time.Hour)), "end": when(at.Add(49 * time.Hour))})
	g.put("byinvite", map[string]any{"summary": "Call", "attendees": []any{map[string]any{"email": "recruiter@northwind.example"}}, "start": when(at.Add(72 * time.Hour)), "end": when(at.Add(73 * time.Hour))})
	g.put("dentist", map[string]any{"summary": "Dentist", "start": when(at.Add(26 * time.Hour)), "end": when(at.Add(27 * time.Hour))})
	if err := e.SyncGoogle(context.Background()); err != nil {
		t.Fatal(err)
	}
	looks := e.GoogleLookalikes()
	if len(looks) != 2 || looks[0].ID != "theirs" || looks[1].ID != "byinvite" || looks[0].Roles[0].ID != rid {
		t.Fatalf("look-alikes: %+v", looks)
	}
	busy := e.OwnEvents(e.Now().Unix(), e.Now().AddDate(0, 0, 30).Unix())
	if len(busy) != 3 {
		t.Errorf("busy times from Google should be the three entries Job Hunt didn't make: %+v", busy)
	}
	if !e.CalendarKnown() || e.Clash(moved.Unix(), 60) != nil {
		t.Error("Job Hunt's own entry in Google counts as a clash with itself")
	}

	// Linking is the person's button, to a role offered with the entry.
	other, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "gc:2", Title: "Other", Stage: "applied", Closed: "no"})
	if _, err := e.LinkGoogleEvent("theirs", other); err == nil {
		t.Error("an entry was linked to a role it wasn't offered with")
	}
	linked, err := e.LinkGoogleEvent("theirs", rid)
	if err != nil {
		t.Fatal(err)
	}
	waitGoogle(t, e)
	lt, _ := e.S.Talk(linked)
	if lt.RoleID != rid || lt.At != at.Add(48*time.Hour).Unix() || lt.Title != "Interview" {
		t.Errorf("the linked interview: %+v", lt)
	}
	if ll := e.gLinks()[linked]; !ll.Adopted || ll.Event != "theirs" || g.event(ll.Prep) == nil {
		t.Errorf("the linked entry isn't followed, or has no prep block: %+v", ll)
	}
	if g.event("theirs")["summary"] != "Chat <b>with</b> the Northwind team" {
		t.Error("the person's own entry was rewritten")
	}
	if len(e.GoogleLookalikes()) != 1 {
		t.Error("a linked entry is still offered")
	}
	e.DismissGoogleEvent("byinvite")
	if len(e.GoogleLookalikes()) != 0 {
		t.Error("a dismissed entry is still offered")
	}

	// Removed in Google Calendar: removed here, with a note.
	g.mu.Lock()
	g.events[l.Event]["status"] = "cancelled"
	g.mu.Unlock()
	if err := e.SyncGoogle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.S.Talk(tid); err == nil {
		t.Error("an interview deleted in Google is still here")
	}
	if g.event(l.Prep)["status"] != "cancelled" {
		t.Error("its prep block stayed in Google")
	}
	acts, _ = e.S.ActivityList(store.ActivityFilter{RoleID: rid, Limit: 20})
	if !hasActivity(acts, "Removed in Google Calendar") {
		t.Errorf("no note about the removal: %+v", acts)
	}

	// Removed here: Job Hunt's prep block goes, the person's own entry stays.
	prepOfLinked := e.gLinks()[linked].Prep
	e.S.DeleteTalk(linked)
	if err := e.SyncGoogle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if g.event("theirs")["status"] != "confirmed" || g.event(prepOfLinked)["status"] != "cancelled" {
		t.Error("removing a linked interview here should leave the person's own entry and take the prep block")
	}

	// A role the person closed is never offered.
	if err := e.S.CloseRole(rid, "no", "Not interested"); err != nil {
		t.Fatal(err)
	}
	g.put("again", map[string]any{"summary": "Northwind follow-up", "start": when(at.Add(80 * time.Hour)), "end": when(at.Add(81 * time.Hour))})
	e.SyncGoogle(context.Background())
	if len(e.GoogleLookalikes()) != 0 {
		t.Error("an entry is offered for a closed role")
	}

	// No key reaches the page or the debugging record.
	view, _ := json.Marshal(e.Google())
	record := strings.Join(trace.Tail(4000), "\n")
	for _, secret := range []string{fakeSecret, fakeRefresh, fakeAccess, fakeCode} {
		if strings.Contains(string(view), secret) || strings.Contains(record, secret) {
			t.Errorf("%q got out", secret)
		}
	}

	// Signing out asks Google to forget the sign-in and keeps the client.
	if err := e.GoogleSignOut(context.Background()); err != nil {
		t.Fatal(err)
	}
	if e.GoogleOn() || len(g.revoked) != 1 || g.revoked[0] != fakeRefresh || !e.Google().HasClient || len(e.gLinks()) != 0 || e.CalendarKnown() {
		t.Errorf("sign out: on=%v revoked=%v view=%+v", e.GoogleOn(), g.revoked, e.Google())
	}
}

func TestGoogleEndingTheSignInIsSaidPlainly(t *testing.T) {
	e, g := signedInToFakeGoogle(t)
	g.mu.Lock()
	g.refuse = true
	g.mu.Unlock()
	st := e.gstate()
	st.mu.Lock()
	st.access = ""
	st.mu.Unlock()
	err := e.SyncGoogle(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Sign in with Google again") {
		t.Fatalf("got %v", err)
	}
	if e.GoogleOn() || e.Google().Note == "" {
		t.Errorf("the ended sign-in is kept: %+v", e.Google())
	}
}

func hasActivity(acts []store.Activity, text string) bool {
	for _, a := range acts {
		if strings.Contains(a.Text, text) {
			return true
		}
	}
	return false
}
