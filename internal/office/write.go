package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"strings"
	"time"

	"jobhunt/internal/cv"
)

// The documents written here are plain on purpose: one column, real Word
// styles, real bullets, no tables, text boxes, headers or images. That is the
// form both a recruiter and an applicant-tracking system read without loss.

const (
	pageW      = 12240 // US Letter, in twentieths of a point
	pageH      = 15840
	cvMargin   = 1080 // 0.75 inch
	lettMargin = 1440 // 1 inch
)

type run struct {
	text         string
	bold, italic bool
}

// para is one paragraph in a named style; doc is a whole document as a list
// of them. The same list is written as a .docx here and as a PDF in pdf.go,
// so the two always say the same thing in the same order.
type para struct {
	style string
	runs  []run
}

type doc struct {
	paras  []para
	pic    *Picture // a signature picture, at the paragraph styled "SignPicture"
	title  string
	who    string
	margin int // page margin, in twentieths of a point
}

func esc(s string) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n':
			return r
		case r < 0x20, r == 0xFFFE, r == 0xFFFF, r >= 0xD800 && r <= 0xDFFF:
			return -1
		}
		return r
	}, s)
	var b bytes.Buffer
	xml.EscapeText(&b, []byte(s))
	return b.String()
}

func (d *doc) para(style string, runs ...run) {
	d.paras = append(d.paras, para{style, runs})
}

