"""The paper's exploded CAD view, cut out of its white background.

papers/iros2026_late_breaking_results/figures/exploded.png is the real labelled
CAD drawing — colour-coded by subsystem, every actuator named. It is a better
figure than anything generated from the MJCF, and it belongs on the hardware
page. What it does not belong on is a white rectangle in the middle of a
cream-coloured site.

FLOOD FILL FROM THE EDGES, NOT "EVERY WHITE PIXEL". The robot is full of white
— the hand shells, the lift column, the gaps between leader lines. Keying out
every pixel near white punches holes straight through it. Only the white that
is CONNECTED TO THE BORDER is background, so the cut is a flood fill inward
from the frame, with a soft edge so the antialiased outlines do not turn into
a jagged stencil.

    python3 scripts/build_exploded.py

Writes: assets/hw/exploded.png (RGBA, transparent ground)
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
ROOT = os.path.dirname(SITE)
SRC = os.path.join(ROOT, "papers", "iros2026_late_breaking_results",
                   "figures", "exploded.png")
OUT = os.path.join(SITE, "assets", "hw", "exploded.png")

#: how close to white counts as background, per channel (0-255)
TOL = 18
#: it displays at 780 px, so 1180 covers a 1.5x screen and most of a 2x one.
#: The full 1218 px original is a 964 kB PNG for a figure nobody zooms into.
MAXW = 1180


def flood_background(a, tol=TOL):
    """Mask of the white region CONNECTED TO THE BORDER, scanline flood fill."""
    h, w = a.shape[:2]
    near_white = (a[:, :, :3].min(axis=2) >= 255 - tol)
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def main():
    if not os.path.exists(SRC):
        print(f"missing {SRC}")
        return 1
    im = Image.open(SRC).convert("RGBA")
    if im.width > MAXW:
        im = im.resize((MAXW, round(im.height * MAXW / im.width)), Image.LANCZOS)
    a = np.asarray(im).copy()
    bg = flood_background(a)
    pct = 100.0 * bg.mean()
    print(f"{im.size[0]}x{im.size[1]}  background {pct:.1f}% of the frame")
    if pct < 8 or pct > 80:
        print("*** that is not a background — refusing to write "
              "(the fill either found nothing or ate the drawing)")
        return 1

    # SOFT EDGE. A hard mask leaves the antialiased CAD outlines fringed with
    # the white they were drawn against, which on a cream page reads as a halo
    # around every line. Blurring the alpha a little and pulling it in one
    # pixel keeps the lines dark to their edge.
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    am = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.7))
    am = am.point(lambda v: 0 if v < 90 else min(255, int(v * 1.25)))
    a[:, :, 3] = np.asarray(am)

    # DROP THE STRAY BITS AND CROP TO THE DRAWING. The source carries two
    # short crop marks off the left edge — 8 opaque pixels in a column, against
    # thousands in the drawing — which survive the fill as two floating dashes.
    # Any column or row holding fewer than 1.5% of the frame's pixels is not
    # part of the figure. (0.4% was too lax: the marks are 8 px of a 1500 px
    # column, which is 0.53% and survived.)
    keep = np.asarray(am) > 8
    h, w = keep.shape
    col_ok = keep.sum(axis=0) > 0.015 * h
    row_ok = keep.sum(axis=1) > 0.015 * w
    if col_ok.any() and row_ok.any():
        x0, x1 = np.where(col_ok)[0][[0, -1]]
        y0, y1 = np.where(row_ok)[0][[0, -1]]
        pad = 8
        x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
        x1 = min(w - 1, x1 + pad); y1 = min(h - 1, y1 + pad)
        print(f"   cropped to {x1-x0+1}x{y1-y0+1} "
              f"(dropped {x0} px left, {w-1-x1} right)")
        a = a[y0:y1 + 1, x0:x1 + 1]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # QUANTIZE. This is flat-shaded CAD line art in about a dozen fill colours,
    # and a truecolour PNG of it is 1 MB for no benefit. A 128-colour adaptive
    # palette with the alpha carried through is visually identical at the size
    # it is displayed and about a fifth the bytes.
    im2 = Image.fromarray(a, "RGBA")
    q = im2.convert("RGB").quantize(colors=128, method=Image.MEDIANCUT,
                                    dither=Image.NONE).convert("RGBA")
    q.putalpha(im2.getchannel("A"))
    q.save(OUT, optimize=True)
    if os.path.getsize(OUT) > 0.9 * len(a.tobytes()) / 4:
        im2.save(OUT, optimize=True)          # quantizing did not help; keep it
    # AND A WEBP BESIDE IT, at the SAME pixel dimensions. The PNG is still
    # ~840 kB after quantizing, and it was the single heaviest thing on
    # hardware.html — 843 of the page's 1207 kB, in the load window, because
    # `loading="lazy"` is advisory and Chrome fetched it anyway. WebP with
    # alpha is about a quarter of that with no loss of resolution, which is
    # what was actually asked for: keep it high-res, make the page fast.
    # The page serves them through <picture>, so the PNG stays the fallback.
    webp = os.path.splitext(OUT)[0] + ".webp"
    im2.save(webp, "WEBP", quality=88, method=6)

    kb = os.path.getsize(OUT) / 1024
    wkb = os.path.getsize(webp) / 1024
    kept = 100.0 * (np.asarray(am) > 8).mean()
    print(f"wrote {os.path.relpath(OUT, SITE)}  {kb:.0f} kB "
          f"(+ {os.path.basename(webp)} {wkb:.0f} kB), "
          f"{kept:.1f}% of pixels kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
