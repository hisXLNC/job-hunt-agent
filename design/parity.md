# What the old app did that the rewrite still lacks

Kept up to date as gaps are closed: a closed one is marked **DONE** with the release.

GAP AUDIT: old Job Hunt (main, 2.58.1) vs the rewrite (redesign, 26.11.28)

Method: I read the old CHANGELOG top to bottom (all 162 releases), HANDOFF/README/GETTING-STARTED, every route arm in `core/src/api.rs`, the old settings screen's labels and buttons (`static/app-settings.js`) and the Tauri shell (`desktop/src-tauri/src/lib.rs`). Each item was then checked against the new handlers, engine and pages by reading code. Nothing was edited. One correction to the brief: the old core is Rust (`core/src/*.rs`), not Python.

Limits: I did not read the old `fill.js`/`fill.rs`, `sources.rs`, `cv.rs`, `google.rs` or `sync.rs` line by line; for those I relied on the changelog and routes. PRESENT counts per area are approximate. S/M/L are size guesses. Items are ordered by how much a daily user would notice.

---

## A. E-mail and calendar (Google) — about 9 present, 10 gaps

1. **Confirmation e-mail marks a role applied — DONE 26.11.30, was MISSING (M).** Old: a "we received your application" mail marked the job applied, even if not approved, and created a job for applications Job Hunt never found (1.25, 2.10; `core/src/pipeline/mail.rs`). New: `takeMail` in `internal/engine/mail.go` files a `receipt` as done and changes no stage. It also only offers roles already at ready or later as candidates.
2. **Archived mail is not seen — DONE 26.11.30, was PARTIAL (S).** Old read confirmations "archived or not". New `CheckMail` does `EXAMINE INBOX` only.
3. **Reply drafts saved in Gmail, in the thread — MISSING (M).** Old saved replies, follow-ups, thank-yous, rejection replies and recruiter notes as Gmail drafts (`core/src/google.rs`). New is IMAP read-only; drafts leave via Copy or `mailto:` (`web/pages/replies.js`, `role.js`). A draft is not a send, so this is not excluded by the rule.
4. **Gmail labels — MISSING (S).** Old labelled JobHunt/Applied and JobHunt/Recruiters.
5. **Interview request answered with times that suit you — DONE 26.11.32, was PARTIAL (M).** Old drafted the reply with offered slots, driven by settings (interview hours, length, how many times to offer, time zone). New lists free times on the calendar settings card to copy by hand (`FreeTimes` in `internal/engine/owncal.go`); the drafted reply has [brackets] and no slots, and none of those settings exist.
6. **Confirmed interview goes into the calendar by itself — DONE 26.11.32 (onto Interviews; Google Calendar stays one-way), was PARTIAL (M).** Old `book_interview` created the interview, prep block and reminders from the mail. New advances the stage to interview; the person presses "Add the conversation to Interviews" and fills in the time.
7. **Two-way Google Calendar sync — PARTIAL (L).** Old pushed interviews to Google, pulled moves and deletes back with a note on the application, and offered "Link to application" for look-alike events (1.29). New reads a secret iCal address and has a per-interview "Add to Google Calendar" link plus .ics files. No write-back, no move/delete detection, no linking.
8. **Recruiters found from two years of mail — MISSING (M).** Old scanned Gmail, saved each recruiter's e-mail, phone and LinkedIn from the signature, linked them to applications, added their companies' boards, and filtered system senders (1.38, 1.39, 2.34.5). New `matchMail` only recognises people already in People.
9. **Mail-check interval setting — DONE 26.11.30, was MISSING (S).** Old "Check email every (minutes)". New is fixed at 10 minutes in `chores` (`internal/engine/loop.go`).
10. **Inbox "new" count on the nav — not determined** (see the last section).

## B. Notifications and reminders — about 6 present, 8 gaps

New notifies for: a fresh fitting role, "X wrote to you", updated, and problems (`e.Tell`/`e.Push` call sites in `loop.go`, `mail.go`). Missing:

