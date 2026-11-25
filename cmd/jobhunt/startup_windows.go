package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"jobhunt/internal/trace"

	"golang.org/x/sys/windows/registry"
)

// Starting with Windows: one entry in the person's own list of programs
// that start when they sign in. The installer offers it; this is the same
// switch from inside Job Hunt.

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

// installedCopy is this program's path when it is the installed one (not a
// copy started from a download folder or by a developer).
func installedCopy() string {
	me, err := os.Executable()
	if err != nil || !strings.EqualFold(filepath.Base(me), "JobHunt3.exe") {
		return ""
	}
	return me
}

func startsWithWindows() (on, can bool) {
	can = installedCopy() != ""
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false, can
	}
	defer k.Close()
	v, _, err := k.GetStringValue("JobHunt3")
	return err == nil && v != "", can
}

func setStartsWithWindows(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return errors.New("Windows wouldn't let Job Hunt change what starts when you sign in")
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue("JobHunt3"); err != nil && err != registry.ErrNotExist {
			return errors.New("Windows wouldn't let Job Hunt change what starts when you sign in")
		}
		return nil
	}
	me := installedCopy()
	if me == "" {
		return errors.New("this copy of Job Hunt was not installed, so it can't start with Windows; run the installer")
	}
	return k.SetStringValue("JobHunt3", `"`+me+`" -no-window`)
}

// keepStartShortcut puts Job Hunt's Start menu shortcut back if it is
// missing. The previous Job Hunt used the same name, and removing it takes
// a shortcut called "Job Hunt" with it, which is now this one's.
func keepStartShortcut() {
	me := installedCopy()
	appdata := os.Getenv("APPDATA")
	if me == "" || appdata == "" {
		return
	}
	lnk := filepath.Join(appdata, `Microsoft\Windows\Start Menu\Programs`, "Job Hunt.lnk")
	if _, err := os.Stat(lnk); err == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
			`$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:JH_LNK);$s.TargetPath=$env:JH_EXE;$s.Save()`)
		cmd.Env = append(os.Environ(), "JH_LNK="+lnk, "JH_EXE="+me)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
		if out, err := cmd.CombinedOutput(); err != nil {
			trace.Log("app", "couldn't put back the Start menu shortcut: %v %s", err, strings.TrimSpace(string(out)))
		} else {
			trace.Log("app", "put back the Start menu shortcut")
		}
	}()
}
