package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

var jobIDRe = regexp.MustCompile(`/jobs/view/(?:[^/?#]*-)?(\d{6,})`)

// roleByURL finds the role a browser tab is showing.
func (s *Server) roleByURL(raw string) (store.Role, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return store.Role{}, false
	}
	var rows []store.Pair
	if m := jobIDRe.FindStringSubmatch(u.Path); m != nil && strings.Contains(u.Host, "linkedin.") {
		rows, _ = s.S.Pairs(`SELECT '', id FROM roles WHERE key LIKE ? OR url LIKE ? ORDER BY id DESC LIMIT 1`, "%"+m[1], "%/"+m[1]+"%")
	}
	if len(rows) == 0 {
		base := u.Scheme + "://" + u.Host + strings.TrimRight(u.Path, "/")
		rows, _ = s.S.Pairs(`SELECT '', id FROM roles WHERE url = ? OR apply_url = ? OR url LIKE ? OR apply_url LIKE ? ORDER BY id DESC LIMIT 1`, base, base, base+"?%", base+"?%")
	}
	if len(rows) == 0 {
		return store.Role{}, false
	}
	r, err := s.S.Role(int64(rows[0].N))
	return r, err == nil
}

type extRole struct {
	store.Role
	HasCV     bool   `json:"has_cv"`
	HasLetter bool   `json:"has_letter"`
	Letter    string `json:"letter,omitempty"`
	Summary   string `json:"summary,omitempty"`
	Preparing bool   `json:"preparing"`
}

func (s *Server) extRole(r store.Role) extRole {
	out := extRole{Role: r, Preparing: s.E.Preparing(r.ID)}
	out.Description = ""
	var rd brain.Reading
	if json.Unmarshal(r.Reading, &rd) == nil {
		out.Summary = rd.Summary
	}
	out.Reading = nil
	docs, _ := s.S.Docs(r.ID)
	for _, d := range docs {
		switch d.Kind {
		case "cv":
			out.HasCV = true
		case "letter":
			out.HasLetter = true
			var l struct {
				Text string `json:"text"`
			}
			json.Unmarshal(d.Body, &l)
			out.Letter = l.Text
		}
	}
	return out
}

// extRoutes are the only things the browser extension can reach.
func (s *Server) extRoutes(h func(string, handler)) {
	e, st := s.E, s.S

	h("POST /api/ext/hello", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p := st.Profile()
		counts, _ := st.RoleCounts()
		return map[string]any{"ok": true, "name": p.Name, "ready": counts["ready"], "version": Version}, nil
	})
	// The roles ready to apply to, most urgent first.
	h("GET /api/ext/next", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var out []extRole
		for _, c := range e.Today().Cards {
			if c.Kind != "apply" {
				continue
			}
			if role, err := st.Role(c.RoleID); err == nil {
				out = append(out, s.extRole(role))
			}
		}
		return map[string]any{"roles": out}, nil
	})
	// What Job Hunt knows about the page the person is looking at.
	h("GET /api/ext/role", func(w http.ResponseWriter, r *http.Request) (any, error) {
		role, ok := s.roleByURL(r.URL.Query().Get("url"))
		if !ok {
			return map[string]any{"known": false}, nil
		}
		return map[string]any{"known": true, "role": s.extRole(role)}, nil
	})
	h("GET /api/ext/role/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		role, err := st.Role(idOf(r))
		if err != nil {
			return nil, err
		}
		return map[string]any{"known": true, "role": s.extRole(role)}, nil
	})
	// The person sends a posting they are looking at.
	h("POST /api/ext/posting", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Company, Title, Location, URL, Description string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if len(in.Description) > 60000 {
			in.Description = in.Description[:60000]
		}
		id, err := e.AddRole(in.Company, in.Title, in.Location, safeLink(in.URL), in.Description, "extension")
		return map[string]int64{"id": id}, err
	})
	h("POST /api/ext/role/{id}/prepare", func(w http.ResponseWriter, r *http.Request) (any, error) {
		id := idOf(r)
		if _, err := st.Role(id); err != nil {
			return nil, err
		}
		e.Go("prepare:"+r.PathValue("id"), "Preparing your documents", func(ctx context.Context) error { return e.Prepare(ctx, id) })
		return nil, nil
	})
	h("GET /api/ext/role/{id}/cv.docx", func(w http.ResponseWriter, r *http.Request) (any, error) {
		f, err := e.CVFile(idOf(r))
		return sendFile(w, f.Name, f.Data, err)
	})
	h("GET /api/ext/role/{id}/letter.docx", func(w http.ResponseWriter, r *http.Request) (any, error) {
		f, err := e.LetterFile(idOf(r))
		return sendFile(w, f.Name, f.Data, err)
	})
	// Answers for the questions on an application form. The extension types
	// them in; the person reads the form and presses Submit themselves.
	h("POST /api/ext/answers", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Role      int64    `json:"role"`
			Questions []string `json:"questions"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		ans, err := e.FormAnswers(ctx, in.Role, in.Questions)
		return map[string]any{"answers": ans}, err
	})
	// The contact details a form asks for, taken from the CV.
	h("GET /api/ext/me", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p := st.Profile()
		out := map[string]any{"name": p.Name, "city": p.City, "country": p.Country, "home": p.Home}
		if cvs, _ := st.CVs(); len(cvs) > 0 {
			var m cv.CV
			if json.Unmarshal(cvs[0].Model, &m) == nil {
				out["email"], out["phone"], out["location"], out["links"] = m.Contact.Email, m.Contact.Phone, m.Contact.Location, m.Contact.Links
			}
		}
		return out, nil
	})
	h("POST /api/ext/role/{id}/applied", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return nil, e.MarkApplied(idOf(r), "")
	})
	h("POST /api/ext/role/{id}/no", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return nil, e.NotInterested(idOf(r), "")
	})
	// A profile the person is looking at becomes a person, with a note drafted.
	h("POST /api/ext/person", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Name, Title, Company, URL, Kind string
			Draft                           bool
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		id, err := e.AddPerson(store.Person{Name: in.Name, Title: in.Title, URL: safeLink(in.URL), Kind: in.Kind, Source: "extension"}, in.Company)
		if err != nil {
			return nil, err
		}
		out := map[string]any{"id": id}
		if in.Draft {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			n, err := e.DraftNote(ctx, id, "", "linkedin", 0)
			if err != nil {
				return nil, err
			}
			out["note"] = n
		} else if n, err := st.LatestNote(id); err == nil {
			out["note"] = n
		}
		return out, nil
	})
	h("POST /api/ext/note/{id}/sent", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, e.NoteSent(idOf(r)) })
}
