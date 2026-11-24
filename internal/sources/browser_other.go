//go:build !windows

package sources

import "os/exec"

func hideWindow(*exec.Cmd) {}
