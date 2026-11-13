# Handoff

Where Job Hunt stands, how to release it, and what's open. Read with `CLAUDE.md` (the release rules)
and `DEVELOPING.md`.

## State

- Latest version: **2.48.0** (below). Before it: **2.47.0**. Before it: **2.46.1**. Before it: **2.46.0**. Before it: **2.45.0**, **2.44.1**, **2.44.0** (getting to the best matches sooner: the apply-now order, best 10, stale
  tidy-up, strong-fit auto-tailoring, What you want). The working branch changes with each session
  (this one: `claude/brave-fermat-ti1omi`); `main` is what's released. Before it: 2.43.0, 2.42.0.
- **2.48.0: profiles, and two pages fewer.** The extension fills a job site's own profile from the
  CV: `fill::PROFILE` stands in for a job (`profile_job`), offered last in the panel's choice and
  picked by itself on pages that read as a profile; `one_entry` spots a form that takes one job or
  school at a time and `answers` fills them in order, one per press (`profile.<kind>:<host>`,
  kept two hours), saying which in `note`. Tested with the real extension on a stand-in page
  (`tools/ext_test/profile.html`, the `profile` variant), **never on Job Bank itself**. The
  separate Apply page (`#apply/<id>`) and Review page (`#review`) are gone: the job's own page has
  the next step, the files (CV & letter) and the copy kit and answers (Questions & contacts), and
  old links go there (`#apply/<id>` to the job on that tab, `#review` to `#overview/approve`). The
  keyword-gap box (`gapsHtml`) moved to the job page's CV & letter tab.
  Also in 2.48.0: a fit score is a ring everywhere (`.score` with `--p`, set by `scoreBadge` and
  `reachTag`); Career is one Me tab with `careerSeg` between `#cvs/career` and `#cvs/coach`; the
  job page's kit and questions are one card; the buttons and API routes for the Job Hunt Apply
  window are gone (`/api/jobs/<id>/fill`, `/api/apply-queue`), but **the window's own code is still
  there, unused**: `Host::fill_application`, `desktop/src-tauri/src/lib.rs` `apply_window`,
  `fill::start_queue`/`queue_next`, and fill.js's TOKEN mode. It can't be run or tested from a
  Linux container, so removing it is for a session on Windows.
  Speed: `showOverview` draws from the overview it has and calls `refreshOverview` behind it
  (redrawing only when `rev` changed); `kept(path)` in `app.js` holds `/api/jobs` and
  `/api/tracker` for 15 seconds, cleared by any change. Logos: `core/src/logos.rs` takes a
  company's icon from its own site (`own_site` of a job's apply link; never a job board or a
  site that hosts many companies), in the background, kept under `logo:<company key>`;
  `/api/logo?c=` serves it or 404, and `avatar()` lays it over the letter. **Never run against a
  real site from here** (no network): tested against a stand-in site. LinkedIn-only companies have
  no logo; the posting's own logo link could be kept when a posting is read, a next step.
- **2.47.0: four places, not five.** Pipeline is gone as a place. `NAV` is Queue, Inbox, Calendar,
  Me. Every job is the Queue's last tab, All jobs (`#applications`, `showPipeline` in
  `app-pipeline.js`, headed by `jobsHead` and the shared `queueTabs`); where a job stands is its
  Stage filter, and `#applications/<applied|new|…>` opens with that stage chosen
  (`APP_TAB_STAGES`). `#applications/<a step>` goes to `#overview/<step>/list` (the Queue on that
  step, as a list whatever the view kept). Tailored files (`#applications/files`) and Insights
  (`#results`) are tabs of Me (`meTabs`). The overview now carries every job waiting (it sent the
  top 8 to approve and 30 to pick, so counts and the apply-now order fell short), and `/api/jobs`
  adds every job you acted on to the newest 2,000 found. The top bar uses the page's width and
  side padding, and inside a group's card the heading, Select all, Sort and filter and the tick
  boxes share one left edge.
- **2.46.1: the two big files in parts, nothing else.** `core/src/pipeline.rs` keeps the Agent,
  settings, scheduling and the smaller sections; its largest sections are `impl Agent` blocks in
  `core/src/pipeline/` (`search.rs`, `checks.rs`, `people.rs`, `reports.rs`, `tailoring.rs`,
  `mail.rs`) and its tests are `pipeline/tests.rs`. A method those files share is `pub(super)`.
  `static/app.js` is the helpers and the shell; the rest loads after it, in this order, from
  `index.html`: `app-queue.js`, `app-pipeline.js`, `app-job.js`, `app-steps.js`, `app-flow.js`,
  `app-calendar.js`, `app-settings.js`, `app-actions.js`. They are plain scripts sharing one
  scope, so the order matters only for code that runs as a file loads. Where these notes say
  `app.js` or `pipeline.rs` for something, look in the parts too. The Rust linter's safe fixes
  were applied (`cargo clippy --fix`). Not done, as not worth their risk: the 157-branch action
  chain in `app-actions.js` as a table, and the usage meter's forwarding methods as a macro.
