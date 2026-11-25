package api

import "testing"

// Force search and scoring set-aside roles again bring roles back, so
// neither the assistant nor a paired phone may call them, nor see the
// postings each source found.
func TestNewSearchRoutesAreNotOnTheLists(t *testing.T) {
	for _, c := range [][2]string{
		{"POST", "/api/search/force"},
		{"POST", "/api/rescore"},
		{"GET", "/api/rescore"},
		{"GET", "/api/sources/linkedin/postings"},
	} {
		if tl, _ := findTool(c[0], c[1]); tl != nil {
			t.Errorf("the assistant can call %s %s", c[0], c[1])
		}
		if phoneMay(c[0], c[1]) {
			t.Errorf("a phone can call %s %s", c[0], c[1])
		}
	}
}
