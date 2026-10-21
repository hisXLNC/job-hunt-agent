"""Versions and releases. Job Hunt follows Semantic Versioning (https://semver.org), MAJOR.MINOR.PATCH:

    MAJOR  a change that needs your action or can't be undone by going back a version: data an older
           Job Hunt can't open, a removed feature, a sign-in or setup you must redo.
    MINOR  new features, backward compatible (most releases).
    PATCH  fixes only, nothing new.

static/changelog.json is the single source of truth: its newest entry is the version. Every other
place that carries a version (desktop/src-tauri/Cargo.toml and tauri.conf.json, core/Cargo.toml, the
Cargo.lock files, CHANGELOG.md) is kept in step by these commands, and the build refuses to publish
when they disagree. The build tags each published release vX.Y.Z in this repository.

To release:

    python tools/release_ci.py bump minor "Title" "First change." "Second change."
    python tools/release_ci.py bump patch "Fixes" "What was fixed."
    python tools/release_ci.py verify      # must pass; then commit and push to main

`verify` runs what the builds depend on and stops at the first failure: versions in step, the page
scripts parse, every core test passes, the server and the Windows app compile. The pre-push hook in
.githooks runs it before anything is pushed to main (git config core.hooksPath .githooks).

Other commands:

    python tools/release_ci.py check              # versions valid, ordered and in step (the build runs this)
    python tools/release_ci.py verify [--quick]   # everything the builds need (--quick: skip the Windows app)
    python tools/release_ci.py sync               # write the newest version everywhere, regenerate CHANGELOG.md
    python tools/release_ci.py version            # print the version (the build)
    python tools/release_ci.py manifest SETUP OUT  # write latest.json for the signed installer SETUP
"""
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "desktop", "src-tauri")
RELEASES = "hisXLNC/job-hunt-releases"


def log():
    with open(os.path.join(ROOT, "static", "changelog.json"), encoding="utf-8") as f:
        return json.load(f)


SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CHANGELOG_MD = os.path.join(ROOT, "CHANGELOG.md")
CHANGELOG_JSON = os.path.join(ROOT, "static", "changelog.json")


def semver(v):
    """1.8.0 as is; an old-style "1.07" becomes 1.7.0."""
    parts = v.split(".")
    if len(parts) == 2:
        return f"{int(parts[0])}.{int(parts[1])}.0"
    return ".".join(str(int(x)) for x in parts[:3])


def key(v):
    return tuple(int(x) for x in v.split("."))


def read(path):
    # Windows checkouts may have CRLF line endings; compare and edit with plain newlines.
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# Every file that carries the version, how to read it and how to set it.
def _toml_get(path):
    m = re.search(r'(?m)^version = "([^"]+)"', read(path))
    return m.group(1) if m else None


def _toml_set(path, v):
    write(path, re.sub(r'(?m)^version = "[^"]+"', f'version = "{v}"', read(path), count=1))


def _lock_get(path, name):
    m = re.search(r'name = "' + re.escape(name) + r'"\nversion = "([^"]+)"', read(path))
    return m.group(1) if m else None


def _lock_set(path, name, v):
    write(path, re.sub(r'(name = "' + re.escape(name) + r'"\nversion = )"[^"]+"', lambda m: f'{m.group(1)}"{v}"', read(path)))


def _conf_get(path):
    return json.loads(read(path)).get("version")


def _conf_set(path, v):
    c = json.loads(read(path))
    c["version"] = v
    write(path, json.dumps(c, indent=2, ensure_ascii=False) + "\n")


PLACES = [
    ("desktop/src-tauri/Cargo.toml", _toml_get, _toml_set),
    ("desktop/src-tauri/tauri.conf.json", _conf_get, _conf_set),
    ("core/Cargo.toml", _toml_get, _toml_set),
    ("desktop/src-tauri/Cargo.lock", lambda p: _lock_get(p, "jobhunt"), lambda p, v: _lock_set(p, "jobhunt", v)),
    ("desktop/src-tauri/Cargo.lock", lambda p: _lock_get(p, "jobhunt-core"), lambda p, v: _lock_set(p, "jobhunt-core", v)),
    ("core/Cargo.lock", lambda p: _lock_get(p, "jobhunt-core"), lambda p, v: _lock_set(p, "jobhunt-core", v)),
]


