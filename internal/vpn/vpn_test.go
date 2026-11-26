package vpn

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"testing"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.zx2c4.com/wireguard/conn/bindtest"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

func keypair(t *testing.T) (priv, pub [32]byte) {
	t.Helper()
	if _, err := rand.Read(priv[:]); err != nil {
		t.Fatal(err)
	}
	priv[0] &= 248
	priv[31] = (priv[31] & 127) | 64
	p, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	copy(pub[:], p)
	return
}

func b64(k [32]byte) string { return base64.StdEncoding.EncodeToString(k[:]) }

// A Proton-style file, as account.protonvpn.com hands it out.
func TestParseProtonFile(t *testing.T) {
	cpriv, _ := keypair(t)
	_, spub := keypair(t)
	file := "[Interface]\r\n# Key for Job Hunt\r\n# Bouncing = 1\r\n# NetShield = 1\r\nPrivateKey = " + b64(cpriv) +
		"\r\nAddress = 10.2.0.2/32\r\nDNS = 10.2.0.1\r\n\r\n[Peer]\r\n# CA#99\r\nPublicKey = " + b64(spub) +
		"\r\nAllowedIPs = 0.0.0.0/0\r\nEndpoint = 203.0.113.7:51820\r\n"
	c, err := Parse(file)
	if err != nil {
		t.Fatal(err)
	}
	if c.Name() != "CA#99" || c.Endpoint != "203.0.113.7:51820" || c.PrivateKey != cpriv || c.PeerKey != spub ||
		len(c.Addresses) != 1 || c.Addresses[0].String() != "10.2.0.2" || c.DNS[0].String() != "10.2.0.1" || c.MTU != 1420 {
		t.Fatalf("read %+v", c)
	}
	for _, bad := range []string{"", "hello", "[Interface]\nPrivateKey = " + b64(cpriv) + "\nAddress = 10.2.0.2/32\n",
		"[Interface]\nPrivateKey = nope\n"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%q) took it", bad)
		}
	}
}

// The tunnel really carries a request: a WireGuard server made here, on
// this computer, answers a web request sent through it.
func TestTunnelCarriesRequests(t *testing.T) {
	cpriv, cpub := keypair(t)
	spriv, spub := keypair(t)

	// The server side.
	stun, snet, err := netstack.CreateNetTUN([]netip.Addr{netip.MustParseAddr("10.9.0.1")}, nil, 1420)
	if err != nil {
		t.Fatal(err)
	}
	// WireGuard's own in-memory link stands in for the network between the two.
	binds := bindtest.NewChannelBinds()
	sdev := device.NewDevice(stun, binds[0], device.NewLogger(device.LogLevelSilent, ""))
	defer sdev.Close()
	if err := sdev.IpcSet(fmt.Sprintf("private_key=%s\npublic_key=%s\nallowed_ip=10.9.0.2/32\n",
		hex.EncodeToString(spriv[:]), hex.EncodeToString(cpub[:]))); err != nil {
		t.Fatal(err)
	}
	if err := sdev.Up(); err != nil {
		t.Fatal(err)
	}
	ln, err := snet.ListenTCP(&net.TCPAddr{Port: 80})
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "hello from "+r.Host)
	})}
	go srv.Serve(ln)
	defer srv.Close()

	file := "[Interface]\nPrivateKey = " + b64(cpriv) + "\nAddress = 10.9.0.2/32\nDNS = 10.9.0.1\n[Peer]\n# Test server\nPublicKey = " +
		b64(spub) + "\nEndpoint = 127.0.0.1:2\n"
	c, err := Parse(file)
	if err != nil {
		t.Fatal(err)
	}
	tn := New(c)
	tn.bind = binds[1]
	defer tn.Close()
	hc := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{DialContext: tn.DialContext}}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://10.9.0.1/", nil)
	resp, err := hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "hello from 10.9.0.1" {
		t.Fatalf("got %q", body)
	}
	// Closed, then used again: it opens itself once more.
	tn.Close()
	req, _ = http.NewRequestWithContext(ctx, "GET", "http://10.9.0.1/", nil)
	hc.CloseIdleConnections()
	if resp, err = hc.Do(req); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}
