package office

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf16"

	"jobhunt/internal/cv"
)

// The PDFs written here are the same plain documents as the .docx files, laid
// out by this program itself: one column, real text (not pictures of text),
// the three Helvetica faces every PDF reader has built in. Nothing is
// embedded and no other program is run.

// RenderCVPDF writes a CV as a PDF.
func RenderCVPDF(c cv.CV) ([]byte, error) { return renderPDF(cvDoc(c)) }

// RenderLetterPDF writes a letter as a PDF.
func RenderLetterPDF(l Letter) ([]byte, error) { return renderPDF(letterDoc(l)) }

// RenderPackPDF writes the letter and then the CV as one PDF, each starting
// on its own page.
func RenderPackPDF(l Letter, c cv.CV) ([]byte, error) {
	ld, cd := letterDoc(l), cvDoc(c)
	ld.title = joinNonEmpty(" ", l.Name, "letter and CV")
	return renderPDF(ld, cd)
}

// PDFShows reports whether every letter and digit in s can be shown in these
// PDFs. Text in other alphabets (Arabic, Cyrillic, Chinese...) cannot; the
// Word file keeps it.
func PDFShows(s string) bool {
	for _, r := range s {
		if _, ok := winAnsiNear(r); !ok && (unicode.IsLetter(r) || unicode.IsNumber(r)) {
			return false
		}
	}
	return true
}

// ---- characters -------------------------------------------------------------------

// The built-in fonts are used with the WinAnsi (Windows-1252) character set.
// Everything from the outside is mapped into it: what it has is shown as is,
// what it lacks becomes the nearest thing it does have, the rest is left out.

var cp1252High = map[rune]byte{
	0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136,
	0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147,
	0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155,
	0x0153: 156, 0x017E: 158, 0x0178: 159,
}

// Latin letters with marks that WinAnsi lacks (U+0100 to U+017F), as the
// plain letter: "Łódź" reads "Lódz", which is how it is typed on a form anyway.
const latinExtA = "AaAaAa" + "CcCcCcCc" + "DdDd" + "EeEeEeEeEe" + "GgGgGgGg" + "HhHh" + "IiIiIiIiIi" + "Ii" + "Jj" + "Kkk" +
	"LlLlLlLlLl" + "NnNnNnnNn" + "OoOoOo" + "Oo" + "RrRrRr" + "SsSsSsSs" + "TtTtTt" + "UuUuUuUuUuUu" + "Ww" + "YyY" + "ZzZzZz" + "s"

var nearest = map[rune]string{
	0x0132: "IJ", 0x0133: "ij", 0x0218: "S", 0x0219: "s", 0x021A: "T", 0x021B: "t", 0x1E9E: "SS",
	// dashes, quotes and spaces
	0x2010: "-", 0x2011: "-", 0x2012: "–", 0x2015: "—", 0x2212: "-", 0x2032: "'", 0x2033: "\"", 0x2035: "'", 0x201B: "'", 0x201F: "\"",
	0x2028: " ", 0x2029: " ", 0x202F: " ", 0x205F: " ", 0x3000: " ", 0x2044: "/", 0x2215: "/", 0x2236: ":", 0x2024: ".", 0x2027: "·", 0x2219: "·", 0x22C5: "·",
	// bullets and ticks
	0x2023: "•", 0x2043: "-", 0x25E6: "•", 0x25AA: "•", 0x25AB: "•", 0x25A0: "•", 0x25A1: "•", 0x25CF: "•", 0x25CB: "•",
	0x25C6: "•", 0x25C7: "•", 0x25B8: "•", 0x25B6: "•", 0x25BA: "•", 0x27A2: "•", 0x27A4: "•", 0x2713: "•", 0x2714: "•",
	0x2611: "•", 0x2605: "*", 0x2606: "*", 0x2217: "*",
	// arrows and signs
	0x2192: "->", 0x2190: "<-", 0x21D2: "=>", 0x2794: "->", 0x279C: "->", 0x2264: "<=", 0x2265: ">=", 0x2260: "!=", 0x2248: "~", 0x221E: "infinity", 0x2116: "No.",
	// letters joined in print
	0xFB00: "ff", 0xFB01: "fi", 0xFB02: "fl", 0xFB03: "ffi", 0xFB04: "ffl",
}

