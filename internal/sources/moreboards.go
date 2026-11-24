package sources

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ErrChanged means a source answered, but not in the shape this package
// reads: its pages were probably redesigned. Nothing was found or lost.
var ErrChanged = errors.New("sources: the page was not laid out as expected")

func errChanged(name string) error { return fmt.Errorf("%w (%s)", ErrChanged, name) }

func errKey(p *Posting) error {
	return fmt.Errorf("sources: posting key %q does not belong to %s", p.Key, p.Source)
}

func itoa(n int) string { return strconv.Itoa(n) }

// ---- Workable ----

const workableHost = "https://apply.workable.com"

type workableBoard struct {
	Name string `json:"name"`
	Jobs []struct {
		Title        string `json:"title"`
		Shortcode    string `json:"shortcode"`
		ID           flexID `json:"id"`
		City         string `json:"city"`
		State        string `json:"state"`
		Country      string `json:"country"`
		Telecommute  bool   `json:"telecommuting"`
		URL          string `json:"url"`
		ApplyURL     string `json:"application_url"`
		Description  string `json:"description"`
		Requirements string `json:"requirements"`
		Benefits     string `json:"benefits"`
		Published    string `json:"published_on"`
	} `json:"jobs"`
}

func (c *Client) workableURL(token string) string {
	return c.base(kindWorkable, workableHost) + "/api/v1/widget/accounts/" + url.PathEscape(token)
}

func (c *Client) listWorkable(ctx context.Context, b Board) ([]Posting, error) {
	var res workableBoard
	if err := c.getJSON(ctx, c.workableURL(b.Token)+"?details=true", &res); err != nil {
		return nil, err
	}
	var out []Posting
	for _, j := range res.Jobs {
		code := firstNonEmpty(j.Shortcode, string(j.ID))
		if strings.TrimSpace(j.Title) == "" || code == "" {
			continue
		}
		p := Posting{
			Source:      kindWorkable,
			Key:         postingKey(b, code),
			Company:     strings.TrimSpace(res.Name),
			Title:       strings.TrimSpace(j.Title),
			Location:    joinPlace(j.City, j.State, j.Country),
			URL:         firstNonEmpty(webURL(j.URL), workableHost+"/"+url.PathEscape(b.Token)+"/j/"+url.PathEscape(code)+"/"),
			ApplyURL:    webURL(j.ApplyURL),
			Description: joinSections(HTMLToText(j.Description), HTMLToText(j.Requirements), HTMLToText(j.Benefits)),
			PostedAt:    parseTime(j.Published),
			Applicants:  -1,
		}
		if j.Telecommute {
			p.Workplace = "remote"
		} else {
			p.Workplace = workplaceOf(p.Location)
		}
		out = append(out, p)
	}
	return out, nil
}

// joinPlace joins the parts of one place with commas: "Toronto, Ontario, Canada".
func joinPlace(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" && (len(out) == 0 || !strings.EqualFold(out[len(out)-1], p)) {
			out = append(out, p)
		}
	}
	return strings.Join(out, ", ")
}

// ---- BambooHR ----

type bambooList struct {
	Result []struct {
		ID       flexID `json:"id"`
		Name     string `json:"jobOpeningName"`
		IsRemote *bool  `json:"isRemote"`
		Location struct {
			City  string `json:"city"`
			State string `json:"state"`
		} `json:"location"`
		ATS struct {
			City     string `json:"city"`
			Province string `json:"province"`
			State    string `json:"state"`
			Country  string `json:"country"`
		} `json:"atsLocation"`
	} `json:"result"`
}

type bambooDetail struct {
	Result struct {
		JobOpening struct {
			Description  string `json:"description"`
			MinExp       string `json:"minimumExperience"`
			DatePosted   string `json:"datePosted"`
			Compensation string `json:"compensation"`
		} `json:"jobOpening"`
	} `json:"result"`
}

// bambooBase is where one company's careers pages live. The token is the
// company's own label, as in "<label>.bamboohr.com".
func (c *Client) bambooBase(token string) string {
	return c.base(kindBambooHR, "https://"+token+".bamboohr.com") + "/careers"
}

