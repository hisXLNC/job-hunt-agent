# Handoff

Where Job Hunt stands, how to release it, and what's open. Read with `CLAUDE.md` (the release rules)
and `DEVELOPING.md`.

## State

- Latest version: **2.43.0** (a job beside the Pipeline list, chips in Me, the extension reworked).
  The working branch changes with each session (this one: `claude/brave-fermat-ti1omi`); `main` is
  what's released. Before it: 2.42.0 (the Queue and the top bar), 2.41.0, 2.40.0, 2.39.0 (skills).
- The Queue is a **list by default** (the user asked: every listing, with One by one as an option):
  `queueView()` reads `jh.queueView`; the list is `stepHtml` for each step that has something.
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
