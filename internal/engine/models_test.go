package engine

import (
	"context"
	"sync"
	"testing"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

// Each kind of work goes to the model the person chose for it, and the
// effort they chose applies to every task.
func TestModelsPerTask(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	stand := brain.StandIn()
	var mu sync.Mutex
	models := map[string]string{}
	e.Sample = llm.Func(func(ctx context.Context, req llm.Request) (llm.Response, error) {
		mu.Lock()
		models[req.Task] = req.Model + "/" + req.Effort
		mu.Unlock()
		return stand.Do(ctx, req)
	})
	set := e.LLM()
	set.ScoreModel, set.WriteModel, set.Effort = "claude-haiku-5-5", "claude-fable-5-2", "high"
	if err := e.SetLLM(set); err != nil {
		t.Fatal(err)
	}
	w.jobs = []map[string]any{job(1, "Tax Technology Manager", "Toronto, ON", goodAd)}
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	if got := models["read_role"]; got != "claude-haiku-5-5/high" {
		t.Errorf("reading went to %q", got)
	}
	if got := models["tailor"]; got != "claude-fable-5-2/high" {
		t.Errorf("tailoring went to %q", got)
	}
	if got := models["letter"]; got != "claude-fable-5-2/high" {
		t.Errorf("the letter went to %q", got)
	}
	if err := CheckModels(LLMSettings{ScoreModel: "gpt-9"}); err == nil {
		t.Error("an unknown model must be refused")
	}
	if err := CheckModels(LLMSettings{Effort: "max"}); err == nil {
		t.Error("an unknown effort must be refused")
	}
}

// Grouped scoring is off until the person turns it on; on, a few postings go
// in one request, and a reply that doesn't fit them is read again one by one.
func TestGroupedScoring(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	stand := brain.StandIn()
	var mu sync.Mutex
	calls := map[string]int{}
	broken := false
	e.Sample = llm.Func(func(ctx context.Context, req llm.Request) (llm.Response, error) {
		mu.Lock()
		calls[req.Task]++
		bad := broken && req.Task == "read_roles"
		mu.Unlock()
		if bad {
			return llm.Response{Text: `{"readings":[]}`}, nil
		}
		return stand.Do(ctx, req)
	})
	if e.LLM().Grouped {
		t.Fatal("grouped scoring must start off")
	}
	set := e.LLM()
	set.Grouped = true
	e.SetLLM(set)
	p := e.S.Profile()
	p.MayPrepare = "ask"
	e.S.SaveProfile(p)
	for i := 1; i <= 5; i++ {
		w.jobs = append(w.jobs, job(i, "Tax Technology Manager", "Toronto, ON", goodAd+"<p>Posting "+string(rune('A'+i))+"</p>"))
	}
	// Five roles in the same place and title count as one; vary the place.
	places := []string{"Toronto, ON", "Mississauga, ON", "Markham, ON", "Vaughan, ON", "Oakville, ON"}
	for i := range w.jobs {
		w.jobs[i]["location"] = map[string]string{"name": places[i]}
	}
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	found, _, _ := e.S.Roles(store.RoleFilter{Stages: []string{"found"}, Limit: 50})
	if len(found) != 5 {
		t.Fatalf("want 5 roles read and kept, got %d", len(found))
	}
	if calls["read_roles"] < 1 || calls["read_roles"] > 3 {
		t.Errorf("grouped requests = %d, want 1 to 3", calls["read_roles"])
	}
	if calls["read_role"] > 2 {
		t.Errorf("single reads = %d: the groups should carry most", calls["read_role"])
	}

	// A broken grouped answer falls back to reading one at a time.
	broken = true
	before := calls["read_role"]
	for i, place := range []string{"Brampton, ON", "Pickering, ON", "Ajax, ON", "Whitby, ON", "Oshawa, ON"} {
		j := job(10+i, "Tax Technology Manager", place, goodAd)
		w.jobs = append(w.jobs, j)
	}
	if err := e.Search(context.Background(), "full"); err != nil {
		t.Fatal(err)
	}
	found, _, _ = e.S.Roles(store.RoleFilter{Stages: []string{"found"}, Limit: 50})
	if len(found) != 10 || calls["read_role"]-before < 4 {
		t.Errorf("fallback: %d kept, %d single reads", len(found), calls["read_role"]-before)
	}
}
