package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// CLI reaches Claude through the Claude Code program the person is already
// signed in to, so it uses their subscription and needs no key.
type CLI struct {
	Path  string // "" = find it
	Model string // "" = DefaultModel
	Dir   string // an empty folder to run in, so no project files are picked up
}

func (c *CLI) Name() string { return "claude-code" }

// FindCLI looks for the Claude Code program in the usual places.
func FindCLI() (string, error) {
	names := []string{"claude"}
	if runtime.GOOS == "windows" {
		names = []string{"claude.exe", "claude.cmd"}
	}
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p, nil
		}
	}
	home, _ := os.UserHomeDir()
	var dirs []string
	if runtime.GOOS == "windows" {
		dirs = []string{
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".claude", "local"),
			filepath.Join(os.Getenv("APPDATA"), "npm"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "claude"),
		}
	} else {
		dirs = []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, ".claude", "local"), "/usr/local/bin", "/opt/homebrew/bin"}
	}
	for _, d := range dirs {
		for _, n := range names {
			p := filepath.Join(d, n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, nil
			}
		}
	}
	return "", errors.New("Claude Code isn't installed on this computer")
}

type cliResult struct {
	IsError          bool            `json:"is_error"`
	Subtype          string          `json:"subtype"`
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
	TotalCostUSD     float64         `json:"total_cost_usd"`
	APIErrorStatus   *int            `json:"api_error_status"`
	Usage            struct {
		InputTokens         int64 `json:"input_tokens"`
		OutputTokens        int64 `json:"output_tokens"`
		CacheReadTokens     int64 `json:"cache_read_input_tokens"`
		CacheCreationTokens int64 `json:"cache_creation_input_tokens"`
	} `json:"usage"`
	ModelUsage map[string]json.RawMessage `json:"modelUsage"`
}

