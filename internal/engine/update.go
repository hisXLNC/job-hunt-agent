package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Job Hunt looks once a day for a newer version of itself. It only tells the
// person; they download the installer and run it. The request carries
// nothing about them.

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
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
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
			if a.Name == setupName && strings.HasPrefix(a.URL, downloadFrom) && strings.HasPrefix(r.Page, "https://github.com/hisXLNC/job-hunt-agent/") {
				best = Update{Version: v, URL: a.URL, Page: r.Page, At: e.Now().Unix()}
			}
		}
	}
	had := e.NewerVersion()
	e.S.Set(updateKey, best)
	if (had == nil) != (best.Version == "") || (had != nil && had.Version != best.Version) {
		e.S.Changed("status")
	}
	return nil
}

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
