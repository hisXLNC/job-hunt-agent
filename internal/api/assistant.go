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
// The table covers every screen. What is left out on purpose is named in
// notForAssistant (assistant_list_test.go checks that every call the app
// answers is in one or the other): typing in a key, a password, the VPN
// file or the calendar's private address, pairing a phone or the side
// panel, pressing its own buttons, and stopping the program. For those it
// opens the screen where the person does that one step.

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
	{Method: "GET", Pattern: "/api/roles", Help: "Roles, a page at a time. Query: stage (comma-separated: new,found,ready,applied,reply,interview,offer), closed (all, or comma-separated: screened,no,rejected,expired,withdrawn; left out means open roles only), band (level,step_up,sideways), minfit (0-100), minpay (a yearly figure such as 100000; 1 for any pay named), q (words), company (employer number), saved=1, sort (age,fit,title,company,applicants,stage,pay; a leading - reverses), page, size (up to 100). Returns total and counts by stage."},
	{Method: "GET", Pattern: "/api/career", Help: "The Career path screen: where the person stands now, the three routes their CV can take (pay, what is missing, the steps), titles to try, and \"cvs\": the CVs the reading was made from. All of the person's CVs are read together for it; none is chosen over the others."},
	{Method: "GET", Pattern: "/api/board", Help: "The first few roles in each stage, with counts."},
	{Method: "GET", Pattern: "/api/roles/{id}", Kind: "role", Help: "Everything about one role: the posting, how it was read (fit, what it asks for, what the person has), the tailored CV with each change, the letter, the case for the hiring manager, people there, notes, mail, interviews, what happened."},
	{Method: "GET", Pattern: "/api/radar", Help: "Fresh roles from the last two days, recent searches and what they found, the titles searched for, how many roles were set aside by the rules."},
	{Method: "GET", Pattern: "/api/companies/{id}", Kind: "company", Help: "One employer: its postings with fit and pay, what the person sent there, people there, what employees say, the person's notes."},
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
	{Method: "GET", Pattern: "/api/import/old", Help: "Whether the old Job Hunt's data is on this computer and what it holds (jobs applied to, prepared, CVs, people), and what was last brought over from it. Bringing it over is the person's own button under Settings, The app."},
	{Method: "GET", Pattern: "/api/places", Help: "Where Job Hunt looks besides employers' own boards: the title searches (LinkedIn, Job Bank, FreeHire), the job sites and recruiters being watched, whether each is on, what each found in the last full search, any that is resting and why, and the sites that could be added (suggested)."},
	{Method: "GET", Pattern: "/api/notices", Help: "What is under the bell: the last fifty things Job Hunt told the person (a fresh strong role, someone wrote, a new version, a problem), newest first, each with the page it opens and whether it was read."},
	{Method: "GET", Pattern: "/api/calendar", Help: "Everything with a date around a month: interviews, booked conversations, the days follow-ups are due and the days postings close. Query: from, to (unix seconds, at most 100 days apart); left out means this month."},
	{Method: "GET", Pattern: "/api/find", Help: "Quick search across roles, people and employers. Query: q."},
	{Method: "GET", Pattern: "/api/leads", Help: "The Leads screen: news of employers that are hiring or growing, each with what Job Hunt made of it and where it stands. Query: show (open, dismissed, all), size."},
	{Method: "GET", Pattern: "/api/leads/{id}", Kind: "lead", Help: "One lead in full: the news, the people to write to, the notes written for it."},
	{Method: "GET", Pattern: "/api/insights", Help: "What is working: answers by CV, title, source, level and how early the person applied, and what Job Hunt advises from it. Query: days (30)."},
	{Method: "GET", Pattern: "/api/sources", Help: "Every job source on one list (employers' boards, LinkedIn, Job Bank, Indeed through Claude, the keyed ones): whether each is working, the last error in plain words, when it was last asked and what it found. Keys are left out."},
	{Method: "GET", Pattern: "/api/sources/{key}/postings", Help: "The postings one source showed lately. {key} is the source's id from /api/sources. Query: show, size."},
	{Method: "GET", Pattern: "/api/searchset", Help: "The searching choices: employee ratings, the lowest rating kept, clearing old roles, reading big batches at night; and tonight's batch."},
	{Method: "GET", Pattern: "/api/desk", Help: "This computer: Windows notifications, the morning summary's hour, staying awake, waking for a search, noticing copied job links, the browser links open in; and the search times."},
	{Method: "GET", Pattern: "/api/files", Help: "The folder on this computer where each role's CV and letter are kept as files (\"dir\"), whether that is on, and the folders in it."},
	{Method: "GET", Pattern: "/api/backups", Help: "The saved copies of all the data: where they are kept, how many, each with its date."},
	{Method: "GET", Pattern: "/api/changes", Help: "What changed in each version of Job Hunt, newest first."},
	{Method: "GET", Pattern: "/api/google", Help: "Whether Google Calendar is signed in and in step. Nothing that works as a key."},
	{Method: "GET", Pattern: "/api/google/lookalikes", Help: "Entries in the person's Google Calendar that look like interviews and are not tied to a role yet."},
	{Method: "GET", Pattern: "/api/cvs/{id}/look", Kind: "cv", Help: "How one CV reads to a hiring manager: strengths, what is weak, what to fix."},
	{Method: "GET", Pattern: "/api/rescore", Help: "Whether roles are being scored again, and how far along."},
	{Method: "GET", Pattern: "/api/debug", Help: "The technical log: what Job Hunt did and what failed, newest last, and the log file's path. For working out why something went wrong."},

	// ---- doing ----------------------------------------------------------------
	{Method: "POST", Pattern: "/api/questions/{id}/answer", Class: canDo, Kind: "question", Label: "Answer a question Job Hunt asked", Help: `Body: {"answer": "..."}. Only with what the person said.`, Show: []string{"answer"}},
	{Method: "POST", Pattern: "/api/cvs", Class: canDo, Label: "Add a CV", Help: `Query: name (the file name). Set "file" to the attachment; no body. Takes about a minute.`, File: true},
	{Method: "PUT", Pattern: "/api/cvs/{id}", Class: canDo, Kind: "cv", Label: "Rename a CV or say what it is for", Help: `Body: {"name": "...", "focus": "which roles this CV is for"}. Either field may be left out.`, Show: []string{"name", "focus"}},
	{Method: "POST", Pattern: "/api/roles", Class: canDo, Label: "Add a role", Help: `Body: {"company", "title", "location", "url", "description"}. For a posting the person pasted, attached or described. Put the whole posting text in description. Returns its number; it is read straight away.`, Show: []string{"title", "company"}},
	{Method: "POST", Pattern: "/api/roles/{id}/prepare", Class: canDo, Kind: "role", Label: "Prepare the CV and letter", Help: "Starts tailoring the CV and writing the letter. Runs in the background, about a minute."},
	{Method: "POST", Pattern: "/api/roles/{id}/read", Class: canDo, Kind: "role", Label: "Read the posting again", Help: "Reads the posting again and scores the fit. Background."},
	{Method: "POST", Pattern: "/api/roles/{id}/applied", Class: canDo, Kind: "role", Label: "Mark as applied", Help: `Body: {"how": "where they applied, optional"}. Only when the person says they sent the application.`},
	{Method: "POST", Pattern: "/api/roles/{id}/stage", Class: canDo, Kind: "role", Label: "Move to another stage", Help: `Body: {"stage": "found|ready|applied|reply|interview|offer"}.`, Show: []string{"stage"}},
	{Method: "POST", Pattern: "/api/roles/{id}/save", Class: canDo, Kind: "role", Label: "Bookmark or remove the bookmark", Help: `Body: {"off": false} to bookmark a role (it shows with saved=1), {"off": true} to remove the bookmark. It does not take the role off Today; "later" does that.`},
	{Method: "POST", Pattern: "/api/roles/{id}/later", Class: canDo, Kind: "role", Label: "Save for later", Help: `Body: {"days": 1|3|7} keeps an open role off Today until then; {"days": 0} brings it back now. Refused for a closed role.`, Show: []string{"days"}},
	{Method: "POST", Pattern: "/api/roles/{id}/unapply", Class: canDo, Kind: "role", Label: "Take back \"applied\"", Help: "Only when the person says they did not send the application after all. The role goes back to ready (or found). Works only while the role is at applied."},
	{Method: "POST", Pattern: "/api/roles/{id}/letterstyle", Class: canDo, Kind: "role", Label: "Write the letter in another style", Help: `Body: {"style": "standard|formal|short|warm"}. Writes the letter again; the one before is kept and "undoletter" puts it back. About half a minute.`, Show: []string{"style"}},
	{Method: "POST", Pattern: "/api/roles/{id}/askletter", Class: canDo, Kind: "role", Label: "Change the letter as asked", Help: `Body: {"ask": "what the person wants changed, in their words"}. Writes the letter again with that done; the one before is kept. About half a minute.`, Show: []string{"ask"}},
	{Method: "POST", Pattern: "/api/roles/{id}/askcv", Class: canDo, Kind: "role", Label: "Tailor the CV again as asked", Help: `Body: {"ask": "what the person wants changed, in their words"}. Proposes the CV changes again with that done; the set before is kept and "undocv" puts it back. About a minute. It never adds experience the person does not have.`, Show: []string{"ask"}},
	{Method: "POST", Pattern: "/api/roles/{id}/undoletter", Class: canDo, Kind: "role", Label: "Put the earlier letter back", Help: "Restores the letter as it was before it was last written again."},
	{Method: "POST", Pattern: "/api/roles/{id}/undocv", Class: canDo, Kind: "role", Label: "Put the earlier CV changes back", Help: "Restores the CV changes as they were before the person last asked for changes."},
	{Method: "POST", Pattern: "/api/roles/{id}/chase", Class: canDo, Kind: "role", Label: "Write a follow-up", Help: "Drafts the one short follow-up e-mail for an application with no reply. The person reads and sends it themselves. Refused once a follow-up was sent. About half a minute."},
	{Method: "POST", Pattern: "/api/roles/{id}/chasesave", Class: canDo, Kind: "role", Label: "Reword the follow-up", Help: `Body: {"subject": "...", "text": "the whole e-mail"}. Both are replaced.`},
	{Method: "POST", Pattern: "/api/roles/{id}/chasesent", Class: canDo, Kind: "role", Label: "Mark the follow-up as sent", Help: "Only when the person says they sent it."},
	{Method: "POST", Pattern: "/api/roles/{id}/chasedrop", Class: canDo, Kind: "role", Label: "Stop suggesting a follow-up", Help: "When the person would rather let this application be. The application itself is untouched."},
	{Method: "POST", Pattern: "/api/roles/{id}/cv", Class: canDo, Kind: "role", Label: "Use another CV for this role", Help: `Body: {"cv": number}. Tailors again from that CV; about a minute.`},
	{Method: "POST", Pattern: "/api/roles/{id}/change", Class: canDo, Kind: "role", Label: "Change the tailored CV", Help: `Body: {"index": n, "off": true} to undo change n of the tailored CV (counting from 0), {"index": n, "off": false} to put it back, {"index": n, "after": "new wording"} to reword it. Never write experience the person does not have.`, Show: []string{"after"}},
	{Method: "POST", Pattern: "/api/roles/{id}/letter", Class: canDo, Kind: "role", Label: "Rewrite the letter", Help: `Body: {"text": "the whole letter"}. Replaces the letter. Keep it true to the CV and the facts.`},
	{Method: "POST", Pattern: "/api/roles/{id}/case", Class: canDo, Kind: "role", Label: "Write the case for the hiring manager", Help: "Writes a short note to the hiring manager for this role. Takes a little while."},
	{Method: "POST", Pattern: "/api/companies", Class: canDo, Label: "Watch an employer", Help: `Body: {"name": "...", "site": "its careers page, if the person gave one"}.`, Show: []string{"name"}},
	{Method: "POST", Pattern: "/api/companies/{id}/reviews", Class: canDo, Kind: "company", Label: "Look up what employees say", Help: "Reads public employee reviews of the employer. Background."},
	{Method: "POST", Pattern: "/api/companies/more", Class: canDo, Label: "Find more employers", Help: "Finds more employers that hire people like this one. Background."},
	{Method: "PUT", Pattern: "/api/companies/{id}", Class: canDo, Kind: "company", Label: "Change how an employer is watched", Help: `Body: {"state": "following|suggested|muted"} and/or {"board": "the address of its job board"} and/or {"about": "what the employer does, in one or two sentences, when the person tells you or corrects it"}. Muted employers are no longer searched.`, Show: []string{"state", "about"}},
	{Method: "POST", Pattern: "/api/places/switch", Class: canDo, Label: "Switch a job source on or off", Help: `Body: {"id": "the place's id from /api/places", "on": true|false}. Switching on also ends a rest.`, Show: []string{"id", "on"}, Only: true},
	{Method: "POST", Pattern: "/api/places", Class: canDo, Label: "Watch a job site or recruiter", Help: `Body: {"id": "a suggested site's id"} or {"name": "...", "url": "the address of the page that lists the jobs, given by the person; {title} and {place} may stand where the site's own search takes a job title and a town"}. The page is tried once; "found" says how many postings it showed and "note" why there were none.`, Show: []string{"id", "name", "url"}, Only: true},
	{Method: "POST", Pattern: "/api/search", Class: canDo, Label: "Search now", Help: `Body: {"kind": "fast"} for the watched employers only, {"kind": "full"} for everything. Background.`},
	{Method: "POST", Pattern: "/api/jobs/stop", Class: canDo, Label: "Stop what Job Hunt is doing", Help: `Body: {"name": "a running job's name from status.jobs in /api/state"}, or {} to stop everything running. Work Job Hunt starts by itself is then left alone for half an hour.`, Show: []string{"name"}},
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
	{Method: "POST", Pattern: "/api/handout/save", Class: canDo, Label: "Put a copy of a file in your folder", Help: `Body: {"what": "cv" (one of the person's CVs, "id" its number) | "role_cv" | "role_letter" | "role_both" ("id" the role's number), "format": "docx" | "pdf" (roles only)}. Writes the file into the files folder on this computer, opens that folder for the person, and returns the whole path of each file. Use it whenever they ask where a CV or letter is, or for a copy.`, Show: []string{"what", "format"}},
	{Method: "POST", Pattern: "/api/handout/mail", Class: canDo, Label: "E-mail a file to yourself", Help: `Body as for /api/handout/save. Sends the file as an attachment to the person's own address (the one the inbox is connected with) and to nobody else. Use it when they ask to be e-mailed a CV or letter. If it fails because the inbox isn't connected, put a copy in their folder instead and say so.`, Show: []string{"what", "format"}},
	{Method: "POST", Pattern: "/api/window", Class: canDo, Label: "Open a screen", Help: `Body: {"page": "#/..."}. Brings Job Hunt's window forward on that screen. Use it to take the person to the place where one step is theirs (pasting a key, signing in).`, Show: []string{"page"}, Only: true},
	{Method: "POST", Pattern: "/api/open-folder", Class: canDo, Label: "Open a folder on this computer", Help: `Body: {"what": "data" | "backups" | "extension"}. Opens it and returns its path.`, Show: []string{"what"}, Only: true},
	{Method: "POST", Pattern: "/api/files/show", Class: canDo, Label: "Open the files folder", Help: `Body: {"folder": "a folder's name from /api/files, or empty for the whole files folder"}. Returns its path.`},
	{Method: "POST", Pattern: "/api/files/role/{id}", Class: canDo, Kind: "role", Label: "Write a role's CV and letter into its folder", Help: "As Word files and PDFs; the folder is opened and its path returned."},
	{Method: "POST", Pattern: "/api/roles/link", Class: canDo, Label: "Add a role from its link", Help: `Body: {"text": "the posting's address, or text with it in"}. Opens the page, reads the posting and adds the role. Returns its number.`, Show: []string{"text"}},
	{Method: "POST", Pattern: "/api/roles/chaseall", Class: canDo, Label: "Write every follow-up that is due", Help: "Only when the person asks for all of them. Drafts; the person sends."},
	{Method: "POST", Pattern: "/api/roles/{id}/notes", Class: canDo, Kind: "role", Label: "Keep the person's notes on a role", Help: `Body: {"text": "the whole of their notes"}. Replaces what was there: read the role first and keep what they had.`},
	{Method: "POST", Pattern: "/api/roles/{id}/answers", Class: canDo, Kind: "role", Label: "Answer an application form's questions", Help: `Body: {"text": "the form's questions, one on each line"}. Writes answers from the CV and the saved answers. About a minute.`},
	{Method: "POST", Pattern: "/api/roles/{id}/check", Class: canDo, Kind: "role", Label: "Check the tailored CV", Help: "Reads the tailored CV as the employer's screening would and says what to fix. About a minute."},
	{Method: "POST", Pattern: "/api/roles/{id}/offer", Class: canDo, Kind: "role", Label: "Weigh an offer", Help: `Body: {"text": "the offer, as the person pasted it"}. About a minute.`},
	{Method: "POST", Pattern: "/api/roles/{id}/noreply", Class: canDo, Kind: "role", Label: "Write what to do about no reply", Help: "For an application that went unanswered. About half a minute."},
	{Method: "POST", Pattern: "/api/roles/{id}/findsite", Class: canDo, Kind: "role", Label: "Find the employer's own posting", Help: "Looks for this role on the employer's own website, to apply there directly."},
	{Method: "POST", Pattern: "/api/cvs/{id}/titles", Class: canDo, Kind: "cv", Label: "Suggest more titles from a CV", Help: "Returns titles this CV could also be searched under. About a minute."},
	{Method: "PUT", Pattern: "/api/companies/{id}/note", Class: canDo, Kind: "company", Label: "Keep a note on an employer", Help: `Body: {"text": "the whole note"}.`},
	{Method: "POST", Pattern: "/api/leads", Class: canDo, Label: "Add a lead", Help: `Body: {"text": "the news, as the person gave it", "url": "its address, if they gave one", "company": "the employer"}.`, Show: []string{"company"}},
	{Method: "POST", Pattern: "/api/leads/find", Class: canDo, Label: "Look for news of employers hiring", Help: "Background."},
	{Method: "PUT", Pattern: "/api/leads/auto", Class: canDo, Label: "Look for leads by itself, or stop", Help: `Body: {"on": true|false}.`, Show: []string{"on"}},
	{Method: "PUT", Pattern: "/api/leads/{id}", Class: canDo, Kind: "lead", Label: "Reword a lead's note", Help: `Body: {"which": "the note's name from the lead", "subject": "...", "body": "..."}.`},
	{Method: "POST", Pattern: "/api/leads/{id}/write", Class: canDo, Kind: "lead", Label: "Write a note for a lead", Help: `Body: {"which": "the note's name from the lead"}. A draft; the person sends it. Only when they ask.`},
	{Method: "POST", Pattern: "/api/leads/{id}/again", Class: canDo, Kind: "lead", Label: "Read a lead again"},
	{Method: "POST", Pattern: "/api/leads/{id}/dismiss", Class: canDo, Kind: "lead", Label: "Dismiss a lead", Help: `"restore" brings it back.`},
	{Method: "POST", Pattern: "/api/leads/{id}/restore", Class: canDo, Kind: "lead", Label: "Bring a lead back"},
	{Method: "POST", Pattern: "/api/leads/{id}/sent", Class: canDo, Kind: "lead", Label: "Mark a lead's note as sent", Help: `Body: {"on": true|false}. Only when the person says they sent it.`},
	{Method: "POST", Pattern: "/api/leads/{id}/followed", Class: canDo, Kind: "lead", Label: "Mark a lead as followed up", Help: `Body: {"on": true|false}.`},
	{Method: "POST", Pattern: "/api/leads/{id}/replied", Class: canDo, Kind: "lead", Label: "Mark a lead as answered", Help: `Body: {"on": true|false}.`},
	{Method: "POST", Pattern: "/api/leads/{id}/role", Class: canDo, Kind: "lead", Label: "Make a role from a lead", Help: "Returns the role's number."},
	{Method: "POST", Pattern: "/api/leads/{id}/employer", Class: canDo, Kind: "lead", Label: "Watch a lead's employer"},
	{Method: "POST", Pattern: "/api/leads/{id}/person", Class: canDo, Kind: "lead", Label: "Add a person from a lead", Help: `Body: {"who": the person's place in the lead's list, from 0}.`},
	{Method: "POST", Pattern: "/api/insights/read", Class: canDo, Label: "Look at what is working", Help: "Reads the results so far and writes the advice. Background."},
	{Method: "PUT", Pattern: "/api/insights/guidance", Class: canDo, Label: "Use what is working when scoring, or stop", Help: `Body: {"on": true|false}.`, Show: []string{"on"}},
	{Method: "POST", Pattern: "/api/career/look", Class: canDo, Label: "Read the career path again", Help: "From all the person's CVs together. Background, about a minute."},
	{Method: "POST", Pattern: "/api/career/search", Class: canDo, Label: "Search for a career path's titles", Help: `Body: {"route": the route's place from 0, to add all its titles} or {"title": "one title"}. Adds them to the titles searched for.`, Show: []string{"title"}},
	{Method: "POST", Pattern: "/api/career/done", Class: canDo, Label: "Tick off a step on the career path", Help: `Body: {"id": "the step's id", "done": true|false}.`},
	{Method: "POST", Pattern: "/api/talks/{id}/went", Class: canDo, Kind: "talk", Label: "Say how an interview went", Help: `Body: {"how": "the person's own words"}.`},
	{Method: "POST", Pattern: "/api/talks/{id}/thanks", Class: canDo, Kind: "talk", Label: "Write a thank-you", Help: "A draft for after an interview; the person sends it. Only when they ask. Background."},
	{Method: "PUT", Pattern: "/api/talks/{id}/thanks", Class: canDo, Kind: "talk", Label: "Reword a thank-you", Help: `Body: {"subject": "...", "body": "..."}.`},
	{Method: "PUT", Pattern: "/api/talkset", Class: canDo, Label: "Change the hours offered for interviews", Help: `Body: any of {"from", "to"} (hours 0-23), {"minutes"} (how long one is), {"offer"} (how many times to offer).`, Show: []string{"from", "to", "minutes", "offer"}},
	{Method: "POST", Pattern: "/api/mail/{id}/reply", Class: canDo, Kind: "mail", Label: "Write an answer to a message", Help: "A draft; the person sends it. Only when they ask. About half a minute."},
	{Method: "POST", Pattern: "/api/mail/draft", Class: canDo, Label: "Save a draft in the mailbox", Help: `Body: {"kind": "mail" | "chase" | "note", "id": the message's, role's or note's number, "to": "...", "subject": "...", "body": "..."}. Puts the written message in the mailbox's Drafts. Nothing is sent.`, Show: []string{"subject"}},
	{Method: "POST", Pattern: "/api/mail/recruiters", Class: canDo, Label: "Look through the mail for recruiters", Help: "Background."},
	{Method: "PUT", Pattern: "/api/mailset/switches", Class: canDo, Label: "Change the inbox's switches", Help: `Body: any of {"on", "drafts" (save written replies as drafts in the mailbox), "labels", "recruiters", "send" (let the person send from Job Hunt)} as true|false, {"every": minutes between checks}. The address and password are the person's to enter under Settings, Connections.`, Show: []string{"on", "drafts", "labels", "recruiters", "send", "every"}, Only: true},
	{Method: "POST", Pattern: "/api/jobs/resume", Class: canDo, Label: "Let Job Hunt carry on by itself", Help: "Ends the half hour it leaves its own work alone after being stopped."},
	{Method: "POST", Pattern: "/api/notices/read", Class: canDo, Label: "Mark what is under the bell as read", Help: `Body: {} for all, or {"id": one notice's number}.`},
	{Method: "POST", Pattern: "/api/budget/run", Class: canDo, Label: "Read tonight's batch now"},
	{Method: "POST", Pattern: "/api/sources/{key}/test", Class: canDo, Label: "Try a job source now", Help: "{key} is the source's id from /api/sources. Asks it once and returns how many postings it showed, or why it failed."},
	{Method: "PUT", Pattern: "/api/sources/{key}", Class: canDo, Label: "Switch a keyed job source on or off", Help: `Body: {"on": true|false} and/or {"limit": requests a day}. Its key is the person's to paste under Settings, Connections.`, Show: []string{"on", "limit"}, Only: true},
	{Method: "PUT", Pattern: "/api/vpn/{key}", Class: canDo, Label: "Send a source through the VPN, or not", Help: `{key} is a source's id from "vpn" in /api/connections. Body: {"on": true|false}.`, Show: []string{"on"}, Only: true},
	{Method: "POST", Pattern: "/api/vpn/check", Class: canDo, Label: "Check the VPN server answers"},
	{Method: "POST", Pattern: "/api/vpn/test", Class: canDo, Label: "Try each source through the VPN", Help: "Returns what each did. Up to a minute and a half."},
	{Method: "POST", Pattern: "/api/google/sync", Class: canDo, Label: "Bring Google Calendar in step now"},
	{Method: "POST", Pattern: "/api/google/test", Class: canDo, Label: "Test Google Calendar"},
	{Method: "POST", Pattern: "/api/google/signin", Class: canDo, Label: "Open Google's sign-in page", Help: "Opens it in the person's browser; they sign in there themselves."},
	{Method: "POST", Pattern: "/api/google/lookalikes/{key}/link", Class: canDo, Label: "Tie a calendar entry to a role", Help: `{key} is the entry's id from /api/google/lookalikes. Body: {"role_id": the role's number}.`},
	{Method: "POST", Pattern: "/api/google/lookalikes/{key}/dismiss", Class: canDo, Label: "Leave a calendar entry alone"},
	{Method: "POST", Pattern: "/api/otherai/test", Class: canDo, Label: "Test the other AI"},
	{Method: "POST", Pattern: "/api/claude-code/status", Class: canDo, Label: "Check the Claude Code sign-in"},
	{Method: "POST", Pattern: "/api/claude-code/signin", Class: canDo, Label: "Open the Claude sign-in window", Help: "Opens a window on this computer; the person signs in there themselves."},
	{Method: "POST", Pattern: "/api/update/check", Class: canDo, Label: "Look for a newer version"},
	{Method: "PUT", Pattern: "/api/update", Class: canDo, Label: "Update by itself, or not", Help: `Body: {"auto": true|false}.`, Show: []string{"auto"}},
	{Method: "PUT", Pattern: "/api/schedule", Class: canDo, Label: "Change when Job Hunt searches", Help: `Body: any of {"full": [minutes after midnight of each full search], "fast_minutes": minutes between quick checks (0 = off), "from", "to": the hours quick checks run between}. Returns the schedule.`, Show: []string{"fast_minutes", "from", "to"}},
	{Method: "PUT", Pattern: "/api/searchset", Class: canDo, Label: "Change the searching choices", Help: `Body: any of {"ratings_off": bool, "min_rating": 0-5, "clear_days": 0|30|60|90, "budget": bool}; see GET /api/searchset.`, Show: []string{"ratings_off", "min_rating", "clear_days", "budget"}},
	{Method: "PUT", Pattern: "/api/desk", Class: canDo, Label: "Change how Job Hunt behaves on this computer", Help: `Body: any of {"notify": bool, "morning": hour or -1, "awake": "off|working|always", "wake": bool, "clip": bool, "browser": "..."}; see GET /api/desk.`, Show: []string{"notify", "morning", "awake", "wake", "clip"}},
	{Method: "PUT", Pattern: "/api/startup", Class: canDo, Label: "Start with the computer, or not", Help: `Body: {"on": true|false}.`, Show: []string{"on"}},
	{Method: "PUT", Pattern: "/api/theme", Class: canDo, Label: "Change light or dark", Help: `Body: {"theme": "light|dark|system"}.`, Show: []string{"theme"}},
	{Method: "POST", Pattern: "/api/desk/test", Class: canDo, Label: "Show a test notification on this computer"},
	{Method: "POST", Pattern: "/api/desk/allow-wake", Class: canDo, Label: "Let Windows wake the computer for a search"},
	{Method: "POST", Pattern: "/api/debug/note", Class: canDo, Label: "Write a note into the technical log", Help: `Body: {"text": "what the person saw go wrong", "page": "the screen"}.`},

	// ---- only with the person's OK --------------------------------------------
	{Method: "POST", Pattern: "/api/roles/{id}/no", Class: mustAsk, Kind: "role", Label: "Mark not interested", Help: `Body: {"why": "their reason, short"}. The role never comes back.`, Show: []string{"why"}},
	{Method: "POST", Pattern: "/api/roles/{id}/close", Class: mustAsk, Kind: "role", Label: "Close a role", Help: `Body: {"stage": "rejected|withdrawn|expired", "why": "..."}.`, Show: []string{"stage", "why"}},
	{Method: "POST", Pattern: "/api/roles/{id}/reopen", Class: mustAsk, Kind: "role", Label: "Reopen a role", Help: "Only when the person asks for this role by name."},
	{Method: "POST", Pattern: "/api/roles/tidy", Class: mustAsk, Label: "Clear taken-down roles", Help: `Closes (never deletes) every role whose posting was taken down, or that no search has seen for a month, and that the person never prepared or applied to. "counts.taken_down" in GET /api/roles says how many that is.`},
	{Method: "PUT", Pattern: "/api/profile", Class: mustAsk, Label: "Change your profile", Help: `Body: only the fields to change, from GET /api/you: name, headline, summary, years, strengths, rare, home, city, places (other towns that count as the city, besides its own surrounding area listed under "area"), country, arrive_on (YYYY-MM-DD), work_status (citizen|resident|permit|none), start_early, titles {"level": [], "step_up": [], "sideways": []}, domain, avoid, workplaces (remote,hybrid,onsite), pay_floor, pay_unit, letter_style (standard|formal|short|warm: how new letters are written), signature (their own closing under a letter, one line each, "" for the usual), chase_days (days of silence after applying before a follow-up is suggested; 0 = never), weekly_goal (applications a week they aim for; 0 = no goal). A list is replaced whole: send the full new list.`},
	{Method: "PUT", Pattern: "/api/phone", Class: mustAsk, Label: "Change phone notifications", Help: `Body: any of {"on", "min_fit", "quiet_from", "quiet_to"} (hours 0-23). Where notifications are sent is changed by the person under Settings, Connections.`, Show: []string{"on", "min_fit", "quiet_from", "quiet_to"}, Only: true},
	{Method: "POST", Pattern: "/api/places/remove", Class: mustAsk, Label: "Stop watching a job site", Help: `Body: {"id": "..."}. Roles already found there stay.`, Show: []string{"id"}, Only: true},
	{Method: "POST", Pattern: "/api/mail/send", Class: mustAsk, Label: "Send an e-mail", Help: `Body: {"kind": "mail" (an answer to a message) | "chase" (a role's follow-up) | "note" (a note to a person), "id": its number, "to": "the address", "subject": "...", "body": "the whole message"}. Use the written draft's own words and the address the app holds. The person's button is the Send; say it is waiting under your reply.`, Show: []string{"to", "subject"}},
	{Method: "POST", Pattern: "/api/cvs/{id}/file", Class: mustAsk, Kind: "cv", Label: "Put a new file in place of a CV", Help: `Query: name (the file name). Set "file" to the attachment; no body. The CV is read again from it.`, File: true},
	{Method: "PUT", Pattern: "/api/llm", Class: mustAsk, Label: "Change how Claude is used", Help: `Body: any of {"model", "score_model" (reading roles), "write_model" (tailoring and letters), "effort": ""|"low"|"medium"|"high", "grouped": bool, "daily_limit": dollars a day}. The key and the way of signing in are the person's, under Settings, Connections.`, Show: []string{"model", "score_model", "write_model", "effort", "grouped", "daily_limit"}, Only: true},
	{Method: "POST", Pattern: "/api/budget/cancel", Class: mustAsk, Label: "Set tonight's batch aside unread"},
	{Method: "POST", Pattern: "/api/update/install", Class: mustAsk, Label: "Install the newer version", Help: "Job Hunt closes and comes back by itself."},
	{Method: "POST", Pattern: "/api/restart", Class: mustAsk, Label: "Start Job Hunt again"},
	{Method: "POST", Pattern: "/api/backups/restore", Class: mustAsk, Label: "Go back to a saved copy", Help: `Body: {"name": "the copy's name from /api/backups"}. Everything since that copy is replaced by it; Job Hunt starts again.`, Show: []string{"name"}, Only: true},
	{Method: "POST", Pattern: "/api/import/old", Class: mustAsk, Label: "Bring over the old Job Hunt's data", Help: `Body: {} for the old app's own folder, or {"path": "a backup file or folder the person named"}.`, Show: []string{"path"}, Only: true},
	{Method: "POST", Pattern: "/api/claude-code/install", Class: mustAsk, Label: "Install Claude Code on this computer"},
	{Method: "DELETE", Pattern: "/api/sources/{key}", Class: mustAsk, Label: "Forget a job source's key", Help: "{key} is the source's id."},
	{Method: "DELETE", Pattern: "/api/vpn", Class: mustAsk, Label: "Remove the VPN file"},
	{Method: "POST", Pattern: "/api/google/signout", Class: mustAsk, Label: "Sign out of Google Calendar"},
	{Method: "DELETE", Pattern: "/api/google", Class: mustAsk, Label: "Disconnect Google Calendar altogether"},
	{Method: "DELETE", Pattern: "/api/otherai", Class: mustAsk, Label: "Stop using the other AI"},
	{Method: "DELETE", Pattern: "/api/roles/{id}/own/cv", Class: mustAsk, Kind: "role", Label: "Drop your own CV file for a role", Help: "The tailored one is used again."},
	{Method: "DELETE", Pattern: "/api/roles/{id}/own/letter", Class: mustAsk, Kind: "role", Label: "Drop your own letter file for a role"},
	{Method: "PUT", Pattern: "/api/files", Class: mustAsk, Label: "Change where files are kept", Help: `Body: {"off": true|false, "dir": "a whole folder path the person gave; empty for the usual place"}.`, Show: []string{"off", "dir"}, Only: true},
	{Method: "PUT", Pattern: "/api/backups", Class: mustAsk, Label: "Change how saved copies are kept", Help: `Body: any of {"dir": "a whole folder path the person gave", "keep": how many to keep}.`, Show: []string{"dir", "keep"}, Only: true},
	{Method: "POST", Pattern: "/api/rescore", Class: mustAsk, Label: "Score the roles again", Help: `Body: {"all": true} for every open role, {} for those scored before the last profile change. Background.`},
	{Method: "POST", Pattern: "/api/search/force", Class: mustAsk, Label: "Search everything now, rests ignored", Help: "A full search that also asks the sources that are resting. Background."},
	{Method: "DELETE", Pattern: "/api/cvs/{id}", Class: mustAsk, Kind: "cv", Label: "Remove a CV"},
	{Method: "DELETE", Pattern: "/api/people/{id}", Class: mustAsk, Kind: "person", Label: "Remove a person"},
	{Method: "DELETE", Pattern: "/api/notes/{id}", Class: mustAsk, Kind: "note", Label: "Remove a note"},
	{Method: "DELETE", Pattern: "/api/mail/{id}", Class: mustAsk, Kind: "mail", Label: "Remove a reply"},
	{Method: "DELETE", Pattern: "/api/talks/{id}", Class: mustAsk, Kind: "talk", Label: "Remove an interview"},
	{Method: "DELETE", Pattern: "/api/facts/{id}", Class: mustAsk, Kind: "fact", Label: "Forget a fact"},
	{Method: "DELETE", Pattern: "/api/answers/{id}", Class: mustAsk, Kind: "answer", Label: "Forget a saved answer"},
}

