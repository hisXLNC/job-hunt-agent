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
- **2.75.2: sync and backup no longer hold the database while they copy it.** A Job Bank fill failed with "Job
  Hunt took too long to answer": `/ext/fill/start` (which only reads a few jobs and returns a ticket) timed out
  three times at 20 s, so the `Agent.db` mutex was held for over 20 s. `backup::write_snapshot` ran `VACUUM INTO`
  on the app's own connection inside `agent.db()`, for every sync (every 5–10 min when anything changed, so all
  through a search) and backup: everything waited for the whole copy. It now copies on a second, read-only
  connection (`Db::snapshot_file`, `Db::file`); the in-memory test database keeps the old path. This is the likeliest
  cause of the slow search sort in 2.71.2's notes too (sync was running in that log), but not proven: the search
  log's `database` line and "waiting for the database" seconds will show. Also: the Queue's "Each step's own order"
  is "Recommended order", with what it means on its tooltip.
- **2.75.1: details typed into entries are learned.** `personal_in` refuses anything in a numbered entry
  ("Education 1", "Languages 3") so one school isn't copied into every entry; that also threw away a GPA, a degree's
  start year and a language's level, however often they were typed. `fill::entry_details(fields)` now keeps those
  by what they're about ("Education (American University of Kuwait): Overall Result (GPA)", "Language (French):
  Reading", "Certification entry 2: Certification Number"; `ENTRY_KINDS`), as saved answers (so they show and can
  be edited under Me → About me), and `entry_lines` gives them to Claude with the facts for forms and answers.
  They're learned when a form is left (Next / Save and Continue) or marked applied, as before. Unverified on a
  real form: that Workday's date boxes and school search box report their values to `learn`.
- **2.75.0: tidy-ups from a screen-by-screen review, and two form-filling fixes from a Copy details.**
  - Review (screens photographed with the dev server; the user said "do them all"): the update bar only on the Queue
    and Settings → App (`updateBarHere`; the chip stays everywhere); the Queue's heading counts what the badge
    counts (`needsYou`), steps with nothing in them are hidden, each Pick row has Tailor, the approve row's note no
    longer says "by email" and "on the company's site" together, "What Job Hunt did lately" starts folded and the
    Optional card shows only when the Queue is empty; All jobs leaves out Salary/Type when no row has one
    (`no-pay`/`no-type`); a job's AI-screen card moved inside Overview so the tabs sit under the header, "Next:" is
    said once, the stage picker is behind Change stage, the button is "Approve and send" with the address beside it;
    the Calendar leads with Coming up; Career's second card is "Where each path leads"; About me has a jump row;
    Ask Claude's empty state is one sentence. **The extension's setup list was broken by `.steps-list li {display:
    flex}` added for the CV update: it's `.setup-steps` now.** Left alone on purpose: the Queue's sortable column
    headers (a tested feature; removing them was tried and put back) and the top bar's chips.
  - From the OSC Workday details (4 m 44 s): the certification box is a fixed list of four, and five searches each
    waited out ~13 s before Other. `fillSkills` now stops as soon as two searches show the same choices. From the
    SuccessFactors log: "no such choice in its list" for "Native" (choices: Basic / Professional / Full proficiency)
    and for a university not in a Canadian list. `fillOwned` now asks Job Hunt once more with the list's real choices
    (`chooseFrom`: a one-field `/ext/fill/start` with `options`) and takes its pick.
