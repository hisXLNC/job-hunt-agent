package llm

import "testing"

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
