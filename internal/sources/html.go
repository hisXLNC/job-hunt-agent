package sources

import (
	"html"
	"strings"
)

// A small, forgiving HTML tokenizer. It is enough to turn posting HTML into
// text and to pick fields out of LinkedIn's fragments; it builds no tree and
// never fails, whatever it is fed.

type tokenKind uint8

const (
	tokText tokenKind = iota
	tokStart
	tokEnd
	tokComment
)

type token struct {
	kind tokenKind
	name string // start and end tags: the tag name, lower case
	// raw is the undecoded text of a text token, the body of a comment, or
	// the attribute source of a start tag.
	raw        string
	start, end int // byte range of the whole token in the source
}

// rawTextTags hold text that is never markup; their content is dropped.
var rawTextTags = map[string]bool{"script": true, "style": true}

// voidTags never have content or an end tag.
var voidTags = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true, "hr": true, "img": true,
	"input": true, "link": true, "meta": true, "source": true, "track": true, "wbr": true,
}

func isAlpha(c byte) bool { return c|0x20 >= 'a' && c|0x20 <= 'z' }

func isHTMLSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f'
}

// tagAt reports whether markup (a tag, comment or declaration) starts at src[i].
func tagAt(src string, i int) bool {
	if src[i] != '<' || i+1 >= len(src) {
		return false
	}
	switch c := src[i+1]; {
	case isAlpha(c), c == '!', c == '?':
		return true
	case c == '/':
		return i+2 < len(src) && isAlpha(src[i+2])
	}
	return false
}

// tokenize splits src into text, tags and comments.
func tokenize(src string) []token {
	var toks []token
	for i := 0; i < len(src); {
		if !tagAt(src, i) {
			j := i + 1
			for j < len(src) && !tagAt(src, j) {
				if k := strings.IndexByte(src[j:], '<'); k < 0 {
					j = len(src)
				} else if j += k; !tagAt(src, j) {
					j++
				}
			}
			toks = append(toks, token{kind: tokText, raw: src[i:j], start: i, end: j})
			i = j
			continue
		}
		switch {
		case strings.HasPrefix(src[i:], "<!--"):
			body, end := src[i+4:], len(src)
			if k := strings.Index(body, "-->"); k >= 0 {
				body, end = body[:k], i+4+k+3
			}
			toks = append(toks, token{kind: tokComment, raw: body, start: i, end: end})
			i = end
		case src[i+1] == '!' || src[i+1] == '?': // doctype, CDATA, processing instruction
			i = closeAngle(src, i)
		case src[i+1] == '/':
			nameEnd := tagNameEnd(src, i+2)
			end := closeAngle(src, nameEnd)
			toks = append(toks, token{kind: tokEnd, name: strings.ToLower(src[i+2 : nameEnd]), start: i, end: end})
			i = end
		default:
			nameEnd := tagNameEnd(src, i+1)
			name := strings.ToLower(src[i+1 : nameEnd])
			attrEnd, end := startTagEnd(src, nameEnd)
			toks = append(toks, token{kind: tokStart, name: name, raw: src[nameEnd:attrEnd], start: i, end: end})
			i = end
			if rawTextTags[name] {
				i = rawTextEnd(src, i, name)
			}
		}
	}
	return toks
}

func tagNameEnd(src string, i int) int {
	for i < len(src) && !isHTMLSpace(src[i]) && src[i] != '>' && src[i] != '/' {
		i++
	}
	return i
}

// closeAngle returns the index just past the next '>' at or after i.
func closeAngle(src string, i int) int {
	if k := strings.IndexByte(src[i:], '>'); k >= 0 {
		return i + k + 1
	}
	return len(src)
}

// startTagEnd finds where a start tag's attributes end and where the tag
// itself ends. A '>' inside a quoted attribute value does not close the tag;
// a quote only opens a value straight after '=', so a stray apostrophe
// cannot swallow the rest of the document.
func startTagEnd(src string, i int) (attrEnd, end int) {
	var quote, prev byte
	for ; i < len(src); i++ {
		c := src[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case (c == '"' || c == '\'') && prev == '=':
			quote = c
		case c == '>':
			return i, i + 1
		}
		if !isHTMLSpace(c) {
			prev = c
		}
	}
	return len(src), len(src)
}

