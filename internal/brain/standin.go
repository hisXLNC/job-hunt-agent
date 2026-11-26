package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"jobhunt/internal/cv"
	"jobhunt/internal/llm"
)

// StandIn answers every task with simple rules instead of Claude. It exists
// so tests and the demo run without an account; its answers are plausible in
// shape, not in judgment.
func StandIn() llm.Engine {
	return llm.Func(func(ctx context.Context, req llm.Request) (llm.Response, error) {
		var out any
		switch req.Task {
		case "structure_cv":
			out = standStructure(req.Input.(string))
		case "propose_profile":
			out = standPropose(req.Input.(string))
		case "employers":
			out = map[string]any{"employers": standEmployers(req.Input.(Person))}
		case "employer_sites":
			out = map[string]any{"sites": standSites(req.Input.([]SiteAsk))}
		case "title_look":
			out = map[string]any{"keep": standTitleLook(req.Input.(titleLookInput))}
		case "about_employers":
			out = map[string]any{"employers": standAbout(req.Input.([]EmployerRef))}
		case "read_role":
			in := req.Input.(readInput)
			out = standRead(in.Person, in.Posting)
		case "read_roles":
			in := req.Input.(readGroupInput)
			var list []map[string]any
			for i, post := range in.Postings {
				list = append(list, map[string]any{"posting": i + 1, "reading": standRead(in.Person, post)})
			}
			out = map[string]any{"readings": list}
		case "indeed_search":
			out = standIndeed(req.Input.(IndeedQuery))
		case "tailor":
			out = standTailor(req.Input.(tailorInput))
		case "letter":
			in := req.Input.(letterInput)
			out = map[string]string{"letter": standLetter(in)}
		case "case":
			in := req.Input.(letterInput)
			out = Message{Subject: in.Posting.Title + ": two things I've already done", Body: standCase(in)}
		case "follow_up":
			out = standFollowUp(req.Input.(letterInput))
		case "note":
			out = standNote(req.Input.(noteInput))
		case "doors":
			out = map[string]any{"leads": standDoors(req.Input.(Person))}
		case "form_answers":
			out = map[string]any{"answers": standForm(req.Input.(formInput))}
		case "arriving":
			out = standArrive(req.Input.(tailorInput))
		case "prep":
			out = standPrep(req.Input.(prepInput))
		case "assist":
			out = standAssist(req.Input.(AssistInput))
		case "mail":
			out = standMail(req.Input.(mailInput))
		case "mail_reply":
			out = standMailReply(req.Input.(mailInput))
		case "senders":
			out = standSenders(req.Input.([]Sender))
		case "check_cv":
			out = standCheck(req.Input.(checkInput))
		case "offer":
			out = OfferAdvice{Terms: "Base $126,000 · bonus 10% · 3 weeks' holiday · hybrid, 3 days in", Base: 126000, Market: "About the middle of what this kind of role pays there (an estimate).",
				Asks: []string{"A base of $135,000: your experience is rare here", "A fourth week of holiday", "A start date that suits your move"}, Watch: []string{"The bonus is at the company's discretion"},
				Subject: "Thank you for the offer", Reply: "Dear Priya,\n\nThank you for the offer; I am very glad to have it and keen to join the team.\n\nBefore I sign, could we look at the base? Given the scope of the role, a base of $135,000 would let me accept straight away.\n\nKind regards"}
		case "rejection_reply":
			in := req.Input.(letterInput)
			out = Message{Subject: "Re: " + in.Posting.Title, Body: "Thank you for letting me know, and for the time you and the team gave my application.\n\nI enjoyed learning about " + in.Posting.Company + " and would welcome hearing about future roles that fit. If you have a moment, one line on what would have made the difference would help me.\n\nKind regards"}
		case "find_posting":
			out = Found{Note: "Sample answers cannot search the web."}
		case "career":
			out = standCareer(req.Input.(CareerInput))
		case "lead":
			out = standLead(req.Input.(leadInput))
		case "lead_note":
			out = standLeadNote(req.Input.(leadNoteInput))
		case "find_news":
			out = map[string]any{"news": standNews(req.Input.(NewsInput))}
		case "results":
			out = standResults(req.Input.(ResultsInput))
		case "reviews":
			out = Reviews{Rating: 3.9, Count: 412, Sources: []ReviewSource{{Name: "Glassdoor", Rating: 3.9, URL: "https://www.glassdoor.com/"}, {Name: "Indeed", Rating: 3.8, URL: "https://www.indeed.com/"}},
				Likes: []string{"Hybrid, two days in the office", "Steady work, good benefits"}, Warns: []string{"Slow decisions, many layers", "Pay rises below market"}}
		case "test", "indeed_connectors":
			out = map[string]string{"word": "ready"}
		default:
			return llm.Response{}, fmt.Errorf("stand-in: unknown task %q", req.Task)
		}
		b, err := json.Marshal(out)
		return llm.Response{Text: string(b), Model: "stand-in"}, err
	})
}

