package sources

import (
	"context"
	"encoding/base64"
	"net/http"
	"testing"
)

func TestAnEmployersPictureComesFromItsOwnSite(t *testing.T) {
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
	asked := []string{}
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.Path)
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<html><head><link rel="icon" href="/small.svg" type="image/svg+xml"><link rel='apple-touch-icon' sizes="180x180" href="/img/touch.png"><link rel=stylesheet href=/a.css></head></html>`))
		case "/img/touch.png":
			w.Write(append(png, make([]byte, 40)...))
		default:
			http.NotFound(w, r)
		}
	}), "logo")
	b, kind, err := c.Logo(context.Background(), "acme.example")
	if err != nil || kind != "image/png" || len(b) < 70 {
		t.Fatalf("Logo = %d bytes, %q, %v (asked %v)", len(b), kind, err, asked)
	}
	if _, _, err := c.Logo(context.Background(), "boards.greenhouse.io"); err == nil {
		t.Error("a site that hosts many employers gave a picture")
	}
}
