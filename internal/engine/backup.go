package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// BackupSet is where the daily copies of the data are kept and how many.
// An empty Dir means the "backups" folder inside the data folder.
type BackupSet struct {
	Dir  string `json:"dir"`
	Keep int    `json:"keep"`
}

// Copy is one saved copy of the data.
type Copy struct {
	Name   string `json:"name"`
	At     int64  `json:"at"`
	Size   int64  `json:"size"`
	Before bool   `json:"before"` // saved by Job Hunt just before a copy was put back, or before a clear-out
	What   string `json:"what"`   // what it was saved before, in words
}

// StagedRestore is a saved copy waiting to be put back at the next start.
type StagedRestore struct {
	Name     string    `json:"name"`
	At       int64     `json:"at"`        // when that copy was saved
	StagedAt int64     `json:"staged_at"` // when the person chose it
	Keep     BackupSet `json:"keep"`      // where copies are kept now, carried over
}

var (
	dailyCopy  = regexp.MustCompile(`^jobhunt-\d{4}-\d{2}-\d{2}\.db$`)
	beforeCopy = regexp.MustCompile(`^jobhunt-before-(restore|clearing)-\d{8}-\d{6}\.db$`)
)

const beforeKept = 3

func validKeep(n int) bool { return n == 7 || n == 14 || n == 30 }

func (e *Engine) BackupSet() BackupSet {
	set := BackupSet{Keep: 7}
	e.S.Get("backup", &set)
	if !validKeep(set.Keep) {
		set.Keep = 7
	}
	return set
}

// DefaultBackupDir is where copies go unless the person chose another folder.
func (e *Engine) DefaultBackupDir() string { return filepath.Join(e.Dir, "backups") }

// BackupDir is the folder copies are kept in now.
func (e *Engine) BackupDir() string {
	if d := e.BackupSet().Dir; d != "" {
		return d
	}
	return e.DefaultBackupDir()
}

// SetBackup changes where copies are kept and how many. The folder has to
// be there already and take a file.
func (e *Engine) SetBackup(set BackupSet) error {
	set.Dir = strings.TrimSpace(strings.Trim(strings.TrimSpace(set.Dir), `"`))
	if !validKeep(set.Keep) {
		return errors.New("Keep 7, 14 or 30 copies.")
	}
	if set.Dir != "" {
		if !filepath.IsAbs(set.Dir) {
			return errors.New("Write the whole path of the folder, starting from the drive.")
		}
		set.Dir = filepath.Clean(set.Dir)
		info, err := os.Stat(set.Dir)
		if err != nil || !info.IsDir() {
			return errors.New("There is no such folder on this computer. Make it first, then paste its path here.")
		}
		probe, err := os.CreateTemp(set.Dir, ".jobhunt-check-*")
		if err != nil {
			return errors.New("Job Hunt can't save files in that folder. Choose one you can write to.")
		}
		probe.Close()
		os.Remove(probe.Name())
		if set.Dir == filepath.Clean(e.DefaultBackupDir()) {
			set.Dir = ""
		}
	}
	if err := e.S.Set("backup", set); err != nil {
		return err
	}
	e.S.Changed("app")
	return nil
}

// Backup writes today's copy of the data and keeps the newest few.
func (e *Engine) Backup() (string, error) {
	if e.Dir == "" {
		return "", errors.New("no data folder")
	}
	set := e.BackupSet()
	dir := e.BackupDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		if set.Dir == "" {
			return "", err
		}
		// The folder the person chose is away (a drive not plugged in): the
		// copy goes to the data folder instead of not being made.
		dir = e.DefaultBackupDir()
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", err
		}
	}
	dst := filepath.Join(dir, "jobhunt-"+e.Now().Format("2006-01-02")+".db")
	if err := e.S.Backup(dst); err != nil {
		if set.Dir == "" || dir == e.DefaultBackupDir() {
			return "", err
		}
		dir = e.DefaultBackupDir()
		if merr := os.MkdirAll(dir, 0o700); merr != nil {
			return "", err
		}
		dst = filepath.Join(dir, filepath.Base(dst))
		if err := e.S.Backup(dst); err != nil {
			return "", err
		}
	}
	prune(dir, dailyCopy, set.Keep)
	prune(dir, beforeCopy, beforeKept)
	e.S.Changed("app")
	return dst, nil
}

