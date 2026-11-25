package sources

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestApifyLinkedIn(t *testing.T) {
	var started map[string]any
	polls := 0
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer apify-secret-1" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/v2/acts/curious_coder~linkedin-jobs-scraper/runs":
			b, _ := io.ReadAll(r.Body)
			json.Unmarshal(b, &started)
			io.WriteString(w, `{"data":{"id":"run1","status":"RUNNING","defaultDatasetId":"ds1"}}`)
		case r.URL.Path == "/v2/actor-runs/run1":
			polls++
			st := "RUNNING"
			if polls > 1 {
				st = "SUCCEEDED"
			}
			io.WriteString(w, `{"data":{"id":"run1","status":"`+st+`","defaultDatasetId":"ds1"}}`)
		case r.URL.Path == "/v2/datasets/ds1/items":
			io.WriteString(w, `[
			 {"title":"Tax Technology Manager","link":"https://ca.linkedin.com/jobs/view/tax-technology-manager-at-maple-bank-4012345678?trk=x","companyName":"Maple Bank","location":"Toronto, Ontario, Canada","descriptionHtml":"<p>Own the tax engine.</p>","postedAt":"2026-11-25","applicantsCount":"12","workplaceType":"Hybrid"},
			 {"title":"Tax Technology Manager","link":"https://ca.linkedin.com/jobs/view/4012345678"},
			 {"title":"No id here","link":"https://example.com/job"}
			]`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}), "apify")
	posts, err := c.FindKeyed(context.Background(), "apify", Keys{Apify: "apify-secret-1"}, Query{Keywords: "tax technology manager", Location: "Toronto", Within: 8 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	urls, _ := started["urls"].([]any)
	if len(urls) != 1 || !strings.Contains(urls[0].(string), "keywords=tax+technology+manager") || !strings.Contains(urls[0].(string), "f_TPR=r28800") {
		t.Fatalf("searched %v", started["urls"])
	}
	if len(posts) != 1 {
		t.Fatalf("posts = %+v", posts)
	}
	p := posts[0]
	if p.Key != "linkedin:4012345678" || p.Source != "linkedin" || p.Company != "Maple Bank" || p.Description != "Own the tax engine." || p.Applicants != 12 || p.Workplace != "hybrid" || p.URL != "https://www.linkedin.com/jobs/view/4012345678" {
		t.Fatalf("posting = %+v", p)
	}

	// A refused token, and a used-up credit, are told apart.
	if _, err := c.FindKeyed(context.Background(), "apify", Keys{Apify: "wrong"}, Query{Keywords: "x"}); err == nil || !strings.Contains(err.Error(), ErrKeyRefused.Error()) {
		t.Fatalf("refused token: %v", err)
	}
	if err := c.TestApify(context.Background(), "wrong"); err == nil {
		t.Fatal("a wrong token passed the test")
	}
}
