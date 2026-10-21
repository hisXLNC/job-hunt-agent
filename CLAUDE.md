# Working on Job Hunt

Every push to `main` builds and publishes a release (the Windows app, and the server image for
Oracle and NAS users). A broken push to main is a broken build people see, so:

## Before pushing to main

1. Bump the version: `python tools/release_ci.py bump minor|patch "Title" "Change." …`
   (Semantic Versioning; static/changelog.json is the source of truth).
2. Run `python tools/release_ci.py verify`. It must end with "Ready to release". It checks versions,
   that the page scripts parse, every core test, and that the server and the Windows app compile,
   and stops at the first failure. Never chain it with `|| true`, `| tail` or `| grep` in a way that
   hides its exit code.
3. When a change in behaviour makes an old test fail, update the test to the new behaviour on purpose
   (and say so in the commit); never release with a failing test.
4. Commit, push to the working branch, then to main.

The pre-push hook in `.githooks/pre-push` runs `verify` before any push to main. Turn it on in a fresh
clone with `git config core.hooksPath .githooks`.

## Builds, and GitHub's minutes

GitHub's monthly build minutes for this private repository are limited (Windows minutes count
double), and running out stops every build. So:

- Release in batches: collect changes on the working branch and push to main only as a release
  (a version bump). Pushes to main that don't change `static/changelog.json` build nothing.
- `build.yml` (Windows): a quick Linux job checks whether the version is already published (then it
  stops) and runs `verify --quick`; only then does the Windows build run and publish to
  hisXLNC/job-hunt-releases. A newer release cancels an older one still building.
- `checks.yml` runs only by hand (Actions → Checks → Run workflow); use it before changing
  `server/Dockerfile`, which can't be built locally here.
- `server-image.yml` publishes ghcr.io/hisxlnc/job-hunt-server. It cross-compiles the ARM program
  (no emulation), and a running build is never cancelled by a newer push.

## Disk

The build folders grow large in long sessions (`core/target` reached 19 GB). If a build fails with
"No space left on device", run `cargo clean` in `core` and `desktop/src-tauri`.
