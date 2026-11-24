package sources

import (
	"context"
	"net/url"
	"strconv"
	"strings"
)

const (
	smartRecruitersAPI      = "https://api.smartrecruiters.com"
	smartRecruitersPageSize = 100
	// smartRecruitersMax is a safety stop for the largest employers; nobody
	// reads more than this from one board in one go.
	smartRecruitersMax = 2000
)

type smartRecruitersPosting struct {
	ID           flexID `json:"id"`
	Name         string `json:"name"`
	ReleasedDate string `json:"releasedDate"`
	Location     struct {
		City         string `json:"city"`
		Region       string `json:"region"`
		Country      string `json:"country"`
		FullLocation string `json:"fullLocation"`
		Remote       *bool  `json:"remote"`
		Hybrid       *bool  `json:"hybrid"`
	} `json:"location"`
	Company struct {
		Name string `json:"name"`
	} `json:"company"`

	// Only on the single-posting answer.
	ApplyURL   string `json:"applyUrl"`
	PostingURL string `json:"postingUrl"`
	JobAd      struct {
		Sections struct {
			CompanyDescription    smartRecruitersSection `json:"companyDescription"`
			JobDescription        smartRecruitersSection `json:"jobDescription"`
			Qualifications        smartRecruitersSection `json:"qualifications"`
			AdditionalInformation smartRecruitersSection `json:"additionalInformation"`
		} `json:"sections"`
	} `json:"jobAd"`
}

type smartRecruitersSection struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

type smartRecruitersPage struct {
	TotalFound int                      `json:"totalFound"`
	Content    []smartRecruitersPosting `json:"content"`
}

func (c *Client) smartRecruitersURL(token string) string {
	return c.base(kindSmartRecruiters, smartRecruitersAPI) + "/v1/companies/" + url.PathEscape(token) + "/postings"
}

// listSmartRecruiters walks a board page by page. The list carries no
// descriptions, so every posting needs Detail.
func (c *Client) listSmartRecruiters(ctx context.Context, b Board) ([]Posting, error) {
	var out []Posting
	seen := map[string]bool{}
	for offset := 0; offset < smartRecruitersMax; {
		if offset > 0 {
			if err := c.pause(ctx, kindSmartRecruiters); err != nil {
				return nil, err
			}
		}
		var page smartRecruitersPage
		u := c.smartRecruitersURL(b.Token) + "?limit=" + strconv.Itoa(smartRecruitersPageSize) + "&offset=" + strconv.Itoa(offset)
		if err := c.getJSON(ctx, u, &page); err != nil {
			return nil, err
		}
		for _, j := range page.Content {
			id := string(j.ID)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			out = append(out, Posting{
				Source:      kindSmartRecruiters,
				Key:         postingKey(b, id),
				Company:     j.Company.Name,
				Title:       j.Name,
				Location:    j.location(),
				Workplace:   j.workplace(),
				URL:         "https://jobs.smartrecruiters.com/" + url.PathEscape(b.Token) + "/" + url.PathEscape(id),
				PostedAt:    parseTime(j.ReleasedDate),
				Applicants:  -1,
				NeedsDetail: true,
			})
		}
		offset += len(page.Content)
		if len(page.Content) == 0 || offset >= page.TotalFound {
			break
		}
	}
	return out, nil
}

func (j smartRecruitersPosting) location() string {
	l := j.Location
	if full := joinLocations(l.FullLocation); full != "" {
		return full
	}
	var parts []string
	for _, s := range []string{l.City, l.Region, strings.ToUpper(l.Country)} {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, ", ")
}

func (j smartRecruitersPosting) workplace() string {
	remote, hybrid := j.Location.Remote, j.Location.Hybrid
	switch {
	case hybrid != nil && *hybrid:
		return "hybrid"
	case remote != nil && *remote:
		return "remote"
	case remote != nil && hybrid != nil:
		return "onsite" // the source said no to both
	}
	return ""
}

func (c *Client) detailSmartRecruiters(ctx context.Context, p *Posting) error {
	token, id, err := splitKey(p)
	if err != nil {
		return err
	}
	var j smartRecruitersPosting
	if err := c.getJSON(ctx, c.smartRecruitersURL(token)+"/"+url.PathEscape(id), &j); err != nil {
		return err
	}
	s := j.JobAd.Sections
	p.Description = joinSections(s.CompanyDescription.text(), s.JobDescription.text(), s.Qualifications.text(), s.AdditionalInformation.text())
	if u := webURL(j.PostingURL); u != "" {
		p.URL = u
	}
	if u := webURL(j.ApplyURL); u != "" {
		p.ApplyURL = u
	}
	if p.Company == "" {
		p.Company = j.Company.Name
	}
	if p.Title == "" {
		p.Title = j.Name
	}
	if p.Location == "" {
		p.Location = j.location()
	}
	if p.Workplace == "" {
		p.Workplace = j.workplace()
	}
	if p.PostedAt.IsZero() {
		p.PostedAt = parseTime(j.ReleasedDate)
	}
	p.NeedsDetail = false
	return nil
}

// text renders one section of an advert under its heading.
func (s smartRecruitersSection) text() string {
	body := HTMLToText(s.Text)
	if body == "" {
		return ""
	}
	return joinSections(tidyText(s.Title), body)
}
