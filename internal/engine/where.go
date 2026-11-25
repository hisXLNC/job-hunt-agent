package engine

import (
	"strings"

	"jobhunt/internal/store"
)

// Every place the person named is searched, for every title: their city, and
// each nearby place they added that the city's own area does not already
// take in. Each source keeps to the number of requests it had before; one
// that cannot ask about every title in every place in one search carries on
// from where the last one stopped.

// where is one place the title searches are asked about.
type where struct {
	Town     string // as the person wrote it, without the region: "Hamilton"
	Loc      string // what LinkedIn and the searches that take a key are given: "Hamilton, Canada"
	Province string // two letters, where known (Job Bank)
}

// mostPlaces is how many places besides the person's city are searched.
const mostPlaces = 6

// searchedPlaces lists the places every title is searched in: the person's
// city first, then each place they added that the city's own area does not
// already take in (a search for Toronto reaches Mississauga).
func searchedPlaces(p store.Profile) []where {
	country := strings.TrimSpace(p.Country)
	out := []where{{Town: strings.TrimSpace(strings.Split(p.City, ",")[0]), Loc: strings.TrimSpace(strings.Trim(p.City+", "+country, ", ")), Province: provinceOf(p)}}
	city := cityOf(p)
	if city == "" {
		return out
	}
	near := map[string]bool{city: true}
	for _, t := range metros[city].Towns {
		near[strings.TrimPrefix(t, "~")] = true
	}
	for _, raw := range p.Places {
		raw = strings.Join(strings.Fields(raw), " ")
		town, rest, _ := strings.Cut(raw, ",")
		town, rest = strings.TrimSpace(town), strings.TrimSpace(rest)
		key := strings.ToLower(town)
		if key == "" || near[key] || len(out) > mostPlaces {
			continue
		}
		near[key] = true
		w := where{Town: town, Loc: strings.TrimSpace(strings.Trim(town+", "+firstOf(rest, country), ", "))}
		if rest != "" && country != "" && !strings.Contains(strings.ToLower(rest), strings.ToLower(country)) {
			w.Loc += ", " + country
		}
		for _, r := range metros[key].Region {
			if len(r) == 2 {
				w.Province = strings.ToUpper(r)
				break
			}
		}
		if f := strings.Fields(strings.ReplaceAll(rest, ",", " ")); w.Province == "" && len(f) > 0 && len(f[0]) == 2 {
			w.Province = strings.ToUpper(f[0])
		}
		out = append(out, w)
	}
	return out
}

// titleAt is one title searched in one place.
type titleAt struct {
	Title, Band string
	At          where
}

// titlesAt pairs every title with every place, each title in each place in
// turn, the person's city first.
func titlesAt(titles []store.BandTitle, places []where) []titleAt {
	var out []titleAt
	for _, bt := range titles {
		for _, w := range places {
			out = append(out, titleAt{bt.Title, bt.Band, w})
		}
	}
	return out
}

// turnOf takes n of the list starting at turn, going round.
func turnOf[T any](list []T, turn, n int) []T {
	if len(list) == 0 || n <= 0 {
		return nil
	}
	n = min(n, len(list))
	turn = ((turn % len(list)) + len(list)) % len(list)
	out := make([]T, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, list[(turn+i)%len(list)])
	}
	return out
}

// label names one title in one place in a search's notes: the place is said
// only when it is not the person's city.
func (t titleAt) label(city where) string {
	if t.At.Town == "" || strings.EqualFold(t.At.Town, city.Town) {
		return t.Title
	}
	return t.Title + " in " + t.At.Town
}

// SearchedPlaces names the places every title is searched in, the person's
// city first, for the pages.
func SearchedPlaces(p store.Profile) []string {
	var out []string
	for _, w := range searchedPlaces(p) {
		if w.Town != "" {
			out = append(out, w.Town)
		}
	}
	return out
}
