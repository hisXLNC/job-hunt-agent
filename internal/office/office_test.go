package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"jobhunt/internal/cv"
)

func sample() cv.CV {
	return cv.CV{
		Name:     "Sam Rivera",
		Headline: "Tax policy lead who builds the systems that administer it",
		Contact:  cv.Contact{Email: "sam@example.com", Phone: "+1 416 555 0100", Location: "Toronto, ON", Links: []string{"linkedin.com/in/samrivera"}},
		Summary:  "Twelve years in tax administration & policy <design>, most recently leading a minimum-tax programme.",
		Sections: []cv.Section{
			{Title: "Experience", Kind: "experience", Items: []cv.Item{
				{Heading: "Financial Specialist (Digital Services)", Org: "Ministry of Finance", Dates: "2019 – Present", Location: "Kuwait City",
					Bullets: []string{"Delivered registration and filing services for a new minimum tax", "Ran a system administering $1.4B a year"}},
				{Heading: "Analyst", Org: "Revenue Office", Dates: "2014 – 2019", Text: "Policy analysis for indirect taxes."},
			}},
			{Title: "Education", Kind: "education", Items: []cv.Item{{Heading: "MSc Public Policy", Org: "Some University", Dates: "2013"}}},
			{Title: "Skills", Kind: "skills", Items: []cv.Item{{Heading: "Tools", Text: "SQL, Power BI"}, {Text: "Arabic \"native\", English fluent ☺ عربى"}}},
		},
	}
}

func wellFormed(t *testing.T, data []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	parts := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		parts[f.Name] = string(b)
		dec := xml.NewDecoder(bytes.NewReader(b))
		for {
			if _, err := dec.Token(); err == io.EOF {
				break
			} else if err != nil {
				t.Fatalf("%s is not well-formed XML: %v", f.Name, err)
			}
		}
	}
	for _, need := range []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"} {
		if parts[need] == "" {
			t.Fatalf("missing part %s", need)
		}
	}
	return parts
}

func TestRenderCVRoundTrip(t *testing.T) {
	c := sample()
	data, err := RenderCV(c)
	if err != nil {
		t.Fatal(err)
	}
	again, _ := RenderCV(c)
	if !bytes.Equal(data, again) {
		t.Fatal("the same CV rendered to different bytes")
	}
	parts := wellFormed(t, data)
	if strings.Contains(parts["word/document.xml"], "<w:tbl") {
		t.Fatal("CVs must not use tables")
	}
	text, err := ExtractText("cv.docx", data)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Sam Rivera", "Tax policy lead", "Toronto, ON | sam@example.com", "policy <design>", "Experience",
		"Financial Specialist (Digital Services), Ministry of Finance, Kuwait City\t2019 – Present",
		"- Delivered registration and filing services for a new minimum tax", "- Ran a system administering $1.4B a year",
		"Analyst, Revenue Office\t2014 – 2019", "Policy analysis for indirect taxes.", "MSc Public Policy, Some University\t2013",
		"Tools: SQL, Power BI", `Arabic "native", English fluent ☺ عربى`}
	pos := 0
	for _, w := range want {
		i := strings.Index(text[pos:], w)
		if i < 0 {
			t.Fatalf("missing or out of order: %q\n---\n%s", w, text)
		}
		pos += i
	}
}

func TestRenderEmptyAndOddText(t *testing.T) {
	if data, err := RenderCV(cv.CV{}); err != nil {
		t.Fatal(err)
	} else {
		wellFormed(t, data)
	}
	c := cv.CV{Name: "A\x00B\x01 & <C>", Sections: []cv.Section{{Title: "X", Items: []cv.Item{{Text: "line\none\ttab ￾ end"}}}}}
	data, err := RenderCV(c)
	if err != nil {
		t.Fatal(err)
	}
	wellFormed(t, data)
	text, _ := ExtractText("x.docx", data)
	if !strings.Contains(text, "AB & <C>") {
		t.Fatalf("got %q", text)
	}
}

