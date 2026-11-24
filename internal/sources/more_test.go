package sources

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// As Job Bank's results page marks postings up (from saved pages).
const jobBankList = `<span class="found" id="results-count">97</span>
<article id="article-44640615" class="action-buttons">
  <a href="/jobsearch/jobposting/44640615;jsessionid=ABC123?source=searchresults" class="resultJobItem">
    <h3 class="title">
      <span class="flag"><span class="telework">On site</span><span class="appmethod">Direct Apply</span><span class="postedonJB">Posted on Job Bank</span>
        <span class="job-source job-source-icon-16"><span class="wb-inv">Job Bank</span></span></span>
      <span class="noctitle"> tax manager </span>
    </h3>
    <ul class="list-unstyled">
      <li class="date">October 14, 2026</li>
      <li class="business">Maple Accounting &amp; Tax Ltd.</li>
      <li class="location"><span class="fas fa-map-marker-alt" aria-hidden="true"></span> <span class="wb-inv">Location</span>
        Toronto (ON)</li>
      <li class="salary"><span class="fa fa-dollar" aria-hidden="true"></span> Salary: $95,000.00 to $115,000.00 annually (to be negotiated)</li>
      <li class="source"><span class="job-source job-source-icon-16"></span> <span class="wb-inv">Job number:</span> 3345208</li>
    </ul>
  </a>
</article>
<article id="article-44650001"><a href="/jobsearch/jobposting/44650001?source=searchresults" class="resultJobItem">
  <h3 class="title"><span class="flag"><span class="telework">Remote work available</span></span><span class="noctitle">senior tax analyst</span></h3>
  <ul class="list-unstyled"><li class="date">October 10, 2026</li><li class="business">Northwind</li><li class="location"><span class="wb-inv">Location</span> Mississauga (ON)</li></ul>
</a></article>`

const jobBankPosting = `<div vocab="http://schema.org/" typeof="JobPosting"><h1 property="title">tax manager</h1>
  <div class="job-posting-detail-requirements">
    <h3>Overview</h3><p><strong>Education</strong></p><ul><li>Bachelor's degree</li></ul>
    <h3>Responsibilities</h3><ul><li>Prepare and review corporate tax returns (T2)</li><li>Advise clients on restructuring and on the tax effects of buying and selling businesses</li></ul>
    <h3>Experience and specialization</h3><p>5 years or more in a public accounting firm.</p>
  </div>
  <div class="col-md-4 job-posting-details-sidebar"><p>Advertised until 2026-11-13</p></div></div>`

