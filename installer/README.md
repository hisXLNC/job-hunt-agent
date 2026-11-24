# Releasing Job Hunt for Windows

A release is made by GitHub, not by hand:

1. Put the new version in `VERSION` and describe it at the top of `CHANGELOG.md`.
2. Commit and push to `redesign`.

`.github/workflows/release.yml` then builds the program and the installer on Windows, runs the
tests there, installs it, starts it, updates over a running copy, removes it, scans it with
Windows Defender, and only then publishes release `v<version>` with `JobHunt3-Setup.exe`.
A version that is already published is never built again.

Running copies check once a day for a newer release and show a download link.

## The icon

`installer/logo.svg` is the logo and `jobhunt.ico` the same picture in the sizes Windows wants.
To put the icon inside the program after changing it:

    cd installer && x86_64-w64-mingw32-windres --use-temp-file --preprocessor=cat -O coff -o ../cmd/jobhunt/rsrc_windows_amd64.syso jobhunt.rc

The result is checked in, so this is only needed when the icon changes.
