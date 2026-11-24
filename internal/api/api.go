// Package api is the local interface: the pages and the browser extension
// talk to Job Hunt through it. It listens on this computer only.
package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/engine"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// Version is shown under You → The app.
var Version = "preview"

// Server serves the pages and the API.
type Server struct {
	E    *engine.Engine
	S    *store.Store
	Web  fs.FS
	Port int
	Quit func() // stops the program; set by main

	mu      sync.Mutex
	pending ExtSet // the extension asking to connect, if any
}

// ExtSet is the paired browser extension. The extension makes up a secret
// key and sends it with every request; only the key's SHA-256 is kept here.
type ExtSet struct {
	ID       string `json:"id"`
	KeyHash  string `json:"key_hash,omitempty"`
	PairedAt int64  `json:"paired_at"`
}

// Code is the short code shown in both the side panel and the app, so the
// person can see they are approving the panel in front of them.
func (x ExtSet) Code() string {
	if len(x.KeyHash) < 6 {
		return ""
	}
	return strings.ToUpper(x.KeyHash[:6])
}

func hashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func validKey(key string) bool {
	if len(key) < 32 || len(key) > 128 {
		return false
	}
	for _, c := range key {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

type apiError struct {
	code int
	msg  string
}

func (e *apiError) Error() string { return e.msg }

func bad(msg string) error { return &apiError{400, msg} }

type handler func(w http.ResponseWriter, r *http.Request) (any, error)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(lists(v))
}

// say turns an error into words for the person.
func say(err error) (int, string) {
	var ae *apiError
	var lim *llm.LimitError
	var auth *llm.AuthError
	switch {
	case errors.As(err, &ae):
		return ae.code, ae.msg
	case errors.Is(err, store.ErrNotFound):
		return 404, "That isn't here any more."
	case errors.Is(err, llm.ErrNotConnected):
		return 409, "Claude isn't connected yet. Connect it under You → Connections."
	case errors.As(err, &lim):
		return 429, lim.Msg
	case errors.As(err, &auth):
		return 401, auth.Msg
	case errors.Is(err, context.DeadlineExceeded):
		return 504, "That took too long. Try again."
	}
	return 400, err.Error()
}

func (s *Server) wrap(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := h(w, r)
		if err != nil {
			code, msg := say(err)
			writeJSON(w, code, map[string]string{"error": msg})
			return
		}
		if out == nil {
			out = map[string]bool{"ok": true}
		}
		if _, raw := out.(noBody); raw {
			return
		}
		writeJSON(w, 200, out)
	}
}

type noBody struct{}

func idOf(r *http.Request) int64 {
	n, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return n
}

func qInt(r *http.Request, key string, def int) int {
	if n, err := strconv.Atoi(r.URL.Query().Get(key)); err == nil {
		return n
	}
	return def
}

func read(r *http.Request, out any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		return bad("couldn't read the request")
	}
	if len(b) == 0 {
		return nil
	}
	if err := json.Unmarshal(b, out); err != nil {
		return bad("couldn't understand the request")
	}
	return nil
}

func (s *Server) origin() string { return fmt.Sprintf("http://127.0.0.1:%d", s.Port) }

func (s *Server) ext() ExtSet {
	var x ExtSet
	s.S.Get("ext", &x)
	return x
}