- **2.74.0: a batch of small reports** (2.73.0 was never pushed to main on its own; it ships in this).
  - *A picture in Ask Claude*: the paperclip, a pasted screenshot or a drop (`askAttach` in `app-ask.js`: resized to
    ≤1600 px, a 220 px thumbnail kept with the message). `page.image {mime, b64}` → `people::ask_image` (PNG/JPEG/
    WebP/GIF, ≤5 MB) → `Asked.image` → `Claude::call_seeing`: through Claude Code the file is put beside the request
    and Claude is told to open it with Read; with an API key it's an image block; another AI doing everything is
    told there was one it can't see. The picture itself is never stored.
  - *Marked as applied, honestly*: the panel said "Marked as applied in Job Hunt" before asking, and `/ext/applied`
    failed silently when the thank-you page couldn't be matched to a job. Now `markApplied` (fill.js) awaits the
    answer, sends `job_id` (`filledFor`, from the fill's answer, kept in `sessionStorage['jobhunt-job']` for the next
    page; the bridge uses it before `job_for_page`), and on failure shows Mark as applied or the chooser
    (`afterPick`).
  - *Which job is this page?* `apply.browser` from Fill in my browser has no site; it matched any page for two
    hours (Job Bank was named as an Interac job). Now it's open (`*`) for 15 minutes to the first sites it's used
    on, three at most, never a job board the job didn't come from; a choice made in the extension stays that one site.
  - *Lists*: Ready to approve's select bar has Not interested (`dismissPicked` reads either list); the "did these go
    through?" rows and the Queue's "Did it go through?" card have Not interested; Not interested or Save for later on
    a job's own page returns to the screen you came from (`cameFrom`); a job opened by a link with no `data-tab-to`
    opens on Overview (the stage's own tab is no longer the default).
- **2.73.0: what's running, with a Stop for each; right-click a box to fill only it.**
  - *Activity panel* (`static/app-activity.js`, bottom left, hidden when idle; state is `running`, not `act`, which
    broke the whole app as a global). `Agent::activity()` lists the claims worth showing (`KINDS` in `pipeline.rs`:
    search, cv-update, claude-fill, tailor:, revise:, answers:, prep:, ask, cvchat, career…; housekeeping like sync is
    left out) with label, the job's name, seconds since it started (`STARTED`, set in `claim`/`claim_owned`) and a
    percent: real for the search (`Progress.percent`) and a CV update (scored+tailored of what's owed), otherwise a
    guess from the usual time for that kind, capped at 95 and drawn striped (`estimated`). `GET /api/activity`,
    `POST /api/activity/stop {id}` → `stop_activity`: the search's force stop, the CV update's stop, or
    `claude_code::cancel_task(name)`. Requests are tied to the work they're for by `claude_code::Task` (thread-local
    name, set by `claim` on the claiming thread and by hand for `ask`/`cvchat`; outer name wins); `run_capture` kills
    its child when its task is cancelled and refuses that task's next requests for 8 s. Not cancellable: requests
    through the API engine or another AI, and a web request in flight.
  - *Fill this in*: manifest permission `contextMenus`; `background.js` adds "Job Hunt: fill this in" (all contexts:
    a drawn dropdown isn't "editable") and calls `startFill(tabId, true)` → `window.__jobhunt.fillOnly()`. `fill.js`:
    the box is what was right-clicked (a `contextmenu` listener, when the script was already on the page) or what
    has the cursor; `startNow` skips unfolding and the letter opener, narrows `list` to the field that is, holds or
    sits in that element (`onlyKeys`), and `fillNow` fills only those and ends with one line about that box.
    Extension test `one`.
- **2.72.0: Force stop asks what to stop; Job Bank, Jobs.ca and a dropped Workday answer.** (This session's cloud
  environment "job-hunt-agent" now allows www.jobbank.gc.ca, www.jobs.ca and mastercard.wd1.myworkdayjobs.com, so
  those were looked at live.)
  - *Force stop*: `forceStopChoose()` (a dialog: The search / CV updating and tailoring / Everything), from the search
    card, the search menu and the status menu. `POST /api/search/stop {force: "search"|"work"|"all"}` →
    `force_stop_search` / `force_stop_work` / `force_stop_all`. Claude Code requests are tagged by thread:
    `claude_code::Scope::enter(SCOPE_SEARCH | SCOPE_WORK)` in `search_with`, the CV-update thread, `tailor`, `rescore`,
    `cert_rescore`, `revise` (an outer mark wins: tailoring inside a search is the search's). `cancel(Some(scope) |
    None)` kills the matching children and refuses new ones of that kind for 8 s, so a loop over jobs runs out.
  - *Job Bank* returned 0 for every search because (1) it ignores `locationstring` unless picked from its own list
    (the page title says "in various locations"), so the 3 places were 3 identical country-wide requests, and (2) it
    matches its own plain titles: "Program Manager" 79, "Senior Technical Program Manager" / "Delivery Lead" /
    "Tax Technology Program Manager" 0. Now `jobbank_titles(p, 6)` (level words dropped, long titles cut to their
    last two words, commonest first), once each, with `fprov=<province>` from `jobbank_province(p)` when all places
    share one. Live: 74 postings for the user's titles where there were none. Titles ending in "Lead" still find
    nothing there.
  - *Jobs.ca* answers with Cloudflare's "Just a moment…" check, to a plain request and to the app's browser: it can't
    be read. Each attempt cost 45 s; now the first block in a search skips that site's other searches
    (`sites::is_blocked`), and the problem line says to turn it off if it keeps happening. Not fixed, only cheaper.
  - *Mastercard's Workday board* works from here with the user's titles (231 postings, twice). Their failure
    ("error decoding response body" after 4 s) was one answer cut off; `workday()` used `?` on every request, so one
    lost the whole board. Now each request is retried once, a title that still fails is skipped, and the board fails
    only when it's not found or nothing answered.
- **2.71.3: Force stop.** `Agent::force_stop_search`: swaps the `search` claim for `search-ending` (`SEARCH_ENDING`;
  so nothing shows as running), sets `stop`, calls `claude_code::cancel_running()` (a counter `run_capture` watches:
  every Claude Code child running now is killed, whatever it was for), and logs it. A thread can't be killed, so the
  old search ends at its next `stopping()` look or when its in-flight site request times out; `Running::drop` for
  "search" clears `search-ending`, and until then `search_with` refuses and `due_tasks` doesn't start one. `POST
  /api/search/stop {force:true}`; buttons on the progress card and in the search menu (`searchForceStop`). The API
  engine's requests in flight aren't cancelled (only Claude Code's).
- **2.71.2: the slow step is sorting, not Adzuna (cause still unconfirmed).** The user's log: "sorted 786 postings
  in 501.6s", then 3,370 more under way 11 min later, `running: [search, sync]`. Not reproduced: the same sort takes
  0.2–0.3 s here on 3,000 stored jobs, with or without a thread calling `overview()` alongside; every per-posting
  lookup uses an index (`db::tests::no_lookup_a_search_makes_for_each_posting_reads_the_whole_table`, EXPLAIN QUERY
  PLAN over `PER_POSTING`); `record_repost` was suspected and wasn't it (now two indexed lookups anyway). So the time
  is either waiting for the `Agent.db` mutex or slow lookups in their file (WAL size? disk?). Changed: `take_in`
  takes the database once per 250 postings instead of ~8 times a posting, tallies per chunk, and logs "sorted N in Xs
  (Ys of it waiting for the database)", "still sorting…" every 20 s, and at search start `database: {file_mb,
  wal_mb, jobs, wait_ms, lookup_ms}` (`Agent::db_facts`, also in `/api/search-log`). **Next log decides**: wait ≈
  total → find who holds the mutex (sync? an API route?); wait small and lookup_ms large → the file (checkpoint the
  WAL, look at where the data folder lives).
- **2.71.1: a log for searches that seem stuck.** Report: the Queue sat at "Searching job sites 120 of 120 · Adzuna
  …" (69%) with 16 new, 3 scored. `on_step(i, n)` is called *before* search i, so that label means either the last
  request is in flight (30 s timeout a page) or, more likely, the sources are done and the main thread is in
  `take_in` (looking each of ~2,000 postings up, one commit each for reposts) or reading details, with nothing said.
  Cause not confirmed. Added: `Agent::trace` (static `TRAIL`, last 400 lines with times, also written to
  `search-log.json` in the data folder), written by `step`/`also` on change and at: search start/finish, each batch
  sorted (with seconds and counts) and scored, sources done, closed-board check, choosing what to tailor, and any
  single search that took ≥ 8 s or failed (`sources::fetch_noting`'s `on_note`). `Progress.moved` (last change);
  `GET /api/search-log` ({running, quiet_seconds, progress, paused, stopping, limited, trail}). The progress card
  (`quietNote`) and the top-bar menu have Copy search log; after 90 s with nothing moving the card says so. A big
  batch now shows "Meanwhile: sorting N postings against what you've already seen".
- **2.71.0: a CV from a conversation.** `static/app-cvchat.js` draws a card wherever a page puts `[data-cv-chat]`
  (the setup's "Add your CV" step in `app-flow.js`, and Me → CVs under the drop box); a MutationObserver mounts it.
  `Llm::cv_interview(history, message, known) -> CvTalk { reply, cv, ready }` (`cv_interview_system()`: one question
  at a time, the whole CV rewritten in plain text each turn, only what was said). `Agent::cv_chat_start/state/
  create/clear` in `pipeline/people.rs` (state in `cvchat`, claim `cvchat`, usage kind `cvchat`); `GET/POST
  /api/cv-chat` ({message} | {clear} | {create}). Create = `add_cv("<name> CV.txt", text, convert)`: the same path as
  a text file you upload (Claude lays it out as Word), then career options and `after_cv_added`. The microphone
  button uses the browser's speech recognition when the window has it (unverified in the Windows app's WebView2).
- **2.70.0: Claude in the browser; the assistant across the app.**
  - *The connection to the Claude extension is through Claude Code*: `claude --chrome -p …` gives Claude Code the
    Claude in Chrome tools (docs: code.claude.com/docs/en/chrome; needs the extension ≥ 1.0.36 signed in to the same
    claude.ai account, Claude Code signed in with /login and a paid plan, not an API key; Windows is supported, WSL
    isn't; Claude works in NEW tabs it opens, not the tab you're on). `claude_code::browser_args()` (only
    `mcp__claude-in-chrome`, `Read`, `ToolSearch` allowed; the rest refused), `browse(cc, task, files, limit)` (files
    copied beside it to attach; answer through the same `parse_output`), `browser_help`, `chrome_setup_script`.
    `fill::claude_fill_start(agent, job, url, page)` builds `claude_fill_task` (the brief + where to go + file names +
    never Submit), runs under claim `claude-fill` for up to 15 min, keeps `claudefill:<job>` ({running, at, said |
    error}) and notifies. Entry points: the panel's Let Claude finish it (`/ext/handover`, polled with
    `/ext/handover/state`; falls back to the clipboard brief with the reason when it can't start), the Queue's
    "Have Claude fill it in" (`POST /api/jobs/<id>/claude-fill`), and the assistant's `fill_with_claude` offer.
    Settings → Applying → Filling in forms has the card (`renderChrome`): `GET /api/claude-chrome`, `POST
    …/test` (opens example.com; result kept in `chrome.test`), `POST …/setup` (console running `claude --chrome`).
    **None of this could be run here** (no Chrome extension, no sign-in): whether `-p` accepts `--chrome` without the
    first-run dialog, and whether the extension's own site-permission prompt blocks a headless run, are unknown. The
    Test button's words are what to ask the user for.
  - *Assistant across the app*: offers `approve`, `mark_applied`, `fill_with_claude` (job on screen) and, from any
    screen, `search_now`, `set_bar`, `add_titles`, `add_certification`, `add_fact`, `skip_company`, `auto_tailor`
    (`OFFERS_APP`). The app ones are done by `Agent::ask_do(at, which)` from the stored offer (`POST /api/ask {do}`),
    never from what the page sends. Closing the panel now blurs its box (page keys were dead after Esc).
- **2.69.0: the assistant across jobs; what to fix first; a check before a form.**
  - `ask_facts` now lists the applications in play (approved, ready, queued; best first; `[id] title at company |
    stage | fit | keywords | closes`) and `fixes()`. Offers `set_aside_many`, `save_many`, `tailor_many`
    (`OFFERS_MANY`) carry `jobs` (ids Claude copies from that list; unknown ids dropped in `ask_answer`) and need no
    job on screen; `askDo` asks once, then calls the job route for each.
  - `Agent::fixes()` (`pipeline/people.rs`; no Claude): at most three of: a site Job Hunt can't read or that only
    partly fills (from `fill::sites`), details forms ask for that it can't answer (`fill::missing_details(None)`),
    ready applications tailoring didn't help (≥2), approved ones not sent, ready ones waiting over a week (≥3).
    `GET /api/fixes` → `#fixesCard` at the top of Insights (`loadFixes` in `app-steps.js`).
  - *Before a form*: the page's report carries `blank` (required boxes with no answer), kept per site in
    `fill:sites[host].blank`. `fill::precheck(job)` = that site's blanks plus `BASICS` (Phone, Address, City, Postal
    code) minus what `answer_keys` covers (saved answers and labelled facts match loosely; contact details exactly,
    marked `=`; a postal code, street or `locations` found anywhere count). `GET /api/jobs/<id>/precheck`, `POST
    /api/precheck {answers}` → `keep_answers` (the bank). Shown by `loadPrecheck` in any `[data-precheck]` (the
    Queue's submit card and the job's Questions tab); a MutationObserver on `#main` fills them and `#fixesCard`.
- **2.68.0: the assistant offers to act; a tally of forms by site; and four smaller things.** (2.67.2 before it only
  shrank the Ask Claude button to a 36px round icon that names itself on hover.)
  - *Offers.* `Llm::assist` returns `Assisted { reply, actions: Vec<Offer> }` (`claude.rs`; kinds in `OFFERS`:
    add_keywords, revise_cv, revise_letter, tailor, save_later, set_aside). `ask_answer` keeps only known kinds, only
    with a job on screen, at most 3, on the message as `actions` with `job`. The page (`ASK_DOES`/`askDo` in
    `app-ask.js`) turns a pressed offer into the existing job routes (`/revise`, `/tailor`, `/status`), then
    `POST /api/ask {did:[message, offer]}` marks it done. Claude never does anything itself.
  - *Earlier per-job chats*: `GET /api/ask?job=<id>` adds `earlier` (the old `chat:<id>`), shown folded at the top of
    the conversation while that job is on screen.
  - *Sites tally*: the page posts `/ext/report` (in `PAGE_ASKS`) when a fill ends ({boxes, filled, refused, stuck
    labels}), when it can't read a page ({failed}) and on a hand-over ({handed}); `fill::site_report` adds it to
    `fill:sites` by host; `fill::sites` (worst first) → `GET /api/fill-sites` → Settings → Applying → Filling in forms
    (`renderFillSites`). Counts and labels only.
  - *Tailoring that didn't help*: `flatTailor(j)` in `app-steps.js` (after − before ≤ 2 and coverage under
    `THIN_COVER`): said on the row and in the job's keyword box.
  - *Certifications and old scores*: `cert_postings()` (queued, saved, or skipped within 20 of the bar, open, naming a
    certification: `cert_terms`, `has_word`), `cert_rescore(ids)` under the `rescore` claim, capped by
    `max_scored_per_run`; `GET/POST /api/certs/rescore`; the line under the certifications list (`renderCertRescore`).
  - *Required boxes with no answer* are named in the panel's closing words (they're kept by `learn` when you move on
    or submit, as before).
  - Still waiting on the user for: Copy details from Rogers, Indeed's cover letter step, Job Bank's Add form and PMP on
    OSC (all changed since they last tried), and the Indeed notice's "Claude Code said".
