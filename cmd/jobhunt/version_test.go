package main

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// One number everywhere: VERSION, the top of the list of changes and the
// side panel. Versions are dated: year.month.count.
func TestTheVersionIsTheSameEverywhere(t *testing.T) {
	b, err := os.ReadFile("../../VERSION")
	if err != nil {
		t.Fatal(err)
	}
	v := strings.TrimSpace(string(b))
	if !regexp.MustCompile(`^[0-9]{2}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$`).MatchString(v) {
		t.Fatalf("VERSION is %q; it must be year.month.count, such as 26.11.22", v)
	}
	log, err := os.ReadFile("../../CHANGELOG.md")
	if err != nil {
		t.Fatal(err)
	}
	top := regexp.MustCompile(`(?m)^## *(\S+)`).FindStringSubmatch(string(log))
	if top == nil || top[1] != v {
		t.Errorf("the top of CHANGELOG.md describes %v, VERSION says %s", top, v)
	}
	var m struct {
		Version string `json:"version"`
	}
	mb, err := os.ReadFile("../../extension/manifest.json")
	if err != nil || json.Unmarshal(mb, &m) != nil {
		t.Fatal("couldn't read the side panel's manifest")
	}
	if m.Version != v {
		t.Errorf("the side panel says version %s, VERSION says %s", m.Version, v)
	}
}
