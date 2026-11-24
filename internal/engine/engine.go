// Package engine is what Job Hunt does: taking in a CV, searching, reading
// roles, preparing documents, and deciding what to put in front of the person.
package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/cv"
	"jobhunt/internal/llm"
	"jobhunt/internal/office"
	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

// Engine ties the store, Claude and the job sources together.
type Engine struct {
	S   *store.Store
	Src *sources.Client
	Dir string // the data folder

	Version   string // this program's version; empty or a word for a build without one
	UpdateURL string // where newer versions are listed (tests point it elsewhere)
	Now       func() time.Time

	meter *llm.Metered
	brain *brain.Brain

	mu      sync.Mutex
	busy    map[string]bool // background jobs running now, by name
	doing   string          // what Job Hunt is doing, in words
	preps   map[int64]bool  // roles being prepared
	stopAll context.CancelFunc
	ctx     context.Context

	mailDial func(ctx context.Context, host string) (net.Conn, error) // tests replace it

	oldMu     sync.Mutex // one import from the old Job Hunt at a time
	oldSeen   *OldLook   // the last look at the old data on this computer, kept a minute
	oldSeenAt time.Time
	oldStep   OldStep // how far the bringing over has got

	// Sample answers in place of Claude when the engine is "demo". Tests set
	// it to script what Claude says; nil means the built-in stand-in.
	Sample llm.Engine
}

// LLMSettings is how Claude is reached.
type LLMSettings struct {
	Engine string `json:"engine"` // "", "claude-code", "api", "demo"
	Key    string `json:"key,omitempty"`
	Model  string `json:"model"`
	CLI    string `json:"cli"`
	// DailyLimit caps spending per day in dollars when using an API key. 0 = none.
	DailyLimit float64 `json:"daily_limit"`
}

// New builds an engine over an open store.
func New(s *store.Store, dir string) *Engine {
	e := &Engine{S: s, Dir: dir, Now: time.Now, Src: &sources.Client{}, busy: map[string]bool{}, preps: map[int64]bool{}}
	e.ctx, e.stopAll = context.WithCancel(context.Background())
	e.meter = &llm.Metered{
		Pick: e.pickEngine,
		Record: func(task, engine, model string, in, out, cached int64, cost float64, ms int64, errText string) {
			s.LogCall(store.Call{Task: task, Engine: engine, Model: model, TokensIn: in, TokensOut: out, TokensCached: cached, Cost: cost, Ms: ms, Error: errText})
		},
		Budget: func() float64 {
			set := e.LLM()
			if set.Engine != "api" || set.DailyLimit <= 0 {
				return -1
			}
			spent := s.UsageSince(dayStart(e.Now()).Unix()).Cost
			return max(set.DailyLimit-spent, 0)
		},
	}
	e.brain = &brain.Brain{LLM: e.meter}
	s.CloseStaleRuns()
	return e
}

// Stop cancels everything running in the background.
func (e *Engine) Stop() { e.stopAll() }

func dayStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

// LLM returns how Claude is reached.
func (e *Engine) LLM() LLMSettings {
	var set LLMSettings
	e.S.Get("llm", &set)
	if set.Model == "" {
		set.Model = llm.DefaultModel
	}
	return set
}

// SetLLM changes how Claude is reached.
func (e *Engine) SetLLM(set LLMSettings) error {
	if err := e.S.Set("llm", set); err != nil {
		return err
	}
	e.meter.Wake()
	e.S.Changed("connections", "today")
	return nil
}

func (e *Engine) pickEngine() (llm.Engine, error) {
	set := e.LLM()
	switch set.Engine {
	case "api":
		return &llm.API{Key: set.Key, Model: set.Model}, nil
	case "claude-code":
		return &llm.CLI{Path: set.CLI, Model: set.Model, Dir: filepath.Join(e.Dir, "claude")}, nil
	case "demo":
		if e.Sample != nil {
			return e.Sample, nil
		}
		return brain.StandIn(), nil
	}
	return nil, llm.ErrNotConnected
}

