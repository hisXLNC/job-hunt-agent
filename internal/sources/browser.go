package sources

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// Some job sites turn away anything that is not a real web browser, and
// others send an empty page and fill it in with scripts. For those, the
// browser already installed on the computer (Edge on every Windows machine)
// is asked to load the page out of sight and hand back what it shows.

// FindBrowser returns the path of an installed Chromium-family browser, or
// "". JOBHUNT_BROWSER overrides the search.
func FindBrowser() string {
	if p := os.Getenv("JOBHUNT_BROWSER"); p != "" {
		return p
	}
	var paths []string
	switch runtime.GOOS {
	case "windows":
		for _, root := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LocalAppData")} {
			if root != "" {
				paths = append(paths, filepath.Join(root, `Microsoft\Edge\Application\msedge.exe`), filepath.Join(root, `Google\Chrome\Application\chrome.exe`))
			}
		}
	case "darwin":
		paths = []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"}
	default:
		for _, name := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	for _, p := range paths {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// Renderer returns a function for Client.Render that loads a page in the
// given browser, with its own empty profile kept in dir, and returns the
// page as the browser shows it. One page is loaded at a time.
func Renderer(browser, dir string) func(ctx context.Context, addr string) (string, error) {
	var mu sync.Mutex
	return func(ctx context.Context, addr string) (string, error) {
		u, ok := publicURL(addr)
		if !ok {
			return "", fmt.Errorf("sources: %q is not a public web address", addr)
		}
		mu.Lock()
		defer mu.Unlock()
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", err
		}
		ctx, cancel := context.WithTimeout(ctx, 50*time.Second)
		defer cancel()
		args := []string{
			"--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
			"--mute-audio", "--hide-scrollbars", "--window-size=1366,2400", "--user-data-dir=" + dir,
			"--user-agent=" + defaultUA, "--lang=en-CA",
			// Let the page's scripts run for a while, then print what it shows.
			"--virtual-time-budget=9000", "--timeout=30000", "--dump-dom", u.String(),
		}
		if runtime.GOOS == "linux" && os.Geteuid() == 0 {
			args = append([]string{"--no-sandbox"}, args...) // Chromium refuses to start as root otherwise
		}
		cmd := exec.CommandContext(ctx, browser, args...)
		var out bytes.Buffer
		cmd.Stdout = &limited{w: &out, left: maxBody}
		cmd.WaitDelay = 5 * time.Second
		hideWindow(cmd)
		err := cmd.Run()
		if out.Len() < 200 {
			if err == nil {
				err = errors.New("the browser showed an empty page")
			}
			return "", fmt.Errorf("sources: reading %s in a browser: %w", u.Host, err)
		}
		return out.String(), nil
	}
}

// limited stops keeping output after a set number of bytes.
type limited struct {
	w    *bytes.Buffer
	left int
}

func (l *limited) Write(p []byte) (int, error) {
	if n := min(len(p), l.left); n > 0 {
		l.w.Write(p[:n])
		l.left -= n
	}
	return len(p), nil
}
