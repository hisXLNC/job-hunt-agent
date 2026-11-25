package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"jobhunt/extension"
	"jobhunt/internal/engine"
	"jobhunt/internal/llm"
)

// Machine is what only the computer itself can do. Each part is nil where
// this computer has no such thing (everywhere but Windows, and in tests).
type Machine struct {
	// Power says whether Windows lets Job Hunt wake the computer.
	Power func() PowerState
	// AllowWake switches on Windows' "Allow wake timers" while plugged in.
	AllowWake func() error
	// PickFolder shows Windows' folder dialog; "" when the person cancels.
	PickFolder func(title, start string) (string, error)
	// InstallClaude runs Claude Code's official installer.
	InstallClaude func(ctx context.Context) error
	// SignInClaude opens Claude Code in a window of its own, where the person signs in.
	SignInClaude func(cli string) error
	// Browsers are the browsers on this computer that links can open in.
	Browsers func() []Browser
	// Clipboard: copied job links can be noticed on this computer.
	Clipboard bool
}

// PowerState is what Windows' power settings allow.
type PowerState struct {
	Known    bool  `json:"known"`     // the setting could be read
	Blocked  bool  `json:"blocked"`   // "Allow wake timers" is off while plugged in
	CanAllow bool  `json:"can_allow"` // Job Hunt can switch it on
	Modern   bool  `json:"modern"`    // Modern Standby: Windows may ignore wake timers
	WakeAt   int64 `json:"wake_at"`   // the next time the computer is woken; 0 for none
}

// Browser is one browser links can open in.
type Browser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// pc is what the pages are told about this computer.
func (s *Server) pc() map[string]any {
	out := map[string]any{"pick": s.PC.PickFolder != nil, "claude_install": s.PC.InstallClaude != nil, "clip": s.PC.Clipboard, "browsers": []Browser{}}
	if s.PC.Power != nil {
		p := s.PC.Power()
		if at, ok := s.E.NextWake(); ok {
			p.WakeAt = at.Unix()
		}
		out["power"] = p
	}
	if s.PC.Browsers != nil {
		out["browsers"] = s.PC.Browsers()
	}
	return out
}

// openDir shows a folder in the computer's file manager.
func openDir(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return bad("Couldn't open the folder: " + dir)
	}
	go cmd.Wait()
	return nil
}

// extVersion is the version of the side panel Job Hunt holds now: the one in
// its own folder, where the installer put it, else the one inside the program.
func extVersion() string {
	var m struct {
		Version string `json:"version"`
	}
	if d := extDir(); d != "" {
		if b, err := os.ReadFile(filepath.Join(d, "manifest.json")); err == nil && json.Unmarshal(b, &m) == nil && m.Version != "" {
			return m.Version
		}
	}
	if b, err := extension.FS.ReadFile("manifest.json"); err == nil {
		json.Unmarshal(b, &m)
	}
	return m.Version
}

// deskRoutes: this computer (waking it, folders, Claude Code), the files
// kept in a folder, and reading a posting from its link. None of these is on
// the assistant's list or the phone's.
func (s *Server) deskRoutes(h func(string, handler)) {
	e := s.E

	// ---- every tailored CV and letter, also kept in a folder ----
	h("GET /api/files", func(w http.ResponseWriter, r *http.Request) (any, error) {
		set, dir := e.Files()
		return map[string]any{"off": set.Off, "dir": dir, "custom": set.Dir != "", "default": e.FilesHome, "folders": e.KeptFiles(300), "pick": s.PC.PickFolder != nil}, nil
	})
	h("PUT /api/files", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in engine.FilesSet
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if err := e.SetFiles(in); err != nil {
			return nil, bad(err.Error())
		}
		return nil, nil
	})
	// Shows the files folder, or one role's folder in it.
	h("POST /api/files/show", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Folder string `json:"folder"`
		}
		read(r, &in)
		dir := e.KeptFolderPath(in.Folder)
		if dir == "" {
			return nil, bad("That folder isn't there any more.")
		}
		os.MkdirAll(dir, 0o755)
		return map[string]string{"dir": dir}, openDir(dir)
	})
	// A role's CV and letter, written afresh into its folder, which is then shown.
	h("POST /api/files/role/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		folder, err := e.KeepFiles(idOf(r))
		if err != nil {
			return nil, bad(sentence(err.Error()))
		}
		if folder == "" {
			return nil, bad("Keeping files in a folder is off. Switch it on under Settings, The app.")
		}
		return map[string]string{"dir": folder}, openDir(folder)
	})
	h("POST /api/pick-folder", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Title string `json:"title"`
			Start string `json:"start"`
		}
		read(r, &in)
		if s.PC.PickFolder == nil {
			return nil, bad("Choosing a folder this way works on Windows only. Type the path instead.")
		}
		dir, err := s.PC.PickFolder(clipRunes(in.Title, 80), in.Start)
		if err != nil {
			return nil, bad(sentence(err.Error()))
		}
		return map[string]string{"dir": dir}, nil
	})

	// ---- waking the computer ----
	h("POST /api/desk/allow-wake", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if s.PC.AllowWake == nil {
			return nil, bad("Wake timers are a Windows setting.")
		}
		if err := s.PC.AllowWake(); err != nil {
			return nil, bad(sentence(err.Error()))
		}
		return s.pc(), nil
	})

	// ---- Claude Code ----
	h("POST /api/claude-code/install", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if s.PC.InstallClaude == nil {
			return nil, bad("Installing Claude Code from here works on Windows only. Install it from claude.com/claude-code.")
		}
		e.Go("claude-install", "Installing Claude Code", func(ctx context.Context) error {
			ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
			defer cancel()
			if err := s.PC.InstallClaude(ctx); err != nil {
				e.Tell("Claude Code didn't install", sentence(err.Error()), "#/settings/connections?open=claude")
				return err
			}
			e.Tell("Claude Code is installed", "Press Sign in to Claude next.", "#/settings/connections?open=claude")
			e.S.Changed("connections")
			return nil
		})
		return nil, nil
	})
	h("POST /api/claude-code/signin", func(w http.ResponseWriter, r *http.Request) (any, error) {
		cli, err := llm.FindCLI()
		if err != nil {
			return nil, bad("Claude Code isn't installed yet. Press Install Claude Code first.")
		}
		if s.PC.SignInClaude == nil {
			return nil, bad("Open a terminal, type claude and sign in there.")
		}
		if err := s.PC.SignInClaude(cli); err != nil {
			return nil, bad(sentence(err.Error()))
		}
		return nil, nil
	})

	// ---- a posting from its link (the bookmark button, a copied link) ----
	h("GET /api/copied", func(w http.ResponseWriter, r *http.Request) (any, error) {
		return map[string]string{"url": e.CopiedLink()}, nil
	})
	h("POST /api/peek", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			URL string `json:"url"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		link := safeLink(strings.TrimSpace(in.URL))
		if link == "" {
			return nil, bad("That isn't a web address.")
		}
		ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
		defer cancel()
		p, err := e.Src.Peek(ctx, link)
		if err != nil {
			return nil, bad("Job Hunt couldn't read that page. Paste the posting's text instead.")
		}
		return map[string]any{"title": p.Title, "company": p.Company, "location": p.Location, "description": p.Description, "known": e.KnownLink(link)}, nil
	})
}
