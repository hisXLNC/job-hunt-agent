package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"jobhunt/internal/trace"
)

// Job Hunt looks a few times a day for a newer version of itself and can
// install it: it downloads the installer from the one place installers come
// from, checks it is the file that was published, runs it quietly and comes
// back on the new version. The requests carry nothing about the person.

const (
	updateKey   = "update"
	releasesURL = "https://api.github.com/repos/hisXLNC/job-hunt-agent/releases?per_page=30"
	// Installers are only ever taken from here.
	downloadFrom = "https://github.com/hisXLNC/job-hunt-agent/releases/download/"
	setupName    = "JobHunt3-Setup.exe"
)

// Update is a newer version that can be installed.
type Update struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	Page    string `json:"page"`
	At      int64  `json:"at"`
	Notes   string `json:"notes"`  // what changed, as published with the release
	Digest  string `json:"digest"` // "sha256:…" of the installer, as published
	Size    int64  `json:"size"`
}

// NewerVersion is the update waiting, if there is one newer than this program.
func (e *Engine) NewerVersion() *Update {
	var u Update
	e.S.Get(updateKey, &u)
	if u.Version == "" || !newer(u.Version, e.Version) {
		return nil
	}
	return &u
}

// CheckUpdate asks whether a newer version has been published.
func (e *Engine) CheckUpdate(ctx context.Context) error {
	if _, ok := versionParts(e.Version); !ok {
		return nil // a build without a version (a trial, a test) never asks
	}
	from := e.UpdateURL
	if from == "" {
		from = releasesURL
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, "GET", from, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "JobHunt")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("update check: HTTP %d", resp.StatusCode)
	}
	var list []struct {
		Tag        string `json:"tag_name"`
		Page       string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name   string `json:"name"`
			URL    string `json:"browser_download_url"`
			Digest string `json:"digest"`
			Size   int64  `json:"size"`
		} `json:"assets"`
		Body string `json:"body"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&list); err != nil {
		return err
	}
	best := Update{}
	for _, r := range list {
		v := strings.TrimPrefix(r.Tag, "v")
		if r.Draft || r.Prerelease || !newer(v, e.Version) || (best.Version != "" && !newer(v, best.Version)) {
			continue
		}
		for _, a := range r.Assets {
			// What a release says is text from outside: the address must be
			// the one place installers come from.
			if a.Name == setupName && strings.HasPrefix(a.URL, e.downloadPrefix()) && strings.HasPrefix(r.Page, "https://github.com/hisXLNC/job-hunt-agent/") {
				notes := r.Body
				if len(notes) > 6000 {
					notes = notes[:6000]
				}
				best = Update{Version: v, URL: a.URL, Page: r.Page, At: e.Now().Unix(), Notes: notes, Digest: a.Digest, Size: a.Size}
			}
		}
	}
	had := e.NewerVersion()
	e.S.Set(updateKey, best)
	if (had == nil) != (best.Version == "") || (had != nil && had.Version != best.Version) {
		e.S.Changed("status")
	}
	e.S.Set("update:checked", e.Now().Unix())
	if best.Version != "" && e.AutoUpdate() && (e.CanInstall() || e.RunInstaller != nil) {
		e.InstallUpdate() // waits by itself while Job Hunt is busy
	}
	return nil
}

func (e *Engine) downloadPrefix() string {
	if e.UpdateDownload != "" {
		return e.UpdateDownload
	}
	return downloadFrom
}

// AutoUpdate says whether new versions are installed without asking. On unless turned off.
func (e *Engine) AutoUpdate() bool {
	var off bool
	e.S.Get("update:manual", &off)
	return !off
}

func (e *Engine) SetAutoUpdate(on bool) { e.S.Set("update:manual", !on); e.S.Changed("status") }

// UpdateChecked is when Job Hunt last looked for a newer version.
func (e *Engine) UpdateChecked() int64 { return e.S.GetInt("update:checked") }

// CanInstall says whether this program can install an update by itself (Windows, installed copy).
func (e *Engine) CanInstall() bool { return canRunInstaller() }

// InstallUpdate downloads the waiting version, checks it and runs its
// installer, which stops this program, replaces it and starts it again.
func (e *Engine) InstallUpdate() error {
	u := e.NewerVersion()
	if u == nil {
		return errors.New("There is no newer version to install.")
	}
	if !canRunInstaller() && e.RunInstaller == nil {
		return errors.New("This copy can't install updates by itself. Download the installer and run it.")
	}
	if !strings.HasPrefix(u.URL, e.downloadPrefix()) {
		return errors.New("The update's address is not where Job Hunt's installers come from.")
	}
	// Never in the middle of a search or of writing a CV: the update waits
	// for the work in hand, and nothing new is started meanwhile (see tick).
	if e.anyJobBut("update") {
		if e.UpdateWaiting() == "" {
			e.S.Set("update:waiting", updateWait{Version: u.Version, Since: e.Now().Unix()})
			e.S.Changed("status")
			trace.Log("app", "version %s waits for the work in hand to finish", u.Version)
		}
		return nil
	}
	e.S.Set("update:waiting", updateWait{})
	e.Go("update", "Installing version "+u.Version, func(ctx context.Context) error {
		e.StepTakes(ctx, 40*time.Second)
		e.Report(ctx, 0, 3, "Downloading")
		file, err := e.fetchInstaller(ctx, *u)
		if err != nil {
			return fmt.Errorf("the update could not be downloaded: %w", err)
		}
		// Something may have started while the installer was coming down.
		for i := 0; e.anyJobBut("update") && i < 900; i++ {
			e.Report(ctx, 1, 3, "Waiting for the work in hand to finish")
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(2 * time.Second):
			}
		}
		e.Report(ctx, 2, 3, "Starting the installer")
		e.S.Set("update:from", e.Version)
		e.Backup()
		trace.Log("app", "installing version %s from %s", u.Version, filepath.Base(file))
		run := e.RunInstaller
		if run == nil {
			run = runInstaller
		}
		if e.BeforeUpdate != nil {
			e.BeforeUpdate()
		}
		if err := run(file); err != nil {
			return fmt.Errorf("the installer could not be started: %w", err)
		}
		// The installer asks this program to stop, replaces it and starts it again.
		select {
		case <-ctx.Done():
		case <-time.After(90 * time.Second):
			return errors.New("the installer did not take over; download it and run it by hand")
		}
		return nil
	})
	return nil
}

// fetchInstaller downloads the installer into the data folder and checks it
// against what was published.
func (e *Engine) fetchInstaller(ctx context.Context, u Update) (string, error) {
	want, ok := strings.CutPrefix(u.Digest, "sha256:")
	if !ok || len(want) != 64 {
		return "", errors.New("the release does not say what its installer should be, so it can't be checked")
	}
	dir := filepath.Join(e.Dir, "updates")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	old, _ := filepath.Glob(filepath.Join(dir, "JobHunt3-Setup-*.exe"))
	for _, f := range old {
		os.Remove(f)
	}
	file := filepath.Join(dir, "JobHunt3-Setup-"+u.Version+".exe")
	cctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, "GET", u.URL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "JobHunt")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	out, err := os.OpenFile(file, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return "", err
	}
	sum := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, sum), io.LimitReader(resp.Body, 200<<20))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && hex.EncodeToString(sum.Sum(nil)) != strings.ToLower(want) {
		err = errors.New("the downloaded installer is not the file that was published")
	}
	if err == nil && n < 1<<20 && e.UpdateDownload == "" {
		err = errors.New("the downloaded installer is too small to be real")
	}
	if err != nil {
		os.Remove(file)
		return "", err
	}
	return file, nil
}

// WhatsNew is the version this program was updated from, once, so the
// person can be told what changed; "" when there is nothing to tell.
func (e *Engine) WhatsNew() string {
	var from string
	e.S.Get("update:from", &from)
	if from == "" || from == e.Version {
		return ""
	}
	return from
}

func (e *Engine) SawWhatsNew() { e.S.Set("update:from", ""); e.S.Changed("status") }

// versionParts reads "3.1.0" as three numbers.
func versionParts(v string) ([3]int, bool) {
	var out [3]int
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		if p == "" || len(p) > 6 {
			return out, false
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return out, false
			}
			out[i] = out[i]*10 + int(c-'0')
		}
	}
	return out, true
}

// newer reports whether version a comes after version b.
func newer(a, b string) bool {
	x, ok1 := versionParts(a)
	y, ok2 := versionParts(b)
	if !ok1 || !ok2 {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return x[i] > y[i]
		}
	}
	return false
}

type updateWait struct {
	Version string `json:"version"`
	Since   int64  `json:"since"`
}

// UpdateWaiting is the version that will be installed as soon as the work
// in hand is finished, or "". A wait is given up after three hours, so a
// job that never ends can't hold everything else back.
func (e *Engine) UpdateWaiting() string {
	var w updateWait
	e.S.Get("update:waiting", &w)
	if w.Version == "" {
		return ""
	}
	if u := e.NewerVersion(); u == nil || u.Version != w.Version || e.Now().Unix()-w.Since > 3*3600 {
		e.S.Set("update:waiting", updateWait{})
		return ""
	}
	return w.Version
}

// updateFirst is when a version was first found, so a reminder waits while
// it may still install by itself.
type updateFirst struct {
	Version string `json:"version"`
	At      int64  `json:"at"`
}

// remindUpdate tells the person once a day that a newer version is ready,
// until it is installed. When new versions install by themselves it first
// gives that a day.
func (e *Engine) remindUpdate(now time.Time) {
	u := e.NewerVersion()
	if u == nil || e.Busy("update") {
		return
	}
	var first updateFirst
	e.S.Get("update:first", &first)
	if first.Version != u.Version {
		first = updateFirst{Version: u.Version, At: now.Unix()}
		e.S.Set("update:first", first)
	}
	selfInstalls := e.AutoUpdate() && (e.CanInstall() || e.RunInstaller != nil)
	if selfInstalls && now.Unix()-first.At < 24*3600 {
		return
	}
	day := now.Format("2006-01-02")
	var told string
	e.S.Get("update:told", &told)
	if told == day {
		return
	}
	e.S.Set("update:told", day)
	text := "Install it under You, The app. It takes about a minute and your data stays."
	if !e.CanInstall() && e.RunInstaller == nil {
		text = "Download the installer under You, The app, and run it. Your data stays."
	}
	e.Tell("Job Hunt "+u.Version+" is ready to install", text, "#/you/app")
}
