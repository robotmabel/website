"""Duotone halftones for the Shop-to-street grid (index.html #notes).

Each toned still gets a printed-dot twin, `<name>-ht.png` (6-colour palette, ~120 kB): dot area tracks
darkness, ink on the tone colour, on a 4:3 crop of the original. The page shows
the twin and cross-fades to the photograph on hover. Re-run after replacing a
photo:  python3 scripts/build_halftones.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1] / 'assets/wild'
INK = (0x15, 0x18, 0x20)
TONES = {'red': (0xE4, 0x44, 0x2A), 'yellow': (0xF2, 0xC9, 0x4C), 'blue': (0x23, 0x57, 0x7E)}
JOBS = {'w-bench': 'red', 'w-shop': 'yellow', 'w-typing': 'blue', 'w-night': 'red', 'm-dusk': 'yellow'}
W, H, CELL, SS = 960, 720, 9, 3          # output size, dot pitch (px), supersampling


def crop43(im):
    w, h = im.size
    if w / h > 4 / 3:
        nw = int(h * 4 / 3); return im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = int(w * 3 / 4); return im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))


for name, tone in JOBS.items():
    src = ImageOps.exif_transpose(Image.open(ROOT / f'{name}.jpg')).convert('L')
    g = ImageOps.autocontrast(crop43(src).resize((W // CELL, H // CELL), Image.LANCZOS), cutoff=2)
    out = Image.new('RGB', (W * SS, H * SS), TONES[tone])
    d = ImageDraw.Draw(out)
    for y in range(g.height):
        for x in range(g.width):
            dark = 1 - g.getpixel((x, y)) / 255
            r = (dark ** 0.5) * CELL * SS * 0.62
            if r > 0.4 * SS:
                cx, cy = (x + 0.5) * CELL * SS, (y + 0.5) * CELL * SS
                d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=INK)
    out = out.resize((720, 540), Image.LANCZOS).quantize(colors=6, method=Image.MEDIANCUT, dither=Image.NONE)
    out.save(ROOT / f'{name}-ht.png', optimize=True)
    print('wrote', f'{name}-ht.png', tone)