// prune removes the oldest files in dir whose names match, leaving keep.
// The names carry their date, so sorting them sorts by age.
func prune(dir string, match *regexp.Regexp, keep int) {
	entries, _ := os.ReadDir(dir)
	var names []string
	for _, en := range entries {
		if !en.IsDir() && match.MatchString(en.Name()) {
			names = append(names, en.Name())
		}
	}
	sort.Strings(names)
	for len(names) > keep {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

// Copies lists the saved copies, newest first.
func (e *Engine) Copies() []Copy {
	entries, _ := os.ReadDir(e.BackupDir())
	out := []Copy{}
	for _, en := range entries {
		name := en.Name()
		daily, before := dailyCopy.MatchString(name), beforeCopy.MatchString(name)
		if en.IsDir() || (!daily && !before) {
			continue
		}
		info, err := en.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		c := Copy{Name: name, At: info.ModTime().Unix(), Size: info.Size(), Before: before}
		switch {
		case strings.HasPrefix(name, "jobhunt-before-clearing-"):
			c.What = "Before clearing the old Job Hunt's jobs"
		case before:
			c.What = "Before a restore"
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].At != out[j].At {
			return out[i].At > out[j].At
		}
		return out[i].Name > out[j].Name
	})
	return out
}

func restoreDir(dir string) string  { return filepath.Join(dir, "restore") }
func pendingDB(dir string) string   { return filepath.Join(restoreDir(dir), "pending.db") }
func pendingNote(dir string) string { return filepath.Join(restoreDir(dir), "pending.json") }
func replacedDB(dir string) string  { return filepath.Join(restoreDir(dir), "replaced.db") }

// StageRestore gets a saved copy ready to be put back. Nothing changes until
// the program next starts: a database is not swapped under a running program.
func (e *Engine) StageRestore(name string) (*StagedRestore, error) {
	if e.Dir == "" {
		return nil, errors.New("no data folder")
	}
	if !dailyCopy.MatchString(name) && !beforeCopy.MatchString(name) {
		return nil, errors.New("That is not one of the saved copies.")
	}
	src := filepath.Join(e.BackupDir(), name)
	info, err := os.Stat(src)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("That copy isn't there any more.")
	}
	if err := store.Check(src); err != nil {
		return nil, fmt.Errorf("This copy can't be put back: %v.", err)
	}
	if err := os.MkdirAll(restoreDir(e.Dir), 0o700); err != nil {
		return nil, err
	}
	tmp := pendingDB(e.Dir) + ".tmp"
	if err := copyFile(src, tmp); err != nil {
		os.Remove(tmp)
		return nil, fmt.Errorf("Couldn't get the copy ready: %v", err)
	}
	st := StagedRestore{Name: name, At: info.ModTime().Unix(), StagedAt: e.Now().Unix(), Keep: e.BackupSet()}
	b, _ := json.Marshal(st)
	os.Remove(pendingNote(e.Dir))
	if err := os.Rename(tmp, pendingDB(e.Dir)); err != nil {
		os.Remove(tmp)
		return nil, err
	}
	if err := os.WriteFile(pendingNote(e.Dir), b, 0o600); err != nil {
		os.Remove(pendingDB(e.Dir))
		return nil, err
	}
	trace.Log("app", "restore staged: %s", name)
	e.S.Changed("app")
	return &st, nil
}

// StagedRestore is the copy waiting to be put back, or nil.
func (e *Engine) StagedRestore() *StagedRestore {
	if e.Dir == "" {
		return nil
	}
	return readStaged(e.Dir)
}

func readStaged(dir string) *StagedRestore {
	if _, err := os.Stat(pendingDB(dir)); err != nil {
		return nil
	}
	var st StagedRestore
	if b, err := os.ReadFile(pendingNote(dir)); err == nil {
		json.Unmarshal(b, &st)
	}
	if st.Name == "" {
		st.Name = "a saved copy"
	}
	return &st
}