// ClaudeState says, in words, whether Claude can be reached right now.
type ClaudeState struct {
	Engine  string  `json:"engine"`
	Model   string  `json:"model"`
	OK      bool    `json:"ok"`
	Note    string  `json:"note"`
	Until   int64   `json:"until,omitempty"`
	Today   float64 `json:"today"`
	Week    float64 `json:"week"`
	Calls   int     `json:"calls"`
	HasKey  bool    `json:"has_key"`
	Limit   float64 `json:"limit"`
	CLIPath string  `json:"cli_path"`
}

func (e *Engine) Claude() ClaudeState {
	set := e.LLM()
	st := ClaudeState{Engine: set.Engine, Model: set.Model, HasKey: set.Key != "", Limit: set.DailyLimit, CLIPath: set.CLI}
	now := e.Now()
	u := e.S.UsageSince(dayStart(now).Unix())
	st.Today, st.Calls = u.Cost, u.Calls
	st.Week = e.S.UsageSince(now.Add(-7 * 24 * time.Hour).Unix()).Cost
	switch {
	case set.Engine == "":
		st.Note = "Not connected yet"
	default:
		st.OK = true
		if rest, msg, until := e.meter.Resting(); rest {
			st.OK, st.Note, st.Until = false, msg, until.Unix()
		}
	}
	return st
}

// TestClaude asks Claude one tiny question to prove the connection works.
func (e *Engine) TestClaude(ctx context.Context) (string, error) {
	e.meter.Wake()
	type ans struct {
		Word string `json:"word"`
	}
	out, resp, err := llm.JSON[ans](ctx, e.meter, llm.Request{
		Task: "test", System: "You are a connection test.", Prompt: "Reply with the single word: ready",
		Schema: llm.Obj("word", llm.Str("the word")), Effort: "low", MaxTokens: 200,
		Input: "test",
	})
	if err != nil {
		if e.LLM().Engine == "demo" {
			return "The stand-in is answering (no Claude account in use).", nil
		}
		return "", err
	}
	return fmt.Sprintf("Claude answered %q using %s.", out.Word, resp.Model), nil
}

// ---- background jobs ----------------------------------------------------------

// Go runs a named job in the background unless one with that name is running.
func (e *Engine) Go(name, doing string, fn func(ctx context.Context) error) bool {
	e.mu.Lock()
	if e.busy[name] {
		e.mu.Unlock()
		return false
	}
	e.busy[name] = true
	if doing != "" {
		e.doing = doing
	}
	e.mu.Unlock()
	e.S.Changed("status")
	go func() {
		defer func() {
			if r := recover(); r != nil {
				e.S.Log(store.Activity{Kind: "problem", Text: fmt.Sprintf("Something went wrong while %s: %v", strings.ToLower(doing), r)})
			}
			e.mu.Lock()
			delete(e.busy, name)
			if e.doing == doing {
				e.doing = ""
			}
			e.mu.Unlock()
			e.S.Changed("status", "today")
		}()
		if err := fn(e.ctx); err != nil && !errors.Is(err, context.Canceled) {
			e.problem(doing, err)
		}
	}()
	return true
}

// problem records a failure once, in plain words, and tells the person what
// to do when there is something they can do.
func (e *Engine) problem(doing string, err error) {
	var lim *llm.LimitError
	var auth *llm.AuthError
	text := fmt.Sprintf("%s didn't finish: %v", doing, err)
	switch {
	case errors.Is(err, llm.ErrNotConnected):
		text = doing + " is waiting: connect Claude under You → Connections"
	case errors.As(err, &lim):
		text = doing + " is paused: " + lim.Msg
	case errors.As(err, &auth):
		text = doing + " stopped: " + auth.Msg
	}
	// Say each thing once an hour at most.
	since := e.Now().Add(-time.Hour).Unix()
	recent, _ := e.S.ActivityList(store.ActivityFilter{Since: since, Kinds: []string{"problem"}, Limit: 50})
	for _, a := range recent {
		if a.Text == text {
			return
		}
	}
	e.S.Log(store.Activity{Kind: "problem", Text: text})
}

// Busy reports whether a named job is running.
func (e *Engine) Busy(name string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.busy[name]
}