var (
	emailRe = regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`)
	phoneRe = regexp.MustCompile(`\+?\d[\d ()\-]{7,}\d`)
	dateRe  = regexp.MustCompile(`(?i)((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*[-–—to]+\s*(((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}|present|now|current)`)
	wordRe  = regexp.MustCompile(`[A-Za-z][A-Za-z+#.\-]{2,}`)
)

func sectionKind(title string) string {
	t := strings.ToLower(title)
	switch {
	case strings.Contains(t, "experience") || strings.Contains(t, "employment") || strings.Contains(t, "career") || strings.Contains(t, "work history"):
		return "experience"
	case strings.Contains(t, "education") || strings.Contains(t, "qualification") || strings.Contains(t, "certif"):
		return "education"
	case strings.Contains(t, "skill") || strings.Contains(t, "tools") || strings.Contains(t, "language") || strings.Contains(t, "competenc"):
		return "skills"
	}
	return "other"
}

func looksLikeTitle(line string) bool {
	l := strings.TrimSpace(line)
	if l == "" || len(l) > 40 || strings.HasPrefix(l, "-") {
		return false
	}
	low := strings.ToLower(l)
	for _, k := range []string{"experience", "employment", "education", "skills", "summary", "profile", "certifications", "languages", "projects", "publications", "career", "qualifications", "achievements", "interests", "tools"} {
		if strings.Contains(low, k) && len(strings.Fields(l)) <= 4 {
			return true
		}
	}
	return false
}

func standStructure(text string) cv.CV {
	var c cv.CV
	lines := strings.Split(strings.ReplaceAll(text, "\r", ""), "\n")
	var clean []string
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			clean = append(clean, strings.TrimSpace(l))
		}
	}
	if len(clean) == 0 {
		return c
	}
	c.Name = clean[0]
	i := 1
	// Lines before the first section title: headline, contact details, summary.
	for ; i < len(clean) && !looksLikeTitle(clean[i]); i++ {
		l := clean[i]
		switch {
		case emailRe.MatchString(l) || phoneRe.MatchString(l) || strings.Contains(strings.ToLower(l), "linkedin"):
			if m := emailRe.FindString(l); m != "" {
				c.Contact.Email = m
			}
			if m := phoneRe.FindString(l); m != "" {
				c.Contact.Phone = strings.TrimSpace(m)
			}
			for _, part := range strings.FieldsFunc(l, func(r rune) bool { return r == '|' || r == '·' || r == '•' }) {
				part = strings.TrimSpace(part)
				low := strings.ToLower(part)
				switch {
				case strings.Contains(low, "linkedin") || strings.HasPrefix(low, "http"):
					c.Contact.Links = append(c.Contact.Links, part)
				case emailRe.MatchString(part) || phoneRe.MatchString(part):
				case part != "" && c.Contact.Location == "":
					c.Contact.Location = part
				}
			}
		case c.Headline == "" && len(l) < 90:
			c.Headline = l
		default:
			c.Summary = strings.TrimSpace(c.Summary + " " + l)
		}
	}
	var sec *cv.Section
	var item *cv.Item
	flush := func() {
		if sec != nil && item != nil {
			sec.Items = append(sec.Items, *item)
			item = nil
		}
	}
	for ; i < len(clean); i++ {
		l := clean[i]
		if looksLikeTitle(l) {
			flush()
			if sec != nil {
				c.Sections = append(c.Sections, *sec)
			}
			sec = &cv.Section{Title: l, Kind: sectionKind(l)}
			if strings.Contains(strings.ToLower(l), "summary") || strings.Contains(strings.ToLower(l), "profile") {
				// A titled summary: take the following plain lines as the summary.
				for i+1 < len(clean) && !looksLikeTitle(clean[i+1]) && !strings.HasPrefix(clean[i+1], "-") {
					i++
					c.Summary = strings.TrimSpace(c.Summary + " " + clean[i])
				}
				sec = nil
			}
			continue
		}
		if sec == nil {
			sec = &cv.Section{Title: "Experience", Kind: "experience"}
		}
		if strings.HasPrefix(l, "-") || strings.HasPrefix(l, "•") {
			if item == nil {
				item = &cv.Item{}
			}
			item.Bullets = append(item.Bullets, strings.TrimSpace(strings.TrimLeft(l, "-• ")))
			continue
		}
		if sec.Kind == "skills" {
			flush()
			if h, t, ok := strings.Cut(l, ":"); ok && len(h) < 40 {
				sec.Items = append(sec.Items, cv.Item{Heading: strings.TrimSpace(h), Text: strings.TrimSpace(t)})
			} else {
				sec.Items = append(sec.Items, cv.Item{Text: l})
			}
			continue
		}
		// A plain line in experience or education starts a new entry, unless
		// the current entry has no bullets yet (then it is more of its header).
		if item != nil && len(item.Bullets) == 0 && item.Org == "" {
			parts := splitHead(l)
			item.Org, item.Dates = parts[0], firstNonEmpty(item.Dates, parts[1])
			item.Location = parts[2]
			continue
		}
		flush()
		parts := splitHead(l)
		item = &cv.Item{Heading: parts[0], Dates: parts[1], Location: parts[2]}
		if segs := strings.Split(parts[0], " | "); len(segs) >= 2 {
			item.Heading, item.Org = strings.TrimSpace(segs[0]), strings.TrimSpace(segs[1])
			if len(segs) >= 3 && item.Location == "" {
				item.Location = strings.TrimSpace(segs[2])
			}
		} else if h, o, ok := strings.Cut(parts[0], ", "); ok && sec.Kind == "experience" {
			item.Heading, item.Org = h, o
		}
	}
	flush()
	if sec != nil {
		c.Sections = append(c.Sections, *sec)
	}
	return c
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// splitHead pulls a date range out of an entry's header line.
func splitHead(l string) [3]string {
	dates := dateRe.FindString(l)
	rest := l
	if dates != "" {
		rest = strings.Replace(l, dates, "", 1)
	}
	rest = strings.Trim(strings.TrimSpace(rest), "|,·\t ")
	rest = strings.Join(strings.Fields(strings.ReplaceAll(rest, "\t", " | ")), " ")
	rest = strings.TrimSuffix(strings.TrimSpace(rest), "|")
	return [3]string{strings.TrimSpace(rest), dates, ""}
}

func standPropose(text string) Proposal {
	c := standStructure(text)
	p := Proposal{Name: c.Name, Headline: c.Headline, Summary: c.Summary, Home: c.Contact.Location}
	var titles []string
	years := 0
	for _, s := range c.Sections {
		if s.Kind != "experience" {
			continue
		}
		for _, it := range s.Items {
			if it.Heading != "" {
				titles = append(titles, it.Heading)
			}
			if m := regexp.MustCompile(`(19|20)\d{2}`).FindAllString(it.Dates, -1); len(m) > 0 {
				var a, b int
				fmt.Sscan(m[0], &a)
				b = 2026
				if len(m) > 1 {
					fmt.Sscan(m[len(m)-1], &b)
				}
				years += max(b-a, 0)
			}
		}
	}
	p.Years = years
	if p.Headline == "" && len(titles) > 0 {
		p.Headline = titles[0]
	}
	if p.Summary == "" {
		p.Summary = fmt.Sprintf("%s has about %d years of experience, most recently as %s.", c.Name, years, firstNonEmpty(p.Headline, "a professional"))
	}
	base := "Manager"
	if len(titles) > 0 {
		base = strings.TrimSpace(regexp.MustCompile(`\(.*?\)`).ReplaceAllString(titles[0], ""))
	}
	top := topWords(text, 6)
	p.Strengths = top
	p.Rare = "Hands-on experience few applicants in the target city will share."
	p.Level = []string{base, "Senior " + base}
	p.StepUp = []string{"Lead " + base, "Director, " + strings.TrimPrefix(base, "Senior ")}
	p.Sideways = []string{base + " Consultant", "Program Manager"}
	p.Focus = strings.Join(top[:min(2, len(top))], " ")
	p.Domain = top[:min(3, len(top))]
	return p
}

var stopWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`the and for with that this from have has had was were are our you your their will can all any not but its into over more than other such who what when where how why they them his her she him about across also been being both each few may must new one out per via within without work working worked team teams using use used role roles job jobs year years experience including include includes strong ability skills skill etc well able help helps make made lead led leading manage managed managing support supported provide provided ensure ensured develop developed required requirements preferred looking join company position candidate candidates responsibilities qualifications apply application`) {
		stopWords[w] = true
	}
}

func words(s string) []string {
	var out []string
	for _, w := range wordRe.FindAllString(strings.ToLower(s), -1) {
		w = strings.Trim(w, ".-")
		if len(w) > 2 && !stopWords[w] {
			out = append(out, w)
		}
	}
	return out
}

func topWords(s string, n int) []string {
	count := map[string]int{}
	for _, w := range words(s) {
		count[w]++
	}
	type kv struct {
		w string
		n int
	}
	var all []kv
	for w, c := range count {
		all = append(all, kv{w, c})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].n != all[j].n {
			return all[i].n > all[j].n
		}
		return all[i].w < all[j].w
	})
	var out []string
	for i := 0; i < len(all) && i < n; i++ {
		out = append(out, all[i].w)
	}
	return out
}

