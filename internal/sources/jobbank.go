package sources

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Job Bank is the Government of Canada's job board. Its search takes a title
// and a province (a city typed in is ignored), newest first, 25 to a page.

const (
	jobBankHost = "https://www.jobbank.gc.ca"
	// Job Bank limits a connection that asks too quickly.
	jobBankGap = 5 * time.Second
)

// findJobBank runs one search and returns the newest page of results. They
// carry no description: use Detail.
func (c *Client) findJobBank(ctx context.Context, q Query) ([]Posting, error) {
	v := url.Values{}
	v.Set("searchstring", strings.TrimSpace(q.Keywords))
	v.Set("sort", "D")
	days := 30
	if q.Within > 0 {
		days = max(int(q.Within/(24*time.Hour)), 1)
	}
	v.Set("fage", itoa(days))
	if p := strings.ToUpper(strings.TrimSpace(q.Province)); len(p) == 2 {
		v.Set("fprov", p)
	}
	if err := c.wait(ctx, kindJobBank, jobBankGap); err != nil {
		return nil, err
	}
	body, _, err := c.getHTML(ctx, c.base(kindJobBank, jobBankHost)+"/jobsearch/jobsearch?"+v.Encode())
	if err != nil {
		return nil, err
	}
	out := parseJobBankList(body)
	if len(out) == 0 && !strings.Contains(body, "results-count") && !strings.Contains(body, "noresult") {
		return nil, errChanged("Job Bank")
	}
	return out, nil
}

var (
	jobBankArticleRE = regexp.MustCompile(`^article-(\d+)$`)
	jobBankPlaceRE   = regexp.MustCompile(`^(.*?)\s*\(([A-Z]{2})\)\s*$`)
	jobBankHiddenRE  = regexp.MustCompile(`(?is)<span[^>]*class="[^"]*\bwb-inv\b[^"]*"[^>]*>.*?</span>`)
)

// parseJobBankList reads the result cards of a search page.
func parseJobBankList(body string) []Posting {
	// The labels Job Bank adds for screen readers ("Location", "Salary:")
	// are not part of what the card says.
	d := parseHTML(jobBankHiddenRE.ReplaceAllString(body, ""))
	var out []Posting
	isCard := func(t token) bool { return t.name == "article" && jobBankArticleRE.MatchString(t.attr("id")) }
	for i := d.find(0, len(d.toks), isCard); i >= 0; {
		end := d.closeOf(i)
		id := jobBankArticleRE.FindStringSubmatch(d.toks[i].attr("id"))[1]
		title := d.textOf(i, end, withClass("noctitle"))
		if title != "" {
			p := Posting{
				Source:      kindJobBank,
				Key:         kindJobBank + ":" + id,
				Title:       title,
				Company:     d.textOf(i, end, withClass("business")),
				Location:    jobBankPlace(d.textOf(i, end, withClass("location"))),
				URL:         jobBankHost + "/jobsearch/jobposting/" + id,
				Pay:         strings.TrimSpace(strings.TrimPrefix(d.textOf(i, end, withClass("salary")), "Salary:")),
				Applicants:  -1,
				NeedsDetail: true,
			}
			p.Workplace = workplaceOf(d.textOf(i, end, withClass("telework")))
			if t, err := time.ParseInLocation("January 02, 2006", strings.TrimSpace(strings.TrimPrefix(d.textOf(i, end, withClass("date")), "Posted on")), time.Local); err == nil {
				p.PostedAt = t
			}
			out = append(out, p)
		}
		i = d.find(min(end, len(d.toks)-1)+1, len(d.toks), isCard)
		if end >= len(d.toks) {
			break
		}
	}
	return out
}

// jobBankPlace turns "Surrey (BC)" into "Surrey, BC".
func jobBankPlace(s string) string {
	s = strings.TrimSpace(s)
	if m := jobBankPlaceRE.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1]) + ", " + m[2]
	}
	return s
}

func (c *Client) detailJobBank(ctx context.Context, p *Posting) error {
	id := strings.TrimPrefix(p.Key, kindJobBank+":")
	if !isDigits(id) {
		return errKey(p)
	}
	if err := c.wait(ctx, kindJobBank, jobBankGap); err != nil {
		return err
	}
	body, _, err := c.getHTML(ctx, c.base(kindJobBank, jobBankHost)+"/jobsearch/jobposting/"+id)
	if err != nil {
		return err
	}
	text := parseJobBankPosting(body)
	if text == "" {
		return errChanged("Job Bank")
	}
	p.Description, p.NeedsDetail = text, false
	return nil
}

// parseJobBankPosting returns a posting's text: its requirement sections, or
// for a posting passed on by a partner site the description it carries.
func parseJobBankPosting(body string) string {
	d := parseHTML(jobBankHiddenRE.ReplaceAllString(body, ""))
	if i := d.find(0, len(d.toks), withClass("job-posting-detail-requirements")); i >= 0 {
		if t := HTMLToText(d.inner(i)); len(t) > 60 {
			return t
		}
	}
	if i := d.find(0, len(d.toks), func(t token) bool { return t.attr("property") == "description" }); i >= 0 {
		if t := HTMLToText(d.inner(i)); len(t) > 60 {
			return t
		}
	}
	return ""
}

// JobBankTitles puts job titles the way Job Bank words them: it files
// postings under plain occupations, so "Senior Technical Program Manager"
// finds nothing where "Program Manager" finds everything. Level words are
// dropped, long titles are cut to their last two words, and the titles the
// most of the person's own share come first.
func JobBankTitles(titles []string, limit int) []string {
	count := map[string]int{}
	shown := map[string]string{}
	var order []string
	for _, t := range titles {
		var words []string
		for _, w := range strings.FieldsFunc(t, func(r rune) bool { return r == ' ' || r == ',' || r == '/' || r == '(' || r == ')' || r == '-' }) {
			if !levelWords[strings.ToLower(strings.Trim(w, "."))] {
				words = append(words, w)
			}
		}
		if len(words) > 2 {
			words = words[len(words)-2:]
		}
		if len(words) == 0 {
			continue
		}
		plain := strings.Join(words, " ")
		k := strings.ToLower(plain)
		if count[k] == 0 {
			order = append(order, k)
			shown[k] = plain
		}
		count[k]++
	}
	// Stable: the commonest first, otherwise the person's own order.
	for i := 1; i < len(order); i++ {
		for j := i; j > 0 && count[order[j]] > count[order[j-1]]; j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}
	var out []string
	for _, k := range order {
		if limit > 0 && len(out) >= limit {
			break
		}
		out = append(out, shown[k])
	}
	return out
}

var levelWords = map[string]bool{"senior": true, "sr": true, "junior": true, "jr": true, "principal": true, "staff": true, "lead": true, "associate": true, "intermediate": true, "of": true, "the": true, "and": true, "&": true}
