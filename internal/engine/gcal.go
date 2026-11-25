package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// Two-way Google Calendar. The person makes an OAuth client of the
// "Desktop app" type once in Google Cloud Console and pastes its ID and
// secret here. Signing in uses the installed-app loopback flow with PKCE:
// Google sends the browser back to http://127.0.0.1:<a free port>/, which
// this program answers by itself. The only permission asked for is
// calendar.events.
//
// Then Job Hunt puts each conversation into the person's Google Calendar,
// with a prep block before it and the reminders it already plans (the
// evening before, and half an hour before), changes it there when it changes
// here, and takes back moves and deletions made in Google Calendar, with a
// note on the role. Entries it did not make that name an employer the person
// has a role with are offered with "Link to application"; linking is the
// person's button.
//
// The client secret and the sign-in (the refresh token) are kept like the
// other keys, in Job Hunt's data file on this computer. They are never sent
// back to the pages, to Claude or into the debugging record. Calendar
// entries are outside text: they are shown escaped and never acted on, and
// none of these calls are on the assistant's list.

// GoogleSet is the setting kept under "google".
type GoogleSet struct {
	ClientID string `json:"client_id,omitempty"`
	Secret   string `json:"secret,omitempty"`
	Refresh  string `json:"refresh,omitempty"`
	At       int64  `json:"at"`   // when it last synced
	Note     string `json:"note"` // what went wrong the last time, if anything
}

// GoogleView is what the pages are told: nothing that works as a key.
type GoogleView struct {
	HasClient  bool   `json:"has_client"`
	SignedIn   bool   `json:"signed_in"`
	Waiting    bool   `json:"waiting"` // a sign-in page is open, waiting for Google
	At         int64  `json:"at"`
	Note       string `json:"note"`
	Pushed     int    `json:"pushed"`     // conversations kept in Google Calendar
	Lookalikes int    `json:"lookalikes"` // entries that look like an interview, not linked
	Syncing    bool   `json:"syncing"`
}

// GoogleHosts are Google's addresses; tests point them at a fake Google.
type GoogleHosts struct {
	Auth   string // the sign-in page
	Token  string // where codes and refresh tokens are swapped for access
	API    string // Calendar API, up to and including /calendar/v3
	Revoke string
}

func (h GoogleHosts) or() GoogleHosts {
	if h.Auth == "" {
		h.Auth = "https://accounts.google.com/o/oauth2/v2/auth"
	}
	if h.Token == "" {
		h.Token = "https://oauth2.googleapis.com/token"
	}
	if h.API == "" {
		h.API = "https://www.googleapis.com/calendar/v3"
	}
	if h.Revoke == "" {
		h.Revoke = "https://oauth2.googleapis.com/revoke"
	}
	return h
}

// GoogleScope is the one permission Job Hunt asks for.
const GoogleScope = "https://www.googleapis.com/auth/calendar.events"

const (
	gcalBehind = 2 * 24 * time.Hour   // how far back entries are read
	gcalAhead  = 120 * 24 * time.Hour // and how far ahead
	gcalKey    = "google"
	gcalLinks  = "google:links"
	gcalLooks  = "google:lookalikes"
	gcalEvents = "google:events"
	gcalNo     = "google:dismissed"
)

// googleState is what lives only in memory: the short-lived access token
// and a sign-in under way.
type googleState struct {
	mu      sync.Mutex
	access  string
	expires time.Time
	signin  *googleSignin
	syncMu  sync.Mutex
}

type googleSignin struct {
	srv *http.Server
	at  time.Time
}

// gLink is a conversation kept in Google Calendar, and what was last put
// there, so a change on either side can be told apart.
type gLink struct {
	Event   string `json:"event"`
	Prep    string `json:"prep,omitempty"`
	At      int64  `json:"at"`
	Minutes int    `json:"minutes"`
	PrepAt  int64  `json:"prep_at,omitempty"`
	Sum     string `json:"sum,omitempty"`
	// The person's own entry, linked to a role: Job Hunt moves it when the
	// conversation moves here, and leaves its words alone.
	Adopted bool `json:"adopted,omitempty"`
}

// GoogleLookalike is an entry in the person's Google Calendar that names an
// employer they have a role with. Title is outside text.
type GoogleLookalike struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Start     int64      `json:"start"`
	End       int64      `json:"end"`
	Company   string     `json:"company"`
	CompanyID int64      `json:"company_id"`
	Roles     []LookRole `json:"roles"`
}

// LookRole is a role the entry could be for.
type LookRole struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

func (e *Engine) GoogleSet() GoogleSet {
	var g GoogleSet
	e.S.Get(gcalKey, &g)
	return g
}

func (e *Engine) gstate() *googleState {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.gcal == nil {
		e.gcal = &googleState{}
	}
	return e.gcal
}

// GoogleOn says whether Job Hunt is signed in to Google Calendar.
func (e *Engine) GoogleOn() bool { return e.GoogleSet().Refresh != "" }

func (e *Engine) Google() GoogleView {
	g := e.GoogleSet()
	st := e.gstate()
	st.mu.Lock()
	waiting := st.signin != nil
	st.mu.Unlock()
	var looks []GoogleLookalike
	e.S.Get(gcalLooks, &looks)
	return GoogleView{HasClient: g.ClientID != "" && g.Secret != "", SignedIn: g.Refresh != "", Waiting: waiting, At: g.At, Note: g.Note,
		Pushed: len(e.gLinks()), Lookalikes: len(looks), Syncing: e.Busy("google")}
}

