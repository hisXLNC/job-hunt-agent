//go:build !windows

package main

import (
	"context"
	"errors"

	"jobhunt/internal/engine"
)

func runTray(context.Context, func(), string, string, *engine.Engine) {}

func deskNotify(title, text, link string) error {
	return errors.New("notifications on this computer are shown only on Windows")
}

func keepAwake(context.Context, func() bool) {}
