package main

import (
	"io"
	"os"
	"os/exec"
	"time"
)

// The end of the pipe the next copy of the program is reading from. It is
// kept open for as long as this program lives and closes when it ends, which
// is how the next copy knows this one has gone.
var handOver *os.File

// restartSelf starts this program again with the same choices and stops this
// one. The new copy waits until this one has gone before it opens the data,
// so a saved copy can be put back in between.
func restartSelf(stop func()) error {
	me, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{}
	for _, a := range os.Args[1:] {
		if a != "-restarted" && a != "--restarted" {
			args = append(args, a)
		}
	}
	r, w, err := os.Pipe()
	if err != nil {
		return err
	}
	cmd := exec.Command(me, append(args, "-restarted")...)
	cmd.Stdin = r
	onItsOwn(cmd)
	if err := cmd.Start(); err != nil {
		r.Close()
		w.Close()
		return err
	}
	r.Close()
	handOver = w
	cmd.Process.Release()
	go func() {
		// Long enough for the page to hear that it worked.
		time.Sleep(400 * time.Millisecond)
		stop()
	}()
	return nil
}

// waitForParent returns when the program that started this one has ended
// (its end of the pipe closes), or after the longest wait.
func waitForParent(longest time.Duration) {
	done := make(chan struct{})
	go func() {
		io.Copy(io.Discard, os.Stdin)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(longest):
	}
}