- **2.67.1: hand-over to the Claude extension.** 2.67.0 never published (its new test needed Claude reachable on
  the build machine; the test now sets `claude.engine=api`). One extension can't open, message or type into another
  (Claude in Chrome has no external hook; searched), so the hand-over is the clipboard: panel button `hand` ("Let
  Claude finish it", shown by `status()` when it says can't find a form / tripped / Couldn't / No answers, and at the
  end of a fill when boxes with an answer didn't take it) and the footer's brief button both call `handOver`, which
  posts `/ext/brief` with `left` (unfilled boxes with the answer Job Hunt had, or required ones), `done`, `missed`
  (skills); `fill::brief(agent, job, page)` adds "already filled N boxes… these are still empty" to the brief. The
  panel then says: open Claude (toolbar icon or Ctrl/Cmd+E), paste, Enter.
- **2.67.0: the assistant; the letter's place; certifications; dropdowns with their own list; after scores.**
  - *Ask Claude floats over every screen* (`static/app-ask.js`, last script in `index.html`; styles at the end of
    `app.css` under "Ask Claude"). The job page's Ask Claude tab, `chat*` actions, `/api/jobs/<id>/chat`, `Llm::chat`
    and `chat:<job>` storage are gone (old per-job conversations are left in the database, unread). One conversation,
    `ask:chat` (+ `ask:error`, `ask:draft`), `Agent::ask_start/ask_answer/ask_state/ask_clear` in
    `pipeline/people.rs`, routes GET/POST `/api/ask`. Each message carries `page` = {where, hash, job, seen (the
    screen's innerText, 9000 chars), quote (selected words)}; `ask_facts` adds the bar, titles, wants, certifications and
    the on-screen job's score, reasons, keywords, gaps. `Llm::assist(&Asked)` with `assist_system()` (a primer on how Job
    Hunt works; may link `[All jobs](#applications)` etc., which `marked()` in `app-steps.js` now renders for `#` links
    only). On failure the user's message is taken back off the log and returned as `draft`. Usage kind stays "chat".
    Selecting words in `#main`/`#jobPanel` shows `#askSel`; key `c` opens it anywhere; "Practise this interview" sends
    `PRACTISE` through it. `dev_server.rs` DemoLlm and `testkit` FakeLlm answer `assist` ("fail" in the message errors).
  - *Cover letter behind a link* (`fill.js` `letterAdder`, in `startNow` before `collect`): an Add/Upload whose small
    block says cover letter / supporting documents and holds no file is pressed once (`lettersTried`); an upload box
    that shows within 3 min (`letterOpened`, also `sessionStorage['jobhunt-letter']` for a page of its own) and names
    no other document gets `section: "Cover letter"`, so `file_for` gives it the letter. `fill.rs` `is_letter_box`: an
    empty textarea named for the cover letter gets the job's own letter text. Modelled on a screenshot of Indeed's
    review page; the page it opens is unseen.
  - *Certifications* (`Profile.certifications: Vec<Certification>`, Me → About me, autosaved like the rest;
    `certRow` in `app-settings.js`). `Profile::cert_lines()` goes to scoring (`scoring_guidance`), form facts
    (`fill.rs`, `answer_questions`), letters and tailoring (`letter_facts()` replaces `stories` there), the assistant,
    and `/ext` details; a form's Certifications Add gets max(CV's, listed).
  - *Dropdowns that own their list* (`fill.js` `fillOwned`, tried first for `combobox`): SuccessFactors' "No
    Selection" boxes (`aria-owns="NN:_listSelect"`, opened by `juic.fire(..."_click")` on click). Click the box, else
    its arrow, else type; choose from the list's innermost `[role=option],li,a`; a real click if a script's is ignored.
    Traces "a list of its own never opened" / "no such choice in its list" (with the choices) / "its list took no
    choice". Written from Rogers' Copy details; the list's real markup is unseen.
  - *After scores*: `score_tailored` (split out of `tailor`), `without_after_score`, `score_tailored_missing(8)` run
    with the half-hourly `cvwork` task for ready/approved jobs whose tailored CV was never scored. Rows show
    before → after whenever `score_after` is set, also when equal ("same before").
- **2.66.0: folded forms; a brief for Claude.** `start()` first presses "Expand all (sections)" (or, on a page with
  under three boxes, each `aria-expanded=false` bar that isn't a menu): Rogers is SuccessFactors and showed no boxes.
  `fill::brief` + `POST /ext/brief` + the panel's `brief` button: the user asked for Job Hunt to work with the Claude
  extension; nothing can drive that extension from outside, so Job Hunt hands it a brief to paste. Mock: `/folded/apply`
  (test `folded`). SuccessFactors' upload tiles (Upload a Resume) and its real boxes are NOT seen: ask for Copy details.
  A GitHub build of 2.65.7 failed once on `sync::tests::two_computers_through_google_drive` (not reproduced in 26 local
  runs; the test now says why if it fails again, and `verify` prints a panic's own line).
- **2.65.7: a profile's list page (Job Bank).** `start()` with no boxes presses the page's own Add button (`opens`),
  sets `sessionStorage['jobhunt-continue']`, and carries on when the form shows there or on the next page; background.js
  keeps a tab "armed" for 20 min after `startFill` (`chrome.storage.session` `armed`) and puts fill.js on that site's
  next pages (`tabs.onUpdated`), which auto-starts only with the continue flag. Mock: `/match/profile/list`. NOT seen on
  the real Job Bank, nor with the real extension's activeTab-only permission (the test build has all sites): if the
  panel doesn't follow to the next page there, that permission is why. 2.65.6: Update everything now (`update_for_cvs_now`).
- **2.65.5: CV work is read from the jobs.** `cv_work_pending()` (queued/saved with no score and reasoning "Not scored: ",
  ready with no score, approved-unsent with no score) + `resume_cv_work()` (runs `refresh_after_cv("", …)`), called by
  `apply_cv_change`, `after_cv_added`, and the `cvwork` task every 30 min (`last.cvwork`). `cv.waiting` no longer decides.
  Removal only unscores queued/saved; skipped/dismissed keep their fit and lose the track. 2.65.1 to 2.65.4: Indeed's
  notice (see `told_apart` in `claude.rs`, `connFix` in app-settings.js); the Sign in to Claude button never sent its
  request (`busy(el, …)`), fixed in 2.65.3. Waiting on the user for what "Claude Code said" on the Indeed notice.
- **2.65.0: Settings regrouped** (the user approved the mockups: side list, tabs, search; "keep the design language
  consistent", so it is built from cards, pills and `placeTabs`, nothing new but the side list). In `app-settings.js`:
  `settingsCards(group, sub, host, st)` is the old page builder, now returning its cards with a marker before each
  (`<!--@name-->`, read by `cut()`); `settingsBody(section, tab, st)` puts them where they belong; `SET_NAV`, `SET_TABS`,
  `SET_ALIAS` (old addresses), `settingsShell`, `showSettings(arg)` for `#settings/<place>/<tab>`. Me's pages (CVs,
  Looking for) still come from `settingsCards` with a host heading. Job search's Sources and Last search are `showSearch`
  (`#search`, `#search/last`, `#search/<source>`); the sources are one list (`tile()` rows in groups, filled by
  `renderConnStatus` and `fillSourceRows`). A split profile form saves fine: `readProfile` only reads the fields present.
  Search: `settingsIndex()` reads every page's HTML (so a new setting is found without listing it), `settingsFind`,
  `setGo` + `setFlash`. A new card needs a marker and a line in `settingsBody`. Checked in the preview only.
- **2.64.0: only a career warning.** The user: "I want the options to show up, I just want to be warned if it will
  SIGNIFICANTLY impact my career"; tax product to AI product is no setback, financial analyst to McDonald's manager is.
  `Wants::for_scoring` always adds one line asking for "Career path: away" only for a real setback (never "toward");
  `pathTag` shows only "Could set you back". `addPath` also posts the path's titles to `/api/results/add-titles` (first
  CV). Old "toward" flags on jobs are simply not shown. Not seen with real Claude: watch that warnings stay rare.
- **2.63.0: several career paths.** `Wants.path` is still one string; several are kept with "; " between
  (`pathList` in app-actions.js, split in `Wants::for_scoring`, whose prompt says toward any / away from all). Cards have
  `addPath` / `dropPath`, the path card shows chips. The user likes product work and is undecided between tax, AI and
  product in general: don't push them to one. 2.62.2: Recommended is `.rec-mark` under the path's name.
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

## 2.76.0

- **Search slow for new postings (the 2.75.1 log: 1,664 postings quiet for 1,053 s).** Cause: every
  `self.db()` waited ~0.4–1.1 s behind the page's `/api/overview` poll (it reads thousands of rows with
  the mutex held), and each NEW posting still took 2–3 turns (`rating`, `skip` → `insert_job`). Now
  `take_in` handles a chunk's new postings in one turn (`skipped_job` + `Db::insert_jobs`, one
  transaction), and the overview route keeps its answer for up to 6 s while a search runs
  (`OVERVIEW_KEPT` in api.rs, cleared by any non-GET request; off under `cfg!(test)`).
