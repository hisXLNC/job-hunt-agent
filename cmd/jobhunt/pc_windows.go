package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"jobhunt/internal/api"
	"jobhunt/internal/engine"
	"jobhunt/internal/llm"
	"jobhunt/internal/trace"
)

// What only Windows does for Job Hunt: its folder dialog, installing Claude
// Code, the browsers links open in, and noticing a copied job link.

const noWindow = 0x08000000 // CREATE_NO_WINDOW

// machine is this computer, for the pages.
func machine() api.Machine {
	return api.Machine{Power: powerState, AllowWake: allowWake, PickFolder: pickFolder, InstallClaude: installClaude, SignInClaude: signInClaude, Browsers: browsers, Clipboard: true}
}

// documentsDir is the person's Documents folder, wherever Windows keeps it (OneDrive included).
func documentsDir() string {
	if d, err := windows.KnownFolderPath(windows.FOLDERID_Documents, 0); err == nil && d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Documents")
}

const folderScript = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$d=New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description=$env:JH_TITLE
$d.ShowNewFolderButton=$true
if($env:JH_START -and (Test-Path -LiteralPath $env:JH_START)){$d.SelectedPath=$env:JH_START}
$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}
if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Console]::Out.Write($d.SelectedPath)}`

// pickFolder shows Windows' folder dialog and returns the folder chosen, or
// "" when the person cancels. The words reach PowerShell through the
// environment, never through the command line.
func pickFolder(title, start string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", folderScript)
	cmd.Env = append(os.Environ(), "JH_TITLE="+clip(title, 80), "JH_START="+start)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: noWindow}
	out, err := cmd.Output()
	if err != nil {
		trace.Log("problem", "the folder dialog: %v", err)
		return "", errors.New("Windows didn't show the folder dialog. Type the path instead")
	}
	return strings.TrimSpace(string(out)), nil
}

// installClaude runs Claude Code's own installer for Windows, from
// claude.ai, out of sight. Nothing of the person's goes with it.
func installClaude(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: noWindow}
	out, err := cmd.CombinedOutput()
	trace.Log("app", "Claude Code installer: %v %s", err, clip(string(out), 600))
	if err != nil {
		tail := strings.TrimSpace(string(out))
		if r := []rune(tail); len(r) > 300 {
			tail = "…" + string(r[len(r)-300:])
		}
		return errors.New("the installer stopped: " + firstLine(tail, err.Error()))
	}
	if _, err := llm.FindCLI(); err != nil {
		return errors.New("the installer finished, but Claude Code wasn't found afterwards. Restart Job Hunt and look again")
	}
	return nil
}

func firstLine(s, or string) string {
	if s = strings.TrimSpace(s); s != "" {
		return clip(s, 300)
	}
	return or
}

// signInClaude opens Claude Code in a window of its own. It asks the person
// to sign in with their Claude account in the browser the first time.
func signInClaude(cli string) error {
	cmd := exec.Command(cli)
	cmd.Dir, _ = os.UserHomeDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000010} // CREATE_NEW_CONSOLE
	if err := cmd.Start(); err != nil {
		return errors.New("Windows wouldn't start Claude Code: " + err.Error())
	}
	go cmd.Wait()
	return nil
}

// The browsers links can open in, by where each installs itself.
var browserPlaces = []struct {
	id, name string
	paths    []string // under %ProgramFiles%, %ProgramFiles(x86)% or %LocalAppData%
}{
	{"edge", "Microsoft Edge", []string{`Microsoft\Edge\Application\msedge.exe`}},
	{"chrome", "Google Chrome", []string{`Google\Chrome\Application\chrome.exe`}},
	{"firefox", "Firefox", []string{`Mozilla Firefox\firefox.exe`}},
	{"brave", "Brave", []string{`BraveSoftware\Brave-Browser\Application\brave.exe`}},
	{"vivaldi", "Vivaldi", []string{`Vivaldi\Application\vivaldi.exe`}},
	{"opera", "Opera", []string{`Programs\Opera\opera.exe`}},
}

func browserExe(id string) string {
	for _, b := range browserPlaces {
		if b.id != id {
			continue
		}
		for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")} {
			for _, p := range b.paths {
				if root == "" {
					continue
				}
				if f := filepath.Join(root, p); exists(f) {
					return f
				}
			}
		}
	}
	return ""
}

func browsers() []api.Browser {
	out := []api.Browser{}
	for _, b := range browserPlaces {
		if browserExe(b.id) != "" {
			out = append(out, api.Browser{ID: b.id, Name: b.name})
		}
	}
	return out
}

// openLink opens a web address in the browser the person chose, else in
// Windows' own choice.
func openLink(link string) {
	if exe := browserExe(linkBrowser()); exe != "" {
		if exec.Command(exe, link).Start() == nil {
			return
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", link).Start()
}

var (
	pGetClipboardSeq = user32.NewProc("GetClipboardSequenceNumber")
	pOpenClipboard   = user32.NewProc("OpenClipboard")
	pCloseClipboard  = user32.NewProc("CloseClipboard")
	pGetClipboard    = user32.NewProc("GetClipboardData")
	pGlobalLock      = kernel32.NewProc("GlobalLock")
	pGlobalUnlock    = kernel32.NewProc("GlobalUnlock")
)

// clipboardText reads the text on the clipboard, at most a few thousand letters.
func clipboardText() string {
	if r, _, _ := pOpenClipboard.Call(0); r == 0 {
		return ""
	}
	defer pCloseClipboard.Call()
	h, _, _ := pGetClipboard.Call(13) // CF_UNICODETEXT
	if h == 0 {
		return ""
	}
	p, _, _ := pGlobalLock.Call(h)
	if p == 0 {
		return ""
	}
	defer pGlobalUnlock.Call(h)
	// The handle Windows lent is memory it owns until GlobalUnlock.
	text := unsafe.Slice((*uint16)(*(*unsafe.Pointer)(unsafe.Pointer(&p))), 4096)
	n := 0
	for n < len(text) && text[n] != 0 {
		n++
	}
	return windows.UTF16ToString(text[:n])
}

// watchClipboard notices a job link the person copies, while they have that
// switched on. Only a change to the clipboard is read, and only a single job
// link is acted on: it is offered under the bell, never added by itself.
func watchClipboard(ctx context.Context, e *engine.Engine) {
	go func() {
		seq, _, _ := pGetClipboardSeq.Call()
		t := time.NewTicker(1500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
			n, _, _ := pGetClipboardSeq.Call()
			if n == seq {
				continue
			}
			seq = n
			if !e.Desk().Clip {
				continue
			}
			if text := clipboardText(); text != "" && e.TookCopiedLink(text) {
				trace.Log("app", "a copied job link was offered")
			}
		}
	}()
}
