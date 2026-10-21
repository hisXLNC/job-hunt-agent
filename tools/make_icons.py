"""Render brand/jobhunt-mark.svg into the app's icons (PNG sizes and a multi-size .ico).

    python tools/make_icons.py

Needs Chromium (or Chrome) for the SVG and Pillow for resizing. Run it after changing the mark.
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "desktop", "src-tauri", "icons")
BROWSERS = ["/opt/pw-browsers/chromium", "chromium", "chromium-browser", "google-chrome", "chrome"]


def render(size):
    browser = next((b for b in BROWSERS if shutil.which(b) or os.path.exists(b)), None)
    if not browser:
        sys.exit("Chromium or Chrome is needed to render the SVG.")
    tmp = tempfile.mkdtemp()
    page = os.path.join(tmp, "mark.html")
    svg = open(os.path.join(ROOT, "brand", "jobhunt-mark.svg"), encoding="utf-8").read()
    with open(page, "w", encoding="utf-8") as f:
        svg = svg.replace("<svg ", "<svg style='display:block;width:100%;height:100%' ", 1)
        f.write(f"<html><body style='margin:0;background:transparent'><div style='width:{size}px;height:{size}px'>{svg}</div></body></html>")
    out = os.path.join(tmp, "mark.png")
    subprocess.run([browser, "--headless", "--no-sandbox", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--window-size={size},{size + 300}", f"--screenshot={out}", f"file://{page}"], check=True, capture_output=True)
    # The visible area is shorter than the window, so render tall and crop the square.
    return Image.open(out).convert("RGBA").crop((0, 0, size, size))


def main():
    os.makedirs(ICONS, exist_ok=True)
    big = render(1024)
    for name, size in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]:
        big.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, name))
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(ICONS, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "static", "logo-256.png"))
    print("icons written to", ICONS)


if __name__ == "__main__":
    main()
