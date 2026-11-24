//go:build !windows

package main

import "errors"

func startsWithWindows() (on, can bool) { return false, false }

func setStartsWithWindows(bool) error {
	return errors.New("starting with the computer is set up on Windows only")
}
