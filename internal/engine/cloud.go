package engine

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

// CloudFolder is a folder on this computer that a cloud drive keeps a copy
// of elsewhere (Google Drive, OneDrive, Dropbox, iCloud). Keeping Job
// Hunt's saved copies inside one is how the data follows the person to
// another computer: nothing is signed in to, the drive's own program
// carries the files.
type CloudFolder struct {
	Name string `json:"name"`
	Dir  string `json:"dir"`  // where Job Hunt's copies would go
	Used bool   `json:"used"` // copies are kept there now
}

const cloudSub = "Job Hunt copies"

func isDir(p string) bool {
	info, err := os.Stat(p)
	return p != "" && err == nil && info.IsDir()
}

// CloudFolders finds the cloud drives set up on this computer.
func (e *Engine) CloudFolders() []CloudFolder {
	out := []CloudFolder{}
	seen := map[string]bool{}
	add := func(name, root string) {
		if !isDir(root) {
			return
		}
		dir := filepath.Join(root, cloudSub)
		if seen[dir] {
			return
		}
		seen[dir] = true
		out = append(out, CloudFolder{Name: name, Dir: dir, Used: filepath.Clean(e.BackupDir()) == filepath.Clean(dir)})
	}
	for _, root := range e.cloudRoots() {
		add(root[0], root[1])
	}
	return out
}

func (e *Engine) cloudRoots() [][2]string {
	if e.CloudRoots != nil {
		return e.CloudRoots()
	}
	home, _ := os.UserHomeDir()
	roots := [][2]string{}
	if runtime.GOOS == "windows" {
		// Google Drive for desktop shows up as a drive of its own.
		for c := 'D'; c <= 'Z'; c++ {
			roots = append(roots, [2]string{"Google Drive", string(c) + `:\My Drive`})
		}
	}
	if home != "" {
		roots = append(roots, [2]string{"Google Drive", filepath.Join(home, "My Drive")}, [2]string{"Google Drive", filepath.Join(home, "Google Drive", "My Drive")}, [2]string{"Google Drive", filepath.Join(home, "Google Drive")})
	}
	for _, env := range []string{"OneDrive", "OneDriveConsumer"} {
		roots = append(roots, [2]string{"OneDrive", os.Getenv(env)})
	}
	if home != "" {
		roots = append(roots, [2]string{"OneDrive", filepath.Join(home, "OneDrive")}, [2]string{"Dropbox", filepath.Join(home, "Dropbox")}, [2]string{"iCloud Drive", filepath.Join(home, "iCloudDrive")})
	}
	return roots
}

// KeepCopiesIn makes Job Hunt's folder inside a cloud drive found on this
// computer and keeps the saved copies there from now on, starting with one
// made at once.
func (e *Engine) KeepCopiesIn(dir string) error {
	for _, c := range e.CloudFolders() {
		if filepath.Clean(c.Dir) != filepath.Clean(dir) {
			continue
		}
		if err := os.MkdirAll(c.Dir, 0o700); err != nil {
			return errors.New("Job Hunt couldn't make its folder there. Check the drive is running and try again.")
		}
		set := e.BackupSet()
		set.Dir = c.Dir
		if err := e.SetBackup(set); err != nil {
			return err
		}
		_, err := e.Backup()
		return err
	}
	return errors.New("That folder isn't one of the cloud drives on this computer.")
}