func (c *CLI) Do(ctx context.Context, req Request) (Response, error) {
	path := c.Path
	if path == "" {
		p, err := FindCLI()
		if err != nil {
			return Response{}, ErrNotConnected
		}
		path = p
	}
	model := c.Model
	if model == "" {
		model = DefaultModel
	}
	effort := req.Effort
	if effort == "" {
		effort = "medium"
	}
	// The system prompt holds the person's CV and profile: it goes in a
	// private file, not on the command line, which Windows caps at 32,767
	// characters and which other programs can read.
	sysFile, err := writeSystem(c.Dir, req.System)
	if err != nil {
		return Response{}, err
	}
	defer os.Remove(sysFile)
	args := []string{"-p", "--output-format", "json", "--model", model, "--effort", effort,
		"--setting-sources", "", "--system-prompt-file", sysFile}
	// Pictures can only go in as a typed message, which needs the streaming
	// formats on both sides. The last line of the stream is the same result.
	var stdin io.Reader = strings.NewReader(req.Prompt)
	if len(req.Images) > 0 {
		args[2] = "stream-json"
		args = append(args, "--input-format", "stream-json", "--verbose")
		var content []map[string]any
		for _, im := range req.Images {
			content = append(content, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": im.Mime, "data": base64.StdEncoding.EncodeToString(im.Data)}})
		}
		content = append(content, map[string]any{"type": "text", "text": req.Prompt})
		line, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": content}})
		stdin = bytes.NewReader(append(line, '\n'))
	}
	if req.Web {
		args = append(args, "--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch,WebFetch")
	} else {
		args = append(args, "--tools", "")
	}
	if req.Schema != nil {
		shape, _ := json.Marshal(req.Schema)
		args = append(args, "--json-schema", string(shape))
	}

	limit := 6 * time.Minute
	if req.Web {
		limit = 12 * time.Minute
	}
	cctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	cmd := exec.CommandContext(cctx, path, args...)
	hideWindow(cmd)
	if c.Dir != "" {
		os.MkdirAll(c.Dir, 0o700)
		cmd.Dir = c.Dir
	}
	// The prompt goes in through standard input: it is long, and it must not
	// be readable in the process list.
	cmd.Stdin = stdin
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	// Job Hunt's own API key, if any, must not leak into the person's sign-in.
	cmd.Env = cleanEnv(os.Environ())
	runErr := cmd.Run()

	out := Response{Model: model}
	var res cliResult
	if jerr := json.Unmarshal(lastJSONLine(stdout.Bytes()), &res); jerr != nil {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		if cctx.Err() != nil {
			return out, &TransientError{errors.New("Claude took too long to answer")}
		}
		msg := short(stderr.String() + " " + stdout.String())
		if runErr != nil && msg == "" {
			msg = runErr.Error()
		}
		return out, classifyCLI(msg)
	}
	out.TokensIn = res.Usage.InputTokens + res.Usage.CacheCreationTokens
	out.TokensOut = res.Usage.OutputTokens
	out.TokensCached = res.Usage.CacheReadTokens
	out.Cost = res.TotalCostUSD
	for m := range res.ModelUsage {
		out.Model = m
	}
	if res.IsError || (res.Subtype != "" && res.Subtype != "success") {
		msg := res.Result
		if msg == "" {
			msg = "Claude Code stopped: " + res.Subtype
		}
		return out, classifyCLI(msg)
	}
	if req.Schema != nil && len(res.StructuredOutput) > 0 && string(res.StructuredOutput) != "null" {
		out.Text = string(res.StructuredOutput)
	} else {
		out.Text = res.Result
	}
	return out, nil
}

func lastJSONLine(b []byte) []byte {
	b = bytes.TrimSpace(b)
	if i := bytes.LastIndexByte(b, '\n'); i >= 0 && json.Valid(b[i+1:]) {
		return b[i+1:]
	}
	return b
}

var resetRe = regexp.MustCompile(`(?i)resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)`)

func classifyCLI(msg string) error {
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "limit") && (strings.Contains(low, "reset") || strings.Contains(low, "usage") || strings.Contains(low, "hit your")):
		return &LimitError{Msg: "Your Claude plan is out of usage for now: " + short(msg), Until: resetTime(msg, time.Now())}
	case strings.Contains(low, "/login") || strings.Contains(low, "not logged in") || strings.Contains(low, "invalid api key") || strings.Contains(low, "authentication"):
		return &AuthError{"Claude Code isn't signed in. Open a terminal, run \"claude\", and sign in."}
	case strings.Contains(low, "overloaded") || strings.Contains(low, "529") || strings.Contains(low, "timeout") || strings.Contains(low, "econnreset"):
		return &TransientError{fmt.Errorf("Claude is busy: %s", short(msg))}
	}
	return fmt.Errorf("Claude Code: %s", short(msg))
}

// resetTime reads "resets 6am" style text; zero when it can't.
func resetTime(msg string, now time.Time) time.Time {
	m := resetRe.FindStringSubmatch(msg)
	if m == nil {
		return time.Time{}
	}
	var h, min int
	fmt.Sscan(m[1], &h)
	if m[2] != "" {
		fmt.Sscan(m[2], &min)
	}
	if strings.EqualFold(m[3], "pm") && h < 12 {
		h += 12
	}
	if strings.EqualFold(m[3], "am") && h == 12 {
		h = 0
	}
	loc := now.Location()
	if strings.Contains(strings.ToLower(msg), "utc") {
		loc = time.UTC
	}
	n := now.In(loc)
	t := time.Date(n.Year(), n.Month(), n.Day(), h, min, 0, 0, loc)
	if !t.After(n) {
		t = t.Add(24 * time.Hour)
	}
	return t
}

func cleanEnv(env []string) []string {
	var out []string
	for _, kv := range env {
		k := strings.SplitN(kv, "=", 2)[0]
		switch strings.ToUpper(k) {
		case "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT":
			continue
		}
		out = append(out, kv)
	}
	return out
}

// CheckCLI reports the installed version, proving the program runs.
func CheckCLI(ctx context.Context, path string) (string, error) {
	if path == "" {
		p, err := FindCLI()
		if err != nil {
			return "", err
		}
		path = p
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, path, "--version")
	hideWindow(cmd)
	b, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("Claude Code is installed but didn't start: %w", err)
	}
	return strings.TrimSpace(string(b)), nil
}

// writeSystem puts a system prompt in a file only this user can read.
func writeSystem(dir, text string) (string, error) {
	if dir == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(dir, "system-*.txt")
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(text); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}