- **2.52.1: the phone's top bar holds everything.** No menu, no status card: `phoneTop()` in `app.js`
- **2.62.1.** CV update: `stop_cv_update(forget)` + `POST /api/cv-update` (`cv.stop` flag, read by `cv_update_stopped()`
  in `rescore_through`, `rescore_jobs` and between the steps; only counts while `cv-update` is running); the card has
  Stop / close (`cvUpdateStop`, `cvUpdateClose`); a second update waits for the first to stop; `cv_update()` is None
  when its CV is gone. Top bar: the bar is capped at the page's width whatever the window, so `.dstats` is `flex: none`
  and the find box and `#dRun` give way (`:has()` rules when an amber chip shows); checked at 780 to 1920 px with every
  chip showing. (This closes the old "chips overlap at about 1000px" item.)
- **2.62.0.** CV update: `cv_changed` unscores only queued and saved-above-the-bar on a replace (all four statuses
  only when the CV is removed); `restore_cleared_fits_once` gives set-aside roles back the fit 2.60/2.61 cleared (from
  the `unscored` history line); `cv_update()` adds live `tailored` / `tailoring` from the `retailor` ids; the card's
  steps have bars (`cvUpdateHtml`, `.step-bar`). **The checks are faster, none left out** (the user said: functionality
  first, don't skip): `verify` runs three lines side by side (core tests, server, screens | the extension | the Windows
  app) and prints each step's seconds; `ext_test.js` runs each variant in its own browser, three at a time (`JOBS=1`
  for one after another), state per variant by `v=` in the page's address. About 11 min of extension tests became 4.
- **2.61.2, from the user's real Copy details (OSC, 15 minutes for one form):** (1) the tab was hidden, so timers were
  throttled: `wait()` asks the background to keep time (`sleep` message) when `document.hidden`. (2) Workday's Enter
  takes a single match and closes the list: `tookItself(had)` sees the new pill (accepted if it fits, or as Other /
  Not Applicable). (3) "No Items." is a `promptOption`: left out of `options()`, seen by `nothing()`. (4) The debugger
  attaching closed the open list (Field of Study and the first skill "not taken"): `debugReady()` before each search.
  (5) Each search in `diag.skills` has `top` (the labels shown). STILL UNKNOWN: what OSC's list calls PMP; the search
  "Project Management Professional (PMP)" found 4 rows and none was chosen. Ask for Copy details again and read `top`.
  Education From and GPA are not on the user's CV: they go in About me facts. The mock's `issuer` variant has (2), (3).
- **2.61.2: certificates by full name.** The user's OSC form sat on "Filling in the form…" with Certification set to
  "Not Applicable - Not Applicable": the list names certificates "Issuer - Name", so "PMP" found nothing. `fillSkills`
  now has `FULL` (short form -> full name, also searched), `tail()` (the name after " - "), every bracketed short form,
  and a status line per search; `silent` shortens waits on a list that never says "No items". Mock variant `issuer`
  (`?certs=issuer`). Not seen on the real form: what OSC's list calls PMP is a guess. If it still misses, ask for Copy
  details (its `skills` list has every search and what came back). Also 2.61.1/2: row buttons one size, stage tags one line.
