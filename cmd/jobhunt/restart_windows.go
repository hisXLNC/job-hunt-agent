package main

import (
	"os/exec"
	"syscall"
)

// onItsOwn lets the new copy of the program live on when this one ends.
func onItsOwn(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200} // CREATE_NEW_PROCESS_GROUP
}
