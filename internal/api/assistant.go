package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"jobhunt/internal/brain"
	"jobhunt/internal/llm"
	"jobhunt/internal/office"
	"jobhunt/internal/store"
)

// The assistant is Claude with the app's own interface as its hands. It asks
// for calls; this file decides which are made. The table below is both what
// Claude is told it can do and the only things it can do: a call that is not
// in the table is refused, whatever it was told by a posting or an e-mail.
//
//	look   read something. Made at once.
//	do     change something that can be changed back. Made at once.
//	ask    remove something, close or reopen a role, change what is searched
//	       for. Held until the person presses the button.
//
// Keys, passwords, the inbox and Claude connections, the side panel's
// approval and stopping the program are not in the table at all.

type toolClass int

const (
	canLook toolClass = iota
	canDo
	mustAsk
)

type tool struct {
	Method  string
	Pattern string
	Class   toolClass
	Kind    string   // what {id} names: role, person, cv, note, mail, talk, fact, answer, company, question
	Label   string   // what the call does, in the person's words
	Help    string   // for Claude: the fields and their values
	Show    []string // body fields worth showing the person beside the label
	Only    bool     // the body may carry the Show fields and nothing else
	File    bool     // takes an attachment as its body
}

var tools = []tool{
	// ---- looking --------------------------------------------------------------
	{Method: "GET", Pattern: "/api/state", Help: "Counts for every screen, whether searching is paused, what the program is doing this minute, and whether Claude is reachable."},
	{Method: "GET", Pattern: "/api/today", Help: "Today's brief: roles ready to send, the question waiting for the person, notes due, what was done while they were away."},
	{Method: "GET", Pattern: "/api/roles", Help: "Roles, a page at a time. Query: stage (comma-separated: new,found,ready,applied,reply,interview,offer), closed (all, or comma-separated: screened,no,rejected,expired,withdrawn; left out means open roles only), band (level,step_up,sideways), minfit (0-100), q (words), company (employer number), saved=1, sort (age,fit,title,company,applicants,stage; a leading - reverses), page, size (up to 100). Returns total and counts by stage."},
	{Method: "GET", Pattern: "/api/board", Help: "The first few roles in each stage, with counts."},
	{Method: "GET", Pattern: "/api/roles/{id}", Kind: "role", Help: "Everything about one role: the posting, how it was read (fit, what it asks for, what the person has), the tailored CV with each change, the letter, the case for the hiring manager, people there, notes, mail, interviews, what happened."},
	{Method: "GET", Pattern: "/api/radar", Help: "Fresh roles from the last two days, recent searches and what they found, the titles searched for, how many roles were set aside by the rules."},
	{Method: "GET", Pattern: "/api/companies", Help: "Employers being watched. Query: state (following,suggested,muted), q, sort (name,fit,people,newest), page, size."},
	{Method: "GET", Pattern: "/api/people", Help: "People worth writing to. Query: kind (knows_work,made_move,same_roots,same_craft,mentor,recruiter,manager,contact), q, know=1 (only those who know the person), company, state, page, size."},
	{Method: "GET", Pattern: "/api/people/{id}", Kind: "person", Help: "One person, the notes drafted or sent to them, and what happened."},
	{Method: "GET", Pattern: "/api/mail", Help: "Replies from employers and people. Query: state (new,done), kind (interview,assessment,question,offer,rejection,receipt,person,other), page, size."},
	{Method: "GET", Pattern: "/api/mail/{id}", Kind: "mail", Help: "One message in full, what it means and the drafted answer."},
	{Method: "GET", Pattern: "/api/talks", Help: "Interviews and conversations: upcoming and recent."},
	{Method: "GET", Pattern: "/api/talks/{id}", Kind: "talk", Help: "One interview or conversation with its preparation."},
	{Method: "GET", Pattern: "/api/progress", Help: "The numbers: from posting to offer, the last eight weeks, how early they apply, answers by source and level, people written to."},
	{Method: "GET", Pattern: "/api/activity", Help: "What happened lately, newest first. Query: limit (up to 200)."},
	{Method: "GET", Pattern: "/api/you", Help: "The profile, the CVs, the facts kept about the person, saved answers to form questions, and questions still open."},
	{Method: "GET", Pattern: "/api/cvs/{id}", Kind: "cv", Help: "One CV in full, section by section."},
	{Method: "GET", Pattern: "/api/arriving", Help: "The arrival pack for someone moving to the city: the CV changes proposed for local readers and the plan."},
	{Method: "GET", Pattern: "/api/connections", Help: "How Claude, the phone, the inbox and the browser side panel are connected, and Claude usage this week. Secrets are left out."},
	{Method: "GET", Pattern: "/api/app", Help: "The version, where the data is kept, recent changes the program made to its own settings, recent Claude calls and problems."},
	{Method: "GET", Pattern: "/api/import/old", Help: "Whether the old Job Hunt's data is on this computer and what it holds (jobs applied to, prepared, CVs, people), and what was last brought over from it. Bringing it over is the person's own button under You, The app."},
	{Method: "GET", Pattern: "/api/find", Help: "Quick search across roles, people and employers. Query: q."},

	// ---- doing ----------------------------------------------------------------
	{Method: "POST", Pattern: "/api/questions/{id}/answer", Class: canDo, Kind: "question", Label: "Answer a question Job Hunt asked", Help: `Body: {"answer": "..."}. Only with what the person said.`, Show: []string{"answer"}},
	{Method: "POST", Pattern: "/api/cvs", Class: canDo, Label: "Add a CV", Help: `Query: name (the file name). Set "file" to the attachment; no body. Takes about a minute.`, File: true},
	{Method: "PUT", Pattern: "/api/cvs/{id}", Class: canDo, Kind: "cv", Label: "Rename a CV or say what it is for", Help: `Body: {"name": "...", "focus": "which roles this CV is for"}. Either field may be left out.`, Show: []string{"name", "focus"}},
	{Method: "POST", Pattern: "/api/roles", Class: canDo, Label: "Add a role", Help: `Body: {"company", "title", "location", "url", "description"}. For a posting the person pasted, attached or described. Put the whole posting text in description. Returns its number; it is read straight away.`, Show: []string{"title", "company"}},
	{Method: "POST", Pattern: "/api/roles/{id}/prepare", Class: canDo, Kind: "role", Label: "Prepare the CV and letter", Help: "Starts tailoring the CV and writing the letter. Runs in the background, about a minute."},
	{Method: "POST", Pattern: "/api/roles/{id}/read", Class: canDo, Kind: "role", Label: "Read the posting again", Help: "Reads the posting again and scores the fit. Background."},
	{Method: "POST", Pattern: "/api/roles/{id}/applied", Class: canDo, Kind: "role", Label: "Mark as applied", Help: `Body: {"how": "where they applied, optional"}. Only when the person says they sent the application.`},
	{Method: "POST", Pattern: "/api/roles/{id}/stage", Class: canDo, Kind: "role", Label: "Move to another stage", Help: `Body: {"stage": "found|ready|applied|reply|interview|offer"}.`, Show: []string{"stage"}},
	{Method: "POST", Pattern: "/api/roles/{id}/save", Class: canDo, Kind: "role", Label: "Save or unsave", Help: `Body: {"off": false} to save for later, {"off": true} to unsave.`},
	{Method: "POST", Pattern: "/api/roles/{id}/cv", Class: canDo, Kind: "role", Label: "Use another CV for this role", Help: `Body: {"cv": number}. Tailors again from that CV; about a minute.`},
	{Method: "POST", Pattern: "/api/roles/{id}/change", Class: canDo, Kind: "role", Label: "Change the tailored CV", Help: `Body: {"index": n, "off": true} to undo change n of the tailored CV (counting from 0), {"index": n, "off": false} to put it back, {"index": n, "after": "new wording"} to reword it. Never write experience the person does not have.`, Show: []string{"after"}},
	{Method: "POST", Pattern: "/api/roles/{id}/letter", Class: canDo, Kind: "role", Label: "Rewrite the letter", Help: `Body: {"text": "the whole letter"}. Replaces the letter. Keep it true to the CV and the facts.`},
	{Method: "POST", Pattern: "/api/roles/{id}/case", Class: canDo, Kind: "role", Label: "Write the case for the hiring manager", Help: "Writes a short note to the hiring manager for this role. Takes a little while."},
	{Method: "POST", Pattern: "/api/companies", Class: canDo, Label: "Watch an employer", Help: `Body: {"name": "...", "site": "its careers page, if the person gave one"}.`, Show: []string{"name"}},
	{Method: "POST", Pattern: "/api/companies/more", Class: canDo, Label: "Find more employers", Help: "Finds more employers that hire people like this one. Background."},
	{Method: "PUT", Pattern: "/api/companies/{id}", Class: canDo, Kind: "company", Label: "Change how an employer is watched", Help: `Body: {"state": "following|suggested|muted"} and/or {"board": "the address of its job board"} and/or {"about": "what the employer does, in one or two sentences, when the person tells you or corrects it"}. Muted employers are no longer searched.`, Show: []string{"state", "about"}},
	{Method: "POST", Pattern: "/api/search", Class: canDo, Label: "Search now", Help: `Body: {"kind": "fast"} for the watched employers only, {"kind": "full"} for everything. Background.`},
	{Method: "POST", Pattern: "/api/pause", Class: canDo, Label: "Pause or resume searching", Help: `Body: {"paused": true|false}.`, Show: []string{"paused"}},
	{Method: "POST", Pattern: "/api/people", Class: canDo, Label: "Add a person", Help: `Body: {"name", "title", "company_name", "kind" (see the people list), "why" (why they would answer), "url" (their LinkedIn page), "email"}. Only people the person named or the app's data shows.`, Show: []string{"name", "company_name"}},
	{Method: "POST", Pattern: "/api/people/find", Class: canDo, Label: "Look for people worth writing to", Help: "Looks for people at the watched employers who would answer. Background."},
	{Method: "POST", Pattern: "/api/people/import", Class: canDo, Label: "Import LinkedIn connections", Help: `Set "file" to the attached Connections.csv export; no body.`, File: true},
	{Method: "PUT", Pattern: "/api/people/{id}", Class: canDo, Kind: "person", Label: "Update a person", Help: `Body: any of {"name", "title", "kind", "why", "url", "email", "state", "knows_you": true|false}.`, Show: []string{"title", "kind", "state"}},
	{Method: "POST", Pattern: "/api/people/{id}/note", Class: canDo, Kind: "person", Label: "Draft a note", Help: `Body: {"purpose": "intro|applied|nudge|thanks", "channel": "linkedin|email", "role": role number or 0}. Writes a draft for the person to read and send themselves.`, Show: []string{"purpose"}},
	{Method: "PUT", Pattern: "/api/notes/{id}", Class: canDo, Kind: "note", Label: "Reword a note", Help: `Body: {"subject": "...", "body": "..."}. Both are replaced.`},
	{Method: "POST", Pattern: "/api/notes/{id}/sent", Class: canDo, Kind: "note", Label: "Mark a note as sent", Help: "Only when the person says they sent it."},
	{Method: "POST", Pattern: "/api/notes/{id}/replied", Class: canDo, Kind: "note", Label: "Mark a note as answered", Help: "Only when the person says they got an answer."},
	{Method: "POST", Pattern: "/api/notes/{id}/quiet", Class: canDo, Kind: "note", Label: "Stop reminders for a note"},
	{Method: "POST", Pattern: "/api/notes/{id}/later", Class: canDo, Kind: "note", Label: "Remind about a note in five days"},
	{Method: "POST", Pattern: "/api/mail", Class: canDo, Label: "File an e-mail", Help: `Body: {"from", "subject", "body", "role": role number or 0}. For a message the person pasted or attached. It is read, tied to its role, and an answer is drafted.`, Show: []string{"subject"}},
	{Method: "POST", Pattern: "/api/mail/check", Class: canDo, Label: "Check the inbox", Help: "Works only when the inbox is connected. Background."},
	{Method: "PUT", Pattern: "/api/mail/{id}", Class: canDo, Kind: "mail", Label: "Update a reply", Help: `Body: any of {"state": "new|done", "draft": "the answer to send", "role": role number}.`, Show: []string{"state"}},
	{Method: "POST", Pattern: "/api/talks", Class: canDo, Label: "Add an interview or conversation", Help: `Body: {"kind": "interview|chat|screen", "title", "at": unix seconds, "minutes", "link", "role_id", "person_id"}. Work the time out from "Now" above; ask if the day or hour is unclear.`, Show: []string{"title"}},
	{Method: "PUT", Pattern: "/api/talks/{id}", Class: canDo, Kind: "talk", Label: "Update an interview", Help: `Body: any of {"title", "kind", "link", "notes", "at", "minutes"}.`},
	{Method: "POST", Pattern: "/api/talks/{id}/prep", Class: canDo, Kind: "talk", Label: "Prepare for an interview", Help: "Writes the preparation: likely questions, answers from the CV, what to ask them. Background."},
	{Method: "POST", Pattern: "/api/facts", Class: canDo, Label: "Keep a fact", Help: `Body: {"text": "one full sentence about the person"}. Used in every later application.`, Show: []string{"text"}},
	{Method: "POST", Pattern: "/api/answers", Class: canDo, Label: "Save an answer to a form question", Help: `Body: {"question", "answer"}. Reused when a form asks the same thing.`, Show: []string{"question"}},
	{Method: "POST", Pattern: "/api/arriving", Class: canDo, Label: "Build the arrival pack", Help: "Background."},
	{Method: "POST", Pattern: "/api/arriving/change", Class: canDo, Label: "Change the arrival pack", Help: `Body: {"index": n, "off": true|false} to leave out or keep change n.`},
	{Method: "POST", Pattern: "/api/arriving/apply", Class: canDo, Label: "Make the local version of the CV", Help: "Saves the arrival pack's changes as a new CV. The original stays."},
	{Method: "POST", Pattern: "/api/backup", Class: canDo, Label: "Back up now", Help: "Copies everything to a file on this computer and says where."},
	{Method: "POST", Pattern: "/api/llm/test", Class: canDo, Label: "Test the Claude connection"},
	{Method: "POST", Pattern: "/api/phone/test", Class: canDo, Label: "Send a test notification to the phone"},

	// ---- only with the person's OK --------------------------------------------
	{Method: "POST", Pattern: "/api/roles/{id}/no", Class: mustAsk, Kind: "role", Label: "Mark not interested", Help: `Body: {"why": "their reason, short"}. The role never comes back.`, Show: []string{"why"}},
	{Method: "POST", Pattern: "/api/roles/{id}/close", Class: mustAsk, Kind: "role", Label: "Close a role", Help: `Body: {"stage": "rejected|withdrawn|expired", "why": "..."}.`, Show: []string{"stage", "why"}},
	{Method: "POST", Pattern: "/api/roles/{id}/reopen", Class: mustAsk, Kind: "role", Label: "Reopen a role", Help: "Only when the person asks for this role by name."},
	{Method: "PUT", Pattern: "/api/profile", Class: mustAsk, Label: "Change your profile", Help: `Body: only the fields to change, from GET /api/you: name, headline, summary, years, strengths, rare, home, city, places (other towns that count as the city, besides its own surrounding area listed under "area"), country, arrive_on (YYYY-MM-DD), work_status (citizen|resident|permit|none), start_early, titles {"level": [], "step_up": [], "sideways": []}, domain, avoid, workplaces (remote,hybrid,onsite), pay_floor, pay_unit. A list is replaced whole: send the full new list.`},
	{Method: "PUT", Pattern: "/api/phone", Class: mustAsk, Label: "Change phone notifications", Help: `Body: any of {"on", "min_fit", "quiet_from", "quiet_to"} (hours 0-23). Where notifications are sent is changed by the person under You, Connections.`, Show: []string{"on", "min_fit", "quiet_from", "quiet_to"}, Only: true},
	{Method: "DELETE", Pattern: "/api/cvs/{id}", Class: mustAsk, Kind: "cv", Label: "Remove a CV"},
	{Method: "DELETE", Pattern: "/api/people/{id}", Class: mustAsk, Kind: "person", Label: "Remove a person"},
	{Method: "DELETE", Pattern: "/api/notes/{id}", Class: mustAsk, Kind: "note", Label: "Remove a note"},
	{Method: "DELETE", Pattern: "/api/mail/{id}", Class: mustAsk, Kind: "mail", Label: "Remove a reply"},
	{Method: "DELETE", Pattern: "/api/talks/{id}", Class: mustAsk, Kind: "talk", Label: "Remove an interview"},
	{Method: "DELETE", Pattern: "/api/facts/{id}", Class: mustAsk, Kind: "fact", Label: "Forget a fact"},
	{Method: "DELETE", Pattern: "/api/answers/{id}", Class: mustAsk, Kind: "answer", Label: "Forget a saved answer"},
}

