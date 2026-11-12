"""Click through Job Hunt's screens in a real browser (see tools/screen_test.js).

    python tools/screen_test.py

Starts the developer preview (core/examples/dev_server.rs) on a fresh folder with a small sample CV,
runs the click-through, and stops the preview. Needs Node with Playwright and its Chromium; exits 2
(skipped) when they aren't there, 1 when a check fails, 0 when the screens work.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "http://127.0.0.1:8790"

CV = ["Sam Rivera", "Toronto, ON · sam@example.com", "Summary",
      "Program delivery lead with twelve years running regulated platform programmes in banking and payments.",
      "Experience", "Senior Program Manager, Northbank, 2018 – present",
      "Led a payments platform migration across nine teams.", "Managed three system integrators and the vendor budget.",
      "Project Manager, Maple Insurance, 2012 – 2018", "Delivered claims modernisation on time.",
      "Education", "BSc Computer Science, 2011", "Skills", "Program management, Agile, vendor management, risk"]


def sample_cv(path):
    """A small Word file, written by hand so nothing needs installing."""
    esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;")
    body = "".join(f"<w:p><w:r><w:t>{esc(t)}</w:t></w:r></w:p>" for t in CV)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   f"<w:body>{body}</w:body></w:document>")


def up():
    try:
        return urllib.request.urlopen(URL, timeout=2).status == 200
    except Exception:
        return False


def main():
    if subprocess.run(["node", "-e", "require('playwright')"], cwd=ROOT, capture_output=True).returncode != 0:
        print("skipped: Node with Playwright isn't installed here")
        return 2
    if up():
        print(f"skipped: something is already running on {URL}")
        return 2
    build = subprocess.run(["cargo", "build", "-q", "--manifest-path", "core/Cargo.toml", "--example", "dev_server"], cwd=ROOT, capture_output=True, text=True)
    if build.returncode != 0:
        print(build.stderr[-2000:])
        return 1
    tmp = tempfile.mkdtemp(prefix="jobhunt-screens-")
    cv = os.path.join(tmp, "cv.docx")
    sample_cv(cv)
    server = subprocess.Popen([os.path.join(ROOT, "core", "target", "debug", "examples", "dev_server"), os.path.join(tmp, "data"), cv],
                              cwd=os.path.join(ROOT, "core"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            if up() or server.poll() is not None:
                break
            time.sleep(0.5)
        if not up():
            print("FAIL  the preview didn't start")
            return 1
        return subprocess.run(["node", "tools/screen_test.js", URL], cwd=ROOT).returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except Exception:
            server.kill()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
