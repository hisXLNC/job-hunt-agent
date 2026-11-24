package api

import (
	"fmt"
	"net/http"
	"time"
)

// The look of the pages, the bell, the month calendar, and putting a saved
// copy back. Of these the assistant may only read the bell and the calendar
// (see assistant.go): the theme, where copies are kept, putting one back and
// restarting are the person's own buttons.
func (s *Server) moreRoutes(mux *http.ServeMux, h func(string, handler)) {
	e := s.E

	// ---- light or dark -------------------------------------------------------------
	// The page loads this before anything is drawn, so a dark page never
	// flashes white. The pages may not carry scripts of their own in the HTML.
	mux.HandleFunc("GET /theme.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		fmt.Fprintf(w, "document.documentElement.dataset.theme = %q;\n", e.Theme())
	})
	h("PUT /api/theme", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Theme string `json:"theme"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if in.Theme != "light" && in.Theme != "dark" && in.Theme != "system" {
			return nil, bad("Choose light, dark or match Windows.")
		}
		return map[string]string{"theme": in.Theme}, e.SetTheme(in.Theme)
	})

	// ---- the bell ------------------------------------------------------------------
	h("GET /api/notices", func(w http.ResponseWriter, r *http.Request) (any, error) {
		list, unread := e.Notices()
		return map[string]any{"notices": list, "unread": unread}, nil
	})
	h("POST /api/notices/read", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			ID int64 `json:"id"` // 0 or left out: all of them
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		e.ReadNotices(in.ID)
		return map[string]int{"unread": e.UnreadNotices()}, nil
	})

	// ---- the month calendar --------------------------------------------------------
	h("GET /api/calendar", func(w http.ResponseWriter, r *http.Request) (any, error) {
		now := e.Now()
		first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		from := int64(qInt(r, "from", int(first.AddDate(0, 0, -7).Unix())))
		to := int64(qInt(r, "to", int(first.AddDate(0, 1, 7).Unix())))
		if to <= from || to-from > 100*86400 {
			return nil, bad("Ask for one month at a time.")
		}
		return map[string]any{"items": e.Calendar(from, to), "today": now.Format("2006-01-02")}, nil
	})
	h("GET /api/calendar.ics", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return sendFile(w, "job-hunt.ics", e.CalendarICS(90), nil)
	})

	// ---- saved copies --------------------------------------------------------------
	backups := func() map[string]any {
		set := e.BackupSet()
		return map[string]any{"dir": e.BackupDir(), "default_dir": e.DefaultBackupDir(), "custom": set.Dir != "", "keep": set.Keep,
			"copies": e.Copies(), "staged": e.StagedRestore(), "can_restart": s.Restart != nil}
	}
	h("GET /api/backups", func(w http.ResponseWriter, r *http.Request) (any, error) { return backups(), nil })
	h("PUT /api/backups", func(w http.ResponseWriter, r *http.Request) (any, error) {
		set := e.BackupSet()
		var in struct {
			Dir  *string `json:"dir"`
			Keep *int    `json:"keep"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if in.Dir != nil {
			set.Dir = *in.Dir
		}
		if in.Keep != nil {
			set.Keep = *in.Keep
		}
		if err := e.SetBackup(set); err != nil {
			return nil, bad(err.Error())
		}
		return backups(), nil
	})
	h("POST /api/backups/restore", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Name string `json:"name"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if e.Busy("update") {
			return nil, bad("An update is being installed. Try again when Job Hunt is back.")
		}
		if _, err := e.StageRestore(in.Name); err != nil {
			return nil, bad(err.Error())
		}
		return backups(), nil
	})
	h("DELETE /api/backups/restore", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if err := e.CancelRestore(); err != nil {
			return nil, bad("Couldn't take that back: " + err.Error())
		}
		return backups(), nil
	})
	// Stops this program and starts it again, which is when a waiting copy is put back.
	h("POST /api/restart", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if s.Restart == nil {
			return nil, bad("Job Hunt can't start itself again here. Stop it, then start it from the Start menu.")
		}
		if err := s.Restart(); err != nil {
			return nil, bad("Job Hunt couldn't start itself again: " + err.Error() + ". Stop it, then start it from the Start menu.")
		}
		return nil, nil
	})
}
