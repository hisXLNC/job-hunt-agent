package sources

import (
	"slices"
	"testing"
)

func TestASiteBelongsToTheEmployerOnlyWhenItCarriesItsName(t *testing.T) {
	yes := [][2]string{
		{"bmo.com", "BMO"}, {"scotiabank.com", "Scotiabank"}, {"rogers.com", "Rogers Communications"},
		{"cibc.com", "Canadian Imperial Bank of Commerce (CIBC)"}, {"cibc.com", "Canadian Imperial Bank of Commerce"},
		{"legrand.com", "Legrand, North & Central America"}, {"facilityos.com", "FacilityOS"}, {"protiviti.com", "Protiviti"},
		{"td.com", "TD"}, {"rbc.co.uk", "RBC"}, {"td.com", "TD Bank"}, {"bmo.com", "BMO Financial Group"}, {"rbc.com", "RBC Capital Markets"}, {"ibm.com", "IBM Canada"},
	}
	for _, c := range yes {
		if !Belongs(c[0], c[1]) {
			t.Errorf("%s should belong to %q", c[0], c[1])
		}
	}
	no := [][2]string{{"t.me", "EMCD"}, {"somejobsite.com", "BMO"}, {"bankofcommerce.com", "Canadian Imperial Bank of Commerce"}, {"analyst.com", "Rogers Communications"}}
	for _, c := range no {
		if Belongs(c[0], c[1]) {
			t.Errorf("%s should not belong to %q", c[0], c[1])
		}
	}
	for _, h := range []string{"t.me", "x.com", "www.linkedin.com", "ca.indeed.com"} {
		if OwnSite("https://"+h+"/a") != "" {
			t.Errorf("%s taken for an employer's site", h)
		}
	}
	if OwnSite("https://www.dropbox.com/jobs") != "dropbox.com" {
		t.Error("dropbox.com mistaken for x.com")
	}
	if g := Guesses("Canadian Imperial Bank of Commerce (CIBC)"); !slices.Contains(g, "cibc.com") {
		t.Errorf("Guesses = %v", g)
	}
	if g := Guesses("FacilityOS"); !slices.Contains(g, "facilityos.com") {
		t.Errorf("Guesses = %v", g)
	}
	if !pageNames([]byte("<html><title>CIBC | Personal Banking</title>"), "Canadian Imperial Bank of Commerce (CIBC)") || pageNames([]byte("<title>Princeton University</title>"), "Princeton IT Services") {
		t.Error("page title check")
	}
}
