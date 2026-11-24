package engine

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// An installed copy lives where the installer put it; a copy run from
// somewhere else (a build, a trial) is never replaced by an update.
func canRunInstaller() bool {
	me, err := os.Executable()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(filepath.Dir(me), "Uninstall.exe"))
	return err == nil && strings.EqualFold(filepath.Base(me), "JobHunt3.exe")
}

// runInstaller starts the installer on its own, quietly, so that it lives on
// when it stops this program. /UPDATE keeps the person's choices about the
// desktop shortcut and starting with Windows, and starts Job Hunt again.
func runInstaller(file string) error {
	cmd := exec.Command(file, "/S", "/UPDATE")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200} // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
