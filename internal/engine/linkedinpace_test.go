package engine

import (
	"jobhunt/internal/sources"
	"testing"
	"time"
)

func TestLinkedInBacksOffMoreEachTime(t *testing.T) {
	for _, c := range []struct{ n, strikes, want int }{{10, 0, 10}, {10, 1, 5}, {10, 2, 3}, {24, 3, 3}, {2, 3, 2}} {
		if got := linkedInShare(c.n, c.strikes); got != c.want {
			t.Errorf("share(%d, %d) = %d, want %d", c.n, c.strikes, got, c.want)
		}
	}
	for strikes, want := range map[int]time.Duration{1: 2 * time.Hour, 2: 4 * time.Hour, 3: 8 * time.Hour, 5: 24 * time.Hour} {
		if got := linkedInRestFor(strikes); got != want {
			t.Errorf("rest after %d = %v, want %v", strikes, got, want)
		}
	}
}

// LinkedIn is asked at most linkedInPerHour times an hour; a new hour starts
// the count again.
func TestLinkedInSpreadOverTheHour(t *testing.T) {
	e := &Engine{Src: &sources.Client{}}
	st := SearchState{}
	if n := e.linkedInLeft(&st, 1000); n != linkedInPerHour {
		t.Fatalf("fresh hour: %d", n)
	}
	st.LinkedInHourN = linkedInPerHour - 2
	if n := e.linkedInLeft(&st, 2000); n != 2 {
		t.Errorf("same hour: %d", n)
	}
	if n := e.linkedInLeft(&st, 1000+3600); n != linkedInPerHour || st.LinkedInHourN != 0 {
		t.Errorf("next hour: %d, %d", n, st.LinkedInHourN)
	}
}
