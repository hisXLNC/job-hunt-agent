package engine

import (
	"strings"
	"sync"
)

// Notice is one thing Job Hunt told the person: a fresh strong role, someone
// who wrote, a new version, a problem. The newest fifty are kept so they can
// be read later under the bell, whether or not a notification was shown.
type Notice struct {
	ID    int64  `json:"id"`
	At    int64  `json:"at"`
	Kind  string `json:"kind"` // role, mail, app, problem
	Title string `json:"title"`
	Text  string `json:"text"`
	Page  string `json:"page"` // the part of Job Hunt it opens, like "#/roles/12"
	Read  bool   `json:"read"`
}

const noticesKept = 50

type noticeBook struct {
	Next int64    `json:"next"`
	List []Notice `json:"list"` // newest first
}

var noticeMu sync.Mutex

func (e *Engine) noticeBook() noticeBook {
	var b noticeBook
	e.S.Get("notices", &b)
	return b
}

// Keep puts a notice under the bell. The same notice is not kept twice while
// the first is still unread.
func (e *Engine) Keep(kind, title, text, page string) {
	if !strings.HasPrefix(page, "#/") {
		page = "#/today"
	}
	noticeMu.Lock()
	defer noticeMu.Unlock()
	b := e.noticeBook()
	for _, n := range b.List {
		if !n.Read && n.Title == title && n.Text == text && n.Page == page {
			return
		}
	}
	b.Next++
	b.List = append([]Notice{{ID: b.Next, At: e.Now().Unix(), Kind: kind, Title: title, Text: text, Page: page}}, b.List...)
	if len(b.List) > noticesKept {
		b.List = b.List[:noticesKept]
	}
	e.S.Set("notices", b)
	e.S.Changed("notices")
}

// Notices lists what is kept under the bell, newest first, and how many are unread.
func (e *Engine) Notices() ([]Notice, int) {
	b := e.noticeBook()
	unread := 0
	for _, n := range b.List {
		if !n.Read {
			unread++
		}
	}
	return b.List, unread
}

// UnreadNotices is the number on the bell.
func (e *Engine) UnreadNotices() int {
	_, n := e.Notices()
	return n
}

// ReadNotices marks one notice as read, or all of them when id is 0.
func (e *Engine) ReadNotices(id int64) {
	noticeMu.Lock()
	defer noticeMu.Unlock()
	b := e.noticeBook()
	changed := false
	for i := range b.List {
		if (id == 0 || b.List[i].ID == id) && !b.List[i].Read {
			b.List[i].Read, changed = true, true
		}
	}
	if changed {
		e.S.Set("notices", b)
		e.S.Changed("notices")
	}
}

// noticeKind says what a notice is about from the page it opens.
func noticeKind(page string) string {
	switch {
	case strings.HasPrefix(page, "#/roles"):
		return "role"
	case strings.HasPrefix(page, "#/replies"), strings.HasPrefix(page, "#/people"):
		return "mail"
	}
	return "app"
}

// keepProblem puts a "Needs attention" problem under the bell, opening the
// page where it can be dealt with.
func (e *Engine) keepProblem(text string) {
	page := "#/settings/app"
	if strings.Contains(text, "Settings → Connections") || strings.Contains(text, "phone notice") {
		page = "#/settings/connections"
	}
	e.Keep("problem", "Needs attention", text, page)
}

// Theme is how the pages are coloured: "light", "dark", or "system" to
// follow what Windows is set to.
func (e *Engine) Theme() string {
	switch t := e.S.GetString("theme"); t {
	case "dark", "system":
		return t
	}
	return "light"
}

func (e *Engine) SetTheme(t string) error {
	if t != "dark" && t != "system" {
		t = "light"
	}
	err := e.S.Set("theme", t)
	e.S.Changed("status")
	return err
}
