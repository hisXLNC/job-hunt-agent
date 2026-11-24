package sources

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps a console window from flashing up when the browser is started.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