func (c *Client) listBambooHR(ctx context.Context, b Board) ([]Posting, error) {
	if !slugRE.MatchString(b.Token) {
		return nil, fmt.Errorf("sources: %q is not a BambooHR company label", b.Token)
	}
	var res bambooList
	if err := c.getJSON(ctx, c.bambooBase(b.Token)+"/list", &res); err != nil {
		return nil, err
	}
	var out []Posting
	for _, j := range res.Result {
		if j.ID == "" || strings.TrimSpace(j.Name) == "" {
			continue
		}
		place := joinPlace(j.Location.City, j.Location.State)
		if place == "" {
			place = joinPlace(j.ATS.City, firstNonEmpty(j.ATS.Province, j.ATS.State), j.ATS.Country)
		}
		p := Posting{
			Source:      kindBambooHR,
			Key:         postingKey(b, string(j.ID)),
			Title:       strings.TrimSpace(j.Name),
			Location:    place,
			URL:         "https://" + b.Token + ".bamboohr.com/careers/" + string(j.ID),
			Applicants:  -1,
			NeedsDetail: true,
		}
		if j.IsRemote != nil && *j.IsRemote {
			p.Workplace = "remote"
		} else {
			p.Workplace = workplaceOf(place)
		}
		out = append(out, p)
	}
	return out, nil
}

func (c *Client) detailBambooHR(ctx context.Context, p *Posting) error {
	token, id, err := splitKey(p)
	if err != nil || !slugRE.MatchString(token) || !isDigits(id) {
		return errKey(p)
	}
	var res bambooDetail
	if err := c.getJSON(ctx, c.bambooBase(token)+"/"+id+"/detail", &res); err != nil {
		return err
	}
	j := res.Result.JobOpening
	text := HTMLToText(j.Description)
	if text == "" {
		return errChanged("BambooHR")
	}
	if j.MinExp != "" {
		text += "\n\nMinimum experience: " + strings.TrimSpace(j.MinExp)
	}
	p.Description, p.NeedsDetail = text, false
	if t := parseTime(j.DatePosted); !t.IsZero() {
		p.PostedAt = t
	}
	if p.Pay == "" {
		p.Pay = strings.TrimSpace(j.Compensation)
	}
	return nil
}

// ---- Recruitee ----

type recruiteeOffers struct {
	Offers []struct {
		ID           flexID `json:"id"`
		Slug         string `json:"slug"`
		Title        string `json:"title"`
		Description  string `json:"description"`
		Requirements string `json:"requirements"`
		Location     string `json:"location"`
		City         string `json:"city"`
		Country      string `json:"country"`
		Company      string `json:"company_name"`
		CareersURL   string `json:"careers_url"`
		ApplyURL     string `json:"careers_apply_url"`
		Published    string `json:"published_at"`
		Created      string `json:"created_at"`
		Remote       bool   `json:"remote"`
		Hybrid       bool   `json:"hybrid"`
		Status       string `json:"status"`
	} `json:"offers"`
}

func (c *Client) recruiteeURL(token string) string {
	return c.base(kindRecruitee, "https://"+token+".recruitee.com") + "/api/offers/"
}

func (c *Client) listRecruitee(ctx context.Context, b Board) ([]Posting, error) {
	if !slugRE.MatchString(b.Token) {
		return nil, fmt.Errorf("sources: %q is not a Recruitee company label", b.Token)
	}
	var res recruiteeOffers
	if err := c.getJSON(ctx, c.recruiteeURL(b.Token), &res); err != nil {
		return nil, err
	}
	var out []Posting
	for _, j := range res.Offers {
		id := firstNonEmpty(string(j.ID), j.Slug)
		if id == "" || strings.TrimSpace(j.Title) == "" || (j.Status != "" && j.Status != "published") {
			continue
		}
		p := Posting{
			Source:      kindRecruitee,
			Key:         postingKey(b, id),
			Company:     strings.TrimSpace(j.Company),
			Title:       strings.TrimSpace(j.Title),
			Location:    firstNonEmpty(strings.TrimSpace(j.Location), joinPlace(j.City, j.Country)),
			URL:         firstNonEmpty(webURL(j.CareersURL), "https://"+b.Token+".recruitee.com/o/"+url.PathEscape(j.Slug)),
			ApplyURL:    webURL(j.ApplyURL),
			Description: joinSections(HTMLToText(j.Description), HTMLToText(j.Requirements)),
			PostedAt:    parseTime(firstNonEmpty(j.Published, j.Created)),
			Applicants:  -1,
		}
		switch {
		case j.Hybrid:
			p.Workplace = "hybrid"
		case j.Remote:
			p.Workplace = "remote"
		default:
			p.Workplace = workplaceOf(p.Location)
		}
		out = append(out, p)
	}
	return out, nil
}