// notForAssistant names every call the app answers that the assistant is
// deliberately not given, and why. A new route must go in the table above
// or here; assistant_list_test.go fails until it does.
var notForAssistant = map[string]string{
	// Its own conversation and buttons: it would be pressing its own OK.
	"GET /api/assistant": "its own conversation", "POST /api/assistant": "its own conversation", "DELETE /api/assistant": "its own conversation",
	"POST /api/assistant/confirm": "the person's button", "POST /api/assistant/stop": "the person's button",
	"POST /api/assistant/files": "the person's attachments", "GET /api/assistant/files/{id}": "the person's attachments", "DELETE /api/assistant/files/{id}": "the person's attachments",
	// Secrets are typed by the person on the settings screen, never in a
	// conversation, which is stored and sent to Claude with every message.
	"PUT /api/vpn": "the VPN file holds a private key", "PUT /api/google": "a client secret", "PUT /api/otherai": "a key",
	"PUT /api/mailset": "the inbox password; its switches are PUT /api/mailset/switches",
	"GET /api/owncal":  "the calendar's private address", "PUT /api/owncal": "the calendar's private address", "DELETE /api/owncal": "the calendar's private address",
	"GET /api/calendar.ics": "the calendar as a file",
	// The phone's door and the side panel's are opened by the person.
	"GET /api/phoneaccess": "phone access", "PUT /api/phoneaccess": "phone access", "POST /api/phoneaccess/code": "phone access", "DELETE /api/phoneaccess/devices/{id}": "phone access",
	"GET /api/ext/me": "the side panel's", "GET /api/ext/next": "the side panel's", "GET /api/ext/role": "the side panel's", "GET /api/ext/role/{id}": "the side panel's",
	"GET /api/ext/role/{id}/cv.docx": "the side panel's", "GET /api/ext/role/{id}/cv.pdf": "the side panel's", "GET /api/ext/role/{id}/letter.docx": "the side panel's", "GET /api/ext/role/{id}/letter.pdf": "the side panel's",
	"POST /api/ext/answer": "the side panel's", "POST /api/ext/indeed": "the side panel's", "POST /api/ext/answers": "the side panel's", "POST /api/ext/hello": "the side panel's", "POST /api/ext/leads": "the side panel's",
	"POST /api/ext/note/{id}/sent": "the side panel's", "POST /api/ext/pair": "the side panel's", "POST /api/ext/person": "the side panel's", "POST /api/ext/posting": "the side panel's",
	"POST /api/ext/role/{id}/applicants": "the side panel's", "POST /api/ext/role/{id}/applied": "the side panel's", "POST /api/ext/role/{id}/no": "the side panel's",
	"POST /api/ext/role/{id}/prepare": "the side panel's", "POST /api/ext/role/{id}/team": "the side panel's", "POST /api/ext/unpair": "the side panel's",
	// The program itself.
	"POST /api/quit": "stopping the program", "POST /api/setup/finish": "first-run setup", "POST /api/pick-folder": "a dialog only the person can answer",
	"POST /api/backups/cloud": "moving the data to another folder", "POST /api/backups/handover": "handing the data to another computer",
	"POST /api/backups/continue": "handing the data to another computer", "POST /api/backups/stay": "handing the data to another computer",
	"DELETE /api/backups/restore": "undoing a restore, offered on its own screen",
	// Files and streams: linked for the person instead of read by Claude.
	"GET /api/events": "the pages' live stream", "GET /api/roles.csv": "a file", "GET /api/recruiters.csv": "a file", "GET /api/debug/report": "a file",
	"GET /api/cvs/{id}/file": "a file; linked in replies", "GET /api/roles/{id}/cv.docx": "a file; linked in replies", "GET /api/roles/{id}/cv.pdf": "a file; linked in replies",
	"GET /api/roles/{id}/letter.docx": "a file; linked in replies", "GET /api/roles/{id}/letter.pdf": "a file; linked in replies", "GET /api/roles/{id}/both.pdf": "a file; linked in replies",
	"GET /api/roles/{id}/old-cv": "a file", "GET /api/talks/{id}/invite.ics": "a file", "GET /api/companies/{id}/logo": "a picture",
	"GET /api/profile/signature-picture": "a picture", "POST /api/profile/signature-picture": "a picture the person chooses", "DELETE /api/profile/signature-picture": "a picture the person chooses",
	"POST /api/roles/{id}/own/{kind}": "a file the person chooses on the role's page",
	// The same thing under another name, or of no use in a conversation.
	"GET /api/profile": "in GET /api/you", "GET /api/cvs": "in GET /api/you", "GET /api/copied": "the clipboard", "POST /api/peek": "the clipboard's link",
	"POST /api/update/seen": "the pages' own bookkeeping", "POST /api/leads/1/sent": "a test's spelling",
	"PUT /api/phone/push": "where notifications are sent",
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
	b.WriteString("\n{id} is a number; {key} is a name the app gave you. Times are unix seconds.\n")
	return b.String()
}()

