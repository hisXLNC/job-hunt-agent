package sources

import (
	"context"
	"html"
	"net/url"
)

const greenhouseAPI = "https://boards-api.greenhouse.io"

type greenhouseJob struct {
	ID             flexID `json:"id"`
	Title          string `json:"title"`
	UpdatedAt      string `json:"updated_at"`
	FirstPublished string `json:"first_published"`
	AbsoluteURL    string `json:"absolute_url"`
	Content        string `json:"content"` // HTML, entity-escaped once
	CompanyName    string `json:"company_name"`
	Location       struct {
		Name string `json:"name"`
	} `json:"location"`
	Offices []struct {
		Name     string `json:"name"`
		Location string `json:"location"`
	} `json:"offices"`
}

type greenhouseJobs struct {
	Jobs []greenhouseJob `json:"jobs"`
}

func (c *Client) greenhouseJobsURL(token string) string {
	return c.base(kindGreenhouse, greenhouseAPI) + "/v1/boards/" + url.PathEscape(token) + "/jobs"
}

// listGreenhouse reads a whole board in one request; descriptions come with it.
func (c *Client) listGreenhouse(ctx context.Context, b Board) ([]Posting, error) {
	var res greenhouseJobs
	if err := c.getJSON(ctx, c.greenhouseJobsURL(b.Token)+"?content=true", &res); err != nil {
		return nil, err
	}
	out := make([]Posting, 0, len(res.Jobs))
	for _, j := range res.Jobs {
		if j.ID == "" {
			continue
		}
		id := string(j.ID)
		location := joinLocations(j.Location.Name)
		if location == "" {
			var offices []string
			for _, o := range j.Offices {
				offices = append(offices, firstNonEmpty(o.Location, o.Name))
			}
			location = joinLocations(offices...)
		}
		out = append(out, Posting{
			Source:      kindGreenhouse,
			Key:         postingKey(b, id),
			Company:     j.CompanyName,
			Title:       j.Title,
			Location:    location,
			Workplace:   workplaceOf(location),
			URL:         firstNonEmpty(webURL(j.AbsoluteURL), "https://boards.greenhouse.io/"+url.PathEscape(b.Token)+"/jobs/"+url.PathEscape(id)),
			Description: HTMLToText(html.UnescapeString(j.Content)),
			PostedAt:    parseTime(firstNonEmpty(j.FirstPublished, j.UpdatedAt)),
			Applicants:  -1,
		})
	}
	return out, nil
}
