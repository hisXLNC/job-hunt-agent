package engine

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"jobhunt/internal/sources"
)

var linkRE = regexp.MustCompile(`https?://[^\s<>"']+`)

// ErrSaidNo is the answer when a link is for a role the person said they
// were not interested in: it stays closed.
var ErrSaidNo = errors.New("You said you're not interested in this role, so Job Hunt keeps it closed. If you changed your mind, bring it back under Roles, Not interested, on your computer.")

// AddFromLink adds the posting a link points to, as a role the person
// found themselves, and reads it against their CV. text may be a bare link
// or what a phone's Share gives ("Tax Manager at Acme https://…"). A link
// to a role already here opens that role; one the person said no to stays
// closed.
func (e *Engine) AddFromLink(ctx context.Context, text string) (int64, error) {
	m := strings.TrimRight(linkRE.FindString(text), ".,;:)]}!?")
	if m == "" {
		return 0, errors.New("Paste the link to the posting. It starts with https://.")
	}
	link, ok := sources.PublicURL(m)
	if !ok {
		return 0, errors.New("That link isn't a page on the internet Job Hunt can open.")
	}
	if id, closed, ok := e.S.RoleByURL(link); ok {
		if closed == "no" {
			return id, ErrSaidNo
		}
		if closed != "" {
			e.S.Reopen(id) // the person asked for it, so it comes back
		}
		return id, nil
	}
	if id, closed, ok := e.S.SeenRole("manual:" + link); ok && closed == "no" {
		return id, ErrSaidNo
	}
	rctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	post, err := e.Src.ReadLink(rctx, link)
	cancel()
	if err != nil {
		return 0, errors.New("Job Hunt couldn't read the posting on that page. On your computer, open it and send it with the side panel, or paste its text under Roles.")
	}
	if c, err := e.S.CompanyByName(post.Company); err == nil {
		if id, closed, ok := e.S.SimilarRole(c.ID, post.Title, post.Location); ok && closed == "no" {
			return id, ErrSaidNo
		}
	}
	return e.AddRole(post.Company, post.Title, post.Location, link, post.Description, "manual")
}
