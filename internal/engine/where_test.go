package engine

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"jobhunt/internal/store"
)

func TestTheSearchedPlaces(t *testing.T) {
	p := store.Profile{City: "Toronto", Country: "Canada", Places: []string{"Mississauga", "Hamilton", " hamilton ", "Kitchener, ON", "Ottawa", ""}}
	got := searchedPlaces(p)
	want := []where{
		{"Toronto", "Toronto, Canada", "ON"},
		{"Hamilton", "Hamilton, Canada", "ON"},
		{"Kitchener", "Kitchener, ON, Canada", "ON"},
		{"Ottawa", "Ottawa, Canada", "ON"},
	}
	if len(got) != len(want) {
		t.Fatalf("places = %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("place %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	// No city: one place with nothing in it, so a search still runs as before.
	if got := searchedPlaces(store.Profile{}); len(got) != 1 || got[0].Loc != "" {
		t.Errorf("no city: %+v", got)
	}
	if got := turnOf([]int{1, 2, 3, 4, 5}, 4, 3); len(got) != 3 || got[0] != 5 || got[1] != 1 || got[2] != 2 {
		t.Errorf("turnOf = %v", got)
	}
	if got := turnOf([]int{1, 2}, 0, 5); len(got) != 2 {
		t.Errorf("turnOf asked for more than there are: %v", got)
	}
}

// Every title is searched in every place the person named, inside LinkedIn's
// share of one search; what does not fit is asked on the next one.
func TestEveryPlaceIsSearchedForEveryTitle(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	var mu sync.Mutex
	var asked [][2]string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "seeMoreJobPostings") {
			mu.Lock()
			asked = append(asked, [2]string{r.URL.Query().Get("keywords"), r.URL.Query().Get("location")})
			mu.Unlock()
		}
	}))
	t.Cleanup(srv.Close)
	e.Src.Base["linkedin"] = srv.URL

	p := e.S.Profile()
	p.Places = []string{"Mississauga", "Hamilton", "Kitchener", "Guelph", "Barrie", "Oshawa", "London, ON", "Waterloo"}
	e.S.SaveProfile(p)
	titles := p.Titles.All()
	places := searchedPlaces(p)
	if len(places) != 7 { // Mississauga and Oshawa are in Toronto's own area
		t.Fatalf("places = %+v", places)
	}
	pairs := len(titles) * len(places)
	if pairs <= 30 {
		t.Fatalf("the test needs more pairs than one search asks: %d", pairs)
	}
	seen := map[[2]string]bool{}
	ctx := context.Background()
	for run := 0; run < (pairs+29)/30; run++ {
		mu.Lock()
		asked = nil
		mu.Unlock()
		if err := e.Search(ctx, "full"); err != nil {
			t.Fatal(err)
		}
		mu.Lock()
		if n := len(asked); n > 30 || n < len(titles) {
			t.Fatalf("search %d asked LinkedIn %d times", run+1, n)
		}
		for _, a := range asked {
			if strings.Contains(a[1], "Mississauga") || strings.Contains(a[1], "Oshawa") {
				t.Errorf("asked about a town Toronto's own search reaches: %v", a)
			}
			seen[a] = true
		}
		mu.Unlock()
	}
	for _, bt := range titles {
		for _, w := range places {
			if !seen[[2]string{bt.Title, w.Loc}] {
				t.Errorf("%q was never searched in %q", bt.Title, w.Loc)
			}
		}
	}

	// With the city alone, every title once, as before.
	p.Places = nil
	e.S.SaveProfile(p)
	mu.Lock()
	asked = nil
	mu.Unlock()
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(asked) != len(titles) {
		t.Fatalf("city only: asked %d times for %d titles", len(asked), len(titles))
	}
	for _, a := range asked {
		if a[1] != "Toronto, Canada" {
			t.Errorf("city only: asked about %q", a[1])
		}
	}
}

// Each posting a search sees is listed under its source with what was
// decided: new, already here, or skipped and why.
func TestEachPostingsOutcomeIsKept(t *testing.T) {
	e, w := newEngine(t)
	setUp(t, e)
	ctx := context.Background()
	w.jobs = []map[string]any{
		job(1, "Tax Technology Manager", "Toronto, ON", goodAd),
		job(2, "Tax Technology Intern", "Toronto, ON", goodAd),
		job(3, "Warehouse Supervisor", "Toronto, ON", "<p>Run the night shift.</p>"),
	}
	if l, err := e.PostingsFrom(srcBoards, "", 100); err != nil || l.At != 0 || len(l.Postings) != 0 {
		t.Fatalf("before any search: %+v, %v", l, err)
	}
	if _, err := e.PostingsFrom("nowhere", "", 100); err == nil {
		t.Fatal("an unknown source has a list")
	}
	if err := e.Search(ctx, "full"); err != nil {
		t.Fatal(err)
	}
	l, err := e.PostingsFrom(srcBoards, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if l.At == 0 || l.Total != 3 || l.Counts["new"] != 1 || l.Counts["skipped"] != 2 {
		t.Fatalf("first search: %+v", l)
	}
	by := map[string]SourcePosting{}
	for _, x := range l.Postings {
		by[x.Title] = x
		if x.From != "Acme Corp" || x.Company != "Acme Corp" || x.RoleID == 0 {
			t.Errorf("%s: %+v", x.Title, x)
		}
	}
	if x := by["Tax Technology Manager"]; x.Outcome != "new" || x.Fit < 70 || x.Saying != "New" {
		t.Errorf("the good one: %+v", x)
	}
	if x := by["Tax Technology Intern"]; x.Outcome != "skipped" || !strings.Contains(x.Saying, "Student or entry-level") || x.Fit >= 0 {
		t.Errorf("the intern role: %+v", x)
	}
	// Narrowed to one outcome, and to a few rows.
	if s, _ := e.PostingsFrom(srcBoards, "skipped", 1); s.Shown != 2 || len(s.Postings) != 1 {
		t.Errorf("skipped, one row: shown %d, rows %d", s.Shown, len(s.Postings))
	}

	// The next search replaces the list: the same postings are already here.
	if err := e.Search(ctx, "fast"); err != nil {
		t.Fatal(err)
	}
	l, _ = e.PostingsFrom(srcBoards, "", 100)
	if l.Run != "fast" || l.Counts["here"] != 3 || l.Counts["new"] != 0 {
		t.Fatalf("second search: %+v", l.Counts)
	}
	// LinkedIn was asked too, and gave nothing: its list is empty, not missing.
	if li, _ := e.PostingsFrom("linkedin", "", 100); li.At == 0 || li.Total != 0 {
		t.Errorf("LinkedIn: %+v", li)
	}
}