// CancelRestore forgets the copy that was waiting to be put back.
func (e *Engine) CancelRestore() error {
	if e.Dir == "" {
		return nil
	}
	os.Remove(pendingNote(e.Dir))
	err := os.Remove(pendingDB(e.Dir))
	if os.IsNotExist(err) {
		err = nil
	}
	e.S.Changed("app")
	return err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// RestoreOutcome is what happened to a staged copy when the program started.
type RestoreOutcome struct {
	Staged StagedRestore `json:"staged"`
	Saved  string        `json:"saved"` // where the data that was replaced was saved first
	Error  string        `json:"error"` // why the copy was not put back; the data is as it was
}

// ApplyStagedRestore puts back the saved copy the person chose, if one is
// waiting. It runs when the program starts, before the data is opened by
// anything else: what is there now is saved as a copy of its own, then the
// chosen copy takes its place. If any step fails the data stays as it was.
// It returns nil when nothing was waiting.
func ApplyStagedRestore(dir, dbPath string, now time.Time) *RestoreOutcome {
	st := readStaged(dir)
	if st == nil {
		return nil
	}
	out := &RestoreOutcome{Staged: *st}
	fail := func(err error) *RestoreOutcome {
		out.Error = err.Error()
		os.Remove(pendingDB(dir))
		os.Remove(pendingNote(dir))
		trace.Log("problem", "restore of %s not applied: %v", st.Name, err)
		return out
	}
	if err := store.Check(pendingDB(dir)); err != nil {
		return fail(err)
	}
	if _, err := os.Stat(dbPath); err == nil {
		// Save what is there now, exactly as it is at this moment. Opening
		// and closing it also folds its journal into the one file.
		cur, err := store.Open(dbPath)
		if err != nil {
			return fail(fmt.Errorf("the data in use couldn't be opened to save it first: %w", err))
		}
		var set BackupSet
		cur.Get("backup", &set)
		name := "jobhunt-before-restore-" + now.Format("20060102-150405") + ".db"
		var saveErr error
		for _, d := range []string{set.Dir, filepath.Join(dir, "backups")} {
			if d == "" {
				continue
			}
			if saveErr = os.MkdirAll(d, 0o700); saveErr != nil {
				continue
			}
			if saveErr = cur.Backup(filepath.Join(d, name)); saveErr == nil {
				out.Saved = filepath.Join(d, name)
				break
			}
		}
		cur.Close()
		if out.Saved == "" {
			return fail(fmt.Errorf("the data in use couldn't be saved first: %v", saveErr))
		}
		for _, side := range []string{"-wal", "-shm"} {
			os.Remove(dbPath + side)
		}
		os.Remove(replacedDB(dir))
		if err := os.Rename(dbPath, replacedDB(dir)); err != nil {
			return fail(fmt.Errorf("the data in use couldn't be moved aside: %w", err))
		}
	}
	if err := os.Rename(pendingDB(dir), dbPath); err != nil {
		// Put back what was there.
		os.Rename(replacedDB(dir), dbPath)
		return fail(fmt.Errorf("the copy couldn't be moved into place: %w", err))
	}
	os.Remove(pendingNote(dir))
	os.Remove(replacedDB(dir))
	trace.Log("app", "restored %s; what was there is saved as %s", st.Name, out.Saved)
	return out
}

// Restored tells the person, once, what happened to the copy they chose to
// put back. main calls it after the data is open.
func (e *Engine) Restored(out *RestoreOutcome) {
	if out == nil {
		return
	}
	when := time.Unix(out.Staged.At, 0).In(e.Now().Location()).Format("2 January 2006, 15:04")
	if out.Error != "" {
		text := fmt.Sprintf("The copy from %s was not put back: %s. Your data is as it was.", when, out.Error)
		e.S.Log(store.Activity{Kind: "problem", Text: text})
		e.Keep("problem", "Needs attention", text, "#/you/app")
		return
	}
	// Where copies are kept is a choice about this computer, not part of the
	// data that was put back.
	if validKeep(out.Staged.Keep.Keep) {
		e.S.Set("backup", out.Staged.Keep)
	}
	text := fmt.Sprintf("Your data is now the copy from %s.", when)
	if out.Saved != "" {
		text += fmt.Sprintf(" What you had before is saved as %s.", filepath.Base(out.Saved))
	}
	e.S.Log(store.Activity{Kind: "restore", Text: text})
	e.Keep("app", "A saved copy was put back", text, "#/you/app")
}
