package engine

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"jobhunt/internal/sources"
)

func testVPNFile() (string, string) {
	k1 := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	k2 := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("b", 32)))
	return "[Interface]\nPrivateKey = " + k1 + "\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\n# CA#99\nPublicKey = " + k2 + "\nEndpoint = 203.0.113.7:51820\n", k1
}

// One WireGuard file; only the sources chosen go through it; its key is
// never shown.
func TestVPNCarriesOnlyTheChosenSources(t *testing.T) {
	e, _ := newEngine(t)
	file, priv := testVPNFile()
	if _, err := e.SetVPN("not a file"); err == nil {
		t.Fatal("took a file that isn't WireGuard")
	}
	name, err := e.SetVPN(file)
	if err != nil || name != "CA#99" {
		t.Fatalf("got %q, %v", name, err)
	}
	if e.via("adzuna") != nil {
		t.Fatal("a source goes through the VPN without being chosen")
	}
	if err := e.SetThrough("adzuna", true); err != nil {
		t.Fatal(err)
	}
	if err := e.SetThrough("linkedin", true); err != nil {
		t.Fatal(err)
	}
	if err := e.SetThrough("claude", true); err == nil {
		t.Fatal("something that isn't a job source was sent through the VPN")
	}
	for kind, want := range map[string]bool{"adzuna": true, "linkedin": true, "jooble": false, "jsearch": false, "": false} {
		if got := e.via(kind) != nil; got != want {
			t.Errorf("%q through the VPN: %v, want %v", kind, got, want)
		}
	}
	shown, _ := json.Marshal(map[string]any{"more": e.MoreSources(), "vpn": e.VPN()})
	if strings.Contains(string(shown), priv) || strings.Contains(string(shown), "PrivateKey") {
		t.Fatal("the file's key is shown to the pages")
	}
	if !strings.Contains(string(shown), `"server":"CA#99"`) || !strings.Contains(string(shown), `"vpn":"CA#99"`) {
		t.Fatalf("the server isn't named: %s", shown)
	}
	e.SetThrough("linkedin", false)
	if e.via("linkedin") != nil {
		t.Fatal("still through the VPN after being taken off")
	}
	if _, err := e.SetVPN(""); err != nil || e.via("adzuna") != nil {
		t.Fatal("couldn't take it away")
	}
}

// A source that turns away the person's country goes through the VPN by
// itself, once there is one.
func TestRefusedByCountryGoesThroughTheVPN(t *testing.T) {
	e, _ := newEngine(t)
	blocked := fmt.Errorf("x: %w", sources.ErrBlockedHere)
	if e.throughByItself("adzuna", blocked) {
		t.Fatal("switched with no VPN file")
	}
	if why := e.blockedPlain("adzuna", blocked, "Adzuna turns away requests from the country you are in now."); !strings.Contains(why, "VPN for blocked sources") {
		t.Fatalf("no way out offered: %q", why)
	}
	file, _ := testVPNFile()
	e.SetVPN(file)
	if e.throughByItself("adzuna", fmt.Errorf("some other trouble")) {
		t.Fatal("switched for something that isn't a country refusal")
	}
	if !e.throughByItself("adzuna", blocked) || e.via("adzuna") == nil {
		t.Fatal("a refused source didn't go through the VPN")
	}
	if e.throughByItself("adzuna", blocked) {
		t.Fatal("switched twice")
	}
	if why := e.blockedPlain("adzuna", blocked, ""); !strings.Contains(why, "VPN server's country too") {
		t.Fatalf("got %q", why)
	}
}

// 26.11.55 kept the file for Adzuna alone; it carries on.
func TestOldAdzunaVPNCarriesOn(t *testing.T) {
	e, _ := newEngine(t)
	file, _ := testVPNFile()
	e.S.Set(sourceKeysKey, map[string]any{"adzuna_vpn": file})
	if e.via("adzuna") == nil || e.VPN().Server != "CA#99" {
		t.Fatal("the earlier Adzuna VPN was lost")
	}
}