// toolKey is the shape of a name in a path ({key}): a source's id, a
// calendar entry's id.
var toolKey = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,120}$`)

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
			} else if want[j] == "{key}" {
				if !toolKey.MatchString(segs[j]) {
					ok = false
					break
				}
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

// The person's own calendar entries are not Claude's to read either: "clash"
// on an interview is the entry it lands on, from the private address or the
// Google sign-in.
var secretKey = regexp.MustCompile(`(?i)^(pass|password|key|key_hash|token|secret|topic|data|cli|clash)$`)

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
	case "lead":
		if l, err := st.Lead(id); err == nil {
			return clipTo(l.Company, 70)
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
		out = "Bookmark"
		if fields["off"] == true {
			out = "Remove the bookmark"
		}
	case "/api/roles/{id}/later":
		if d, _ := fields["days"].(float64); d == 0 {
			out = "Bring back to Today"
		}
	case "/api/roles/tidy":
		out = fmt.Sprintf("%s (%d)", t.Label, s.E.TakenDown())
	case "/api/handout/save", "/api/handout/mail":
		// Which file, by its name rather than its number.
		n, _ := fields["id"].(float64)
		kind, what := "role", "its CV and letter"
		switch fields["what"] {
		case "cv":
			kind, what = "cv", "your CV"
		case "role_cv":
			what = "the CV"
		case "role_letter":
			what = "the letter"
		}
		name := s.nameOf(kind, int64(n))
		if name == "" {
			name = "(not found)"
		}
		verb := "Put a copy in your folder: "
		if t.Pattern == "/api/handout/mail" {
			verb = "E-mail to yourself: "
		}
		if kind == "cv" {
			return verb + what + " “" + name + "”"
		}
		return verb + what + " for " + name
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
	case "you", "settings":
		if len(parts) > 1 {
			switch parts[1] {
			case "arriving":
				return "/api/arriving"
			case "connections":
				return "/api/connections"
			case "app":
				return "/api/app"
			case "debug":
				return "/api/debug"
			}
		}
		return "/api/you"
	case "leads":
		if id := num(1); id != "" {
			return "/api/leads/" + id
		}
		return "/api/leads" + q
	case "career":
		return "/api/career"
	case "employer", "employers", "companies":
		if id := num(1); id != "" {
			return "/api/companies/" + id
		}
		return "/api/companies" + q
	case "insights":
		return "/api/insights"
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
		note.Result = "Not made: there is no such call. Look at the list again for the one that does this. If it is typing in a key, a password or a file that works as one, open the screen for the person (POST /api/window) and tell them the one thing to do there."
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
		if len(all) > 0 && len(keep) == 0 {
			note.Result = "Not made: this call takes only " + strings.Join(t.Show, ", ") + ". A key, a password or a way of signing in is the person's to enter: open that screen for them (POST /api/window) and say the one thing to do there."
			return note
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
