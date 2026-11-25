package llm

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A long system prompt (a CV and profile) goes through a file, so the command
// line stays short; the file is gone afterwards.
func TestCLISystemPromptGoesThroughAFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as the stand-in")
	}
	dir := t.TempDir()
	fake := filepath.Join(dir, "claude")
	script := `#!/bin/sh
total=0
for a in "$@"; do total=$((total + ${#a})); done
while [ $# -gt 0 ]; do
  if [ "$1" = "--system-prompt-file" ]; then f="$2"; fi
  if [ "$1" = "--system-prompt" ]; then echo "inline" >&2; exit 3; fi
  shift
done
cat > /dev/null
n=$(wc -c < "$f")
printf '{"type":"result","result":"%s %s %s","is_error":false}\n' "$n" "$total" "$(head -c 5 "$f")"
`
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(dir, "work")
	c := &CLI{Path: fake, Dir: work}
	system := "HELLO" + strings.Repeat("x", 60000)
	res, err := c.Do(context.Background(), Request{System: system, Prompt: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	f := strings.Fields(res.Text)
	if len(f) != 3 || f[0] != "60005" || f[2] != "HELLO" {
		t.Fatalf("the stand-in saw %q", res.Text)
	}
	if len(f[1]) > 4 {
		t.Fatalf("the command line is %s characters", f[1])
	}
	left, _ := os.ReadDir(work)
	if len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}