// Marks that follow a letter (as text copied from a Mac often has them), and
// the letters they join with.
var joinMark = map[rune][2]string{
	0x0300: {"AEIOUaeiou", "ÀÈÌÒÙàèìòù"},
	0x0301: {"AEIOUYaeiouy", "ÁÉÍÓÚÝáéíóúý"},
	0x0302: {"AEIOUaeiou", "ÂÊÎÔÛâêîôû"},
	0x0303: {"ANOano", "ÃÑÕãñõ"},
	0x0308: {"AEIOUYaeiouy", "ÄËÏÖÜŸäëïöüÿ"},
	0x030A: {"Aa", "Åå"},
	0x0327: {"Cc", "Çç"},
	0x030C: {"SZsz", "ŠŽšž"},
}

// winAnsiOf gives the byte for a character WinAnsi has.
func winAnsiOf(r rune) (byte, bool) {
	switch {
	case r >= 0x20 && r < 0x7F, r >= 0xA0 && r <= 0xFF:
		return byte(r), true
	}
	b, ok := cp1252High[r]
	return b, ok
}

// winAnsiNear gives the bytes that stand for a character: itself where
// WinAnsi has it, else the nearest thing. It reports false for a character
// that has to be left out (other alphabets, pictures, marks on their own).
func winAnsiNear(r rune) ([]byte, bool) {
	if r == 0x00AD { // a place a word may break, not a character
		return nil, true
	}
	if b, ok := winAnsiOf(r); ok {
		return []byte{b}, true
	}
	switch {
	case r == '\t' || r == '\n' || r == '\r' || unicode.Is(unicode.Zs, r):
		return []byte{' '}, true
	case r >= 0x0100 && r <= 0x017F:
		return []byte{latinExtA[r-0x0100]}, true
	}
	near, ok := nearest[r]
	if !ok {
		return nil, false
	}
	var out []byte
	for _, n := range near {
		if b, ok := winAnsiOf(n); ok {
			out = append(out, b)
		}
	}
	return out, true
}

// winAnsi turns text into WinAnsi bytes.
func winAnsi(s string) []byte {
	out := make([]byte, 0, len(s))
	rs := []rune(s)
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		// A letter and the mark after it become the one letter.
		if i+1 < len(rs) {
			if m, ok := joinMark[rs[i+1]]; ok {
				if at := strings.IndexRune(m[0], r); at >= 0 && r < 0x80 {
					b, _ := winAnsiOf([]rune(m[1])[at])
					out = append(out, b)
					i++
					continue
				}
			}
		}
		b, _ := winAnsiNear(r)
		out = append(out, b...)
	}
	return out
}

// ---- how wide each character is ---------------------------------------------------

// Widths of the characters 32 to 255, in thousandths of the type size, from
// the fonts' published measurements. The slanted face has the upright widths.
var helvW = [224]uint16{
	278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
	556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
	1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
	667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
	333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
	556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
	556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
	0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
	278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
	400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
	667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
	722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
	556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
	556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
}

var helvBoldW = [224]uint16{
	278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
	556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
	975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
	667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
	333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
	611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
	556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
	0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
	278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
	400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
	722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
	722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
	556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
	611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
}

const (
	fRegular = iota
	fBold
	fOblique
)

func charW(font int, b byte) float64 {
	if b < 32 {
		return 0
	}
	if font == fBold {
		return float64(helvBoldW[b-32])
	}
	return float64(helvW[b-32])
}

// ---- how each kind of paragraph looks ----------------------------------------------

