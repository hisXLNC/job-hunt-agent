package sources

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	workdayPageSize   = 20  // the most Workday hands out per request
	defaultWorkdayMax = 400 // postings List reads from one board; some tenants have thousands
)

var (
	// "tenant.wdN/site", e.g. "td.wd3/TD_Bank_Careers"
	workdayTokenRE = regexp.MustCompile(`^([A-Za-z0-9][A-Za-z0-9-]*)\.([Ww][Dd][0-9]+)/([A-Za-z0-9][A-Za-z0-9._-]*)$`)
	// "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago"
	workdayPostedRE = regexp.MustCompile(`(?i)\b(today|yesterday|(\d+)(\+?)\s+days?\s+ago)`)
)

// workdaySite is a Board token taken apart.
type workdaySite struct{ tenant, wd, site string }

func parseWorkdayToken(token string) (workdaySite, error) {
	m := workdayTokenRE.FindStringSubmatch(strings.TrimSpace(token))
	if m == nil {
		return workdaySite{}, fmt.Errorf("sources: workday board token %q is not tenant.wdN/site", token)
	}
	return workdaySite{tenant: strings.ToLower(m[1]), wd: strings.ToLower(m[2]), site: m[3]}, nil
}

// host is the tenant's public careers host.
func (w workdaySite) host() string {
	return "https://" + w.tenant + "." + w.wd + ".myworkdayjobs.com"
}

// api is the root of the tenant's public job API for this site.
func (c *Client) workdayAPI(w workdaySite) string {
	return c.base(kindWorkday, w.host()) + "/wday/cxs/" + w.tenant + "/" + w.site
}

type workdayQuery struct {
	AppliedFacets map[string][]string `json:"appliedFacets"`
	Limit         int                 `json:"limit"`
	Offset        int                 `json:"offset"`
	SearchText    string              `json:"searchText"`
}

type workdayPage struct {
	Total       int `json:"total"`
	JobPostings []struct {
		Title         string `json:"title"`
		ExternalPath  string `json:"externalPath"`
		LocationsText string `json:"locationsText"`
		PostedOn      string `json:"postedOn"`
		RemoteType    string `json:"remoteType"`
	} `json:"jobPostings"`
}

type workdayDetail struct {
	JobPostingInfo struct {
		Title               string   `json:"title"`
		JobDescription      string   `json:"jobDescription"`
		Location            string   `json:"location"`
		AdditionalLocations []string `json:"additionalLocations"`
		StartDate           string   `json:"startDate"`
		RemoteType          string   `json:"remoteType"`
	} `json:"jobPostingInfo"`
	HiringOrganization struct {
		Name string `json:"name"`
	} `json:"hiringOrganization"`
}

// ListWorkday reads up to limit postings from a Workday board, optionally
// narrowed by searchText, so a tenant with thousands of postings can be
// searched by keyword instead of walked. limit <= 0 means the default cap of
// 400. Every posting needs Detail.
func (c *Client) ListWorkday(ctx context.Context, b Board, searchText string, limit int) ([]Posting, error) {
	if b.Kind != kindWorkday {
		return nil, fmt.Errorf("sources: ListWorkday needs a workday board, got %q", b.Kind)
	}
	w, err := parseWorkdayToken(b.Token)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = defaultWorkdayMax
	}
	now := c.clock()
	endpoint := c.workdayAPI(w) + "/jobs"

	var out []Posting
	seen := map[string]bool{}
	// Some tenants answer "total": 0 on every page after the first, so only
	// the first page's total is believed. offset counts what the tenant has
	// handed over, which also bounds the loop.
	total := 0
	for offset := 0; offset < limit && (offset == 0 || total == 0 || offset < total); {
		if offset > 0 {
			if err := c.pause(ctx, kindWorkday); err != nil {
				return nil, err
			}
		}
		var page workdayPage
		q := workdayQuery{AppliedFacets: map[string][]string{}, Limit: workdayPageSize, Offset: offset, SearchText: searchText}
		if err := c.postJSON(ctx, endpoint, q, &page); err != nil {
			return nil, err
		}
		if offset == 0 {
			total = page.Total
		}
		if len(page.JobPostings) == 0 {
			break
		}
		offset += len(page.JobPostings)
		for _, j := range page.JobPostings {
			path := strings.TrimSpace(j.ExternalPath)
			if path == "" {
				continue // nothing to link to or to tell it apart by
			}
			if !strings.HasPrefix(path, "/") {
				path = "/" + path
			}
			id := workdayID(path)
			if seen[id] || len(out) >= limit {
				continue
			}
			seen[id] = true
			location := joinLocations(j.LocationsText)
			out = append(out, Posting{
				Source:      kindWorkday,
				Key:         postingKey(b, id),
				Title:       strings.TrimSpace(j.Title),
				Location:    location,
				Workplace:   firstNonEmpty(workplaceOf(j.RemoteType), workplaceOf(location)),
				URL:         w.host() + "/en-US/" + w.site + path,
				PostedAt:    workdayPostedAt(j.PostedOn, now),
				Applicants:  -1,
				NeedsDetail: true,
			})
		}
	}
	return out, nil
}

