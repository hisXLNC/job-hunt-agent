package engine

import (
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