// guard keeps everyone but this computer's own pages and the one approved
// extension out.
func (s *Server) guard(next http.Handler) http.Handler {
	hosts := map[string]bool{fmt.Sprintf("127.0.0.1:%d", s.Port): true, fmt.Sprintf("localhost:%d", s.Port): true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A page on the internet that points a name at 127.0.0.1 arrives with
		// its own name in Host.
		if !hosts[r.Host] {
			http.Error(w, "not here", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
			next.ServeHTTP(w, r)
			return
		}
		o := r.Header.Get("Origin")
		key := r.Header.Get("X-JobHunt-Ext")
		extOrigin := strings.HasPrefix(o, "chrome-extension://")
		own := key == "" && (o == "" || o == s.origin() || o == fmt.Sprintf("http://localhost:%d", s.Port))
		// The browser leaves Origin off some of an extension's requests, so
		// the extension is known by the key it sends, not by where it says
		// it comes from.
		fromExt := extOrigin || (o == "" && key != "")
		switch {
		case own:
			// A browser says when a request was started by some other site
			// (an image or script tag pointed here). Those get nothing.
			if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
				http.Error(w, "not allowed", http.StatusForbidden)
				return
			}
			// Our own pages always send the marker header on anything that
			// changes something; a form on another site cannot.
			if r.Method != "GET" && r.Header.Get("X-JobHunt") != "1" {
				http.Error(w, "not allowed", http.StatusForbidden)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/ext/") && r.URL.Path != "/api/ext/pair" && r.URL.Path != "/api/ext/unpair" {
				http.Error(w, "not allowed", http.StatusForbidden)
				return
			}
		case fromExt:
			if !strings.HasPrefix(r.URL.Path, "/api/ext/") {
				http.Error(w, "not allowed", http.StatusForbidden)
				return
			}
			if extOrigin {
				w.Header().Set("Access-Control-Allow-Origin", o)
				w.Header().Set("Vary", "Origin")
				if r.Method == http.MethodOptions {
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-JobHunt-Ext")
					w.Header().Set("Access-Control-Max-Age", "600")
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			if !validKey(key) {
				writeJSON(w, 403, map[string]string{"error": "This side panel didn't say who it is. Reload the extension."})
				return
			}
			hash := hashKey(key)
			if x := s.ext(); x.KeyHash == "" || subtle.ConstantTimeCompare([]byte(x.KeyHash), []byte(hash)) != 1 {
				if r.URL.Path == "/api/ext/hello" {
					id := strings.TrimPrefix(o, "chrome-extension://")
					if !validExtID(id) {
						id = ""
					}
					s.mu.Lock()
					changed := s.pending.KeyHash != hash
					s.pending = ExtSet{ID: id, KeyHash: hash}
					s.mu.Unlock()
					if changed {
						s.S.Changed("connections", "state")
					}
				}
				writeJSON(w, 403, map[string]string{"error": "Open Job Hunt and approve this side panel under You, Connections.", "pair": "pending"})
				return
			}
		default:
			http.Error(w, "not allowed", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func validExtID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, c := range id {
		if c < 'a' || c > 'p' {
			return false
		}
	}
	return true
}

// Handler builds the whole HTTP surface.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	h := func(pattern string, fn handler) { mux.HandleFunc(pattern, s.wrap(fn)) }
	e, st := s.E, s.S

	// ---- the shell --------------------------------------------------------------
	h("GET /api/state", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.state(), nil })
	mux.HandleFunc("GET /api/events", s.events)

	// ---- today ------------------------------------------------------------------
	h("GET /api/today", func(w http.ResponseWriter, r *http.Request) (any, error) {
		b := e.Today()
		e.MarkSeen()
		return b, nil
	})
	h("POST /api/questions/{id}/answer", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Answer string `json:"answer"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		return nil, e.Answer(idOf(r), in.Answer)
	})
	h("POST /api/ask", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Text string `json:"text"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		return e.Ask(r.Context(), in.Text)
	})
	h("GET /api/find", func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(q) < 2 {
			return map[string]any{"roles": []any{}, "people": []any{}, "companies": []any{}}, nil
		}
		roles, _, _ := st.Roles(store.RoleFilter{Search: q, Closed: []string{"", "rejected", "expired", "withdrawn"}, Limit: 6, Sort: "fit"})
		people, _ := st.People(store.PeopleFilter{Search: q})
		if len(people) > 5 {
			people = people[:5]
		}
		var comps []store.Company
		all, _ := st.Companies("following", "suggested")
		for _, c := range all {
			if strings.Contains(strings.ToLower(c.Name), strings.ToLower(q)) && len(comps) < 5 {
				comps = append(comps, c)
			}
		}
		return map[string]any{"roles": roles, "people": people, "companies": comps}, nil
	})

	// ---- setup, profile, CVs ------------------------------------------------------
	h("GET /api/profile", func(w http.ResponseWriter, r *http.Request) (any, error) { return st.Profile(), nil })
	h("PUT /api/profile", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p := st.Profile()
		done := p.SetupDone
		if err := read(r, &p); err != nil {
			return nil, err
		}
		p.SetupDone = done
		p.City, p.Country, p.Name = strings.TrimSpace(p.City), strings.TrimSpace(p.Country), strings.TrimSpace(p.Name)
		if p.ArriveOn != "" {
			if _, err := time.Parse("2006-01-02", p.ArriveOn); err != nil {
				return nil, bad("The arrival date should look like 2027-01-15.")
			}
		}
		for i := range p.Domain {
			p.Domain[i] = strings.ToLower(strings.TrimSpace(p.Domain[i]))
		}
		if err := st.SaveProfile(p); err != nil {
			return nil, err
		}
		return st.Profile(), nil
	})
	h("POST /api/setup/finish", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p := st.Profile()
		if cvs, _ := st.CVs(); len(cvs) == 0 {
			return nil, bad("Add your CV first.")
		}
		if p.City == "" {
			return nil, bad("Say which city you want to work in.")
		}
		if len(p.Titles.All()) == 0 {
			return nil, bad("Add at least one job title to look for.")
		}
		return nil, e.FinishSetup()
	})
	h("GET /api/cvs", func(w http.ResponseWriter, r *http.Request) (any, error) {
		cvs, err := st.CVs()
		for i := range cvs {
			cvs[i].Text = ""
		}
		return cvs, err
	})
	h("POST /api/cvs", func(w http.ResponseWriter, r *http.Request) (any, error) {
		name := path.Base(strings.ReplaceAll(r.URL.Query().Get("name"), `\`, "/"))
		data, err := io.ReadAll(io.LimitReader(r.Body, 15<<20))
		if err != nil || len(data) == 0 {
			return nil, bad("That file is empty.")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
		defer cancel()
		c, prop, err := e.AddCV(ctx, name, data)
		if err != nil {
			return nil, err
		}
		c.Text = ""
		return map[string]any{"cv": c, "proposal": prop, "profile": st.Profile()}, nil
	})
	h("PUT /api/cvs/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		c, err := st.CV(idOf(r))
		if err != nil {
			return nil, err
		}
		var in struct {
			Name, Focus *string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if in.Name != nil && strings.TrimSpace(*in.Name) != "" {
			c.Name = strings.TrimSpace(*in.Name)
		}
		if in.Focus != nil {
			c.Focus = strings.TrimSpace(*in.Focus)
		}
		return nil, st.UpdateCV(c)
	})
	h("DELETE /api/cvs/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if cvs, _ := st.CVs(); len(cvs) <= 1 {
			return nil, bad("Keep at least one CV. Add the new one first, then remove this one.")
		}
		return nil, st.DeleteCV(idOf(r))
	})
	h("GET /api/cvs/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		m, err := e.CVModel(idOf(r))
		return m, err
	})
	h("GET /api/cvs/{id}/file", func(w http.ResponseWriter, r *http.Request) (any, error) {
		f, err := e.BaseCVFile(idOf(r))
		return sendFile(w, f.Name, f.Data, err)
	})

	// ---- roles ---------------------------------------------------------------------
	h("GET /api/roles", func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := r.URL.Query()
		size := min(max(qInt(r, "size", 12), 1), 100)
		page := max(qInt(r, "page", 1), 1)
		f := store.RoleFilter{Search: q.Get("q"), Band: q.Get("band"), MinFit: qInt(r, "minfit", 0), Sort: q.Get("sort"), Limit: size, Offset: (page - 1) * size,
			CompanyID: int64(qInt(r, "company", 0)), Saved: q.Get("saved") == "1"}
		if v := q.Get("stage"); v != "" {
			f.Stages = strings.Split(v, ",")
		}
		switch v := q.Get("closed"); v {
		case "":
		case "all":
			f.Closed = []string{"*"}
		default:
			f.Closed = strings.Split(v, ",")
		}
		if f.Sort == "" {
			f.Sort = "age"
		}
		roles, total, err := st.Roles(f)
		if err != nil {
			return nil, err
		}
		type item struct {
			store.Role
			Preparing bool `json:"preparing"`
		}
		out := make([]item, len(roles))
		for i, x := range roles {
			out[i] = item{x, e.Preparing(x.ID)}
		}
		counts, _ := st.RoleCounts()
		return map[string]any{"roles": out, "total": total, "page": page, "size": size, "counts": counts}, nil
	})
	h("GET /api/board", func(w http.ResponseWriter, r *http.Request) (any, error) {
		out := map[string]any{}
		counts, _ := st.RoleCounts()
		for _, stage := range []string{"found", "ready", "applied", "reply", "interview", "offer"} {
			roles, _, _ := st.Roles(store.RoleFilter{Stages: []string{stage}, Sort: "age", Limit: 6})
			out[stage] = roles
		}
		out["counts"] = counts
		return out, nil
	})
	h("POST /api/roles", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Company, Title, Location, URL, Description string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		id, err := e.AddRole(in.Company, in.Title, in.Location, safeLink(in.URL), in.Description, "manual")
		return map[string]int64{"id": id}, err
	})
	h("GET /api/roles/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.roleDetail(idOf(r)) })
	h("POST /api/roles/{id}/{action}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		id := idOf(r)
		var in struct {
			Why   string  `json:"why"`
			Stage string  `json:"stage"`
			CV    int64   `json:"cv"`
			Index int     `json:"index"`
			Off   bool    `json:"off"`
			After *string `json:"after"`
			Text  string  `json:"text"`
			How   string  `json:"how"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if _, err := st.Role(id); err != nil {
			return nil, err
		}
		switch r.PathValue("action") {
		case "prepare":
			if e.LLM().Engine == "" {
				return nil, llm.ErrNotConnected
			}
			e.Go(fmt.Sprintf("prepare:%d", id), "Preparing your documents", func(ctx context.Context) error { return e.Prepare(ctx, id) })
			return nil, nil
		case "read":
			e.Go(fmt.Sprintf("read:%d", id), "Reading a role", func(ctx context.Context) error { _, _, err := e.ReadRole(ctx, id); return err })
			return nil, nil
		case "applied":
			return nil, e.MarkApplied(id, in.How)
		case "no":
			return nil, e.NotInterested(id, in.Why)
		case "reopen":
			return nil, st.Reopen(id)
		case "close":
			if in.Stage != "rejected" && in.Stage != "withdrawn" && in.Stage != "expired" {
				return nil, bad("unknown way to close")
			}
			return nil, st.CloseRole(id, in.Stage, in.Why)
		case "stage":
			return nil, st.SetStage(id, in.Stage)
		case "save":
			return nil, st.SetSaved(id, !in.Off)
		case "cv":
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			return nil, e.SwitchCV(ctx, id, in.CV)
		case "change":
			return nil, e.SetChange(id, in.Index, in.Off, in.After)
		case "letter":
			return nil, st.SaveDoc(id, "letter", engine.LetterDoc{Text: strings.TrimSpace(in.Text)})
		case "case":
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			return nil, e.WriteCase(ctx, id)
		}
		return nil, bad("unknown action")
	})
	h("GET /api/roles/{id}/cv.docx", func(w http.ResponseWriter, r *http.Request) (any, error) {
		f, err := e.CVFile(idOf(r))
		return sendFile(w, f.Name, f.Data, err)
	})
	h("GET /api/roles/{id}/letter.docx", func(w http.ResponseWriter, r *http.Request) (any, error) {
		f, err := e.LetterFile(idOf(r))
		return sendFile(w, f.Name, f.Data, err)
	})

	// ---- radar ---------------------------------------------------------------------
	h("GET /api/radar", func(w http.ResponseWriter, r *http.Request) (any, error) {
		now := e.Now()
		fresh, _, _ := st.Roles(store.RoleFilter{Stages: []string{"found", "ready"}, Sort: "age", Limit: 60})
		var recent []store.Role
		for _, x := range fresh {
			if now.Unix()-x.Age() < 48*3600 && len(recent) < 8 {
				recent = append(recent, x)
			}
		}
		runs, _ := st.Runs("", 8)
		var search engine.SearchState
		st.Get("search", &search)
		p := st.Profile()
		return map[string]any{"fresh": recent, "runs": runs, "search": search, "status": e.Status(), "titles": p.Titles, "domain": p.Domain, "avoid": p.Avoid,
			"unread":  st.Count(`SELECT COUNT(*) FROM roles WHERE stage = 'new' AND closed = ''`),
			"cleared": st.Count(`SELECT COUNT(*) FROM roles WHERE closed = 'screened'`)}, nil
	})
	h("GET /api/companies", func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := r.URL.Query()
		states := []string{"following"}
		if v := q.Get("state"); v != "" {
			states = strings.Split(v, ",")
		}
		all, err := st.Companies(states...)
		if err != nil {
			return nil, err
		}
		search := strings.ToLower(strings.TrimSpace(q.Get("q")))
		var list []store.Company
		for _, c := range all {
			if search == "" || strings.Contains(strings.ToLower(c.Name+" "+c.Sector), search) {
				list = append(list, c)
			}
		}
		sortCompanies(list, q.Get("sort"))
		size := min(max(qInt(r, "size", 10), 1), 100)
		page := max(qInt(r, "page", 1), 1)
		total := len(list)
		from := min((page-1)*size, total)
		return map[string]any{"companies": list[from:min(from+size, total)], "total": total, "page": page, "size": size,
			"suggested": st.Count(`SELECT COUNT(*) FROM companies WHERE state = 'suggested'`), "muted": st.Count(`SELECT COUNT(*) FROM companies WHERE state = 'muted'`)}, nil
	})
	h("POST /api/companies", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Name, Site string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if strings.TrimSpace(in.Name) == "" {
			return nil, bad("Type the employer's name.")
		}
		c, _, err := st.UpsertCompany(store.Company{Name: strings.TrimSpace(in.Name), Site: safeLink(in.Site), State: "following", Source: "you"})
		if err != nil {
			return nil, err
		}
		if b := safeLink(in.Site); b != "" && e.SetBoardFromURL(c.ID, b) == nil {
			return c, nil
		}
		id := c.ID
		e.Go(fmt.Sprintf("board:%d", id), "", func(ctx context.Context) error { return e.DetectBoard(ctx, id) })
		return c, nil
	})
	h("POST /api/companies/more", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if e.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		e.Go("employers", "Finding more employers that hire people like you", func(ctx context.Context) error { return e.SeedEmployers(ctx, 15) })
		return nil, nil
	})
	h("PUT /api/companies/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		c, err := st.Company(idOf(r))
		if err != nil {
			return nil, err
		}
		var in struct {
			State, Board *string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if in.State != nil {
			switch *in.State {
			case "following", "suggested", "muted":
				c.State = *in.State
				if err := st.SaveCompany(c); err != nil {
					return nil, err
				}
			default:
				return nil, bad("unknown state")
			}
		}
		if in.Board != nil {
			if err := e.SetBoardFromURL(c.ID, *in.Board); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	h("POST /api/search", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Kind string `json:"kind"`
		}
		read(r, &in)
		if in.Kind != "fast" {
			in.Kind = "full"
		}
		if e.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		if !e.StartSearch(in.Kind) {
			return nil, bad("A search is already running.")
		}
		return nil, nil
	})
	h("POST /api/pause", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Paused bool `json:"paused"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		e.SetPaused(in.Paused)
		return nil, nil
	})

	// ---- people --------------------------------------------------------------------
	h("GET /api/people", func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := r.URL.Query()
		f := store.PeopleFilter{Kind: q.Get("kind"), Search: q.Get("q"), KnowYou: q.Get("know") == "1", CompanyID: int64(qInt(r, "company", 0))}
		if v := q.Get("state"); v != "" {
			f.States = strings.Split(v, ",")
		}
		all, err := st.People(f)
		if err != nil {
			return nil, err
		}
		size := min(max(qInt(r, "size", 8), 1), 100)
		page := max(qInt(r, "page", 1), 1)
		total := len(all)
		from := min((page-1)*size, total)
		know, byKind := st.KnowYou()
		kinds, _ := st.Pairs(`SELECT kind, COUNT(*) FROM people WHERE state != 'skipped' GROUP BY 1`)
		return map[string]any{"people": all[from:min(from+size, total)], "total": total, "page": page, "size": size, "know": know, "know_by_kind": byKind, "kinds": kinds, "doors": e.Doors(),
			"finding": e.Busy("people")}, nil
	})
	h("POST /api/people", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			store.Person
			CompanyName string `json:"company_name"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		in.Person.ID = 0
		id, err := e.AddPerson(in.Person, in.CompanyName)
		return map[string]int64{"id": id}, err
	})
	h("POST /api/people/find", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if e.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		if !e.Go("people", "Looking for people who would answer you", func(ctx context.Context) error { return e.FindPeople(ctx) }) {
			return nil, bad("Already looking.")
		}
		return nil, nil
	})
	h("POST /api/people/import", func(w http.ResponseWriter, r *http.Request) (any, error) {
		data, err := io.ReadAll(io.LimitReader(r.Body, 20<<20))
		if err != nil {
			return nil, bad("couldn't read the file")
		}
		added, at, err := e.ImportConnections(data)
		return map[string]int{"added": added, "at_watched": at}, err
	})
	h("GET /api/people/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p, err := st.Person(idOf(r))
		if err != nil {
			return nil, err
		}
		notes, _ := st.Notes(p.ID)
		acts, _ := st.ActivityList(store.ActivityFilter{PersonID: p.ID, Limit: 20})
		return map[string]any{"person": p, "notes": notes, "activity": acts}, nil
	})
	h("PUT /api/people/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p, err := st.Person(idOf(r))
		if err != nil {
			return nil, err
		}
		var in struct {
			Name, Title, Kind, Why, URL, Email, State *string
			KnowsYou                                  *bool `json:"knows_you"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		set := func(dst *string, v *string) {
			if v != nil {
				*dst = strings.TrimSpace(*v)
			}
		}
		set(&p.Name, in.Name)
		set(&p.Title, in.Title)
		set(&p.Kind, in.Kind)
		set(&p.Why, in.Why)
		set(&p.Email, in.Email)
		set(&p.State, in.State)
		if in.URL != nil {
			p.URL = safeLink(*in.URL)
		}
		if in.Email != nil && p.Email != "" {
			p.EmailSure = "sure"
		}
		if in.KnowsYou != nil {
			p.KnowsYouAt = 0
			if *in.KnowsYou {
				p.KnowsYouAt = e.Now().Unix()
			}
		}
		if p.Name == "" {
			return nil, bad("A person needs a name.")
		}
		return nil, st.SavePerson(p)
	})
	h("DELETE /api/people/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, st.DeletePerson(idOf(r)) })
	h("POST /api/people/{id}/note", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Purpose, Channel string
			Role             int64
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		return e.DraftNote(ctx, idOf(r), in.Purpose, in.Channel, in.Role)
	})
	h("PUT /api/notes/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Subject, Body string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		return nil, st.SaveNoteText(idOf(r), in.Subject, in.Body)
	})
	h("POST /api/notes/{id}/{action}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		id := idOf(r)
		switch r.PathValue("action") {
		case "sent":
			return nil, e.NoteSent(id)
		case "replied":
			return nil, e.NoteReplied(id)
		case "quiet":
			st.NoteNudged(id, 0)
			return nil, nil
		case "later":
			st.NoteNudged(id, 5)
			return nil, nil
		}
		return nil, bad("unknown action")
	})
	h("DELETE /api/notes/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, st.DeleteNote(idOf(r)) })

	// ---- replies -------------------------------------------------------------------
	h("GET /api/mail", func(w http.ResponseWriter, r *http.Request) (any, error) {
		q := r.URL.Query()
		size := min(max(qInt(r, "size", 8), 1), 100)
		page := max(qInt(r, "page", 1), 1)
		f := store.MailFilter{State: q.Get("state"), Limit: size, Offset: (page - 1) * size}
		if v := q.Get("kind"); v != "" {
			f.Kinds = strings.Split(v, ",")
		} else {
			f.Kinds = []string{"interview", "assessment", "question", "offer", "rejection", "receipt", "person"}
		}
		mails, total, err := st.Mails(f)
		set := e.MailSet()
		return map[string]any{"mail": mails, "total": total, "page": page, "size": size, "on": set.On, "note": set.Note, "last_at": set.LastAt,
			"waiting": st.Count(`SELECT COUNT(*) FROM mails WHERE state = 'new'`), "checking": e.Busy("mail")}, err
	})
	h("GET /api/mail/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return st.Mail(idOf(r)) })
	h("POST /api/mail", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			From, Subject, Body string
			Role                int64
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		id, err := e.PasteMail(ctx, in.From, in.Subject, in.Body, in.Role)
		return map[string]int64{"id": id}, err
	})
	h("POST /api/mail/check", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if !e.MailSet().On {
			return nil, bad("Connect your inbox first, under You → Connections.")
		}
		e.Go("mail", "Checking your inbox", func(ctx context.Context) error { return e.CheckMail(ctx) })
		return nil, nil
	})
	h("PUT /api/mail/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		m, err := st.Mail(idOf(r))
		if err != nil {
			return nil, err
		}
		var in struct {
			State, Draft *string
			Role         *int64
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if in.State != nil && (*in.State == "new" || *in.State == "done") {
			m.State = *in.State
		}
		if in.Draft != nil {
			m.Draft = *in.Draft
		}
		if in.Role != nil {
			m.RoleID = *in.Role
		}
		return nil, st.SaveMail(m)
	})
	h("DELETE /api/mail/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, st.DeleteMail(idOf(r)) })

	// ---- interviews ----------------------------------------------------------------
	h("GET /api/talks", func(w http.ResponseWriter, r *http.Request) (any, error) {
		now := e.Now()
		from := int64(qInt(r, "from", int(now.Add(-2*time.Hour).Unix())))
		to := int64(qInt(r, "to", int(now.AddDate(0, 3, 0).Unix())))
		up, err := st.Talks(from, to)
		past, _ := st.Talks(now.AddDate(0, -3, 0).Unix(), from)
		for i, j := 0, len(past)-1; i < j; i, j = i+1, j-1 {
			past[i], past[j] = past[j], past[i]
		}
		if len(past) > 6 {
			past = past[:6]
		}
		return map[string]any{"upcoming": up, "past": past}, err
	})
	h("POST /api/talks", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var t store.Talk
		if err := read(r, &t); err != nil {
			return nil, err
		}
		t.ID, t.Link = 0, safeLink(t.Link)
		id, err := e.AddTalk(t)
		return map[string]int64{"id": id}, err
	})
	h("GET /api/talks/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		t, err := st.Talk(idOf(r))
		return map[string]any{"talk": t, "preparing": e.Busy(fmt.Sprintf("prep:%d", t.ID))}, err
	})
	h("PUT /api/talks/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		t, err := st.Talk(idOf(r))
		if err != nil {
			return nil, err
		}
		var in struct {
			Title, Kind, Link, Notes *string
			At                       *int64
			Minutes                  *int
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if in.Title != nil {
			t.Title = strings.TrimSpace(*in.Title)
		}
		if in.Kind != nil {
			t.Kind = *in.Kind
		}
		if in.Link != nil {
			t.Link = safeLink(*in.Link)
		}
		if in.Notes != nil {
			t.Notes = *in.Notes
		}
		if in.At != nil && *in.At > 0 {
			t.At = *in.At
		}
		if in.Minutes != nil && *in.Minutes > 0 {
			t.Minutes = *in.Minutes
		}
		return nil, st.SaveTalk(t)
	})
	h("DELETE /api/talks/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, st.DeleteTalk(idOf(r)) })
	h("POST /api/talks/{id}/prep", func(w http.ResponseWriter, r *http.Request) (any, error) {
		id := idOf(r)
		if e.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		e.Go(fmt.Sprintf("prep:%d", id), "Preparing you for a conversation", func(ctx context.Context) error { return e.PrepTalk(ctx, id) })
		return nil, nil
	})
	h("GET /api/talks/{id}/invite.ics", func(w http.ResponseWriter, r *http.Request) (any, error) {
		name, data, err := e.ICS(idOf(r))
		return sendFile(w, name, data, err)
	})

	// ---- progress ------------------------------------------------------------------
	h("GET /api/progress", func(w http.ResponseWriter, r *http.Request) (any, error) { return e.Progress(), nil })
	h("GET /api/activity", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return st.ActivityList(store.ActivityFilter{Limit: min(max(qInt(r, "limit", 40), 1), 200)})
	})

	// ---- you -----------------------------------------------------------------------
	h("GET /api/you", func(w http.ResponseWriter, r *http.Request) (any, error) {
		cvs, _ := st.CVs()
		for i := range cvs {
			cvs[i].Text = ""
			cvs[i].Model = nil
		}
		facts, _ := st.Facts()
		answers, _ := st.Answers()
		qs, _ := st.OpenQuestions()
		return map[string]any{"profile": st.Profile(), "cvs": cvs, "facts": facts, "answers": answers, "questions": qs}, nil
	})
	h("POST /api/facts", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Text string `json:"text"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if strings.TrimSpace(in.Text) == "" {
			return nil, bad("Type the fact first.")
		}
		_, err := st.AddFact(strings.TrimSpace(in.Text), "you")
		return nil, err
	})
	h("DELETE /api/facts/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, st.DeleteFact(idOf(r)) })
	h("POST /api/answers", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Question, Answer string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if strings.TrimSpace(in.Question) == "" {
			return nil, bad("Type the question first.")
		}
		return nil, st.SaveAnswer(strings.TrimSpace(in.Question), strings.TrimSpace(in.Answer))
	})
	h("DELETE /api/answers/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, st.DeleteAnswer(idOf(r)) })
	h("GET /api/arriving", func(w http.ResponseWriter, r *http.Request) (any, error) {
		doc, ok := e.Arriving()
		p := st.Profile()
		moving, days := p.Relocating(e.Now())
		out := map[string]any{"has": ok, "building": e.Busy("arriving"), "moving": moving, "days": days, "profile": p}
		if ok {
			out["doc"] = doc
			if base, err := e.CVModel(doc.CVID); err == nil {
				for i := range doc.Changes {
					if doc.Changes[i].Before == "" {
						doc.Changes[i].Before, _ = cv.Get(base, doc.Changes[i].ID)
					}
				}
			}
		}
		return out, nil
	})
	h("POST /api/arriving", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if e.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		e.Go("arriving", "Preparing your arrival pack", func(ctx context.Context) error { return e.BuildArriving(ctx) })
		return nil, nil
	})
	h("POST /api/arriving/change", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Index int  `json:"index"`
			Off   bool `json:"off"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		return nil, e.SetArrivingChange(in.Index, in.Off)
	})
	h("POST /api/arriving/apply", func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := e.ApplyArriving()
		return map[string]int64{"id": id}, err
	})

	// ---- connections ---------------------------------------------------------------
	h("GET /api/connections", func(w http.ResponseWriter, r *http.Request) (any, error) {
		mail := e.MailSet()
		hasPass := mail.Pass != ""
		mail.Pass = ""
		cliPath, _ := llm.FindCLI()
		s.mu.Lock()
		pending := s.pending.Code()
		s.mu.Unlock()
		byTask, _ := st.UsageByTask(e.Now().Add(-7 * 24 * time.Hour).Unix())
		return map[string]any{"claude": e.Claude(), "cli_found": cliPath, "models": llm.Models, "phone": e.Phone(), "mail": mail, "mail_has_pass": hasPass,
			"ext": map[string]any{"id": s.ext().ID, "paired_at": s.ext().PairedAt, "code": s.ext().Code()}, "ext_pending": pending, "usage": byTask}, nil
	})
	h("PUT /api/llm", func(w http.ResponseWriter, r *http.Request) (any, error) {
		cur := e.LLM()
		var in engine.LLMSettings
		if err := read(r, &in); err != nil {
			return nil, err
		}
		switch in.Engine {
		case "", "claude-code", "api", "demo":
		default:
			return nil, bad("unknown way of reaching Claude")
		}
		if in.Key == "" {
			in.Key = cur.Key
		}
		if in.Engine == "api" && in.Key == "" {
			return nil, bad("Paste your API key.")
		}
		if in.Engine == "claude-code" {
			if in.CLI == "" {
				in.CLI, _ = llm.FindCLI()
			}
			if in.CLI == "" {
				return nil, bad("Claude Code isn't installed on this computer. Install it from claude.com/claude-code and sign in, or use an API key.")
			}
		}
		if in.Model == "" {
			in.Model = cur.Model
		}
		return nil, e.SetLLM(in)
	})
	h("POST /api/llm/test", func(w http.ResponseWriter, r *http.Request) (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		msg, err := e.TestClaude(ctx)
		return map[string]string{"message": msg}, err
	})
	h("PUT /api/phone", func(w http.ResponseWriter, r *http.Request) (any, error) {
		set := e.Phone()
		if err := read(r, &set); err != nil {
			return nil, err
		}
		if set.Server != "" && safeLink(set.Server) == "" {
			return nil, bad("The server should be a web address, like https://ntfy.sh")
		}
		return nil, e.SetPhone(set)
	})
	h("POST /api/phone/test", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return nil, e.Push(r.Context(), "Job Hunt can reach your phone", "New roles that fit will show up here while they are still fresh.", "")
	})
	h("PUT /api/mailset", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in engine.MailSet
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		return nil, e.SetMail(ctx, in)
	})
	h("POST /api/ext/pair", func(w http.ResponseWriter, r *http.Request) (any, error) {
		s.mu.Lock()
		x := s.pending
		s.pending = ExtSet{}
		s.mu.Unlock()
		if x.KeyHash == "" {
			return nil, bad("No extension is asking to connect. Open the Job Hunt side panel in your browser first.")
		}
		x.PairedAt = e.Now().Unix()
		st.Set("ext", x)
		st.Changed("connections", "state")
		return nil, nil
	})
	h("POST /api/ext/unpair", func(w http.ResponseWriter, r *http.Request) (any, error) {
		st.Set("ext", ExtSet{})
		st.Changed("connections", "state")
		return nil, nil
	})

	// ---- the app -------------------------------------------------------------------
	h("GET /api/app", func(w http.ResponseWriter, r *http.Request) (any, error) {
		changes, _ := st.Changes(20)
		calls, _ := st.LastCalls(12)
		acts, _ := st.ActivityList(store.ActivityFilter{Kinds: []string{"problem"}, Limit: 10})
		return map[string]any{"version": Version, "dir": e.Dir, "changes": changes, "calls": calls, "problems": acts,
			"week": st.UsageSince(e.Now().Add(-7 * 24 * time.Hour).Unix()), "today": st.UsageSince(e.Now().Add(-24 * time.Hour).Unix())}, nil
	})
	h("POST /api/quit", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if s.Quit == nil {
			return nil, bad("Close the window to stop.")
		}
		go func() { time.Sleep(300 * time.Millisecond); s.Quit() }()
		return nil, nil
	})
	h("POST /api/backup", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p, err := e.Backup()
		return map[string]string{"path": p}, err
	})

	// ---- the browser extension -----------------------------------------------------
	s.extRoutes(h)

	// ---- the pages -------------------------------------------------------------------
	files := http.FileServerFS(s.Web)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	return s.guard(mux)
}

func sortCompanies(list []store.Company, key string) {
	desc := strings.HasPrefix(key, "-")
	key = strings.TrimPrefix(key, "-")
	less := func(a, b store.Company) bool {
		switch key {
		case "name":
			return strings.ToLower(a.Name) < strings.ToLower(b.Name)
		case "fit":
			return a.BestFit > b.BestFit
		case "people":
			return a.KnowYou*100+a.People > b.KnowYou*100+b.People
		case "newest":
			return a.NewestRole > b.NewestRole
		}
		if a.OpenRoles != b.OpenRoles {
			return a.OpenRoles > b.OpenRoles
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	}
	for i := 1; i < len(list); i++ {
		for j := i; j > 0; j-- {
			a, b := list[j-1], list[j]
			swap := less(b, a)
			if desc {
				swap = less(a, b)
			}
			if !swap {
				break
			}
			list[j-1], list[j] = b, a
		}
	}
}

// safeLink keeps only ordinary web addresses.
func safeLink(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return s
}

func sendFile(w http.ResponseWriter, name string, data []byte, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	ctype := mime.TypeByExtension(path.Ext(name))
	switch path.Ext(name) {
	case ".docx":
		ctype = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".ics":
		ctype = "text/calendar; charset=utf-8"
	}
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
	return noBody{}, nil
}

// State is what the frame around every page needs.
type State struct {
	SetupDone  bool               `json:"setup_done"`
	Name       string             `json:"name"`
	City       string             `json:"city"`
	Moving     bool               `json:"moving"`
	Days       int                `json:"days"`
	Counts     map[string]int     `json:"counts"`
	Claude     engine.ClaudeState `json:"claude"`
	Status     engine.Status      `json:"status"`
	ExtPending bool               `json:"ext_pending"`
	Version    string             `json:"version"`
}

func (s *Server) state() State {
	st, e := s.S, s.E
	p := st.Profile()
	now := e.Now()
	moving, days := p.Relocating(now)
	counts, _ := st.RoleCounts()
	s.mu.Lock()
	pending := s.pending.KeyHash != ""
	s.mu.Unlock()
	qs, _ := st.OpenQuestions()
	return State{
		SetupDone: p.SetupDone, Name: p.Name, City: p.City, Moving: moving, Days: days, Claude: e.Claude(), Status: e.Status(), ExtPending: pending, Version: Version,
		Counts: map[string]int{
			"ready":     counts["ready"],
			"fresh":     st.Count(`SELECT COUNT(*) FROM roles WHERE closed = '' AND stage IN ('found','ready') AND CASE WHEN posted_at > 0 THEN posted_at ELSE first_seen_at END > ?`, now.Add(-24*time.Hour).Unix()),
			"roles":     counts["found"] + counts["ready"] + counts["applied"] + counts["reply"] + counts["interview"] + counts["offer"],
			"people":    st.Count(`SELECT COUNT(*) FROM notes WHERE state = 'draft'`) + st.Count(`SELECT COUNT(*) FROM notes WHERE state = 'sent' AND nudge_at > 0 AND nudge_at <= ?`, now.Unix()),
			"mail":      st.Count(`SELECT COUNT(*) FROM mails WHERE state = 'new'`),
			"talks":     st.CountTalks(now.Add(-time.Hour).Unix(), now.AddDate(0, 0, 7).Unix()),
			"questions": len(qs),
		},
	}
}

// events streams the names of things that changed, so open pages refresh
// themselves.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no streaming", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	ch, stop := s.S.Subscribe()
	defer stop()
	fmt.Fprint(w, "retry: 2000\n\n")
	fl.Flush()
	pending := map[string]bool{}
	tick := time.NewTicker(400 * time.Millisecond)
	defer tick.Stop()
	beat := time.NewTicker(25 * time.Second)
	defer beat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case t := <-ch:
			pending[t] = true
		case <-beat.C:
			fmt.Fprint(w, ": still here\n\n")
			fl.Flush()
		case <-tick.C:
			if len(pending) == 0 {
				continue
			}
			topics := make([]string, 0, len(pending))
			for t := range pending {
				topics = append(topics, t)
			}
			pending = map[string]bool{}
			b, _ := json.Marshal(topics)
			fmt.Fprintf(w, "data: %s\n\n", b)
			fl.Flush()
		}
	}
}

// roleDetail gathers everything the role page shows.
func (s *Server) roleDetail(id int64) (any, error) {
	st, e := s.S, s.E
	r, err := st.Role(id)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"role": r, "preparing": e.Preparing(id) || e.Busy(fmt.Sprintf("prepare:%d", id)), "reading_now": e.Busy(fmt.Sprintf("read:%d", id))}
	var reading brain.Reading
	if json.Unmarshal(r.Reading, &reading) == nil {
		out["reading"] = reading
	}
	if base, sent, doc, err := e.RoleCV(id); err == nil {
		for i := range doc.Changes {
			if doc.Changes[i].Before == "" {
				doc.Changes[i].Before, _ = cv.Get(base, doc.Changes[i].ID)
			}
		}
		out["cv"] = map[string]any{"doc": doc, "sent": sent}
	}
	var letter engine.LetterDoc
	if ok, _ := st.Doc(id, "letter", &letter); ok {
		out["letter"] = letter.Text
	}
	var cs engine.CaseDoc
	if ok, _ := st.Doc(id, "case", &cs); ok {
		out["case"] = cs
	}
	out["activity"], _ = st.ActivityList(store.ActivityFilter{RoleID: id, Limit: 30})
	out["people"] = e.PeopleForRole(id)
	out["notes"], _ = st.NotesForRole(id)
	out["talks"], _ = st.TalksForRole(id)
	out["mail"], _, _ = st.Mails(store.MailFilter{RoleID: id, Limit: 10})
	cvs, _ := st.CVs()
	type cvRef struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	var refs []cvRef
	for _, c := range cvs {
		refs = append(refs, cvRef{c.ID, c.Name})
	}
	out["cvs"] = refs
	if c, err := st.Company(r.CompanyID); err == nil {
		out["company"] = c
	}
	return out, nil
}