def set_version(v):
    for rel, _, put in PLACES:
        put(os.path.join(ROOT, rel), v)


def changelog_md(entries):
    """CHANGELOG.md in the Keep a Changelog layout (https://keepachangelog.com), from changelog.json."""
    out = [
        "# Changelog",
        "",
        "All notable changes to Job Hunt. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)",
        "and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
        "This file is generated from `static/changelog.json` by `python tools/release_ci.py sync`; edit that file instead.",
        "",
    ]
    for e in entries:
        out.append(f"## [{e['version']}] - {e.get('date', '')}".rstrip(" -"))
        out.append("")
        out.append(f"{e['title']}.")
        out.append("")
        for kind, heading in (("changes", "Changed"), ("added", "Added"), ("fixed", "Fixed"), ("removed", "Removed")):
            items = e.get(kind) or []
            if items:
                out.append(f"### {heading if kind != 'changes' else 'Changes'}")
                out.append("")
                out.extend(f"- {c}" for c in items)
                out.append("")
    for e in entries:
        out.append(f"[{e['version']}]: https://github.com/{RELEASES}/releases/tag/v{e['version']}")
    return "\n".join(out) + "\n"


def problems():
    """Everything wrong with the versions, as messages; empty when all is well."""
    out = []
    entries = log()
    seen = set()
    for i, e in enumerate(entries):
        v = e.get("version", "")
        where = f"changelog.json entry {i + 1} ({v or 'no version'})"
        if not SEMVER.match(v):
            out.append(f"{where}: the version must be MAJOR.MINOR.PATCH, like 1.16.0")
            continue
        if v in seen:
            out.append(f"{where}: {v} is listed twice")
        seen.add(v)
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", e.get("date", "")):
            out.append(f"{where}: needs a date like 2026-10-15")
        if not e.get("title", "").strip():
            out.append(f"{where}: needs a title")
        if not any(e.get(k) for k in ("changes", "added", "fixed", "removed")):
            out.append(f"{where}: needs at least one change")
        if i + 1 < len(entries) and SEMVER.match(entries[i + 1].get("version", "")) and key(v) <= key(entries[i + 1]["version"]):
            out.append(f"{where}: must be newer than the entry below it ({entries[i + 1]['version']}); newest first")
    if out:
        return out
    top = entries[0]["version"]
    for rel, get, _ in PLACES:
        have = get(os.path.join(ROOT, rel))
        if have != top:
            out.append(f"{rel} says {have}, but the newest changelog entry is {top}. Run: python tools/release_ci.py sync")
    if not os.path.exists(CHANGELOG_MD) or read(CHANGELOG_MD) != changelog_md(entries):
        out.append("CHANGELOG.md is out of date. Run: python tools/release_ci.py sync")
    return out


def sync():
    entries = log()
    set_version(entries[0]["version"])
    write(CHANGELOG_MD, changelog_md(entries))


def bump(part, title, changes):
    entries = log()
    major, minor, patch = key(entries[0]["version"])
    v = {"major": f"{major + 1}.0.0", "minor": f"{major}.{minor + 1}.0", "patch": f"{major}.{minor}.{patch + 1}"}[part]
    entry = {"version": v, "date": dt.date.today().isoformat(), "title": title, "changes": changes}
    text = read(CHANGELOG_JSON)
    # Keep the file's own layout: the new entry goes in at the top, written the same way.
    block = json.dumps(entry, indent=2, ensure_ascii=False).replace("\n", "\n  ")
    write(CHANGELOG_JSON, text.replace("[\n", "[\n  " + block + ",\n", 1))
    sync()
    return v


# Mail providers people use for themselves: an address at one of these in the code is someone's real
# email, which a public repository must never hold. Examples use example.com and the like.
PERSONAL_MAIL = ("gmail.com", "googlemail.com", "hotmail.", "outlook.", "live.com", "msn.com", "yahoo.", "icloud.com",
                 "me.com", "aol.com", "proton.me", "protonmail.", "gmx.", "mail.ru", "yandex.")


def personal_details():
    """Personal email addresses in the tracked files (the repository is public), as "file:line: address"."""
    import subprocess
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    found = []
    for f in files:
        if f.endswith((".png", ".ico", ".icns", ".lock", ".svg", ".zip", ".docx", ".pdf")):
            continue
        try:
            text = open(os.path.join(ROOT, f), encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for addr in re.findall(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})", line):
                if any(addr.lower() == d or addr.lower().startswith(d) or addr.lower().endswith("." + d) for d in PERSONAL_MAIL):
                    found.append(f"{f}:{n}: an address at {addr} (use one at example.com)")
    return found


