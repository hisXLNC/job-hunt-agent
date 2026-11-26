package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"jobhunt/internal/trace"
)

// LinkedIn through Apify (apify.com): a scraper there runs LinkedIn's job
// search and hands back each posting with its whole description. The person
// pays Apify per result after its free monthly credit. The postings are
// LinkedIn's, named as LinkedIn names them, so one found both ways is one role.

// ApifyActor is the scraper run when the person has not chosen one. It takes
// LinkedIn job-search links.
const ApifyActor = "curious_coder/linkedin-jobs-scraper"

const apifyHost = "https://api.apify.com"

// apifyMax is how many postings one title asks for: the newest, since the
// last search, so most runs return far fewer.
const apifyMax = 25

func (c *Client) findApify(ctx context.Context, k Keys, q Query) ([]Posting, error) {
	actor := strings.TrimSpace(k.ApifyActor)
	if actor == "" {
		actor = ApifyActor
	}
	n := apifyMax
	if q.Max > 0 {
		n = min(q.Max, apifyMax)
	}
	v := url.Values{}
	v.Set("keywords", strings.TrimSpace(q.Keywords))
	if where := strings.TrimSpace(q.Location); where != "" {
		v.Set("location", where)
	}
	if q.Within > 0 {
		v.Set("f_TPR", "r"+strconv.FormatInt(max(int64(q.Within/time.Second), 1), 10))
	}
	v.Set("sortBy", "DD")
	link := linkedInHost + "/jobs/search/?" + v.Encode()
	// The inputs the common LinkedIn job scrapers take; each uses the ones it knows.
	published := "r604800"
	if q.Within > 0 && q.Within <= 24*time.Hour {
		published = "r86400"
	}
	in := map[string]any{
		"urls": []string{link}, "startUrls": []map[string]string{{"url": link}},
		"count": n, "rows": n, "maxItems": n, "scrapeCompany": false,
		"title": q.Keywords, "location": q.Location, "publishedAt": published,
	}
	// Started, then asked after until it is done: each call is short, though
	// the scraper itself takes a minute or more.
	headers := map[string]string{"Authorization": "Bearer " + strings.TrimSpace(k.Apify)}
	base := c.base(kindApify, apifyHost)
	var run apifyRun
	path := "/v2/acts/" + url.PathEscape(strings.ReplaceAll(actor, "/", "~")) + "/runs?timeout=240"
	if err := c.keyedJSON(ctx, "POST", base+path, "api.apify.com"+path, headers, in, &run); err != nil {
		return nil, err
	}
	for run.Data.Status == "READY" || run.Data.Status == "RUNNING" || run.Data.Status == "" {
		if run.Data.ID == "" {
			return nil, fmt.Errorf("sources: apify started nothing")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		path := "/v2/actor-runs/" + url.PathEscape(run.Data.ID) + "?waitForFinish=15"
		if err := c.keyedJSON(ctx, "GET", base+path, "api.apify.com/v2/actor-runs/…", headers, nil, &run); err != nil {
			return nil, err
		}
	}
	if run.Data.Status != "SUCCEEDED" {
		why := strings.ToLower(run.Data.Status)
		if m := strings.TrimSpace(run.Data.Message); m != "" {
			why += ": " + m[:min(len(m), 200)]
		}
		return nil, fmt.Errorf("sources: the Apify scraper stopped (%s)", why)
	}
	var items []map[string]any
	path = "/v2/datasets/" + url.PathEscape(run.Data.Dataset) + "/items?clean=true&format=json"
	if err := c.keyedJSON(ctx, "GET", base+path, "api.apify.com/v2/datasets/…/items", headers, nil, &items); err != nil {
		return nil, err
	}
	posts := parseApify(items)
	// What the scraper gave back, so a problem can be told from "nothing new".
	if len(posts) < len(items) {
		var keys []string
		for k := range items[0] {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		trace.Log("search", "apify: %d items, %d read as postings; first item has %s", len(items), len(posts), strings.Join(keys, ","))
	} else {
		trace.Log("search", "apify: %d postings", len(posts))
	}
	return posts, nil
}

type apifyRun struct {
	Data struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Dataset string `json:"defaultDatasetId"`
		Message string `json:"statusMessage"`
	} `json:"data"`
}

// parseApify reads what a LinkedIn scraper returned. Each scraper names its
// fields a little differently.
func parseApify(items []map[string]any) []Posting {
	pick := func(j map[string]any, keys ...string) string {
		for _, k := range keys {
			switch x := j[k].(type) {
			case string:
				if s := strings.TrimSpace(x); s != "" {
					return s
				}
			case float64:
				return strconv.FormatFloat(x, 'f', -1, 64)
			case json.Number:
				return x.String()
			case map[string]any:
				if s, ok := x["name"].(string); ok && strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			}
		}
		return ""
	}
	var out []Posting
	seen := map[string]bool{}
	for _, j := range items {
		title := plainLine(pick(j, "title", "jobTitle", "position", "name"))
		id := linkedInJobID(pick(j, "link", "jobUrl", "url", "jobLink"))
		if id == "" {
			if x := pick(j, "jobId", "id", "job_id"); isDigits(x) && len(x) >= 6 {
				id = x
			}
		}
		if title == "" || id == "" || seen[id] {
			continue
		}
		seen[id] = true
		desc := pick(j, "descriptionText", "description", "jobDescription", "descriptionHtml")
		if strings.Contains(desc, "<") {
			desc = HTMLToText(desc)
		}
		p := Posting{
			Source:      kindLinkedIn,
			Key:         kindLinkedIn + ":" + id,
			Company:     firstNonEmpty(plainLine(pick(j, "companyName", "company", "company_name", "companyTitle")), "Unknown"),
			Title:       title,
			Location:    plainLine(pick(j, "location", "jobLocation", "place", "formattedLocation")),
			URL:         linkedInHost + "/jobs/view/" + id,
			Description: desc,
			Pay:         plainLine(pick(j, "salary", "salaryInfo", "salaryRange", "compensation")),
			PostedAt:    parseTime(pick(j, "postedAt", "publishedAt", "postedDate", "listedAt", "datePosted")),
			Applicants:  -1,
		}
		if n, ok := ParseApplicants(pick(j, "applicantsCount", "applicants", "numApplicants")); ok {
			p.Applicants = n
		} else if x := pick(j, "applicantsCount"); isDigits(x) {
			p.Applicants, _ = strconv.Atoi(x)
		}
		p.Logo = LogoURL(pick(j, "companyLogo", "company_logo", "companyLogoUrl", "logo"))
		p.Site = OwnSite(pick(j, "companyWebsite", "company_website", "companyUrl"))
		p.ApplyURL = webURL(pick(j, "applyUrl", "applyLink", "companyApplyUrl"))
		if strings.Contains(p.ApplyURL, "linkedin.com") {
			p.ApplyURL = ""
		}
		work := strings.ToLower(pick(j, "workplaceType", "workType", "workplace"))
		switch {
		case strings.Contains(work, "remote"):
			p.Workplace = "remote"
		case strings.Contains(work, "hybrid"):
			p.Workplace = "hybrid"
		case strings.Contains(work, "on-site"), strings.Contains(work, "onsite"):
			p.Workplace = "onsite"
		default:
			p.Workplace = workplaceOf(p.Location)
		}
		p.NeedsDetail = len(strings.Fields(p.Description)) < 40
		out = append(out, p)
	}
	return out
}

// TestApify checks a token without running a scraper (which costs).
func (c *Client) TestApify(ctx context.Context, token string) error {
	var me map[string]any
	err := c.keyedJSON(ctx, "GET", c.base(kindApify, apifyHost)+"/v2/users/me", "api.apify.com/v2/users/me", map[string]string{"Authorization": "Bearer " + strings.TrimSpace(token)}, nil, &me)
	return keyedErr(kindApify, err)
}