// xml is the body of the document in WordprocessingML.
func (d *doc) xml() string {
	var body strings.Builder
	for _, p := range d.paras {
		if p.style == "SignPicture" {
			if d.pic != nil {
				body.WriteString(d.pic.drawingXML())
			}
			continue
		}
		body.WriteString(`<w:p><w:pPr><w:pStyle w:val="` + p.style + `"/>`)
		if p.style == "ListParagraph" {
			// Said on the paragraph as well as in the style: some readers only look here.
			body.WriteString(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`)
		}
		body.WriteString(`</w:pPr>`)
		for _, r := range p.runs {
			if r.text == "" {
				continue
			}
			// A tab inside the text becomes a real tab, so dates line up on the right.
			for i, seg := range strings.Split(r.text, "\t") {
				if i > 0 {
					body.WriteString(`<w:r><w:tab/></w:r>`)
				}
				if seg == "" {
					continue
				}
				body.WriteString(`<w:r>`)
				if r.bold || r.italic {
					body.WriteString(`<w:rPr>`)
					if r.bold {
						body.WriteString(`<w:b/>`)
					}
					if r.italic {
						body.WriteString(`<w:i/>`)
					}
					body.WriteString(`</w:rPr>`)
				}
				body.WriteString(`<w:t xml:space="preserve">` + esc(strings.ReplaceAll(seg, "\n", " ")) + `</w:t></w:r>`)
			}
		}
		body.WriteString(`</w:p>`)
	}
	return body.String()
}

func clean(s string) string { return strings.Join(strings.Fields(s), " ") }

func joinNonEmpty(sep string, parts ...string) string {
	var keep []string
	for _, p := range parts {
		if p = clean(p); p != "" {
			keep = append(keep, p)
		}
	}
	return strings.Join(keep, sep)
}

// RenderCV writes a CV as a .docx.
func RenderCV(c cv.CV) ([]byte, error) { return cvDoc(c).docx() }

// cvDoc lays a CV out as paragraphs.
func cvDoc(c cv.CV) *doc {
	d := &doc{title: joinNonEmpty(" ", c.Name, "CV"), who: clean(c.Name), margin: cvMargin}
	if n := clean(c.Name); n != "" {
		d.para("Title", run{text: n})
	}
	if h := clean(c.Headline); h != "" {
		d.para("Subtitle", run{text: h})
	}
	contact := append([]string{c.Contact.Location, c.Contact.Email, c.Contact.Phone}, c.Contact.Links...)
	if line := joinNonEmpty("  |  ", contact...); line != "" {
		d.para("Contact", run{text: line})
	}
	if s := clean(c.Summary); s != "" {
		d.para("Summary", run{text: s})
	}
	for _, s := range c.Sections {
		if len(s.Items) == 0 {
			continue
		}
		if t := clean(s.Title); t != "" {
			d.para("Heading1", run{text: t})
		}
		for _, it := range s.Items {
			d.item(s.Kind, it)
		}
	}
	return d
}

func (d *doc) item(kind string, it cv.Item) {
	head, org, dates, loc, text := clean(it.Heading), clean(it.Org), clean(it.Dates), clean(it.Location), clean(it.Text)
	if kind == "skills" || (org == "" && dates == "" && loc == "" && len(it.Bullets) == 0) {
		// "Group: the skills" on one line, or just the text.
		switch {
		case head != "" && text != "":
			d.para("ItemText", run{text: head + ": ", bold: true}, run{text: text})
		case head != "":
			d.para("ItemText", run{text: head, bold: kind != "skills"})
		case text != "":
			d.para("ItemText", run{text: text})
		}
		for _, b := range it.Bullets {
			if b = clean(b); b != "" {
				d.para("ListParagraph", run{text: b})
			}
		}
		return
	}
	var runs []run
	rest := joinNonEmpty(", ", org, loc)
	switch {
	case head != "" && rest != "":
		runs = []run{{text: head, bold: true}, {text: ", " + rest}}
	case head != "":
		runs = []run{{text: head, bold: true}}
	default:
		runs = []run{{text: rest, bold: true}}
	}
	if dates != "" {
		runs = append(runs, run{text: "\t" + dates})
	}
	d.para("ItemHead", runs...)
	if text != "" {
		d.para("ItemText", run{text: text})
	}
	for _, b := range it.Bullets {
		if b = clean(b); b != "" {
			d.para("ListParagraph", run{text: b})
		}
	}
}

// Letter is a cover letter or a short one-page case.
type Letter struct {
	Name    string   // sender's name
	Contact []string // location, email, phone, link
	Date    string   // already formatted; "" leaves it out
	To      []string // addressee lines
	Subject string   // optional bold subject line
	Body    string   // paragraphs separated by blank lines; "- " lines are bullets
	Sign    string   // closing such as "Sincerely,"; "" for none
	// Signature, when set, is the person's own closing, one line each
	// ("Kind regards," / "Sam Rivera, CPA"); it takes the place of Sign and the name.
	Signature []string
	// Picture, when set, is the handwritten signature placed under the closing.
	Picture *Picture
}

// RenderLetter writes a letter as a .docx.
func RenderLetter(l Letter) ([]byte, error) { return letterDoc(l).docx() }

// letterDoc lays a letter out as paragraphs.
func letterDoc(l Letter) *doc {
	d := &doc{title: joinNonEmpty(" ", l.Name, "letter"), who: clean(l.Name), margin: lettMargin}
	if n := clean(l.Name); n != "" {
		d.para("LetterName", run{text: n})
	}
	if c := joinNonEmpty("  |  ", l.Contact...); c != "" {
		d.para("Contact", run{text: c})
	}
	if dt := clean(l.Date); dt != "" {
		d.para("LetterGap", run{text: dt})
	}
	first := true
	for _, to := range l.To {
		if to = clean(to); to != "" {
			style := "LetterLine"
			if first && l.Date == "" {
				style = "LetterGap"
			}
			d.para(style, run{text: to})
			first = false
		}
	}
	if s := clean(l.Subject); s != "" {
		d.para("LetterGap", run{text: s, bold: true})
	}
	gap := true
	for _, block := range strings.Split(strings.ReplaceAll(l.Body, "\r", ""), "\n\n") {
		var plain []string
		flush := func() {
			if t := clean(strings.Join(plain, " ")); t != "" {
				style := "LetterBody"
				if gap {
					style = "LetterFirst"
					gap = false
				}
				d.para(style, run{text: t})
			}
			plain = nil
		}
		for _, line := range strings.Split(block, "\n") {
			if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "- "); ok {
				flush()
				gap = false
				d.para("ListParagraph", run{text: clean(rest)})
			} else {
				plain = append(plain, line)
			}
		}
		flush()
	}
	var sig []string
	for _, line := range l.Signature {
		if line = clean(line); line != "" {
			sig = append(sig, line)
		}
	}
	if len(sig) == 0 {
		if s := clean(l.Sign); s != "" {
			sig = append(sig, s, clean(l.Name))
		}
	}
	if l.Picture != nil {
		d.pic = l.Picture
	}
	for i, line := range sig {
		if line == "" {
			continue
		}
		style := "LetterLine"
		if i == 0 {
			style = "LetterGap"
		}
		d.para(style, run{text: line})
		if i == 0 && d.pic != nil {
			d.para("SignPicture")
		}
	}
	return d
}

// ---- the package ----------------------------------------------------------------

const xmlHead = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n"

const contentTypes = xmlHead + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
	`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
	`<Default Extension="xml" ContentType="application/xml"/>` +
	`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
	`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
	`<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
	`<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>` +
	`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
	`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
	`</Types>`

const rootRels = xmlHead + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
	`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
	`</Relationships>`

const docRels = xmlHead + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
	`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>` +
	`</Relationships>`

const drawNS = `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`

const wNS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`

const settings = xmlHead + `<w:settings ` + wNS + `><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`

const numbering = xmlHead + `<w:numbering ` + wNS + `>` +
	`<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>` +
	`<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>` +
	`<w:pPr><w:ind w:left="288" w:hanging="216"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:hint="default"/></w:rPr></w:lvl>` +
	`</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`

// style builds one paragraph style. ppr and rpr are raw property XML.
func style(id, name, basedOn, ppr, rpr string) string {
	s := `<w:style w:type="paragraph" w:styleId="` + id + `"><w:name w:val="` + name + `"/>`
	if basedOn != "" {
		s += `<w:basedOn w:val="` + basedOn + `"/>`
	}
	s += `<w:qFormat/>`
	if ppr != "" {
		s += `<w:pPr>` + ppr + `</w:pPr>`
	}
	if rpr != "" {
		s += `<w:rPr>` + rpr + `</w:rPr>`
	}
	return s + `</w:style>`
}

func styles(textWidth int) string {
	sp := func(before, after int) string {
		return fmt.Sprintf(`<w:spacing w:before="%d" w:after="%d"/>`, before, after)
	}
	return xmlHead + `<w:styles ` + wNS + `>` +
		`<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Arial"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-CA"/></w:rPr></w:rPrDefault>` +
		`<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
		`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/></w:pPr></w:style>` +
		style("Title", "Title", "Normal", sp(0, 20), `<w:b/><w:sz w:val="40"/><w:szCs w:val="40"/>`) +
		style("Subtitle", "Subtitle", "Normal", sp(0, 30), `<w:sz w:val="23"/><w:szCs w:val="23"/><w:color w:val="333333"/>`) +
		style("Contact", "Contact", "Normal", sp(0, 0), `<w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="444444"/>`) +
		style("Summary", "Summary", "Normal", sp(140, 0), ``) +
		style("Heading1", "heading 1", "Normal", `<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="888888"/></w:pBdr>`+sp(220, 60)+`<w:outlineLvl w:val="0"/>`, `<w:b/><w:caps/><w:spacing w:val="20"/><w:sz w:val="22"/><w:szCs w:val="22"/>`) +
		style("ItemHead", "Item Head", "Normal", `<w:keepNext/><w:tabs><w:tab w:val="right" w:pos="`+fmt.Sprint(textWidth)+`"/></w:tabs>`+sp(110, 10), ``) +
		style("ItemText", "Item Text", "Normal", sp(20, 20), ``) +
		style("ListParagraph", "List Paragraph", "Normal", `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`+sp(0, 30)+`<w:ind w:left="288" w:hanging="216"/>`, ``) +
		style("LetterName", "Letter Name", "Normal", sp(0, 20), `<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/>`) +
		style("LetterGap", "Letter Gap", "Normal", `<w:spacing w:before="320" w:after="0" w:line="259" w:lineRule="auto"/>`, `<w:sz w:val="22"/><w:szCs w:val="22"/>`) +
		style("LetterLine", "Letter Line", "Normal", `<w:spacing w:before="0" w:after="0" w:line="259" w:lineRule="auto"/>`, `<w:sz w:val="22"/><w:szCs w:val="22"/>`) +
		style("LetterFirst", "Letter First", "Normal", `<w:spacing w:before="320" w:after="160" w:line="259" w:lineRule="auto"/>`, `<w:sz w:val="22"/><w:szCs w:val="22"/>`) +
		style("LetterBody", "Letter Body", "Normal", `<w:spacing w:before="0" w:after="160" w:line="259" w:lineRule="auto"/>`, `<w:sz w:val="22"/><w:szCs w:val="22"/>`) +
		`</w:styles>`
}

// A fixed moment, so the same input always gives the same bytes.
var epoch = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

func (d *doc) docx() ([]byte, error) {
	margin := d.margin
	document := xmlHead + `<w:document ` + wNS + ` ` + drawNS + `><w:body>` + d.xml() +
		fmt.Sprintf(`<w:sectPr><w:pgSz w:w="%d" w:h="%d"/><w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`, pageW, pageH, margin, margin, margin, margin) +
		`</w:body></w:document>`
	core := xmlHead + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`<dc:title>` + esc(d.title) + `</dc:title><dc:creator>` + esc(d.who) + `</dc:creator><cp:lastModifiedBy>` + esc(d.who) + `</cp:lastModifiedBy></cp:coreProperties>`
	app := xmlHead + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>`

	types, rels := contentTypes, docRels
	if d.pic != nil {
		types = strings.Replace(types, `<Default Extension="xml"`, `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="xml"`, 1)
		rels = strings.Replace(rels, `</Relationships>`, `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature.`+d.pic.mediaExt()+`"/></Relationships>`, 1)
	}
	parts := []struct{ name, data string }{
		{"[Content_Types].xml", types},
		{"_rels/.rels", rootRels},
		{"word/document.xml", document},
		{"word/_rels/document.xml.rels", rels},
		{"word/styles.xml", styles(pageW - 2*margin)},
		{"word/numbering.xml", numbering},
		{"word/settings.xml", settings},
		{"docProps/core.xml", core},
		{"docProps/app.xml", app},
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, p := range parts {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: p.name, Method: zip.Deflate, Modified: epoch})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(p.data)); err != nil {
			return nil, err
		}
	}
	if d.pic != nil {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: "word/media/signature." + d.pic.mediaExt(), Method: zip.Store, Modified: epoch})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(d.pic.Data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
