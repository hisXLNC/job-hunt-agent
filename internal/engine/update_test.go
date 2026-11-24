package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestANewerVersionIsNoticed(t *testing.T) {
	e, _ := newEngine(t)
	list := `[
	 {"tag_name":"latest","html_url":"https://github.com/hisXLNC/job-hunt-agent/releases/tag/latest","assets":[{"name":"JobHunt-Setup.exe","browser_download_url":"https://github.com/hisXLNC/job-hunt-agent/releases/download/latest/JobHunt-Setup.exe"}]},
	 {"tag_name":"v3.2.0","html_url":"https://github.com/hisXLNC/job-hunt-agent/releases/tag/v3.2.0","assets":[{"name":"JobHunt3-Setup.exe","browser_download_url":"https://github.com/hisXLNC/job-hunt-agent/releases/download/v3.2.0/JobHunt3-Setup.exe"}]},
	 {"tag_name":"v3.10.0","html_url":"https://github.com/hisXLNC/job-hunt-agent/releases/tag/v3.10.0","draft":true,"assets":[{"name":"JobHunt3-Setup.exe","browser_download_url":"https://github.com/hisXLNC/job-hunt-agent/releases/download/v3.10.0/JobHunt3-Setup.exe"}]},
	 {"tag_name":"v9.0.0","html_url":"https://github.com/hisXLNC/job-hunt-agent/releases/tag/v9.0.0","assets":[{"name":"JobHunt3-Setup.exe","browser_download_url":"https://elsewhere.example/JobHunt3-Setup.exe"}]},
	 {"tag_name":"v3.1.5","html_url":"https://github.com/hisXLNC/job-hunt-agent/releases/tag/v3.1.5","assets":[{"name":"JobHunt3-Setup.exe","browser_download_url":"https://github.com/hisXLNC/job-hunt-agent/releases/download/v3.1.5/JobHunt3-Setup.exe"}]}
	]`
	asked := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		w.Write([]byte(list))
	}))
	defer srv.Close()
	e.UpdateURL = srv.URL

	// A build without a version never asks.
	e.Version = "preview"
	if err := e.CheckUpdate(context.Background()); err != nil || asked != 0 || e.NewerVersion() != nil {
		t.Fatalf("a trial build asked: %v %d", err, asked)
	}

	e.Version = "3.1.5"
	if err := e.CheckUpdate(context.Background()); err != nil {
		t.Fatal(err)
	}
	u := e.NewerVersion()
	// Not the draft, not the one whose installer is kept somewhere else, not the old app's.
	if u == nil || u.Version != "3.2.0" || u.URL != "https://github.com/hisXLNC/job-hunt-agent/releases/download/v3.2.0/JobHunt3-Setup.exe" {
		t.Fatalf("update: %+v", u)
	}

	// Once installed, there is nothing more to say.
	e.Version = "3.2.0"
	if e.NewerVersion() != nil {
		t.Fatal("still offering the version that is running")
	}
	if !newer("3.10.0", "3.9.9") || newer("3.1.0", "3.1.0") || newer("26.11.21", "preview") || newer("x", "3.0.0") {
		t.Fatal("version order")
	}
}

