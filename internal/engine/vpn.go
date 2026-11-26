package engine

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"jobhunt/internal/sources"
	"jobhunt/internal/vpn"
)

// A VPN for the sources that turn away the country the person is in. The
// person gives Job Hunt one WireGuard file from their VPN account (Proton
// VPN gives these out, free plan included) and chooses which sources go
// through it; a source that refuses their country is added by itself. Only
// those sources' requests take the tunnel. The rest of Job Hunt (Claude,
// the inbox, the pages) and the rest of the computer stay on the person's
// own connection. The file holds a private key: it is kept with the other
// keys and never sent back to the pages; they are told the server's name.

// vpnChoices are the sources a VPN can carry, in the order they are shown.
var vpnChoices = []struct{ ID, Name string }{
	{"linkedin", "LinkedIn public search"},
	{"jobbank", "Job Bank"},
	{"freehire", "FreeHire"},
	{"adzuna", "Adzuna"},
	{"jooble", "Jooble"},
	{"jsearch", "Google for Jobs"},
	{"apify", "LinkedIn through Apify"},
	{"logos", "Employers' logos (their websites, icons and the company lookup)"},
}

func vpnChoice(id string) (string, bool) {
	for _, c := range vpnChoices {
		if c.ID == id {
			return c.Name, true
		}
	}
	return "", false
}

type vpnState struct {
	mu   sync.Mutex
	conf string
	tun  *vpn.Tunnel
}

// via is the sources client's Via: the tunnel a source's requests take, or
// nil for the computer's own network.
func (e *Engine) via(kind string) sources.Tunnel {
	k := e.sourceKeys()
	if k.VPN == "" || !slices.Contains(k.Through, kind) {
		return nil
	}
	e.vpn.mu.Lock()
	defer e.vpn.mu.Unlock()
	if k.VPN != e.vpn.conf {
		if e.vpn.tun != nil {
			e.vpn.tun.Close()
		}
		e.vpn.conf, e.vpn.tun = k.VPN, nil
		if c, err := vpn.Parse(k.VPN); err == nil {
			e.vpn.tun = vpn.New(c)
		}
	}
	if e.vpn.tun == nil {
		return nil
	}
	return e.vpn.tun
}

// VPNView is what the Connections page is shown.
type VPNView struct {
	Server  string              `json:"server,omitempty"` // "" = no file
	Through []string            `json:"through"`
	Choices []map[string]string `json:"choices"`
	// States is how each source fared in the searches, as Radar shows it.
	States map[string]SourceRow `json:"states"`
}

// VPN says which server, if any, and which sources go through it.
func (e *Engine) VPN() VPNView {
	k := e.sourceKeys()
	v := VPNView{Through: k.Through}
	if v.Through == nil {
		v.Through = []string{}
	}
	if k.VPN != "" {
		if c, err := vpn.Parse(k.VPN); err == nil {
			v.Server = c.Name()
		} else {
			v.Server = "a VPN file that can't be read"
		}
	}
	v.States = map[string]SourceRow{}
	for _, r := range e.Sources() {
		if _, ok := vpnChoice(r.ID); ok {
			v.States[r.ID] = r
		}
	}
	for _, c := range vpnChoices {
		v.Choices = append(v.Choices, map[string]string{"id": c.ID, "name": c.Name})
	}
	return v
}

// SetVPN keeps a WireGuard file and says which server it names. An empty
// text takes it away; the sources chosen are remembered for the next file.
// With no source chosen yet, the ones that refused the person's country
// are chosen.
func (e *Engine) SetVPN(text string) (string, error) {
	text = strings.TrimSpace(text)
	name := ""
	if text != "" {
		if len(text) > 16<<10 {
			return "", errors.New("that file is too large to be a WireGuard configuration")
		}
		c, err := vpn.Parse(text)
		if err != nil {
			return "", err
		}
		name = c.Name()
	}
	e.srcMu.Lock()
	k := e.sourceKeys()
	k.VPN = text
	if text != "" && len(k.Through) == 0 {
		for id, st := range e.sourceStates() {
			if _, ok := vpnChoice(id); ok && strings.Contains(st.Error, "country you are in") {
				k.Through = append(k.Through, id)
			}
		}
		slices.Sort(k.Through)
	}
	err := e.S.Set(sourceKeysKey, k)
	through := k.Through
	e.srcMu.Unlock()
	if err != nil {
		return "", err
	}
	// A rest after a country refusal no longer applies: the next search asks.
	for _, id := range through {
		e.setSourceState(id, func(s *SourceState) { s.Error, s.ErrorAt, s.RestUntil = "", 0, 0 })
	}
	return name, nil
}

// SetThrough sends one source through the VPN, or back over the person's
// own connection.
func (e *Engine) SetThrough(id string, on bool) error {
	if _, ok := vpnChoice(id); !ok {
		return errors.New("that source can't go through a VPN")
	}
	e.srcMu.Lock()
	k := e.sourceKeys()
	k.Through = slices.DeleteFunc(k.Through, func(x string) bool { return x == id })
	if on {
		k.Through = append(k.Through, id)
		slices.Sort(k.Through)
	}
	err := e.S.Set(sourceKeysKey, k)
	e.srcMu.Unlock()
	if err == nil && on {
		e.setSourceState(id, func(s *SourceState) { s.Error, s.ErrorAt, s.RestUntil = "", 0, 0 })
	}
	return err
}

// throughByItself sends a source that refused the person's country through
// the VPN, when there is one and it doesn't go through it already. It says
// whether it did, so the caller can ask again at once.
func (e *Engine) throughByItself(id string, err error) bool {
	if !errors.Is(err, sources.ErrBlockedHere) {
		return false
	}
	k := e.sourceKeys()
	if k.VPN == "" || slices.Contains(k.Through, id) {
		return false
	}
	if _, ok := vpnChoice(id); !ok {
		return false
	}
	return e.SetThrough(id, true) == nil
}

