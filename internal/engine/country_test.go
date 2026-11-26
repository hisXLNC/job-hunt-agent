package engine

import (
	"testing"

	"jobhunt/internal/store"
)

// The country searched in comes from the profile however it is written,
// and from the city when the profile's country is empty or somewhere else.
func TestSearchCountry(t *testing.T) {
	for _, c := range []struct{ country, city, want string }{
		{"Canada", "Toronto", "CA"},
		{"", "Toronto", "CA"},
		{"", "Toronto, ON", "CA"},
		{"CAN", "Mississauga, Ontario", "CA"},
		{"Canada (Ontario)", "Toronto", "CA"},
		{"Egypt", "Toronto, ON, Canada", "CA"},
		{"Elsewhere", "Calgary", "CA"},
		{"U.S.A.", "Austin, TX", "US"},
		{"", "New York", "US"},
		{"", "London", "GB"},
		{"", "Nowhere", ""},
	} {
		if got := searchCountry(store.Profile{Country: c.country, City: c.city}); got != c.want {
			t.Errorf("country %q, city %q: got %q, want %q", c.country, c.city, got, c.want)
		}
	}
}
