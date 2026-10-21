# Working on Job Hunt

For people changing the code. Using Job Hunt? See [README.md](README.md).

- `core/` is all the logic, in Rust, with its tests: sources, filters, scoring and tailoring
  prompts (`claude.rs`), Word CV editing (`cv.rs`), Gmail and Calendar (`google.rs`), the
  pipeline, and the API the window calls (`api.rs`). It needs no window libraries:
  `cd core && cargo test`.
- `desktop/src-tauri/` is the Windows app (Tauri 2): window, tray, notifications, start at sign-in
  and the private `jobhunt://` address.
- `static/` holds the screens (HTML, CSS, JavaScript).
- `cargo run --example dev_server -- preview-data path/to/cv.docx` (run in `core/`) serves the
  screens at http://127.0.0.1:8790 with sample data and a stand-in for Claude, for working on the
  UI without Windows.
- `python tools/make_icons.py` renders `brand/jobhunt-mark.svg` into the app icons.
- Pushing to `main` runs `.github/workflows/build.yml` on Windows. It tests the core, builds the
  installer, starts the app to check it runs, scans with Defender, and publishes
  `JobHunt-Setup.exe` as the latest release.
- **Versions** follow [Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH. MINOR for new
  features (most releases), PATCH for fixes only, MAJOR for a change that needs the user's action or
  can't be undone by going back (data an older version can't open, a removed feature, a sign-in to
  redo). `static/changelog.json` is the single source of truth; the Cargo and Tauri files, the lock
  files and `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com) format) follow it.
- **Releasing an update:** run `python tools/release_ci.py bump minor "Title" "Change." "Change."`
  (or `patch` / `major`), commit and push to `main`. It adds the changelog entry with today's date
  and sets the version everywhere. The build first runs `python tools/release_ci.py check`, which
  fails on a malformed or out-of-order version or any file out of step. It then signs the installer
  with the `TAURI_SIGNING_PRIVATE_KEY` secret and publishes it with `latest.json` to the public
  `hisXLNC/job-hunt-releases` repo (using the `RELEASES_TOKEN` secret), where installed copies find
  it, and tags the commit `vX.Y.Z` here. A version is published once: pushing again without a new
  version rebuilds and tests but doesn't publish. Without those secrets the build still works but
  isn't offered as an update.

## How it talks to Claude

Through Claude Code, every request runs `claude -p` hidden in an empty folder, with tools, MCP
servers and session history switched off, and asks for schema-checked JSON (`--json-schema`).
Each new posting that passes the filters is one scoring request, and each tailored application
one more. "Most new postings scored per search" (default 40) keeps a big search from using up
your plan's limits. With an API key, calls go to `claude-opus-5-5` by default.