// The measures follow the .docx styles in write.go, a touch smaller because
// Helvetica runs wider than Calibri. Sizes and gaps are in points.
type pdfStyle struct {
	size          float64
	bold          bool
	gray          float64 // 0 is black
	before, after float64
	lead          float64 // line height as a multiple of the font's own; 0 means 1.05
	keep          bool    // never the last thing on a page
	caps          bool
	track         float64 // extra space between letters
	rule          bool    // a line underneath, across the page
	bullet        bool
}

var pdfStyles = map[string]pdfStyle{
	"Title":         {size: 19, bold: true, after: 2},
	"Subtitle":      {size: 11, gray: 0.2, after: 1.5},
	"Contact":       {size: 9, gray: 0.27},
	"Summary":       {size: 10, before: 7},
	"Heading1":      {size: 10.5, bold: true, caps: true, track: 0.6, before: 11, after: 4, keep: true, rule: true},
	"ItemHead":      {size: 10, before: 5.5, after: 0.5, keep: true},
	"ItemText":      {size: 10, before: 1, after: 1},
	"ListParagraph": {size: 10, after: 1.5, bullet: true},
	"LetterName":    {size: 15, bold: true, after: 1},
	"LetterGap":     {size: 10.5, before: 16, lead: 1.08},
	"LetterLine":    {size: 10.5, lead: 1.08},
	"LetterFirst":   {size: 10.5, before: 16, after: 8, lead: 1.08},
	"LetterBody":    {size: 10.5, after: 8, lead: 1.08},
}

const (
	pdfPageW   = 612.0 // US Letter, like the .docx
	pdfPageH   = 792.0
	bulletIn   = 14.4 // where a bullet's text starts
	bulletAt   = 3.6  // where the bullet itself sits
	tabGap     = 12.0 // least space between an entry's heading and its dates
	natural    = 1.2  // a font's own line height, as a multiple of its size
	ascent     = 0.718
	descent    = 0.207
	ruleBelow  = 2.2 // from the baseline down to a heading's line
	ruleWeight = 0.6
)

// ---- words and lines ----------------------------------------------------------------

type pdfSeg struct {
	b    []byte
	font int
}

type pdfWord struct {
	segs []pdfSeg
	w    float64
}

func segW(b []byte, font int, st pdfStyle) float64 {
	w := 0.0
	for _, c := range b {
		w += charW(font, c)*st.size/1000 + st.track
	}
	return w
}

// wordsOf cuts runs into words. A word can change face part-way ("Manager,"
// with the comma in the light face), so it is a list of pieces.
func wordsOf(runs []run, st pdfStyle) []pdfWord {
	var words []pdfWord
	var cur pdfWord
	flush := func() {
		if len(cur.segs) > 0 {
			words = append(words, cur)
			cur = pdfWord{}
		}
	}
	for _, r := range runs {
		font := fRegular
		switch {
		case r.bold || st.bold:
			font = fBold
		case r.italic:
			font = fOblique
		}
		text := r.text
		if st.caps {
			text = strings.ToUpper(text)
		}
		for _, c := range winAnsi(text) {
			if c == ' ' {
				flush()
				continue
			}
			if n := len(cur.segs); n > 0 && cur.segs[n-1].font == font {
				cur.segs[n-1].b = append(cur.segs[n-1].b, c)
			} else {
				cur.segs = append(cur.segs, pdfSeg{b: []byte{c}, font: font})
			}
			cur.w += charW(font, c)*st.size/1000 + st.track
		}
	}
	flush()
	return words
}

// chop cuts a word that is wider than a whole line (a long web address) into
// pieces that fit.
func chop(w pdfWord, width float64, st pdfStyle) []pdfWord {
	var out []pdfWord
	var cur pdfWord
	for _, s := range w.segs {
		for _, c := range s.b {
			cw := charW(s.font, c)*st.size/1000 + st.track
			if cur.w+cw > width && len(cur.segs) > 0 {
				out = append(out, cur)
				cur = pdfWord{}
			}
			if n := len(cur.segs); n > 0 && cur.segs[n-1].font == s.font {
				cur.segs[n-1].b = append(cur.segs[n-1].b, c)
			} else {
				cur.segs = append(cur.segs, pdfSeg{b: []byte{c}, font: s.font})
			}
			cur.w += cw
		}
	}
	if len(cur.segs) > 0 {
		out = append(out, cur)
	}
	return out
}

