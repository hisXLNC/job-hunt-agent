package engine

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"

	"jobhunt/internal/vpn"
)

// Adzuna through a VPN. Adzuna turns away some countries outright; the
// person can give Job Hunt a WireGuard file from their VPN account (Proton
// VPN gives these out, free plan included), and then Adzuna's requests, and
// only those, go through that server. Nothing else on the computer or in
// Job Hunt does. The file holds a private key: it is kept with the other
// keys and never sent back to the pages; they are told the server's name.

type vpnState struct {
	mu   sync.Mutex
	conf string
	tun  *vpn.Tunnel
}

// via is the sources client's Via: the tunnel Adzuna's requests take, or
// nil for the computer's own network.
func (e *Engine) via(kind string) func(ctx context.Context, network, addr string) (net.Conn, error) {
	if kind != "adzuna" {
		return nil
	}
	conf := e.sourceKeys().AdzunaVPN
	e.vpn.mu.Lock()
	defer e.vpn.mu.Unlock()
	if conf != e.vpn.conf {
		if e.vpn.tun != nil {
			e.vpn.tun.Close()
		}
		e.vpn.conf, e.vpn.tun = conf, nil
		if conf != "" {
			if c, err := vpn.Parse(conf); err == nil {
				e.vpn.tun = vpn.New(c)
			}
		}
	}
	if e.vpn.tun == nil {
		return nil
	}
	return e.vpn.tun.DialContext
}

// SetAdzunaVPN keeps a WireGuard file for Adzuna's requests and says which
// server it names. An empty text takes it away.
func (e *Engine) SetAdzunaVPN(text string) (string, error) {
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
	k.AdzunaVPN = text
	err := e.S.Set(sourceKeysKey, k)
	e.srcMu.Unlock()
	if err != nil {
		return "", err
	}
	// A rest after a country refusal no longer applies: the next search asks.
	e.setSourceState("adzuna", func(s *SourceState) { s.Error, s.ErrorAt, s.RestUntil = "", 0, 0 })
	return name, nil
}

// adzunaVPNName is the server Adzuna goes through, or "".
func adzunaVPNName(k SourceKeys) string {
	if k.AdzunaVPN == "" {
		return ""
	}
	c, err := vpn.Parse(k.AdzunaVPN)
	if err != nil {
		return "a VPN file that can't be read"
	}
	return c.Name()
}