def verify(quick=False):
    """Run each check in turn; stop at the first that fails, with its output. True if all passed."""
    import glob
    import subprocess
    node = "node"
    steps = [("Versions in step", None, None), ("No personal details in the code", "personal", None)]
    scripts = sorted(glob.glob(os.path.join(ROOT, "static", "*.js"))) + [os.path.join(ROOT, "core", "src", "fill.js")]
    steps += [(f"Page script {os.path.relpath(f, ROOT)} parses", [node, "--check", f], ROOT) for f in scripts if os.path.exists(f)]
    steps += [
        ("Core tests pass", ["cargo", "test", "-q", "--manifest-path", "core/Cargo.toml"], ROOT),
        ("Server compiles", ["cargo", "build", "-q", "--manifest-path", "core/Cargo.toml", "--bin", "jobhunt-server"], ROOT),
    ]
    if not quick:
        steps.append(("Windows app compiles", ["cargo", "check", "-q", "--manifest-path", "desktop/src-tauri/Cargo.toml"], ROOT))
    env = dict(os.environ, CARGO_TERM_COLOR="never")
    for name, cmd, cwd in steps:
        if cmd is None or cmd == "personal":
            bad = problems() if cmd is None else personal_details()
            ok, out = not bad, "\n".join(bad)
        else:
            try:
                r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
                ok, out = r.returncode == 0, (r.stdout + r.stderr)
            except FileNotFoundError as e:
                ok, out = False, f"{cmd[0]} isn't installed ({e})"
        print(f"{'ok  ' if ok else 'FAIL'}  {name}", flush=True)
        if not ok:
            lines = [l for l in out.splitlines() if l.strip()]
            # The useful part: failing tests and errors, else the end.
            keep = [l for l in lines if re.search(r"panicked|FAILED|^error|^---- |assertion|left:|right:|SyntaxError", l)] or lines[-25:]
            print("\n".join("      " + l for l in keep[:40]))
            return False
    return True


def main():
    # Windows runners print in cp1252, which can't write characters like "→" in the changelog.
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        bad = problems()
        for p in bad:
            print(f"::error::{p}" if os.environ.get("GITHUB_ACTIONS") else p)
        if bad:
            sys.exit(1)
        print(f"Versions are in step at {log()[0]['version']}.")
        return
    if cmd == "verify":
        if not verify(quick="--quick" in sys.argv):
            sys.exit("Not ready to release: fix the failure above first.")
        print(f"Ready to release {log()[0]['version']}.")
        return
    if cmd == "sync":
        sync()
        print(f"Set {log()[0]['version']} everywhere and regenerated CHANGELOG.md.")
        return
    if cmd == "bump":
        if len(sys.argv) < 5 or sys.argv[2] not in ("major", "minor", "patch"):
            sys.exit('usage: release_ci.py bump major|minor|patch "Title" "Change." ["Change." ...]')
        print(bump(sys.argv[2], sys.argv[3], sys.argv[4:]))
        return
    top = log()[0]
    v = semver(top["version"])
    if cmd == "version":
        print(v)
    elif cmd == "manifest":
        setup, out = sys.argv[2], sys.argv[3]
        with open(setup + ".sig", encoding="utf-8") as f:
            sig = f.read().strip()
        notes = f"{top['title']}\n\n" + "\n".join(f"- {c}" for c in top["changes"])
        manifest = {
            "version": v,
            "notes": notes,
            # The app lists every version newer than the installed one, so recent history travels along.
            "history": log()[:12],
            "pub_date": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "platforms": {"windows-x86_64": {"signature": sig, "url": f"https://github.com/{RELEASES}/releases/download/v{v}/{os.path.basename(setup)}"}},
        }
        with open(out, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"wrote {out} for {v}")
    elif cmd == "title":
        print(f"Job Hunt {top['version']}: {top['title']}")
    elif cmd == "notes":
        print(f"{top['title']}\n\n" + "\n".join(f"- {c}" for c in top["changes"]))


if __name__ == "__main__":
    main()