- **2.61.0: one employer, several names.** `db::SAME_COMPANY` + `same_company()` inside `dupe_key` (so `company_key`,
  logos, "Applied here before", dedupe all follow); add a row when the user reports two spellings. Existing jobs are
  rekeyed once (`Db::rekey_jobs`, flag `companies.rekeyed`, in `logos::name_hosts_once`), where `CODE_NAMES` also renames
  "mufgub" to MUFG. Logos: `fetch_listed` (Google's favicon index) after DuckDuckGo's; misses are now `none4`, and
  `none3` is looked up again. No network to real sites from the build machine: none of the fetching is verified live.
  All jobs table: the last block of `app.css` makes `#t-all` `table-layout: fixed` with a px width per column (Role
  takes the rest) inside a container (`alljobs`); `@container` rules drop columns as the card narrows. A new column
  needs a width there. Checked with worst-case rows injected in the preview at 800 to 1920 px (card never scrolls).
- **2.60.0: a new file for a CV updates everything.** `Agent::refresh_after_cv(id, change)` (tailoring.rs) runs after
  `replace_cv` in the background under the claim `cv-update`: `suggest_for_cv` (titles/keywords added), `rescore_through`
  (rounds of `rescore_jobs` past the cap while the next unscored job is queued or saved; `cv_changed` now lists queued,
  saved, skipped, dismissed in that order), `tailor_picked`, `write_career_paths`, `write_coach` if there is one. Progress
  is the JSON under `cv.update` (`Agent::cv_update`, `cv_update` in `/api/settings`), drawn by `cvUpdateHtml` and kept
  current by `watchCvUpdate` (app-actions.js). A usage limit part-way defers `{kind: "cv", ids}` (`run_deferred`).
  Removing a CV still goes through `apply_cv_change`. Seen in the preview with the demo Claude only.
  Also: approved-not-sent applications on that CV are tailored again one by one inside the update and set back to
  `approved` (`CvChange.approved`; the user asked: never submit a stale CV); with several CVs, queued/saved jobs on the
  other tracks are unscored and scored again; `answers:<job>` is dropped for what's re-tailored; `leads::read_again`.
- **2.59.0: the extension's line to Job Hunt, rebuilt** (carries 2.58.2, never published: All jobs table, logos in it).
  The user's panel sat on "Reading 14 questions… 106s". Not reproduced here (Playwright keeps the service worker
  awake), but an MV3 worker is stopped when idle and its fetch dropped after ~30 s, and Claude often takes longer.
  Now: `/ext/fill/start` gives a ticket at once (`bridge.rs` `fills()`, the answers written on a thread),
  `/ext/fill/poll` is asked every 1.2 s **by the page** (`getAnswers` in `fill.js`, through `rpc`: the extension's
  `ask` message, or fetch on the phone). `/ext/fill` stays for old copies. background.js was rewritten: every request
  has a time limit, a log (`log()`, kept in `chrome.storage.session`, 400 events, no answers), `startFill(tabId)`
  (re-injects a copy from before an update), `command()` (re-attaches the debugger once), `health()`, `report()`
  (also posted to `/ext/log` -> `extension-log.json` in the data folder). Page: `trace()`/`trail`, `guarded()` per box,
  `fill` retries `fillNow` once. Messages now answer `{ok, v}`. Test variant `heal` (forgets the ticket once, drops
  three polls); `ANSWER_DELAY=45000` delays the mock's answers. The form-reading and filling routines were kept.
  If it hangs again: ask for Copy details (it now has `trail` and the extension's log).
- **2.58.1: logos for Workday-only companies.** `logos::sites_for` now also tries `KNOWN_SITES`, the `tenant()` code of a
  hosting-site link and the name's initials; "none2" (looked, none) is looked up again, new misses are "none3".
  Not checked against the live sites (no network to them from the build machine).
- **2.58.0: searches only in their scheduled hour.** `Profile::search_due` is true only while the clock is in a
  scheduled hour (no catch-up after a late start or an update; tests changed on purpose). `run_due`'s "discover" no
  longer searches. Defaults are noon and 5 PM (`search_hours_once` moves installs still on 7/16, once).
  `Agent::posting_hours` + `Profile::hours_after_peaks` feed `postingHoursHtml` in Settings (needs 40 timed postings).
  Call `posting_hours()` before taking the `db()` guard in `/api/settings`: inside it, it deadlocks.
  Also 2.58.0: waking the PC (`app.wake`) is on unless set to "0"; `wake_timer` runs `powercfg` once per start to allow
  wake timers on AC (result in `wake.allowed`). Untested on a real Windows PC.
- **2.57.0: recommended career paths.** `CareerPath.recommended` / `recommended_why` (prompt in `career_system()`,
  kept to at most three and never all by `claude::tidy_recommended`). `careerHtml` shows them in `#careerRecs`, the
  table (`tr.rec`) and the cards (`.path.rec`). Careers stored before this have none: a hint says to press Think again.
  2.56.1 was never published (verify failed on the `typing` and `keys` form variants); its fixes ship here with two more:
  `staleOptions` (options of a list that wouldn't close aren't the next dropdown's) and `byKeys(name, nudge)`.
- **2.56.1: the OSC Workday form (osc.wd3, "My Experience").** From the user's trace and Copy details; each case is now in
  `tools/ext_test/workday.html` and judged in `ext_test.js` (the old fill.js fails there the same way: no clicks in the
  skill list, one skill reported). What was wrong: (1) Workday marks the row the keyboard is on `aria-selected=true`
  (the first after every search); read as "chosen", every skill was `how: already` and never clicked. `lit()` rows
  ignore it; chosen is the tick box, aria-checked, or the pills. After the skills, what the site shows is read again
  and anything not there is reported (`diag.skillsLost`). (2) School or University and Certification are multiselect
  prompts: told by structure (`builtAsPrompt`), filled like Field of Study; a school matches exactly or not at all
  (`strict`), and when the list has no match "Other" / "Not Applicable" is chosen and said in the panel (`otherChosen`).
  "PMP" matches "Project Management Professional (PMP)". (3) `HISTORY` has certif/licence, so the Certifications Add
  Another is pressed; `cv_listed(cv, "cert"|"edu")` gives certifications and education a floor in `tidy_answers`.
  (4) A legend over only a date's boxes ("From", "Expiration Date") is the date's label (`dateHeads`), not a section:
  Education's From was unanswered and Role Description sat in section "To". (5) `openOptions()` counted chosen pills
  as the open dropdown's options, so a long list was never scrolled; `moreOptions` collects option text while
  scrolling (virtualized lists drop rows) and starts from the top. (6) The CV goes to an upload box by its section too
  ("Select files" under Resume/CV); `attachSure` checks the file shows and drops it on the drop zone if not.
  (7) `_roles` no longer counts a career break or transition (an entry with no company). (8) "I am fluent" follows
  the entry's own language (`language_fluent`). (9) `undebug`: the debugger is let go when the fill ends.
  NOT verified on the real site: whether Workday takes the synthetic drop, and whether its skill rows have tick boxes
  (if a click isn't seen to take, the keyboard path runs, then it's reported). Ask for Copy details again (it now has
  `want`/`now` per box, `drops`, `uploads`, `skillsLost`). Job Bank's profile form is still open.
- **2.56.0: rejections you can see, Inbox count and actions, a career path, tested keys.** (Carries 2.55.0, never published.)
  Rejections: `link_rejections()` matches a "no" that named no application to the job (company in the email, unique or best
  title match), marks it rejected and notifies; `turned_down()` / `drafts_waiting()` put "Turned down" and "Draft to send"
  in the Queue's Waiting step; a follow-up is never drafted for a company that said no. The reply draft takes a
  "change this" note (`decline` with `change`). Inbox: `inbox_new()` badge, "What you can do" column, `POST /api/emails/<id>/reply`.
  Updates: `quiet_for_update` waits for everything running and 10 quiet minutes (`api::idle_secs`), and notifies a minute before.
  Top bar (desktop): `deskTop()` in app.js draws the status chips (`#dRun #dGoogle #dSync #dWarn #dUp`) and `#dTheme`; the old
  `#statusPop` stays in the page hidden, as where the words are worked out. Insights is its own place (NAV has six).
  Career path: `Wants.path`; the scorer adds one red flag "Career path: toward|away. why" (`profile::PATH_FLAG`), which
  `Job::from_row` moves out of `red_flags` into `job.career {toward, why}` (`flags_to_store` puts it back when flags are
  rewritten). Shown by `pathTag` (lists), the why-box (job page) and told to `offer_advice`. Chosen in Me, Career
  (`#pathCard`, `savePath`), Looking for, and the welcome steps. Matches found earlier need "Read my waiting matches against it" (rescore, group waiting).
  Keys: `sources::check_key` tries a pasted Adzuna / Google for Jobs / Jooble / Apify key before `/api/settings/keys` saves it
  (in tests: a key starting "bad" is refused); another AI's key is tried with `other_models` even when it's used for nothing yet.
  Form filler: every box in a numbered entry ("Languages 2") is never answered from saved answers (`personal_in`): that put
  French in all three language entries on a Workday form. "Copy details" now lists for each box what was meant (`want`),
  what it holds after (`now`), its options and HTML when it failed, plus the page's upload areas. STILL OPEN from the same
  report (OSC Workday): education From date and university not filled, tailored CV not attached to the Attachments drop
  zone, 0 skills added; and Job Bank's profile "Add a work experience" form got nothing. Ask for Copy details from each.
  Icons: see logos.rs (`none2|`, www. retry, DuckDuckGo index fallback); unverified against the real sites from here.
- **2.55.0: every employer is assumed to read a CV requirement by requirement.** `ats::general_tailoring()` is
  handed to tailoring when the system isn't known (the Ashby text when it is). The check of the CV
  (`.ats-review`, built once as `reviewBox` in `app-job.js`) is on every tailored job, on request; it still
  runs by itself only for Ashby, because it costs up to three more requests. Ashby's own warnings stay on
  Ashby jobs only.
- **2.54.0: a CV for an Ashby employer is checked the way Ashby's AI checks it.** `Llm::criteria_review` writes
  the 5 to 8 criteria a recruiter would set from the posting and reads the tailored CV against each, strictly:
  meets / not / undecided, with the CV line as evidence and, for an undecided one the CV supports, a `fix`.
  `write_criteria_review` keeps it under `review:<job>`; `sharpen_for_review` turns the fixes into one `revise`
  of the CV (so the honesty checks and Undo apply) and checks again; `review_after_tailoring` does both after
  `tailor()` for Ashby jobs only (up to three more requests), skipping the rewording when the CV is being kept
  close to one already sent to that company. `POST /api/jobs/<id>/review` (`fix: true` to reword first). The
  job JSON has `review` / `reviewing`; the card is in `app-job.js` (`.ats-review`). `ats::tailoring` now also
  says: evidence in the experience, not only a skills list; total years in the summary when the dates add up;
  the top requirements in the summary; nothing evidenced only in the cover letter. `ats::answers` tells the
  form answers (questions and the extension's fill) to agree with the CV. The employer's real criteria can't
  be seen: the page says so. Not tested: a real Claude review, and whether it predicts real criteria well.
- **2.53.0: learning from rejections, and Ashby** (carries 2.52.0 and 2.52.1, which were never published alone).
  `study_rejections()` in `pipeline.rs` gives Claude each rejection email matched to a job (fit, days from applying,
  interviewed or not, the email's words via Gmail) through `Llm::rejection_lessons`; the result is kept under `lessons`
  and shown on Insights. `tailoring_guidance(job)` hands the lessons, plus `ats::tailoring` for the employer's system,
  to `Llm::tailor` as its new last argument `guidance`. It is re-run from the periodic check when more rejections are
  matched than at the last study (three or more). `core/src/ats.rs` holds what is known about an application system
  (only Ashby: told from `source == "ashby"` or `ashbyhq.com` in the job's links), the job JSON carries it as `system`
  (`ats` was already the CV check), and the job page shows it as a card. The Ashby facts come from Ashby's published
  help pages found by search (AI-assisted review marks each criterion met / not met / undecided with CV citations;
  auto-reject rules on form answers at submission with a delayed email; application limits; request links skip both;
  fraud signals). Those pages could not be opened from the build session, so re-read them before adding detail.
  Not tested: a real Claude study, and real Gmail bodies.
  draws the bar right of the name (search status linking to `#search`, email and sync chips, an amber
  chip for a Claude limit or a connection problem, find, and `#mTheme`, one button that steps Auto,
  Light, Dark via `setTheme`). It is drawn by script on purpose: a phone showed 2.51.1 with the old
  page still in place, so `phoneTop` also strips an older page's `#mMenu` and gear, and `index.html`
  is now served `no-store`. Under 640px the chips are icon and dot, and the search status is just
  the time. 2.52.0 was never published; this release carries it.
- **2.52.0: a reply to a rejection.** `Agent::write_rejection_reply` (kept under `decline:<job>`,
  `POST /api/jobs/<id>/decline`, the card above a rejected job's tabs). `Llm::rejection_reply` gets
  the summary of their rejection email and whether an interview was on the calendar (feedback is only
  asked for then). A person's email gets `draft_reply` in its thread; a no-reply sender gets a new
  draft to `follow_up_to` and the `robot` flag, which the card warns about. Written on request only.
- **2.51.1: Settings is a place.** The fifth entry of `NAV` (top bar and the phone's tabs); the gear
  (`#settingsLink`) and the phone's menu button (`#mMenu`) are gone. On a phone the status in the top
  bar (`#mStatus`, `data-act="moreMenu"`) opens `.side` as a small card with the status lines and the
  theme (`body.more-open`, last block of `app.css`); a tap elsewhere closes it. 2.51.0 was never
  published; this release carries it.
- **2.51.0.** Not interested has a fourth answer, Never show <company> (`block: true` on
  `/api/jobs/<id>/status` -> `Agent::block_company`: adds to `exclude_companies`, dismisses its other
  queued postings). The nav badge leaves out the `pick` step (`renderNav`); the page's headline still
  counts everything. Interview tab: Practise this interview sends a fixed opening message to the job's
  chat (the preview's DemoLlm has no `chat`, so it can't be seen answering there). Rows of one company
  in a list get an "n roles here" tag (`listHeads`). The phone's menu sheet starts below the top bar
  whatever its height (`--mtop-h`, set when it opens).
- **2.50.0: logos by site, and everything sorts.** `logos.rs` keeps a logo per site
  (`logo2:site:<domain>`) and a pointer per company (`logo2:co:<key>`), so two spellings of one
  company share one image; the old `logo:` keys are simply left behind. A site is only used when its
  address is named for the company (`site_is_named_for`) or its home page names it (`page_names`);
  with no known site, `<name>.com` and `.ca` are tried under the same check. **Not seen against real
  sites** (the sandbox can't reach them). A job whose company came out as a host
  (`jobs.scotiabank.com`) is named from it (`name_from_site`; existing ones once, `companies.named`).
  Every `<table>` with a `<thead>` is made sortable by `sortableTables` in `app-pipeline.js` (a
  MutationObserver; opt out with `.no-sort`), so a new table needs only a header row. The Queue's card
  lists get a strip of sort buttons (`listHeads` / `applyListSort` in `app-steps.js`, kept in
  `jh.listSort`); choosing from the Sort by menu lets go of it.
- **2.49.0: Leads.** `core/src/leads.rs` (kept as one JSON list under the key `leads`, not as jobs):
  hiring posts the extension reads (`clip.js` `clipPosts`, sent by `background.js` `sendPosts` to
  `/ext/leads`), funding news and posts from one web search (`Llm::find_leads`, Claude Code only, run
  on request or once a day when `leads.daily` is `1`), and ones pasted in. `looks_like_hiring` is a
  free sieve; `Llm::size_up_leads` then reads up to eight at a time against the CV (fit, where you'd
  help, points worth saying) and drops what isn't hiring. People get a likely address (first name at
  the site, flagged `guess`) and any the site publishes (`published_emails`). The user writes the
  message; Rough draft reuses `outreach` with a brief that says there is no posting. One follow-up
  after a week, as for recruiters. The screen is `static/app-leads.js` (`#leads`, a tab of the Queue).
  **Not seen against the real LinkedIn**: the post selectors and the search link's parameters were
  written from memory and tested on `tools/ext_test/posts.html`. A new `Llm` method must also be
  forwarded in `usage.rs` (`Metered`), or it answers "isn't available" in the app though tests pass.
- **2.46.0, and why.** The Queue lost its side column (search menu on the Search button, email
  button, `week-line` under the heading; `deck.solo`), the Queue's filters move beside Select all
  after render (`applyQueueView`), and the guided setup (`showWelcome`) is a list of steps with one
  open, for friends new to it. LinkedIn's hiring team: `clip.js` reads the people under "Meet the
  hiring team" into `people`; `add_clip` keeps them (`add_hiring_team`), also for a job already
  here (`job_for_clip`). **Its selectors were written without seeing LinkedIn signed in** (tested on
  a stand-in page in `screen_test.js`): the first report of it finding nobody means checking the
  real page's markup. Contacts gained `replied_at` (`contact_replied`) and keep `message_kind`
  (it was being dropped on save, which hid the follow-up's I sent it button). `/api/overview`
  carries `rev`, and answers `{same: true}` to `?have=<rev>`. The stylesheet was tidied by a script
  (rules for unused names, declarations a later same-selector rule overrides) and every screen
  compared before and after; the script isn't in the repo. Left alone on purpose: the old
  apply-in-a-Job-Hunt-window queue (`fill::start_queue`, used by the Windows Apply window), and
  caching the profile (reading it takes a few milliseconds).
- A group on a Pipeline step is found by the start of its heading (`has('Message the recruiter')` in
  `stepHtml`): rename a heading and its lookup together.
- **2.45.0, and why.** Less of the Claude plan per search, and not only Claude. (1) Scoring is
  grouped: `Llm::score_batch`/`score_many` (claude.rs) put four postings in one request, so the CVs
  and instructions go once; `score_these` (pipeline.rs) falls back to one at a time for any the
  answer leaves out. Setting `claude.score_batch` (1 turns it off). **Not run against real Claude
  from this container**: watch the first searches' scores. (2) `OtherAi` (claude.rs): any
  OpenAI-style API (Grok, OpenAI, Gemini, OpenRouter, Ollama) for searching (`search_call`) or for
  everything; settings `other.for|url|key|model`, endpoints `/api/settings/other` and `/models`.
  Web lookups (Indeed, ratings, company pages, recruiters) stay with Claude Code. Tested against a
  stand-in server in `another_ai_scores_postings`, never against a real service. (3) With more than
  40 waiting to be picked (`BACKLOG`), a scheduled search scores half its cap. (4)
  `Profile.searches_per_day`/`search_hour_2`, with `search_due`/`next_search` (profile.rs). (5) The
  fit after tailoring is scored with the fit before as an anchor, and up to 5 lower counts as the
  same (`RESCORE_NOISE`): two scorings differ by chance. (6) Screens: thin keyword cover (under 60%)
  is flagged with the missing keywords to tick (`gapsHtml`, sent as a revise note; never added
  unless the user says they have them), Approve and Review are in `applyRank` order, and "Apply to
  all" / "the quick ones" run in the user's browser one after another (`applyRun`, `runBar`).
  Follow-ups, recruiter contacts and one-by-one review already existed; they were not rebuilt.
- **2.44.0, and why.** The user had 152 to pick, 21 to approve, 7 sent, no interviews: the search finds
  more than gets applied to, so the work went into throughput, not finding more. `applyRank(j)`
  (app.js) orders Pick and the one-by-one Queue: fit, less 1.5 a day after the first two, less for red
  flags. "Best 10 only" (on by itself above 15) and "Set aside N older than 3 weeks" (`pickStale`,
  `learn: false`) shorten the list. `Profile.auto_tailor_min` (85 from the UI's "Only strong fits")
  tailors the best recent matches by itself (`to_tailor_by_itself`); it is **off unless the user turns
  it on** (Me, Looking for, Tailor by itself). `Profile.wants` (level, permanent or contract,
  industries, deal-breakers) goes to the scorer through `Wants::for_scoring` in `scoring_guidance`.
- Sources, as reviewed for 2.44.0: sound. LinkedIn's signed-out search is the newest 100 a title and
  place (a shorter time window wouldn't find more); Indeed through Claude now prefers the newest. Not
  done, worth asking the user about: a second search a day, since early applications are read most.
- **2.43.0.** `openPanel(id)` draws a job in `#jobPanel` beside the list on a wide window
  (`panelFits`); rows and titles in Pipeline open it, `syncPanel` keeps it across redraws, Esc closes
  it. `chipify` turns `textarea[data-chips]` into chips (the textarea stays the value). The extension's
  popup lists approved jobs to open (`/ext/jobs` now carries each one's `url`; Open calls `/ext/pick`
  first) and shows whether it's connected; the panel on forms (`panel()` in `fill.js`) is restyled,
  its seldom-used buttons as links at the foot. Its buttons and `.s` status text are unchanged, which
  `tools/ext_test` relies on.
- **Where things are (2.42.0).** The shell is a top bar (`.side` in `index.html`: brand, `#nav`, find,
  the status pill `#statusPop` with the status lines and the theme, the gear `#settingsLink`); on a
  phone it's the sheet behind `#mMenu`, and `#tabbar` has the five places. `NAV`: **Queue**
  (`#overview[/step]`: `showOverview`, `queueItems` builds the decisions, `decisionHtml` draws one;
  Skip and Up next only change `queueAt` / `queueSkipped`), **Pipeline** (`#applications`: All jobs,
  the steps as lists, Tailored files = `#applications/files`, Insights = `#results`), **Inbox**
  (Email, Recruiters), **Calendar** (its own place: the user asked for it apart from Inbox), **Me**
  (`#search/what` Looking for, `#cvs` CVs, About me, Career paths, Coach). **Settings** (the gear):
  `SETTINGS_TABS`, where Job sources is `#search` (where it looks, each source's results, set up).
  `placeOf()` says which place a route belongs to.
- From the approved mockups, still not built: a single Timeline (dropped: the user wanted Inbox and
  Calendar apart).
- **The look** is the last big block of `static/app.css` ("The look, reimagined"): tokens, light menu,
  hairline cards, pill tabs. Today's first item is `todayHero`, the rest `todayRow`; `avatar` is the
  company tile on a job row.
- The user asked for screenshots before a redesign is built: show real screens from the preview
  (`scratchpad` Playwright shots at 1440×900, 390×844 and 915×500) and wait for a yes.
- The user reads Job Hunt on a wide folding phone in landscape (about 915×500 CSS px, touch): check
  that shape as well as a narrow phone (`tools/screen_test.js` does).
- The user's defaults (asked for, keep them): forms open in **their own browser** (`applyNow`, the Apply
  page's main button, the job page's next step: `fillBrowser`), and **Not interested doesn't learn**
  (the dialog's main button and the bulk action send `learn: false`; "and learn from it" is the other button).
- The screens' layout (`static/app.js`): `#overview` is **Today** (`showOverview`, `todayList`: what
  needs you, one line each); `#applications` is **Jobs** (`showPipeline`): `#applications/<step>` is a
  step (`showStep` → `stepHtml`; steps are `FLOW`), `#applications/all|new|active|applied` the list.
  `#overview/<step>` and `#pipeline` redirect there. `#inbox/settings` and `#calendar/settings`
  redirect to `#settings/inbox` and `#settings/calendar`; `#settings/search` goes to `#search/what`.
- The user installs the Windows app from `hisXLNC/job-hunt-releases` and uses the Edge extension
  ("Send to Job Hunt") on Workday and other application forms, and Tailscale for the phone.

## Releasing (every change the user reports is fixed and released without asking)

1. `python tools/release_ci.py bump patch "Title" "Change." …` (minor for a new feature). To add to a
   version not yet on `main`, edit its entry in `static/changelog.json`, then `python tools/release_ci.py sync`.
   Changelog text goes through the shell: write `$` amounts in single quotes or escape them
   (2.36.8's notes lost "$95" to `$9` expansion).
2. Verify, in the background (it takes ~20 min; 40 after a `cargo clean`):
   `PATH=$(echo "$PATH" | tr ':' '\n' | grep -v node22 | paste -sd:) timeout 2400 python tools/release_ci.py verify`
   It must end "Ready to release X".
3. Commit (with the session's attribution trailers),
   push the branch, then `git push origin HEAD:main --no-verify`.
4. A newer push to `main` cancels a build still running (fine when the new version includes it).
   GitHub minutes are limited (Windows counts double): batch changes.
5. ~12 minutes later check `get_release_by_tag hisXLNC/job-hunt-releases vX`; rerun failed jobs if the
   publish step 502s or hangs. Then send the user the release link and what to do (reload form pages,
   click the extension's button once).

Gotchas: never call `self.db()` while a db guard is alive (deadlock; `settings()` and `overview_with`
take the database: read secrets before them). If the disk fills, `cargo clean` in `core` and
`desktop/src-tauri`.

## Where things are

- `core/src/fill.js`: the form filler (Apply window, the extension, and the phone bookmark). Modes:
  `TOKEN` (app window), `EXT` (extension: `chrome.runtime`), `PHONE` (`window.__jobhuntRemote`).
  Workday handling: dropdowns (`readDrops`/`fillDrop`/`closeLists`), month/year date boxes
  (`datePart`/`fillDate`), skills and Field of Study (`fillSkills`, real clicks through the extension's
  debugger: `realClick`), Add buttons (`collectAdders`), Copy details (`diag`).
- `core/src/fill.rs`: answers for a form (`answers`, `tidy_answers`, the answer bank `learn`/`from_bank`,
  `cv_roles`, `cv_languages`, `kit` for the copy-and-paste kit).
- `core/src/claude.rs`: prompts (`fill_system`, `cv_profile_system`…).
- `core/src/bridge.rs`: the local server on 127.0.0.1:47613 for the extension and the phone
  (`/ext/*`, `/m/fill.js`, `/m/add`, `tailscale_serve`, CORS).
- `static/extension/`: the extension (MV3; `background.js` does version checks, real clicks via
  `chrome.debugger`, and talks to the bridge). It reloads itself from Job Hunt's folder when Job Hunt
  updates.
- `core/src/sources.rs`: job sources (LinkedIn signed-out search: 4 pages per search, 16 searches a
  run; `pay_max_in` reads pay from posting text). `core/src/filters.rs`: the pre-scoring filters
  (title, location, salary, age cutoff).
- `core/src/pipeline.rs`: search, scoring (newest first), held postings (`score_held`,
  `score_all_held`), progress (`progress()`, `scoring_all`).

## Looking at the screens

`python tools/screen_test.py` clicks through the whole flow in a real browser against the preview
(pick by keyboard, tailor, approve, submit, waiting, every menu page, phone width). `verify` runs it
where Playwright is installed and skips it elsewhere (GitHub's build). Add a check there when a
screen changes. A fresh container needs the window libraries for the last verify step:
`apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`.

`cd core && cargo run --example dev_server -- <empty folder> <a .docx CV>` serves the screens with
sample jobs at http://127.0.0.1:8790 (static files are read live). With a CV given it seeds 7
postings, 3 to pick; ticking and Tailor selected walks them through approve, submit and waiting.
Playwright screenshots of it are how the 2.37.0 layout was checked (desktop and phone sizes).

## Testing the form filler

`node tools/ext_test/ext_test.js` loads the real extension into Chromium and fills a stand-in Workday
page (`tools/ext_test/workday.html`) with answers from a stand-in for Job Hunt on 127.0.0.1:47613.
Variants (name them to run a few; `TRACE=1` prints each skill's searches): `std`, `odd` (chosen items
drawn with unknown markup, no aria-selected), `typing` (only real typing searches), `keys` (the mouse
does nothing in the list), `slow` (4 s searches), `zoom` (80%), and `app` (Job Hunt's own window: the
same script with a token, no extension). `verify` runs five of them where Playwright is installed.
When the user reports something on a real site, make the mock behave that way first, see it fail,
then fix it. What the mock taught (2.39.0): Workday draws chosen items with the same
`promptOption` markup as search results (they were read as results); a second click on an option the
filler couldn't see as chosen unticked it; the debugger going off after 45 s and on again moved the
page under the next click. `window.__jobhunt.details()` returns what Copy details copies, including
`skills`: each skill's searches, what was chosen and how (`click`, `box`, `keys`, `mouse`, `unseen`).

## Open / to watch

- Workday skills and Field of Study: rewritten in 2.39.0 against the mock (see Testing). The mock is my
  best picture of Workday, not the real site: if the user says it still misses, ask for **Copy details**
  from the panel after a fill (its `skills` list says what each search found and how it was chosen).
- Work Experience Add: fixed in 2.35.13–2.35.14 (button found by section heading; count from Claude's
  `_roles` list). Career transitions count as entries (2.36.1). Watch for over/under-adding.
- First "My Information" page: needs Address/Phone in the user's facts; City is now learned (2.36.3).
- Education From year: needs the school's years in facts ("American University of Kuwait: 2005 – 2009").
- Phone filling (bookmark) and Send to Job Hunt from the LinkedIn app (iOS Shortcut → `/m/add`):
  built and unit-tested, not yet tried by the user on a real phone.
- The Ryan "Manager, Tax Technology" LinkedIn posting wasn't picked up; LinkedIn now reads 4 pages.
  If it's still missing, check the skipped list's reason (location or age).
- The GitHub release notes for 2.36.8 show "5,000–15,000" (shell ate `$9`); the in-app changelog is fixed.
- Build speed: the Windows release build uses thin LTO over 16 units since 2.38.0. If the installer
  grew too much or the app got slower, go back to `lto = true`, `codegen-units = 1`.
- Suggested and not built: learning from picks (the user wants Not interested not to learn), follow-ups
  that send themselves (they're drafted; Write all N drafts them in one go), a one-click loosen for
  filters (Search's last-search card links each reason to its setting instead).
- `git push origin HEAD:main --no-verify` is refused in cloud sessions; push without the flag (the hook
  isn't on unless `core.hooksPath` is set).