func standEmployers(p Person) []Employer {
	city := firstNonEmpty(p.Profile.City, "the city")
	names := []string{"Northwind Advisory", "Harbour Bank", "Maple Ledger Software", "Province Revenue Office", "Lakeshore Consulting", "Granite Insurance", "Civic Finance Board", "Bluejay Analytics"}
	var out []Employer
	for i, n := range names {
		sector := []string{"Advisory firm", "Bank", "Software", "Government"}[i%4]
		out = append(out, Employer{Name: n, Sector: sector, Why: "Hires people with this background in " + city + "."})
	}
	return out
}

func standRead(p Person, post Posting) Reading {
	var cvText strings.Builder
	var bullets []string
	bestID := int64(0)
	for _, c := range p.CVs {
		cvText.WriteString(c.Text + "\n")
		if bestID == 0 {
			bestID = c.ID
		}
		for _, l := range strings.Split(c.Text, "\n") {
			if strings.HasPrefix(strings.TrimSpace(l), "-") {
				bullets = append(bullets, strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(l), "- ")))
			}
		}
	}
	have := map[string]bool{}
	for _, w := range words(cvText.String()) {
		have[w] = true
	}
	// Requirement lines: bullets in the posting, else its sentences.
	var asks []string
	for _, l := range strings.Split(post.Description, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "-") && len(l) > 12 {
			asks = append(asks, strings.TrimSpace(strings.TrimLeft(l, "- ")))
		}
	}
	if len(asks) == 0 {
		for _, s := range strings.Split(post.Description, ".") {
			if s = strings.TrimSpace(s); len(s) > 25 {
				asks = append(asks, s)
			}
		}
	}
	if len(asks) > 6 {
		asks = asks[:6]
	}
	r := Reading{CVID: bestID, Keywords: topWords(post.Title+" "+post.Title+" "+post.Description, 12)}
	hits, total := 0.0, 0.0
	for _, a := range asks {
		ws := words(a)
		if len(ws) == 0 {
			continue
		}
		n := 0
		for _, w := range ws {
			if have[w] {
				n++
			}
		}
		ratio := float64(n) / float64(len(ws))
		ask := Ask{Ask: clipWords(a, 12), Strength: "gap", Evidence: "Nothing on your CV"}
		if ratio >= 0.5 {
			ask.Strength = "strong"
		} else if ratio >= 0.25 {
			ask.Strength = "partly"
		}
		if ask.Strength != "gap" {
			ask.Evidence = bestBullet(bullets, ws)
		}
		r.Asks = append(r.Asks, ask)
		hits += ratio
		total++
	}
	titleHit := 0.0
	tw := words(post.Title)
	for _, w := range tw {
		if have[w] {
			titleHit++
		}
	}
	if len(tw) > 0 {
		titleHit /= float64(len(tw))
	}
	score := 30.0
	if total > 0 {
		score = 25 + 55*(hits/total) + 20*titleHit
	}
	r.Fit = int(min(score, 97))
	r.IfTailored = min(r.Fit+6, 98)
	r.Band = bandOf(p, post.Title)
	low := strings.ToLower(post.Title)
	switch {
	case strings.Contains(low, "intern") || strings.Contains(low, "junior") || strings.Contains(low, "co-op"):
		r.Verdict, r.SkipWhy = "skip", "Entry-level role"
	case avoided(p, post.Title):
		r.Verdict, r.SkipWhy = "skip", "On your never-show list"
	case unwanted(p, post) != "":
		r.Verdict, r.SkipWhy = "skip", unwanted(p, post)
	case r.Fit >= 70:
		r.Verdict = "apply"
	case r.Fit >= 50:
		r.Verdict = "maybe"
	default:
		r.Verdict, r.SkipWhy = "skip", "Too little overlap with your experience"
	}
	gaps := 0
	for _, a := range r.Asks {
		if a.Strength == "gap" {
			gaps++
		}
	}
	r.Path = standPath(p, post.Title)
	r.Employer = firstNonEmpty(post.About, sentenceWith(post.Description, "we are a ", "we are the ", "we're a ", "our company", "our mission", "founded in", "headquartered"))
	r.Division = sentenceWith(post.Description, " team", "division", "department", "business unit", "report to", "reports to", "reporting to", " group")
	r.Summary = fmt.Sprintf("Your CV shows %d of the %d things this posting asks for most.", len(r.Asks)-gaps, len(r.Asks))
	if gaps > 0 {
		r.Summary += " The gaps are what a screening call will probe."
		r.Concerns = []string{"Nothing on your CV speaks to one of the must-haves."}
	} else {
		r.Summary += " Speed matters more than polish here."
	}
	return r
}