// assistGuide is the table in words, for Claude.
var assistGuide = func() string {
	var b strings.Builder
	head := map[toolClass]string{
		canLook: "Looking (free)",
		canDo:   "Doing (done at once)",
		mustAsk: "Needs the person's OK (held until they press the button)",
	}
	last := toolClass(-1)
	for _, t := range tools {
		if t.Class != last {
			fmt.Fprintf(&b, "\n## %s\n", head[t.Class])
			last = t.Class
		}
		fmt.Fprintf(&b, "%s %s", t.Method, t.Pattern)
		if t.Label != "" {
			fmt.Fprintf(&b, " : %s.", t.Label)
		}
		if t.Help != "" {
			b.WriteString(" " + t.Help)
		}
		b.WriteByte('\n')
	}
	b.WriteString("\nNothing else can be called. Times are unix seconds.\n")
	return b.String()
}()

// findTool matches a call against the table.
func findTool(method, p string) (*tool, int64) {
	segs := strings.Split(p, "/")
	for i := range tools {
		t := &tools[i]
		if t.Method != method {
			continue
		}
		want := strings.Split(t.Pattern, "/")
		if len(want) != len(segs) {
			continue
		}
		var id int64
		ok := true
		for j := range want {
			if want[j] == "{id}" {
				n, err := strconv.ParseInt(segs[j], 10, 64)
				if err != nil || n <= 0 {
					ok = false
					break
				}
				id = n
			} else if want[j] != segs[j] {
				ok = false
				break
			}
		}
		if ok {
			return t, id
		}
	}
	return nil, 0
}

