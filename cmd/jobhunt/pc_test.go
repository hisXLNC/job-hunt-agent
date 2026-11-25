package main

import (
	"testing"
	"time"
)

func TestParseWakeSetting(t *testing.T) {
	out := `Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)
    Power Setting GUID: bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d  (Allow wake timers)
      GUID Alias: RTCWAKE
      Possible Setting Index: 000
      Possible Setting Friendly Name: Disable
      Possible Setting Index: 001
      Possible Setting Friendly Name: Enable
    Current AC Power Setting Index: 0x00000000
    Current DC Power Setting Index: 0x00000002
`
	ac, dc, ok := parseWakeSetting(out)
	if !ok || ac != 0 || dc != 2 {
		t.Fatalf("got %d %d %v", ac, dc, ok)
	}
	// Another language: only the numbers count.
	if ac, _, ok := parseWakeSetting("Index actuel du paramètre d'alimentation secteur : 0x00000001\r\nIndex actuel du paramètre d'alimentation sur batterie : 0x00000000\r\n"); !ok || ac != 1 {
		t.Fatalf("got %d %v", ac, ok)
	}
	if _, _, ok := parseWakeSetting("The setting is not there."); ok {
		t.Error("no setting, nothing known")
	}
}

func TestSleptFor(t *testing.T) {
	at := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	if d := sleptFor(at, at.Add(20*time.Second), 20*time.Second); d != 0 {
		t.Errorf("on time: %v", d)
	}
	if d := sleptFor(at, at.Add(50*time.Second), 20*time.Second); d != 0 {
		t.Errorf("a little late is no sleep: %v", d)
	}
	if d := sleptFor(at, at.Add(40*time.Minute), 20*time.Second); d < 39*time.Minute {
		t.Errorf("slept: %v", d)
	}
	if howLong(40*time.Minute) != "40 minutes" || howLong(3*time.Hour) != "3.0 hours" {
		t.Error(howLong(40*time.Minute), howLong(3*time.Hour))
	}
}
