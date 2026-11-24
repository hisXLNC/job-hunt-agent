package llm

import (
	"os/exec"
	"syscall"
)

// hideWindow stops a console window flashing up each time Claude Code runs.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
