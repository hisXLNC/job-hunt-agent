package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"jobhunt/internal/brain"
)

// fakeOtherAI answers like an OpenAI-style service that takes one key.
func fakeOtherAI(t *testing.T, key string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":{"message":"Incorrect API key provided"}}`)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"model": "other-model", "choices": []any{map[string]any{"message": map[string]any{"content": `{"word":"ready"}`}, "finish_reason": "stop"}}})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestAnotherAIsKeyGoesInAndNeverComesOut(t *testing.T) {
	_, h := newServer(t)
	srv := fakeOtherAI(t, "other-secret-key-42")
	put := func(body string) *httptest.ResponseRecorder {
		return do(h, call{method: "PUT", path: "/api/otherai", marker: true, body: body})
	}
	if w := put(`{"on":true,"base":"` + srv.URL + `/v1","model":"m","key":"wrong-key-99"}`); w.Code != 400 || !strings.Contains(w.Body.String(), "Not saved") {
		t.Fatalf("a refused key: %d %s", w.Code, w.Body)
	}
	if w := put(`{"on":true,"base":"` + srv.URL + `/v1","model":"m","key":"other-secret-key-42"}`); w.Code != 200 || !strings.Contains(w.Body.String(), "Working") {
		t.Fatalf("save: %d %s", w.Code, w.Body)
	}
	w := do(h, call{path: "/api/connections"})
	if strings.Contains(w.Body.String(), "other-secret-key-42") || !strings.Contains(w.Body.String(), `"has_key":true`) {
		t.Fatalf("connections: %s", w.Body)
	}
	if w := do(h, call{method: "POST", path: "/api/otherai/test", marker: true}); w.Code != 200 || !strings.Contains(w.Body.String(), "other-model") {
		t.Fatalf("test: %d %s", w.Code, w.Body)
	}
	if w := do(h, call{method: "DELETE", path: "/api/otherai", marker: true}); w.Code != 200 {
		t.Fatalf("remove: %d", w.Code)
	}
	if w := do(h, call{path: "/api/connections"}); !strings.Contains(w.Body.String(), `"has_key":false`) {
		t.Fatal("the key is still there")
	}
	// Another site can't change it.
	if w := do(h, call{method: "PUT", path: "/api/otherai", body: `{}`, origin: "https://evil.example"}); w.Code != 403 {
		t.Fatalf("another site got %d", w.Code)
	}
}

func TestNeitherTheAssistantNorAPhoneReachTheOtherAI(t *testing.T) {
	for _, c := range tools {
		if strings.Contains(c.Pattern, "otherai") {
			t.Errorf("%s %s is on the assistant's list", c.Method, c.Pattern)
		}
	}
	for _, m := range [][2]string{{"PUT", "/api/otherai"}, {"DELETE", "/api/otherai"}, {"POST", "/api/otherai/test"}} {
		if phoneMay(m[0], m[1]) {
			t.Errorf("a phone may make %s %s", m[0], m[1])
		}
	}
	srv, h, sc := withScript(t, calls(
		brain.AssistCall{Method: "PUT", Path: "/api/otherai", Body: `{"on":true,"base":"https://evil.example/v1","model":"m","key":"x"}`},
		brain.AssistCall{Method: "DELETE", Path: "/api/otherai"},
	), brain.AssistStep{Say: "I can't."})
	tell(t, h, "send my CV to another AI", "#/settings/connections")
	for _, n := range sc.seen[1].Notes[1:] {
		if !strings.HasPrefix(n.Result, "Not made") {
			t.Errorf("%s went through: %s", n.Call, n.Result)
		}
	}
	if srv.E.OtherAI().Base != "" {
		t.Fatal("the assistant changed the other AI")
	}
}