// Status is what Job Hunt is doing now and when it looks next.
type Status struct {
	Doing    string   `json:"doing"`
	Busy     []string `json:"busy"`
	NextFast int64    `json:"next_fast"`
	NextFull int64    `json:"next_full"`
	Paused   bool     `json:"paused"`
	Sources  int      `json:"sources"`
}

func (e *Engine) Status() Status {
	e.mu.Lock()
	st := Status{Doing: e.doing}
	for k := range e.busy {
		st.Busy = append(st.Busy, k)
	}
	e.mu.Unlock()
	st.Paused = e.Paused()
	st.NextFast, st.NextFull = e.nextTimes()
	st.Sources = e.S.Count(`SELECT COUNT(*) FROM companies WHERE state = 'following' AND board_kind != ''`)
	// Each title on each title search is a place looked at, and so is each site.
	p, ps := e.S.Profile(), e.placeSet()
	for _, id := range finders(p) {
		if !ps.off(id) {
			st.Sources += len(p.Titles.All())
		}
	}
	for _, site := range ps.Sites {
		if !site.Off {
			st.Sources++
		}
	}
	return st
}

// ---- the person ------------------------------------------------------------------

// Person gathers what Claude is told about the person.
func (e *Engine) Person() brain.Person {
	cvs, _ := e.S.CVs()
	facts, _ := e.S.Facts()
	return brain.Person{Profile: e.S.Profile(), CVs: cvs, Facts: facts, Today: e.Now()}
}

