// Package llm is how Job Hunt reaches Claude. There are three ways: an
// Anthropic API key, the person's own Claude Code sign-in, and a stand-in
// used by tests and the demo. Another AI service can take part of the work
// (openai.go), with Claude answering whenever it fails. The rest of the
// program only sees Engine.
package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Request is one question to Claude.
type Request struct {
	Task      string         // short name for the usage log: "read_role", "tailor", ...
	System    string         // who Claude is for this task; stable text, cached
	Prompt    string         // the material and the ask
	Schema    map[string]any // shape of the answer; nil means plain text
	Effort    string         // "low", "medium" (default), "high"
	MaxTokens int            // 0 = a sensible default
	Web       bool           // Claude may search the web for this one
	Images    []Image        // pictures to look at along with the prompt

	// Input is the same material as Prompt in typed form. Real engines ignore
	// it; the stand-in used by tests and the demo works from it.
	Input any
}

// Image is a picture sent with a request. Mime is image/png, image/jpeg,
// image/gif or image/webp.
type Image struct {
	Mime string
	Data []byte
}

// Response is Claude's answer and what it cost.
type Response struct {
	Text         string // JSON when the request had a Schema
	Model        string
	TokensIn     int64
	TokensOut    int64
	TokensCached int64
	Cost         float64 // US dollars; an estimate when the engine doesn't report one
}

// Engine is one way of reaching Claude.
type Engine interface {
	Name() string
	Do(ctx context.Context, req Request) (Response, error)
}

// Func adapts a function into an Engine.
type Func func(ctx context.Context, req Request) (Response, error)

func (f Func) Name() string                                        { return "stand-in" }
func (f Func) Do(ctx context.Context, r Request) (Response, error) { return f(ctx, r) }

// Errors the rest of the program reacts to.
var (
	// ErrNotConnected: no way of reaching Claude has been set up.
	ErrNotConnected = errors.New("Claude isn't connected yet")
	// ErrDeclined: Claude declined to answer this request.
	ErrDeclined = errors.New("Claude declined this request")
)

// LimitError means the account is out of usage for now.
type LimitError struct {
	Msg   string
	Until time.Time // zero when unknown
}

func (e *LimitError) Error() string { return e.Msg }

// AuthError means the key or sign-in was not accepted.
type AuthError struct{ Msg string }

func (e *AuthError) Error() string { return e.Msg }

// JSON asks for an answer of type T.
func JSON[T any](ctx context.Context, e Engine, req Request) (T, Response, error) {
	var out T
	if req.Schema == nil {
		return out, Response{}, errors.New("llm: JSON needs a schema")
	}
	resp, err := e.Do(ctx, req)
	if err != nil {
		return out, resp, err
	}
	raw := ExtractJSON(resp.Text)
	if raw == "" {
		return out, resp, fmt.Errorf("llm: %s: the answer was not JSON", req.Task)
	}
	if err := json.Unmarshal([]byte(Tidy(raw)), &out); err != nil {
		return out, resp, fmt.Errorf("llm: %s: %w", req.Task, err)
	}
	return out, resp, nil
}

var tidy = strings.NewReplacer(
	// Characters nobody can see, which give machine-written text away and
	// break searches inside application systems.
	"\u200b", "", "\u200c", "", "\u200d", "", "\u2060", "", "\ufeff", "", "\u00ad", "",
	"\u202a", "", "\u202b", "", "\u202c", "", "\u202d", "", "\u202e", "", "\u2066", "", "\u2067", "", "\u2068", "", "\u2069", "",
	"\u00a0", " ", "\u202f", " ",
	// The long dash, the most recognisable mark of machine writing.
	" \u2014 ", ", ", "\u2014 ", ", ", " \u2014", ",", "\u2014", ", ",
)

// Tidy cleans what Claude wrote before it is kept: no hidden characters and
// no long dashes. It is safe on JSON text, where these only occur inside
// strings.
func Tidy(s string) string { return tidy.Replace(s) }

