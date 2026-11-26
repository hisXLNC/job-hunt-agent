package engine

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

// A WireGuard file for Adzuna: kept, used for Adzuna alone, never shown.
func TestAdzunaVPNIsKeptAndUsedForAdzunaOnly(t *testing.T) {
	e, _ := newEngine(t)
	k1 := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	k2 := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	file := "[Interface]\nPrivateKey = " + k1 + "\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\n# CA#99\nPublicKey = " + k2 + "\nEndpoint = 203.0.113.7:51820\n"

	if _, err := e.SetAdzunaVPN("not a file"); err == nil {
		t.Fatal("took a file that isn't WireGuard")
	}
	if e.via("adzuna") != nil {
		t.Fatal("a tunnel with no file")
	}
	name, err := e.SetAdzunaVPN(file)
	if err != nil || name != "CA#99" {
		t.Fatalf("got %q, %v", name, err)
	}
	if e.via("adzuna") == nil {
		t.Fatal("Adzuna doesn't go through the tunnel")
	}
	for _, kind := range []string{"jooble", "linkedin", "jsearch", "apify", ""} {
		if e.via(kind) != nil {
			t.Errorf("%q goes through Adzuna's tunnel", kind)
		}
	}
	shown, _ := json.Marshal(e.MoreSources())
	if strings.Contains(string(shown), k1) || strings.Contains(string(shown), "PrivateKey") {
		t.Fatal("the file's key is shown to the pages")
	}
	if !strings.Contains(string(shown), `"vpn":"CA#99"`) {
		t.Fatalf("the server isn't named: %s", shown)
	}
	if _, err := e.SetAdzunaVPN(""); err != nil || e.via("adzuna") != nil {
		t.Fatal("couldn't take it away")
	}
}
