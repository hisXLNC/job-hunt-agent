package main

import "strings"

// signInLine is the command the sign-in window runs: Claude Code's own
// sign-in, then a line saying what to do next, and the window stays.
func signInLine(cli string) string {
	return `cmd.exe /d /k "title Sign in to Claude & echo Job Hunt: signing in to Claude. Your browser opens; sign in there with your Claude account. & echo. & "` + cli +
		`" auth login && (echo. & echo Signed in. Close this window, then press Check sign-in in Job Hunt.) || (echo. & echo The sign-in did not finish. The reason is just above. To try again, type:  claude auth login)"`
}

// signInEnv leaves out what would make Claude Code use a key instead of the
// person's own sign-in.
func signInEnv(env []string) []string {
	var out []string
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		switch strings.ToUpper(k) {
		case "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT":
			continue
		}
		out = append(out, kv)
	}
	return out
}