- **Force stop sat on "letting go".** After a stop, `take_in` still sorted every batch the job sites
  handed over (known-check, sightings, one chunk each) and `close_missing` still ran. Now `take_in`
  returns at once when `stopping()`, and `close_missing` is skipped after a stop (unsorted postings
  must not read as taken down). Label is now "finishing what it was in the middle of"; test updated.
- **× on Ready to approve did nothing.** The handler awaited `GET /api/jobs/<id>` (for the company
  name) before opening the dialog, so it hung while the database was busy. `companyOf(id)` reads it
  from `overview`; the fetch is a 400 ms fallback.
- Posting age (`ageTag`, exact date/time in its title) on every `row()` list (approve, submit…).
- "Applied here before" tag is a button: modal of earlier roles at that company (`company_history`
  in the job JSON now carries location, fit, cv, letter, last).

## 2.77.0 (backend)

- **Read-only second connection.** `Agent.reader` (`Db::open_reader`, none for in-memory test DBs).
  `agent.reading()` returns a guard; while it lives, `agent.db()` on that thread hands out the reader
  (thread-local `READING`). `api::route` wraps GET `/api/overview`, `/api/jobs`, `/api/jobs/<id>` in
  it; an error containing "readonly" (a helper tried to write) is answered again on the main
  connection. Helpers of those three routes were checked for writes (none). Don't add writes to them
  that are swallowed with `let _ =`: under reading they'd be silently skipped.
