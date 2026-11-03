# Archive

Kept for reference; not built or published any more.

- `server/`: the Synology NAS / Docker and Oracle Cloud version (ghcr.io/hisxlnc/job-hunt-server).
  Its image stopped being built after 2.11.0, the last published version. The program itself
  (`core/src/bin/jobhunt-server.rs`) is still in the code and still compiled by
  `tools/release_ci.py verify`, so it can be brought back. To publish images again, move
  `server/server-image.yml` back to `.github/workflows/` and restore the `server-image` job in
  `.github/workflows/checks.yml`.
