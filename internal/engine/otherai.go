package engine

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"

	"jobhunt/internal/llm"
)

// Another AI: an OpenAI-style service (ChatGPT, OpenRouter, Groq, Grok,
// Gemini, a model on this computer) that does the searching, or everything,
// in Claude's place. Claude stays the default: it answers whatever the other
// AI can't (web lookups, the assistant) and whenever the other AI fails.
//
// The key is kept like Claude's API key, in the data file only. It is never
// sent back to the pages and goes only to the address it was saved with.

// OtherAI is the setting as stored.
type OtherAI struct {
	On    bool   `json:"on"`
	Base  string `json:"base"`
	Key   string `json:"key,omitempty"`
	Model string `json:"model"`
	Use   string `json:"use"` // "search" (reading and scoring postings) or "all"
}

// OtherAIInput is what the settings page sends. An empty key keeps the saved
// one, unless the address changed.
type OtherAIInput struct {
	On    bool   `json:"on"`
	Base  string `json:"base"`
	Key   string `json:"key"`
	Model string `json:"model"`
	Use   string `json:"use"`
}

// OtherAIState is what the pages see: never the key.
type OtherAIState struct {
	On     bool   `json:"on"`
	Base   string `json:"base"`
	Model  string `json:"model"`
	Use    string `json:"use"`
	HasKey bool   `json:"has_key"`
	OK     bool   `json:"ok"`
	Note   string `json:"note,omitempty"`
}

const otherKey = "otherai"

// searchTasks are the requests "searching only" hands to the other AI.
var searchTasks = map[string]bool{"read_role": true, "read_roles": true, "title_look": true, "employer_sites": true}

// keepWithClaude are requests the other AI never takes: the assistant acts
// on the person's data with buttons, mail from the inbox is promised to
// Claude alone (see the inbox card), Indeed and the news need Claude's
// connector and web search, and the test is Claude's own.
var keepWithClaude = map[string]bool{"assist": true, "mail": true, "mail_reply": true, "senders": true, "rejection_reply": true, "indeed_search": true, "indeed_connectors": true, "find_news": true, "test": true}

// OtherAI returns the stored setting.
func (e *Engine) OtherAI() OtherAI {
	var set OtherAI
	e.S.Get(otherKey, &set)
	if set.Use != "all" {
		set.Use = "search"
	}
	return set
}

// OtherAIState says how the other AI is set up, without the key.
func (e *Engine) OtherAIState() OtherAIState {
	set := e.OtherAI()
	st := OtherAIState{On: set.On, Base: set.Base, Model: set.Model, Use: set.Use, HasKey: set.Key != "", OK: set.On}
	if set.On {
		if o := e.otherEngine(set); o.Resting() {
			st.OK, st.Note = false, "At its limit for now; Claude is doing its part"
		}
	}
	return st
}

// SetOtherAI saves the setting. A new address, model or key is tried first
// and kept only if the service answers. It returns what the try said.
func (e *Engine) SetOtherAI(ctx context.Context, in OtherAIInput) (string, error) {
	cur := e.OtherAI()
	base := strings.TrimRight(strings.TrimSpace(in.Base), "/")
	model := strings.TrimSpace(in.Model)
	key, err := tidyKey(in.Key)
	if err != nil {
		return "", err
	}
	if base != "" {
		if err := otherAddress(base); err != nil {
			return "", err
		}
	}
	if key == "" && base == cur.Base {
		key = cur.Key // a saved key only ever goes to the address it was saved for
	}
	use := "search"
	if in.Use == "all" {
		use = "all"
	}
	next := OtherAI{On: in.On, Base: base, Key: key, Model: model, Use: use}
	msg := ""
	if next.On {
		if base == "" {
			return "", errors.New("put in the service's address")
		}
		if model == "" {
			return "", errors.New("put in the model's name, as the service writes it")
		}
		if !cur.On || base != cur.Base || model != cur.Model || key != cur.Key {
			if msg, err = e.tryOther(ctx, next); err != nil {
				return "", fmt.Errorf("not saved: %w", err)
			}
		}
	}
	if err := e.S.Set(otherKey, next); err != nil {
		return "", err
	}
	e.S.Changed("connections")
	return msg, nil
}

// ForgetOtherAI removes the key and stops using the other AI.
func (e *Engine) ForgetOtherAI() error {
	set := e.OtherAI()
	set.On, set.Key = false, ""
	if err := e.S.Set(otherKey, set); err != nil {
		return err
	}
	e.S.Changed("connections")
	return nil
}

// TestOtherAI asks the saved service one tiny question, straight, so that
// Claude can't answer in its place.
func (e *Engine) TestOtherAI(ctx context.Context) (string, error) {
	set := e.OtherAI()
	if set.Base == "" || set.Model == "" {
		return "", errors.New("set up the other AI first")
	}
	return e.tryOther(ctx, set)
}

func (e *Engine) tryOther(ctx context.Context, set OtherAI) (string, error) {
	o := &llm.OpenAI{Base: set.Base, Key: set.Key, Model: set.Model}
	type ans struct {
		Word string `json:"word"`
	}
	out, resp, err := llm.JSON[ans](ctx, o, llm.Request{
		Task: "test", System: "You are a connection test.", Prompt: "Reply with the single word: ready",
		Schema: llm.Obj("word", llm.Str("the word")),
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Working: %s answered %q.", resp.Model, out.Word), nil
}

// otherFor is the meter's question: should the other AI take this request?
func (e *Engine) otherFor(req llm.Request) llm.Engine {
	set := e.OtherAI()
	if !set.On || set.Base == "" || set.Model == "" || req.Web || keepWithClaude[req.Task] {
		return nil
	}
	if set.Use != "all" && !searchTasks[req.Task] {
		return nil
	}
	o := e.otherEngine(set)
	if o.Resting() {
		return nil
	}
	return o
}

// otherEngine keeps one engine for the saved setting, so what it learns
// (that the service wants the answer's shape in words, that it is at its
// limit) lasts from call to call.
func (e *Engine) otherEngine(set OtherAI) *llm.OpenAI {
	e.otherMu.Lock()
	defer e.otherMu.Unlock()
	if o := e.other; o != nil && o.Base == set.Base && o.Key == set.Key && o.Model == set.Model {
		return o
	}
	e.other = &llm.OpenAI{Base: set.Base, Key: set.Key, Model: set.Model}
	return e.other
}

// otherAddress accepts https anywhere, and plain http only on this computer
// or the home network, where a local model runs.
func otherAddress(base string) error {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("the address should look like https://api.openai.com/v1")
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		h := u.Hostname()
		if h == "localhost" {
			return nil
		}
		if ip := net.ParseIP(h); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
			return nil
		}
		return errors.New("use an https address; plain http is only for a model on this computer or your home network")
	}
	return errors.New("the address should start with https://")
}