- **Sync was always due.** `sync.tried` / `last.*` writes moved `total_changes`, so each interval did
  a full VACUUM INTO + zip (+ Drive upload). `Db::changes()` now leaves out bookkeeping keys
  (`bookkeeping()` in db.rs: `last.*` except `last.report`, `sync.tried`, `sync.error`,
  `search.held.count`).
- Indexes `jobs_applied` (partial), `jobs_found`, `events_created`; `PRAGMA synchronous=NORMAL`,
  `cache_size` 32 MB. Sightings older than 120 days deleted at open (only 90 are read).
- Whole-table loads replaced: `applied_here` (`Db::applied_since`), logos `sites_for`
  (`Db::company_links`, dupe_key range), `export_csv` and overview recruiter asks (`Db::jobs_in`;
  asks used to look only at the newest 400 found). `/api/jobs` rating map built in one pass.
- `search.held.count` kept beside `search.held` (held_count parsed the whole blob on each poll);
  a failed `hold` write is logged as `search:error`.
- `running`/`progress`/`STARTED`/`TRAIL`/`OVERVIEW_KEPT` locks survive a poisoned mutex.
- web.rs reads a request body as it arrives rather than allocating Content-Length up front.
- **Left from the review (not done):** overview rebuilt on every poll with repeated list loads (cache
  keyed on `db.changes()`); skipped jobs keep full descriptions forever (most of the file size;
  `purge_after_days` defaults to 0); long text mid-row (side table); `results_for`, `rescore_pool`,
  `cert_postings`, `/api/jobs` full-row loads; `posting_outcomes` per-posting lookups; per-row
  commits in `score_these`/`merge_duplicates`; one thread per connection and per logo; body read
  before sign-in on Remote access; docx parsed under the DB guard in Settings.
