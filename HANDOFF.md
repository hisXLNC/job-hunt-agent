# Handoff

Where Job Hunt stands, how to release it, and what's open. Read with `CLAUDE.md` (the release rules)
and `DEVELOPING.md`.

## State

- Latest version: **2.36.9** (on the working branch `claude/epic-knuth-urzr0g`; released once its
  checks pass and it's pushed to `main`). Last published before it: 2.36.8.
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
3. Commit (trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the session link),
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

## Testing the form filler

The Playwright mocks lived in the old session's scratchpad and are gone; rebuild as needed:
- Page tests: load `core/src/fill.js` with `__TOKEN__` → `'tok'` and `__JOB__` → a job object via
  `addInitScript`, route `https://jobhunt.invalid/**` to capture what it sends, then call
  `window.__jobhunt.fill({values, files})`.
- Extension tests: build the extension folder (static/extension + `fill.js` with `'__TOKEN__'` → `''`
  and `__JOB__` → `(window.__jobhuntExt || {title:'',company:''})`, `__JH_VERSION__` and the manifest
  version set to match), add `"<all_urls>"` to host_permissions for the test, launch with
  `launchPersistentContext('', { headless: false, args: ['--headless=new', --load-extension…] })`, run a
  mock bridge on 127.0.0.1:47613 (`/ext/ping` with the same version, `/ext/fill`), inject with
  `chrome.scripting.executeScript` from the service worker. Mock Workday widgets that accept only
  `isTrusted` clicks, slow searches (4 s) and `chrome.tabs.setZoom(tab, 0.8)` caught real bugs.

## Open / to watch

- Workday skills: rewritten for accuracy in 2.36.5 (settled results, best fit, shorter search,
  confirmed real click). Not yet confirmed by the user on the real site.
- Work Experience Add: fixed in 2.35.13–2.35.14 (button found by section heading; count from Claude's
  `_roles` list). Career transitions count as entries (2.36.1). Watch for over/under-adding.
- First "My Information" page: needs Address/Phone in the user's facts; City is now learned (2.36.3).
- Education From year: needs the school's years in facts ("American University of Kuwait: 2005 – 2009").
- Phone filling (bookmark) and Send to Job Hunt from the LinkedIn app (iOS Shortcut → `/m/add`):
  built and unit-tested, not yet tried by the user on a real phone.
- The Ryan "Manager, Tax Technology" LinkedIn posting wasn't picked up; LinkedIn now reads 4 pages.
  If it's still missing, check the skipped list's reason (location or age).
- The GitHub release notes for 2.36.8 show "5,000–15,000" (shell ate `$9`); the in-app changelog is fixed.
- Unanswered: build-time speedups (lighter LTO, parallel CI tests, skip the local Windows compile).
