//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// onItsOwn lets the new copy of the program live on when this one ends.
func onItsOwn(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