// rawTextEnd returns the index of the "</name" that closes a script or
// style element opened just before i (or the end of the source).
func rawTextEnd(src string, i int, name string) int {
	for i < len(src) {
		k := strings.Index(src[i:], "</")
		if k < 0 {
			break
		}
		i += k
		if rest := src[i+2:]; len(rest) >= len(name) && strings.EqualFold(rest[:len(name)], name) {
			return i
		}
		i += 2
	}
	return len(src)
}

// attr returns the decoded value of an attribute of a start tag, or "".
func (t token) attr(name string) string {
	if t.kind != tokStart {
		return ""
	}
	s := t.raw
	for i := 0; i < len(s); {
		for i < len(s) && (isHTMLSpace(s[i]) || s[i] == '/') {
			i++
		}
		keyStart := i
		for i < len(s) && !isHTMLSpace(s[i]) && s[i] != '=' && s[i] != '/' {
			i++
		}
		key := s[keyStart:i]
		for i < len(s) && isHTMLSpace(s[i]) {
			i++
		}
		val := ""
		if i < len(s) && s[i] == '=' {
			i++
			for i < len(s) && isHTMLSpace(s[i]) {
				i++
			}
			valStart := i
			if i < len(s) && (s[i] == '"' || s[i] == '\'') {
				quote := s[i]
				i++
				valStart = i
				for i < len(s) && s[i] != quote {
					i++
				}
				val = s[valStart:i]
				if i < len(s) {
					i++ // the closing quote
				}
			} else {
				for i < len(s) && !isHTMLSpace(s[i]) {
					i++
				}
				val = s[valStart:i]
			}
		}
		if key != "" && strings.EqualFold(key, name) {
			return html.UnescapeString(val)
		}
	}
	return ""
}

// hasClass reports whether a start tag carries the given class.
func (t token) hasClass(class string) bool {
	for c := range strings.FieldsSeq(t.attr("class")) {
		if c == class {
			return true
		}
	}
	return false
}

// htmlDoc is a tokenized document with a few element-level lookups.
type htmlDoc struct {
	src  string
	toks []token
}

func parseHTML(src string) htmlDoc { return htmlDoc{src: src, toks: tokenize(src)} }

// find returns the index of the first start tag in toks[lo:hi] that matches, or -1.
func (d htmlDoc) find(lo, hi int, match func(token) bool) int {
	for i := max(lo, 0); i < hi && i < len(d.toks); i++ {
		if d.toks[i].kind == tokStart && match(d.toks[i]) {
			return i
		}
	}
	return -1
}

// closeOf returns the index of the end tag matching the start tag at i. An
// element that is never closed runs to the end of the document.
func (d htmlDoc) closeOf(i int) int {
	name := d.toks[i].name
	if voidTags[name] {
		return i
	}
	depth := 1
	for j := i + 1; j < len(d.toks); j++ {
		if d.toks[j].name != name {
			continue
		}
		switch d.toks[j].kind {
		case tokStart:
			depth++
		case tokEnd:
			if depth--; depth == 0 {
				return j
			}
		}
	}
	return len(d.toks)
}

// text returns the text inside the element at i: entities decoded,
// whitespace collapsed to single spaces.
func (d htmlDoc) text(i int) string {
	var b strings.Builder
	for j, end := i+1, d.closeOf(i); j < end; j++ {
		if d.toks[j].kind == tokText {
			b.WriteString(d.toks[j].raw)
		}
	}
	return strings.Join(strings.FieldsFunc(html.UnescapeString(b.String()), isBlank), " ")
}

// inner returns the HTML source inside the element at i.
func (d htmlDoc) inner(i int) string {
	end, stop := d.closeOf(i), len(d.src)
	if end < len(d.toks) {
		stop = d.toks[end].start
	}
	if end == i || d.toks[i].end > stop {
		return ""
	}
	return d.src[d.toks[i].end:stop]
}

// textOf returns the text of the first element in toks[lo:hi] that matches, or "".
func (d htmlDoc) textOf(lo, hi int, match func(token) bool) string {
	if i := d.find(lo, hi, match); i >= 0 {
		return d.text(i)
	}
	return ""
}

// withClass matches start tags that carry any of the given classes.
func withClass(classes ...string) func(token) bool {
	return func(t token) bool {
		for _, c := range classes {
			if t.hasClass(c) {
				return true
			}
		}
		return false
	}
}
