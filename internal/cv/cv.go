// Package cv holds the structured form of a CV and the small, reversible
// edits ("changes") that tailoring makes to it.
//
// Every piece of text in a CV has a stable address, so a change can say
// exactly what it touched, be shown to the person, and be switched off again:
//
//	headline            the line under the name
//	summary             the opening paragraph
//	s2.title            title of section 2 (zero-based)
//	s2.i0.heading       heading of the first item in section 2 (usually a job title)
//	s2.i0.org           employer / school
//	s2.i0.text          free text of the item
//	s2.i0.b3            fourth bullet of the item
//	s2.i0.b+            a new bullet appended to the item
package cv

import (
	"fmt"
	"strconv"
	"strings"
)

type CV struct {
	Name     string    `json:"name"`
	Contact  Contact   `json:"contact"`
	Headline string    `json:"headline"`
	Summary  string    `json:"summary"`
	Sections []Section `json:"sections"`
}

type Contact struct {
	Email    string   `json:"email"`
	Phone    string   `json:"phone"`
	Location string   `json:"location"`
	Links    []string `json:"links"`
}

// Section kinds: "experience", "education", "skills", "other".
type Section struct {
	Title string `json:"title"`
	Kind  string `json:"kind"`
	Items []Item `json:"items"`
}

type Item struct {
	Heading  string   `json:"heading"`
	Org      string   `json:"org"`
	Dates    string   `json:"dates"`
	Location string   `json:"location"`
	Text     string   `json:"text"`
	Bullets  []string `json:"bullets"`
}

// Change is one edit to one addressed piece of text. After == "" on a bullet
// removes it. Off means the person switched the change off.
type Change struct {
	ID     string `json:"id"`
	Before string `json:"before"`
	After  string `json:"after"`
	Why    string `json:"why"`
	Off    bool   `json:"off,omitempty"`
}

// Unit is one addressed piece of text.
type Unit struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// Units lists every addressed piece of text, in reading order.
func Units(c CV) []Unit {
	var out []Unit
	add := func(id, t string) {
		if strings.TrimSpace(t) != "" {
			out = append(out, Unit{id, t})
		}
	}
	add("headline", c.Headline)
	add("summary", c.Summary)
	for si, s := range c.Sections {
		p := "s" + strconv.Itoa(si)
		for ii, it := range s.Items {
			q := p + ".i" + strconv.Itoa(ii)
			add(q+".heading", it.Heading)
			add(q+".org", it.Org)
			add(q+".text", it.Text)
			for bi, b := range it.Bullets {
				add(q+".b"+strconv.Itoa(bi), b)
			}
		}
	}
	return out
}

type addr struct {
	field        string // headline, summary, title, heading, org, text, bullet, newbullet
	sec, item, b int
}

func parse(id string) (addr, error) {
	switch id {
	case "headline", "summary":
		return addr{field: id}, nil
	}
	parts := strings.Split(id, ".")
	bad := fmt.Errorf("cv: bad address %q", id)
	num := func(s string, prefix byte) (int, bool) {
		if len(s) < 2 || s[0] != prefix {
			return 0, false
		}
		n, err := strconv.Atoi(s[1:])
		return n, err == nil && n >= 0
	}
	if len(parts) < 2 {
		return addr{}, bad
	}
	si, ok := num(parts[0], 's')
	if !ok {
		return addr{}, bad
	}
	if len(parts) == 2 && parts[1] == "title" {
		return addr{field: "title", sec: si}, nil
	}
	if len(parts) != 3 {
		return addr{}, bad
	}
	ii, ok := num(parts[1], 'i')
	if !ok {
		return addr{}, bad
	}
	a := addr{sec: si, item: ii}
	switch parts[2] {
	case "heading", "org", "text":
		a.field = parts[2]
		return a, nil
	case "b+":
		a.field = "newbullet"
		return a, nil
	}
	bi, ok := num(parts[2], 'b')
	if !ok {
		return addr{}, bad
	}
	a.field, a.b = "bullet", bi
	return a, nil
}

func (c *CV) slot(a addr) (*string, error) {
	switch a.field {
	case "headline":
		return &c.Headline, nil
	case "summary":
		return &c.Summary, nil
	}
	if a.sec >= len(c.Sections) {
		return nil, fmt.Errorf("cv: no section %d", a.sec)
	}
	s := &c.Sections[a.sec]
	if a.field == "title" {
		return &s.Title, nil
	}
	if a.item >= len(s.Items) {
		return nil, fmt.Errorf("cv: no item %d in section %d", a.item, a.sec)
	}
	it := &s.Items[a.item]
	switch a.field {
	case "heading":
		return &it.Heading, nil
	case "org":
		return &it.Org, nil
	case "text":
		return &it.Text, nil
	case "bullet":
		if a.b >= len(it.Bullets) {
			return nil, fmt.Errorf("cv: no bullet %d", a.b)
		}
		return &it.Bullets[a.b], nil
	}
	return nil, fmt.Errorf("cv: cannot address %q", a.field)
}

