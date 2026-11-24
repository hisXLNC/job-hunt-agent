package office

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/ledongthuc/pdf"

	"jobhunt/internal/cv"
)

// pdfPages reads a PDF back with the same reader CVs are read with, one
// string per page.
func pdfPages(t *testing.T, data []byte) []string {
	t.Helper()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("the PDF does not parse: %v", err)
	}
	var out []string
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			t.Fatalf("page %d is missing", i)
		}
		out = append(out, pageText(p.Content().Text))
	}
	return out
}

const longBullet = "Led the rollout of a tax engine across fourteen countries, two of them with mandatory e-invoicing, working with finance, legal and three outside vendors to bring month-end close down from nine working days to four without adding headcount"

func accented() cv.CV {
	c := sample()
	c.Name = "José Álvarez-Müller"
	c.Headline = "Tax lead — “systems that work”, not slides"
	c.Sections[0].Items[0].Bullets = append(c.Sections[0].Items[0].Bullets, longBullet, "Cut filing errors by 40 % in São Paulo, Zürich and Łódź")
	return c
}

func TestRenderCVPDF(t *testing.T) {
	c := accented()
	data, err := RenderCVPDF(c)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := RenderCVPDF(c); !bytes.Equal(data, again) {
		t.Fatal("the same CV rendered to different bytes")
	}
	if !bytes.HasPrefix(data, []byte("%PDF-1.4")) || !bytes.HasSuffix(bytes.TrimSpace(data), []byte("%%EOF")) {
		t.Fatal("not a PDF")
	}
	pages := pdfPages(t, data)
	if len(pages) != 1 {
		t.Fatalf("a short CV should fit one page, got %d", len(pages))
	}
	text := pages[0]
	// Headings are written in capitals, like the Word file shows them.
	want := []string{"José Álvarez-Müller", "Tax lead — “systems that work”, not slides", "Toronto, ON | sam@example.com", "policy <design>", "EXPERIENCE",
		"Financial Specialist (Digital Services), Ministry of Finance, Kuwait City", "2019 – Present",
		"• Delivered registration and filing services for a new minimum tax", "• Ran a system administering $1.4B a year",
		"• Led the rollout of a tax engine across fourteen countries", "São Paulo, Zürich and Lódz",
		"Analyst, Revenue Office", "Policy analysis for indirect taxes.", "MSc Public Policy, Some University", "Tools: SQL, Power BI", `Arabic "native", English fluent`}
	pos := 0
	for _, w := range want {
		i := strings.Index(text[pos:], w)
		if i < 0 {
			t.Fatalf("missing or out of order: %q\n---\n%s", w, text)
		}
		pos += i
	}
	// The long bullet wraps: its words are all there, over more than one line,
	// and no line runs past the right margin.
	flat := strings.Join(strings.Fields(text), " ")
	if !strings.Contains(flat, longBullet) {
		t.Fatalf("the long bullet lost words:\n%s", text)
	}
	lines := 0
	for _, l := range strings.Split(text, "\n") {
		if strings.Contains(longBullet, strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "•"))) && strings.TrimSpace(l) != "" {
			lines++
		}
	}
	if lines < 2 {
		t.Fatalf("the long bullet should take several lines, took %d", lines)
	}
	r, _ := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	for _, piece := range r.Page(1).Content().Text {
		if piece.X < 53 || piece.X+piece.W > 612-53 {
			t.Fatalf("%q sits outside the margins: x=%.1f w=%.1f", piece.S, piece.X, piece.W)
		}
	}
}

func TestPDFRunsOverPages(t *testing.T) {
	c := sample()
	for i := 0; i < 9; i++ {
		it := cv.Item{Heading: fmt.Sprintf("Manager %d", i), Org: "Example Corp", Dates: "2010 – 2012"}
		for j := 0; j < 7; j++ {
			it.Bullets = append(it.Bullets, fmt.Sprintf("Job %d point %d: delivered a programme across several ministries and reported the results to the board each quarter", i, j))
		}
		c.Sections[0].Items = append(c.Sections[0].Items, it)
	}
	data, err := RenderCVPDF(c)
	if err != nil {
		t.Fatal(err)
	}
	pages := pdfPages(t, data)
	if len(pages) < 2 {
		t.Fatalf("a long CV should run over pages, got %d", len(pages))
	}
	all := strings.Join(pages, "\n")
	for i := 0; i < 9; i++ {
		for j := 0; j < 7; j++ {
			if !strings.Contains(all, fmt.Sprintf("Job %d point %d:", i, j)) {
				t.Fatalf("job %d point %d is missing", i, j)
			}
		}
	}
	// A heading is never left alone at the foot of a page.
	for n, p := range pages[:len(pages)-1] {
		ls := strings.Split(strings.TrimSpace(p), "\n")
		if last := ls[len(ls)-1]; strings.Contains(last, "Manager") && strings.Contains(last, "Example Corp") {
			t.Fatalf("page %d ends with a heading: %q", n+1, last)
		}
	}
	r, _ := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	for i := 1; i <= r.NumPage(); i++ {
		for _, piece := range r.Page(i).Content().Text {
			if piece.Y < 53 || piece.Y > 792-53 {
				t.Fatalf("page %d: %q sits outside the margins at y=%.1f", i, piece.S, piece.Y)
			}
		}
	}
}

