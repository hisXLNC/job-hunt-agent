package engine

import (
	"context"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/store"
)

// Everything Job Hunt does in the background is a job: it has a name, says
// what it is doing and how far along it is, and can be stopped by the person.

type task struct {
	name, doing string
	step        string
	done, total int
	pct         int // set outright by jobs that measure themselves; -1 otherwise
	started     time.Time
	stepAt      time.Time
	each        time.Duration // about how long one step takes
	cancel      context.CancelFunc
	stopped     bool
	said        time.Time
}

type jobKey struct{}

// JobView is a running job as the pages show it.
type JobView struct {
	Name    string `json:"name"`
	Doing   string `json:"doing"`
	Step    string `json:"step,omitempty"`
	Percent int    `json:"percent"`
	Started int64  `json:"started"`
}

// How long Job Hunt leaves something alone after the person stopped it,
// before starting it again by itself.
const stopHold = 30 * time.Minute

func (e *Engine) startJob(parent context.Context, name, doing string) (context.Context, *task, bool) {
	e.mu.Lock()
	if e.busy[name] {
		e.mu.Unlock()
		return nil, nil, false
	}
	ctx, cancel := context.WithCancel(parent)
	now := time.Now()
	j := &task{name: name, doing: doing, pct: -1, started: now, stepAt: now, each: 20 * time.Second, cancel: cancel}
	e.busy[name] = true
	e.jobs[name] = j
	if doing != "" {
		e.doing = doing
	}
	e.mu.Unlock()
	e.S.Changed("status")
	return context.WithValue(ctx, jobKey{}, j), j, true
}

func (e *Engine) endJob(j *task) {
	e.mu.Lock()
	delete(e.busy, j.name)
	delete(e.jobs, j.name)
	if e.doing == j.doing {
		e.doing = ""
		for _, o := range e.jobs {
			if o.doing != "" {
				e.doing = o.doing
			}
		}
	}
	stopped := j.stopped
	e.mu.Unlock()
	j.cancel()
	if stopped && j.doing != "" {
		e.S.Log(store.Activity{Kind: "stopped", Text: "You stopped: " + strings.ToLower(j.doing[:1]) + j.doing[1:]})
	}
	e.S.Changed("status", "today")
}

// Report says how far the job running in ctx has got: done of total, and
// what it is on now. Outside a job it does nothing.
func (e *Engine) Report(ctx context.Context, done, total int, step string) {
	j, _ := ctx.Value(jobKey{}).(*task)
	if j == nil {
		return
	}
	e.mu.Lock()
	j.done, j.total, j.step, j.stepAt, j.pct = done, total, step, time.Now(), -1
	tell := time.Since(j.said) > 400*time.Millisecond
	if tell {
		j.said = time.Now()
	}
	e.mu.Unlock()
	if tell {
		e.S.Changed("status")
	}
}

// StepTakes says about how long each step of the job in ctx takes, so the
// bar moves at an honest pace while one is under way.
func (e *Engine) StepTakes(ctx context.Context, d time.Duration) {
	if j, _ := ctx.Value(jobKey{}).(*task); j != nil && d > 0 {
		e.mu.Lock()
		j.each = d
		e.mu.Unlock()
	}
}

func (e *Engine) setPercent(ctx context.Context, pc int, step string) {
	if j, _ := ctx.Value(jobKey{}).(*task); j != nil {
		e.mu.Lock()
		j.pct, j.step = pc, step
		e.mu.Unlock()
	}
}

// percent is how far along a job is. A step under way counts for part of
// itself, more the longer it has run, and never quite all.
func (j *task) percent(now time.Time) int {
	if j.pct >= 0 {
		return min(j.pct, 100)
	}
	total, done := j.total, j.done
	if total <= 0 {
		total, done = 1, 0
	}
	within := 0.0
	if done < total {
		el := now.Sub(j.stepAt).Seconds()
		within = 0.92 * (1 - 1/(1+el/max(j.each.Seconds(), 1)))
	}
	pc := int((float64(done) + within) / float64(total) * 100)
	return max(1, min(pc, 99))
}

// Jobs lists what is running now, oldest first.
func (e *Engine) Jobs() []JobView {
	now := time.Now()
	e.mu.Lock()
	out := make([]JobView, 0, len(e.jobs))
	for _, j := range e.jobs {
		if j.doing == "" {
			continue // small housekeeping the person need not watch
		}
		out = append(out, JobView{Name: j.name, Doing: j.doing, Step: j.step, Percent: j.percent(now), Started: j.started.Unix()})
	}
	e.mu.Unlock()
	sort.Slice(out, func(a, b int) bool {
		return out[a].Started < out[b].Started || (out[a].Started == out[b].Started && out[a].Name < out[b].Name)
	})
	return out
}

// StopJob stops a running job; an empty name stops everything. Work that
// Job Hunt starts by itself is then left alone for half an hour.
func (e *Engine) StopJob(name string) int {
	until := e.Now().Add(stopHold)
	n := 0
	e.mu.Lock()
	for k, j := range e.jobs {
		if name != "" && k != name {
			continue
		}
		j.stopped = true
		j.cancel()
		kind, _, _ := strings.Cut(k, ":")
		e.held[kind] = until
		n++
	}
	e.mu.Unlock()
	if n > 0 {
		e.S.Changed("status")
	}
	return n
}

// held reports whether the person stopped this kind of work a short while
// ago, so the program does not start it again behind their back.
func (e *Engine) heldBack(kind string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	t, ok := e.held[kind]
	if !ok {
		return false
	}
	if e.Now().After(t) {
		delete(e.held, kind)
		return false
	}
	return true
}

// Resume forgets a stop, when the person asks for the work themselves.
func (e *Engine) Resume(kind string) {
	e.mu.Lock()
	delete(e.held, kind)
	e.mu.Unlock()
}
