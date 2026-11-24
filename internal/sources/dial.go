package sources

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
)

// ErrPrivateAddress is returned when an address leads to this computer or to
// a private network. Addresses come from postings, careers pages and whatever
// the person pasted in, so none of them is allowed to make Job Hunt call the
// machine it runs on or the devices around it.
var ErrPrivateAddress = errors.New("sources: that address is on this computer or a private network")

// publicOnly returns an HTTP client that refuses, at the moment of
// connecting, every address that is not on the public internet. Checking at
// connect time (not when the name is looked up) means a name that resolves
// to a private address, or a redirect to one, is refused as well. The hosts
// of Base overrides are let through: they are the test servers.
func (c *Client) publicOnly() *http.Client {
	local := map[string]bool{}
	for _, b := range c.Base {
		if u, err := url.Parse(b); err == nil && u.Host != "" {
			local[u.Host] = true
		}
	}
	// A proxy the computer is set up to use is connected to wherever it is;
	// it is the proxy that then reaches the outside.
	proxies := map[string]bool{}
	for _, k := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		v := os.Getenv(k)
		if v != "" && !strings.Contains(v, "://") {
			v = "http://" + v
		}
		if u, err := url.Parse(v); err == nil && u.Hostname() != "" {
			port := u.Port()
			if port == "" {
				port = map[string]string{"https": "443", "socks5": "1080"}[u.Scheme]
				if port == "" {
					port = "80"
				}
			}
			proxies[net.JoinHostPort(u.Hostname(), port)] = true
		}
	}
	plain := &net.Dialer{Timeout: 10 * time.Second}
	d := &net.Dialer{Timeout: 10 * time.Second, Control: func(network, address string, _ syscall.RawConn) error {
		if local[address] {
			return nil
		}
		ap, err := netip.ParseAddrPort(address)
		if err != nil {
			return fmt.Errorf("sources: unreadable address %q", address)
		}
		if !publicAddr(ap.Addr()) {
			return ErrPrivateAddress
		}
		return nil
	}}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if proxies[addr] {
			return plain.DialContext(ctx, network, addr)
		}
		return d.DialContext(ctx, network, addr)
	}
	return &http.Client{Timeout: defaultTimeout, Transport: tr, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 6 {
			return errors.New("sources: too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errors.New("sources: redirect to something that is not a web address")
		}
		return nil
	}}
}

func publicAddr(a netip.Addr) bool {
	a = a.Unmap()
	return a.IsValid() && !a.IsLoopback() && !a.IsPrivate() && !a.IsLinkLocalUnicast() && !a.IsLinkLocalMulticast() &&
		!a.IsMulticast() && !a.IsUnspecified() && !cgnat.Contains(a)
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// publicURL returns raw when it is an http(s) address whose host is not
// plainly this computer or a private network. Names are checked again when
// the connection is made; this only catches what can be seen in the text.
func publicURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return nil, false
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return nil, false
	}
	if ip, err := netip.ParseAddr(host); err == nil && !publicAddr(ip) {
		return nil, false
	}
	return u, true
}
