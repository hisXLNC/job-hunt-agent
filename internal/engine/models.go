package engine

import (
	"errors"

	"jobhunt/internal/llm"
)

// Models per kind of task. Reading roles against the CV is most of what Job
// Hunt asks Claude, so it can go to a cheaper model; tailoring and letters
// are what employers read, so they can go to the strongest. Everything else
// uses the main model.

// taskGroup says which of the person's model choices a task uses: "score",
// "write" or "" for the rest.
func taskGroup(task string) string {
	switch task {
	case "read_role", "read_roles":
		return "score"
	case "tailor", "letter", "follow_up", "case", "note", "form_answers", "arriving", "rejection_reply":
		return "write"
	}
	return ""
}

// Efforts are the effort levels the person can choose; "" lets each task ask.
var Efforts = []string{"", "low", "medium", "high"}

// shapeRequest sets the model and effort the person chose for a request.
func (e *Engine) shapeRequest(r *llm.Request) {
	set := e.LLM()
	switch taskGroup(r.Task) {
	case "score":
		if llm.KnownModel(set.ScoreModel) {
			r.Model = set.ScoreModel
		}
	case "write":
		if llm.KnownModel(set.WriteModel) {
			r.Model = set.WriteModel
		}
	}
	if set.Effort != "" {
		r.Effort = set.Effort
	}
}

// CheckModels says what is wrong with the model choices, if anything.
func CheckModels(set LLMSettings) error {
	for _, m := range []string{set.ScoreModel, set.WriteModel} {
		if m != "" && !llm.KnownModel(m) {
			return errors.New("choose one of the models in the list")
		}
	}
	for _, x := range Efforts {
		if set.Effort == x {
			return nil
		}
	}
	return errors.New("effort is low, medium or high")
}
