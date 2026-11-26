// Package vpn reaches one service through a WireGuard tunnel that lives
// inside Job Hunt alone, such as a Proton VPN server, so a search that
// turns away the country the person is in can still be asked. Nothing else
// on the computer, and nothing else in Job Hunt, goes through it: the
// tunnel is a network of its own in memory, not a new network adapter.
//
// The person downloads a WireGuard configuration file from their VPN
// account and gives it to Job Hunt. Its private key is kept with the other
// keys and goes to no one; the VPN server is the only place this package
// sends anything to.
package vpn

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

// Config is what a WireGuard configuration file says.
type Config struct {
	PrivateKey [32]byte
	PeerKey    [32]byte
	Preshared  [32]byte // zero when the file has none
	Addresses  []netip.Addr
	DNS        []netip.Addr
	Endpoint   string // host:port
	MTU        int
	Server     string // the server's name, from the comment Proton writes above [Peer]; may be ""
}

// Parse reads a WireGuard configuration file.
func Parse(text string) (Config, error) {
	var c Config
	var section string
	var lastComment string
	var hasPriv, hasPeer bool
	for _, raw := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			lastComment = strings.TrimSpace(strings.TrimLeft(line, "#;"))
			if section == "peer" && c.Server == "" && lastComment != "" && !strings.Contains(lastComment, "=") {
				c.Server = lastComment
			}
			continue
		}
		if strings.HasPrefix(line, "[") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			if section == "peer" && hasPeer {
				return Config{}, errors.New("the file names more than one server; download one for a single server")
			}
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			return Config{}, fmt.Errorf("a line of the file can't be read: %q", short(line))
		}
		k, v = strings.ToLower(strings.TrimSpace(k)), strings.TrimSpace(v)
		var err error
		switch section + "." + k {
		case "interface.privatekey":
			c.PrivateKey, err = key(v)
			hasPriv = err == nil
		case "interface.address":
			for _, a := range list(v) {
				p, perr := netip.ParsePrefix(a)
				if perr != nil {
					var aerr error
					var ad netip.Addr
					if ad, aerr = netip.ParseAddr(a); aerr != nil {
						return Config{}, fmt.Errorf("the address %q can't be read", short(a))
					}
					p = netip.PrefixFrom(ad, ad.BitLen())
				}
				c.Addresses = append(c.Addresses, p.Addr())
			}
		case "interface.dns":
			for _, a := range list(v) {
				if ad, aerr := netip.ParseAddr(a); aerr == nil {
					c.DNS = append(c.DNS, ad)
				}
			}
		case "interface.mtu":
			c.MTU, _ = strconv.Atoi(v)
		case "peer.publickey":
			c.PeerKey, err = key(v)
			hasPeer = err == nil
		case "peer.presharedkey":
			c.Preshared, err = key(v)
		case "peer.endpoint":
			if _, _, serr := net.SplitHostPort(v); serr != nil {
				return Config{}, fmt.Errorf("the server's address %q can't be read", short(v))
			}
			c.Endpoint = v
		}
		if err != nil {
			return Config{}, fmt.Errorf("the %s in the file can't be read", k)
		}
	}
	switch {
	case !hasPriv:
		return Config{}, errors.New("this isn't a WireGuard configuration file: it has no PrivateKey. Download one for WireGuard from your VPN account")
	case !hasPeer || c.Endpoint == "":
		return Config{}, errors.New("the file names no server ([Peer] with PublicKey and Endpoint)")
	case len(c.Addresses) == 0:
		return Config{}, errors.New("the file gives no Address for this computer")
	}
	if len(c.DNS) == 0 {
		c.DNS = []netip.Addr{netip.MustParseAddr("1.1.1.1")}
	}
	if c.MTU < 1280 || c.MTU > 1500 {
		c.MTU = 1420
	}
	return c, nil
}

// Name is how the tunnel is shown: the server's name, else its address.
func (c Config) Name() string {
	if c.Server != "" {
		return c.Server
	}
	host, _, _ := net.SplitHostPort(c.Endpoint)
	return host
}

