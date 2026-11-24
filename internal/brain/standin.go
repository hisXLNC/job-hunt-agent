package brain

import (
	"context"
	"encoding/json"
	"fmt"
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
		case "read_role":
			in := req.Input.(readInput)
			out = standRead(in.Person, in.Posting)
		case "tailor":
			out = standTailor(req.Input.(tailorInput))
		case "letter":
			in := req.Input.(letterInput)
			out = map[string]string{"letter": standLetter(in)}
		case "case":
			in := req.Input.(letterInput)
			out = Message{Subject: in.Posting.Title + ": two things I've already done", Body: standCase(in)}
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
		case "ask":
			out = standAsk(req.Input.(string))
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
	r.Band = bandOf(p, post.Title)
	low := strings.ToLower(post.Title)
	switch {
	case strings.Contains(low, "intern") || strings.Contains(low, "junior") || strings.Contains(low, "co-op"):
		r.Verdict, r.SkipWhy = "skip", "Entry-level role"
	case avoided(p, post.Title):
		r.Verdict, r.SkipWhy = "skip", "On your never-show list"
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
	r.Summary = fmt.Sprintf("Your CV shows %d of the %d things this posting asks for most.", len(r.Asks)-gaps, len(r.Asks))
	if gaps > 0 {
		r.Summary += " The gaps are what a screening call will probe."
		r.Concerns = []string{"Nothing on your CV speaks to one of the must-haves."}
	} else {
		r.Summary += " Speed matters more than polish here."
	}
	return r
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
	}
	for _, u := range cv.Units(in.CV) {
		if used >= 4 || !strings.Contains(u.ID, ".b") {
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
	return p1 + "\n\n" + p2 + "\n\n" + p3
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
	if in.Channel == "linkedin" && len(body) > 290 {
		body = body[:287] + "…"
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
	return p
}

func lowerFirstWord(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func standAsk(text string) Reply {
	r := Reply{Reply: "Noted. I'll use that from now on."}
	low := strings.ToLower(text)
	if strings.HasSuffix(strings.TrimSpace(text), "?") {
		r.Reply = "Short answer: say it plainly, give one piece of evidence, and stop. I can draft the exact wording on the role's page."
		return r
	}
	if m := regexp.MustCompile(`20\d{2}-\d{2}-\d{2}`).FindString(text); m != "" && (strings.Contains(low, "arriv") || strings.Contains(low, "land") || strings.Contains(low, "flight")) {
		r.ArriveOn = m
		r.Reply = "Updated: you arrive on " + m + ". Letters and notes will say so."
		return r
	}
	r.Remember = []string{strings.TrimSpace(text)}
	return r
}