var googleClientRe = regexp.MustCompile(`^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$`)

// GoogleClientInput is what the person pastes: the client ID and secret,
// or the whole file Google Cloud Console lets them download.
type GoogleClientInput struct {
	ClientID string `json:"client_id"`
	Secret   string `json:"client_secret"`
	File     string `json:"file"`
}

// SetGoogleClient keeps the OAuth client the person made. A different
// client ends the sign-in made with the old one.
func (e *Engine) SetGoogleClient(in GoogleClientInput) error {
	if f := strings.TrimSpace(in.File); f != "" {
		var doc struct {
			Installed *struct {
				ClientID string `json:"client_id"`
				Secret   string `json:"client_secret"`
			} `json:"installed"`
			Web *json.RawMessage `json:"web"`
		}
		if json.Unmarshal([]byte(f), &doc) != nil {
			return errors.New("That file isn't the one Google gives for an OAuth client. Download it again from Clients in Google Cloud Console.")
		}
		if doc.Installed == nil {
			if doc.Web != nil {
				return errors.New("That client is of the \"Web application\" type. Make one of the \"Desktop app\" type instead.")
			}
			return errors.New("That file isn't the one Google gives for an OAuth client.")
		}
		in.ClientID, in.Secret = doc.Installed.ClientID, doc.Installed.Secret
	}
	in.ClientID, in.Secret = strings.TrimSpace(in.ClientID), strings.TrimSpace(in.Secret)
	g := e.GoogleSet()
	if in.ClientID == "" {
		in.ClientID = g.ClientID
	}
	if in.Secret == "" && in.ClientID == g.ClientID {
		in.Secret = g.Secret
	}
	if in.ClientID == "" || in.Secret == "" {
		return errors.New("Paste both the client ID and the client secret.")
	}
	if !googleClientRe.MatchString(in.ClientID) {
		return errors.New("That isn't a client ID. It ends in .apps.googleusercontent.com.")
	}
	if strings.ContainsAny(in.Secret, " \t\r\n\"'") || len(in.Secret) > 200 {
		return errors.New("That isn't a client secret. Copy it again from the client's page.")
	}
	if in.ClientID != g.ClientID {
		e.forgetGoogle()
		g = GoogleSet{}
	}
	g.ClientID, g.Secret, g.Note = in.ClientID, in.Secret, ""
	if err := e.S.Set(gcalKey, g); err != nil {
		return err
	}
	e.S.Changed("connections")
	return nil
}

func randomURLSafe(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// GoogleSignIn starts signing in and returns the address of Google's
// sign-in page for the person's browser. Google sends the browser back to a
// one-time address on this computer, which finishes the sign-in by itself.
func (e *Engine) GoogleSignIn() (string, error) {
	g := e.GoogleSet()
	if g.ClientID == "" || g.Secret == "" {
		return "", errors.New("Paste the client ID and secret from Google Cloud Console first.")
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", errors.New("Couldn't open a way back from Google on this computer. Try again.")
	}
	redirect := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)
	verifier := randomURLSafe(48)
	sum := sha256.Sum256([]byte(verifier))
	b := make([]byte, 16)
	rand.Read(b)
	state := hex.EncodeToString(b)
	hosts := e.GoogleHosts.or()
	q := url.Values{}
	q.Set("client_id", g.ClientID)
	q.Set("redirect_uri", redirect)
	q.Set("response_type", "code")
	q.Set("scope", GoogleScope)
	q.Set("code_challenge", base64.RawURLEncoding.EncodeToString(sum[:]))
	q.Set("code_challenge_method", "S256")
	q.Set("state", state)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent")

	st := e.gstate()
	si := &googleSignin{at: e.Now()}
	var once sync.Once
	finish := func() {
		once.Do(func() {
			st.mu.Lock()
			if st.signin == si {
				st.signin = nil
			}
			st.mu.Unlock()
			// Let the last page reach the browser, then shut the door.
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				si.srv.Shutdown(ctx)
			}()
			e.S.Changed("connections")
		})
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" || r.Method != "GET" {
			http.NotFound(w, r)
			return
		}
		v := r.URL.Query()
		if v.Get("state") != state {
			// Another page sending the browser here: not this sign-in.
			gcalPage(w, 400, "This isn't the sign-in Job Hunt started", "Go back to Job Hunt and press Sign in with Google again.")
			return
		}
		defer finish()
		if v.Get("error") != "" {
			msg := "You didn't let Job Hunt use your calendar, so nothing changed."
			if v.Get("error") != "access_denied" {
				msg = "Google said no. Check the client ID and secret in Job Hunt, then sign in again."
			}
			e.googleNote(msg)
			gcalPage(w, 200, "Not signed in", msg)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := e.googleExchange(ctx, v.Get("code"), verifier, redirect, v.Get("scope")); err != nil {
			e.googleNote(err.Error())
			gcalPage(w, 200, "Not signed in", err.Error())
			return
		}
		gcalPage(w, 200, "Signed in", "Job Hunt can now keep your interviews in Google Calendar. You can close this tab and go back to Job Hunt.")
		e.GoogleSoon()
	})
	si.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	st.mu.Lock()
	old := st.signin
	st.signin = si
	st.mu.Unlock()
	if old != nil {
		old.srv.Close()
	}
	go si.srv.Serve(ln)
	// A sign-in nobody finishes closes its door after ten minutes.
	time.AfterFunc(10*time.Minute, finish)
	e.S.Changed("connections")
	trace.Log("google", "sign-in started, waiting on a port of this computer")
	return hosts.Auth + "?" + q.Encode(), nil
}

func gcalPage(w http.ResponseWriter, code int, title, text string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(code)
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>Job Hunt</title><body style="font:16px system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px"><h2>%s</h2><p>%s</p></body>`, html.EscapeString(title), html.EscapeString(text))
}

func (e *Engine) googleNote(note string) {
	g := e.GoogleSet()
	g.Note = note
	e.S.Set(gcalKey, g)
	e.S.Changed("connections")
}

type gToken struct {
	Access  string `json:"access_token"`
	Expires int    `json:"expires_in"`
	Refresh string `json:"refresh_token"`
	Scope   string `json:"scope"`
	Error   string `json:"error"`
}

func (e *Engine) tokenCall(ctx context.Context, form url.Values) (gToken, int, error) {
	var t gToken
	req, err := http.NewRequestWithContext(ctx, "POST", e.GoogleHosts.or().Token, strings.NewReader(form.Encode()))
	if err != nil {
		return t, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := e.googleClient().Do(req)
	if err != nil {
		return t, 0, errors.New("Couldn't reach Google. Check the internet connection, then try again.")
	}
	defer resp.Body.Close()
	json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&t)
	return t, resp.StatusCode, nil
}

// googleExchange swaps the code Google sent back for a lasting sign-in.
func (e *Engine) googleExchange(ctx context.Context, code, verifier, redirect, scope string) error {
	if code == "" {
		return errors.New("Google sent no sign-in code. Sign in again.")
	}
	g := e.GoogleSet()
	form := url.Values{"code": {code}, "client_id": {g.ClientID}, "client_secret": {g.Secret}, "redirect_uri": {redirect}, "grant_type": {"authorization_code"}, "code_verifier": {verifier}}
	t, status, err := e.tokenCall(ctx, form)
	if err != nil {
		return err
	}
	if status != 200 || t.Access == "" {
		trace.Log("google", "signing in failed: %d %s", status, t.Error)
		if t.Error == "invalid_client" || t.Error == "unauthorized_client" {
			return errors.New("Google didn't accept the client ID and secret. Copy them again from Clients in Google Cloud Console.")
		}
		return errors.New("Google didn't finish the sign-in. Try again.")
	}
	if !strings.Contains(" "+firstOf(t.Scope, scope)+" ", " "+GoogleScope+" ") {
		return errors.New("Job Hunt wasn't allowed to change calendar events. Sign in again and tick the box for your calendar.")
	}
	if t.Refresh == "" {
		return errors.New("Google gave no lasting sign-in. Remove Job Hunt at myaccount.google.com/permissions, then sign in again.")
	}
	g.Refresh, g.Note = t.Refresh, ""
	if err := e.S.Set(gcalKey, g); err != nil {
		return err
	}
	st := e.gstate()
	st.mu.Lock()
	st.access, st.expires = t.Access, e.Now().Add(tokenLife(t.Expires))
	st.mu.Unlock()
	trace.Log("google", "signed in to Google Calendar")
	e.S.Changed("connections")
	return nil
}

// tokenLife is how long an access token is used: a minute short of what
// Google says, and fifty minutes when it says nothing.
func tokenLife(seconds int) time.Duration {
	if seconds <= 0 {
		seconds = 3060
	}
	return time.Duration(max(seconds-60, 0)) * time.Second
}

var errGoogleOff = errors.New("Sign in with Google first.")

// googleAccess is a fresh access token, made from the refresh token when
// the last one has run out.
func (e *Engine) googleAccess(ctx context.Context) (string, error) {
	st := e.gstate()
	st.mu.Lock()
	if st.access != "" && e.Now().Before(st.expires) {
		a := st.access
		st.mu.Unlock()
		return a, nil
	}
	st.mu.Unlock()
	g := e.GoogleSet()
	if g.Refresh == "" {
		return "", errGoogleOff
	}
	t, status, err := e.tokenCall(ctx, url.Values{"client_id": {g.ClientID}, "client_secret": {g.Secret}, "refresh_token": {g.Refresh}, "grant_type": {"refresh_token"}})
	if err != nil {
		return "", err
	}
	if status != 200 || t.Access == "" {
		trace.Log("google", "renewing the sign-in failed: %d %s", status, t.Error)
		if t.Error == "invalid_grant" {
			// The sign-in ended: taken back in the Google account, or left
			// in Testing, where Google ends it after seven days.
			g.Refresh = ""
			e.S.Set(gcalKey, g)
			return "", errors.New("Google ended the sign-in. Sign in with Google again. If this happens every week, press Publish app under Audience in Google Cloud Console.")
		}
		if t.Error == "invalid_client" {
			return "", errors.New("Google no longer accepts the client ID and secret. Paste them again from Google Cloud Console.")
		}
		return "", fmt.Errorf("Google didn't answer properly (%d). Try again later.", status)
	}
	st.mu.Lock()
	st.access, st.expires = t.Access, e.Now().Add(tokenLife(t.Expires))
	st.mu.Unlock()
	return t.Access, nil
}

func (e *Engine) googleClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second}
}

type gStatus struct{ code int }

func (s gStatus) Error() string {
	return fmt.Sprintf("Google Calendar answered with an error (%d)", s.code)
}

func gGone(err error) bool {
	var s gStatus
	return errors.As(err, &s) && (s.code == 404 || s.code == 410)
}

// gcall makes one Calendar API call. Paths and statuses go into the
// debugging record; tokens and what was sent or read do not.
func (e *Engine) gcall(ctx context.Context, method, path string, body, out any) error {
	tok, err := e.googleAccess(ctx)
	if err != nil {
		return err
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, e.GoogleHosts.or().API+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := e.googleClient().Do(req)
	if err != nil {
		return errors.New("Couldn't reach Google Calendar. Check the internet connection, then try again.")
	}
	defer resp.Body.Close()
	short, _, _ := strings.Cut(path, "?")
	if resp.StatusCode == 401 {
		st := e.gstate()
		st.mu.Lock()
		st.access = ""
		st.mu.Unlock()
	}
	if resp.StatusCode/100 != 2 {
		trace.Log("google", "%s %s -> %d", method, short, resp.StatusCode)
		if resp.StatusCode == 403 {
			return errors.New("Google Calendar refused. Check that the Google Calendar API is turned on in your Google Cloud project.")
		}
		return gStatus{resp.StatusCode}
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out)
	}
	return nil
}

// ---- events -------------------------------------------------------------------

type gTime struct {
	DateTime string `json:"dateTime,omitempty"`
	Date     string `json:"date,omitempty"`
}

type gReminder struct {
	Method  string `json:"method"`
	Minutes int    `json:"minutes"`
}

type gReminders struct {
	UseDefault bool        `json:"useDefault"`
	Overrides  []gReminder `json:"overrides,omitempty"`
}

type gAttendee struct {
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Self        bool   `json:"self,omitempty"`
}

type gExt struct {
	Private map[string]string `json:"private,omitempty"`
}

type gEvent struct {
	ID                 string      `json:"id,omitempty"`
	Status             string      `json:"status,omitempty"`
	Summary            string      `json:"summary,omitempty"`
	Description        string      `json:"description,omitempty"`
	Location           string      `json:"location,omitempty"`
	Start              *gTime      `json:"start,omitempty"`
	End                *gTime      `json:"end,omitempty"`
	Transparency       string      `json:"transparency,omitempty"`
	Reminders          *gReminders `json:"reminders,omitempty"`
	Attendees          []gAttendee `json:"attendees,omitempty"`
	ExtendedProperties *gExt       `json:"extendedProperties,omitempty"`
}

func (ev gEvent) ours() string {
	if ev.ExtendedProperties == nil {
		return ""
	}
	return ev.ExtendedProperties.Private["jobhunt"]
}

// times reads when an entry is. Whole-day entries are midnight to midnight here.
func (ev gEvent) times(loc *time.Location) (start, end int64, allDay, ok bool) {
	if ev.Start == nil || ev.End == nil {
		return 0, 0, false, false
	}
	if ev.Start.DateTime != "" {
		a, err1 := time.Parse(time.RFC3339, ev.Start.DateTime)
		b, err2 := time.Parse(time.RFC3339, ev.End.DateTime)
		return a.Unix(), b.Unix(), false, err1 == nil && err2 == nil
	}
	a, err1 := time.ParseInLocation("2006-01-02", ev.Start.Date, loc)
	b, err2 := time.ParseInLocation("2006-01-02", ev.End.Date, loc)
	return a.Unix(), b.Unix(), true, err1 == nil && err2 == nil
}

func rfc(ts int64, loc *time.Location) *gTime {
	return &gTime{DateTime: time.Unix(ts, 0).In(loc).Format(time.RFC3339)}
}

const gPrepMinutes = 60

// gMinutes is how long a conversation is in Google Calendar; links keep
// this, so a short one doesn't look changed there on every sync.
func gMinutes(m int) int { return max(m, 5) }

func prepMinutes(t store.Talk) int {
	if t.Kind == "chat" {
		return 30
	}
	return gPrepMinutes
}

// talkSum changes when the words Job Hunt writes into the entry change.
func talkSum(t store.Talk) string {
	h := sha256.Sum256([]byte(strings.Join([]string{t.Kind, t.Title, t.Company, t.Role, t.Person, t.Link}, "\x00")))
	return hex.EncodeToString(h[:8])
}

func talkSummary(t store.Talk) string {
	title := firstOf(t.Title, "Conversation")
	if t.Company != "" && !strings.Contains(strings.ToLower(title), strings.ToLower(t.Company)) {
		title += ": " + t.Company
	}
	return title
}

// gReminderPlan is what Job Hunt already says before a conversation: the
// evening before (at six) with the prep pack, and half an hour before.
func gReminderPlan(at int64, loc *time.Location) []gReminder {
	out := []gReminder{{Method: "popup", Minutes: 30}}
	start := time.Unix(at, 0).In(loc)
	eve := dayStart(start).AddDate(0, 0, -1).Add(18 * time.Hour)
	if m := int(start.Sub(eve).Minutes()); m > 60 && m <= 40320 {
		out = append(out, gReminder{Method: "popup", Minutes: m})
	}
	return out
}

func (e *Engine) talkEvent(t store.Talk) gEvent {
	loc := e.Now().Location()
	var desc []string
	if t.Role != "" {
		desc = append(desc, "Role: "+joinNonEmpty(" at ", t.Role, t.Company))
	}
	if t.Person != "" {
		desc = append(desc, "With: "+t.Person)
	}
	desc = append(desc, "Your prep pack: "+e.BaseURL+fmt.Sprintf("#/interviews/%d", t.ID), "Kept up to date by Job Hunt.")
	return gEvent{
		Summary: talkSummary(t), Description: strings.Join(desc, "\n"), Location: safeURL(t.Link),
		Start: rfc(t.At, loc), End: rfc(t.At+int64(gMinutes(t.Minutes))*60, loc),
		Reminders:          &gReminders{Overrides: gReminderPlan(t.At, loc)},
		ExtendedProperties: &gExt{Private: map[string]string{"jobhunt": "talk", "jobhuntTalk": strconv.FormatInt(t.ID, 10)}},
	}
}

func (e *Engine) prepEvent(t store.Talk) gEvent {
	loc := e.Now().Location()
	m := prepMinutes(t)
	return gEvent{
		Summary:     "Prep: " + talkSummary(t),
		Description: "Time to go through your prep pack: " + e.BaseURL + fmt.Sprintf("#/interviews/%d", t.ID),
		Start:       rfc(t.At-int64(m)*60, loc), End: rfc(t.At, loc), Transparency: "transparent",
		Reminders:          &gReminders{Overrides: []gReminder{{Method: "popup", Minutes: 10}}},
		ExtendedProperties: &gExt{Private: map[string]string{"jobhunt": "prep", "jobhuntTalk": strconv.FormatInt(t.ID, 10)}},
	}
}

func (e *Engine) gLinks() map[int64]gLink {
	links := map[int64]gLink{}
	e.S.Get(gcalLinks, &links)
	return links
}

const gEventsPath = "/calendars/primary/events"

func (e *Engine) gList(ctx context.Context, from, to time.Time) ([]gEvent, error) {
	var out []gEvent
	page := ""
	for i := 0; i < 10; i++ {
		q := url.Values{"timeMin": {from.UTC().Format(time.RFC3339)}, "timeMax": {to.UTC().Format(time.RFC3339)}, "singleEvents": {"true"}, "showDeleted": {"true"}, "maxResults": {"250"}}
		if page != "" {
			q.Set("pageToken", page)
		}
		var res struct {
			Items []gEvent `json:"items"`
			Next  string   `json:"nextPageToken"`
		}
		if err := e.gcall(ctx, "GET", gEventsPath+"?"+q.Encode(), nil, &res); err != nil {
			return nil, err
		}
		out = append(out, res.Items...)
		if res.Next == "" {
			break
		}
		page = res.Next
	}
	return out, nil
}

func evPath(id string) string { return gEventsPath + "/" + url.PathEscape(id) }

// ---- syncing ------------------------------------------------------------------

// GoogleSoon syncs in the background, unless a sync is running.
func (e *Engine) GoogleSoon() {
	if !e.GoogleOn() {
		return
	}
	e.Go("google", "Syncing with Google Calendar", e.SyncGoogle)
}

// googleDirty says whether a conversation changed here since it was last
// put into Google Calendar. It reads only this computer.
func (e *Engine) googleDirty() bool {
	now := e.Now()
	links := e.gLinks()
	talks, _ := e.S.Talks(now.Add(-time.Hour).Unix(), now.Add(gcalAhead).Unix())
	seen := map[int64]bool{}
	for _, t := range talks {
		seen[t.ID] = true
		l, ok := links[t.ID]
		if !ok || l.At != t.At || l.Minutes != gMinutes(t.Minutes) || (!l.Adopted && l.Sum != talkSum(t)) {
			return true
		}
	}
	for id := range links {
		if !seen[id] {
			if _, err := e.S.Talk(id); errors.Is(err, store.ErrNotFound) {
				return true
			}
		}
	}
	return false
}

// SyncGoogle takes back what changed in Google Calendar, then puts there
// what changed here.
func (e *Engine) SyncGoogle(ctx context.Context) error {
	if !e.GoogleOn() {
		return nil
	}
	st := e.gstate()
	if !st.syncMu.TryLock() {
		return nil
	}
	defer st.syncMu.Unlock()
	err := e.syncGoogle(ctx)
	g := e.GoogleSet()
	if err != nil {
		g.Note = err.Error()
	} else {
		g.Note, g.At = "", e.Now().Unix()
	}
	e.S.Set(gcalKey, g)
	e.S.Changed("connections", "talks")
	return err
}

func (e *Engine) syncGoogle(ctx context.Context) error {
	now := e.Now()
	loc := now.Location()
	events, err := e.gList(ctx, now.Add(-gcalBehind), now.Add(gcalAhead))
	if err != nil {
		return err
	}
	byID := map[string]gEvent{}
	for _, ev := range events {
		byID[ev.ID] = ev
	}
	links := e.gLinks()
	save := func() { e.S.Set(gcalLinks, links) }

	// What changed in Google Calendar.
	for id, l := range links {
		t, terr := e.S.Talk(id)
		if errors.Is(terr, store.ErrNotFound) {
			continue // removed here: handled below
		}
		if terr != nil {
			continue
		}
		if t.At < now.Add(-gcalBehind).Unix() {
			delete(links, id) // in the past: no longer followed
			continue
		}
		ev, ok := byID[l.Event]
		if !ok {
			// Moved out of the window, or gone.
			var one gEvent
			if err := e.gcall(ctx, "GET", evPath(l.Event), nil, &one); err != nil {
				var st gStatus
				if !gGone(err) {
					return err
				}
				if errors.As(err, &st) && st.code == 410 {
					one = gEvent{ID: l.Event, Status: "cancelled"} // Google says it was deleted
				}
			}
			if one.ID == "" {
				// Not there at all, which is not the same as deleted (a
				// different account, a calendar emptied): the conversation
				// stays here and is put into Google Calendar again.
				if l.Prep != "" {
					if err := e.gcall(ctx, "DELETE", evPath(l.Prep), nil, nil); err != nil && !gGone(err) {
						return err
					}
				}
				trace.Log("google", "a conversation's entry is not in Google Calendar any more; putting it back")
				delete(links, id)
				save()
				continue
			}
			ev = one
		}
		if ev.Status == "cancelled" {
			if l.Prep != "" {
				if err := e.gcall(ctx, "DELETE", evPath(l.Prep), nil, nil); err != nil && !gGone(err) {
					return err
				}
			}
			delete(links, id)
			save()
			if t.At >= now.Add(-time.Hour).Unix() {
				// What the person wrote about it is kept with the role's own notes.
				if strings.TrimSpace(t.Notes) != "" && t.RoleID != 0 {
					var mine RoleNotes
					e.S.Doc(t.RoleID, "mynotes", &mine)
					kept := strings.TrimSpace(mine.Text)
					if kept != "" {
						kept += "\n\n"
					}
					kept += fmt.Sprintf("From the %s on %s (removed in Google Calendar):\n%s", strings.ToLower(firstOf(t.Title, "conversation")), time.Unix(t.At, 0).In(loc).Format("2 January"), strings.TrimSpace(t.Notes))
					e.SaveRoleNotes(t.RoleID, kept)
				}
				e.S.DeleteTalk(t.ID)
				e.S.Log(store.Activity{Kind: "talk", RoleID: t.RoleID, PersonID: t.PersonID, CompanyID: t.CompanyID,
					Text: fmt.Sprintf("Removed in Google Calendar: %s on %s", strings.ToLower(firstOf(t.Title, "conversation")), time.Unix(t.At, 0).In(loc).Format("Monday 2 January at 15:04"))})
			}
			continue
		}
		start, end, allDay, ok := ev.times(loc)
		if !ok || allDay {
			continue // made a whole-day entry, or unreadable: left as it is here
		}
		minutes := int((end - start) / 60)
		if start == l.At && minutes == l.Minutes {
			continue
		}
		before := t.At
		t.At, t.Minutes = start, gMinutes(minutes)
		if err := e.S.SaveTalk(t); err != nil {
			return err
		}
		l.At, l.Minutes = t.At, minutes
		if !l.Adopted {
			l.Sum = "" // sent again, so its reminders fit the new time
		}
		links[id] = l
		save()
		text := fmt.Sprintf("Moved in Google Calendar: %s, from %s to %s", strings.ToLower(firstOf(t.Title, "conversation")),
			time.Unix(before, 0).In(loc).Format("Monday 2 January at 15:04"), time.Unix(t.At, 0).In(loc).Format("Monday 2 January at 15:04"))
		if before == t.At {
			text = fmt.Sprintf("Changed in Google Calendar: %s now lasts %d minutes", strings.ToLower(firstOf(t.Title, "conversation")), t.Minutes)
		}
		e.S.Log(store.Activity{Kind: "talk", RoleID: t.RoleID, PersonID: t.PersonID, CompanyID: t.CompanyID, Text: text})
	}
	save()

	// What changed here.
	if err := e.pushGoogle(ctx, links, save); err != nil {
		return err
	}

	// The rest of the calendar: busy times, and entries that look like an
	// interview with an employer the person has a role with.
	mine := map[string]bool{}
	for _, l := range links {
		mine[l.Event], mine[l.Prep] = true, true
	}
	var own []OwnEvent
	for _, ev := range events {
		if ev.Status == "cancelled" || ev.ours() != "" || mine[ev.ID] {
			continue
		}
		s, en, allDay, ok := ev.times(loc)
		if !ok {
			continue
		}
		own = append(own, OwnEvent{Start: s, End: en, Title: clipText(strings.TrimSpace(ev.Summary), 200), AllDay: allDay, Free: ev.Transparency == "transparent"})
	}
	sort.SliceStable(own, func(i, j int) bool { return own[i].Start < own[j].Start })
	if own == nil {
		own = []OwnEvent{}
	}
	e.S.Set(gcalEvents, own)
	e.S.Set(gcalLooks, e.lookalikes(events, mine))
	return nil
}

func (e *Engine) pushGoogle(ctx context.Context, links map[int64]gLink, save func()) error {
	now := e.Now()
	// Removed here: out of Google Calendar too. An entry that was the
	// person's own before it was linked stays theirs.
	for id, l := range links {
		if _, err := e.S.Talk(id); !errors.Is(err, store.ErrNotFound) {
			continue
		}
		gone := []string{l.Prep}
		if !l.Adopted {
			gone = append(gone, l.Event)
		}
		for _, ev := range gone {
			if ev == "" {
				continue
			}
			if err := e.gcall(ctx, "DELETE", evPath(ev), nil, nil); err != nil && !gGone(err) {
				return err
			}
		}
		delete(links, id)
		save()
	}
	talks, err := e.S.Talks(now.Add(-time.Hour).Unix(), now.Add(gcalAhead).Unix())
	if err != nil {
		return err
	}
	for _, t := range talks {
		l, ok := links[t.ID]
		want := e.talkEvent(t)
		switch {
		case !ok:
			var made gEvent
			if err := e.gcall(ctx, "POST", gEventsPath, want, &made); err != nil {
				return err
			}
			l = gLink{Event: made.ID}
		case l.Adopted && (l.At != t.At || l.Minutes != gMinutes(t.Minutes)):
			if err := e.gcall(ctx, "PATCH", evPath(l.Event), gEvent{Start: want.Start, End: want.End}, nil); err != nil {
				if !gGone(err) {
					return err
				}
			}
		case !l.Adopted && (l.At != t.At || l.Minutes != gMinutes(t.Minutes) || l.Sum != talkSum(t)):
			if err := e.gcall(ctx, "PATCH", evPath(l.Event), want, nil); err != nil {
				if !gGone(err) {
					return err
				}
				// Gone there without this program seeing it: put it back.
				var made gEvent
				if err := e.gcall(ctx, "POST", gEventsPath, want, &made); err != nil {
					return err
				}
				l.Event = made.ID
			}
		}
		l.At, l.Minutes, l.Sum = t.At, gMinutes(t.Minutes), talkSum(t)
		links[t.ID] = l
		save()
		// The prep block ends where the conversation starts.
		prep := e.prepEvent(t)
		prepAt := t.At - int64(prepMinutes(t))*60
		if t.At > now.Unix() && (l.Prep == "" || l.PrepAt != prepAt) {
			if l.Prep != "" {
				if err := e.gcall(ctx, "PATCH", evPath(l.Prep), prep, nil); err != nil {
					if !gGone(err) {
						return err
					}
					l.Prep = ""
				}
			}
			if l.Prep == "" {
				var made gEvent
				if err := e.gcall(ctx, "POST", gEventsPath, prep, &made); err != nil {
					return err
				}
				l.Prep = made.ID
			}
			l.PrepAt = prepAt
			links[t.ID] = l
			save()
		}
	}
	return nil
}

// ---- entries that look like an interview -------------------------------------------

var companyTail = regexp.MustCompile(`(?i)[\s,]+(inc|inc\.|ltd|ltd\.|llc|llp|plc|corp|corp\.|corporation|limited|co\.|gmbh|group|canada|technologies|holdings)$`)

// employerWords is the part of an employer's name worth looking for.
func employerWords(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	for i := 0; i < 3; i++ {
		n = strings.TrimSpace(companyTail.ReplaceAllString(n, ""))
	}
	return n
}

func namesWord(hay, word string) bool {
	if word == "" {
		return false
	}
	re, err := regexp.Compile(`(^|[^\p{L}\p{N}])` + regexp.QuoteMeta(word) + `($|[^\p{L}\p{N}])`)
	return err == nil && re.MatchString(hay)
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func (e *Engine) lookalikes(events []gEvent, mine map[string]bool) []GoogleLookalike {
	out := []GoogleLookalike{}
	roles, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"applied", "reply", "interview", "offer"}, Limit: 1000})
	type emp struct {
		words, squashed string
		name            string
		id              int64
		roles           []LookRole
	}
	byCo := map[int64]*emp{}
	var emps []*emp
	for _, r := range roles {
		if r.Closed != "" {
			continue
		}
		em := byCo[r.CompanyID]
		if em == nil {
			w := employerWords(r.Company)
			if len([]rune(w)) < 3 {
				continue
			}
			em = &emp{words: w, squashed: nonAlnum.ReplaceAllString(w, ""), name: r.Company, id: r.CompanyID}
			byCo[r.CompanyID] = em
			emps = append(emps, em)
		}
		em.roles = append(em.roles, LookRole{ID: r.ID, Title: r.Title})
	}
	if len(emps) == 0 {
		return out
	}
	var no []string
	e.S.Get(gcalNo, &no)
	dismissed := map[string]bool{}
	for _, id := range no {
		dismissed[id] = true
	}
	loc := e.Now().Location()
	now := e.Now().Unix()
	for _, ev := range events {
		if ev.Status == "cancelled" || ev.ours() != "" || mine[ev.ID] || dismissed[ev.ID] {
			continue
		}
		s, en, allDay, ok := ev.times(loc)
		if !ok || allDay || en < now {
			continue
		}
		title := strings.ToLower(ev.Summary)
		for _, em := range emps {
			hit := namesWord(title, em.words)
			for _, a := range ev.Attendees {
				if hit || a.Self {
					continue
				}
				_, domain, _ := strings.Cut(strings.ToLower(a.Email), "@")
				first, _, _ := strings.Cut(domain, ".")
				hit = namesWord(strings.ToLower(a.DisplayName), em.words) || (len(em.squashed) >= 3 && first == em.squashed)
			}
			if hit {
				out = append(out, GoogleLookalike{ID: ev.ID, Title: clipText(strings.TrimSpace(ev.Summary), 200), Start: s, End: en, Company: em.name, CompanyID: em.id, Roles: em.roles})
				break
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// GoogleLookalikes are the entries offered with "Link to application".
func (e *Engine) GoogleLookalikes() []GoogleLookalike {
	out := []GoogleLookalike{}
	if !e.GoogleOn() {
		return out
	}
	e.S.Get(gcalLooks, &out)
	return out
}

// LinkGoogleEvent ties an entry in the person's Google Calendar to one of
// their roles as an interview. Only the person's button calls it, and only
// for an entry and a role that were offered together.
func (e *Engine) LinkGoogleEvent(eventID string, roleID int64) (int64, error) {
	var found *GoogleLookalike
	looks := e.GoogleLookalikes()
	for i := range looks {
		if looks[i].ID == eventID {
			found = &looks[i]
		}
	}
	if found == nil {
		return 0, errors.New("That entry is no longer offered. Sync with Google again.")
	}
	ok := false
	for _, r := range found.Roles {
		ok = ok || r.ID == roleID
	}
	if !ok {
		return 0, errors.New("Choose one of the roles offered for this entry.")
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return 0, err
	}
	if r.Closed != "" {
		// A closed role, "not interested" among them, is never reopened here.
		return 0, errors.New("That role is closed. Reopen it first if you want to link this entry to it.")
	}
	// No sync may run between adding the interview and noting that it is
	// already in Google Calendar, or it would be put there twice.
	defer e.GoogleSoon() // then the prep block goes in, after the lock is let go
	st := e.gstate()
	st.syncMu.Lock()
	defer st.syncMu.Unlock()
	id, err := e.AddTalk(store.Talk{Kind: "interview", RoleID: roleID, Title: "Interview", At: found.Start, Minutes: max(int((found.End-found.Start)/60), 5)})
	if err != nil {
		return 0, err
	}
	t, _ := e.S.Talk(id)
	links := e.gLinks()
	links[id] = gLink{Event: eventID, At: t.At, Minutes: gMinutes(t.Minutes), Sum: talkSum(t), Adopted: true}
	e.S.Set(gcalLinks, links)
	kept := []GoogleLookalike{}
	for _, l := range looks {
		if l.ID != eventID {
			kept = append(kept, l)
		}
	}
	e.S.Set(gcalLooks, kept)
	e.S.Log(store.Activity{Kind: "talk", RoleID: roleID, CompanyID: r.CompanyID, Text: "Linked an entry in Google Calendar to this role as an interview on " + time.Unix(t.At, 0).In(e.Now().Location()).Format("Monday 2 January at 15:04")})
	e.S.Changed("talks", "connections")
	return id, nil
}

// TalkInGoogle says whether a conversation is kept in Google Calendar.
func (e *Engine) TalkInGoogle(id int64) bool {
	if !e.GoogleOn() {
		return false
	}
	_, ok := e.gLinks()[id]
	return ok
}

// DismissGoogleEvent stops offering an entry.
func (e *Engine) DismissGoogleEvent(eventID string) error {
	var no []string
	e.S.Get(gcalNo, &no)
	no = append(no, eventID)
	if len(no) > 500 {
		no = no[len(no)-500:]
	}
	e.S.Set(gcalNo, no)
	kept := []GoogleLookalike{}
	for _, l := range e.GoogleLookalikes() {
		if l.ID != eventID {
			kept = append(kept, l)
		}
	}
	e.S.Set(gcalLooks, kept)
	e.S.Changed("talks", "connections")
	return nil
}

// TestGoogle checks the sign-in by reading one entry.
func (e *Engine) TestGoogle(ctx context.Context) (string, error) {
	if !e.GoogleOn() {
		return "", errGoogleOff
	}
	var res struct {
		Items []gEvent `json:"items"`
	}
	q := url.Values{"maxResults": {"1"}, "timeMin": {e.Now().UTC().Format(time.RFC3339)}, "singleEvents": {"true"}}
	if err := e.gcall(ctx, "GET", gEventsPath+"?"+q.Encode(), nil, &res); err != nil {
		e.googleNote(err.Error())
		return "", err
	}
	g := e.GoogleSet()
	if g.Note != "" {
		g.Note = ""
		e.S.Set(gcalKey, g)
		e.S.Changed("connections")
	}
	return "Working: Google Calendar answered.", nil
}

// forgetGoogle drops the sign-in and what was read with it. Entries already
// in Google Calendar stay there: they are the person's now.
func (e *Engine) forgetGoogle() {
	st := e.gstate()
	st.mu.Lock()
	st.access, st.expires = "", time.Time{}
	if st.signin != nil {
		st.signin.srv.Close()
		st.signin = nil
	}
	st.mu.Unlock()
	e.S.Set(gcalLinks, map[int64]gLink{})
	e.S.Set(gcalLooks, []GoogleLookalike{})
	e.S.Set(gcalEvents, []OwnEvent{})
}

// GoogleSignOut ends the sign-in, asking Google to forget it too. The
// client ID and secret stay, so signing in again is one button.
func (e *Engine) GoogleSignOut(ctx context.Context) error {
	g := e.GoogleSet()
	if g.Refresh != "" {
		req, err := http.NewRequestWithContext(ctx, "POST", e.GoogleHosts.or().Revoke, strings.NewReader(url.Values{"token": {g.Refresh}}.Encode()))
		if err == nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			if resp, err := e.googleClient().Do(req); err == nil {
				resp.Body.Close()
			}
		}
	}
	e.forgetGoogle()
	g.Refresh, g.Note, g.At = "", "", 0
	err := e.S.Set(gcalKey, g)
	e.S.Changed("connections", "talks")
	return err
}

// ForgetGoogle signs out and removes the client ID and secret as well.
func (e *Engine) ForgetGoogle(ctx context.Context) error {
	e.GoogleSignOut(ctx)
	err := e.S.Set(gcalKey, GoogleSet{})
	e.S.Changed("connections")
	return err
}
