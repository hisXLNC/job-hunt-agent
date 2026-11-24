// Package trace is Job Hunt's debugging record: one line for everything the
// program does (each request to it, each page it fetches, each call to
// Claude, each background job, each error), kept in a file in the data
// folder and in memory, so that a problem can be looked into afterwards.
//
// Lines never carry e-mail addresses or keys: they are taken out on the way in.
package trace

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	keepLines = 4000    // in memory
	maxFile   = 3 << 20 // the file starts again after this, the old one kept once
	maxLine   = 1200
)

var (
	mu    sync.Mutex
	ring  []string
	file  *os.File
	path  string
	size  int64
	start = time.Now()
	now   = time.Now
)

var (
	mailRe = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	keyRe  = regexp.MustCompile(`(?i)(sk-[A-Za-z0-9_\-]{8,}|bearer\s+[A-Za-z0-9._\-]{8,}|(?:api[_-]?key|token|password|secret|authorization|key)=[^&\s"']+)`)
)

// Clean takes e-mail addresses, keys and line breaks out of a line.
func Clean(s string) string {
	s = mailRe.ReplaceAllString(s, "[e-mail]")
	s = keyRe.ReplaceAllString(s, "[key]")
	s = strings.NewReplacer("\r", " ", "\n", " ⏎ ").Replace(s)
	if len(s) > maxLine {
		s = s[:maxLine] + "…"
	}
	return s
}

// Open starts writing the record to <dir>/debug.log as well as keeping it in memory.
func Open(dir string) error {
	mu.Lock()
	defer mu.Unlock()
	path = filepath.Join(dir, "debug.log")
	return reopen()
}

func reopen() error {
	if file != nil {
		file.Close()
		file = nil
	}
	if st, err := os.Stat(path); err == nil && st.Size() > maxFile {
		os.Remove(path + ".old")
		os.Rename(path, path+".old")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	file, size = f, 0
	if st, err := f.Stat(); err == nil {
		size = st.Size()
	}
	return nil
}

// Close stops writing to the file; the record in memory stays.
func Close() {
	mu.Lock()
	defer mu.Unlock()
	if file != nil {
		file.Close()
		file = nil
	}
}

// Path is where the record is written, "" when it is only kept in memory.
func Path() string {
	mu.Lock()
	defer mu.Unlock()
	return path
}

// Uptime is how long the program has been running.
func Uptime() time.Duration { return time.Since(start) }

// Log adds one line. area says which part of the program is speaking:
// app, request, page, fetch, claude, job, search, did, problem.
func Log(area, format string, args ...any) {
	text := format
	if len(args) > 0 {
		text = fmt.Sprintf(format, args...)
	}
	line := now().Format("2006-01-02 15:04:05.000") + " " + fmt.Sprintf("%-8s", area) + " " + Clean(text)
	mu.Lock()
	defer mu.Unlock()
	ring = append(ring, line)
	if len(ring) > keepLines+500 {
		ring = append([]string(nil), ring[len(ring)-keepLines:]...)
	}
	if file != nil {
		n, _ := file.WriteString(line + "\n")
		size += int64(n)
		if size > maxFile {
			reopen()
		}
	}
}

// Tail returns the newest n lines, oldest first.
func Tail(n int) []string {
	mu.Lock()
	defer mu.Unlock()
	if n <= 0 || n > len(ring) {
		n = len(ring)
	}
	return append([]string(nil), ring[len(ring)-n:]...)
}

// Writer lets the standard logger write into the record.
type Writer struct{ Area string }

func (w Writer) Write(p []byte) (int, error) {
	Log(w.Area, "%s", strings.TrimRight(string(p), "\r\n"))
	return len(p), nil
}

// Took writes a duration the short way.
func Took(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	return fmt.Sprintf("%.1fs", d.Seconds())
}
