package api

import "testing"

// Force search and scoring set-aside roles again bring roles back, so the
// assistant makes them only with the person's button and a paired phone
// not at all; nor does a phone see the postings each source found.
func TestNewSearchRoutesWaitForTheButton(t *testing.T) {
	for _, c := range [][2]string{
		{"POST", "/api/search/force"},
		{"POST", "/api/rescore"},
		{"GET", "/api/rescore"},
		{"GET", "/api/sources/linkedin/postings"},
	} {
		tl, _ := findTool(c[0], c[1])
		if tl == nil {
			t.Errorf("the assistant cannot call %s %s", c[0], c[1])
		} else if c[0] != "GET" && tl.Class != mustAsk {
			t.Errorf("the assistant makes %s %s without the person's button", c[0], c[1])
		}
		if phoneMay(c[0], c[1]) {
			t.Errorf("a phone can call %s %s", c[0], c[1])
		}
	}
}
