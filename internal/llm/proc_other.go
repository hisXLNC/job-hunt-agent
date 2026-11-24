//go:build !windows

package llm

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}
