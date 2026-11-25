package engine

import (
	"context"
	"strings"
	"testing"

	"jobhunt/internal/cv"
	"jobhunt/internal/store"
)

const plainAd = `We are hiring a tax technology manager.
- Implementation of a Vertex indirect tax engine on SAP S/4HANA
- Experience with e-invoicing integrations handling large invoice volumes
- Managed a team of analysts and a vendor budget`

// Around a prepared application: the CV the employer already has, the check,
// the person's own files, an offer and the reply to a no.
func TestAroundAnApplication(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	ctx := context.Background()

	first, err := e.AddRole("Acme Corp", "Tax Technology Manager", "Toronto, ON", "", plainAd, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Prepare(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := e.MarkApplied(first, ""); err != nil {
		t.Fatal(err)
	}

	// A second role at the same employer is written close to the CV they have.
	second, _ := e.AddRole("Acme Corp", "Senior Manager, Indirect Tax", "Toronto, ON", "", plainAd, "manual")
	if err := e.Prepare(ctx, second); err != nil {
		t.Fatal(err)
	}
	_, sent, doc, err := e.RoleCV(second)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Earlier == nil || doc.Earlier.RoleID != first {
		t.Fatalf("the CV sent to Acme before must be named: %+v", doc.Earlier)
	}
	if e.EarlierDiff(second, doc, sent) == nil {
		t.Fatal("no difference worked out")
	}
	// A role at another employer has nothing before it.
	other, _ := e.AddRole("Other Ltd", "Tax Technology Manager", "Toronto, ON", "", plainAd, "manual")
	if r, _ := e.S.Role(other); e.EarlierHere(r) != nil {
		t.Fatal("never applied at Other Ltd")
	}

	// Check my CV reads the CV as sent and remembers what it read.
	if err := e.CheckCV(ctx, second); err != nil {
		t.Fatal(err)
	}
	var check CheckDoc
	if ok, _ := e.S.Doc(second, "check", &check); !ok || len(check.Lines) == 0 || check.Of != TextHash(cv.Text(sent)) {
		t.Fatalf("check = %+v", check)
	}
	for _, l := range check.Lines {
		if l.Status != "shown" && l.Status != "unclear" && l.Status != "missing" {
			t.Fatalf("status %q", l.Status)
		}
	}

	// The person's own CV file is what gets downloaded and attached, until they drop it.
	if err := e.SetOwnFile(second, "cv", "notes.txt", []byte("hello")); err == nil {
		t.Fatal("a text file must be refused")
	}
	if err := e.SetOwnFile(second, "cv", "My CV.pdf", []byte("%PDF-1.4 mine")); err != nil {
		t.Fatal(err)
	}
	for _, get := range []func(int64) (File, error){e.CVFile, e.CVPDF} {
		if f, err := get(second); err != nil || f.Name != "My CV.pdf" || string(f.Data) != "%PDF-1.4 mine" {
			t.Fatalf("own file not used: %q %v", f.Name, err)
		}
	}
	if _, err := e.PackPDF(second); err == nil {
		t.Fatal("one PDF of Job Hunt's own must not stand in for the person's own file")
	}
	if f, _ := e.LetterFile(second); strings.HasSuffix(f.Name, ".pdf") {
		t.Fatal("the letter is still Job Hunt's")
	}
	if err := e.DropOwnFile(second, "cv"); err != nil {
		t.Fatal(err)
	}
	if f, _ := e.CVFile(second); f.Name == "My CV.pdf" || !strings.HasSuffix(f.Name, ".docx") {
		t.Fatalf("after dropping it: %q", f.Name)
	}

	// An offer moves the role to the offer stage and keeps the advice.
	e.S.SetStage(second, "interview")
	if err := e.WeighOffer(ctx, second, "Base salary $126,000, 10% bonus, start 1 February."); err != nil {
		t.Fatal(err)
	}
	var offer OfferDoc
	if ok, _ := e.S.Doc(second, "offer", &offer); !ok || offer.Advice.Reply == "" {
		t.Fatalf("offer = %+v", offer)
	}
	if r, _ := e.S.Role(second); r.Stage != "offer" {
		t.Fatalf("stage = %q", r.Stage)
	}

	// A no gets a short reply to send.
	e.S.CloseRole(first, "rejected", "")
	if err := e.WriteNoReply(ctx, first); err != nil {
		t.Fatal(err)
	}
	var no NoReply
	if ok, _ := e.S.Doc(first, "noreply", &no); !ok || no.Body == "" {
		t.Fatalf("reply = %+v", no)
	}
}

func TestKeywordsAndReadable(t *testing.T) {
	kw := Keywords([]string{"Vertex", "e-invoicing", "ONESOURCE", "vertex", "SAP S/4HANA"}, "Led Vertex rollout. Built e invoicing on SAP S/4HANA.")
	if len(kw) != 4 {
		t.Fatalf("a word twice counts once: %+v", kw)
	}
	want := map[string]bool{"Vertex": true, "e-invoicing": true, "ONESOURCE": false, "SAP S/4HANA": true}
	for _, k := range kw {
		if want[k.Word] != k.In {
			t.Fatalf("%q in = %v", k.Word, k.In)
		}
	}

	c := cv.CV{Name: "Sam", Contact: cv.Contact{Email: "sam@example.com"}, Sections: []cv.Section{{Title: "Experience", Kind: "experience", Items: []cv.Item{{Heading: "Manager", Org: "Northwind", Bullets: []string{"Did things ★"}}}}}}
	notes := Readable(c)
	var bad []string
	for _, n := range notes {
		if n.Bad {
			bad = append(bad, n.Text)
		}
	}
	got := strings.Join(bad, " | ")
	for _, w := range []string{"phone", "no dates", "words", "symbols"} {
		if !strings.Contains(got, w) {
			t.Fatalf("missing %q in %q", w, got)
		}
	}
	if strings.Contains(got, "e-mail") {
		t.Fatal("the e-mail is there")
	}
}

func TestKit(t *testing.T) {
	p := store.Profile{Name: "Sam Rivera", City: "Toronto", Country: "Canada", WorkStatus: "permit", Years: 11}
	c := cv.CV{Name: "Sam Rivera", Contact: cv.Contact{Email: "sam@example.com", Phone: "+1 555 0100", Links: []string{"linkedin.com/in/sam"}},
		Sections: []cv.Section{{Kind: "experience", Items: []cv.Item{{Heading: "Tax Technology Manager", Org: "Northwind", Dates: "2019 - Present", Bullets: []string{"Led Vertex"}}}}, {Kind: "education", Items: []cv.Item{{Heading: "BCom", Dates: "2011 - 2015"}}}}}
	k := MakeKit(p, c)
	got := map[string]string{}
	for _, l := range k.Lines {
		got[l.Label] = l.Value
	}
	if got["First name"] != "Sam" || got["Last name"] != "Rivera" || got["LinkedIn"] != "linkedin.com/in/sam" || got["Right to work"] != "Work permit (Canada)" || got["Current title"] != "Tax Technology Manager, Northwind" || got["City"] != "Toronto, Canada" {
		t.Fatalf("kit = %+v", got)
	}
	// Dates read as an entry of their own belong to the one before.
	c.Sections[0].Items = []cv.Item{{Heading: "Manager", Org: "Northwind"}, {Dates: "2019 - Present", Bullets: []string{"Led Vertex"}}}
	if k := MakeKit(p, c); len(k.Jobs) != 1 || k.Jobs[0].Dates != "2019 - Present" || k.Jobs[0].Bullets != "Led Vertex" {
		t.Fatalf("loose dates: %+v", k.Jobs)
	}
	for _, n := range Readable(c) {
		if strings.Contains(n.Text, "no dates") {
			t.Fatal("the dates are there, on the next line")
		}
	}
	if len(k.Jobs) != 1 || k.Jobs[0].Bullets != "Led Vertex" || len(k.Study) != 1 {
		t.Fatalf("jobs = %+v study = %+v", k.Jobs, k.Study)
	}
}

func TestOwnSite(t *testing.T) {
	for _, c := range []struct {
		url, site string
		own       bool
	}{
		{"https://careers.acme.com/jobs/123", "https://www.acme.com", true},
		{"https://acme.wd3.myworkdayjobs.com/en-US/External/job/123", "", true},
		{"https://boards.greenhouse.io/acme/jobs/1", "", true},
		{"https://www.linkedin.com/jobs/view/123", "acme.com", false},
		{"https://ca.indeed.com/viewjob?jk=1", "acme.com", false},
		{"https://acme.com.evil.example/jobs", "acme.com", false},
		{"javascript:alert(1)", "acme.com", false},
		{"https://careers.acme.com/x", "acme.com", true},
	} {
		if got := OnOwnSite(c.url, c.site); got != c.own {
			t.Errorf("%s (site %s) = %v", c.url, c.site, got)
		}
	}

	e, _ := newEngine(t)
	co := setUp(t, e)
	board, _ := e.S.AddRole(store.Role{CompanyID: co.ID, Key: "li-1", Source: "linkedin", Title: "Tax Technology Manager", URL: "https://www.linkedin.com/jobs/view/1"})
	r, _ := e.S.Role(board)
	if !NeedsOwnSite(r, co.Site) {
		t.Fatal("a LinkedIn role is worth finding on the employer's own site")
	}
	if e.OwnSiteFromSearches(r) != "" {
		t.Fatal("nothing found yet")
	}
	e.S.AddRole(store.Role{CompanyID: co.ID, Key: "gh-9", Source: "greenhouse", Title: "Tax Technology Manager", URL: "https://boards.greenhouse.io/acme/jobs/9"})
	if got := e.OwnSiteFromSearches(r); got != "https://boards.greenhouse.io/acme/jobs/9" {
		t.Fatalf("own site = %q", got)
	}
	own, _ := e.S.Role(board + 1)
	if NeedsOwnSite(own, co.Site) {
		t.Fatal("a role from the employer's own board needs nothing more")
	}
}