func TestJobBank(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/jobsearch/jobsearch":
			if q := r.URL.Query(); q.Get("searchstring") != "Tax Manager" || q.Get("fprov") != "ON" || q.Get("sort") != "D" || q.Get("fage") != "2" {
				t.Errorf("unexpected search %s", r.URL.RawQuery)
			}
			w.Write([]byte(jobBankList))
		case "/jobsearch/jobposting/44640615":
			w.Write([]byte(jobBankPosting))
		default:
			http.NotFound(w, r)
		}
	}), "jobbank")
	got, err := c.Find(context.Background(), "jobbank", Query{Keywords: "Tax Manager", Province: "on", Within: 48 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 postings, got %d", len(got))
	}
	a, b := got[0], got[1]
	if a.Key != "jobbank:44640615" || a.Title != "tax manager" || a.Company != "Maple Accounting & Tax Ltd." || a.Location != "Toronto, ON" ||
		a.URL != "https://www.jobbank.gc.ca/jobsearch/jobposting/44640615" || a.Workplace != "onsite" || !a.NeedsDetail ||
		a.Pay != "$95,000.00 to $115,000.00 annually (to be negotiated)" || a.PostedAt.Format("2006-01-02") != "2026-10-14" {
		t.Errorf("first posting: %+v", a)
	}
	if b.Location != "Mississauga, ON" || b.Workplace != "remote" || b.Pay != "" || b.Company != "Northwind" {
		t.Errorf("second posting: %+v", b)
	}
	if err := c.Detail(context.Background(), &a); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(a.Description, "- Prepare and review corporate tax returns (T2)") || strings.Contains(a.Description, "Advertised until") || a.NeedsDetail {
		t.Errorf("description: %q", a.Description)
	}
	// A posting passed on by a partner site carries only a description.
	if got := parseJobBankPosting(`<p>Provided by a partner site</p><span class="hidden" property="description">We are hiring a Senior Tax Analyst to own indirect tax filings across Canada and the United States.</span>`); !strings.HasPrefix(got, "We are hiring") {
		t.Errorf("partner posting: %q", got)
	}
	// A page that is not search results is a changed site, not "no jobs".
	bad := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Maintenance</html>")) }), "jobbank")
	if _, err := bad.Find(context.Background(), "jobbank", Query{Keywords: "x"}); !errors.Is(err, ErrChanged) {
		t.Errorf("want ErrChanged, got %v", err)
	}
	// Titles in Job Bank's plain wording: the level dropped, long ones cut to
	// their last two words, the commonest first.
	titles := JobBankTitles([]string{"Delivery Lead", "Senior Technical Program Manager", "Tax Technology Program Manager", "Senior Fintech Product Manager", "Director, Tax Technology"}, 3)
	if len(titles) != 3 || titles[0] != "Program Manager" || titles[1] != "Delivery" && titles[1] != "Product Manager" {
		t.Errorf("titles: %q", titles)
	}
}

func TestFreeHire(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if q := r.URL.Query(); r.URL.Path != "/api/v1/agent/jobs/search" || q.Get("q") != "Tax Manager" || q.Get("countries") != "CA" {
			t.Errorf("unexpected request %s", r.URL)
		}
		w.Write([]byte(`{"data":[
		 {"title":"Tax Manager","company":"Borealis","url":"https://jobs.example.com/p/9?utm_source=freehire.me&x=1","public_slug":"tax-manager-9","location":"Toronto, ON","work_mode":"hybrid",
		  "description":"## About\n* Own the **indirect tax** engine\n* Lead a team","posted_at":"2026-11-23T10:00:00Z","enrichment":{"salary_min":110000,"salary_max":135000,"salary_currency":"cad","salary_period":"year"}},
		 {"title":"Old one","company":"Borealis","url":"https://jobs.example.com/p/1","external_id":77,"posted_at":"2026-10-01T10:00:00Z"},
		 {"title":"No link","company":"X","url":"javascript:alert(1)","public_slug":"z"}]}`))
	}), "freehire")
	got, err := c.Find(context.Background(), "freehire", Query{Keywords: "Tax Manager", Country: "ca", Within: 72 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("want the one fresh posting with a real link, got %d: %+v", len(got), got)
	}
	p := got[0]
	if p.Key != "freehire:tax-manager-9" || p.URL != "https://jobs.example.com/p/9?x=1" || p.Workplace != "hybrid" || p.Pay != "CAD 110,000 to 135,000 a year" ||
		p.Description != "About\n- Own the indirect tax engine\n- Lead a team" || p.NeedsDetail {
		t.Errorf("posting: %+v", p)
	}
}

