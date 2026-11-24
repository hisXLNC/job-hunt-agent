package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

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
