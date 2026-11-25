package engine

import (
	"bytes"
	"cmp"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// Carrying on on another computer. When copies are kept in a folder the
// person chose (a cloud drive, nearly always), each computer also keeps its
// own latest copy there, "jobhunt-on-<computer>.db", with a short note
// beside it saying which computer made it and when. Another computer that
// starts and finds a newer copy than the one it last took offers to carry
// on from it, which is the ordinary safe restore: what is here is saved
// first. Only one computer works at a time; when both were used since they
// were last in step, the person is told plainly, and nothing is merged.
//
// What this computer last took or handed over is kept in a small file in
// its own data folder, not in the data: the data is what gets swapped.

// Handover is another computer's copy, newer than what this computer has.
type Handover struct {
	Computer string `json:"computer"`
	At       int64  `json:"at"`     // when that copy was made
	Copy     string `json:"copy"`   // its file name in the copies folder
	Handed   bool   `json:"handed"` // it was made by "Hand over to the other computer"
	// Both: this computer was used too since the two were last in step, so
	// carrying on there leaves this computer's own work since Since behind
	// (saved as a copy first, never merged).
	Both  bool  `json:"both"`
	Since int64 `json:"since"`
}

// copyNote is the note beside a computer's own latest copy.
type copyNote struct {
	Computer string `json:"computer"`
	At       int64  `json:"at"`
	Size     int64  `json:"size"`
	Version  string `json:"version"`
	Handed   bool   `json:"handed"`
}

// inStep is what this computer last took from, or handed over to, another.
type inStep struct {
	Synced int64 `json:"synced"` // the time of the copy last taken, or of the last hand-over
	Left   int64 `json:"left"`   // a copy offered and turned down: this one is not offered again
}

var (
	onCopy    = regexp.MustCompile(`^jobhunt-on-[a-z0-9-]{1,40}\.db$`)
	notSlug   = regexp.MustCompile(`[^a-z0-9]+`)
	applyName = "Job Hunt applications.csv"
)

// Computer is this computer's name.
func (e *Engine) Computer() string {
	if e.HostName != "" {
		return e.HostName
	}
	if h, err := os.Hostname(); err == nil && strings.TrimSpace(h) != "" {
		return strings.TrimSpace(h)
	}
	return "This computer"
}

func computerSlug(name string) string {
	s := strings.Trim(notSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > 40 {
		s = strings.Trim(s[:40], "-")
	}
	if s == "" {
		s = "computer"
	}
	return s
}

func (e *Engine) ownCopyName() string { return "jobhunt-on-" + computerSlug(e.Computer()) + ".db" }

func stepFile(dir string) string { return filepath.Join(dir, "in-step.json") }

func (e *Engine) inStep() inStep {
	var st inStep
	if e.Dir == "" {
		return st
	}
	if b, err := os.ReadFile(stepFile(e.Dir)); err == nil {
		json.Unmarshal(b, &st)
	}
	return st
}

func (e *Engine) setInStep(st inStep) {
	if e.Dir == "" {
		return
	}
	b, _ := json.Marshal(st)
	os.WriteFile(stepFile(e.Dir), b, 0o600)
}

// sharedDir is the folder the person chose for copies, or "" when copies
// stay in the data folder (where no other computer sees them).
func (e *Engine) sharedDir() string {
	set := e.BackupSet()
	if set.Dir == "" || !isDir(set.Dir) {
		return ""
	}
	return set.Dir
}

// keepOwnCopy puts this computer's latest copy, and the note about it, in
// the shared folder. src is the copy just made.
func (e *Engine) keepOwnCopy(dir, src string, handed bool) error {
	dst := filepath.Join(dir, e.ownCopyName())
	tmp := dst + ".tmp"
	if err := copyFile(src, tmp); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return err
	}
	info, err := os.Stat(dst)
	if err != nil {
		return err
	}
	note := copyNote{Computer: e.Computer(), At: e.Now().Unix(), Size: info.Size(), Version: e.Version, Handed: handed}
	b, _ := json.Marshal(note)
	return os.WriteFile(strings.TrimSuffix(dst, ".db")+".json", b, 0o600)
}

// notes reads every computer's note in the shared folder.
func notesIn(dir string) map[string]copyNote {
	out := map[string]copyNote{}
	entries, _ := os.ReadDir(dir)
	for _, en := range entries {
		name := en.Name()
		if en.IsDir() || !strings.HasPrefix(name, "jobhunt-on-") || !strings.HasSuffix(name, ".json") {
			continue
		}
		db := strings.TrimSuffix(name, ".json") + ".db"
		if !onCopy.MatchString(db) {
			continue
		}
		var n copyNote
		if b, err := os.ReadFile(filepath.Join(dir, name)); err == nil && json.Unmarshal(b, &n) == nil && n.At > 0 {
			out[db] = n
		}
	}
	return out
}

// OtherComputer is the newest copy another computer left in the shared
// folder that this computer has not taken, or nil.
func (e *Engine) OtherComputer() *Handover {
	dir := e.sharedDir()
	if dir == "" {
		return nil
	}
	if e.StagedRestore() != nil {
		return nil // a copy is already waiting to be put back
	}
	st := e.inStep()
	mine := e.ownCopyName()
	var best *Handover
	for name, n := range notesIn(dir) {
		if name == mine || n.At <= st.Synced || n.At <= st.Left {
			continue
		}
		// A cloud drive can bring the note before it has brought the whole copy.
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || !info.Mode().IsRegular() || (n.Size > 0 && info.Size() != n.Size) {
			continue
		}
		if best == nil || n.At > best.At {
			best = &Handover{Computer: n.Computer, At: n.At, Copy: name, Handed: n.Handed}
		}
	}
	if best == nil {
		return nil
	}
	// Used here too since the two were last in step? A minute's grace for
	// what was still finishing as the person handed over.
	if e.startWork > st.Synced+60 {
		best.Both, best.Since = true, max(st.Synced, 0)
	}
	return best
}

// ContinueFrom gets another computer's copy ready to be put back, as the
// safe restore does: what is here now is saved as a copy first, when Job
// Hunt next starts.
func (e *Engine) ContinueFrom(name string) (*Handover, error) {
	h := e.OtherComputer()
	if h == nil || h.Copy != name {
		return nil, errors.New("There is no newer copy from another computer to carry on from.")
	}
	if _, err := e.StageRestore(name); err != nil {
		return nil, err
	}
	st := e.inStep()
	st.Synced = h.At
	e.setInStep(st)
	trace.Log("app", "carrying on from %s's copy of %s", h.Computer, time.Unix(h.At, 0).Format(time.RFC3339))
	return h, nil
}

// StayHere turns down another computer's copy: it is not offered again,
// a newer one from there will be.
func (e *Engine) StayHere() {
	if h := e.OtherComputer(); h != nil {
		st := e.inStep()
		st.Left = h.At
		e.setInStep(st)
		e.S.Changed("app", "status")
	}
}

// HandedOver is what "Hand over to the other computer" did.
type HandedOver struct {
	Computer string `json:"computer"`
	At       int64  `json:"at"`
	Dir      string `json:"dir"`
}

// HandOver saves a fresh copy in the shared folder now, for the other
// computer to carry on from.
func (e *Engine) HandOver() (*HandedOver, error) {
	dir := e.sharedDir()
	if dir == "" {
		return nil, errors.New("Keep your copies in a cloud drive first (You, The app, Saved copies), so the other computer can see them.")
	}
	dst, err := e.backup(true)
	if err != nil {
		return nil, fmt.Errorf("Couldn't save a copy: %v", err)
	}
	if filepath.Dir(dst) != filepath.Clean(dir) {
		return nil, errors.New("The copies folder isn't there right now (is the drive running?). The copy went to this computer only.")
	}
	if n, ok := notesIn(dir)[e.ownCopyName()]; !ok || !n.Handed {
		return nil, errors.New("Couldn't save the copy for the other computer. Check the drive is running and try again.")
	}
	now := e.Now().Unix()
	st := e.inStep()
	st.Synced = now
	e.setInStep(st)
	e.S.Log(store.Activity{Kind: "app", Text: "Handed over: a fresh copy is in " + dir})
	e.S.Changed("app")
	return &HandedOver{Computer: e.Computer(), At: now, Dir: dir}, nil
}

// ---- the applications spreadsheet --------------------------------------------------------

// WriteRolesCSV writes every role as a spreadsheet file: the same content
// as the download on the Roles page.
func (e *Engine) WriteRolesCSV(w io.Writer) error {
	roles, _, err := e.S.Roles(store.RoleFilter{Closed: []string{"*"}, Unread: true, Sort: "age", Limit: 20000})
	if err != nil {
		return err
	}
	w.Write([]byte("\xEF\xBB\xBF"))
	cw := csv.NewWriter(w)
	day := func(t int64) string {
		if t <= 0 {
			return ""
		}
		return time.Unix(t, 0).Format("2006-01-02")
	}
	num := func(n int) string {
		if n < 0 {
			return ""
		}
		return strconv.Itoa(n)
	}
	// A cell that starts like a formula is text from a posting: it is kept from running in a spreadsheet.
	safe := func(s string) string {
		if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
			return "'" + s
		}
		return s
	}
	cw.Write([]string{"Title", "Employer", "Place", "Way of working", "Pay", "Fit now", "Fit tailored", "Stage", "Closed", "Why", "Posted", "First seen", "Applied", "Applicants", "Source", "Link"})
	for _, x := range roles {
		cw.Write([]string{safe(x.Title), safe(x.Company), safe(x.Location), x.Workplace, safe(x.Pay), num(x.Fit), num(x.FitTailored), x.Stage, x.Closed, safe(x.ClosedWhy), day(x.PostedAt), day(x.FirstSeenAt), day(x.AppliedAt), num(x.Applicants), x.Source, safe(cmp.Or(x.ApplyURL, x.URL))})
	}
	cw.Flush()
	return cw.Error()
}

// KeepApplicationsSheet keeps "Job Hunt applications.csv" up to date in the
// folder the person chose for copies, so it can be opened anywhere their
// cloud drive is. It is written only when something in it changed.
func (e *Engine) KeepApplicationsSheet() error {
	dir := e.sharedDir()
	if dir == "" {
		return nil
	}
	var buf bytes.Buffer
	if err := e.WriteRolesCSV(&buf); err != nil {
		return err
	}
	dst := filepath.Join(dir, applyName)
	if was, err := os.ReadFile(dst); err == nil && bytes.Equal(was, buf.Bytes()) {
		return nil
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o600); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		// Open in a spreadsheet program on Windows: it is written next time.
		os.Remove(tmp)
		return err
	}
	return nil
}