// standAbout has no knowledge of real employers, so it only restates what it
// was told and says nothing about a name it was given bare.
func standAbout(list []EmployerRef) []map[string]string {
	var out []map[string]string
	for _, e := range list {
		about := ""
		if e.Sector != "" {
			about = e.Name + " is a " + strings.ToLower(e.Sector) + " employer. (A sample line: with Claude connected, this says what the employer does.)"
		}
		out = append(out, map[string]string{"name": e.Name, "about": about})
	}
	return out
}

// sentenceWith returns the first sentence of text that contains one of the
// marks, in the text's own words.
func sentenceWith(text string, marks ...string) string {
	for _, para := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(para), "-") {
			continue
		}
		for _, sen := range strings.SplitAfter(para, ". ") {
			sen = strings.TrimSpace(sen)
			low := " " + strings.ToLower(sen)
			if len(sen) < 30 || len(sen) > 320 {
				continue
			}
			for _, m := range marks {
				if strings.Contains(low, m) {
					return sen
				}
			}
		}
	}
	return ""
}

func clipWords(s string, n int) string {
	f := strings.Fields(s)
	if len(f) <= n {
		return s
	}
	return strings.Join(f[:n], " ") + "…"
}

func bestBullet(bullets, ws []string) string {
	best, bestN := "", 0
	for _, b := range bullets {
		low := strings.ToLower(b)
		n := 0
		for _, w := range ws {
			if strings.Contains(low, w) {
				n++
			}
		}
		if n > bestN {
			best, bestN = b, n
		}
	}
	if best == "" {
		return "Related experience across your CV"
	}
	return clipWords(best, 22)
}

func bandOf(p Person, title string) string {
	low := strings.ToLower(title)
	match := func(list []string) bool {
		for _, t := range list {
			ws := words(t)
			n := 0
			for _, w := range ws {
				if strings.Contains(low, w) {
					n++
				}
			}
			if len(ws) > 0 && n*2 >= len(ws)+1 {
				return true
			}
		}
		return false
	}
	switch {
	case match(p.Profile.Titles.StepUp):
		return "step_up"
	case match(p.Profile.Titles.Level):
		return "level"
	case match(p.Profile.Titles.Sideways):
		return "sideways"
	}
	return "other"
}

// unwanted names a deal-breaker or an unwanted industry the posting has, in
// so many words.
func unwanted(p Person, post Posting) string {
	text := strings.ToLower(post.Title + "\n" + post.Description)
	for _, d := range p.Profile.DealBreakers {
		if d = strings.TrimSpace(d); d != "" && strings.Contains(text, strings.ToLower(d)) {
			return "Deal-breaker: " + d
		}
	}
	for _, d := range p.Profile.NoIndustries {
		if d = strings.TrimSpace(d); d != "" && strings.Contains(text, strings.ToLower(d)) {
			return "An industry you don't want: " + d
		}
	}
	return ""
}

// standPath: a title sharing a word with the path the person wants is on it.
func standPath(p Person, title string) string {
	if strings.TrimSpace(p.Profile.CareerPath) == "" {
		return "unknown"
	}
	have := map[string]bool{}
	for _, w := range words(title) {
		have[w] = true
	}
	for _, w := range words(p.Profile.CareerPath) {
		if have[w] {
			return "on"
		}
	}
	return "off"
}

func avoided(p Person, title string) bool {
	low := strings.ToLower(title)
	for _, a := range p.Profile.Avoid {
		if a = strings.ToLower(strings.TrimSpace(a)); a != "" && strings.Contains(low, a) {
			return true
		}
	}
	return false
}

func standTailor(in tailorInput) Tailoring {
	var t Tailoring
	kws := in.Reading.Keywords
	used := 0
	if in.CV.Headline != "" {
		t.Changes = append(t.Changes, cv.Change{ID: "headline", After: in.CV.Headline + " | " + in.Posting.Title, Why: "Puts the role's title where a recruiter looks first"})
		if in.Ask != "" {
			t.Changes[0] = cv.Change{ID: "headline", After: in.Posting.Title + " | " + in.CV.Headline, Why: "Changed as you asked: " + in.Ask}
		}
	}
	for _, u := range cv.Units(in.CV) {
		// Asked to change it, the stand-in proposes a smaller set.
		if used >= 4 || (in.Ask != "" && used >= 2) || !strings.Contains(u.ID, ".b") {
			continue
		}
		low := strings.ToLower(u.Text)
		for _, k := range kws {
			if strings.Contains(low, k) && !strings.HasPrefix(low, k) {
				t.Changes = append(t.Changes, cv.Change{ID: u.ID, After: strings.ToUpper(k[:1]) + k[1:] + ": " + u.Text, Why: "Leads with \"" + k + "\", which the posting asks for"})
				used++
				break
			}
		}
	}
	for _, a := range in.Reading.Asks {
		if a.Strength == "gap" {
			t.LeftOut = append(t.LeftOut, LeftOut{What: a.Ask, Why: "Nothing on your CV supports it, so the letter says so plainly."})
		}
	}
	if len(t.LeftOut) > 0 {
		t.Questions = []string{"Have you done anything that touches \"" + t.LeftOut[0].What + "\", even informally?"}
	}
	t.FitAfter = min(in.Reading.Fit+3*len(t.Changes), 98)
	return t
}

func standLetter(in letterInput) string {
	var strong []string
	for _, a := range in.Reading.Asks {
		if a.Strength != "gap" && a.Evidence != "" {
			strong = append(strong, a.Evidence)
		}
	}
	p1 := fmt.Sprintf("Your posting for %s asks for someone who has done this work before. I have.", in.Posting.Title)
	p2 := "Two examples from my CV:"
	switch in.Style {
	case "formal":
		p1 = fmt.Sprintf("I am writing to apply for the position of %s. The posting asks for someone who has done this work before, and I have.", in.Posting.Title)
		p2 = "Two examples from my curriculum vitae:"
	case "warm":
		p1 = fmt.Sprintf("I was glad to see %s is hiring a %s. It is the work I have been doing, and the work I want to keep doing.", firstNonEmpty(in.Posting.Company, "your team"), in.Posting.Title)
	}
	if in.Ask != "" {
		p2 = "The two things on my CV closest to what you ask for:"
	}
	for i, s := range strong {
		if i >= 2 {
			break
		}
		p2 += " " + strings.TrimSuffix(s, ".") + "."
	}
	p3 := "I would welcome a short conversation about what you need from this role in its first six months."
	if moving, _ := in.Person.Profile.Relocating(in.Person.Today); moving {
		p3 = fmt.Sprintf("I arrive in %s on %s and am available by video at any time until then.", firstNonEmpty(in.Person.Profile.City, "the city"), in.Person.Profile.ArriveOn)
	}
	if in.Style == "short" || strings.Contains(strings.ToLower(in.Ask), "short") {
		if len(strong) > 0 {
			p1 += " For example: " + strings.TrimSuffix(strong[0], ".") + "."
		}
		return p1 + "\n\n" + p3
	}
	return p1 + "\n\n" + p2 + "\n\n" + p3
}

