package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// linkBrowser names the browser the person chose for links from Job Hunt's
// window ("" for Windows' own choice). main points it at the settings.
var linkBrowser = func() string { return "" }

var hexIndex = regexp.MustCompile(`0x([0-9a-fA-F]{8})\s*$`)

// parseWakeSetting reads what `powercfg /q SCHEME_CURRENT SUB_SLEEP RTCWAKE`
// prints: the last two lines carry the plugged-in and battery values
// (0 off, 1 on, 2 only Windows' own). Read by the numbers alone, so it works
// whatever language Windows speaks.
func parseWakeSetting(out string) (ac, dc int, ok bool) {
	var vals []int
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		if m := hexIndex.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			n, err := strconv.ParseInt(m[1], 16, 64)
			if err == nil {
				vals = append(vals, int(n))
			}
		}
	}
	if len(vals) < 2 {
		return 0, 0, false
	}
	return vals[len(vals)-2], vals[len(vals)-1], true
}

// sleptFor says how long the computer was asleep between two looks that
// were meant to be `every` apart, judged by the wall clock (Go's own clock
// for intervals stands still while Windows sleeps). 0 for no sleep worth
// telling: up to a minute late is only a busy computer.
func sleptFor(last, now time.Time, every time.Duration) time.Duration {
	gap := now.Round(0).Sub(last.Round(0)) - every
	if gap < time.Minute {
		return 0
	}
	return gap
}

// howLong is a span of time in words.
func howLong(d time.Duration) string {
	switch m := int(d.Minutes() + 0.5); {
	case m < 2:
		return "a minute"
	case m < 90:
		return fmt.Sprintf("%d minutes", m)
	default:
		return fmt.Sprintf("%.1f hours", d.Hours())
	}
}