// ---- the conversation as stored ---------------------------------------------------------

// held is something the assistant wanted to do that waits for the person.
type held struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Body   string `json:"body,omitempty"`
	File   int64  `json:"file,omitempty"`
	Label  string `json:"label"`          // from the program: what this does, and to what
	Why    string `json:"why,omitempty"`  // from Claude: why it wants to
	Note   string `json:"note,omitempty"` // from the program: why it was held, when that is unusual
	State  string `json:"state"`          // waiting, done, declined, failed
	Result string `json:"result,omitempty"`
}

// did is something the assistant did.
type did struct {
	Label string `json:"label"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type chatExtra struct {
	Page    string `json:"page,omitempty"`
	Did     []did  `json:"did,omitempty"`
	Held    []held `json:"held,omitempty"`
	Problem bool   `json:"problem,omitempty"`
}

type assistState struct {
	confirm sync.Mutex // one answer to a held action at a time
	mu      sync.Mutex
	busy    bool
	doing   string
	cancel  context.CancelFunc
}

const (
	assistSteps    = 8
	assistCalls    = 8        // per step
	assistFiles    = 5        // per message
	assistFileSize = 15 << 20 // one attachment
	assistImage    = 5 << 20  // one picture; larger ones are refused by Claude
)

// ---- calling the app from inside ------------------------------------------------------

type recorder struct {
	code int
	head http.Header
	buf  bytes.Buffer
}

func (r *recorder) Header() http.Header         { return r.head }
func (r *recorder) WriteHeader(code int)        { r.code = code }
func (r *recorder) Write(b []byte) (int, error) { return r.buf.Write(b) }

// inside makes a call the way one of the app's own pages would, through the
// same guard and the same handlers.
func (s *Server) inside(ctx context.Context, method, target string, body []byte, ctype string) (int, []byte) {
	if s.inner == nil {
		return 500, []byte(`{"error":"not ready"}`)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.origin()+target, bytes.NewReader(body))
	if err != nil {
		return 400, []byte(`{"error":"couldn't understand the call"}`)
	}
	req.Header.Set("X-JobHunt", "1")
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	rec := &recorder{code: 200, head: http.Header{}}
	s.inner.ServeHTTP(rec, req)
	return rec.code, rec.buf.Bytes()
}

var secretKey = regexp.MustCompile(`(?i)^(pass|password|key|key_hash|token|secret|topic|data|cli)$`)

// prune makes a result small enough to show Claude and takes out anything
// secret. Every string it passes is also written to seen, so the program
// knows which web addresses came from the app's own data.
func prune(v any, maxStr, maxArr int, seen *strings.Builder) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, val := range x {
			if secretKey.MatchString(k) {
				continue
			}
			out[k] = prune(val, maxStr, maxArr, seen)
		}
		return out
	case []any:
		n := len(x)
		if n > maxArr {
			x = x[:maxArr]
		}
		out := make([]any, 0, len(x)+1)
		for _, val := range x {
			out = append(out, prune(val, maxStr, maxArr, seen))
		}
		if n > maxArr {
			out = append(out, fmt.Sprintf("(%d more not shown; ask for a narrower list or the next page)", n-maxArr))
		}
		return out
	case string:
		if seen != nil {
			seen.WriteString(x)
			seen.WriteByte('\n')
		}
		if len(x) > maxStr {
			cut := maxStr
			for cut > 0 && !utf8.RuneStart(x[cut]) {
				cut--
			}
			return x[:cut] + fmt.Sprintf(" …(%d more characters)", len(x)-cut)
		}
		return x
	}
	return v
}

// shrink turns a JSON result into text for Claude.
func shrink(raw []byte, seen *strings.Builder) string {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return "(not something that can be read here)"
	}
	for i, lim := range [][2]int{{6000, 40}, {1500, 25}, {400, 12}, {160, 6}} {
		var sink *strings.Builder
		if i == 0 {
			sink = seen
		}
		b, _ := json.Marshal(prune(v, lim[0], lim[1], sink))
		if len(b) <= 24000 || i == 3 {
			if len(b) > 30000 {
				return string(b[:30000]) + " …(cut short)"
			}
			return string(b)
		}
	}
	return ""
}

func errorOf(raw []byte) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Error != "" {
		return e.Error
	}
	return clipTo(strings.TrimSpace(string(raw)), 200)
}

func clipTo(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + "…"
}

var webAddr = regexp.MustCompile(`https?://[^\s"'<>\\]+`)

// strangerURL returns a web address in text that the person never gave and
// the app's data never showed. An address like that was made up, and making
// one up is how something read in a posting could carry the person's details
// out of this computer.
func strangerURL(text, known string) string {
	for _, u := range webAddr.FindAllString(text, -1) {
		u = strings.TrimRight(u, ".,;:)]}")
		if !strings.Contains(known, u) {
			return u
		}
	}
	return ""
}

// ---- saying plainly what a call does --------------------------------------------------

func (s *Server) nameOf(kind string, id int64) string {
	st := s.S
	switch kind {
	case "role":
		if r, err := st.Role(id); err == nil {
			return r.Title + " at " + r.Company
		}
	case "person":
		if p, err := st.Person(id); err == nil {
			if p.Company != "" {
				return p.Name + " (" + p.Company + ")"
			}
			return p.Name
		}
	case "cv":
		if c, err := st.CV(id); err == nil {
			return c.Name
		}
	case "company":
		if c, err := st.Company(id); err == nil {
			return c.Name
		}
	case "note":
		if n, err := st.Note(id); err == nil {
			if p, err := st.Person(n.PersonID); err == nil {
				return "to " + p.Name
			}
			return clipTo(n.Subject, 60)
		}
	case "mail":
		if m, err := st.Mail(id); err == nil {
			return clipTo(m.Subject, 70)
		}
	case "talk":
		if t, err := st.Talk(id); err == nil {
			return clipTo(t.Title, 70)
		}
	case "question":
		if q, err := st.Question(id); err == nil {
			return clipTo(q.Text, 70)
		}
	case "fact":
		list, _ := st.Facts()
		for _, f := range list {
			if f.ID == id {
				return clipTo(f.Text, 90)
			}
		}
	case "answer":
		list, _ := st.Answers()
		for _, a := range list {
			if a.ID == id {
				return clipTo(a.Question, 90)
			}
		}
	}
	return ""
}

// describe says what a call does in the person's words. It is built by the
// program from the table and from what is stored, never from what Claude
// said, so the button the person presses is labelled truthfully.
func (s *Server) describe(t *tool, id int64, body []byte) string {
	out := t.Label
	var fields map[string]any
	json.Unmarshal(body, &fields)
	switch t.Pattern {
	case "/api/pause":
		if fields["paused"] == true {
			return "Pause searching"
		}
		return "Resume searching"
	case "/api/roles/{id}/save":
		out = "Save for later"
		if fields["off"] == true {
			out = "Unsave"
		}
	}
	if t.Kind != "" {
		name := s.nameOf(t.Kind, id)
		if name == "" {
			name = "(not found)"
		}
		out += ": " + name
	}
	if t.Pattern == "/api/profile" && t.Method == "PUT" {
		var cur map[string]any
		b, _ := json.Marshal(s.S.Profile())
		json.Unmarshal(b, &cur)
		var parts []string
		for _, k := range sortedKeys(fields) {
			was, _ := json.Marshal(cur[k])
			now, _ := json.Marshal(fields[k])
			if string(was) == string(now) || k == "setup_done" {
				continue
			}
			parts = append(parts, fmt.Sprintf("%s: %s → %s", strings.ReplaceAll(k, "_", " "), plain(cur[k]), plain(fields[k])))
		}
		if len(parts) == 0 {
			return out + " (nothing would change)"
		}
		return out + ". " + strings.Join(parts, "; ")
	}
	var parts []string
	for _, k := range t.Show {
		if v, ok := fields[k]; ok && plain(v) != "" {
			parts = append(parts, plain(v))
		}
	}
	if len(parts) > 0 {
		out += " (" + strings.Join(parts, ", ") + ")"
	}
	return out
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// plain writes a JSON value the way a person would read it.
func plain(v any) string {
	switch x := v.(type) {
	case nil:
		return "nothing"
	case string:
		if x == "" {
			return "nothing"
		}
		return clipTo(x, 90)
	case bool:
		if x {
			return "yes"
		}
		return "no"
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case []any:
		if len(x) == 0 {
			return "none"
		}
		parts := make([]string, 0, len(x))
		for _, e := range x {
			parts = append(parts, plain(e))
		}
		return clipTo(strings.Join(parts, ", "), 220)
	case map[string]any:
		parts := make([]string, 0, len(x))
		for _, k := range sortedKeys(x) {
			parts = append(parts, strings.ReplaceAll(k, "_", " ")+" "+plain(x[k]))
		}
		return clipTo(strings.Join(parts, "; "), 320)
	}
	return ""
}

// ---- one message, start to finish ----------------------------------------------------

// screenCall is what to read for the person's open screen, so the assistant
// starts out seeing what they see.
func screenCall(page string) string {
	u, err := url.Parse(strings.TrimPrefix(page, "#"))
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	num := func(i int) string {
		if len(parts) > i {
			if n, err := strconv.ParseInt(parts[i], 10, 64); err == nil && n > 0 {
				return strconv.FormatInt(n, 10)
			}
		}
		return ""
	}
	q := ""
	if u.RawQuery != "" {
		q = "?" + u.RawQuery
	}
	switch parts[0] {
	case "", "today":
		return "/api/today"
	case "radar":
		return "/api/radar"
	case "roles":
		if id := num(1); id != "" {
			return "/api/roles/" + id
		}
		if len(parts) > 1 && parts[1] == "board" {
			return "/api/board"
		}
		return "/api/roles" + q
	case "people":
		if id := num(1); id != "" {
			return "/api/people/" + id
		}
		return "/api/people" + q
	case "replies":
		return "/api/mail" + q
	case "interviews":
		if id := num(1); id != "" {
			return "/api/talks/" + id
		}
		return "/api/talks"
	case "progress":
		return "/api/progress"
	case "you":
		if len(parts) > 1 {
			switch parts[1] {
			case "arriving":
				return "/api/arriving"
			case "connections":
				return "/api/connections"
			case "app":
				return "/api/app"
			}
		}
		return "/api/you"
	}
	return ""
}

type assistRun struct {
	known strings.Builder // everything the person said and the app showed
	files map[int64]bool  // attachments of this conversation
	did   []did
	held  []held
}

// call decides about one call the assistant asked for, makes it if it may,
// and returns what Claude is told.
func (s *Server) assistCall(ctx context.Context, c brain.AssistCall, run *assistRun) brain.AssistNote {
	method := strings.ToUpper(strings.TrimSpace(c.Method))
	note := brain.AssistNote{Call: method + " " + c.Path}
	u, err := url.Parse(c.Path)
	if err != nil || u.Scheme != "" || u.Host != "" || !strings.HasPrefix(u.Path, "/api/") || path.Clean(u.Path) != u.Path {
		note.Result = "Not made: that is not one of the calls listed."
		return note
	}
	t, id := findTool(method, u.Path)
	if t == nil {
		note.Result = "Not made: that is not available to you. If it is about a password, a key or a connection, the person does it themselves under You, Connections."
		return note
	}
	body := []byte(strings.TrimSpace(c.Body))
	if len(body) > 0 && !json.Valid(body) {
		note.Result = "Not made: the body is not valid JSON."
		return note
	}
	if t.Only && len(body) > 0 {
		// Only the fields the person will be shown may ride along.
		var all, keep map[string]any
		json.Unmarshal(body, &all)
		keep = map[string]any{}
		for _, k := range t.Show {
			if v, ok := all[k]; ok {
				keep[k] = v
			}
		}
		body, _ = json.Marshal(keep)
	}
	ctype := ""
	var file int64
	if t.File {
		if !run.files[c.File] {
			note.Result = "Not made: set \"file\" to the number of an attachment in this conversation."
			return note
		}
		file, body = c.File, nil
	} else if len(body) > 0 {
		ctype = "application/json"
	}
	class, why := t.Class, ""
	if class == canDo {
		if bad := strangerURL(string(body)+" "+u.RawQuery, run.known.String()); bad != "" {
			class, why = mustAsk, "It uses a web address that is not in your messages or in the app: "+clipTo(bad, 120)
		}
	}
	if class == mustAsk {
		run.held = append(run.held, held{Method: method, Path: c.Path, Body: string(body), File: file, Label: s.describe(t, id, body), Why: clipTo(c.Why, 160), Note: why, State: "waiting"})
		note.Result = "Not done. It is waiting for the person's OK: Job Hunt is showing them a button for it under your reply."
		return note
	}
	label := ""
	if class == canDo {
		label = s.describe(t, id, body)
	}
	code, out := s.run(ctx, method, c.Path, body, ctype, file)
	if code >= 400 {
		msg := errorOf(out)
		note.Result = "Failed: " + msg
		if class == canDo {
			run.did = append(run.did, did{Label: label, Error: msg})
		}
		return note
	}
	note.Result = shrink(out, &run.known)
	if class == canDo {
		run.did = append(run.did, did{Label: label, OK: true})
	}
	return note
}

// run makes a call from the table, sending an attachment as the body when
// the call takes one.
func (s *Server) run(ctx context.Context, method, target string, body []byte, ctype string, file int64) (int, []byte) {
	if file != 0 {
		f, err := s.S.ChatFile(file)
		if err != nil {
			return 404, []byte(`{"error":"That attachment isn't here any more."}`)
		}
		body, ctype = f.Data, f.Mime
	}
	return s.inside(ctx, method, target, body, ctype)
}

func (s *Server) setDoing(text string) {
	s.assist.mu.Lock()
	s.assist.doing = text
	s.assist.mu.Unlock()
	s.S.Changed("assistant")
}

// assistTurn answers one message: Claude asks for calls, they are made or
// held, and it goes round until Claude has its reply.
func (s *Server) assistTurn(ctx context.Context, turnID int64, text, page string) {
	run := &assistRun{files: map[int64]bool{}}
	in := brain.AssistInput{Guide: assistGuide, Page: page, Message: text}
	run.known.WriteString(text + "\n")

	turns, _ := s.S.Chats(14)
	var ids []int64
	for _, t := range turns {
		if t.Who == "you" {
			ids = append(ids, t.ID)
			run.known.WriteString(t.Text + "\n")
		}
		if t.ID == turnID {
			continue
		}
		line := t.Text
		if t.Who != "you" {
			var x chatExtra
			json.Unmarshal(t.Extra, &x)
			for _, d := range x.Did {
				if d.OK {
					line += "\n(done: " + d.Label + ")"
				}
			}
			for _, h := range x.Held {
				line += "\n(" + h.State + ": " + h.Label + ")"
			}
		}
		in.History = append(in.History, brain.AssistTurn{Who: t.Who, Text: line})
	}
	// Attachments: the words of every document still in the conversation,
	// newest first until the room runs out; pictures of this message only.
	files, _ := s.S.ChatFiles(true, ids...)
	room := 120000
	for i := len(files) - 1; i >= 0; i-- {
		f := files[i]
		run.files[f.ID] = true
		af := brain.AssistFile{ID: f.ID, Name: f.Name, Kind: f.Kind, Old: f.ChatID != turnID}
		if f.Kind == "text" {
			run.known.WriteString(f.Text + "\n")
			if room > 0 {
				af.Text = clipText(f.Text, min(room, 60000))
				room -= len(af.Text)
			} else {
				af.Text = "(too much attached to show again; ask the person to attach it again if you need it)"
			}
		}
		if f.Kind == "image" && f.ChatID == turnID && len(in.Images) < assistFiles {
			if full, err := s.S.ChatFile(f.ID); err == nil {
				in.Images = append(in.Images, llm.Image{Mime: full.Mime, Data: full.Data})
			}
		}
		in.Files = append([]brain.AssistFile{af}, in.Files...)
	}

	if p := screenCall(page); p != "" {
		if code, out := s.inside(ctx, "GET", p, nil, ""); code < 400 {
			in.Notes = append(in.Notes, brain.AssistNote{Call: "GET " + p + " (what is on their screen)", Result: shrink(out, &run.known)})
		}
	}

	final, problem := "", false
	for step := 0; step < assistSteps; step++ {
		in.Last = step == assistSteps-1
		out, err := s.E.Assist(ctx, in)
		if err != nil {
			problem = true
			if errors.Is(ctx.Err(), context.Canceled) {
				final = "Stopped."
			} else {
				_, final = say(err)
			}
			break
		}
		if len(out.Calls) == 0 || in.Last {
			final = strings.TrimSpace(out.Say)
			break
		}
		doing := clipTo(out.Doing, 80)
		if doing == "" {
			doing = "Working"
		}
		s.setDoing(doing)
		for i, c := range out.Calls {
			if i >= assistCalls {
				in.Notes = append(in.Notes, brain.AssistNote{Call: strings.ToUpper(c.Method) + " " + c.Path, Result: "Not made: too many calls in one step. Ask again in the next step."})
				continue
			}
			in.Notes = append(in.Notes, s.assistCall(ctx, c, run))
		}
		// Keep what Claude is shown from growing without end.
		total := 0
		for i := len(in.Notes) - 1; i >= 0; i-- {
			total += len(in.Notes[i].Result)
			if total > 150000 {
				in.Notes[i].Result = "(shown to you earlier; dropped to save room)"
			}
		}
	}
	if final == "" {
		switch {
		case len(run.held) > 0:
			final = "This needs your OK."
		case len(run.did) > 0:
			final = "Done."
		default:
			final = "I couldn't finish that. Try asking in a different way."
			problem = true
		}
	}
	s.S.AddChat("claude", final, chatExtra{Did: run.did, Held: run.held, Problem: problem})
}

func clipText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + fmt.Sprintf("\n…(%d more characters not shown)", len(s)-n)
}

// ---- the routes the panel uses -----------------------------------------------------

var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

// readAttachment works out what an attached file is and reads its words
// when it has any.
func readAttachment(name string, data []byte) (store.ChatFile, error) {
	f := store.ChatFile{Name: name, Data: data, Kind: "other"}
	sniff := http.DetectContentType(data)
	if i := strings.Index(sniff, ";"); i > 0 {
		sniff = sniff[:i]
	}
	f.Mime = sniff
	ext := strings.ToLower(path.Ext(name))
	switch {
	case imageTypes[sniff]:
		if len(data) > assistImage {
			return f, bad("That picture is too large (over 5 MB). Take a smaller screenshot or crop it.")
		}
		f.Kind = "image"
	case strings.HasPrefix(sniff, "image/"):
		return f, bad("That kind of picture can't be read. Use PNG or JPEG.")
	case ext == ".docx" || ext == ".pdf" || sniff == "application/pdf" || sniff == "application/zip":
		text, err := office.ExtractText(name, data)
		if err != nil {
			if errors.Is(err, office.ErrUnsupported) {
				return f, bad(strings.TrimPrefix(err.Error(), office.ErrUnsupported.Error()+": "))
			}
			return f, bad("That file couldn't be read. Word (.docx), PDF, text and pictures work.")
		}
		f.Kind, f.Text = "text", text
	case utf8.Valid(data) && !bytes.ContainsRune(data, 0):
		f.Kind, f.Text = "text", string(data)
		if ext == ".csv" {
			f.Mime = "text/csv"
		}
	default:
		return f, bad("That file couldn't be read. Word (.docx), PDF, text and pictures work.")
	}
	return f, nil
}

func (s *Server) assistRoutes(h func(string, handler), mux *http.ServeMux) {
	st := s.S
	view := func() (any, error) {
		turns, err := st.Chats(60)
		if err != nil {
			return nil, err
		}
		ids := []int64{0}
		for _, t := range turns {
			ids = append(ids, t.ID)
		}
		files, _ := st.ChatFiles(false, ids...)
		s.assist.mu.Lock()
		busy, doing := s.assist.busy, s.assist.doing
		s.assist.mu.Unlock()
		return map[string]any{"turns": turns, "files": files, "busy": busy, "doing": doing, "engine": s.E.LLM().Engine}, nil
	}
	h("GET /api/assistant", func(w http.ResponseWriter, r *http.Request) (any, error) { return view() })
	h("POST /api/assistant", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Text  string  `json:"text"`
			Page  string  `json:"page"`
			Files []int64 `json:"files"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		in.Text = strings.TrimSpace(in.Text)
		if in.Text == "" && len(in.Files) == 0 {
			return nil, bad("Type a question, or something to do.")
		}
		if len(in.Text) > 20000 {
			return nil, bad("That is too long for one message. Attach it as a file instead.")
		}
		if len(in.Files) > assistFiles {
			return nil, bad(fmt.Sprintf("At most %d attachments with one message.", assistFiles))
		}
		if s.E.LLM().Engine == "" {
			return nil, llm.ErrNotConnected
		}
		if in.Text == "" {
			in.Text = "(attached without a message)"
		}
		if !strings.HasPrefix(in.Page, "#/") || len(in.Page) > 300 {
			in.Page = ""
		}
		s.assist.mu.Lock()
		if s.assist.busy {
			s.assist.mu.Unlock()
			return nil, &apiError{409, "Still working on the last thing. Wait for it, or press Stop."}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
		s.assist.busy, s.assist.doing, s.assist.cancel = true, "Thinking", cancel
		s.assist.mu.Unlock()
		id, err := st.AddChat("you", in.Text, chatExtra{Page: in.Page})
		if err == nil {
			err = st.SendChatFiles(id, in.Files)
		}
		if err != nil {
			cancel()
			s.assist.mu.Lock()
			s.assist.busy = false
			s.assist.mu.Unlock()
			return nil, err
		}
		go func() {
			defer func() {
				cancel()
				s.assist.mu.Lock()
				s.assist.busy, s.assist.doing, s.assist.cancel = false, "", nil
				s.assist.mu.Unlock()
				st.Changed("assistant")
			}()
			s.assistTurn(ctx, id, in.Text, in.Page)
		}()
		return view()
	})
	h("POST /api/assistant/stop", func(w http.ResponseWriter, r *http.Request) (any, error) {
		s.assist.mu.Lock()
		if s.assist.cancel != nil {
			s.assist.cancel()
		}
		s.assist.mu.Unlock()
		return nil, nil
	})
	h("DELETE /api/assistant", func(w http.ResponseWriter, r *http.Request) (any, error) {
		s.assist.mu.Lock()
		busy := s.assist.busy
		s.assist.mu.Unlock()
		if busy {
			return nil, &apiError{409, "Still working on the last thing. Press Stop first."}
		}
		return nil, st.ClearChat()
	})
	// The person's answer to something that was held for them.
	h("POST /api/assistant/confirm", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Turn  int64 `json:"turn"`
			Index int   `json:"index"`
			OK    bool  `json:"ok"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		s.assist.confirm.Lock()
		defer s.assist.confirm.Unlock()
		turn, err := st.ChatTurn(in.Turn)
		if err != nil {
			return nil, err
		}
		var x chatExtra
		json.Unmarshal(turn.Extra, &x)
		if turn.Who != "claude" || in.Index < 0 || in.Index >= len(x.Held) || x.Held[in.Index].State != "waiting" {
			return nil, bad("That is no longer waiting.")
		}
		hd := &x.Held[in.Index]
		switch {
		case !in.OK:
			hd.State = "declined"
		default:
			u, _ := url.Parse(hd.Path)
			var t *tool
			var id int64
			if u != nil {
				t, id = findTool(hd.Method, u.Path)
			}
			// What the button said must still be what the call does: the
			// thing may have been removed, or its number reused, since.
			if t == nil || s.describe(t, id, []byte(hd.Body)) != hd.Label || s.E.Now().Unix()-turn.At > 24*3600 {
				hd.State, hd.Result = "failed", "This has changed since it was offered. Ask again."
				break
			}
			ctype := ""
			if hd.Body != "" {
				ctype = "application/json"
			}
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
			code, out := s.run(ctx, hd.Method, hd.Path, []byte(hd.Body), ctype, hd.File)
			cancel()
			if code >= 400 {
				hd.State, hd.Result = "failed", errorOf(out)
			} else {
				hd.State = "done"
			}
		}
		if err := st.SetChatExtra(turn.ID, x); err != nil {
			return nil, err
		}
		return map[string]any{"state": hd.State, "result": hd.Result}, nil
	})
	// Attachments are sent ahead of the message they go with.
	h("POST /api/assistant/files", func(w http.ResponseWriter, r *http.Request) (any, error) {
		name := path.Base(strings.ReplaceAll(r.URL.Query().Get("name"), `\`, "/"))
		if name == "." || name == "/" || name == "" {
			name = "attachment"
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, assistFileSize+1))
		if err != nil || len(data) == 0 {
			return nil, bad("That file is empty.")
		}
		if len(data) > assistFileSize {
			return nil, bad("That file is too large (over 15 MB).")
		}
		if waiting, _ := st.ChatFiles(false, 0); len(waiting) >= assistFiles {
			return nil, bad(fmt.Sprintf("At most %d attachments with one message.", assistFiles))
		}
		f, err := readAttachment(clipTo(name, 120), data)
		if err != nil {
			return nil, err
		}
		id, err := st.AddChatFile(f)
		if err != nil {
			return nil, err
		}
		f.ID, f.Size = id, len(data)
		st.Changed("assistant")
		return f, nil
	})
	h("DELETE /api/assistant/files/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		err := st.DropChatFile(idOf(r))
		st.Changed("assistant")
		return nil, err
	})
	// Pictures are shown back in the conversation. Nothing else is served:
	// a document someone attached is never opened as a page.
	mux.HandleFunc("GET /api/assistant/files/{id}", func(w http.ResponseWriter, r *http.Request) {
		f, err := st.ChatFile(idOf(r))
		if err != nil || f.Kind != "image" || !imageTypes[f.Mime] {
			http.Error(w, "not here", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", f.Mime)
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		w.Write(f.Data)
	})
}
