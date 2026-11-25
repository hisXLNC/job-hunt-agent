package engine

import (
	"testing"

	"jobhunt/internal/store"
)

func TestPayFloorInAnyUnitAndCurrency(t *testing.T) {
	yearly := store.Profile{Country: "Canada", PayFloor: 90000, PayUnit: "year"}
	hourly := store.Profile{Country: "Canada", PayFloor: 45, PayUnit: "hour"}
	for _, c := range []struct {
		p    store.Profile
		pay  string
		want bool
	}{
		{yearly, "$70,000 - $80,000 a year", true},
		{yearly, "$95,000", false},
		{yearly, "$5,000 a month", true},
		{yearly, "", false},
		{yearly, "£60,000", false},             // another currency: never compared
		{yearly, "USD 70,000 per year", false}, // the same
		{yearly, "CAD 70,000 per year", true},
		{hourly, "$30 an hour", true}, // a floor per hour used to be compared with yearly pay
		{hourly, "$110,000 a year", false},
		{hourly, "$80,000 a year", true},
	} {
		if got := payBelow(c.p, c.pay); got != c.want {
			t.Errorf("floor %d/%s, pay %q: below = %v, want %v", c.p.PayFloor, c.p.PayUnit, c.pay, got, c.want)
		}
	}
}
