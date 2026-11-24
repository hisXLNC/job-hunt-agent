package engine

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
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
