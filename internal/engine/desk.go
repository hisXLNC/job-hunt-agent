package engine

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"jobhunt/internal/store"
	"jobhunt/internal/trace"
)

// ---- this computer: waking it, links, copied links ---------------------------------------

// browserID is how a browser is named in the settings: a short word, or "" for Windows' own choice.
var browserID = regexp.MustCompile(`^[a-z]{0,20}$`)

// NextWake is when this computer should be woken for Job Hunt: a minute
// before the next full search, while the person wants that and searching is
// on. false: nothing to wake for.
func (e *Engine) NextWake() (time.Time, bool) {
	if !e.Desk().Wake || e.Paused() {
		return time.Time{}, false
	}
	_, full := e.nextTimes()
	at := time.Unix(full, 0).Add(-time.Minute)
	if !at.After(e.Now()) {
		return time.Time{}, false
	}
	return at, true
}

// jobPath picks out the addresses of single job postings: a job board's
// posting page, or a careers page that names one job.
var jobPath = regexp.MustCompile(`(?i)(linkedin\.com/jobs/view/\d|linkedin\.com/jobs/.*currentjobid=\d|indeed\.[a-z.]+/(viewjob|rc/clk|m/viewjob)|indeed\.[a-z.]+/.*[?&]vjk=|glassdoor\.[a-z.]+/(job-listing|partner/joblisting)|greenhouse\.io/.+/jobs/\d|gh_jid=\d|jobs\.lever\.co/[^/]+/[0-9a-f-]{20,}|jobs\.ashbyhq\.com/[^/]+/[0-9a-f-]{20,}|myworkday(jobs|site)\.com/.+/job/|smartrecruiters\.com/[^/]+/\d|apply\.workable\.com/[^/]+/j/|icims\.com/jobs/\d|bamboohr\.com/careers/\d|jobbank\.gc\.ca/jobsearch/jobposting/\d|successfactors\.(com|eu)/.*(jobreq|career_job_req_id)|taleo\.net/.*(jobdetail|job=)|jobvite\.com/[^/]+/job/|zohorecruit\.[a-z.]+/.*/jobs/|/(careers?|jobs?)/[^?#]*\d{4,})`)

// JobLink returns the job posting address in text the person copied, when
// the text is just that one address. Anything else gives false: Job Hunt only
// offers to add what plainly is a link to a posting.
func JobLink(text string) (string, bool) {
	t := strings.TrimSpace(text)
	if t == "" || len(t) > 2000 || strings.ContainsAny(t, " \t\r\n") {
		return "", false
	}
	u, err := url.Parse(t)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return "", false
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || strings.HasPrefix(h, "127.") || !strings.Contains(h, ".") {
		return "", false
	}
	if !jobPath.MatchString(u.Host + u.Path + "?" + u.RawQuery) {
		return "", false
	}
	u.Fragment = ""
	return u.String(), true
}

// KnownLink says whether Job Hunt already has a role at this address.
func (e *Engine) KnownLink(link string) bool {
	base := strings.TrimRight(strings.SplitN(link, "?", 2)[0], "/")
	rows, _ := e.S.Pairs(`SELECT '', id FROM roles WHERE url = ? OR apply_url = ? OR url = ? OR apply_url = ? LIMIT 1`, link, link, base, base)
	if len(rows) > 0 {
		return true
	}
	if m := regexp.MustCompile(`linkedin\.com/jobs/view/(?:[^/?#]*-)?(\d{6,})`).FindStringSubmatch(link); m != nil {
		rows, _ = e.S.Pairs(`SELECT '', id FROM roles WHERE key LIKE ? LIMIT 1`, "%"+m[1])
		return len(rows) > 0
	}
	return false
}

// ---- the hiring team on a LinkedIn posting ------------------------------------------------