1. **Evening-before interview reminder with prep ready — DONE 26.11.30, was MISSING (S).** (1.30)
2. **Thank-you note about 90 minutes after an interview — DONE 26.11.30, was MISSING (S/M).** New has a `thanks` note only for a person who replied.
3. **"How did it go?" after an interview (Next round / Offer / Rejected) — DONE 26.11.30, was MISSING (S).** New has only the manual stage select.
4. **Morning summary — DONE 26.11.30, was MISSING (S).** (1.25)
5. **Weekly review on Sunday/Monday — DONE 26.11.30, was MISSING (M).** Old e-mailed it to the person and sent a phone summary (1.14, 1.30). The e-mailed part sends mail, so only the in-app/phone summary is a real gap.
6. **Closing-date reminder two days before — DONE 26.11.30, was MISSING (S).** New shows a "Closes" tag and a calendar entry, no notice.
7. **Phone notice coverage and privacy — DONE 26.11.30, was PARTIAL (S/M).** Old: interviews, offers, follow-ups due and applications ready, high priority for interviews/offers, an "only urgent" option, and private by default (kind of notice only, 1.42). New pushes fresh roles and replies only, always with title and employer through ntfy.
8. **Update reminders — PARTIAL (S).** Old repeated a notice daily until installed and checked on window focus. New checks every 30 minutes and shows it in-app; tray has "Check for updates".

## C. The role page — about 14 present, 13 gaps

1. **Attach your own CV or letter for a role — DONE 26.11.39, was MISSING (M).** (1.26, 2.10) `SetOwnFile` in `internal/engine/extras.go`; the downloads and the side panel hand over the own file.
2. **Edit one tailored paragraph yourself — DONE 26.11.31, was PARTIAL (S).** The API takes `after` on `POST /api/roles/{id}/change`; `web/pages/role.js` only has the on/off switch.
3. **Check my CV, ATS check, Ashby notes — DONE 26.11.39 (no Ashby notes), was MISSING (M).** Old read the tailored CV requirement by requirement (Meets / Undecided / Not shown), reworded undecided ones, and checked base and tailored CVs for ATS problems (1.14, 2.53–2.55; `core/src/ats.rs`, `pipeline/checks.rs`). New has the asks-versus-evidence table from the first read only.
4. **Keyword coverage with missing keywords to tick — DONE 26.11.39, was MISSING (S/M).** (2.45) `Reading.Keywords` exists but is not shown or used.
5. **Fit forecast before tailoring — DONE 26.11.39, was MISSING (M).** Old showed "95 → ~97" and "Worth a look tailored" on near misses (1.44). New has the tailored score only after preparing.
6. **Applied here before: stay close to the CV they have — DONE 26.11.39, was MISSING (M).** Old kept tailoring close to the CV already sent, or reused it, with a word-by-word comparison (2.29; `/api/settings/repeat`). New has the "Applied here once" tag and employer history.
7. **Application questions in the app — DONE 26.11.31, was PARTIAL (S).** Old: paste a form's questions, get answers to copy (1.14). New `FormAnswers` is reachable only from the side panel.
8. **Copy-and-paste kit — DONE 26.11.39, was MISSING (M).** (2.36; `/api/jobs/<id>/kit`)
9. **Offer advice — DONE 26.11.39, was MISSING (M).** Paste an offer, get comparison, asks and a counter-offer e-mail (1.14). New has only prep for an "offer call".
10. **Reply to a rejection — DONE 26.11.39, was MISSING (S).** (2.52)
11. **Practise this interview — DONE 26.11.39, was MISSING (S).** (2.51) No button or prompt in new; the assistant could be asked by hand.
12. **Your own notes on a role — DONE 26.11.31, was MISSING (S).** New has notes on employers and on conversations, not on roles.
13. **Not interested: reason, "learn from it", "Never show this company" — DONE 26.11.31, was PARTIAL (S).** New page sends no reason and nothing learns from it; muting an employer is on Radar only.
14. **Find the posting on the company's own site — DONE 26.11.39, was MISSING (M).** (1.43, 2.6, 2.23) New uses `apply_url` only when a source supplies it.
15. **Signature picture — DONE 26.11.39, was PARTIAL (S).** Old placed an image in the letter; new has a text closing.
16. **Cleaning what Job Hunt writes — DONE 26.11.31, was PARTIAL (S).** Old removed em dashes, AI stock words and hidden characters from output (1.20). New only instructs "no buzzwords" in the prompt (`internal/brain/brain.go`); invisible characters are stripped from postings read in, not from writing going out.