// ExtractJSON finds the JSON object or array in a reply that may have prose
// or a code fence around it. It returns "" when there is none.
func ExtractJSON(s string) string {
	s = strings.TrimSpace(s)
	if json.Valid([]byte(s)) && s != "" && (s[0] == '{' || s[0] == '[') {
		return s
	}
	best := ""
	for i := 0; i < len(s); i++ {
		if s[i] != '{' && s[i] != '[' {
			continue
		}
		if end := matchEnd(s, i); end > i {
			cand := s[i : end+1]
			if len(cand) > len(best) && json.Valid([]byte(cand)) {
				best = cand
			}
			if len(best) > 0 {
				i = end
			}
		}
	}
	return best
}

func matchEnd(s string, start int) int {
	depth, inStr, esc := 0, false, false
	for i := start; i < len(s); i++ {
		c := s[i]
		switch {
		case esc:
			esc = false
		case inStr:
			if c == '\\' {
				esc = true
			} else if c == '"' {
				inStr = false
			}
		case c == '"':
			inStr = true
		case c == '{' || c == '[':
			depth++
		case c == '}' || c == ']':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// ---- answer shapes -----------------------------------------------------------

// Obj describes an object whose fields are all present, in the order given:
// Obj("name", Str("the name"), "age", Int("in years")).
func Obj(pairs ...any) map[string]any {
	props := map[string]any{}
	var req []string
	for i := 0; i+1 < len(pairs); i += 2 {
		k := pairs[i].(string)
		props[k] = pairs[i+1]
		req = append(req, k)
	}
	return map[string]any{"type": "object", "properties": props, "required": req, "additionalProperties": false}
}

func Str(desc string) map[string]any  { return map[string]any{"type": "string", "description": desc} }
func Int(desc string) map[string]any  { return map[string]any{"type": "integer", "description": desc} }
func Bool(desc string) map[string]any { return map[string]any{"type": "boolean", "description": desc} }

func Enum(desc string, vals ...string) map[string]any {
	return map[string]any{"type": "string", "description": desc, "enum": vals}
}

func Arr(desc string, item map[string]any) map[string]any {
	return map[string]any{"type": "array", "description": desc, "items": item}
}

// ---- metering ------------------------------------------------------------------

// Recorder is told about every call.
type Recorder func(task, engine, model string, in, out, cached int64, cost float64, ms int64, errText string)

// Metered wraps an engine: it limits how many calls run at once, records each
// one, and stops calling for a while once the account says it is out of usage.
type Metered struct {
	Pick   func() (Engine, error) // the engine to use right now
	Record Recorder
	Slots  int // calls at once; 0 = 3

	// Other, when set, names another AI to ask first for this request, or
	// returns nil to go straight to Claude. Its failures never pause Claude
	// or count against Claude's budget: Claude answers instead.
	Other func(Request) Engine

	// Budget returns how much may still be spent today in dollars; a negative
	// number means no limit.
	Budget func() float64

	mu      sync.Mutex
	sem     chan struct{}
	resting time.Time
	restMsg string
}

func (m *Metered) Name() string {
	e, err := m.Pick()
	if err != nil {
		return "none"
	}
	return e.Name()
}

// Resting reports whether calls are paused, why, and until when.
func (m *Metered) Resting() (bool, string, time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if time.Now().Before(m.resting) {
		return true, m.restMsg, m.resting
	}
	return false, "", time.Time{}
}

// Wake clears a pause, for when the person changes how Claude is connected.
func (m *Metered) Wake() {
	m.mu.Lock()
	m.resting = time.Time{}
	m.mu.Unlock()
}

func (m *Metered) Do(ctx context.Context, req Request) (Response, error) {
	if m.Other != nil {
		if o := m.Other(req); o != nil {
			start := time.Now()
			resp, err := o.Do(ctx, req)
			if m.Record != nil && !errors.Is(err, context.Canceled) {
				errText := ""
				if err != nil {
					errText = err.Error() + " (passed to Claude)"
				}
				m.Record(req.Task, o.Name(), resp.Model, resp.TokensIn, resp.TokensOut, resp.TokensCached, resp.Cost, time.Since(start).Milliseconds(), errText)
			}
			if err == nil || ctx.Err() != nil {
				return resp, err
			}
		}
	}
	if rest, msg, until := m.Resting(); rest {
		return Response{}, &LimitError{Msg: msg, Until: until}
	}
	if m.Budget != nil {
		if left := m.Budget(); left == 0 {
			return Response{}, &LimitError{Msg: "Today's spending limit for Claude is used up"}
		}
	}
	e, err := m.Pick()
	if err != nil {
		return Response{}, err
	}
	m.mu.Lock()
	if m.sem == nil {
		n := m.Slots
		if n <= 0 {
			n = 3
		}
		m.sem = make(chan struct{}, n)
	}
	sem := m.sem
	m.mu.Unlock()
	select {
	case sem <- struct{}{}:
		defer func() { <-sem }()
	case <-ctx.Done():
		return Response{}, ctx.Err()
	}

	start := time.Now()
	resp, err := e.Do(ctx, req)
	if err != nil && retryable(err) && ctx.Err() == nil {
		select {
		case <-time.After(2 * time.Second):
			resp, err = e.Do(ctx, req)
		case <-ctx.Done():
		}
	}
	errText := ""
	if err != nil {
		errText = err.Error()
		var lim *LimitError
		if errors.As(err, &lim) {
			until := lim.Until
			if until.IsZero() || until.Before(time.Now()) {
				until = time.Now().Add(15 * time.Minute)
			}
			m.mu.Lock()
			m.resting, m.restMsg = until, lim.Msg
			m.mu.Unlock()
		}
	}
	if m.Record != nil && !errors.Is(err, context.Canceled) {
		m.Record(req.Task, e.Name(), resp.Model, resp.TokensIn, resp.TokensOut, resp.TokensCached, resp.Cost, time.Since(start).Milliseconds(), errText)
	}
	return resp, err
}

// TransientError is a failure worth one more try.
type TransientError struct{ Err error }

func (e *TransientError) Error() string { return e.Err.Error() }
func (e *TransientError) Unwrap() error { return e.Err }

func retryable(err error) bool {
	var t *TransientError
	return errors.As(err, &t)
}

// ---- prices --------------------------------------------------------------------

// Dollars per million tokens: input, output, cached input read.
var prices = map[string][3]float64{
	"claude-fable-5-2":  {8, 40, 0.20},
	"claude-opus-5-5":   {4, 20, 0.20},
	"claude-sonnet-5-5": {2, 10, 0.10},
	"claude-haiku-5-5":  {0.10, 0.50, 0.01},
}

// Models the person can choose between, strongest first.
var Models = []struct{ ID, Name, Note string }{
	{"claude-opus-5-5", "Claude Opus 5.5", "The default: strong judgment at a moderate price"},
	{"claude-fable-5-2", "Claude Fable 5.2", "The most capable, about twice the price"},
	{"claude-sonnet-5-5", "Claude Sonnet 5.5", "Faster and half the price"},
	{"claude-haiku-5-5", "Claude Haiku 5.5", "Very cheap; weaker at tailoring"},
}

// DefaultModel is used until the person picks another.
const DefaultModel = "claude-opus-5-5"

func estimate(model string, in, out, cachedRead, cacheWrite int64) float64 {
	p, ok := prices[model]
	if !ok {
		p = prices[DefaultModel]
	}
	return (float64(in)*p[0] + float64(out)*p[1] + float64(cachedRead)*p[2] + float64(cacheWrite)*p[0]*1.25) / 1e6
}
