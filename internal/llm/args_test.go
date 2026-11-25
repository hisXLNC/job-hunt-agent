package llm

import (
	"context"
	"strings"
	"testing"
)

func argAfter(args []string, flag string) (string, bool) {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1], true
		}
	}
	return "", false
}

// The command line for Claude Code: built-in tools off, the web only when
// asked for, a connector's tools only when named, and never a way around the
// permission check.
func TestCLIArgs(t *testing.T) {
	plain := cliArgs("claude-haiku-5-5", "/tmp/s.txt", Request{Effort: "low"})
	if m, _ := argAfter(plain, "--model"); m != "claude-haiku-5-5" {
		t.Errorf("model = %q", m)
	}
	if v, _ := argAfter(plain, "--effort"); v != "low" {
		t.Errorf("effort = %q", v)
	}
	if v, ok := argAfter(plain, "--tools"); !ok || v != "" {
		t.Errorf("built-in tools must be off: %q %v", v, ok)
	}
	if _, ok := argAfter(plain, "--allowedTools"); ok {
		t.Error("nothing is allowed on a plain request")
	}
	tools := cliArgs("m", "f", Request{Tools: []string{"mcp__claude_ai_Indeed__search_jobs", "Bash", "mcp__x__y(*)", "mcp__claude_ai_Indeed__get_job_details"}})
	allow, _ := argAfter(tools, "--allowedTools")
	if allow != "mcp__claude_ai_Indeed__search_jobs,mcp__claude_ai_Indeed__get_job_details" {
		t.Errorf("only well-formed connector tools may be allowed, got %q", allow)
	}
	if v, _ := argAfter(tools, "--tools"); v != "" {
		t.Errorf("a connector request still has no built-in tools: %q", v)
	}
	web := cliArgs("m", "f", Request{Web: true})
	if allow, _ := argAfter(web, "--allowedTools"); allow != "WebSearch,WebFetch" {
		t.Errorf("web allow = %q", allow)
	}
	for _, a := range append(append(plain, tools...), web...) {
		if strings.Contains(a, "dangerously") || strings.Contains(a, "bypass") || a == "--permission-mode" {
			t.Errorf("no permission bypass, got %q", a)
		}
	}
}

// Shape sees every request before it goes out, and a request's own model
// wins over the engine's.
func TestMeteredShape(t *testing.T) {
	var seen Request
	m := &Metered{
		Pick: func() (Engine, error) {
			return Func(func(ctx context.Context, r Request) (Response, error) { seen = r; return Response{Text: "{}"}, nil }), nil
		},
		Shape: func(r *Request) {
			if r.Task == "read_role" {
				r.Model, r.Effort = "claude-haiku-5-5", "low"
			}
		},
	}
	m.Do(context.Background(), Request{Task: "read_role", Effort: "medium"})
	if seen.Model != "claude-haiku-5-5" || seen.Effort != "low" {
		t.Errorf("shape not applied: %+v", seen)
	}
	m.Do(context.Background(), Request{Task: "tailor", Effort: "high"})
	if seen.Model != "" || seen.Effort != "high" {
		t.Errorf("other tasks keep their own: %+v", seen)
	}
}