func standFollowUp(in letterInput) Message {
	hello := "Hello,"
	if f := strings.Fields(in.To); len(f) > 0 {
		hello = "Hello " + f[0] + ","
	}
	when := fmt.Sprintf("%d days ago", in.Days)
	if !in.Person.Today.IsZero() {
		when = "on " + in.Person.Today.AddDate(0, 0, -in.Days).Format("2 January")
	}
	fit := "The role is close to the work I have been doing."
	for _, a := range in.Reading.Asks {
		if a.Strength != "gap" && a.Evidence != "" {
			fit = "The closest thing I have done: " + strings.TrimSuffix(a.Evidence, ".") + "."
			break
		}
	}
	body := fmt.Sprintf("%s\n\nI applied for %s %s. %s\n\nI'm still very interested, and glad to send anything else that would help or to talk whenever suits.\n\n%s",
		hello, in.Posting.Title, when, fit, firstNonEmpty(in.Person.Profile.Name, "[your name]"))
	return Message{Subject: "My application for " + in.Posting.Title, Body: body}
}

func standCase(in letterInput) string {
	body := fmt.Sprintf("I've applied for %s. Two things I've already done that map onto it:\n", in.Posting.Title)
	n := 0
	for _, a := range in.Reading.Asks {
		if a.Strength != "gap" && n < 2 {
			body += "- " + a.Evidence + "\n"
			n++
		}
	}
	return body + "Could I have fifteen minutes of your time this week?"
}

func standNote(in noteInput) Message {
	first := strings.Fields(in.Target.Name + " there")[0]
	me := strings.Fields(in.Person.Profile.Name + " ")
	sign := ""
	if len(me) > 0 {
		sign = " " + me[0]
	}
	var body string
	switch in.Purpose {
	case PurposeApplied:
		body = fmt.Sprintf("Hi %s, I've just applied for the %s role. %s Happy to talk whenever suits.%s", first, in.Posting.Title, firstNonEmpty(in.Person.Profile.Rare, "My background maps closely onto it."), sign)
	case PurposeNudge:
		body = fmt.Sprintf("Hi %s, following up once on my note. No reply needed if the timing is wrong.%s", first, sign)
	case PurposeThanks:
		body = fmt.Sprintf("Hi %s, thank you for your time today. I'll act on what you suggested this week.%s", first, sign)
	default:
		body = fmt.Sprintf("Hi %s, %s I'm moving to %s and would value fifteen minutes on how you found your way in.%s", first, lowerFirst(in.Target.Why), firstNonEmpty(in.Person.Profile.City, "your city"), sign)
	}
	if in.Channel == "linkedin" {
		body = fitNote(body, in.Person.Profile.NoteLimit()-10)
	}
	m := Message{Body: body}
	if in.Channel != "linkedin" {
		m.Subject = "A short question from a newcomer in your field"
	}
	return m
}

func lowerFirst(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.HasSuffix(s, ".") {
		s += "."
	}
	return s
}

func standDoors(p Person) []Lead {
	city := firstNonEmpty(p.Profile.City, "the city")
	field := firstNonEmpty(p.Profile.Headline, "your field")
	mk := func(kind, title, company, why string) Lead {
		return Lead{Kind: kind, Title: title, Company: company, Why: why, Search: title + " " + company + " " + city}
	}
	return []Lead{
		mk("knows_work", "Partner or director in your practice area", "an adviser to your last employer", "Their firm already worked with your team, so your name is not a stranger's."),
		mk("knows_work", "Senior manager", "a supplier to your last employer", "They know the systems you ran."),
		mk("made_move", "Someone from your country in "+field, "", "They made the move you are making and remember how it felt."),
		mk("made_move", "Former public-sector colleague now in "+city, "", "Same starting point, a few years ahead."),
		mk("same_roots", "Alumni of your university in "+city, "", "A shared school is the easiest opening line there is."),
		mk("same_roots", "Members of your professional body's "+city+" chapter", "", "They expect notes from peers."),
		mk("same_craft", "People doing your specialism", "", "Peers answer real questions about the work."),
		mk("same_craft", "Speakers at local events in "+field, "", "They have chosen to be visible."),
		mk("mentor", "A newcomer mentoring programme in "+city, "", "Matches you with someone established in your field."),
	}
}

func standForm(in formInput) []FormAnswer {
	saved := map[string]string{}
	for _, a := range in.Saved {
		saved[strings.ToLower(a.Question)] = a.Answer
	}
	var out []FormAnswer
	for _, q := range in.Questions {
		low := strings.ToLower(q)
		fa := FormAnswer{Question: q}
		switch {
		case saved[low] != "":
			fa.Answer, fa.Sure = saved[low], true
		case strings.Contains(low, "name"):
			fa.Answer, fa.Sure = in.Person.Profile.Name, in.Person.Profile.Name != ""
		case strings.Contains(low, "years"):
			fa.Answer, fa.Sure = fmt.Sprint(in.Person.Profile.Years), in.Person.Profile.Years > 0
		case strings.Contains(low, "city") || strings.Contains(low, "located"):
			fa.Answer, fa.Sure = in.Person.Profile.Home, in.Person.Profile.Home != ""
		}
		out = append(out, fa)
	}
	return out
}

