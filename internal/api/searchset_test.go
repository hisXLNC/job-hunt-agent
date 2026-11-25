package api

import (
	"encoding/json"
	"testing"
)

// The model choices survive a page that sends only the engine and key (the
// setup page does), unknown models are refused, and the settings for
// ratings, old roles and budget mode are checked before they are kept.
func TestModelAndSearchSettings(t *testing.T) {
	srv, h := newServer(t)
	put := func(path, body string) int {
		return do(h, call{method: "PUT", path: path, body: body, marker: true}).Code
	}
	if got := put("/api/llm", `{"engine":"demo","score_model":"claude-haiku-5-5","write_model":"claude-fable-5-2","effort":"low","grouped":true}`); got != 200 {
		t.Fatalf("saving models: %d", got)
	}
	if got := put("/api/llm", `{"engine":"demo","key":""}`); got != 200 {
		t.Fatalf("saving the engine alone: %d", got)
	}
	set := srv.E.LLM()
	if set.ScoreModel != "claude-haiku-5-5" || set.WriteModel != "claude-fable-5-2" || set.Effort != "low" || !set.Grouped {
		t.Errorf("model choices lost: %+v", set)
	}
	if got := put("/api/llm", `{"engine":"demo","score_model":"gpt-5"}`); got != 400 {
		t.Errorf("an unknown model: %d", got)
	}
	if got := put("/api/searchset", `{"clear_days":45}`); got != 400 {
		t.Errorf("45 days: %d", got)
	}
	if got := put("/api/searchset", `{"min_rating":9}`); got != 400 {
		t.Errorf("a rating of 9: %d", got)
	}
	if got := put("/api/searchset", `{"min_rating":3.5,"clear_days":60,"budget":true}`); got != 200 {
		t.Fatalf("saving: %d", got)
	}
	var out struct {
		Set struct {
			MinRating float64 `json:"min_rating"`
			ClearDays int     `json:"clear_days"`
			Budget    bool
		}
	}
	json.Unmarshal(do(h, call{path: "/api/searchset"}).Body.Bytes(), &out)
	if out.Set.MinRating != 3.5 || out.Set.ClearDays != 60 || !out.Set.Budget {
		t.Errorf("read back: %+v", out.Set)
	}
	if got := do(h, call{method: "POST", path: "/api/budget/cancel", body: `{}`}).Code; got != 403 {
		t.Errorf("a change without the page's marker: %d", got)
	}
}