// wrap breaks words into lines: the first line is `first` wide, the rest `rest`.
func wrap(words []pdfWord, first, rest float64, st pdfStyle) [][]pdfWord {
	space := charW(fRegular, ' ')*st.size/1000 + st.track
	var lines [][]pdfWord
	var line []pdfWord
	width, used := first, 0.0
	for i := 0; i < len(words); i++ {
		w := words[i]
		if w.w > width && w.w > rest {
			// Too long for any line: cut it and carry on with the pieces.
			pieces := chop(w, max(rest, 20), st)
			words = append(words[:i], append(pieces, words[i+1:]...)...)
			w = words[i]
		}
		if len(lines) == 0 && len(line) == 0 && w.w > width {
			// Fits a full line but not the shortened first one: start on the second.
			lines = append(lines, nil)
			width = rest
		}
		need := w.w
		if len(line) > 0 {
			need += space
		}
		if used+need > width+0.01 && len(line) > 0 {
			lines = append(lines, line)
			line, used, width = nil, 0, rest
			need = w.w
		}
		line = append(line, w)
		used += need
	}
	if len(line) > 0 {
		lines = append(lines, line)
	}
	return lines
}

func lineW(line []pdfWord, st pdfStyle) float64 {
	space := charW(fRegular, ' ')*st.size/1000 + st.track
	w := 0.0
	for i, x := range line {
		if i > 0 {
			w += space
		}
		w += x.w
	}
	return w
}

// ---- pages ---------------------------------------------------------------------------

type pdfBuilder struct {
	pages  []*bytes.Buffer
	page   *bytes.Buffer
	y      float64 // top of the next line
	margin float64
	fresh  bool // nothing on this page yet
}

func (p *pdfBuilder) newPage() {
	p.page = &bytes.Buffer{}
	p.pages = append(p.pages, p.page)
	p.y = pdfPageH - p.margin
	p.fresh = true
}

func num(f float64) string {
	s := fmt.Sprintf("%.2f", f)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" || s == "-0" {
		return "0"
	}
	return s
}

// pdfString writes bytes as a PDF string.
func pdfString(b []byte) string {
	var out strings.Builder
	out.WriteByte('(')
	for _, c := range b {
		switch {
		case c == '(' || c == ')' || c == '\\':
			out.WriteByte('\\')
			out.WriteByte(c)
		case c < 32 || c > 126:
			fmt.Fprintf(&out, "\\%03o", c)
		default:
			out.WriteByte(c)
		}
	}
	out.WriteByte(')')
	return out.String()
}

// text draws one line of words starting at x on the given baseline.
func (p *pdfBuilder) text(line []pdfWord, x, base float64, st pdfStyle) {
	if len(line) == 0 {
		return
	}
	// Join neighbouring pieces in the same face, spaces included, so a reader
	// that copies the text out gets whole words and sentences.
	var segs []pdfSeg
	add := func(font int, b ...byte) {
		if n := len(segs); n > 0 && segs[n-1].font == font {
			segs[n-1].b = append(segs[n-1].b, b...)
			return
		}
		segs = append(segs, pdfSeg{b: append([]byte(nil), b...), font: font})
	}
	for i, w := range line {
		if i > 0 {
			add(segs[len(segs)-1].font, ' ')
		}
		for _, s := range w.segs {
			add(s.font, s.b...)
		}
	}
	b := p.page
	if st.gray > 0 {
		fmt.Fprintf(b, "%s g\n", num(st.gray))
	}
	fmt.Fprintf(b, "BT\n%s %s Td\n", num(x), num(base))
	if st.track > 0 {
		fmt.Fprintf(b, "%s Tc\n", num(st.track))
	}
	for _, s := range segs {
		fmt.Fprintf(b, "/F%d %s Tf\n%s Tj\n", s.font+1, num(st.size), pdfString(s.b))
	}
	if st.track > 0 {
		b.WriteString("0 Tc\n") // letter spacing outlives the line unless it is put back
	}
	b.WriteString("ET\n")
	if st.gray > 0 {
		b.WriteString("0 g\n")
	}
	p.fresh = false
}

