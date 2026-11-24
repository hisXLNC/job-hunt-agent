package jobhunt

import "testing"

func TestWhatChangedSinceAVersion(t *testing.T) {
	got := Changes("26.11.22", "26.11.24")
	if len(got) != 2 || got[0].Version != "26.11.24" || got[1].Version != "26.11.23" || got[0].Text == "" {
		t.Fatalf("%+v", got)
	}
}