func standArrive(in tailorInput) Arriving {
	var a Arriving
	if in.CV.Summary != "" {
		a.Changes = append(a.Changes, cv.Change{ID: "summary", After: in.CV.Summary + " Arriving in " + firstNonEmpty(in.Person.Profile.City, "the city") + " on " + firstNonEmpty(in.Person.Profile.ArriveOn, "a set date") + ".", Why: "Answers the first question a recruiter has about a newcomer"})
	}
	a.Terms = []Term{{Yours: "Your most recent employer", Theirs: "The closest local equivalent body", Why: "Approximate: same remit, different scale."}}
	a.Screening = []QA{
		{Q: "Do you have local experience?", A: "Not yet. What I bring is direct experience of the same rules from the other side, which few local candidates have."},
		{Q: "Are you legally able to work here?", A: "[your answer]"},
		{Q: "When could you start?", A: "I arrive on " + firstNonEmpty(in.Person.Profile.ArriveOn, "[your answer]") + " and can start the following week."},
		{Q: "What salary are you looking for?", A: "[your answer]"},
	}
	return a
}

func standPrep(in prepInput) Prep {
	p := Prep{Opening: firstNonEmpty(in.Person.Profile.Summary, "A short account of what you have done and why this conversation matters to you.")}
	if in.Reading != nil {
		for _, a := range in.Reading.Asks {
			q := "Tell me about a time you had to " + lowerFirstWord(a.Ask)
			ans := a.Evidence
			if a.Strength == "gap" {
				q = "You don't seem to have " + lowerFirstWord(a.Ask) + ". How would you handle that?"
				ans = "Say so plainly · name the nearest thing you have done · say how you would close the gap in the first month"
			}
			p.Likely = append(p.Likely, QA{Q: q, A: ans})
		}
	}
	if len(p.Likely) == 0 {
		p.Likely = []QA{{Q: "What brings you here?", A: "The work you have done · why this city · what you want to learn from them"}}
	}
	p.Stories = []string{"Pick the project you are proudest of: the situation, what you did, the result."}
	p.AskThem = []string{"What would success in the first six months look like?", "What is the hardest part of this work here that outsiders underestimate?"}
	p.WatchOuts = []string{"Don't open with what you need; open with what you have done."}
	company := ""
	if in.Posting != nil {
		company = in.Posting.Company
	} else if _, at, ok := strings.Cut(in.With, " at "); ok {
		company = at
	} else {
		company = in.With
	}
	if company != "" {
		p.Company = []WebFact{{What: company + " is hiring for this team (a sample; with Claude this is read on the web).", URL: "https://example.com/news"}}
	}
	return p
}

func lowerFirstWord(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

// standAssist makes the assistant's moves visible without Claude: it reads
// the brief, and knows a handful of plain requests.
func standAssist(in AssistInput) AssistStep {
	low := strings.ToLower(in.Message)
	made := 0
	for _, n := range in.Notes {
		if !strings.Contains(n.Call, "on their screen") {
			made++
		}
	}
	if made == 0 && !in.Last {
		call := func(method, path, body, why string) AssistStep {
			return AssistStep{Doing: why, Calls: []AssistCall{{Method: method, Path: path, Body: body, Why: why}}}
		}
		role := regexp.MustCompile(`^#/roles/(\d+)`).FindStringSubmatch(in.Page)
		switch {
		case strings.Contains(low, "resume search") || strings.Contains(low, "start searching"):
			return call("POST", "/api/pause", `{"paused":false}`, "Starting the searches again")
		case strings.Contains(low, "pause"):
			return call("POST", "/api/pause", `{"paused":true}`, "Pausing the searches")
		case strings.Contains(low, "not interested") && role != nil:
			return call("POST", "/api/roles/"+role[1]+"/no", `{"why":"You said so"}`, "Marking this role not interested")
		case strings.Contains(low, "prepare") && role != nil:
			return call("POST", "/api/roles/"+role[1]+"/prepare", "", "Preparing your documents")
		case strings.Contains(low, "cv") && len(in.Files) > 0:
			f := in.Files[len(in.Files)-1]
			st := call("POST", "/api/cvs?name="+url.QueryEscape(f.Name), "", "Adding the CV you attached")
			st.Calls[0].File = f.ID
			return st
		case strings.HasPrefix(low, "remember ") || strings.HasPrefix(low, "i hold ") || strings.HasPrefix(low, "i have "):
			b, _ := json.Marshal(map[string]string{"text": strings.TrimSpace(strings.TrimPrefix(in.Message, "Remember "))})
			return call("POST", "/api/facts", string(b), "Keeping that for future applications")
		}
		return call("GET", "/api/today", "", "Reading today's brief")
	}
	last := ""
	if made > 0 {
		last = in.Notes[len(in.Notes)-1].Call + " " + in.Notes[len(in.Notes)-1].Result
	}
	switch {
	case strings.Contains(last, "waiting for the person"):
		return AssistStep{Say: "That needs your OK. Press the button below and it is done."}
	case strings.Contains(last, "/api/pause"):
		if strings.Contains(last, "false") {
			return AssistStep{Say: "Searching is on again. New roles show up on [Radar](#/radar)."}
		}
		return AssistStep{Say: "Searching is paused. Start it again from [Radar](#/radar) or ask me."}
	case strings.Contains(last, "/api/facts"):
		return AssistStep{Say: "Noted. It is kept under [You](#/you) and used in future applications."}
	case strings.Contains(last, "/prepare"):
		return AssistStep{Say: "Started. The CV and letter will be on the role's page in a minute."}
	case strings.Contains(last, "/api/cvs"):
		return AssistStep{Say: "Your CV is added. It is under [You](#/you)."}
	}
	first, _, _ := strings.Cut(in.Standing, "\n")
	return AssistStep{Say: "These are sample answers, so I can only tell you where things stand. " + first + " Connect Claude under [Settings, Connections](#/settings/connections) and I can answer anything and do what the screens do."}
}

var standApplied = regexp.MustCompile(`(?i)appl(?:ying|ication) (?:for|to) (?:the )?(?:position of |role of )?([^.\n]{3,80}?) (?:position |role )?(?:at|with) ([A-Z][^.,\n]{1,60})`)

func standMail(in mailInput) MailReading {
	text := strings.ToLower(in.Mail.Subject + "\n" + in.Mail.Body)
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(text, w) {
				return true
			}
		}
		return false
	}
	out := MailReading{Kind: "other"}
	// The role it is about: the first candidate whose employer is named.
	for _, c := range in.Roles {
		if strings.Contains(text, strings.ToLower(c.Company)) || strings.Contains(strings.ToLower(in.Mail.From), strings.ToLower(strings.Fields(c.Company + " x")[0])) {
			out.RoleID = c.ID
			break
		}
	}
	switch {
	case has("offer of employment", "pleased to offer", "offer letter"):
		out.Kind, out.Summary, out.Next = "offer", "They are making you an offer.", "Read the terms before answering; ask for them in writing if they are not attached."
	case has("unfortunately", "not moving forward", "other candidates", "not be proceeding", "regret to inform"):
		out.Kind, out.Summary, out.Next = "rejection", "They are not taking this application further.", "Nothing to do. If you spoke to someone there, a short thank-you keeps the door open."
	case has("interview", "schedule a call", "availability", "speak with you", "meet with", "phone screen", "a quick chat"):
		out.Kind, out.Summary, out.Next = "interview", "They want to talk to you and are asking when you are free.", "Reply with two or three times, then add it to Interviews."
	case has("assessment", "take-home", "case study", "complete the test", "online test"):
		out.Kind, out.Summary, out.Next = "assessment", "They are asking you to complete an assessment.", "Check the deadline and do it; these are usually timed from when you open the link."
	case has("received your application", "thank you for applying", "thanks for applying", "application has been received"):
		out.Kind, out.Summary, out.Next = "receipt", "They confirmed they received your application.", "Nothing to do."
		if x := standApplied.FindStringSubmatch(in.Mail.Subject + "\n" + in.Mail.Body); x != nil && out.RoleID == 0 {
			out.Title, out.Company = strings.TrimSpace(x[1]), strings.TrimSpace(x[2])
		}
	case strings.Contains(text, "?"):
		out.Kind, out.Summary, out.Next = "question", "They are asking you something.", "Answer it."
	}
	return out
}

