package engine

import (
	"fmt"
	"testing"
	"time"

	"jobhunt/internal/brain"
	"jobhunt/internal/store"
)

// What the readings found missing is counted by Job Hunt, grouped by Claude,
// and a theme the CV shows in other words comes with a fact to keep.
func TestFitGaps(t *testing.T) {
	e, _ := newEngine(t)
	co := setUp(t, e)
	if v := e.FitGaps(); v.Has || v.Enough {
		t.Fatalf("nothing read yet: %+v", v)
	}
	for i := 0; i < 9; i++ {
		id, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: fmt.Sprintf("g:%d", i), Title: "Analyst", Applicants: -1, Stage: "found"})
		asks := []brain.Ask{{Ask: "SAP S/4HANA experience", Strength: "gap"}, {Ask: "Tax provision", Strength: "strong"}}
		if i < 4 {
			asks = append(asks, brain.Ask{Ask: "CPA designation", Strength: "partly"})
		}
		e.S.SetReading(id, 60, "level", brain.Reading{Fit: 60, Asks: asks})
	}
	items, _, roles := e.gapItems()
	if roles != 9 || len(items) != 2 || items[0].Ask != "SAP S/4HANA experience" || items[0].Roles != 9 || items[1].Roles != 4 {
		t.Fatalf("items %+v over %d roles", items, roles)
	}
	if err := e.LookFitGaps(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200 && e.Busy("fitgaps"); i++ {
		time.Sleep(10 * time.Millisecond)
	}
	v := e.FitGaps()
	if !v.Has || len(v.Gaps) != 2 || v.Gaps[0].Roles != 9 || v.Gaps[0].Kind != "shown" || v.Gaps[0].Fact == "" || v.Gaps[1].Kind != "real" || v.Gaps[1].Roles != 4 {
		t.Fatalf("view %+v", v)
	}
	e.S.AddFact(v.Gaps[0].Fact, "you")
	if !e.FitGaps().Gaps[0].Kept {
		t.Error("the kept fact isn't shown as kept")
	}
}