func TestRenderLetter(t *testing.T) {
	data, err := RenderLetter(Letter{
		Name: "Sam Rivera", Contact: []string{"Toronto", "sam@example.com"}, Date: "23 November 2026",
		To: []string{"Hiring team", "Example Corp"}, Subject: "Senior Manager, Tax",
		Body: "First paragraph\nstill first.\n\nSecond:\n- one\n- two\n\nThird.", Sign: "Sincerely,",
	})
	if err != nil {
		t.Fatal(err)
	}
	wellFormed(t, data)
	text, _ := ExtractText("l.docx", data)
	for _, w := range []string{"Sam Rivera", "23 November 2026", "Example Corp", "Senior Manager, Tax", "First paragraph still first.", "Second:", "- one", "- two", "Third.", "Sincerely,"} {
		if !strings.Contains(text, w) {
			t.Fatalf("missing %q in\n%s", w, text)
		}
	}
}

// docxWith builds a small .docx around the given body XML.
func docxWith(body string, extra map[string]string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("word/document.xml")
	fmt.Fprintf(w, `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>%s</w:body></w:document>`, body)
	for name, data := range extra {
		w, _ := zw.Create(name)
		w.Write([]byte(data))
	}
	zw.Close()
	return buf.Bytes()
}

func TestReadDocxFeatures(t *testing.T) {
	body := `<w:p><w:r><w:t>Jane</w:t></w:r><w:r><w:t xml:space="preserve"> Doe</w:t></w:r></w:p>` +
		`<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Led a team</w:t></w:r></w:p>` +
		`<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Removed</w:delText></w:r></w:del></w:p>` +
		`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>2019</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Manager</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
		`<w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>In a box</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p><w:r><w:t>In a box</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>` +
		`<w:p><w:r><w:t>Title</w:t><w:tab/><w:t>2020</w:t></w:r></w:p>`
	header := `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>jane@example.com</w:t></w:r></w:p></w:hdr>`
	text, err := ExtractText("cv.doc", docxWith(body, map[string]string{"word/header1.xml": header}))
	if err != nil {
		t.Fatal(err)
	}
	want := "jane@example.com\nJane Doe\n- Led a team\nKept\n2019 | Manager\nIn a box\nTitle\t2020"
	if text != want {
		t.Fatalf("got:\n%q\nwant:\n%q", text, want)
	}
}

func TestPlainTextAndRefusals(t *testing.T) {
	text, err := ExtractText("cv.txt", append([]byte{0xEF, 0xBB, 0xBF}, []byte("Name\r\n\r\n\r\n• First\r\n• Second  point\r\n")...))
	if err != nil || text != "Name\n\n- First\n- Second point" {
		t.Fatalf("got %q, %v", text, err)
	}
	text, _ = ExtractText("cv.txt", []byte{'c', 'a', 'f', 0xE9, ' ', 0x93, 'x', 0x94})
	if text != "café “x”" {
		t.Fatalf("windows-1252: got %q", text)
	}
	if _, err := ExtractText("old.doc", []byte{0xD0, 0xCF, 0x11, 0xE0, 1, 2, 3}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("old .doc: %v", err)
	}
	if _, err := ExtractText("x.pdf", []byte("%PDF-1.4 garbage")); err == nil {
		t.Fatal("garbage PDF should be an error")
	}
	if _, err := ExtractText("x.docx", []byte("PK\x03\x04 not really")); err == nil {
		t.Fatal("garbage docx should be an error")
	}
	if _, err := ExtractText("x.png", []byte("hello")); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("png: %v", err)
	}
}

// tinyPDF builds a one-page PDF with the given lines of text.
func tinyPDF(lines []string) []byte {
	var content strings.Builder
	content.WriteString("BT /F1 11 Tf 72 734 Td\n")
	for _, l := range lines {
		l = strings.NewReplacer(`\`, `\\`, "(", `\(`, ")", `\)`).Replace(l)
		content.WriteString("0 -14 Td (" + l + ") Tj\n")
	}
	content.WriteString("ET")
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", content.Len(), content.String()),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	var offsets []int
	for i, o := range objs {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

func TestReadPDF(t *testing.T) {
	var lines []string
	lines = append(lines, "Sam Rivera", "Senior Tax Policy Lead")
	for i := 0; i < 12; i++ {
		lines = append(lines, fmt.Sprintf("Delivered programme number %d across several ministries", i))
	}
	text, err := ExtractText("cv.pdf", tinyPDF(lines))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(text, "Sam Rivera\nSenior Tax Policy Lead\nDelivered programme number 0") {
		t.Fatalf("got:\n%s", text)
	}
	if _, err := ExtractText("scan.pdf", tinyPDF([]string{"x"})); err == nil || !strings.Contains(err.Error(), "scan") {
		t.Fatalf("near-empty PDF should be reported as a scan, got %v", err)
	}
}