func TestMoreBoards(t *testing.T) {
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/widget/accounts/acme":
			w.Write([]byte(`{"name":"Acme Inc","jobs":[{"title":"Tax Manager","shortcode":"AB12CD","city":"Toronto","state":"Ontario","country":"Canada","telecommuting":false,
			 "url":"https://apply.workable.com/acme/j/AB12CD/","description":"<p>Own tax.</p>","requirements":"<ul><li>CPA</li></ul>","published_on":"2026-11-20"}]}`))
		case "/careers/list":
			w.Write([]byte(`{"result":[{"id":"41","jobOpeningName":"Controller","isRemote":null,"location":{"city":"Ottawa","state":"Ontario"}},{"id":42,"jobOpeningName":"Analyst","isRemote":true,"location":{},"atsLocation":{"city":"Halifax","province":"NS","country":"Canada"}}]}`))
		case "/careers/41/detail":
			w.Write([]byte(`{"result":{"jobOpening":{"description":"<p>Run the close.</p>","minimumExperience":"5 years","datePosted":"2026-11-21"}}}`))
		case "/api/offers/":
			w.Write([]byte(`{"offers":[{"id":7,"slug":"tax-lead","title":"Tax Lead","description":"<p>Lead tax.</p>","requirements":"<p>SAP.</p>","location":"Toronto, Canada","company_name":"Acme","careers_url":"https://acme.recruitee.com/o/tax-lead","published_at":"2026-11-22 09:00:00 UTC","hybrid":true,"status":"published"},{"id":8,"title":"Draft","status":"draft"}]}`))
		default:
			http.NotFound(w, r)
		}
	}), "workable", "bamboohr", "recruitee")
	ctx := context.Background()

	wk, err := c.List(ctx, Board{Kind: "workable", Token: "acme"})
	if err != nil || len(wk) != 1 {
		t.Fatalf("workable: %v %+v", err, wk)
	}
	if p := wk[0]; p.Key != "workable:acme:AB12CD" || p.Company != "Acme Inc" || p.Location != "Toronto, Ontario, Canada" || p.Description != "Own tax.\n\n- CPA" || p.NeedsDetail {
		t.Errorf("workable posting: %+v", p)
	}

	bb, err := c.List(ctx, Board{Kind: "bamboohr", Token: "acme"})
	if err != nil || len(bb) != 2 {
		t.Fatalf("bamboohr: %v %+v", err, bb)
	}
	if bb[0].Location != "Ottawa, Ontario" || !bb[0].NeedsDetail || bb[1].Workplace != "remote" || bb[1].Location != "Halifax, NS, Canada" || bb[0].URL != "https://acme.bamboohr.com/careers/41" {
		t.Errorf("bamboohr postings: %+v", bb)
	}
	if err := c.Detail(ctx, &bb[0]); err != nil || bb[0].Description != "Run the close.\n\nMinimum experience: 5 years" || bb[0].PostedAt.IsZero() {
		t.Errorf("bamboohr detail: %v %+v", err, bb[0])
	}

	rc, err := c.List(ctx, Board{Kind: "recruitee", Token: "acme"})
	if err != nil || len(rc) != 1 {
		t.Fatalf("recruitee: %v %+v", err, rc)
	}
	if p := rc[0]; p.Key != "recruitee:acme:7" || p.Workplace != "hybrid" || p.Description != "Lead tax.\n\nSAP." {
		t.Errorf("recruitee posting: %+v", p)
	}

	for raw, want := range map[string]Board{
		"https://apply.workable.com/acme/j/AB12CD/": {Kind: "workable", Token: "acme"},
		"acme.bamboohr.com/careers":                 {Kind: "bamboohr", Token: "acme"},
		"https://acme.recruitee.com/o/tax-lead":     {Kind: "recruitee", Token: "acme"},
	} {
		if got, ok := ParseBoardURL(raw); !ok || got != want {
			t.Errorf("ParseBoardURL(%q) = %+v, %v", raw, got, ok)
		}
	}
}

const careersPage = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Borealis"},
 {"@type":"JobPosting","title":"Manager, Indirect Tax","url":"/careers/jobs/88231-manager-indirect-tax","identifier":{"@type":"PropertyValue","name":"Borealis","value":"R-88231"},
  "hiringOrganization":{"@type":"Organization","name":"Borealis Works"},"datePosted":"2026-11-22",
  "jobLocation":[{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Toronto","addressRegion":"ON","addressCountry":{"@type":"Country","name":"CA"}}}],
  "baseSalary":{"@type":"MonetaryAmount","currency":"CAD","value":{"@type":"QuantitativeValue","minValue":120000,"maxValue":"140000","unitText":"YEAR"}},
  "description":"&lt;p&gt;Short teaser.&lt;/p&gt;"},
 {"@type":"JobPosting","title":"Elsewhere","url":"https://evil.example.net/jobs/1234-steal"}]}</script></head>