- **Extension, boxes that only take a suggestion (Job Bank "Add a work experience" → Job title).**
  `suggests(el)` (tt-input, ui-autocomplete-input, aria-autocomplete…) → `fillSuggested`: types the
  answer whole and in shorter forms (`typeInto`, no blur), gathers the suggestions (`SUGGESTED`
  selectors), clicks an exact one or asks `chooseFrom`. Job Bank's real markup wasn't seen (needs a
  login): selectors are the usual typeahead.js / jQuery UI ones. Mock: `letter` variant, `#occ`.
- The `submit` listener ignores a form sent by a NOT_SEND button (Add, Save, Next…; `notSendAt`,
  `e.submitter`): Job Bank's Add set the panel to "Waiting for the site to confirm".

## 2.78.0 (backend, second pass)

- **Overview rebuilt only on change.** `Agent::data_stamp()` = the reader's `PRAGMA data_version`
  (moves when the main connection commits; `total_changes` for in-memory DBs). The overview route
  keeps its last answer per agent (`OVERVIEW_KEPT`: time, stamp, value) and reuses it while the
  stamp is the same and it's under 30 s old (6 s, whatever the stamp, during a search); `running`
  and `progress` are always patched in fresh; any non-GET request clears it. Off under `cfg!(test)`.
  State kept only in memory and shown in the overview can lag up to 30 s if nothing is saved.
- **`Db::jobs_light(limit, tailored_text)`**: every column but description ('' or only for jobs with
  a CV), cover_letter (NULL), cv_changes ('[]'). Used where only counts/titles/links are read:
  `results_for` (tailored_text: pay needs the text of tailored jobs), `week_in_words`,
  `write_insights`, `skill_gaps`, `outreach_stats`, `messaged_at`, `rate_company`,
  `companies_to_rate`, logos `name_hosts_once`, `/api/recruiters`, `job_for_clip` (one read, was
  two). Don't use it for a function that RETURNS jobs to callers that read the text.
  `cert_postings` filters in SQL (`Db::jobs_near_bar`). Still whole rows: `/api/jobs` (salary,
  deadline and employment type are read from the text), `rescore_pool`, `rescan_salaries`.
- **Remote access:** `read_request_if`: a body over 64 KB (`UNSIGNED_BODY`) is read only when the
  cookie in the headers is a signed-in session (and Remote access is on); otherwise the connection
  is dropped unread. The bridge (127.0.0.1) keeps `read_request`.

## 2.79.0 (UI pass, and Job Bank's job title again)

- **Extension, suggestion boxes:** Job Bank's suggestions arrive ~1 s after typing while the last
  query's list stays up, so every shorter form of a title collected the first (wrong) list and
  Claude chose "excise tax collector". `fillSuggested`'s `ask` now empties the box, types, and waits
  until the list differs from the last one seen (or 2.5 s). The chooser's label says to match the
  role, not the subject. Mock (`letter` variant, `#occ`) now answers after 900 ms.
- **One way to sort Queue lists:** the `.list-head` sort buttons are gone (it only carries Select
  all now). The Sort by menu has Company / Role / Place (A to Z): these set `listSort`
  (`TEXT_SORTS` in app-steps.js); numeric orders still go through `applyQueueView`. The screen
  test for sortable headers was replaced on purpose by one for the menu.
