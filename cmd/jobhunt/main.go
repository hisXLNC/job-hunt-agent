// Job Hunt: finds roles, prepares what you send, and keeps track of what
// happens. One program, one data file, an interface on this computer only.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"jobhunt/internal/trace"
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
	d := filepath.Join(base, "Job Hunt 3")
	// The trial builds kept their data under an earlier name: carry on with it.
	if _, err := os.Stat(d); os.IsNotExist(err) {
		if was := filepath.Join(base, "Job Hunt 2"); exists(filepath.Join(was, "jobhunt.db")) {
			os.Rename(was, d)
		}
	}
	return d, os.MkdirAll(d, 0o700)
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// askToStop tells the Job Hunt already running on this port to stop, and
// waits until it has. The installer uses it before replacing the program.
func askToStop(port int) {
	url := fmt.Sprintf("http://127.0.0.1:%d/api/quit", port)
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("X-JobHunt", "1")
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return // nothing is running
	}
	resp.Body.Close()
	for i := 0; i < 40; i++ {
		time.Sleep(250 * time.Millisecond)
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			ln.Close()
			return
		}
	}
	os.Exit(1)
}

func main() {
	port := flag.Int("port", 47700, "port on this computer")
	noWindow := flag.Bool("no-window", false, "don't open a window")
	demo := flag.Bool("demo", false, "fill an empty data folder with sample data and use the stand-in instead of Claude")
	quit := flag.Bool("quit", false, "stop the Job Hunt that is running, then leave")
	version := flag.Bool("version", false, "print the version and leave")
	restarted := flag.Bool("restarted", false, "started by Job Hunt itself, to take over from the copy that is stopping")
	flag.Parse()
	// A click on a notification arrives as a link Windows hands to the program.
	page := pageFromLink(flag.Arg(0))
	if p, err := strconv.Atoi(os.Getenv("JOBHUNT_PORT")); err == nil && p > 0 {
		*port = p
	}
	if *version {
		fmt.Println(api.Version)
		return
	}
	if *quit {
		askToStop(*port)
		return
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", *port)

	if *restarted {
		// The copy that started this one is on its way out. Nothing is
		// touched until it has gone: two programs never have the data open.
		waitForParent(30 * time.Second)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	for i := 0; err != nil && *restarted && i < 60; i++ {
		time.Sleep(250 * time.Millisecond)
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	}
	if err != nil && *restarted {
		os.Exit(1)
	}
	if err != nil {
		// Already running: bring up its window and leave.
		c := http.Client{Timeout: 3 * time.Second}
		if resp, gerr := c.Get(url + "api/state"); gerr == nil {
			resp.Body.Close()
			if !*noWindow {
				// The copy that is running brings its own window forward;
				// one that can't gets a browser.
				body, _ := json.Marshal(map[string]string{"page": page})
				req, _ := http.NewRequest("POST", url+"api/window", bytes.NewReader(body))
				req.Header.Set("X-JobHunt", "1")
				req.Header.Set("Content-Type", "application/json")
				if r2, err := c.Do(req); err == nil && r2.StatusCode == 200 {
					r2.Body.Close()
				} else {
					trace.Log("window", "the running Job Hunt did not bring its window forward (%v); opening a plain window", err)
					if d, err := dataDir(); err == nil {
						openWindow(url+page, d)
					} else {
						openWindow(url+page, "")
					}
				}
			}
			return
		}
		fatal(fmt.Errorf("Job Hunt couldn't start: port %d on this computer is in use by another program (%v)", *port, err))
	}

	dir, err := dataDir()
	if err != nil {
		fatal(err)
	}
	// Everything the program does is written to debug.log in the data folder.
	if err := trace.Open(dir); err == nil {
		log.SetFlags(0)
		log.SetOutput(trace.Writer{Area: "app"})
	}
	trace.Log("app", "Job Hunt %s starting on %s/%s, demo=%v", api.Version, runtime.GOOS, runtime.GOARCH, *demo)
	defer trace.Close()
	defer trace.Log("app", "Job Hunt stopping")
	// A saved copy the person chose to put back takes the data's place now,
	// before anything has it open.
	restored := engine.ApplyStagedRestore(dir, filepath.Join(dir, "jobhunt.db"), time.Now())
	s, err := store.Open(filepath.Join(dir, "jobhunt.db"))
	if err != nil {
		fatal(fmt.Errorf("Job Hunt couldn't open its data in %s: %w", dir, err))
	}
	defer s.Close()
	if !*demo {
		keepStartShortcut()
	}
	e := engine.New(s, dir)
	e.Version = api.Version
	if !*demo {
		// Employers' logos are fetched as roles are found, and now for the ones already here.
		e.FetchLogos = true
		go e.WarmLogos()
	}
	e.Restored(restored)
	// Pages that turn a plain request away are opened in the browser already
	// on this computer, out of sight, when there is one.
	if b := sources.FindBrowser(); b != "" {
		e.Src.Render = sources.Renderer(b, filepath.Join(dir, "browser"))
	}
	if *demo {
		if err := seedDemo(e); err != nil {
			fatal(err)
		}
	} else {
		// Every tailored CV and letter is also kept as files, in Documents unless the person chose elsewhere.
		e.FilesHome = filepath.Join(documentsDir(), "Job Hunt")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	startWindow(url, dir)
	srv := &api.Server{E: e, S: s, Web: web.FS, Port: *port, Quit: stop, Show: showWindow, Startup: startsWithWindows, SetStartup: setStartsWithWindows, PC: machine(), Restart: func() error {
		noteWindowOpen(dir)
		return restartSelf(stop)
	}}
	e.BeforeUpdate = func() { noteWindowOpen(dir) }
	hs := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	srv.StartPhone()
	go func() {
		if err := hs.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print(err)
			stop()
		}
	}()
	// On this computer: notifications, the icon by the clock, and staying awake to search.
	e.BaseURL = url
	e.Notify = deskNotify
	if !*demo {
		runTray(ctx, stop, url, dir, e)
	}
	keepAwake(ctx, e)
	watchClipboard(ctx, e)
	linkBrowser = func() string { return e.Desk().Browser }
	if from := e.WhatsNew(); from != "" {
		e.Tell("Job Hunt updated to "+api.Version, "It installed by itself. Open it to see what changed.", "#/settings/app")
	}
	go e.Run()
	log.Printf("Job Hunt %s listening on %s, data in %s", api.Version, url, dir)
	if reopen := windowWasOpen(dir); (!*noWindow && !*restarted) || reopen {
		showWindow(page)
	}
	<-ctx.Done()
	closeWindow()
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

// openWindow shows the interface when Job Hunt's own window can't: as an
// Edge or Chrome app window where one is installed (in a profile of its own
// when dir is given), otherwise in the default browser.
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
				args := []string{"--app=" + url, "--window-size=1440,940"}
				if dir != "" {
					// Its own profile: none of the person's extensions (password
					// managers, Claude in the browser) run inside Job Hunt.
					args = append(args, "--user-data-dir="+filepath.Join(dir, "browser"), "--no-first-run", "--no-default-browser-check", "--disable-extensions")
				}
				if exec.Command(p, args...).Start() == nil {
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
