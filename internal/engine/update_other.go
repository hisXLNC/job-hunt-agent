//go:build !windows

package engine

import "errors"

func canRunInstaller() bool { return false }

func runInstaller(string) error {
	return errors.New("updates install themselves only on Windows")
}