<body><a href="/careers/jobs/88231-manager-indirect-tax">Manager, Indirect Tax</a></body></html>`

const linksPage = `<html><body><nav><a href="/careers/jobs/finance/">Finance</a><a href="/about">About us today</a></nav>
<ul><li><a href="/careers/jobs/55012-senior-tax-analyst">Senior Tax Analyst</a></li>
<li><a href="/careers/jobs/55012-senior-tax-analyst#apply">Apply now</a></li>
<li><a href="https://boards.example.org/acme/jobs/999999">Tax Director at a partner</a></li>
<li><a href="?gh_jid=4455667">Indirect Tax Lead</a></li>
<li><a href="http://127.0.0.1:47700/api/jobs/123456">Local trick posting</a></li></ul></body></html>`

func TestReadSite(t *testing.T) {
	detail := `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Manager, Indirect Tax","description":"<p>` + strings.Repeat("Own the indirect tax engine and its integrations. ", 12) + `</p><ul><li>Vertex</li></ul>","jobLocationType":"TELECOMMUTE"}</script></head><body>x</body></html>`
	plain := `<html><body><header>Menu</header><main><div class="job-description"><h2>About the role</h2><p>` + strings.Repeat("Prepare and file returns across provinces. ", 14) + `</p></div></main><footer>Privacy</footer></body></html>`
	c := serve(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/careers" && r.URL.Query().Get("q") == "Tax Manager":
			w.Write([]byte(careersPage))
		case r.URL.Path == "/search/tax-manager/toronto-on":
			w.Write([]byte(linksPage))
		case r.URL.Path == "/careers/jobs/88231-manager-indirect-tax":
			w.Write([]byte(detail))
		case r.URL.Path == "/careers/jobs/55012-senior-tax-analyst":
			w.Write([]byte(plain))
		case r.URL.Path == "/guarded":
			w.WriteHeader(403)
		default:
			http.NotFound(w, r)
		}
	}), "page")
	ctx := context.Background()

	// What the page describes to search engines, kept to the page's own site.
	got, err := c.ReadSite(ctx, Site{Name: "Borealis", URL: "https://www.borealis.example.com/careers?q={title}&l={place}"}, "Tax Manager", "Toronto, ON")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("want the one posting on the page's own site, got %d: %+v", len(got), got)
	}
	p := got[0]
	if p.Source != "site" || p.Key != "site:borealis.example.com:R-88231" || p.Company != "Borealis Works" || p.Location != "Toronto, ON, CA" ||
		p.URL != "https://www.borealis.example.com/careers/jobs/88231-manager-indirect-tax" || p.Pay != "CAD 120,000 to 140,000 a year" || !p.NeedsDetail || p.Description != "Short teaser." {
		t.Errorf("posting: %+v", p)
	}
	if err := c.Detail(ctx, &p); err != nil {
		t.Fatal(err)
	}
	if p.NeedsDetail || !strings.Contains(p.Description, "- Vertex") || p.Workplace != "remote" || p.Location != "Toronto, ON, CA" {
		t.Errorf("after detail: %+v", p)
	}

	// No description for search engines: links that look like postings, with
	// the title and place put into the path.
	got, err = c.ReadSite(ctx, Site{ID: "acme", Name: "Acme Staffing", URL: "https://jobs.acme.example.com/search/{title-}/{place-}"}, "Tax Manager", "Toronto, ON")
	if err != nil {
		t.Fatal(err)
	}
	var titles []string
	for _, p := range got {
		titles = append(titles, p.Title)
		if p.Company != "Acme Staffing" || p.Location != "Toronto, ON" || !strings.HasPrefix(p.Key, "site:acme:") {
			t.Errorf("link posting: %+v", p)
		}
	}
	if strings.Join(titles, "|") != "Senior Tax Analyst|Indirect Tax Lead" {
		t.Errorf("only the site's own posting links count, got %q", titles)
	}
	if got[0].Key != "site:acme:55012" || got[1].Key != "site:acme:4455667" {
		t.Errorf("keys: %s %s", got[0].Key, got[1].Key)
	}
	if err := c.Detail(ctx, &got[0]); err != nil || !strings.HasPrefix(got[0].Description, "About the role") || strings.Contains(got[0].Description, "Privacy") {
		t.Errorf("plain page detail: %v %q", err, got[0].Description)
	}

	// An employer's own careers page is a board like any other.
	board, err := c.List(ctx, Board{Kind: "page", Token: "https://www.borealis.example.com/careers?q=Tax+Manager"})
	if err != nil || len(board) != 1 || board[0].Source != "page" || !strings.HasPrefix(board[0].Key, "page:borealis.example.com:") {
		t.Errorf("page board: %v %+v", err, board)
	}

	// A page that turns a plain request away needs a browser; with one, it is read.
	site := Site{URL: "https://www.borealis.example.com/guarded"}
	if _, err := c.ReadSite(ctx, site, "", ""); !errors.Is(err, ErrNeedsBrowser) {
		t.Errorf("want ErrNeedsBrowser, got %v", err)
	}
	c.Render = func(ctx context.Context, addr string) (string, error) {
		if addr != "https://www.borealis.example.com/guarded" {
			t.Errorf("rendered %q", addr)
		}
		return careersPage, nil
	}
	if got, err := c.ReadSite(ctx, site, "", ""); err != nil || len(got) != 1 {
		t.Errorf("with a browser: %v %+v", err, got)
	}

	// Addresses on this computer or a private network are never opened.
	for _, addr := range []string{"http://127.0.0.1:47700/api/state", "http://localhost/jobs", "http://192.168.1.1/jobs", "http://[::1]/x", "file:///etc/passwd", "https://user:pw@example.com/"} {
		if _, err := c.ReadSite(ctx, Site{URL: addr}, "", ""); err == nil {
			t.Errorf("%s was opened", addr)
		}
		if err := c.Detail(ctx, &Posting{Source: "site", Key: "site:x:1", URL: addr, NeedsDetail: true}); err == nil {
			t.Errorf("%s was opened for detail", addr)
		}
	}
}