// blockedPlain adds to a country refusal what can be done about it.
func (e *Engine) blockedPlain(id string, err error, why string) string {
	if !errors.Is(err, sources.ErrBlockedHere) {
		return why
	}
	k := e.sourceKeys()
	name, _ := vpnChoice(id)
	switch {
	case k.VPN != "" && slices.Contains(k.Through, id):
		return name + " turns away the VPN server's country too. Choose a WireGuard file for a server in a country it serves (Settings, Connections, VPN for blocked sources)"
	case k.VPN == "":
		return strings.TrimSuffix(why, ".") + ". A VPN gets round this: Settings, Connections, VPN for blocked sources"
	}
	return why
}

// vpnName is the server a source goes through, or "".
func vpnName(k SourceKeys, id string) string {
	if k.VPN == "" || !slices.Contains(k.Through, id) {
		return ""
	}
	if c, err := vpn.Parse(k.VPN); err == nil {
		return c.Name()
	}
	return ""
}

func vpnDown(name string, ve *vpn.Error) string {
	return name + "'s VPN server " + ve.Server + " didn't connect (" + ve.Why + "). Check that the WireGuard file is still listed in your VPN account, or download a new one and choose it again (Settings, Connections, VPN for blocked sources)"
}

// CheckVPN opens the tunnel and looks a name up through it, which only
// works once the VPN server has answered. Nothing else is sent.
func (e *Engine) CheckVPN(ctx context.Context) error {
	k := e.sourceKeys()
	if k.VPN == "" {
		return errors.New("no WireGuard file is saved")
	}
	c, err := vpn.Parse(k.VPN)
	if err != nil {
		return err
	}
	t := vpn.New(c)
	defer t.Close()
	if _, err := t.LookupContextHost(ctx, "www.linkedin.com"); err != nil {
		var ve *vpn.Error
		if errors.As(err, &ve) {
			return errors.New("the VPN server " + ve.Server + " didn't connect (" + ve.Why + "). Check that the WireGuard file is still listed in your VPN account, or download a new one")
		}
		return err
	}
	return nil
}

// VPNTest is what one source did when tried through the VPN.
type VPNTest struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Found int    `json:"found"`
	Note  string `json:"note,omitempty"`
}

// TestThrough runs one small search for the person's first title on each
// source that goes through the VPN, all at once, and says what each did.
// LinkedIn through Apify is left out: each run of the scraper costs.
func (e *Engine) TestThrough(ctx context.Context) []VPNTest {
	k := e.sourceKeys()
	p := e.S.Profile()
	title := "manager"
	if all := p.Titles.All(); len(all) > 0 {
		title = all[0].Title
	}
	at := searchedPlaces(p)[0]
	out := make([]VPNTest, 0, len(k.Through))
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, c := range vpnChoices {
		if !slices.Contains(k.Through, c.ID) {
			continue
		}
		wg.Add(1)
		go func(id, name string) {
			defer wg.Done()
			r := VPNTest{ID: id, Name: name}
			cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()
			var n int
			var err error
			q := sources.Query{Keywords: title, Location: at.Loc, Province: at.Province, Country: countryCode(p.Country), Within: 7 * 24 * time.Hour, Max: 10}
			switch id {
			case "apify":
				r.Note = "Not tried here: each run of the scraper costs. Use Test under More job sources"
			case "logos":
				var d string
				if d, err = e.Src.FindDomain(cctx, "Air Canada"); err == nil {
					_, _, err = e.Src.IconOf(cctx, d)
					n = 1
				}
			case "linkedin":
				var posts []sources.Posting
				posts, err = e.Src.Search(cctx, q)
				n = len(posts)
			case "jobbank", "freehire":
				var posts []sources.Posting
				posts, err = e.Src.Find(cctx, id, q)
				n = len(posts)
			default:
				if !k.forSources().Has(id) {
					r.Note = "No key saved: add one under More job sources"
					break
				}
				n, err = e.TestSource(cctx, id)
			}
			switch {
			case r.Note != "":
			case err != nil:
				r.Note = testPlain(name, err)
			default:
				r.OK, r.Found = true, n
				if n == 0 {
					r.Note = "Answered, with nothing for your first title this past week"
				}
			}
			mu.Lock()
			out = append(out, r)
			mu.Unlock()
		}(c.ID, c.Name)
	}
	wg.Wait()
	slices.SortFunc(out, func(a, b VPNTest) int { return choiceIndex(a.ID) - choiceIndex(b.ID) })
	return out
}

func choiceIndex(id string) int {
	return slices.IndexFunc(vpnChoices, func(c struct{ ID, Name string }) bool { return c.ID == id })
}

// testPlain says in plain words why a source didn't answer.
func testPlain(name string, err error) string {
	var ve *vpn.Error
	var he *sources.HTTPError
	switch {
	case errors.As(err, &ve):
		return "The VPN server didn't connect (" + ve.Why + ")"
	case errors.Is(err, sources.ErrBlockedHere):
		return name + " turns away the VPN server's country"
	case errors.As(err, &he) && (he.Status == 429 || he.Status == 999):
		return name + " asked to slow down. Job Hunt waits before asking it again"
	case errors.As(err, &he) && he.Status == 403:
		return name + " turned the request away (403). It may not accept VPN servers: untick it"
	case errors.As(err, &he):
		return fmt.Sprintf("%s answered with an error (%d)", name, he.Status)
	case errors.Is(err, context.DeadlineExceeded):
		return name + " didn't answer in time"
	}
	return strings.TrimPrefix(err.Error(), "sources: ")
}
