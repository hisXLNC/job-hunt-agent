package sources

import (
	"html"
	"regexp"
	"strings"
	"unicode"
)

var workplaceRE = regexp.MustCompile(`\b(hybrid|remote|on[- ]?site|in[- ]office|in[- ]person)\b`)

// HTMLToText turns posting HTML into plain text: scripts and styles are
// dropped, paragraphs are separated by a blank line, <br> and block elements
// become line breaks, list items become "- " lines, entities are decoded and
// runs of whitespace collapse. Text without any markup keeps its own line
// breaks.
func HTMLToText(s string) string {
	toks := tokenize(s)
	markup := false
	for _, t := range toks {
		if t.kind == tokStart || t.kind == tokEnd {
			markup = true
			break
		}
	}
	if !markup {
		return tidyText(html.UnescapeString(s))
	}

	var w textWriter
	for _, t := range toks {
		switch t.kind {
		case tokText:
			w.text(html.UnescapeString(t.raw))
		case tokStart:
			w.open(t.name)
		case tokEnd:
			w.close(t.name)
		}
	}
	return w.b.String()
}

// textWriter lays text out lazily: line breaks, spaces and list markers are
// only written once a word follows, so the result never has leading,
// trailing or doubled blank space.
type textWriter struct {
	b      strings.Builder
	breaks int    // line breaks owed before the next word, at most 2
	space  bool   // a space is owed before the next word
	bullet string // a list marker is owed before the next word
	lists  int    // how deep inside <ul>/<ol> we are
}

// atLeast asks for n line breaks before the next word.
func (w *textWriter) atLeast(n int) {
	w.breaks = max(w.breaks, n)
	w.space = false
}

func (w *textWriter) open(tag string) {
	switch tag {
	case "br":
		w.breaks = min(w.breaks+1, 2)
		w.space = false
	case "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "pre", "hr", "dl":
		w.atLeast(2)
	case "ul", "ol":
		w.lists++
		w.atLeast(1)
	case "li":
		w.atLeast(1)
		w.bullet = strings.Repeat("  ", max(w.lists-1, 0)) + "- "
	case "div", "section", "article", "header", "footer", "aside", "main", "tr", "dt", "dd":
		w.atLeast(1)
	case "td", "th":
		w.space = true
	}
}

func (w *textWriter) close(tag string) {
	switch tag {
	case "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "pre", "dl":
		w.atLeast(2)
	case "ul", "ol":
		w.lists = max(w.lists-1, 0)
		w.bullet = ""
		if w.lists == 0 {
			w.atLeast(2)
		} else {
			w.atLeast(1)
		}
	case "li", "div", "section", "article", "header", "footer", "aside", "main", "tr", "dt", "dd":
		w.atLeast(1)
	case "td", "th":
		w.space = true
	}
}

func (w *textWriter) text(s string) {
	s = strings.Map(dropInvisible, s)
	if s == "" {
		return
	}
	words := strings.FieldsFunc(s, isBlank)
	if len(words) == 0 || isBlank(firstRune(s)) {
		w.space = true
	}
	for i, word := range words {
		if i > 0 {
			w.space = true
		}
		w.word(word)
	}
	if len(words) > 0 {
		w.space = isBlank(lastRune(s))
	}
}

func (w *textWriter) word(s string) {
	switch {
	case w.b.Len() == 0:
		// Nothing to separate from yet.
	case w.breaks > 0:
		w.b.WriteString("\n\n"[:w.breaks])
	case w.space:
		w.b.WriteByte(' ')
	}
	w.breaks, w.space = 0, false
	if w.bullet != "" {
		w.b.WriteString(w.bullet)
		w.bullet = ""
	}
	w.b.WriteString(s)
}

// tidyText cleans text that is already plain: spaces collapse, lines are
// trimmed, and there is never more than one blank line in a row.
func tidyText(s string) string {
	s = strings.Map(dropInvisible, strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(s))
	var out []string
	blank := false
	for line := range strings.SplitSeq(s, "\n") {
		line = strings.Join(strings.FieldsFunc(line, isBlank), " ")
		if line == "" {
			blank = len(out) > 0
			continue
		}
		if blank {
			out = append(out, "")
			blank = false
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

// isBlank treats every Unicode space, including the non-breaking one, as a space.
func isBlank(r rune) bool { return unicode.IsSpace(r) }

// dropInvisible removes zero-width characters that postings are littered with.
func dropInvisible(r rune) rune {
	switch r {
	case 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF: // zero-width space, non-joiner, joiner, word joiner, byte order mark
		return -1
	}
	return r
}

func firstRune(s string) rune {
	for _, r := range s {
		return r
	}
	return 0
}

func lastRune(s string) rune {
	var last rune
	for _, r := range s {
		last = r
	}
	return last
}