type laid struct {
	st    pdfStyle
	lines [][]pdfWord
	right []pdfWord // the part after a tab, set against the right margin
	lh    float64
}

func (l laid) height() float64 {
	h := float64(len(l.lines)) * l.lh
	if l.st.rule {
		h += ruleBelow
	}
	return h
}

func (p *pdfBuilder) lay(pa para, width float64) laid {
	st, ok := pdfStyles[pa.style]
	if !ok {
		st = pdfStyles["ItemText"]
	}
	lead := st.lead
	if lead == 0 {
		lead = 1.05
	}
	l := laid{st: st, lh: st.size * natural * lead}
	// What follows the first tab goes to the right margin: an entry's dates.
	var left, right []run
	tabbed := false
	for _, r := range pa.runs {
		if tabbed {
			right = append(right, r)
			continue
		}
		if a, b, ok := strings.Cut(r.text, "\t"); ok {
			tabbed = true
			left = append(left, run{text: a, bold: r.bold, italic: r.italic})
			right = append(right, run{text: b, bold: r.bold, italic: r.italic})
			continue
		}
		left = append(left, r)
	}
	first := width
	if st.bullet {
		width -= bulletIn
		first = width
	}
	if tabbed {
		l.right = wordsOf(right, st)
		if rw := lineW(l.right, st); rw > 0 && rw < width*0.6 {
			first = width - rw - tabGap
		} else {
			// Dates too long to share a line: they follow the heading as text.
			left = append(left, run{text: " "})
			left = append(left, right...)
			l.right = nil
		}
	}
	l.lines = wrap(wordsOf(left, st), first, width, st)
	if len(l.lines) == 0 && len(l.right) > 0 {
		l.lines = [][]pdfWord{nil}
	}
	return l
}

// add lays a whole document out, starting on a new page.
func (p *pdfBuilder) add(d *doc) {
	p.margin = float64(d.margin) / 20
	p.newPage()
	left, width := p.margin, pdfPageW-2*p.margin
	bottom := p.margin
	all := make([]laid, len(d.paras))
	for i, pa := range d.paras {
		all[i] = p.lay(pa, width)
	}
	for i, l := range all {
		if len(l.lines) == 0 {
			continue
		}
		st := l.st
		// A heading takes the start of what it heads with it to the next page.
		if st.keep && !p.fresh {
			need := st.before + l.height() + st.after
			for j := i + 1; j < len(all); j++ {
				n := all[j]
				if len(n.lines) == 0 {
					continue
				}
				if n.st.keep {
					need += n.st.before + n.height() + n.st.after
					continue
				}
				need += n.st.before + n.lh
				break
			}
			if p.y-need < bottom {
				p.newPage()
			}
		}
		if !p.fresh {
			p.y -= st.before
		}
		for n, line := range l.lines {
			if p.y-l.lh < bottom-0.01 && !p.fresh {
				p.newPage()
			}
			base := p.y - (l.lh-(ascent+descent)*st.size)/2 - ascent*st.size
			x := left
			if st.bullet {
				if n == 0 {
					p.text([]pdfWord{{segs: []pdfSeg{{b: []byte{149}, font: fRegular}}}}, left+bulletAt, base, st)
				}
				x += bulletIn
			}
			p.text(line, x, base, st)
			if n == 0 && len(l.right) > 0 {
				p.text(l.right, left+width-lineW(l.right, st), base, st)
			}
			p.y -= l.lh
			if st.rule && n == len(l.lines)-1 {
				ry := base - ruleBelow
				fmt.Fprintf(p.page, "%s w 0.53 G %s %s m %s %s l S 0 G\n", num(ruleWeight), num(left), num(ry), num(left+width), num(ry))
				p.y -= ruleBelow
			}
		}
		p.y -= st.after
	}
}

