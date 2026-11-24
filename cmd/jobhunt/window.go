package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var pagePath = regexp.MustCompile(`^#/[A-Za-z0-9/_?=&.-]{0,200}$`)

// pageOK says whether text names one of Job Hunt's pages and nothing else.
func pageOK(page string) bool { return page == "" || pagePath.MatchString(page) }

// pageFromLink reads the page out of a link Windows handed to the program
// ("jobhunt3://open/roles/5"), or "" when it is anything else.
func pageFromLink(arg string) string {
	rest, ok := strings.CutPrefix(arg, "jobhunt3://open")
	if !ok {
		return ""
	}
	rest = strings.TrimSuffix(rest, "/")
	if rest == "" {
		return ""
	}
	if page := "#" + rest; pageOK(page) {
		return page
	}
	return ""
}

// When Job Hunt stops to be replaced by a newer copy of itself, it notes
// that its window was open, so the new copy opens it again.
func reopenFile(dir string) string { return filepath.Join(dir, "reopen-window") }

func noteWindowOpen(dir string) {
	if windowOpen() {
		os.WriteFile(reopenFile(dir), []byte("1"), 0o600)
	}
}

func windowWasOpen(dir string) bool {
	if _, err := os.Stat(reopenFile(dir)); err != nil {
		return false
	}
	os.Remove(reopenFile(dir))
	return true
}
