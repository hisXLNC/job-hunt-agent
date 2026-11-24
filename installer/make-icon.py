"""Draws Job Hunt's icon (the blue tile with a J) and writes installer/jobhunt.ico.

    python3 installer/make-icon.py

installer/README.md says how the icon gets inside the Windows program.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf", "/Library/Fonts/Arial Bold.ttf"]


def tile(size):
    big = size * 4
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 9 // 32, fill=(0x2F, 0x4F, 0xC4, 255))
    font = ImageFont.truetype(next(f for f in FONTS if os.path.exists(f)), big * 19 // 32)
    box = d.textbbox((0, 0), "J", font=font)
    d.text(((big - (box[2] - box[0])) / 2 - box[0], (big - (box[3] - box[1])) / 2 - box[1]), "J", font=font, fill="white")
    return img.resize((size, size), Image.LANCZOS)


sizes = [256, 64, 48, 32, 24, 16]
imgs = [tile(s) for s in sizes]
imgs[0].save(os.path.join(HERE, "jobhunt.ico"), format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[1:], bitmap_format="bmp")