// AddCV takes in a CV file: reads it, structures it, and, for the first one,
// proposes who the person is and what to look for.
func (e *Engine) AddCV(ctx context.Context, filename string, data []byte) (store.CV, *brain.Proposal, error) {
	text, err := office.ExtractText(filename, data)
	if err != nil {
		return store.CV{}, nil, err
	}
	if len(strings.Fields(text)) < 60 {
		return store.CV{}, nil, errors.New("that file has very little text in it. Is it the right one?")
	}
	prof := e.S.Profile()

	var wg sync.WaitGroup
	var model cv.CV
	var prop brain.Proposal
	var merr, perr error
	wg.Add(2)
	go func() { defer wg.Done(); model, merr = e.brain.StructureCV(ctx, text) }()
	go func() {
		defer wg.Done()
		prop, perr = e.brain.Propose(ctx, text, strings.TrimSpace(prof.City+" "+prof.Country))
	}()
	wg.Wait()
	if merr != nil {
		return store.CV{}, nil, merr
	}
	if perr != nil {
		return store.CV{}, nil, perr
	}
	mb, _ := json.Marshal(model)
	name := strings.TrimSuffix(filepath.Base(strings.ReplaceAll(filename, `\`, "/")), filepath.Ext(filename))
	if prop.Focus != "" {
		name = strings.ToUpper(prop.Focus[:1]) + prop.Focus[1:] + " CV"
	}
	c := store.CV{Name: name, Filename: filename, Text: text, Model: mb, Focus: prop.Focus}
	id, err := e.S.AddCV(c, data)
	if err != nil {
		return store.CV{}, nil, err
	}
	c.ID = id
	e.S.Log(store.Activity{Kind: "cv", Text: fmt.Sprintf("Read your CV %q", filename)})

	// The first CV fills in whatever the profile doesn't have yet.
	if prof.Name == "" {
		prof.Name = firstOf(prop.Name, model.Name)
	}
	if prof.Headline == "" {
		prof.Headline, prof.Summary, prof.Years = prop.Headline, prop.Summary, prop.Years
		prof.Strengths, prof.Rare = prop.Strengths, prop.Rare
	}
	if prof.Home == "" {
		prof.Home = prop.Home
	}
	if len(prof.Titles.All()) == 0 {
		prof.Titles = store.Titles{Level: prop.Level, StepUp: prop.StepUp, Sideways: prop.Sideways}
		prof.Domain = lowerAll(prop.Domain)
	}
	if err := e.S.SaveProfile(prof); err != nil {
		return c, &prop, err
	}
	return c, &prop, nil
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func lowerAll(in []string) []string {
	var out []string
	for _, s := range in {
		if s = strings.ToLower(strings.TrimSpace(s)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// CVModel returns a stored CV in structured form.
func (e *Engine) CVModel(id int64) (cv.CV, error) {
	c, err := e.S.CV(id)
	if err != nil {
		return cv.CV{}, err
	}
	var m cv.CV
	if err := json.Unmarshal(c.Model, &m); err != nil {
		return cv.CV{}, err
	}
	return m, nil
}

// FinishSetup marks setup done and starts the first search.
func (e *Engine) FinishSetup() error {
	p := e.S.Profile()
	if p.City == "" {
		return errors.New("say where you want to work first")
	}
	if len(p.Titles.All()) == 0 {
		return errors.New("add at least one job title to look for")
	}
	p.SetupDone = true
	if err := e.S.SaveProfile(p); err != nil {
		return err
	}
	e.askBasics()
	e.Go("employers", "Finding employers that hire people like you", func(ctx context.Context) error {
		if err := e.SeedEmployers(ctx, 24); err != nil {
			e.problem("Finding employers", err)
		}
		return nil
	})
	e.StartSearch("full")
	return nil
}

// askBasics queues the questions every application form asks, once.
func (e *Engine) askBasics() {
	p := e.S.Profile()
	where := firstOf(p.Country, p.City, "there")
	if p.WorkStatus == "" {
		e.S.Ask(store.Question{Key: "work_status", Weight: 100,
			Text:    "Every form asks whether you can legally work in " + where + ", and recruiters filter on it. What's true for you" + map[bool]string{true: " on arrival", false: ""}[p.ArriveOn != ""] + "?",
			Why:     "Until I know, I leave that question blank on every form.",
			Options: []string{"Citizen", "Permanent resident", "Work permit", "Not yet"}})
	}
	if p.PayFloor == 0 {
		e.S.Ask(store.Question{Key: "pay_floor", Weight: 60,
			Text: "What's the lowest yearly pay you'd accept? I use it to skip roles below it and to answer salary questions.",
			Why:  "Type a number, like 120000."})
	}
	if p.ArriveOn != "" && !p.StartEarly {
		e.S.Ask(store.Question{Key: "start_early", Weight: 50,
			Text:    "Would you start a job remotely before you arrive?",
			Why:     "If yes, letters say so, which removes the main reason to pass on someone who hasn't landed.",
			Options: []string{"Yes", "No"}})
	}
}

// Answer applies the person's answer to a queued question.
func (e *Engine) Answer(id int64, answer string) error {
	q, err := e.S.Question(id)
	if err != nil {
		return err
	}
	answer = strings.TrimSpace(answer)
	p := e.S.Profile()
	low := strings.ToLower(answer)
	switch q.Key {
	case "work_status":
		switch {
		case strings.Contains(low, "citizen"):
			p.WorkStatus = "citizen"
		case strings.Contains(low, "resident"):
			p.WorkStatus = "resident"
		case strings.Contains(low, "permit"):
			p.WorkStatus = "permit"
		default:
			p.WorkStatus = "none"
		}
		e.S.SaveProfile(p)
		yes := map[string]string{"citizen": "Yes", "resident": "Yes", "permit": "Yes", "none": "No"}[p.WorkStatus]
		e.S.SaveAnswer("Are you legally authorized to work in "+firstOf(p.Country, "this country")+"?", yes)
		if p.WorkStatus != "none" {
			e.S.SaveAnswer("Will you now or in the future require sponsorship for employment visa status?", "No")
		}
	case "pay_floor":
		n := 0
		for _, r := range answer {
			if r >= '0' && r <= '9' {
				n = n*10 + int(r-'0')
			}
		}
		if n > 0 && n < 1000 {
			n *= 1000
		}
		if n == 0 {
			return errors.New("type a number, like 120000")
		}
		p.PayFloor = n
		if p.PayUnit == "" {
			p.PayUnit = "a year"
		}
		e.S.SaveProfile(p)
	case "start_early":
		p.StartEarly = strings.HasPrefix(low, "y")
		e.S.SaveProfile(p)
	default:
		// A question tailoring asked: the answer is a fact worth keeping.
		if answer != "" {
			e.S.AddFact(strings.TrimSuffix(q.Text, "?")+": "+answer, "your answer")
		}
	}
	return e.S.AnswerQuestion(id, answer)
}