// workdayID is the requisition part of an external path: what follows the
// last "_" of "/job/Toronto-ON/Senior-Manager-Tax_R-12345", or the whole
// path when there is none.
func workdayID(path string) string {
	if i := strings.LastIndexByte(path, '_'); i >= 0 && i+1 < len(path) {
		return path[i+1:]
	}
	return path
}

// workdayPostedAt turns Workday's "Posted 3 Days Ago" into an approximate
// time. "30+ Days" becomes 31 days; unreadable text is the zero time.
func workdayPostedAt(postedOn string, now time.Time) time.Time {
	m := workdayPostedRE.FindStringSubmatch(postedOn)
	if m == nil {
		return time.Time{}
	}
	switch strings.ToLower(m[1]) {
	case "today":
		return now
	case "yesterday":
		return now.Add(-24 * time.Hour)
	}
	days, err := strconv.Atoi(m[2])
	if err != nil || days > 100000 {
		return time.Time{}
	}
	if m[3] == "+" {
		days++
	}
	return now.Add(-time.Duration(days) * 24 * time.Hour)
}

func (c *Client) detailWorkday(ctx context.Context, p *Posting) error {
	token, _, err := splitKey(p)
	if err != nil {
		return err
	}
	w, err := parseWorkdayToken(token)
	if err != nil {
		return err
	}
	// The posting's path is the tail of its human URL; the host always
	// comes from the board, never from the posting.
	path := ""
	if u, err := url.Parse(p.URL); err == nil {
		if _, after, ok := strings.Cut(u.EscapedPath(), "/"+w.site+"/"); ok {
			path = "/" + after
		}
	}
	if path == "" || path == "/" {
		return fmt.Errorf("sources: workday posting %q has no usable URL %q", p.Key, p.URL)
	}

	var d workdayDetail
	if err := c.getJSON(ctx, c.workdayAPI(w)+path, &d); err != nil {
		return err
	}
	info := d.JobPostingInfo
	p.Description = HTMLToText(info.JobDescription)
	if location := joinLocations(append([]string{info.Location}, info.AdditionalLocations...)...); location != "" {
		p.Location = location
	}
	if wp := firstNonEmpty(workplaceOf(info.RemoteType), p.Workplace, workplaceOf(p.Location)); wp != "" {
		p.Workplace = wp
	}
	if t := parseTime(info.StartDate); !t.IsZero() {
		p.PostedAt = t // the real date beats "Posted 3 Days Ago"
	}
	if p.Title == "" {
		p.Title = strings.TrimSpace(info.Title)
	}
	if p.Company == "" {
		p.Company = strings.TrimSpace(d.HiringOrganization.Name)
	}
	p.NeedsDetail = false
	return nil
}
