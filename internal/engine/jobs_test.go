package engine

import (
	"context"
	"testing"
	"time"
)

func TestAJobShowsProgressAndCanBeStopped(t *testing.T) {
	e, _ := newEngine(t)
	started, ended := make(chan struct{}), make(chan error, 1)
	if !e.Go("search", "Searching every source", func(ctx context.Context) error {
		e.Report(ctx, 3, 12, "Acme Corp")
		close(started)
		<-ctx.Done()
		ended <- ctx.Err()
		return ctx.Err()
	}) {
		t.Fatal("the job did not start")
	}
	<-started
	jobs := e.Jobs()
	if len(jobs) != 1 || jobs[0].Name != "search" || jobs[0].Step != "Acme Corp" || jobs[0].Percent < 25 || jobs[0].Percent > 33 {
		t.Fatalf("jobs: %+v", jobs)
	}
	if e.heldBack("search") {
		t.Fatal("held before anyone stopped it")
	}
	if n := e.StopJob("search"); n != 1 {
		t.Fatalf("stopped %d jobs", n)
	}
	select {
	case <-ended:
	case <-time.After(2 * time.Second):
		t.Fatal("the job kept running after it was stopped")
	}
	for i := 0; i < 200 && e.Busy("search"); i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if e.Busy("search") || len(e.Jobs()) != 0 {
		t.Fatal("the stopped job is still listed")
	}
	// The program does not start it again behind the person's back; they can.
	if !e.heldBack("search") {
		t.Fatal("a stopped search would start again by itself at once")
	}
	e.Resume("search")
	if e.heldBack("search") {
		t.Fatal("still held after the person asked for it")
	}
	// Stopping is not a problem to report.
	if n := e.S.Count(`SELECT COUNT(*) FROM activity WHERE kind = 'problem'`); n != 0 {
		t.Fatalf("%d problems logged for a stop", n)
	}
}
