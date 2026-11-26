package api

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"jobhunt/internal/brain"
)

// Asked where a CV is and to be e-mailed it, the assistant puts a copy in
// the person's folder at once and is given the whole path; with no inbox
// connected the e-mail fails with the reason, not a refusal, and the
// person's address is never part of what Claude is shown or asked for.
func TestAssistantHandsOverACV(t *testing.T) {
	srv, h, sc := withScript(t, calls(
		brain.AssistCall{Method: "POST", Path: "/api/handout/save", Body: `{"what":"cv","id":1}`},
		brain.AssistCall{Method: "POST", Path: "/api/handout/mail", Body: `{"what":"cv","id":1,"to":"someone@evil.example"}`},
	), brain.AssistStep{Say: "It is in your folder."})
	if _, _, err := srv.E.AddCV(context.Background(), "Sam Rivera CV.txt", []byte(shortCV)); err != nil {
		t.Fatal(err)
	}
	srv.E.FilesHome = t.TempDir()
	shown := ""
	was := openDir
	openDir = func(dir string) error { shown = dir; return nil }
	t.Cleanup(func() { openDir = was })

	v := tell(t, h, "where is my cv? email me a copy", "#/you")
	notes := sc.seen[1].Notes[1:]
	home, _ := json.Marshal(srv.E.FilesHome) // as it reads inside the JSON Claude is shown
	if !strings.Contains(notes[0].Result, strings.Trim(string(home), `"`)) || shown == "" {
		t.Fatalf("the copy: %s (folder shown: %q)", notes[0].Result, shown)
	}
	ents, _ := os.ReadDir(shown)
	if len(ents) != 1 {
		t.Fatalf("files in %s: %d", shown, len(ents))
	}
	if !strings.HasPrefix(notes[1].Result, "Failed:") || !strings.Contains(notes[1].Result, "inbox isn't connected") {
		t.Fatalf("mailing with no inbox: %s", notes[1].Result)
	}
	last := v.Turns[len(v.Turns)-1]
	if len(last.Extra.Did) != 2 || !last.Extra.Did[0].OK || !strings.Contains(last.Extra.Did[0].Label, "your CV") || len(last.Extra.Held) != 0 {
		t.Fatalf("done: %+v", last.Extra)
	}
}