## D. Search, sources and scoring — about 25 present, 16 gaps

1. **Pay read from the posting's text — DONE 26.11.31, was MISSING (M).** Old read salaries and hourly rates from the body, looked up pay for postings showing none, and had "Look now" (1.11, 2.24, 2.25, 2.36.8). New takes pay only from the source's salary field; `PayPerYear` parses that field alone, so the pay floor misses most postings.
2. **Scoring and tailoring controls — DONE 26.11.32 (one model, one posting per read stay; see D14), was PARTIAL (M).** Old: fit score needed, Tailor by itself (off / strong fits 85 / all), most tailored per search, most scored per search, "What matters to you". New: fixed `keepFit = 55`, `prepareFit = 70` (`internal/engine/search.go`) and one do/ask switch.
3. **What you want — DONE 26.11.49 (You → What you want; Claude weighs every role by it, deal-breakers and unwanted industries set a role aside with the reason, roles are tagged On path / Off path), was PARTIAL (M).** Old: level, permanent or contract, industries wanted and not, deal-breakers, career path with On/Off-path tags (2.44, 2.56). New has hard limits and three title bands only.
4. **Several cities, each searched — DONE 26.11.49 (they were only accepted; now every title is searched in each, within each source's share of a search), was PARTIAL (M).** Old searched every title in every listed place. New `Profile` has one City plus "nearby places that also count"; whether those are searched or only accepted I did not trace.
5. **Indeed through the Claude connector — MISSING (M).** (1.4) Indeed appears in new only as job-alert mail.
6. **LinkedIn through Apify — MISSING (S).** (1.31)
7. **Search one source and see each posting's outcome — DONE 26.11.49 (the list per source, from what each search decided; no extra search of one source, which would add requests), was PARTIAL (M).** Old gave each source a tab: every posting, its fit, new / already here / skipped and why (2.18, 2.19). New Radar shows counts per source and Test for keyed sources.
8. **Score again / Force search — DONE 26.11.49 (Roles → Set aside; force is on Radar too), was PARTIAL (S).** Old re-checked skipped postings in bulk with a request estimate (1.5, 1.22). New: per-role Bring back and Read it now.
9. **Pause searching for a set time — DONE 26.11.31, was PARTIAL (S).** Old: a day, a few days, two weeks, or off. New: one indefinite toggle.
10. **Employers found by themselves, dead boards removed — PARTIAL (S/M).** Old ran weekly, after profile changes and after thin searches, and removed boards after two failures (1.16). New `SeedEmployers` runs at setup and on "Suggest more"; I found no removal of dead boards.
11. **Company ratings in lists and as a filter — PARTIAL (M).** Old looked ratings up by itself, showed ★ in lists and could skip companies rated below a number (1.45, 2.11). New: "Look it up" on the employer page only.
12. **Old matches cleared by themselves — PARTIAL (S).** Old: unpicked after 60 days set aside; "set aside older than 3 weeks"; remove never-acted-on after 30/60/90 days. New: "Clear taken-down roles" only.
13. **Search times suggested from your own postings' hours — DONE 26.11.49 (You → Connections → When Job Hunt searches), was MISSING (S).** (2.58)
14. **Models per task and grouped scoring — PARTIAL (M).** Old: separate models for scoring, tailoring and the rest, effort level, four postings per scoring request (2.17, 2.34, 2.45). New: one model for everything, one posting per read.
15. **Budget mode — MISSING (S/M).** Old held big batches for the night with Run now / Cancel (1.30). New has a daily dollar cap (API key only) and limit detection.
16. **Another AI — MISSING (M).** OpenAI-style services for searching or everything (2.45).
17. **Pasted key tested before saving — DONE 26.11.49, was PARTIAL (S).** New saves, then offers Test.

## E. Whole features with no counterpart — 0 present, 5 gaps

1. **Leads — MISSING (L).** Hiring posts read by the extension, funding news from a web search, pasted leads, each sized up with who to write to and one follow-up (2.49; `core/src/leads.rs`, `static/app-leads.js`). New People "doors" covers people at watched employers only.
2. **Career paths and Career coach — DONE 26.11.37 (its own page under Progress).** Paths with pay over 3/5/10 years, comparison table, recommended paths, skill gaps with a plan, weekly title ideas (1.30, 1.41, 1.42.2, 2.11, 2.57). New proposes titles once, when a CV is added.
3. **Insights depth — PARTIAL (M).** Old: results by CV, fit score, kind of role and pay band; pay insights; source overlap; 7/30/90-day view; Claude's reading of your results; what your rejections say, fed back into tailoring (1.12, 1.23, 1.30, 2.8, 2.53). New Progress has the funnel, eight weeks, by source, by level, speed, people, and rule-based "lessons".
4. **Job Hunt inside Claude Desktop (MCP) — MISSING (M).** (1.13, 1.14; `core/src/mcp.rs`, `JobHunt.exe --mcp`)
5. **Know when your CV links are opened — MISSING (M).** (2.8; `core/src/links.rs`) It needed a public address, and the server builds are discontinued, so this may be one to drop on purpose.

## F. Browser extension — about 14 present, 8 gaps

1. **Extension updates itself — MISSING (M).** Old reloaded itself from Job Hunt's folder, checked its version before each fill and showed NEW (2.34, 2.35.3, 2.35.11). New tells the person to press Reload after each update (`web/pages/you.js`).
2. **Files attached as PDF — DONE 26.11.31, was PARTIAL (S).** New side panel fetches `.docx` only (`extension/panel.js` line 253; `internal/api/ext.go` has no PDF route).
3. **Fill a job site's profile from the CV — MISSING (M).** (2.48) New "profile" means a LinkedIn person's page.
4. **Hiring team read from a LinkedIn posting — MISSING (S/M).** (2.46) New adds a person only from a LinkedIn profile page.
5. **Fill forms on the phone, share a job from the phone — MISSING (M).** Bookmark filler and "Send to Job Hunt" share shortcut (2.36, 2.36.5). Phone access has no add-a-posting call.
6. **Bookmark button and clipboard pick-up — MISSING (S).** For browsers without the extension (1.13; `clip_watch`).
7. **Choose the browser links open in — MISSING (S).** (2.32)
8. **Workday skills by real clicks — not determined.** Old used `chrome.debugger`; new has no debugger permission and handles skills in `filler.js`. I could not judge equivalence.

## G. Desktop shell — about 8 present, 7 gaps

1. **Start with Windows switch — DONE 26.11.30, was PARTIAL (S).** Old: Settings and tray "Start when I sign in". New: installer tick box only (`installer/jobhunt.nsi`).
2. **Wake the PC for scheduled work — MISSING (M).** Wake timers plus powercfg (1.32, 2.58). New only keeps it awake.
3. **Keep-awake on Modern Standby, and "Windows slept during work" — PARTIAL (S).** Old also used power requests and reported a sleep. New uses `SetThreadExecutionState` only (`cmd/jobhunt/desk_windows.go`).
4. **Tray "Check email now" — DONE 26.11.30, was MISSING (S).**
5. **One-button Claude Code install and sign-in — MISSING (M).** (1.40) New says to install it from claude.com.
6. **Folder picker — PARTIAL (S).** New has a typed path for the copies folder.
7. **Files kept in a folder you choose — PARTIAL (M).** Old wrote every tailored CV and letter to Documents\Job Hunt, with Show files and a Tailored files list. New builds files on download; no folder, no documents list.

## H. Sync, backup and phone — about 7 present, 5 gaps

1. **Continue on another computer — PARTIAL (L).** Old synced to Drive every few minutes, offered "continue where you left off" with sign-ins, and "take over" between two PCs (1.10, 1.12, 1.34, 2.0). New keeps copies in a cloud-drive folder with manual restore, one computer at a time.
2. **Applications spreadsheet kept in Drive — MISSING (S).** New has the CSV download only.
3. **Whole app from the phone — PARTIAL (by the new rule).** Old served the full app behind a password, including settings and installing updates. New `phoneCalls` (`internal/api/reach.go`) allows Today, a role, applied / no / later / prepare, PDFs, replies and interviews. Not possible from the phone: editing the letter, asking for changes, follow-ups, people and notes, adding a role, search now. CLAUDE.md forbids settings and keys; the rest is a choice.
4. **Add to home screen — MISSING (S).** `web/phone/` has no web manifest or touch icon.
5. **Recruiters spreadsheet — MISSING (S).** (`/api/recruiters.csv`)

## I. CVs and settings — about 10 present, 7 gaps

1. **Per-CV controls — PARTIAL (M).** Old: titles and keywords per CV, Find more titles, Replace file, letter style per CV, ATS check, what Claude read from it. New UI has add / download / remove; name and focus are settable only through the API.
2. **A changed CV re-does waiting work — MISSING (M).** Old rescored and re-tailored waiting applications when a CV was replaced or removed, keeping your own edits (2.14, 2.15). New `DeleteCV` just deletes the row.
3. **Time zone and interview settings — DONE 26.11.32 (interview hours, length, how many; the computer's own time zone), was MISSING (S).** See A5.
4. **LinkedIn note length by account — PARTIAL (S).** Old 300 or 200; new fixed 300 (`web/pages/people.js`).
5. **Close as "No response" prompt after four quiet weeks — DONE 26.11.31, was PARTIAL (S).** (1.25)
6. **A role beside the list — MISSING (S/M).** (2.43) Cosmetic.
7. **"Write all" follow-ups in one go — MISSING (S).** (2.38)

## Decisions (25 Nov 2026)

- The person asked for everything here except E4 (Claude Desktop) and E5 (CV links opened).
- Batch 1 (role page) approved as drawn: fit forecast, applied here before, own files, Check my CV, keywords, ATS, kit, offer, rejection reply, practise, own site.
- A7: build two-way Google Calendar with a Google sign-in key the person creates once (they chose it). Last, after the rest.
- H3: the phone gets more of the app, but never settings, keys, connections, saved copies or the assistant (CLAUDE.md).
- A3, A4, A8 write to or read more of the inbox: each is a switch that starts off.
- Nothing new may reopen a "not interested" role or bring back a muted employer; clearing old matches closes, never deletes.
- Budget mode and grouped scoring start off: the person wants to be among the first ten applicants.

## Deliberately excluded (not gaps)

- Submitting simple Greenhouse/Lever/Ashby forms after a countdown (2.23).
- Recruiter e-mail "sent for you" and e-mailed applications sent from Gmail (1.39, 2.29).
- The e-mailed weekly review (it sends mail).
- Publishing to the old update feed.
- The NAS/Oracle server builds were already archived in the old app.

## Could not determine

- Whether new `places` are searched or only accepted (D4). Settled in 26.11.49: they were only accepted; now they are searched.
- Workday skills, Field of Study, month/year dates and "I currently work here" on the real site: new has its own test pages, which I did not run.
- Whether new interview prep includes web research on the company with links (old did, 1.13).
- Whether the new letter keeps the old layout (date, ATTN line, bold Subject with reference number, 1.3).
- Whether new converts PDF or text CVs into an editable Word copy that keeps the look (old 1.1); new tailors from a structured model and writes its own .docx.
- Whether titles a word match misses get a second look by Claude (old 1.6); new uses "words that mark your field".
- Country coverage: metro areas for cities outside Canada, non-CAD and monthly pay (old 1.40).
- Inbox unread badge and its nav count: I did not read `web/app.js` navigation.

## Suggested first picks

The ones a daily user hits soonest: A1 (confirmation mail marks applied), D1 (pay from posting text), C1 and C2 (own file, edit a paragraph), B1–B4 (interview and morning reminders), F1 and F2 (extension self-update, PDF attach), D2 (fit and auto-tailor controls), G1 (start-with-Windows switch).