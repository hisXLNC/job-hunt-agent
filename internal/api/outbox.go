package api

import (
	"context"
	"encoding/csv"
	"net/http"
	"strings"
	"time"

	"jobhunt/internal/engine"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// outboxRoutes: a reply written when the person asks, saved as a draft in
// their mail or sent with one press, and the recruiters found in mail.
//
// None of these are on the assistant's list or the phone's: sending, and
// writing into the person's mailbox, happen only from the person's own press
// on this computer.
func (s *Server) outboxRoutes(mux *http.ServeMux, h func(string, handler)) {
	e, st := s.E, s.S
	h("POST /api/mail/{id}/reply", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if e.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		return nil, e.WriteMailReply(ctx, idOf(r))
	})
	h("POST /api/mail/draft", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in engine.Outgoing
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		return nil, e.SaveDraft(ctx, in)
	})
	h("POST /api/mail/send", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in engine.Outgoing
		if err := read(r, &in); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		return nil, e.SendMail(ctx, in)
	})
	h("POST /api/mail/recruiters", func(w http.ResponseWriter, r *http.Request) (any, error) {
		set := e.MailSet()
		if !set.On || !set.Recruiters {
			return nil, bad("Turn on “Find recruiters in my mail” on the inbox card first.")
		}
		e.Go("recruiters", "Looking through your mail for recruiters", func(ctx context.Context) error { return e.ScanRecruiters(ctx) })
		return nil, nil
	})
	// Recruiters and hiring people as a spreadsheet file.
	mux.HandleFunc("GET /api/recruiters.csv", func(w http.ResponseWriter, r *http.Request) {
		people, err := st.People(store.PeopleFilter{})
		if err != nil {
			http.Error(w, "couldn't read the people", 500)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="JobHunt-recruiters.csv"`)
		w.Write([]byte("\xEF\xBB\xBF"))
		cw := csv.NewWriter(w)
		// A cell that starts like a formula came from mail or a page: it is kept from running in a spreadsheet.
		safe := func(s string) string {
			if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
				return "'" + s
			}
			return s
		}
		day := func(t int64) string {
			if t <= 0 {
				return ""
			}
			return time.Unix(t, 0).Format("2006-01-02")
		}
		cw.Write([]string{"Name", "Who", "Their role", "Employer", "Email", "Phone", "LinkedIn", "Roles you applied to there", "Knows you since", "Found", "From"})
		for _, p := range people {
			if p.Kind != "recruiter" && p.Kind != "manager" {
				continue
			}
			var applied []string
			if p.CompanyID != 0 {
				rows, _ := st.Pairs(`SELECT title, id FROM roles WHERE company_id = ? AND applied_at > 0 ORDER BY applied_at DESC LIMIT 10`, p.CompanyID)
				for _, x := range rows {
					applied = append(applied, x.Label)
				}
			}
			who := map[string]string{"recruiter": "Recruiter", "manager": "Hiring manager"}[p.Kind]
			cw.Write([]string{safe(p.Name), who, safe(p.Title), safe(p.Company), safe(p.Email), safe(p.Phone), safe(p.URL), safe(strings.Join(applied, "; ")), day(p.KnowsYouAt), day(p.CreatedAt), p.Source})
		}
		cw.Flush()
	})
}