// standCareer is a believable reading built from the person's own titles.
func standCareer(in CareerInput) Career {
	pr := in.Person.Profile
	pick := func(list []string, i int, alt string) string {
		if i < len(list) {
			return list[i]
		}
		return alt
	}
	now := pick(pr.Titles.Level, 0, firstNonEmpty(pr.Headline, "Your current role"))
	up := pick(pr.Titles.StepUp, 0, "Head of "+now)
	side := pick(pr.Titles.Sideways, 0, now+" (consulting)")
	up2 := pick(pr.Titles.StepUp, 1, "Director, "+now)
	gaps := func(a, b string) []CareerGap {
		all := map[string]CareerGap{
			"lead-team": {ID: "lead-team", Gap: "Leading a team", Words: []string{"team of", "people leader", "direct reports", "lead a team"}, How: "Say on your CV how many people your biggest project drew on; it is the leadership they ask for", Time: "An evening"},
			"budget":    {ID: "budget", Gap: "Owning a budget", Words: []string{"budget", "p&l", "cost"}, How: "Move the budget you managed up to the top of that role on your CV", Time: "10 minutes"},
			"data":      {ID: "data", Gap: "Data and analytics (SQL, Power BI)", Words: []string{"sql", "power bi", "tableau", "analytics"}, How: "One short course, or one report built from work you already did", Time: "4 weeks"},
			"product":   {ID: "product", Gap: "Product roadmaps", Words: []string{"roadmap", "product owner", "backlog"}, How: "Name the systems you shaped and who used them, as a product would be described", Time: "An evening"},
		}
		return []CareerGap{all[a], all[b]}
	}
	return Career{
		Now: CareerNow{Title: now, Pay: 98000, Currency: "CAD", Years: max(pr.Years, 1), Summary: firstNonEmpty(strings.Join(pr.Strengths[:min(2, len(pr.Strengths))], " and "), "your field")},
		Routes: []CareerRoute{
			{Title: up, Band: "step_up", Why: "The shortest step: the same work, leading it.", Fit: 82, Recommended: true, Title3: up, Pay3: 128000, Title5: up2, Pay5: 150000, Title10: "Director, " + now, Pay10: 185000, CeilingTitle: "VP, " + now, Ceiling: 240000, Titles: []string{up, up2}, Gaps: gaps("lead-team", "budget")},
			{Title: side, Band: "sideways", Why: "Your experience, used for several clients rather than one employer.", Fit: 76, Title3: side, Pay3: 112000, Title5: "Senior " + side, Pay5: 130000, Title10: "Partner, " + side, Pay10: 175000, CeilingTitle: "Partner, " + side, Ceiling: 260000, Titles: []string{side, now + " Advisor"}, Gaps: gaps("product", "data")},
			{Title: up2, Band: "step_up", Why: "A longer step: setting direction for a whole function.", Fit: 64, Title3: up, Pay3: 125000, Title5: up2, Pay5: 150000, Title10: "VP, " + now, Pay10: 210000, CeilingTitle: "Chief Tax Officer", Ceiling: 300000, Titles: []string{up2}, Gaps: gaps("lead-team", "data")},
		},
		Try: []CareerTitle{{Title: now + " Lead", Band: "step_up"}, {Title: "Senior " + now, Band: "level"}, {Title: now + " Specialist", Band: "sideways"}},
	}
}

func standCheck(in checkInput) Check {
	low := strings.ToLower(in.Sent)
	var out Check
	// The posting's bulleted lines are its requirements; headings and the
	// opening paragraph are not.
	var asks []string
	for _, line := range strings.Split(in.Post.Description, "\n") {
		t := strings.TrimSpace(line)
		if l := strings.TrimSpace(strings.TrimLeft(t, "-•*")); l != t && len(l) >= 12 {
			asks = append(asks, l)
		}
	}
	for _, l := range asks {
		if len(out.Lines) == 6 {
			break
		}
		ws := topWords(l, 3)
		hit := 0
		for _, w := range ws {
			if strings.Contains(low, strings.ToLower(w)) {
				hit++
			}
		}
		cl := CheckLine{Ask: clipWords(l, 12)}
		switch {
		case len(ws) > 0 && hit == len(ws):
			cl.Status, cl.Evidence = "shown", sentenceWith(in.Sent, ws...)
		case hit > 0:
			cl.Status, cl.Evidence, cl.Fix = "unclear", "Hinted at, but not said plainly", "Name it in the most recent role's first bullet"
		default:
			cl.Status, cl.Evidence, cl.Fix = "missing", "Not on the CV", "Leave it out"
		}
		out.Lines = append(out.Lines, cl)
	}
	return out
}

// ---- leads and results --------------------------------------------------------------

var standNotHiring = regexp.MustCompile(`(?i)open ?to ?work|looking for my next|i was laid off|hire me`)
var standHiring = regexp.MustCompile(`(?i)hiring|\bhire\b|join (my|our) team|raised|series [a-e]|funding|expan|office|growing`)