// A name that points at this computer is refused when the connection is
// made, whatever the address looked like.
func TestNoPrivateConnections(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("secret")) }))
	defer srv.Close()
	c := &Client{}
	if _, _, err := c.getHTML(context.Background(), srv.URL); !errors.Is(err, ErrPrivateAddress) {
		t.Errorf("a loopback server was reached: %v", err)
	}
	// A public page that redirects to this computer is refused as well.
	hop := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, srv.URL, http.StatusFound) }))
	defer hop.Close()
	c2 := &Client{Base: map[string]string{"page": hop.URL}}
	if _, _, err := c2.getHTML(context.Background(), hop.URL); !errors.Is(err, ErrPrivateAddress) {
		t.Errorf("a redirect to a loopback server was followed: %v", err)
	}
}

func TestSiteAddress(t *testing.T) {
	s := Site{URL: "https://x.example/jobs/{title-}/{place-}?q={title}&l={place}"}
	if got := s.Address("Senior Manager, Tax & Tech", "Montréal, QC"); got != "https://x.example/jobs/senior-manager-tax-tech/montreal-qc?q=Senior+Manager%2C+Tax+%26+Tech&l=Montr%C3%A9al%2C+QC" {
		t.Errorf("address: %s", got)
	}
	if !s.Searches() || (Site{URL: "https://x.example/all"}).Searches() {
		t.Error("Searches")
	}
	for _, k := range Known {
		if _, ok := publicURL(k.Address("Tax Manager", "Toronto, ON")); !ok || k.ID == "" || k.Name == "" {
			t.Errorf("known site %q has a bad address", k.Name)
		}
	}
}
