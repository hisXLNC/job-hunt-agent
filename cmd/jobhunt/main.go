// Job Hunt: finds roles, prepares what you send, and keeps track of what
// happens. One program, one data file, an interface on this computer only.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"jobhunt/internal/api"
	"jobhunt/internal/engine"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
	"jobhunt/web"
)

func dataDir() (string, error) {
	if d := os.Getenv("JOBHUNT_HOME"); d != "" {
		return d, os.MkdirAll(d, 0o700)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	d := filepath.Join(base, "Job Hunt 2")
	return d, os.MkdirAll(d, 0o700)
}

func main() {
	port := flag.Int("port", 47700, "port on this computer")
	noWindow := flag.Bool("no-window", false, "don't open a window")
	demo := flag.Bool("demo", false, "fill an empty data folder with sample data and use the stand-in instead of Claude")
	flag.Parse()
	if p, err := strconv.Atoi(os.Getenv("JOBHUNT_PORT")); err == nil && p > 0 {
		*port = p
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", *port)

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		// Already running: bring up its window and leave.
		c := http.Client{Timeout: 3 * time.Second}
		if resp, gerr := c.Get(url + "api/state"); gerr == nil {
			resp.Body.Close()
			if !*noWindow {
				openWindow(url, "")
			}
			return
		}
		fatal(fmt.Errorf("Job Hunt couldn't start: port %d on this computer is in use by another program (%v)", *port, err))
	}

	dir, err := dataDir()
	if err != nil {
		fatal(err)
	}
	if f, err := os.OpenFile(filepath.Join(dir, "jobhunt.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil {
		if st, _ := f.Stat(); st != nil && st.Size() > 4<<20 {
			f.Truncate(0)
		}
		log.SetOutput(f)
	}
	s, err := store.Open(filepath.Join(dir, "jobhunt.db"))
	if err != nil {
		fatal(fmt.Errorf("Job Hunt couldn't open its data in %s: %w", dir, err))
	}
	defer s.Close()
	e := engine.New(s, dir)
	// Pages that turn a plain request away are opened in the browser already
	// on this computer, out of sight, when there is one.
	if b := sources.FindBrowser(); b != "" {
		e.Src.Render = sources.Renderer(b, filepath.Join(dir, "browser"))
	}
	if *demo {
		if err := seedDemo(e); err != nil {
			fatal(err)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &api.Server{E: e, S: s, Web: web.FS, Port: *port, Quit: stop}
	hs := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := hs.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print(err)
			stop()
		}
	}()
	go e.Run()
	log.Printf("Job Hunt %s listening on %s, data in %s", api.Version, url, dir)
	if !*noWindow {
		openWindow(url, dir)
	}
	<-ctx.Done()
	e.Stop()
	sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	hs.Shutdown(sctx)
}

func fatal(err error) {
	log.SetOutput(os.Stderr)
	log.Print(err)
	if runtime.GOOS == "windows" {
		// No console is attached to the windowed program: say it in a box.
		exec.Command("mshta", "javascript:alert('"+jsSafe(err.Error())+"');close()").Run()
	}
	os.Exit(1)
}

func jsSafe(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch r {
		case '\'', '"', '\\', '<', '>', '\n', '\r':
			out = append(out, ' ')
		default:
			out = append(out, r)
		}
	}
	return string(out)
}

// openWindow shows the interface: as its own window where Edge or Chrome is
// installed, otherwise in the default browser.
func openWindow(url, dir string) {
	switch runtime.GOOS {
	case "windows":
		for _, p := range []string{
			filepath.Join(os.Getenv("ProgramFiles(x86)"), `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(os.Getenv("ProgramFiles"), `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(os.Getenv("ProgramFiles"), `Google\Chrome\Application\chrome.exe`),
			filepath.Join(os.Getenv("LocalAppData"), `Google\Chrome\Application\chrome.exe`),
		} {
			if _, err := os.Stat(p); err == nil {
				if exec.Command(p, "--app="+url, "--window-size=1440,940").Start() == nil {
					return
				}
			}
		}
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}
