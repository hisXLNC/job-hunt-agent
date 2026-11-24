package llm

import "testing"

func TestTidy(t *testing.T) {
	in := "{\"a\":\"I led the team — six people​ — and shipped—on time. 2019–2021 there.\"}"
	want := "{\"a\":\"I led the team, six people, and shipped, on time. 2019–2021 there.\"}"
	if got := Tidy(in); got != want {
		t.Errorf("Tidy:\n got %q\nwant %q", got, want)
	}
}