func key(s string) ([32]byte, error) {
	var k [32]byte
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != 32 {
		return k, errors.New("bad key")
	}
	copy(k[:], b)
	return k, nil
}

func list(v string) []string {
	var out []string
	for _, x := range strings.Split(v, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func short(s string) string {
	if len(s) > 40 {
		return s[:40] + "…"
	}
	return s
}

// Error is the tunnel failing, as opposed to the service behind it.
type Error struct {
	Server string
	Why    string
}

func (e *Error) Error() string { return "the VPN server " + e.Server + " didn't connect: " + e.Why }

// idle is how long a tunnel nothing has used stays open.
const idle = 3 * time.Minute

// dialWait is how long a connection through the tunnel may take to open.
var dialWait = 25 * time.Second

// Tunnel opens when it is first used and closes after a few quiet minutes.
type Tunnel struct {
	cfg Config

	mu    sync.Mutex
	dev   *device.Device
	tnet  *netstack.Net
	timer *time.Timer

	bind conn.Bind // nil = the real network; tests give an in-memory one
}

// New makes a tunnel for a configuration; nothing is sent until it is used.
func New(c Config) *Tunnel { return &Tunnel{cfg: c} }

// DialContext connects to address through the tunnel. Names are looked up
// through the tunnel too, with the DNS server the file gives.
func (t *Tunnel) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	tn, err := t.up(ctx)
	if err != nil {
		return nil, &Error{Server: t.cfg.Name(), Why: err.Error()}
	}
	// A server that never answers the handshake shows only as a connection
	// that never opens.
	dctx, cancel := context.WithTimeout(ctx, dialWait)
	defer cancel()
	c, err := tn.DialContext(dctx, network, address)
	if err != nil {
		why := "no answer"
		if ctx.Err() == nil && dctx.Err() == nil {
			why = err.Error()
		}
		return nil, &Error{Server: t.cfg.Name(), Why: why}
	}
	return c, nil
}

func (t *Tunnel) up(ctx context.Context) (*netstack.Net, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timer != nil {
		t.timer.Reset(idle)
	}
	if t.tnet != nil {
		return t.tnet, nil
	}
	host, port, _ := net.SplitHostPort(t.cfg.Endpoint)
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("the VPN server %s can't be found", host)
	}
	ep := netip.AddrPortFrom(ips[0].Unmap(), uint16(atoi(port)))
	tun, tn, err := netstack.CreateNetTUN(t.cfg.Addresses, t.cfg.DNS, t.cfg.MTU)
	if err != nil {
		return nil, fmt.Errorf("the tunnel can't be made: %w", err)
	}
	bind := t.bind
	if bind == nil {
		bind = conn.NewDefaultBind()
	}
	dev := device.NewDevice(tun, bind, device.NewLogger(device.LogLevelSilent, ""))
	ipc := "private_key=" + hex.EncodeToString(t.cfg.PrivateKey[:]) + "\n" +
		"public_key=" + hex.EncodeToString(t.cfg.PeerKey[:]) + "\n"
	if t.cfg.Preshared != ([32]byte{}) {
		ipc += "preshared_key=" + hex.EncodeToString(t.cfg.Preshared[:]) + "\n"
	}
	ipc += "endpoint=" + ep.String() + "\npersistent_keepalive_interval=25\nallowed_ip=0.0.0.0/0\nallowed_ip=::/0\n"
	if err := dev.IpcSet(ipc); err != nil {
		dev.Close()
		return nil, fmt.Errorf("the tunnel can't be set up: %w", err)
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("the tunnel can't be opened: %w", err)
	}
	t.dev, t.tnet = dev, tn
	t.timer = time.AfterFunc(idle, t.Close)
	return tn, nil
}

// Close shuts the tunnel; the next use opens it again.
func (t *Tunnel) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timer != nil {
		t.timer.Stop()
		t.timer = nil
	}
	if t.dev != nil {
		t.dev.Close()
	}
	t.dev, t.tnet = nil, nil
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }
