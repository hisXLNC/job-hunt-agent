package engine

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/store"
)

func indeedRowOf(e *Engine) MoreSource {
	for _, m := range e.MoreSources() {
		if m.ID == srcIndeed {
			return m
		}
	}
	return MoreSource{}
}

// Indeed through the Claude connector: only with Claude Code, only when the
// person turns it on, only Indeed's tools allowed, nothing about the person
// sent, and every posting checked before it is kept. Nothing real is run:
// the stand-in answers for Claude Code.
func TestIndeedThroughClaude(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	on := true

	// With sample answers (or an API key) it can't be turned on, and says why.
	if err := e.SetSource(srcIndeed, SourceKeyInput{On: &on}); err == nil || !strings.Contains(err.Error(), "Claude Code") {
		t.Fatalf("turning Indeed on without Claude Code: %v", err)
	}
	if m := indeedRowOf(e); m.State != "none" || m.On {
		t.Errorf("row without Claude Code: %+v", m)
	}

	stand := brain.StandIn()
	var mu sync.Mutex
	var asked []llm.Request
	connected := true
	e.CLIStandIn = llm.Func(func(ctx context.Context, req llm.Request) (llm.Response, error) {
		if req.Task == "indeed_search" {
			mu.Lock()
			asked = append(asked, req)
			ok := connected
			mu.Unlock()
			if !ok {
				return llm.Response{Text: `{"connected":false,"note":"No Indeed tool is available.","jobs":[]}`}, nil
			}
		}
		return stand.Do(ctx, req)
	})
	set := e.LLM()
	set.Engine = "claude-code"
	e.SetLLM(set)

	// Off until the person turns it on.
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	if len(asked) != 0 {
		t.Fatal("Indeed must not be searched until the person turns it on")
	}
	if m := indeedRowOf(e); m.State != "off" {
		t.Errorf("row before it is on: %+v", m)
	}
	if err := e.SetSource(srcIndeed, SourceKeyInput{On: &on}); err != nil {
		t.Fatal(err)
	}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	if len(asked) == 0 || len(asked) > indeedPerSearch {
		t.Fatalf("Indeed searches: %d", len(asked))
	}
	req := asked[0]
	if strings.Contains(req.System, "Sam Rivera") || strings.Contains(req.System, "Northwind Group") || strings.Contains(req.Prompt, "Northwind Group") {
		t.Error("nothing about the person goes with an Indeed search")
	}
	for _, tool := range req.Tools {
		if !strings.Contains(tool, "Indeed__") {
			t.Errorf("only Indeed's tools may be allowed, got %q", tool)
		}
	}
	if len(req.Tools) == 0 || req.Web {
		t.Error("the request names Indeed's tools and nothing else")
	}
	roles, _, _ := e.S.Roles(store.RoleFilter{Closed: []string{"*"}, Unread: true, Limit: 50})
	var got store.Role
	for _, r := range roles {
		if r.Source == srcIndeed {
			got = r
		}
	}
	if got.ID == 0 || got.Key != "alert:indeed:0a1b2c3d4e5f6a7b" || got.URL != "https://ca.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b" || got.Company != "Northwind Ledger" {
		t.Fatalf("the Indeed posting: %+v", got)
	}
	if m := indeedRowOf(e); m.State != "working" || m.Seen == 0 {
		t.Errorf("row after a search: %+v", m)
	}

	// The connector not there: said plainly, with what to do.
	connected = false
	e.setSourceState(srcIndeed, func(s *SourceState) { s.Used = 0 })
	e.Search(ctx, "full")
	m := indeedRowOf(e)
	if m.State != "problem" || !strings.Contains(m.Note, "Settings, Connectors") {
		t.Errorf("row with no connector: %+v", m)
	}
	n := len(asked)
	e.Search(ctx, "full")
	if len(asked) != n {
		t.Error("after a missing connector Indeed rests until later")
	}
}

// Every posting from Indeed is checked: it needs a title and an employer and
// a link to Indeed itself; anything else is dropped.
func TestIndeedPostingChecks(t *testing.T) {
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	good := brain.IndeedJob{JobID: "x", Title: "Tax Manager", Company: "Acme", URL: "https://www.indeed.com/viewjob?jk=ABCDEF1234567890&from=x", Posted: "3 days ago"}
	p, ok := indeedPosting(good, now)
	if !ok || p.Key != "alert:indeed:abcdef1234567890" || p.URL != "https://www.indeed.com/viewjob?jk=abcdef1234567890" || !p.PostedAt.Equal(now.Add(-72*time.Hour)) || !p.NeedsDetail {
		t.Errorf("good posting: %+v %v", p, ok)
	}
	for name, j := range map[string]brain.IndeedJob{
		"another site":  {Title: "Tax Manager", Company: "Acme", URL: "https://evil.example/viewjob?jk=abcdef1234567890"},
		"look-alike":    {Title: "Tax Manager", Company: "Acme", URL: "https://indeed.com.evil.example/viewjob?jk=abcdef1234567890"},
		"no title":      {Company: "Acme", URL: "https://www.indeed.com/viewjob?jk=abcdef1234567890"},
		"no employer":   {Title: "Tax Manager", URL: "https://www.indeed.com/viewjob?jk=abcdef1234567890"},
		"script in id":  {Title: "Tax Manager", Company: "Acme", JobID: "javascript:alert(1)"},
		"no id at all":  {Title: "Tax Manager", Company: "Acme", URL: "https://www.indeed.com/jobs?q=tax"},
		"bad link form": {Title: "Tax Manager", Company: "Acme", URL: "javascript:alert('https://www.indeed.com/viewjob?jk=abcdef1234567890')"},
	} {
		if p, ok := indeedPosting(j, now); ok {
			t.Errorf("%s was kept: %+v", name, p)
		}
	}
	// An id alone is enough: the link is made from it.
	if p, ok := indeedPosting(brain.IndeedJob{Title: "Tax Manager", Company: "Acme", JobID: "1234567890abcdef"}, now); !ok || p.URL != "https://www.indeed.com/viewjob?jk=1234567890abcdef" {
		t.Errorf("id alone: %+v %v", p, ok)
	}
	if !postedWhen("Just posted", now).Equal(now) || !postedWhen("2026-11-20", now).Equal(time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)) || !postedWhen("soon", now).IsZero() {
		t.Error("posted dates")
	}
}
