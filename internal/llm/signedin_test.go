package llm

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSignedInReadsClaudeCodesOwnWord(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a shell script stands in for Claude Code")
	}
	dir := t.TempDir()
	fake := func(body string) string {
		p := filepath.Join(dir, "claude")
		os.WriteFile(p, []byte("#!/bin/sh\n"+body+"\n"), 0o700)
		return p
	}
	if in, known, how := SignedIn(context.Background(), fake(`echo '{"loggedIn": true, "authMethod": "claude.ai"}'`)); !in || !known || how != "claude.ai" {
		t.Errorf("signed in: %v %v %q", in, known, how)
	}
	if in, known, _ := SignedIn(context.Background(), fake(`echo '{"loggedIn": false}'; exit 1`)); in || !known {
		t.Errorf("signed out: %v %v", in, known)
	}
	if _, known, _ := SignedIn(context.Background(), fake(`echo "unknown command"; exit 1`)); known {
		t.Error("an old Claude Code was taken at its word")
	}
}