// Get returns the text at an address ("" for a new bullet).
func Get(c CV, id string) (string, error) {
	a, err := parse(id)
	if err != nil {
		return "", err
	}
	if a.field == "newbullet" {
		if a.sec >= len(c.Sections) || a.item >= len(c.Sections[a.sec].Items) {
			return "", fmt.Errorf("cv: no item for %q", id)
		}
		return "", nil
	}
	p, err := c.slot(a)
	if err != nil {
		return "", err
	}
	return *p, nil
}

// Clone returns a deep copy.
func Clone(c CV) CV {
	out := c
	out.Contact.Links = append([]string(nil), c.Contact.Links...)
	out.Sections = make([]Section, len(c.Sections))
	for i, s := range c.Sections {
		ns := s
		ns.Items = make([]Item, len(s.Items))
		for j, it := range s.Items {
			ni := it
			ni.Bullets = append([]string(nil), it.Bullets...)
			ns.Items[j] = ni
		}
		out.Sections[i] = ns
	}
	return out
}

// Apply returns a copy of the CV with every switched-on change made. Changes
// that no longer fit the CV are skipped and returned, never applied blindly.
func Apply(base CV, changes []Change) (CV, []Change) {
	out := Clone(base)
	var skipped []Change
	type removal struct{ sec, item, b int }
	var removals []removal
	for _, ch := range changes {
		if ch.Off {
			continue
		}
		a, err := parse(ch.ID)
		if err != nil {
			skipped = append(skipped, ch)
			continue
		}
		if a.field == "newbullet" {
			if a.sec >= len(out.Sections) || a.item >= len(out.Sections[a.sec].Items) || strings.TrimSpace(ch.After) == "" {
				skipped = append(skipped, ch)
				continue
			}
			it := &out.Sections[a.sec].Items[a.item]
			it.Bullets = append(it.Bullets, ch.After)
			continue
		}
		p, err := out.slot(a)
		if err != nil {
			skipped = append(skipped, ch)
			continue
		}
		if a.field == "bullet" && strings.TrimSpace(ch.After) == "" {
			removals = append(removals, removal{a.sec, a.item, a.b})
			continue
		}
		*p = ch.After
	}
	// Remove bullets last and from the end, so earlier addresses stay valid.
	for i := 0; i < len(removals); i++ {
		for j := i + 1; j < len(removals); j++ {
			if removals[j].b > removals[i].b {
				removals[i], removals[j] = removals[j], removals[i]
			}
		}
	}
	for _, r := range removals {
		it := &out.Sections[r.sec].Items[r.item]
		if r.b < len(it.Bullets) {
			it.Bullets = append(it.Bullets[:r.b], it.Bullets[r.b+1:]...)
		}
	}
	return out, skipped
}

// Text is the CV as plain text, the way a reader or a screening system sees it.
func Text(c CV) string {
	var b strings.Builder
	line := func(s string) {
		if strings.TrimSpace(s) != "" {
			b.WriteString(strings.TrimSpace(s))
			b.WriteByte('\n')
		}
	}
	line(c.Name)
	line(c.Headline)
	var contact []string
	for _, s := range append([]string{c.Contact.Location, c.Contact.Email, c.Contact.Phone}, c.Contact.Links...) {
		if strings.TrimSpace(s) != "" {
			contact = append(contact, strings.TrimSpace(s))
		}
	}
	line(strings.Join(contact, " | "))
	if c.Summary != "" {
		b.WriteByte('\n')
		line(c.Summary)
	}
	for _, s := range c.Sections {
		b.WriteByte('\n')
		line(strings.ToUpper(s.Title))
		for _, it := range s.Items {
			var head []string
			for _, h := range []string{it.Heading, it.Org, it.Location, it.Dates} {
				if strings.TrimSpace(h) != "" {
					head = append(head, strings.TrimSpace(h))
				}
			}
			line(strings.Join(head, " | "))
			line(it.Text)
			for _, bl := range it.Bullets {
				line("- " + bl)
			}
		}
	}
	return b.String()
}
