package sources

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSourceOf(t *testing.T) {
	for host, want := range map[string]string{"www.linkedin.com": "linkedin", "ca.linkedin.com": "linkedin", "api.adzuna.com": "adzuna",
		"jooble.org": "jooble", "jsearch.p.rapidapi.com": "jsearch", "api.openwebninja.com": "jsearch", "api.apify.com": "apify",
		"www.jobbank.gc.ca": "jobbank", "freehire.me": "freehire", "boards-api.greenhouse.io": "", "notlinkedin.com": "", "api.anthropic.com": ""} {
		if got := SourceOf(host); got != want {
			t.Errorf("SourceOf(%q) = %q, want %q", host, got, want)
		}
	}
}

// fakeTunnel answers every name with one address and sends every
// connection to a test server, noting what was asked.
type fakeTunnel struct {
	ip, srv string
	dialed  []string
}

func (f *fakeTunnel) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	f.dialed = append(f.dialed, addr)
	return (&net.Dialer{}).DialContext(ctx, network, f.srv)
}
func (f *fakeTunnel) LookupContextHost(ctx context.Context, host string) ([]string, error) {
	return []string{f.ip}, nil
}

func TestViaTakesOnlyItsSource(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "through") }))
	defer srv.Close()
	ft := &fakeTunnel{ip: "203.0.113.9", srv: srv.Listener.Addr().String()}
	c := &Client{Via: func(kind string) Tunnel {
		if kind == "jooble" {
			return ft
		}
		return nil
	}}
	data, _, err := c.do(context.Background(), "GET", "http://jooble.org/x", acceptJSON, nil, nil, "")
	if err != nil || string(data) != "through" || len(ft.dialed) != 1 || ft.dialed[0] != "203.0.113.9:80" {
		t.Fatalf("got %q %v %v", data, err, ft.dialed)
	}
	// A name the tunnel says is a private address is not connected to.
	ft.ip = "10.2.0.1"
	if _, _, err := c.do(context.Background(), "GET", "http://jooble.org/x", acceptJSON, nil, nil, ""); !errors.Is(err, ErrPrivateAddress) {
		t.Fatalf("private address through the tunnel: %v", err)
	}
	if len(ft.dialed) != 1 {
		t.Fatal("dialed a private address")
	}
}
