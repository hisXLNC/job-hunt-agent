package sources

import (
	"context"
	"net/url"
)

const ashbyAPI = "https://api.ashbyhq.com"

type ashbyJob struct {
	ID                 string `json:"id"`
	Title              string `json:"title"`
	Location           string `json:"location"`
	SecondaryLocations []struct {
		Location string `json:"location"`
	} `json:"secondaryLocations"`
	IsRemote         bool   `json:"isRemote"`
	WorkplaceType    string `json:"workplaceType"`
	DescriptionHTML  string `json:"descriptionHtml"`
	DescriptionPlain string `json:"descriptionPlain"`
	PublishedAt      string `json:"publishedAt"`
	JobURL           string `json:"jobUrl"`
	ApplyURL         string `json:"applyUrl"`
	IsListed         *bool  `json:"isListed"` // absent counts as listed
	Compensation     struct {
		TierSummary   string `json:"compensationTierSummary"`
		SalarySummary string `json:"scrapeableCompensationSalarySummary"`
	} `json:"compensation"`
}

type ashbyBoard struct {
	Jobs []ashbyJob `json:"jobs"`
}

func (j ashbyJob) listed() bool { return j.IsListed == nil || *j.IsListed }

func (c *Client) ashbyBoardURL(token string) string {
	return c.base(kindAshby, ashbyAPI) + "/posting-api/job-board/" + url.PathEscape(token)
}

// listAshby reads a whole board in one request; descriptions come with it.
// Postings the employer has unlisted are left out.
func (c *Client) listAshby(ctx context.Context, b Board) ([]Posting, error) {
	var res ashbyBoard
	if err := c.getJSON(ctx, c.ashbyBoardURL(b.Token)+"?includeCompensation=true", &res); err != nil {
		return nil, err
	}
	out := make([]Posting, 0, len(res.Jobs))
	for _, j := range res.Jobs {
		if j.ID == "" || !j.listed() {
			continue
		}
		places := []string{j.Location}
		for _, s := range j.SecondaryLocations {
			places = append(places, s.Location)
		}
		location := joinLocations(places...)
		workplace := firstNonEmpty(workplaceOf(j.WorkplaceType), workplaceOf(location))
		if workplace == "" && j.IsRemote {
			workplace = "remote"
		}
		// The HTML is converted here so lists come out as "- " lines; the
		// source's own plain text is only the fallback.
		description := HTMLToText(j.DescriptionHTML)
		if description == "" {
			description = tidyText(j.DescriptionPlain)
		}
		out = append(out, Posting{
			Source:      kindAshby,
			Key:         postingKey(b, j.ID),
			Title:       j.Title,
			Location:    location,
			Workplace:   workplace,
			URL:         firstNonEmpty(webURL(j.JobURL), "https://jobs.ashbyhq.com/"+url.PathEscape(b.Token)+"/"+url.PathEscape(j.ID)),
			ApplyURL:    webURL(j.ApplyURL),
			Description: description,
			Pay:         tidyText(firstNonEmpty(j.Compensation.TierSummary, j.Compensation.SalarySummary)),
			PostedAt:    parseTime(j.PublishedAt),
			Applicants:  -1,
		})
	}
	return out, nil
}
