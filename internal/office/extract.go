package office

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// ErrUnsupported is returned for files Job Hunt can't read.
var ErrUnsupported = errors.New("office: this kind of file can't be read")

const maxPart = 30 << 20 // refuse absurdly large parts inside a .docx

// ExtractText returns the readable text of a CV file: .docx, .pdf, .txt or
// .md. Paragraphs are on their own lines and bullets start with "- ".
func ExtractText(filename string, data []byte) (string, error) {
	ext := strings.ToLower(path.Ext(strings.ReplaceAll(filename, `\`, "/")))
	switch {
	case bytes.HasPrefix(data, []byte("%PDF")):
		ext = ".pdf"
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		ext = ".docx"
	case bytes.HasPrefix(data, []byte{0xD0, 0xCF, 0x11, 0xE0}):
		return "", fmt.Errorf("%w: this is an old Word file (.doc). Open it in Word, choose Save As, and pick .docx or PDF", ErrUnsupported)
	case bytes.HasPrefix(data, []byte(`{\rtf`)):
		return "", fmt.Errorf("%w: this is a Rich Text file. Save it as .docx or PDF and add it again", ErrUnsupported)
	}
	var text string
	var err error
	switch ext {
	case ".docx":
		text, err = readDocx(data)
	case ".pdf":
		text, err = readPDF(data)
	case ".txt", ".md", ".text", "":
		text = decodeText(data)
	default:
		return "", fmt.Errorf("%w: %s files. Use .docx, PDF or plain text", ErrUnsupported, ext)
	}
	if err != nil {
		return "", err
	}
	text = tidy(text)
	if strings.TrimSpace(text) == "" {
		return "", errors.New("the file has no readable text")
	}
	return text, nil
}

// decodeText reads plain text as UTF-8, falling back to Windows-1252.
func decodeText(data []byte) string {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	if utf8.Valid(data) {
		return string(data)
	}
	var b strings.Builder
	for _, c := range data {
		if c < 0x80 {
			b.WriteByte(c)
		} else if r, ok := cp1252[c]; ok {
			b.WriteRune(r)
		} else {
			b.WriteRune(rune(c))
		}
	}
	return b.String()
}

var cp1252 = map[byte]rune{0x80: '€', 0x82: '‚', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™'}

var bulletGlyphs = "•▪●◦‣∙·■□▶➤➢*"

// tidy normalises spaces, bullets and blank lines.
func tidy(s string) string {
	s = strings.NewReplacer("\r\n", "\n", "\r", "\n", "\u00a0", " ", "\u2007", " ", "\u202f", " ", "\u200b", "", "\ufeff", "", "\u00ad", "").Replace(s)
	var out []string
	blank := 0
	for _, line := range strings.Split(s, "\n") {
		line = strings.Map(func(r rune) rune {
			if r == '\t' {
				return r
			}
			if r < 0x20 || r == 0x7f {
				return -1
			}
			return r
		}, line)
		line = strings.TrimRight(line, " \t")
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed != "" {
			first, size := utf8.DecodeRuneInString(trimmed)
			rest := trimmed[size:]
			if (strings.ContainsRune(bulletGlyphs, first) || first == '' || first == '' || first == '–') && (strings.HasPrefix(rest, " ") || strings.HasPrefix(rest, "\t")) {
				line = "- " + strings.TrimLeft(rest, " \t")
			}
		}
		for strings.Contains(line, "  ") {
			line = strings.ReplaceAll(line, "  ", " ")
		}
		if strings.TrimSpace(line) == "" {
			blank++
			if blank > 1 || len(out) == 0 {
				continue
			}
			out = append(out, "")
			continue
		}
		blank = 0
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// ---- .docx --------------------------------------------------------------------

func readDocx(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errors.New("the file is damaged or isn't a real Word document")
	}
	parts := map[string]*zip.File{}
	var headers []string
	for _, f := range zr.File {
		parts[f.Name] = f
		if strings.HasPrefix(f.Name, "word/header") && strings.HasSuffix(f.Name, ".xml") {
			headers = append(headers, f.Name)
		}
	}
	doc, ok := parts["word/document.xml"]
	if !ok {
		if _, odt := parts["content.xml"]; odt {
			return "", fmt.Errorf("%w: this is an OpenDocument file. Save it as .docx or PDF and add it again", ErrUnsupported)
		}
		return "", errors.New("the file is a zip but not a Word document")
	}
	sort.Strings(headers)
	var b strings.Builder
	seen := map[string]bool{}
	// People put their name and contact details in the page header.
	for _, h := range headers {
		t, err := docxPart(parts[h])
		if err != nil {
			continue
		}
		if t = strings.TrimSpace(t); t != "" && !seen[t] {
			seen[t] = true
			b.WriteString(t + "\n")
		}
	}
	body, err := docxPart(doc)
	if err != nil {
		return "", err
	}
	b.WriteString(body)
	return b.String(), nil
}

func docxPart(f *zip.File) (string, error) {
	if f.UncompressedSize64 > maxPart {
		return "", errors.New("the document is too large to read")
	}
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	dec := xml.NewDecoder(io.LimitReader(rc, maxPart))
	dec.Strict = false

	var out strings.Builder
	var para strings.Builder
	var cells []string
	inText := false
	list := false
	depth := 0      // paragraphs can nest: a text box sits inside a paragraph
	inner := false  // the current outer paragraph held a nested one
	skip := 0       // depth inside w:del or mc:Fallback
	tableDepth := 0 // nested tables read as part of their cell
	var cell strings.Builder

	endPara := func() {
		t := strings.TrimRight(para.String(), " ")
		para.Reset()
		depth--
		if depth > 0 {
			inner = true
		} else if inner {
			inner = false
			if strings.TrimSpace(t) == "" {
				list = false
				return
			}
		}
		if list && strings.TrimSpace(t) != "" {
			t = "- " + strings.TrimLeft(t, " \t")
		}
		list = false
		if tableDepth > 0 {
			if cell.Len() > 0 && strings.TrimSpace(t) != "" {
				cell.WriteString(" ")
			}
			cell.WriteString(strings.TrimSpace(t))
			return
		}
		out.WriteString(t + "\n")
	}

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break // keep what was read from a damaged file
		}
		switch t := tok.(type) {
		case xml.StartElement:
			name := t.Name.Local
			if skip > 0 {
				skip++
				continue
			}
			switch name {
			case "del", "Fallback", "moveFrom", "instrText", "delText":
				skip = 1
			case "p":
				// Text already gathered belongs to the outer paragraph; write
				// it before the nested one starts.
				if depth > 0 && strings.TrimSpace(para.String()) != "" {
					depth++
					endPara()
				}
				depth++
			case "t":
				inText = true
			case "tab":
				para.WriteByte('\t')
			case "br", "cr":
				para.WriteByte('\n')
			case "noBreakHyphen":
				para.WriteByte('-')
			case "numPr":
				list = true
			case "pStyle":
				for _, a := range t.Attr {
					if a.Name.Local == "val" {
						v := strings.ToLower(a.Value)
						if strings.Contains(v, "listbullet") || strings.Contains(v, "listnumber") || v == "bullet" || v == "listparagraph" {
							list = true
						}
					}
				}
			case "tbl":
				tableDepth++
			case "tr":
				if tableDepth == 1 {
					cells = cells[:0]
				}
			case "tc":
				if tableDepth == 1 {
					cell.Reset()
				}
			}
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				endPara()
			case "tc":
				if tableDepth == 1 {
					cells = append(cells, strings.TrimSpace(cell.String()))
				}
			case "tr":
				if tableDepth == 1 {
					var keep []string
					for _, c := range cells {
						if c != "" {
							keep = append(keep, c)
						}
					}
					if len(keep) > 0 {
						out.WriteString(strings.Join(keep, " | ") + "\n")
					}
				}
			case "tbl":
				tableDepth--
			}
		case xml.CharData:
			if inText && skip == 0 {
				para.Write(t)
			}
		}
	}
	if para.Len() > 0 {
		depth = 1
		endPara()
	}
	return out.String(), nil
}

// ---- .pdf ---------------------------------------------------------------------

func readPDF(data []byte) (text string, err error) {
	defer func() {
		if r := recover(); r != nil {
			text, err = "", errors.New("this PDF couldn't be read. Add the Word version instead")
		}
	}()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errors.New("this PDF couldn't be read. Add the Word version instead")
	}
	var b strings.Builder
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		b.WriteString(pageText(p.Content().Text))
		b.WriteString("\n")
	}
	out := joinWrapped(b.String())
	if len(strings.Join(strings.Fields(out), "")) < 200 {
		return "", errors.New("this PDF has almost no text in it; it is probably a scan. Add the Word version instead")
	}
	return out, nil
}

// pageText puts the pieces of text on a page back into lines: pieces at the
// same height are one line, read left to right, top line first.
func pageText(texts []pdf.Text) string {
	type line struct {
		y     float64
		parts []pdf.Text
	}
	var lines []*line
	for _, t := range texts {
		if t.S == "" {
			continue
		}
		tol := max(t.FontSize*0.45, 2)
		var hit *line
		for i := len(lines) - 1; i >= 0 && i >= len(lines)-6; i-- {
			if d := lines[i].y - t.Y; d < tol && d > -tol {
				hit = lines[i]
				break
			}
		}
		if hit == nil {
			hit = &line{y: t.Y}
			lines = append(lines, hit)
		}
		hit.parts = append(hit.parts, t)
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].y > lines[j].y })
	var b strings.Builder
	for _, l := range lines {
		sort.SliceStable(l.parts, func(i, j int) bool { return l.parts[i].X < l.parts[j].X })
		end := 0.0
		for i, t := range l.parts {
			size := max(t.FontSize, 6)
			// A visible gap between two pieces is a space; a wide one is a column.
			if gap := t.X - end; i > 0 && gap > size*0.2 && !strings.HasPrefix(t.S, " ") && !strings.HasSuffix(b.String(), " ") {
				if gap > size*3 {
					b.WriteByte('\t')
				} else {
					b.WriteByte(' ')
				}
			}
			b.WriteString(t.S)
			end = t.X + t.W
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// joinWrapped rejoins words that a PDF split with a hyphen at a line end.
func joinWrapped(s string) string {
	lines := strings.Split(s, "\n")
	var out []string
	for i := 0; i < len(lines); i++ {
		l := lines[i]
		for strings.HasSuffix(l, "-") && i+1 < len(lines) && len(l) > 2 && isLower(l[len(l)-2]) && len(lines[i+1]) > 0 && isLower(lines[i+1][0]) {
			l = l[:len(l)-1] + lines[i+1]
			i++
		}
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}

func isLower(c byte) bool { return c >= 'a' && c <= 'z' }