func TestAnUpdateIsCheckedBeforeItIsRun(t *testing.T) {
	e, _ := newEngine(t)
	installer := []byte("MZ this stands in for the installer")
	sum := sha256.Sum256(installer)
	good := "sha256:" + hex.EncodeToString(sum[:])
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(installer) }))
	defer srv.Close()
	e.UpdateDownload = srv.URL + "/"
	e.Version = "26.11.24"
	ran := make(chan string, 1)
	e.RunInstaller = func(file string) error { ran <- file; return nil }

	// A file that is not the one published is never run.
	e.S.Set(updateKey, Update{Version: "26.11.25", URL: srv.URL + "/v26.11.25/JobHunt3-Setup.exe", Digest: "sha256:" + strings.Repeat("0", 64)})
	if _, err := e.fetchInstaller(context.Background(), *e.NewerVersion()); err == nil {
		t.Fatal("an installer with the wrong contents was accepted")
	}
	// Nor one the release says nothing about, nor one from somewhere else.
	e.S.Set(updateKey, Update{Version: "26.11.25", URL: srv.URL + "/v26.11.25/JobHunt3-Setup.exe"})
	if _, err := e.fetchInstaller(context.Background(), *e.NewerVersion()); err == nil {
		t.Fatal("an installer that could not be checked was accepted")
	}
	e.S.Set(updateKey, Update{Version: "26.11.25", URL: "https://elsewhere.example/JobHunt3-Setup.exe", Digest: good})
	if err := e.InstallUpdate(); err == nil {
		t.Fatal("an installer from somewhere else was accepted")
	}

	e.S.Set(updateKey, Update{Version: "26.11.25", URL: srv.URL + "/v26.11.25/JobHunt3-Setup.exe", Digest: good})
	if err := e.InstallUpdate(); err != nil {
		t.Fatal(err)
	}
	select {
	case file := <-ran:
		b, err := os.ReadFile(file)
		if err != nil || string(b) != string(installer) {
			t.Fatalf("the installer that was run: %v %q", err, b)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the installer was never run")
	}
	e.StopJob("update")
	// Back on the new version, the person is told once what changed.
	e.Version = "26.11.25"
	if e.WhatsNew() != "26.11.24" {
		t.Fatalf("what's new from %q", e.WhatsNew())
	}
	e.SawWhatsNew()
	if e.WhatsNew() != "" {
		t.Fatal("told twice")
	}
}

func TestAnUpdateWaitsForTheWorkInHand(t *testing.T) {
	e, _ := newEngine(t)
	installer := []byte("MZ this stands in for the installer")
	sum := sha256.Sum256(installer)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(installer) }))
	defer srv.Close()
	e.UpdateDownload = srv.URL + "/"
	e.Version = "26.11.24"
	ran := make(chan string, 1)
	e.RunInstaller = func(file string) error { ran <- file; return nil }
	e.S.Set(updateKey, Update{Version: "26.11.25", URL: srv.URL + "/v26.11.25/JobHunt3-Setup.exe", Digest: "sha256:" + hex.EncodeToString(sum[:])})

	// A search is under way.
	done := make(chan struct{})
	e.Go("search", "Searching every source", func(ctx context.Context) error { <-done; return nil })
	if err := e.InstallUpdate(); err != nil {
		t.Fatal(err)
	}
	if e.UpdateWaiting() != "26.11.25" || e.Busy("update") {
		t.Fatal("the update didn't wait for the search")
	}
	e.tick() // still searching: nothing happens
	select {
	case <-ran:
		t.Fatal("the installer ran during a search")
	case <-time.After(300 * time.Millisecond):
	}
	close(done)
	for i := 0; i < 100 && e.Busy("search"); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	e.tick()
	select {
	case <-ran:
	case <-time.After(5 * time.Second):
		t.Fatal("the installer never ran once the search had finished")
	}
	if e.UpdateWaiting() != "" {
		t.Fatal("still marked as waiting")
	}
	e.StopJob("update")
}

func TestASearchCutShortIsPickedUpAtTheNextStart(t *testing.T) {
	e, _ := newEngine(t)
	e.resumeSearch()
	if e.Busy("search") {
		t.Fatal("a search started with nothing to pick up")
	}
	p := e.S.Profile()
	p.City, p.Country, p.SetupDone = "Toronto", "Canada", true
	if err := e.S.SaveProfile(p); err != nil {
		t.Fatal(err)
	}
	e.S.Set("search:open", "full")
	e.resumeSearch()
	if !e.Busy("search") {
		t.Fatal("the search that was cut short was not picked up")
	}
	for i := 0; i < 500 && e.Busy("search"); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	var open string
	e.S.Get("search:open", &open)
	if open != "" {
		t.Fatal("a search that finished is still marked as cut short")
	}
}
