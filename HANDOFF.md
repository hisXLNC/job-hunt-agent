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
