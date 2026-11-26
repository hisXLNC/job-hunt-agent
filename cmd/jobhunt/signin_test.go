package main

import (
	"strings"
	"testing"
)

func TestSignInWindowStaysAndSaysWhatHappened(t *testing.T) {
	line := signInLine(`C:\Users\A Person\.local\bin\claude.exe`)
	for _, want := range []string{"/k ", `"C:\Users\A Person\.local\bin\claude.exe" auth login`, "Signed in.", "did not finish"} {
		if !strings.Contains(line, want) {
			t.Errorf("the sign-in command lacks %q: %s", want, line)
		}
	}
	env := signInEnv([]string{"PATH=x", "ANTHROPIC_API_KEY=k", "anthropic_auth_token=t", "HOME=h"})
	if strings.Join(env, ",") != "PATH=x,HOME=h" {
		t.Errorf("env %v", env)
	}
}
