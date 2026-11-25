package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// OpenAI reaches another AI service through the OpenAI-style Chat
// Completions API: OpenAI itself, OpenRouter, Groq, xAI, Gemini's
// OpenAI-style address, or a model on this computer (Ollama, LM Studio).
// It cannot look things up on the web.
//
// A structured answer is asked for with the service's JSON schema format;
// a service that refuses that format is asked in words instead, and an
// answer that does not fit the shape is sent back once to be put right.
type OpenAI struct {
	Base  string // e.g. https://api.openai.com/v1
	Key   string // "" for a local model that needs none
	Model string
	HTTP  *http.Client // nil = one with a long timeout, for slow local models

	mu      sync.Mutex
	plain   bool // the service refused the JSON schema format: ask in words
	resting time.Time
	restMsg string
	sem     chan struct{}
}

func (o *OpenAI) Name() string { return "other-ai" }

// OtherServices are the addresses of the usual services, offered as a
// choice on the settings page. Any other address that speaks the same way
// works too.
var OtherServices = []struct{ Name, Base, Model string }{
	{"OpenAI (ChatGPT)", "https://api.openai.com/v1", "gpt-5-mini"},
	{"OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-5-mini"},
	{"Groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"},
	{"xAI (Grok)", "https://api.x.ai/v1", "grok-4"},
	{"Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash"},
	{"Ollama on this computer", "http://localhost:11434/v1", "llama3.1"},
	{"LM Studio on this computer", "http://localhost:1234/v1", ""},
}

// Resting reports whether the service said it is out of usage for now.
func (o *OpenAI) Resting() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return time.Now().Before(o.resting)
}

type chatMsg struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // a string, or parts with pictures
}

type chatReq struct {
	Model          string    `json:"model"`
	Messages       []chatMsg `json:"messages"`
	ResponseFormat any       `json:"response_format,omitempty"`
	Stream         bool      `json:"stream"`
}