// TeamMember is one person LinkedIn names under "Meet the hiring team".
type TeamMember struct {
	Name  string `json:"name"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

var recruiterTitle = regexp.MustCompile(`(?i)recruit|talent|sourc|acquisition|\bhr\b|human resources|people partner|people operations`)

// AddHiringTeam adds the people a posting names as its hiring team to People,
// at the role's employer, each noted as on that role's team. It returns how
// many were new.
func (e *Engine) AddHiringTeam(roleID int64, team []TeamMember) (int, error) {
	r, err := e.S.Role(roleID)
	if err != nil {
		return 0, err
	}
	added := 0
	for i, m := range team {
		if i >= 8 {
			break
		}
		name, title := oneLine(m.Name, 120), oneLine(m.Title, 160)
		link := safeURL(m.URL)
		if u, err := url.Parse(link); err != nil || !strings.HasSuffix(strings.ToLower(u.Hostname()), "linkedin.com") || !strings.HasPrefix(u.Path, "/in/") {
			link = ""
		}
		if name == "" {
			continue
		}
		kind := "manager"
		if recruiterTitle.MatchString(title) {
			kind = "recruiter"
		}
		p := store.Person{Name: name, Title: title, URL: link, Kind: kind, Why: "On the hiring team for " + r.Title, Source: "extension", CompanyID: r.CompanyID}
		id, isNew, err := e.S.AddPerson(p)
		if err != nil {
			return added, err
		}
		if isNew {
			added++
			e.S.Log(store.Activity{Kind: "person", RoleID: roleID, CompanyID: r.CompanyID, PersonID: id, Text: name + " is on the hiring team"})
		}
	}
	return added, nil
}

func oneLine(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// ---- every tailored CV and letter, also kept in a folder ------------------------------------

// FilesSet is where the tailored CVs and letters are kept as files.
type FilesSet struct {
	Off bool   `json:"off"`
	Dir string `json:"dir"` // "" is the usual place, FilesHome
}

// Files says whether the files are kept, and where.
func (e *Engine) Files() (set FilesSet, dir string) {
	e.S.Get("keep_files", &set)
	if set.Off {
		return set, ""
	}
	if set.Dir != "" {
		return set, set.Dir
	}
	return set, e.FilesHome
}

// SetFiles changes where the files are kept. A folder that isn't there yet is made.
func (e *Engine) SetFiles(set FilesSet) error {
	set.Dir = strings.TrimSpace(set.Dir)
	if set.Dir != "" {
		set.Dir = filepath.Clean(set.Dir)
		if !filepath.IsAbs(set.Dir) {
			return errors.New("Give the whole path of the folder, such as " + filepath.Join(firstOf(e.FilesHome, "C:\\Users\\you\\Documents"), "") + ".")
		}
		if set.Dir == filepath.Clean(e.FilesHome) {
			set.Dir = ""
		}
	}
	if !set.Off {
		dir := firstOf(set.Dir, e.FilesHome)
		if dir == "" {
			return errors.New("Choose a folder for the files.")
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("Job Hunt couldn't make the folder %s: %v", dir, err)
		}
	}
	err := e.S.Set("keep_files", set)
	e.S.Changed("files")
	return err
}

// roleFolder is the name of a role's own folder: employer and title.
func roleFolder(r store.Role) string {
	return strings.TrimSuffix(fileNameExt("x", r.Company, r.Title), ".x")
}

// KeepFiles writes a role's CV and letter, as Word files and PDFs, into its
// own folder inside the files folder, and returns that folder. "" when the
// files are not kept.
func (e *Engine) KeepFiles(roleID int64) (string, error) {
	_, dir := e.Files()
	if dir == "" {
		return "", nil
	}
	r, err := e.S.Role(roleID)
	if err != nil {
		return "", err
	}
	cvDoc, cvErr := e.CVFile(roleID)
	if cvErr != nil {
		return "", errors.New("this role has no CV written yet")
	}
	folder := filepath.Join(dir, roleFolder(r))
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return "", fmt.Errorf("Job Hunt couldn't make the folder %s: %v", folder, err)
	}
	files := []File{cvDoc}
	if f, err := e.LetterFile(roleID); err == nil {
		files = append(files, f)
	}
	if !e.PDFGap(roleID) {
		if f, err := e.CVPDF(roleID); err == nil {
			files = append(files, f)
		}
		if f, err := e.LetterPDF(roleID); err == nil {
			files = append(files, f)
		}
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(folder, f.Name), f.Data, 0o644); err != nil {
			return folder, fmt.Errorf("Job Hunt couldn't write %s: %v", f.Name, err)
		}
	}
	e.S.Changed("files")
	return folder, nil
}

// keepFilesQuietly is KeepFiles after the documents are written: a problem
// goes to the debugging record, never in the way of preparing.
func (e *Engine) keepFilesQuietly(roleID int64) {
	if _, dir := e.Files(); dir == "" {
		return
	}
	if _, err := e.KeepFiles(roleID); err != nil {
		trace.Log("problem", "keeping the files for role %d: %v", roleID, err)
	}
}

// KeptFolder is one role's folder in the files folder.
type KeptFolder struct {
	Name  string     `json:"name"`
	At    int64      `json:"at"`
	Files []KeptFile `json:"files"`
}

// KeptFile is one file in it.
type KeptFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// KeptFiles lists the folders in the files folder, newest first.
func (e *Engine) KeptFiles(most int) []KeptFolder {
	_, dir := e.Files()
	out := []KeptFolder{}
	if dir == "" {
		return out
	}
	entries, _ := os.ReadDir(dir)
	for _, d := range entries {
		if !d.IsDir() || strings.HasPrefix(d.Name(), ".") {
			continue
		}
		kf := KeptFolder{Name: d.Name(), Files: []KeptFile{}}
		inner, _ := os.ReadDir(filepath.Join(dir, d.Name()))
		for _, f := range inner {
			info, err := f.Info()
			if err != nil || f.IsDir() {
				continue
			}
			kf.Files = append(kf.Files, KeptFile{Name: f.Name(), Size: info.Size()})
			kf.At = max(kf.At, info.ModTime().Unix())
		}
		if len(kf.Files) > 0 {
			out = append(out, kf)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At > out[j].At })
	if most > 0 && len(out) > most {
		out = out[:most]
	}
	return out
}

// KeptFolderPath is the path of one folder in the files folder, named as
// KeptFiles names it; "" for anything that is not one.
func (e *Engine) KeptFolderPath(name string) string {
	_, dir := e.Files()
	if dir == "" {
		return ""
	}
	if name == "" {
		return dir
	}
	if name != filepath.Base(name) || name == "." || name == ".." || strings.ContainsAny(name, `/\:`) {
		return ""
	}
	p := filepath.Join(dir, name)
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		return ""
	}
	return p
}

// copiedLink is the last job link the person copied, offered on Roles.
type copiedLink struct {
	URL string `json:"url"`
	At  int64  `json:"at"`
}

// TookCopiedLink is told of text the person copied, when they switched that
// on. A link to a posting Job Hunt doesn't have yet is offered under the bell
// (and as a notification): a click opens Roles with it filled in. Nothing is
// added until the person presses Add.
func (e *Engine) TookCopiedLink(text string) bool {
	link, ok := JobLink(text)
	if !ok || e.KnownLink(link) {
		return false
	}
	var was copiedLink
	if e.S.Get("copied_link", &was); was.URL == link {
		return false
	}
	e.S.Set("copied_link", copiedLink{URL: link, At: e.Now().Unix()})
	host := link
	if u, err := url.Parse(link); err == nil {
		host = strings.TrimPrefix(u.Hostname(), "www.")
	}
	e.Tell("Add the job you copied?", "A link to a posting on "+host+". Open it to add it to Job Hunt.", "#/roles?add=copied")
	return true
}

// CopiedLink is the job link the person copied in the last day, if any.
func (e *Engine) CopiedLink() string {
	var was copiedLink
	e.S.Get("copied_link", &was)
	if was.URL == "" || e.Now().Unix()-was.At > 86400 {
		return ""
	}
	return was.URL
}
