package llm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeAI is a stand-in OpenAI-style service: it answers each request with
// the next of its scripted replies and keeps what it was sent.
type fakeAI struct {
	mu      sync.Mutex
	replies []func(w http.ResponseWriter, body map[string]any)
	got     []map[string]any
	auth    []string
}

func (f *fakeAI) start(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != "POST" {
			http.NotFound(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		var body map[string]any
		json.Unmarshal(b, &body)
		f.mu.Lock()
		f.got = append(f.got, body)
		f.auth = append(f.auth, r.Header.Get("Authorization"))
		n := len(f.got) - 1
		f.mu.Unlock()
		if n >= len(f.replies) {
			http.Error(w, "no more", 500)
			return
		}
		f.replies[n](w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func says(text string) func(http.ResponseWriter, map[string]any) {
	return func(w http.ResponseWriter, _ map[string]any) {
		json.NewEncoder(w).Encode(map[string]any{"model": "fake-1", "choices": []any{map[string]any{"message": map[string]any{"content": text}, "finish_reason": "stop"}},
			"usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 10, "prompt_tokens_details": map[string]any{"cached_tokens": 40}}})
	}
}

func status(code int, body string) func(http.ResponseWriter, map[string]any) {
	return func(w http.ResponseWriter, _ map[string]any) {
		w.WriteHeader(code)
		io.WriteString(w, body)
	}
}

var fitShape = Obj("fit", Int("0 to 100"), "verdict", Enum("the call", "yes", "no"), "notes", Arr("why", Str("a reason")))

func ask(o *OpenAI) (Response, error) {
	return o.Do(context.Background(), Request{Task: "read_role", System: "sys", Prompt: "read this", Schema: fitShape})
}

func TestTheOtherAIIsAskedForTheShapeAndAnswersIt(t *testing.T) {
	f := &fakeAI{replies: []func(http.ResponseWriter, map[string]any){says(`{"fit":82,"verdict":"yes","notes":["tax engines"]}`)}}
	srv := f.start(t)
	o := &OpenAI{Base: srv.URL + "/v1/", Key: "test-key-123", Model: "fake-1"}
	resp, err := ask(o)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != `{"fit":82,"verdict":"yes","notes":["tax engines"]}` || resp.Model != "fake-1" || resp.TokensIn != 60 || resp.TokensCached != 40 || resp.TokensOut != 10 {
		t.Fatalf("answer: %+v", resp)
	}
	rf, _ := f.got[0]["response_format"].(map[string]any)
	if rf["type"] != "json_schema" || f.auth[0] != "Bearer test-key-123" {
		t.Fatalf("asked without the schema or the key: %v %q", f.got[0]["response_format"], f.auth[0])
	}
	msgs := f.got[0]["messages"].([]any)
	if msgs[0].(map[string]any)["role"] != "system" || msgs[1].(map[string]any)["content"] != "read this" {
		t.Fatalf("messages: %v", msgs)
	}
}

func TestAServiceWithoutSchemasIsAskedInWordsFromThenOn(t *testing.T) {
	f := &fakeAI{replies: []func(http.ResponseWriter, map[string]any){
		status(400, `{"error":{"message":"response_format json_schema is not supported"}}`),
		says("Here you go:\n```json\n{\"fit\":70,\"verdict\":\"no\",\"notes\":[]}\n```"),
		says(`<think>{"fit": "high"}</think>{"fit":71,"verdict":"no","notes":[]}`),
	}}
	srv := f.start(t)
	o := &OpenAI{Base: srv.URL + "/v1", Model: "local"}
	resp, err := ask(o)
	if err != nil || resp.Text != `{"fit":70,"verdict":"no","notes":[]}` {
		t.Fatalf("%v %q", err, resp.Text)
	}
	if _, ok := f.got[1]["response_format"]; ok {
		t.Fatal("asked for the schema format again")
	}
	if p := f.got[1]["messages"].([]any)[1].(map[string]any)["content"].(string); !strings.Contains(p, "JSON Schema") {
		t.Fatalf("the shape wasn't put in words: %q", p)
	}
	if f.auth[0] != "" {
		t.Fatal("sent a key it doesn't have")
	}
	// The next request goes straight to words, and the thinking is dropped.
	if resp, err = ask(o); err != nil || resp.Text != `{"fit":71,"verdict":"no","notes":[]}` || len(f.got) != 3 {
		t.Fatalf("%v %q after %d calls", err, resp.Text, len(f.got))
	}
	if _, ok := f.got[2]["response_format"]; ok {
		t.Fatal("forgot the service takes no schema")
	}
}

func TestAnAnswerOfTheWrongShapeIsSentBackOnce(t *testing.T) {
	f := &fakeAI{replies: []func(http.ResponseWriter, map[string]any){
		says(`{"fit":"85","verdict":"yes","notes":[]}`),
		says(`{"fit":85,"verdict":"yes","notes":[]}`),
		says(`{"verdict":"maybe"}`),
		says(`not json at all`),
	}}
	srv := f.start(t)
	o := &OpenAI{Base: srv.URL + "/v1", Model: "m"}
	resp, err := ask(o)
	if err != nil || resp.Text != `{"fit":85,"verdict":"yes","notes":[]}` {
		t.Fatalf("%v %q", err, resp.Text)
	}
	msgs := f.got[1]["messages"].([]any)
	if len(msgs) != 4 || !strings.Contains(msgs[3].(map[string]any)["content"].(string), `"fit" should be a whole number`) {
		t.Fatalf("the repair turn: %v", msgs)
	}
	if _, err := ask(o); err == nil || !strings.Contains(err.Error(), "shape") || len(f.got) != 4 {
		t.Fatalf("a second bad answer was taken: %v after %d calls", err, len(f.got))
	}
}

func TestTheOtherAIsFailuresSayWhatAndNeverTheKey(t *testing.T) {
	key := "gsk_secretsecret1234"
	f := &fakeAI{replies: []func(http.ResponseWriter, map[string]any){
		status(401, `{"error":{"message":"Incorrect API key provided: `+key+`"}}`),
		status(404, `{"error":"model not found"}`),
		status(400, `{"error":{"message":"bad things about `+key+`"}}`),
		status(400, `{"error":{"message":"still bad `+key+`"}}`),
		status(429, `{"error":{"message":"slow down"}}`),
	}}
	srv := f.start(t)
	o := &OpenAI{Base: srv.URL + "/v1", Key: key, Model: "m"}
	var auth *AuthError
	if _, err := ask(o); !errors.As(err, &auth) || strings.Contains(err.Error(), key) {
		t.Fatalf("401: %v", err)
	}
	if _, err := ask(o); err == nil || !strings.Contains(err.Error(), `"m"`) {
		t.Fatalf("404: %v", err)
	}
	if _, err := ask(o); err == nil || strings.Contains(err.Error(), key) || !strings.Contains(err.Error(), "[key]") {
		t.Fatalf("400 kept the key: %v", err)
	}
	var lim *LimitError
	if _, err := ask(o); !errors.As(err, &lim) || !o.Resting() {
		t.Fatalf("429: %v resting=%v", err, o.Resting())
	}
	if _, err := ask(o); !errors.As(err, &lim) || len(f.got) != 5 {
		t.Fatalf("asked again while resting: %d calls", len(f.got))
	}
}

func TestClaudeAnswersWhenTheOtherAIFailsAndStaysAwake(t *testing.T) {
	f := &fakeAI{replies: []func(http.ResponseWriter, map[string]any){status(429, `{}`)}}
	srv := f.start(t)
	other := &OpenAI{Base: srv.URL + "/v1", Model: "m"}
	claude := Func(func(ctx context.Context, r Request) (Response, error) {
		return Response{Text: `{"fit":60,"verdict":"no","notes":[]}`, Model: "claude"}, nil
	})
	var rec []string
	m := &Metered{
		Pick:  func() (Engine, error) { return claude, nil },
		Other: func(r Request) Engine { return other },
		Record: func(task, engine, model string, in, out, cached int64, cost float64, ms int64, errText string) {
			rec = append(rec, engine+":"+errText)
		},
	}
	resp, err := m.Do(context.Background(), Request{Task: "read_role", Schema: fitShape})
	if err != nil || resp.Model != "claude" {
		t.Fatalf("%v %+v", err, resp)
	}
	if rest, _, _ := m.Resting(); rest {
		t.Fatal("the other AI's limit paused Claude")
	}
	if len(rec) != 2 || !strings.HasPrefix(rec[0], "other-ai:The other AI is at its limit") || rec[1] != "stand-in:" {
		t.Fatalf("recorded: %q", rec)
	}
}

func TestFitsChecksTheShape(t *testing.T) {
	for in, want := range map[string]string{
		`{"fit":1,"verdict":"no","notes":["a"]}`:   "",
		`{"fit":1,"verdict":"no","notes":[null]}`:  "",
		`{"fit":1.5,"verdict":"no","notes":[]}`:    `"fit" should be a whole number`,
		`{"fit":1,"verdict":"perhaps","notes":[]}`: `"verdict" should be one of yes, no`,
		`{"fit":1,"verdict":"no","notes":[3]}`:     `item 1 of "notes" should be text`,
		`{"fit":1,"verdict":"no"}`:                 `"notes" is missing from the answer`,
		`["fit"]`:                                  "the answer should be an object",
		`nothing`:                                  "it was not a JSON object",
	} {
		if _, got := Fits(in, fitShape); got != want {
			t.Errorf("%s: %q, want %q", in, got, want)
		}
	}
}
