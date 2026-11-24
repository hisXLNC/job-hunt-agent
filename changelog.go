// Package jobhunt carries the list of what changed in each version, so the
// program can say what is new after it updates itself.
package jobhunt

import (
	_ "embed"
	"strings"
)

//go:embed CHANGELOG.md
var changelog string

// Changes returns what the change list says under each version that comes
// after `from` up to and including `to`, newest first: each entry is the
// version and its lines. With from "" only `to` is returned.
func Changes(from, to string) []Section {
	var out []Section
	on := false
	for _, part := range strings.Split("\n"+changelog, "\n## ")[1:] {
		head, body, _ := strings.Cut(part, "\n")
		v := strings.TrimSpace(head)
		if v == to {
			on = true
		}
		if v == from {
			break
		}
		if on {
			out = append(out, Section{Version: v, Text: strings.TrimSpace(body)})
			if from == "" || len(out) >= 6 {
				break
			}
		}
	}
	return out
}

type Section struct {
	Version string `json:"version"`
	Text    string `json:"text"`
}
