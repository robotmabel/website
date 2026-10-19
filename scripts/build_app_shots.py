#!/usr/bin/env python3
"""Annotated app screenshots for teleop.html's tab reels.

Source of truth: scripts/app_shots.json — for each app (studio, vp, ios) a list of
cards, each a real screenshot plus numbered pins placed on its controls
({n, x, y} in % of the image) and the matching one-line explanations.

    python3 scripts/build_app_shots.py --src <dir with <app>/<slug>.png>   # re-encode images + HTML
    python3 scripts/build_app_shots.py                                      # HTML only

Images land in assets/appshots/<app>-<slug>.jpg: re-encoded from pixels (no EXIF or
other metadata survives), capped in width. The cards are written between the
<!-- appshots:<app> --> … <!-- /appshots:<app> --> markers in teleop.html.
"""
import argparse
import html
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "app_shots.json"
OUT = ROOT / "assets" / "appshots"
PAGE = ROOT / "teleop.html"
MAX_W = {"browser": 1600, "glass": 1600, "phone": 900, "phone land": 1400}


def encode(src: Path, dst: Path, frame: str) -> tuple[int, int]:
    im = Image.open(src).convert("RGB")
    cap = MAX_W.get(frame, 1400)
    if im.width > cap:
        im = im.resize((cap, round(im.height * cap / im.width)), Image.LANCZOS)
    clean = Image.frombytes("RGB", im.size, im.tobytes())   # pixels only, no metadata
    clean.save(dst, "JPEG", quality=84, optimize=True, progressive=True)
    return clean.size


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def card(app: str, i: int, c: dict, size: tuple[int, int]) -> str:
    w, h = size
    side = w / h < 1.4          # not a wide screen: shot beside its legend, not above it
    frame = c.get("frame", "browser")
    img = f"assets/appshots/{app}-{c['slug']}.jpg"
    pins = "".join(
        f'<button type="button" class="shot-pin" data-n="{p["n"]}" style="left:{p["x"]:.1f}%;top:{p["y"]:.1f}%" '
        f'aria-label="{p["n"]}: {esc(p["label"])}">{p["n"]}</button>'
        for p in c["hotspots"])
    items = "".join(
        f'<li data-n="{p["n"]}"><span><b>{esc(p["label"])}</b>: {esc(p["what"])}</span></li>'
        for p in c["hotspots"])
    return (
        f'<figure class="trl-card shot{" side" if side else ""}" data-tab="{esc(c["tab"])}" style="--ar:{w / h:.3f}">'
        f'<div class="shot-frame {frame}">'
        f'<img src="{img}" width="{w}" height="{h}" loading="lazy" decoding="async" alt="{esc(c["alt"])}" />'
        f'<div class="shot-pins">{pins}</div></div>'
        f'<figcaption><span class="trl-ix">{i:02d} · {esc(c["tab"].upper())}</span><h4>{esc(c["title"])}</h4>'
        f'<p class="trl-one">{esc(c["one"])}</p><ol>{items}</ol></figcaption></figure>')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, help="folder holding <app>/<slug>.png screenshots")
    a = ap.parse_args()
    spec = json.loads(SPEC.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    page = PAGE.read_text()
    for app, cards in spec.items():
        html_cards = []
        for i, c in enumerate(cards, 1):
            dst = OUT / f"{app}-{c['slug']}.jpg"
            if a.src:
                size = encode(a.src / app / f"{c['slug']}.png", dst, c.get("frame", "browser"))
            else:
                size = Image.open(dst).size
            html_cards.append(card(app, i, c, size))
        block = "\n      ".join(html_cards)
        pat = re.compile(rf"(<!-- appshots:{app} -->).*?(<!-- /appshots:{app} -->)", re.S)
        if not pat.search(page):
            raise SystemExit(f"teleop.html has no appshots:{app} markers")
        page = pat.sub(lambda m: f"{m.group(1)}\n      {block}\n      {m.group(2)}", page)
        print(f"{app}: {len(cards)} cards")
    PAGE.write_text(page)


if __name__ == "__main__":
    main()
