//go:build !windows

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"jobhunt/internal/api"
	"jobhunt/internal/engine"
)

func runTray(context.Context, func(), string, string, *engine.Engine) {}

func deskNotify(title, text, link string) error {
	return errors.New("notifications on this computer are shown only on Windows")
}

func keepAwake(context.Context, *engine.Engine) {}

func watchClipboard(context.Context, *engine.Engine) {}

// machine: wake timers, the folder dialog and installing Claude Code are Windows' alone.
func machine() api.Machine { return api.Machine{} }

func documentsDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Documents")
}