func testLetter() Letter {
	return Letter{
		Name: "Sam Rivera", Contact: []string{"Toronto", "sam@example.com"}, Date: "23 November 2026",
		To: []string{"Hiring team", "Example Corp"}, Subject: "Senior Manager, Tax",
		Body: "First paragraph\nstill first.\n\nSecond:\n- one\n- two\n\nThird (with brackets) and a back\\slash.", Sign: "Sincerely,",
	}
}

func TestRenderLetterPDFAndPack(t *testing.T) {
	l := testLetter()
	data, err := RenderLetterPDF(l)
	if err != nil {
		t.Fatal(err)
	}
	pages := pdfPages(t, data)
	if len(pages) != 1 {
		t.Fatalf("pages: %d", len(pages))
	}
	for _, w := range []string{"Sam Rivera", "23 November 2026", "Example Corp", "Senior Manager, Tax", "First paragraph still first.", "Second:", "• one", "• two", "Third (with brackets) and a back\\slash.", "Sincerely,"} {
		if !strings.Contains(pages[0], w) {
			t.Fatalf("missing %q in\n%s", w, pages[0])
		}
	}
	// The person's own closing takes the place of "Sincerely," and the name.
	l.Signature = []string{"Kind regards,", "Sam Rivera, CPA"}
	data, _ = RenderLetterPDF(l)
	if text := pdfPages(t, data)[0]; strings.Contains(text, "Sincerely") || !strings.Contains(text, "Kind regards,\nSam Rivera, CPA") {
		t.Fatalf("signature:\n%s", text)
	}
	docx, _ := RenderLetter(l)
	if text, _ := ExtractText("l.docx", docx); strings.Contains(text, "Sincerely") || !strings.Contains(text, "Kind regards,\nSam Rivera, CPA") {
		t.Fatalf("signature in the Word file:\n%s", text)
	}

	// Letter and CV in one file: the letter first, the CV starting on its own page.
	pack, err := RenderPackPDF(testLetter(), accented())
	if err != nil {
		t.Fatal(err)
	}
	pp := pdfPages(t, pack)
	if len(pp) != 2 || !strings.Contains(pp[0], "Dear") && !strings.Contains(pp[0], "First paragraph") || !strings.Contains(pp[1], "EXPERIENCE") || strings.Contains(pp[0], "EXPERIENCE") {
		t.Fatalf("pack pages: %d\n%s", len(pp), strings.Join(pp, "\n=====\n"))
	}
	// And the app's own CV reader takes it.
	if text, err := ExtractText("pack.pdf", pack); err != nil || !strings.Contains(text, "José Álvarez-Müller") {
		t.Fatalf("read back: %v\n%s", err, text)
	}
}

func TestPDFCharacters(t *testing.T) {
	for in, want := range map[string]string{
		"“curly” ‘quotes’":    "\x93curly\x94 \x91quotes\x92",
		"en – em — dots …":    "en \x96 em \x97 dots \x85",
		"café naïve Ærø":      "caf\xe9 na\xefve \xc6r\xf8",
		"école":              "\xe9cole", // a letter followed by its accent
		"Łukasz Żółć, Dvořák": "Lukasz Z\xf3lc, Dvor\xe1k",
		"€5 • ™":              "\x805 \x95 \x99",
		"a b c​d":             "a\xa0b cd",
		"x → y ≥ 3":           "x -> y >= 3",
		"ﬁnance ofﬁce":        "finance office",
		"soft­hyphen":         "softhyphen",
		"non‑breaking":        "non-breaking",
		"عربى ☺ ok":           "  ok",
		"✓ done":              "\x95 done",
		"tab\there\nnew":      "tab here new",
	} {
		if got := string(winAnsi(in)); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
	if !PDFShows("José “Pepe” Łukasz → 3 ☺") || PDFShows("Fluent in عربى") || PDFShows("Иван") {
		t.Fatal("PDFShows is wrong about what a PDF can show")
	}
	// Odd input never breaks the file.
	c := cv.CV{Name: "A\x00B (C) \\ D", Sections: []cv.Section{{Title: "X", Items: []cv.Item{{Text: strings.Repeat("https://example.com/a-very-long-address-with-no-spaces/", 6)}}}}}
	data, err := RenderCVPDF(c)
	if err != nil {
		t.Fatal(err)
	}
	if text := pdfPages(t, data)[0]; !strings.Contains(text, "AB (C) \\ D") {
		t.Fatalf("got %q", text)
	}
	if data, err := RenderCVPDF(cv.CV{}); err != nil || len(pdfPages(t, data)) != 1 {
		t.Fatalf("an empty CV should still be a one-page PDF: %v", err)
	}
}

// The width tables decide where lines break; a slip in them shows as text
// running past the margin.
func TestPDFWidths(t *testing.T) {
	st := pdfStyle{size: 10}
	for _, c := range []struct {
		s    string
		font int
		want float64
	}{{"Hello", fRegular, 22.78}, {"Hello", fBold, 24.45}, {"MW il", fRegular, 24.99}, {"é–•", fRegular, 14.62}} {
		if got := segW(winAnsi(c.s), c.font, st); got < c.want-0.011 || got > c.want+0.011 {
			t.Errorf("%q in face %d: %.2f, want %.2f", c.s, c.font, got, c.want)
		}
	}
	for i := range helvW {
		if (helvW[i] == 0) != (helvBoldW[i] == 0) {
			t.Errorf("character %d is in one table and not the other", i+32)
		}
	}
}
