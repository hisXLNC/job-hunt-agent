package engine

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"jobhunt/internal/sources"
	"jobhunt/internal/store"
)

func TestEmployerLogoFromTheJobSource(t *testing.T) {
	e, _ := newEngine(t)
	var pic bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 40, 40))
	img.Set(3, 3, color.RGBA{200, 10, 10, 255})
	png.Encode(&pic, img)
	asked := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/dms/image/v2/abc/company-logo_100_100/0/1" {
			asked++
			w.Write(pic.Bytes())
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	e.Src.Base["logo"] = srv.URL

	c, _, err := e.S.UpsertCompany(store.Company{Name: "Zyxwv Quarterly Partners"})
	if err != nil {
		t.Fatal(err)
	}
	// Nothing known yet: no website, no logo from a source.
	if _, _, ok := e.Logo(context.Background(), c.ID); ok {
		t.Fatal("found a picture with nowhere to take it from")
	}
	// A LinkedIn posting shows the employer's logo; the "none found" from before is set aside.
	e.noteEmployerLooks(c.ID, sources.Posting{Logo: "https://media.licdn.com/dms/image/v2/abc/company-logo_100_100/0/1?e=1"})
	b, kind, ok := e.Logo(context.Background(), c.ID)
	if !ok || kind != "image/png" || !bytes.Equal(b, pic.Bytes()) || asked != 1 {
		t.Fatalf("logo from the source: ok=%v kind=%q asked=%d", ok, kind, asked)
	}
	// Kept: not asked again.
	if _, _, ok := e.Logo(context.Background(), c.ID); !ok || asked != 1 {
		t.Fatalf("the logo was not kept: asked=%d", asked)
	}
	// The source's own website for the employer is kept when it is theirs.
	e.noteEmployerLooks(c.ID, sources.Posting{Site: "zyxwvquarterly.example"})
	if got, _ := e.S.Company(c.ID); got.Site != "zyxwvquarterly.example" {
		t.Errorf("site = %q", got.Site)
	}
	e.noteEmployerLooks(c.ID, sources.Posting{Site: "someoneelse.example"})
	if got, _ := e.S.Company(c.ID); got.Site != "zyxwvquarterly.example" {
		t.Errorf("site changed to %q", got.Site)
	}
	// An address that isn't a public https picture is never kept.
	for _, bad := range []string{"http://media.licdn.com/x.png", "https://127.0.0.1/x.png", "https://localhost/x.png", "file:///c:/x.png", "https://intranet/x.png"} {
		if sources.LogoURL(bad) != "" {
			t.Errorf("kept %q", bad)
		}
	}
}

// An employer with no website on record, whose own site turns plain
// requests away: its website is found from its name and the icon comes
// from Google's copy.
func TestEmployerLogoFromItsNameWhenTheSiteRefuses(t *testing.T) {
	e, _ := newEngine(t)
	var pic bytes.Buffer
	png.Encode(&pic, image.NewRGBA(image.Rect(0, 0, 40, 40)))
	asked := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked[r.URL.Path]++
		switch r.URL.Path {
		case "/v1/companies/suggest":
			if r.URL.Query().Get("query") != "td" {
				w.Write([]byte(`[]`))
				return
			}
			w.Write([]byte(`[{"name":"TD Ameritrade","domain":"tdameritrade.com"},{"name":"TD","domain":"td.com"}]`))
		case "/s2/favicons":
			w.Write(pic.Bytes())
		default:
			http.Error(w, "Access denied", http.StatusForbidden) // the site itself
		}
	}))
	defer srv.Close()
	e.Src.Base["logo"], e.Src.Base["suggest"] = srv.URL, srv.URL
	c, _, _ := e.S.UpsertCompany(store.Company{Name: "TD"})
	if _, kind, ok := e.Logo(context.Background(), c.ID); !ok || kind != "image/png" {
		t.Fatalf("no logo: %v %q (asked %v)", ok, kind, asked)
	}
	// The website found is kept: the name isn't asked about again.
	os.Remove(filepath.Join(e.Dir, "logos3", fmt.Sprint(c.ID)))
	e.Logo(context.Background(), c.ID)
	if asked["/v1/companies/suggest"] != 1 {
		t.Fatalf("asked about the name %d times", asked["/v1/companies/suggest"])
	}
}