// ---- the file ---------------------------------------------------------------------------

// pdfText writes a title or a name the way a PDF keeps text outside a page.
func pdfText(s string) string {
	ascii := true
	for _, r := range s {
		if r < 32 || r > 126 {
			ascii = false
			break
		}
	}
	if ascii {
		return pdfString([]byte(s))
	}
	var b strings.Builder
	b.WriteString("<FEFF")
	for _, u := range utf16.Encode([]rune(s)) {
		fmt.Fprintf(&b, "%04X", u)
	}
	b.WriteString(">")
	return b.String()
}

func widthsArray(w *[224]uint16) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, x := range w {
		if i > 0 {
			b.WriteByte(' ')
		}
		fmt.Fprint(&b, x)
	}
	b.WriteByte(']')
	return b.String()
}

func renderPDF(docs ...*doc) ([]byte, error) {
	p := &pdfBuilder{}
	for _, d := range docs {
		p.add(d)
	}
	if len(p.pages) == 0 {
		p.margin = 72
		p.newPage()
	}

	// Objects 1 to 9 are the same in every file; pages follow in pairs.
	const first = 10
	objs := make([]string, 0, first+2*len(p.pages))
	objs = append(objs, "<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>")
	var kids strings.Builder
	for i := range p.pages {
		fmt.Fprintf(&kids, "%d 0 R ", first+2*i+1)
	}
	objs = append(objs, fmt.Sprintf("<< /Type /Pages /Count %d /Kids [ %s] >>", len(p.pages), kids.String()))
	fonts := []struct {
		name, box    string
		w            *[224]uint16
		flags, stemV int
		angle        int
	}{
		{"Helvetica", "[-166 -225 1000 931]", &helvW, 32, 88, 0},
		{"Helvetica-Bold", "[-170 -228 1003 962]", &helvBoldW, 32 | 262144, 140, 0},
		{"Helvetica-Oblique", "[-170 -225 1116 931]", &helvW, 32 | 64, 88, -12},
	}
	for i, f := range fonts {
		objs = append(objs, fmt.Sprintf("<< /Type /Font /Subtype /Type1 /BaseFont /%s /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths %s /FontDescriptor %d 0 R >>",
			f.name, widthsArray(f.w), 6+i))
	}
	for _, f := range fonts {
		objs = append(objs, fmt.Sprintf("<< /Type /FontDescriptor /FontName /%s /Flags %d /FontBBox %s /ItalicAngle %d /Ascent 718 /Descent -207 /CapHeight 718 /StemV %d >>",
			f.name, f.flags, f.box, f.angle, f.stemV))
	}
	title, who := "", ""
	if len(docs) > 0 {
		title, who = docs[0].title, docs[0].who
	}
	objs = append(objs, fmt.Sprintf("<< /Title %s /Author %s /Producer (Job Hunt) >>", pdfText(title), pdfText(who)))

	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
	var offsets []int
	write := func(n int, body []byte) {
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n", n)
		out.Write(body)
		out.WriteString("\nendobj\n")
	}
	for i, o := range objs {
		write(i+1, []byte(o))
	}
	for i, pg := range p.pages {
		var z bytes.Buffer
		zw, err := zlib.NewWriterLevel(&z, zlib.BestCompression)
		if err != nil {
			return nil, err
		}
		if _, err := zw.Write(pg.Bytes()); err != nil {
			return nil, err
		}
		if err := zw.Close(); err != nil {
			return nil, err
		}
		var stream bytes.Buffer
		fmt.Fprintf(&stream, "<< /Length %d /Filter /FlateDecode >>\nstream\n", z.Len())
		stream.Write(z.Bytes())
		stream.WriteString("\nendstream")
		write(first+2*i, stream.Bytes())
		write(first+2*i+1, []byte(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents %d 0 R >>",
			num(pdfPageW), num(pdfPageH), first+2*i)))
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, off := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R /Info 9 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	return out.Bytes(), nil
}