- Queue heading follows the tab (`tabHeading`); the sort bar hides when the tab's list is empty.
- Pick rows: no "No pay stated" (`payFact` returns ''), no View button (the title opens the job),
  group heading is "N new matches" (`has('<span data-pickhead')` finds the group: it matched on the
  heading's first word before).
- **Top bar:** `#dGoogle`/`#mGoogle` are always hidden; `#dSync`/`#mSync` show only when sync is
  not fine, with their words (`chip()` in app.js). What's fine is in the search chip's title.
- **Phone:** Ask Claude is a button in the top bar (`data-act="askOpen"`); `.ask-fab` is hidden
  under 760 px (it covered each row's ×). Shows pay / No red flags and the key hints are hidden
  above the list under 640 px (they're in Sort and filter).
- **Job page:** `early` (queued/skipped/dismissed/saved, nothing tailored): `.jpane.early` orders
  the Overview by CSS `order` (fit and posting, then the ATS note, then a one-line stage). DOM order
  is unchanged, so keyboard order differs from what's seen there.
- All jobs: set-aside rows say "Tailor anyway" (ghost). Settings → Applying: the two long fields
  take the full row; `.field > .hint` matches `label.field .hint`. The notice card's first row has
  no top border.

## 2.79.1

- The user wanted the Queue's sorting and filters back: the `.list-head` sort buttons (Role, Company,
  Location, Pay, Found, Fit) are restored, and Shows pay / No red flags show above the list on a
  phone again. The Sort by menu keeps its Company / Role / Place options. Both screen tests (headers
  and menu) run. Don't remove these again.

## 2.80.0

- **A job board's link that leads nowhere (Adzuna → another aggregator).** `sources::follow_to_company`
  follows the posting's link (redirects, meta refresh, a script setting `location`) and keeps where
  it ends when that isn't a job board; `find_company_apply` tries it first (no Claude), then
  Claude's search (Claude Code only; otherwise an error saying so). `find_company_apply_later`
  (after approval) now runs for every engine. `is_job_board` knows ~30 more aggregators ("jobbi",
  whatjobs, jobleads…). Not tried against real Adzuna links (host not reachable from the dev box).
- **Find it on the company's site** runs in the background: `POST /api/jobs/<id>/apply-link`
  returns `{started}`; claim `apply-link:<id>` is in `activity()` KINDS (status panel, Stop); the job
  JSON has `finding`; the page shows "Looking…" and polls; a miss is logged as an `apply-link`
  event ("not found: …") and shown under the actions. New button "Search the web for it"
  (Google: "title" company careers) whenever a job has no company link.

## 2.80.1

- 2.80.0 failed on GitHub (never published): `find_company_apply`'s new guard asked
  `claude_ready()`, which is false on GitHub's machine (no Claude Code) and true on the dev box, so
  two tests passed here and failed there. Under `cfg!(test)` the guard is skipped and no job-board
  link is followed (tests never go to the network). Before pushing anything that touches
  `claude_ready()` / `engine_name()`, run the core tests with Claude off the PATH:
  `env PATH="$(dirname $(which cargo)):/usr/bin:/bin" cargo test --lib` in `core`.

## 2.81.0

- **Always somewhere to see background work.** `#actBar` is never hidden: with nothing running it's
  a small "Idle" chip (bottom left) that opens to "Nothing is running right now", the last search
  and the last six events (`/api/activity` now also returns `recent`, `last_search`; it's read on
  the reading connection). `activity()` lists every claim: housekeeping has names now (sync, backup,
  check-postings, ratings, salaries, applylinks…) and anything unnamed shows as "Working in the
  background" with its claim name. The test that sync was NOT listed is changed on purpose.
- **Forms: the two usual questions.** `fill::usual_answers` (after `tidy_answers`, not for
  profiles): "How did you hear about us" gets the job's source ("LinkedIn", "Indeed", "Company
  Website", else "Job Board"; for select/radio the closest option), and "Have you worked with us
  before?" (two-option radio) gets No unless the company's name is on the CV. From a CIBC Workday
  report where both were left blank. Workday's source box is a two-level list: whether the extension
  gets through the second level is untested.
- **Entry details are applied, not just told.** `fill::apply_entry_details(bank, fields, values)`
  runs after Claude's answers: for each Education / Certification / Language entry it finds the kept
  details (bank questions "Education (school): …", "Language (French): …", or "… entry N") by the
  entry's name as answered now, maps labels through `detail_kind` (GPA / from / to; a language level
  by its label, else that language's commonest kept level that the list offers) and overrides
  Claude's value. Never over a box that already has a value. Cause: the user's notes say "French:
  beginner", so Claude kept choosing "1 - Beginner" and left GPA / From (YYYY) out although the
  details were in the facts. Whether the user's bank actually holds those details couldn't be seen
  from here (they're listed under saved answers in the app).
- One button, **Find the real posting** (`findApply`): the page remembers the job (`findAsked`), and when `finding` ends without an `apply_url` it opens the web search itself (`webSearchFor`). Shown for any job not yet sent that has no company link.
- Logos: the whole name is also tried as .io/.co/.ai/.net (home page must name the company); the miss marker is `none5` so earlier misses (`none4`) are looked up again. Test of tried addresses updated on purpose. SOFTIQ's own site couldn't be reached from the dev box, so whether it now gets a logo is unknown.

## 2.81.1

- **Queue tabs went stale.** The 8 s refresh redrew only `#overview` (and results, calendar, a job),
  not `#overview/<step>`: on Pick, "Tailoring 7 applications" stayed for hours. It now redraws any
  `#overview…` view (not while a box is ticked), and also when the queued count or held count changes.
- **"1 new match to pick from" with nothing to pick.** The `held` item (postings waiting to be
  scored) counted as a pick. `queueCount` and the tab counts leave `kind === 'held'` out; with only
  held postings the heading says "N postings waiting to be scored" and the Pick tab shows no number.

## 2.82.0

- **Keywords you really have are remembered.** `keywords.have` = [{k, n, at}] (`known_keywords`,
  `learn_keywords`, `forget_keyword` in pipeline.rs). Learned in `revise()` when a CV request is the
  "work these in" note (`confirmed_in`: the text after "though my CV doesn't say so:", which both the
  Queue's ticked gaps and Ask Claude's add_keywords offer send; don't reword that note without
  changing `CONFIRMED`). First read backfills from past `revised` events (`Db::events_of_kind`).
  `tailor()` adds a "Confirmed by the candidate" block to the guidance for `confirmed_for(job, cv)`
  (posting keywords that are known and missing from the CV), and logs which made it in. The guidance
  preface in claude.rs allows that one exception to "never adds experience". The job JSON has
  `keywords_have` (gaps already known: pre-ticked in `gapsHtml`). `GET/POST /api/keywords`
  ({add} / {forget}); card `#kwCard` in CV & Career → Your details. Not tried with real Claude.
- **A held posting could wait for ever** ("scored 0 … 1 still waiting" after every batch): one whose
  text can't be read (LinkedIn / Job Bank / job site page gone) or that fails scoring was held again
  each time. `hold_tried(list, why, report)` counts tries in `search.held.tries` ({id: {n, why}});
  the third failure files it as skipped ("couldn't be scored after 3 tries: …") with a `held` event.
  Only postings a read was actually tried for count (the first `room`), not those over the cap, and
  not failures that stop every request (usage limit, no key). The `held` event now carries the first
  error when nothing was scored. Which of the causes the user's posting had is unknown.
- `GET /api/held` (`held_list`) and "Show them" beside "Score them all now" (`heldShown`, `heldLine`).
- Carets are drawn (`.caret` with an svg chevron, `.up` turned) instead of the ▾ character; Ask
  Claude's × is a minimise bar (same `askClose`).
- **Scores after working in keywords.** `revise()` → `rescore_revision` when the note is a "work
  these in" one: scores the tailored CV again (`score_tailored`, now pub(crate); one more request)
  and adds `scores: {keywords: [before, after], fit: [before, after], left}` to `revision.last:<id>`;
  `revScores` shows it in "What changed just now" (CV & letter tab). Fit is null there when the
  re-score failed. Other CV changes don't re-score.
- **Company on the job page.** `Db::open_at_company(company_key)` (queued/saved/ready/approved, not
  sent, not closed) → `company_open` in the job JSON (without this job). The name and "N more open
  roles here" are links (`companyJobs`: writes `jh.allFilters` with q = company, opens All jobs).
  `betterHere`: warns when another open role's `score` (fit before tailoring, so like for like) is
  3+ above this one's; not once applied.

## 2.83.0

- **Debugging mode** (`core/src/debug.rs`, global, not per agent). `debug::always(area, text)` is
  kept whether it's on or not (errors); `debug::note` only when on (`debug.on` = "1", read in
  `Agent::new` via `debug::init`, which also sets the panic hook outside tests). Ring of 4000 lines
  + `debug-log.txt` beside the data (starts again past 4 MB; `.old.txt`). Every line goes through
  `scrub` (email addresses, long tokens, key=…). Hooks: `api::handle` (non-GET and GETs ≥ 300 ms
  when on; errors and crashes always; `/api/debug*` itself never), `bridge::handle` (the
  extension's requests, with the site), `usage::Metered::run` (each Claude request: kind, seconds,
  error), `Db::log` (every event; kinds containing "error" always), `Agent::trace` (search steps),
  claims start/end (`ended`), `fill::learn` and the form answer (which entry details are kept:
  labels only), the page (`pageNote` in app.js: script errors always, screens opened when on →
  `POST /api/debug/log`). `Agent::debug_report()` is the text to send (state, database, held
  postings and tries, connections, last errors/events, search trail, the record);
  `GET /api/debug`, `/api/debug/report`, `POST /api/debug` ({on} / {clear}), `/api/debug/save`
  (file beside the data). Card `#debugCard` in Settings → App (section marker `@debug`; a checkbox's
  action lives in the `change` handler, not `act()`).
- **Workday, from a Copy details (fil.wd3):** GPA and French levels now fill. Left: (1) the end date
  of the current job was counted as "to do" although I currently work here was ticked and no end
  date was given: skipped now (`here` in the fill loop). (2) Education "From (YYYY)" had no answer.
  Server logic checked and looks right, so the likely cause is that the year was never kept: it
  was only learned on Save and Continue. Now `learnEdit` (fill.js) sends the edited entry's boxes
  1.5 s after you change one (`nowOf`: live value, else what the box was given, `f.put`), the learn
  cap went 80 → 200 boxes (a long Workday page has 88; the last language was cut off), and
  `apply_entry_details` also takes a detail kept by the entry's place when none is kept by name.
  The debug record now says which entry details are kept, so the next report settles it.
- Job page, CV & letter: "Edit the cover letter yourself" shows only with the Cover letter preview
  (`#letterEditCard`); "What changed in your CV" is full width and shows with the CV (`#cvChangesCard`).
- "Your own files" and "Tailor again" are no longer cards: they're the second row (`.own-row`) of
  the file buttons at the top of CV & letter ("From another CV" is a small menu). A job not yet
  tailored keeps a Tailor card.

## 2.84.0

- **Pictures on a job.** `Llm::read_picture(what, company, image) -> Seen {questions, people}`
  (claude.rs, through `call_seeing`; metered as "picture"; stand-ins in testkit.rs and
  examples/dev_server.rs). `Agent::read_picture(job_id, "questions"|"people", {image:{mime,b64}})`
  in pipeline/people.rs: questions are only returned (the page appends them to `#questions`);
  people are added to `contacts:<id>` (skipped when the name is there already). POST
  `/api/jobs/<id>/picture` `{what, image}`, synchronous, claims `picture:<id>`. Page:
  `pictureOf(file)` (app-ask.js, shared with Ask Claude), `jobPicture` + action `picPick`
  (app-actions.js), paste handlers on `#questions` and `#people` (app-job.js). Not tried with the
  real Claude.
- **Job tabs**: `apply` is now "Questions" (pre-check, What the form asks, kit), new `people`
  "Contacts" (People, then Follow-up) and `offer` "Offer". Links that meant contacts or the
  follow-up use `data-tab-to="people"`.
- Waiting on the user: approval of the screen-by-screen merge/split proposal sent with this version.

## 2.84.1

- **Ask for changes**: `#reviseWhat` is a hidden input (`data-ok` = which of cv/letter may be
  changed); the `#pvTabs` click sets it and `#reviseName` in the heading.
- **Zoho Recruit** (upstaff.zohorecruit.ca report; the site can't be reached from the cloud session,
  so none of this was tried on it). fill.js `labelOf`: when `question()` gives nothing or a
  non-name (`NO_NAME`: "Loading", `rec-form_…`, `inputId`), `rowLabel(el)` takes the first label-like
  text in the row of the box's part (`[id^="rec-form_"]`, lyte-*). Copy details gets the row's HTML
  for any box still without a name. Skills: `quiet` counts searches with no list and no "no items";
  when the first skill is all quiet, the rest are marked missed at once (`gaveUp`), and
  `diag.skillPopup` keeps the biggest node the page added after typing. Still unknown there: how
  its skills suggestions are drawn, and its Duration (from/to) dropdowns in Education/Experience
  rows, which aren't read as boxes at all.

## 2.85.0

The ten screen changes the user approved ("do them all"):
- About me (app-settings.js `details`): `#aboutCard` holds the name/email form and the signature
  (`h3#sigCard`); `#storiesCard` only stories; `#formsCard` = facts form (part `stories`, only the
  fields present are saved) + `#bankCard` (now a div inside it). `renderAutoSubmit()` draws
  `#autoSubmitCard` on Settings → Applying → Filling in forms.
- Settings: SET_NAV drops `phone` (alias → `notifications`, now "Notifications & phone") and adds
  `help` ("Help & updates": updates, debug, whatsnew; alias `app` → `help` so update links land
  there). `jobs` tabs: Sources | `limits` "When & how much" | Last search (`schedule` → `limits`).
  `mail` has no tabs.
- Career: `#cvs/coach` redirects to `#cvs/career`; `renderCoachPart()` (app-calendar.js) fills
  `#coachPart` under `#pathsPart`. `careerSeg()` is a jump row.
- Insights: `resultsTab` ('do' | 'numbers'), `[data-rtab]` blocks, action `resultsTab`.
- People: `#people` (Queue tab, `queueTabs('people')`) shows what was Inbox → Recruiters;
  `#inbox/recruiters` and `#recruiters` redirect. `inboxTabs()` returns ''.
- **Certificate files**: `<files>/Certificates/` (`cert_files`, `add_cert_file`, `remove_cert_file`,
  `cert_mime` in pipeline/tailoring.rs); POST `/api/settings/cert-file?filename=` (raw body) and
  `/api/settings/cert-file-remove`; `cert_files` in GET settings. `fill::answers` gives the next
  one to each file box whose label/section says certif/licen.
- **Zoho Recruit, from the second report** (DOM seen in Copy details): labels are
  `#crc-label-rec-form_<id>` (`rowLabel` looks these up from the box's ancestors' ids first);
  skill suggestions are `#competencySkillsSuggestedList li[role=button][aria-label^="Add skill : "]`
  (`options()` / `optName`); `fill::answers` skips a CV-reader upload box (label/section says
  autofill / easyresume) when another box takes the CV. Not yet handled, DOM unknown: the level
  on each skill tag, lyte dropdowns (salutation, phone country code, the Duration months/years in
  Education and Experience rows). `diag.now` in Copy details records `skills-tag` and any open
  popover for that.
