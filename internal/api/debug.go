package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	"jobhunt/extension"
	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// report is everything needed to look into a problem, as plain text: what
// version, what state, what went wrong lately and the newest lines of the
// debugging record. It carries no name, e-mail address or key.
func (s *Server) report(lines int) string {
	e, st := s.E, s.S
	var b strings.Builder
	now := e.Now()
	at := func(t int64) string {
		if t == 0 {
			return "-"
		}
		return time.Unix(t, 0).Format("2006-01-02 15:04:05")
	}
	fmt.Fprintf(&b, "Job Hunt %s on %s/%s, running %s, port %d, %s\n", Version, runtime.GOOS, runtime.GOARCH, trace.Uptime().Round(time.Second), s.Port, now.Format("2006-01-02 15:04:05 -0700"))
	cl := e.Claude()
	fmt.Fprintf(&b, "Claude: via %q model %q ok=%v calls today=%d note=%q\n", cl.Engine, cl.Model, cl.OK, cl.Calls, cl.Note)
	stt := e.Status()
	fmt.Fprintf(&b, "Status: paused=%v sources=%d next fast=%s next full=%s held until=%s\n", stt.Paused, stt.Sources, at(stt.NextFast), at(stt.NextFull), at(stt.Held))
	for _, j := range stt.Jobs {
		fmt.Fprintf(&b, "  running: %s (%s) %s %d%% since %s\n", j.Name, j.Doing, j.Step, j.Percent, at(j.Started))
	}
	state := s.state()
	cj, _ := json.Marshal(state.Counts)
	fmt.Fprintf(&b, "Counts: %s setup done=%v side panel waiting=%v\n", cj, state.SetupDone, state.ExtPending)
	if u := state.Update; u != nil {
		fmt.Fprintf(&b, "Update waiting: %s\n", u.Version)
	}
	b.WriteString("\nLast searches\n")
	runs, _ := st.Runs("", 8)
	for _, r := range runs {
		fmt.Fprintf(&b, "  %s %s %s -> %s %s %s\n", at(r.StartedAt), r.Kind, r.State, at(r.EndedAt), r.Stats, r.Log)
	}
	b.WriteString("\nRecent problems\n")
	acts, _ := st.ActivityList(store.ActivityFilter{Kinds: []string{"problem"}, Limit: 15})
	for _, a := range acts {
		fmt.Fprintf(&b, "  %s %s %s\n", at(a.At), a.Text, a.Detail)
	}
	b.WriteString("\nLast calls to Claude\n")
	calls, _ := st.LastCalls(15)
	for _, c := range calls {
		fmt.Fprintf(&b, "  %s %s %s %dms in=%d out=%d %s\n", at(c.At), c.Task, c.Model, c.Ms, c.TokensIn, c.TokensOut, c.Error)
	}
	fmt.Fprintf(&b, "\nDebugging record (newest %d lines)\n", lines)
	for _, l := range trace.Tail(lines) {
		b.WriteString(l)
		b.WriteByte('\n')
	}
	out := b.String()
	// The person's own details stay out of what they may paste elsewhere.
	p := st.Profile()
	for _, w := range []string{p.Name} {
		if w = strings.TrimSpace(w); len(w) >= 3 {
			out = regexp.MustCompile(`(?i)`+regexp.QuoteMeta(w)).ReplaceAllString(out, "[you]")
		}
	}
	if home, err := os.UserHomeDir(); err == nil && len(home) > 3 {
		out = strings.ReplaceAll(out, home, "~")
	}
	var clean []string
	for _, l := range strings.Split(out, "\n") {
		clean = append(clean, trace.Clean(l))
	}
	return strings.Join(clean, "\n")
}

func (s *Server) debugRoutes(mux *http.ServeMux, h func(string, handler)) {
	h("GET /api/debug", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return map[string]any{"report": s.report(400), "file": trace.Path()}, nil
	})
	// The whole thing as a file to keep or send.
	h("GET /api/debug/report", func(w http.ResponseWriter, r *http.Request) (any, error) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="jobhunt-debug-`+s.E.Now().Format("2006-01-02-1504")+`.txt"`)
		w.Write([]byte(s.report(4000)))
		return noBody{}, nil
	})
	// What went wrong in a page: an error in the page's own code, a request that failed.
	h("POST /api/debug/note", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Text string `json:"text"`
			Page string `json:"page"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if len(in.Text) > 2000 {
			in.Text = in.Text[:2000]
		}
		if len(in.Page) > 120 {
			in.Page = in.Page[:120]
		}
		trace.Log("page", "%s on %s", in.Text, in.Page)
		return nil, nil
	})
	// Opens the folder a file lives in, on this computer.
	h("POST /api/open-folder", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			What string `json:"what"`
		}
		read(r, &in)
		dir := map[string]string{"data": s.E.Dir, "extension": extDir(), "backups": s.E.BackupDir()}[in.What]
		if dir == "" {
			return nil, bad("There is no such folder on this computer.")
		}
		var cmd *exec.Cmd
		switch runtime.GOOS {
		case "windows":
			cmd = exec.Command("explorer", dir)
		case "darwin":
			cmd = exec.Command("open", dir)
		default:
			cmd = exec.Command("xdg-open", dir)
		}
		if err := cmd.Start(); err != nil {
			return nil, bad("Couldn't open the folder: " + dir)
		}
		go cmd.Wait()
		return map[string]string{"dir": dir}, nil
	})
	// The side panel as one file to unpack, numbered like the program.
	mux.HandleFunc("GET /extension.zip", func(w http.ResponseWriter, r *http.Request) {
		b, err := extensionZip()
		if err != nil {
			http.Error(w, "couldn't pack the side panel", 500)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="JobHunt-side-panel.zip"`)
		w.Write(b)
	})
}

func extensionZip() ([]byte, error) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	err := fs.WalkDir(extension.FS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := extension.FS.ReadFile(p)
		if err != nil {
			return err
		}
		f, err := z.Create("Job Hunt side panel/" + p)
		if err != nil {
			return err
		}
		_, err = f.Write(b)
		return err
	})
	if err != nil {
		return nil, err
	}
	if err := z.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
