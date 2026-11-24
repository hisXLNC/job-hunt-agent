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

// extEntry is one job or school from the CV, as a form asks for it again.
type extEntry struct {
	Title    string `json:"title"`
	Org      string `json:"org"`
	Dates    string `json:"dates"`
	Location string `json:"location"`
	Text     string `json:"text,omitempty"`
}

// extHistory lists the CV's jobs, schools and skills one by one.
func extHistory(m cv.CV) (work, schools []extEntry, skills []string) {
	work, schools, skills = []extEntry{}, []extEntry{}, []string{}
	for _, sec := range m.Sections {
		for _, it := range sec.Items {
			switch sec.Kind {
			case "experience":
				text := it.Text
				for _, b := range it.Bullets {
					text += "\n• " + b
				}
				text = strings.TrimSpace(text)
				// An item with no title and no employer is the rest of the job above it.
				if n := len(work); n > 0 && it.Heading == "" && it.Org == "" {
					last := &work[n-1]
					last.Text = strings.TrimSpace(last.Text + "\n" + text)
					if last.Dates == "" {
						last.Dates = it.Dates
					}
					continue
				}
				work = append(work, extEntry{Title: it.Heading, Org: it.Org, Dates: it.Dates, Location: it.Location, Text: text})
			case "education":
				if n := len(schools); n > 0 && it.Heading == "" && it.Org == "" {
					if schools[n-1].Dates == "" {
						schools[n-1].Dates = it.Dates
					}
					continue
				}
				schools = append(schools, extEntry{Title: it.Heading, Org: it.Org, Dates: it.Dates, Location: it.Location})
			case "skills":
				for _, line := range append([]string{it.Heading, it.Text}, it.Bullets...) {
					if i := strings.Index(line, ":"); i >= 0 && i < 40 {
						line = line[i+1:]
					}
					for _, w := range strings.FieldsFunc(line, func(r rune) bool { return r == ',' || r == ';' || r == '•' || r == '|' }) {
						if w = strings.TrimSpace(w); w != "" && len(w) <= 60 && len(skills) < 40 {
							skills = append(skills, w)
						}
					}
				}
			}
		}
	}
	return work, schools, skills
}

// neverKept names the questions whose answers are never remembered.
var neverKept = regexp.MustCompile(`(?i)passwor|passcode|\bpin\b|social (security|insurance)|\bssn\b|\bsin\b|national (id|insurance)|passport|driver'?s? licen[cs]e|\bbank|\biban\b|routing|account (number|no)|sort code|card (number|no)|credit card|debit card|\bcvv\b|\bcvc\b|date of birth|birth ?(date|day)|\bdob\b`)

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
			Role      int64      `json:"role"`
			Questions []string   `json:"questions"`
			Options   [][]string `json:"options"` // each question's choices, where it has them
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		ans, err := e.FormAnswers(ctx, in.Role, in.Questions, in.Options)
		return map[string]any{"answers": ans}, err
	})
	// The contact details a form asks for, taken from the CV.
	h("GET /api/ext/me", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p := st.Profile()
		out := map[string]any{"name": p.Name, "city": p.City, "country": p.Country, "home": p.Home, "pay_floor": p.PayFloor, "pay_unit": p.PayUnit}
		if cvs, _ := st.CVs(); len(cvs) > 0 {
			var m cv.CV
			if json.Unmarshal(cvs[0].Model, &m) == nil {
				out["email"], out["phone"], out["location"], out["links"] = m.Contact.Email, m.Contact.Phone, m.Contact.Location, m.Contact.Links
				out["work"], out["education"], out["skills"] = extHistory(m)
			}
		}
		return out, nil
	})
	// An answer the person typed into a form themselves, kept when they say
	// so in the panel. Never a password, an identity or bank number, a date
	// of birth, or a long piece of writing.
	h("POST /api/ext/answer", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Question, Answer string
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		q, a := strings.TrimSpace(in.Question), strings.TrimSpace(in.Answer)
		if q == "" || a == "" || len(q) > 400 {
			return nil, bad("There is no question and answer to keep.")
		}
		if len([]rune(a)) > 300 || neverKept.MatchString(q) {
			return nil, bad("Job Hunt doesn't keep that kind of answer.")
		}
		return nil, st.SaveAnswer(q, a)
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
