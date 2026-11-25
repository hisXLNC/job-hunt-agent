package engine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"jobhunt/internal/llm"
)

// otherServer stands in for an OpenAI-style service. It accepts only the
// key it was given and answers every question with the same JSON.
type otherServer struct {
	mu    sync.Mutex
	asked []string // the tasks' prompts, in order
	down  bool
}

func (o *otherServer) start(t *testing.T, key string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":{"message":"bad key"}}`)
			return
		}
		var body struct {
			Messages []struct {
				Content any `json:"content"`
			} `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		o.mu.Lock()
		down := o.down
		if len(body.Messages) > 1 {
			p, _ := body.Messages[1].Content.(string)
			o.asked = append(o.asked, p)
		}
		o.mu.Unlock()
		if down {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"model": "other-model", "usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 2, "cost": 5.0}, "choices": []any{map[string]any{"message": map[string]any{"content": `{"word":"ready"}`}, "finish_reason": "stop"}}})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestAnotherAIIsTriedBeforeItIsSavedAndItsKeyStaysIn(t *testing.T) {
	e, _ := newEngine(t)
	fake := &otherServer{}
	srv := fake.start(t, "test-other-key-1")
	ctx := context.Background()

	if _, err := e.SetOtherAI(ctx, OtherAIInput{On: true, Base: srv.URL + "/v1", Key: "wrong-key-0000", Model: "m"}); err == nil || !strings.Contains(err.Error(), "not saved") {
		t.Fatalf("a key the service refused was saved: %v", err)
	}
	if e.OtherAI().On || e.OtherAI().Key != "" {
		t.Fatal("something was kept")
	}
	msg, err := e.SetOtherAI(ctx, OtherAIInput{On: true, Base: srv.URL + "/v1", Key: "test-other-key-1", Model: "m"})
	if err != nil || !strings.Contains(msg, "Working") {
		t.Fatalf("%v %q", err, msg)
	}
	st := e.OtherAIState()
	if !st.On || !st.HasKey || st.Use != "search" {
		t.Fatalf("state: %+v", st)
	}
	if b, _ := json.Marshal(st); strings.Contains(string(b), "test-other-key-1") {
		t.Fatal("the key went into what the pages see")
	}
	// Saving again without pasting the key keeps it; a new address needs it again.
	if _, err := e.SetOtherAI(ctx, OtherAIInput{On: true, Base: srv.URL + "/v1", Model: "m", Use: "all"}); err != nil || e.OtherAI().Key != "test-other-key-1" {
		t.Fatalf("the saved key was lost: %v", err)
	}
	if _, err := e.SetOtherAI(ctx, OtherAIInput{On: false, Base: "https://elsewhere.example/v1", Model: "m"}); err != nil || e.OtherAI().Key != "" {
		t.Fatalf("the key would have gone to another address: %v", e.OtherAI())
	}
	for _, bad := range []string{"http://ai.example.com/v1", "ftp://x/v1", "not an address"} {
		if _, err := e.SetOtherAI(ctx, OtherAIInput{On: true, Base: bad, Model: "m"}); err == nil {
			t.Errorf("%s was taken", bad)
		}
	}
	if err := e.ForgetOtherAI(); err != nil || e.OtherAI().On {
		t.Fatal("not forgotten")
	}
}

func TestAnotherAIDoesOnlyItsShareAndClaudeTakesOver(t *testing.T) {
	e, _ := newEngine(t)
	var claude []string
	var mu sync.Mutex
	e.Sample = llm.Func(func(ctx context.Context, r llm.Request) (llm.Response, error) {
		mu.Lock()
		claude = append(claude, r.Task)
		mu.Unlock()
		return llm.Response{Text: `{"word":"claude"}`, Model: "claude"}, nil
	})
	fake := &otherServer{}
	srv := fake.start(t, "k-123456")
	ctx := context.Background()
	if _, err := e.SetOtherAI(ctx, OtherAIInput{On: true, Base: srv.URL + "/v1", Key: "k-123456", Model: "m"}); err != nil {
		t.Fatal(err)
	}
	shape := llm.Obj("word", llm.Str("w"))
	ask := func(task string, web bool) string {
		resp, err := e.meter.Do(ctx, llm.Request{Task: task, Prompt: "about " + task, Schema: shape, Web: web})
		if err != nil {
			t.Fatal(err)
		}
		return resp.Model
	}
	// Searching only: reading a role goes to the other AI, the rest to Claude.
	if got := ask("read_role", false); got != "other-model" {
		t.Fatalf("read_role went to %s", got)
	}
	if got := ask("tailor", false); got != "claude" {
		t.Fatalf("tailor went to %s", got)
	}
	// Everything: still never a web lookup or the assistant.
	e.SetOtherAI(ctx, OtherAIInput{On: true, Base: srv.URL + "/v1", Model: "m", Use: "all"})
	if ask("tailor", false) != "other-model" || ask("reviews", true) != "claude" || ask("assist", false) != "claude" || ask("mail", false) != "claude" {
		t.Fatal("everything went the wrong way")
	}
	// When it fails, Claude answers and the call is kept as failed.
	fake.mu.Lock()
	fake.down = true
	fake.mu.Unlock()
	if got := ask("read_role", false); got != "claude" {
		t.Fatalf("a failing other AI wasn't replaced: %s", got)
	}
	calls, _ := e.S.LastCalls(10)
	found := false
	for _, c := range calls {
		if c.Engine == "other-ai" && c.Error != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the failure wasn't kept: %+v", calls)
	}
	if rest, _, _ := e.meter.Resting(); rest {
		t.Fatal("Claude was paused")
	}
	// What the service says it charged never counts against Claude's limit.
	if u := e.S.UsageSince(0); u.Cost != 0 {
		t.Fatalf("the other AI's cost was counted: %v", u.Cost)
	}
}

// Mail from the inbox is promised to Claude alone, whatever the other AI is set to do.
func TestOtherAINeverReadsMail(t *testing.T) {
	for _, task := range []string{"mail", "mail_reply", "senders", "rejection_reply", "assist", "indeed_search", "find_news"} {
		if !keepWithClaude[task] {
			t.Errorf("%s could go to the other AI", task)
		}
	}
}
