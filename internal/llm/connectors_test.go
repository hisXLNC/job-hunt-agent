package llm

import (
	"strings"
	"testing"
)

func TestConnectorsReadFromTheStream(t *testing.T) {
	stream := []byte(`{"type":"system","subtype":"init","tools":["mcp__claude_ai_Indeed__search_jobs","mcp__claude_ai_Indeed__get_job_details","mcp__claude_ai_Gmail__search"],"mcp_servers":[{"name":"claude.ai Indeed","status":"connected"},{"name":"claude.ai Gmail","status":"needs-auth"}]}
{"type":"result","result":"{}"}`)
	cs := connectorsIn(stream)
	if len(cs) != 2 || cs[0].Name != "claude.ai Indeed" || cs[0].Status != "connected" || len(cs[0].Tools) != 2 || cs[1].Status != "needs-auth" {
		t.Fatalf("got %+v", cs)
	}
	if connectorsIn([]byte(`{"type":"result"}`)) != nil {
		t.Fatal("connectors from a stream that names none")
	}
	if cs := connectorsIn([]byte(`{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}`)); cs == nil || len(cs) != 0 {
		t.Fatal("an empty list should be known to be empty")
	}
}

// With the person's own settings read, the permission check can't be
// loosened by them and the connectors named are refused.
func TestUserSettingsStayLocked(t *testing.T) {
	args := strings.Join(cliArgs("m", "f", Request{UserSettings: true, Tools: []string{"mcp__Indeed__search_jobs"},
		Deny: []string{"mcp__Gmail", "mcp__Gmail__send_message", "Bash(rm *)", "mcp__x y"}}), " ")
	for _, want := range []string{"--setting-sources user", "--tools  ", "--allowedTools mcp__Indeed__search_jobs", "--disallowedTools mcp__Gmail,mcp__Gmail__send_message", "--permission-mode dontAsk"} {
		if !strings.Contains(args, want) {
			t.Errorf("missing %q in %s", want, args)
		}
	}
	if strings.Contains(args, "Bash") || strings.Contains(args, "x y") {
		t.Errorf("a rule that isn't a connector got through: %s", args)
	}
	if got := strings.Join(cliArgs("m", "f", Request{}), " "); strings.Contains(got, "permission-mode") || strings.Contains(got, "disallowed") {
		t.Errorf("plain request changed: %s", got)
	}
}