type chatResp struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
			Refusal string `json:"refusal"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64   `json:"prompt_tokens"`
		CompletionTokens int64   `json:"completion_tokens"`
		Cost             float64 `json:"cost"` // OpenRouter says what a call cost
		Details          struct {
			Cached int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
}

// formatRefused is a 400 to a request that asked for the JSON schema format.
type formatRefused struct{ msg string }

func (e *formatRefused) Error() string { return e.msg }

func (o *OpenAI) Do(ctx context.Context, req Request) (Response, error) {
	if strings.TrimSpace(o.Base) == "" || strings.TrimSpace(o.Model) == "" {
		return Response{}, ErrNotConnected
	}
	if req.Web {
		return Response{}, errors.New("the other AI can't look things up on the web")
	}
	o.mu.Lock()
	if time.Now().Before(o.resting) {
		msg, until := o.restMsg, o.resting
		o.mu.Unlock()
		return Response{}, &LimitError{Msg: msg, Until: until}
	}
	plain := o.plain
	if o.sem == nil {
		o.sem = make(chan struct{}, 3)
	}
	sem := o.sem
	o.mu.Unlock()
	select {
	case sem <- struct{}{}:
		defer func() { <-sem }()
	case <-ctx.Done():
		return Response{}, ctx.Err()
	}

	var out Response
	out.Model = o.Model
	ask := func(msgs []chatMsg, schema bool) (string, error) {
		body := chatReq{Model: o.Model, Messages: msgs}
		if schema {
			body.ResponseFormat = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "answer", "strict": true, "schema": req.Schema}}
		}
		r, err := o.post(ctx, body, schema)
		if err != nil {
			return "", err
		}
		out.TokensIn += r.Usage.PromptTokens - r.Usage.Details.Cached
		out.TokensOut += r.Usage.CompletionTokens
		out.TokensCached += r.Usage.Details.Cached
		out.Cost += r.Usage.Cost
		if r.Model != "" {
			out.Model = r.Model
		}
		if len(r.Choices) == 0 {
			return "", errors.New("the other AI sent back no answer")
		}
		c := r.Choices[0]
		switch {
		case c.Message.Refusal != "" || c.FinishReason == "content_filter":
			return "", ErrDeclined
		case c.FinishReason == "length":
			return "", errors.New("the other AI's answer was cut off")
		}
		return withoutThinking(c.Message.Content), nil
	}

	schema := req.Schema != nil && !plain
	msgs := []chatMsg{{Role: "system", Content: req.System}, {Role: "user", Content: o.content(req, !schema)}}
	text, err := ask(msgs, schema)
	var fr *formatRefused
	if errors.As(err, &fr) {
		// The service doesn't take a JSON schema: ask in words from now on.
		schema = false
		msgs[1].Content = o.content(req, true)
		if text, err = ask(msgs, false); err == nil {
			o.mu.Lock()
			o.plain = true
			o.mu.Unlock()
		}
	}
	if err != nil {
		return out, o.scrub(err)
	}
	if req.Schema == nil {
		out.Text = text
		return out, nil
	}
	raw, problem := Fits(text, req.Schema)
	if problem != "" {
		// Once, show it what was wrong and let it try again.
		msgs = append(msgs, chatMsg{Role: "assistant", Content: text}, chatMsg{Role: "user", Content: "That answer can't be used: " + problem +
			". Answer again with one JSON object and nothing else, matching the JSON Schema you were given."})
		if text, err = ask(msgs, schema); err != nil {
			return out, o.scrub(err)
		}
		if raw, problem = Fits(text, req.Schema); problem != "" {
			return out, fmt.Errorf("the other AI's answer didn't have the right shape: %s", problem)
		}
	}
	out.Text = raw
	return out, nil
}

// content is what the user's turn says: the prompt, the shape of the answer
// in words when asked for, and any pictures.
func (o *OpenAI) content(req Request, shapeInWords bool) any {
	prompt := req.Prompt
	if shapeInWords && req.Schema != nil {
		shape, _ := json.Marshal(req.Schema)
		prompt += "\n\nAnswer with one JSON object and nothing else, matching this JSON Schema:\n" + string(shape)
	}
	if len(req.Images) == 0 {
		return prompt
	}
	var parts []map[string]any
	for _, im := range req.Images {
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + im.Mime + ";base64," + base64.StdEncoding.EncodeToString(im.Data)}})
	}
	return append(parts, map[string]any{"type": "text", "text": prompt})
}

func (o *OpenAI) post(ctx context.Context, body chatReq, schema bool) (chatResp, error) {
	var out chatResp
	b, err := json.Marshal(body)
	if err != nil {
		return out, err
	}
	hr, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(strings.TrimSpace(o.Base), "/")+"/chat/completions", bytes.NewReader(b))
	if err != nil {
		return out, errors.New("the other AI's address isn't a web address")
	}
	hr.Header.Set("Content-Type", "application/json")
	if k := strings.TrimSpace(o.Key); k != "" {
		hr.Header.Set("Authorization", "Bearer "+k)
	}
	c := o.HTTP
	if c == nil {
		c = &http.Client{Timeout: 5 * time.Minute}
	}
	res, err := c.Do(hr)
	if err != nil {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		return out, &TransientError{errors.New("couldn't reach the other AI at its address")}
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode != 200 {
		return out, o.failure(res, data, schema)
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return out, errors.New("the other AI's answer couldn't be read")
	}
	return out, nil
}

func (o *OpenAI) failure(res *http.Response, data []byte, schema bool) error {
	var e struct {
		Error json.RawMessage `json:"error"`
	}
	msg := ""
	if json.Unmarshal(data, &e) == nil && len(e.Error) > 0 {
		var inner struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(e.Error, &inner) == nil && inner.Message != "" {
			msg = inner.Message
		} else {
			json.Unmarshal(e.Error, &msg)
		}
	}
	if msg == "" {
		msg = string(data)
	}
	msg = short(msg)
	switch code := res.StatusCode; {
	case code == 401 || code == 403:
		return &AuthError{"The other AI did not accept the key"}
	case code == 404:
		return fmt.Errorf("the other AI doesn't know the model %q, or the address is wrong", o.Model)
	case code == 429 || code == 402:
		until := time.Now().Add(15 * time.Minute)
		if s, err := strconv.Atoi(strings.TrimSpace(res.Header.Get("Retry-After"))); err == nil && s > 0 {
			until = time.Now().Add(time.Duration(s) * time.Second)
		}
		lim := &LimitError{Msg: "The other AI is at its limit for now", Until: until}
		o.mu.Lock()
		o.resting, o.restMsg = lim.Until, lim.Msg
		o.mu.Unlock()
		return lim
	case code == 400 || code == 422:
		if schema {
			return &formatRefused{"the other AI refused the request: " + msg}
		}
		return fmt.Errorf("the other AI refused the request: %s", msg)
	case code >= 500:
		return &TransientError{fmt.Errorf("the other AI had a problem (%d)", code)}
	}
	return fmt.Errorf("the other AI answered %d: %s", res.StatusCode, msg)
}

// scrub takes the key out of an error, in case the service repeated it.
func (o *OpenAI) scrub(err error) error {
	k := strings.TrimSpace(o.Key)
	if err == nil || len(k) < 4 || !strings.Contains(err.Error(), k) {
		return err
	}
	return errors.New(strings.ReplaceAll(err.Error(), k, "[key]"))
}

var thinking = regexp.MustCompile(`(?s)<think>.*?</think>`)

// withoutThinking drops the reasoning some local models write before answering.
func withoutThinking(s string) string { return strings.TrimSpace(thinking.ReplaceAllString(s, "")) }

// Fits finds the JSON in an answer and checks it against the schema. It
// returns the JSON, and in words what is wrong with it ("" when nothing).
func Fits(text string, schema map[string]any) (string, string) {
	raw := ExtractJSON(text)
	if raw == "" {
		return "", "it was not a JSON object"
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return raw, "it was not valid JSON"
	}
	return raw, shapeProblem(v, schema, "the answer")
}

func shapeProblem(v any, schema map[string]any, at string) string {
	if v == nil {
		return "" // a missing value reads as empty; harmless
	}
	types := []string{}
	switch t := schema["type"].(type) {
	case string:
		types = append(types, t)
	case []any:
		for _, x := range t {
			if s, ok := x.(string); ok {
				types = append(types, s)
			}
		}
	case []string:
		types = t
	}
	if len(types) == 0 {
		return ""
	}
	var problem string
	for _, t := range types {
		if problem = oneType(v, t, schema, at); problem == "" {
			return ""
		}
	}
	return problem
}

func oneType(v any, t string, schema map[string]any, at string) string {
	switch t {
	case "object":
		m, ok := v.(map[string]any)
		if !ok {
			return at + " should be an object"
		}
		for _, k := range names(schema["required"]) {
			if _, ok := m[k]; !ok {
				return fmt.Sprintf("%q is missing from %s", k, at)
			}
		}
		props, _ := schema["properties"].(map[string]any)
		for k, sub := range props {
			s, ok := sub.(map[string]any)
			if x, has := m[k]; has && ok {
				if p := shapeProblem(x, s, fmt.Sprintf("%q", k)); p != "" {
					return p
				}
			}
		}
	case "array":
		a, ok := v.([]any)
		if !ok {
			return at + " should be a list"
		}
		if items, ok := schema["items"].(map[string]any); ok {
			for i, x := range a {
				if p := shapeProblem(x, items, fmt.Sprintf("item %d of %s", i+1, at)); p != "" {
					return p
				}
			}
		}
	case "string":
		s, ok := v.(string)
		if !ok {
			return at + " should be text"
		}
		if vals := names(schema["enum"]); len(vals) > 0 {
			for _, x := range vals {
				if x == s {
					return ""
				}
			}
			return fmt.Sprintf("%s should be one of %s", at, strings.Join(vals, ", "))
		}
	case "integer":
		n, ok := v.(json.Number)
		if !ok {
			return at + " should be a whole number"
		}
		if _, err := n.Int64(); err != nil {
			return at + " should be a whole number"
		}
	case "number":
		if _, ok := v.(json.Number); !ok {
			return at + " should be a number"
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return at + " should be true or false"
		}
	}
	return ""
}

func names(v any) []string {
	switch x := v.(type) {
	case []string:
		return x
	case []any:
		var out []string
		for _, s := range x {
			if str, ok := s.(string); ok {
				out = append(out, str)
			}
		}
		return out
	}
	return nil
}