// standLead sizes up a lead by plain rules: hiring words, the person's own
// titles and strengths in its text.
func standLead(in leadInput) LeadReading {
	l, pr := in.Lead, in.Person.Profile
	text := strings.ToLower(l.Headline + " " + l.AuthorTitle + " " + l.Text)
	out := LeadReading{Company: l.Company, Place: pr.City}
	out.Hiring = l.Kind == "yours" || (standHiring.MatchString(text) && !standNotHiring.MatchString(text))
	if out.Company == "" {
		at := regexp.MustCompile(`\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\-]*(?: [A-Z][A-Za-z0-9&.\-]*){0,3})`)
		for _, t := range []string{l.AuthorTitle, l.Text} {
			if m := at.FindStringSubmatch(t); m != nil && out.Company == "" {
				out.Company = strings.TrimSpace(m[1])
			}
		}
	}
	fit := 45
	for _, t := range pr.Titles.All() {
		for _, w := range strings.Fields(strings.ToLower(t.Title)) {
			if len(w) > 3 && strings.Contains(text, w) {
				fit += 6
				out.Role = firstNonEmpty(out.Role, t.Title)
			}
		}
	}
	for _, s := range pr.Strengths {
		if strings.Contains(text, strings.ToLower(s)) {
			fit += 8
			out.Help = append(out.Help, "Your work on "+s+" is what they will need")
		}
	}
	out.Fit = max(0, min(95, fit))
	if !out.Hiring {
		out.Fit = 0
	}
	out.Role = firstNonEmpty(out.Role, firstNonEmpty(strings.Join(pr.Titles.Level[:min(1, len(pr.Titles.Level))], ""), "A role in your field"))
	switch {
	case !out.Hiring:
		out.Worth, out.Why = "no", "This does not read like an employer hiring."
	case out.Fit >= 70:
		out.Worth, out.Why = "yes", "They need what you have done, and nobody else has written to them yet. Write while it is fresh."
	case out.Fit >= 55:
		out.Worth, out.Why = "maybe", "Close to your field, but the work may sit beside yours rather than on it."
	default:
		out.Worth, out.Why = "no", "Little of what they need is on your CV."
	}
	if len(out.Help) == 0 {
		out.Help = []string{"Your experience in " + firstNonEmpty(strings.Join(pr.Strengths[:min(1, len(pr.Strengths))], ""), "your field")}
	}
	who := LeadWho{Name: l.Author, Title: l.AuthorTitle, Why: "They wrote the post.", Search: strings.TrimSpace(l.Author + " " + out.Company)}
	if l.Author == "" {
		who = LeadWho{Title: "Head of Finance", Why: "The person who would hire for this work.", Search: "Head of Finance " + out.Company}
	}
	out.Who = []LeadWho{who, {Title: "Talent partner", Why: "Runs the hiring and can pass your note on.", Search: "talent " + out.Company}}
	return out
}

// standLeadNote writes the note or the follow-up the person asked for.
func standLeadNote(in leadNoteInput) Message {
	l, pr, rd := in.Lead, in.Person.Profile, in.Reading
	co := firstNonEmpty(rd.Company, firstNonEmpty(l.Company, "the company"))
	first := "there"
	if len(rd.Who) > 0 {
		if f := strings.Fields(rd.Who[0].Name); len(f) > 0 {
			first = f[0]
		}
	}
	me := firstNonEmpty(strings.Join(strings.Fields(pr.Name)[:min(1, len(strings.Fields(pr.Name)))], ""), "")
	what := "your post"
	if l.Kind != "post" {
		what = "the news about " + co
	}
	mine := "My work is in " + strings.ToLower(rd.Role)
	if len(pr.Strengths) > 0 {
		mine = "My own work is in " + strings.Join(pr.Strengths[:min(2, len(pr.Strengths))], " and ")
	}
	if in.Which == "follow_up" {
		return Message{Subject: "Re: " + firstNonEmpty(rd.Note.Subject, rd.Role+" at "+co),
			Body: fmt.Sprintf("Hi %s,\n\nA short follow-up to my note last week. If it is easier, I am glad to send two lines on how I would approach the first three months. And if the timing is wrong, no problem at all.\n\n%s", first, me)}
	}
	return Message{Subject: rd.Role + " at " + co,
		Body: fmt.Sprintf("Hi %s,\n\nI saw %s. %s, which sounds close to what you need now.\n\nWould you have 15 minutes next week? I would value hearing what you are looking for.\n\n%s", first, what, mine, me)}
}

// standNews gives two made-up items so the sample shows what news looks like.
func standNews(in NewsInput) []LeadNews {
	place := firstNonEmpty(in.Place, "your city")
	all := []LeadNews{
		{Company: "Brightwater Analytics", Headline: "Raised a $30M Series B to grow its finance and operations teams", Text: "Brightwater Analytics, a " + place + " software company, announced a Series B round led by a growth fund. It plans to double its finance team over the next year.", URL: "https://example.com/news/brightwater-series-b", When: "This month"},
		{Company: "Granite Freight", Headline: "Opens a new head office in " + place, Text: "Granite Freight is moving its head office to " + place + " and says it will hire 200 people there, many in finance and systems.", URL: "https://example.com/news/granite-office", When: "Two weeks ago"},
	}
	var out []LeadNews
	for _, n := range all {
		known := false
		for _, k := range in.Known {
			known = known || strings.EqualFold(k, n.Company)
		}
		if !known {
			out = append(out, n)
		}
	}
	return out
}

// standResults reads the numbers back in plain words.
func standResults(in ResultsInput) ResultsReading {
	out := ResultsReading{Summary: "You are applying steadily, and the roles at your own level answer more often than the step-ups. The numbers are still small, so treat this as a first look."}
	out.Points = []string{"Apply on the first day: most of your replies came from roles sent within a day of the posting.", "Write to one person at each employer you apply to; notes bring answers that applications alone do not."}
	if len(in.Rejections) >= 2 {
		out.Rejections = []string{"Most of the no's came before anyone spoke to you, on roles a step above your level.", "They were roles where your CV led with strategy rather than the systems you built."}
		out.Guidance = "For step-up roles, lead with the systems you put live and the team you ran, with numbers, before any strategy; keep the first three bullets on hands-on delivery."
	}
	return out
}
