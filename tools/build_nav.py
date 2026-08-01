#!/usr/bin/env python3
"""Regenerate the site's navigation from one source of truth.

The site previously carried two different navs — index.html had a flat tab bar,
every other page had a dropdown nav — and they disagreed about which pages
existed (Build and Controller were missing from one, the BOM and every
subsystem page from the other). This script defines the information
architecture once and stamps the same header, mobile menu and section sidenav
onto every page.

    python3 tools/build_nav.py            # rewrite all pages
    python3 tools/build_nav.py --check    # verify, touch nothing (exit 1 on drift)

Add a page: put it in NAV below. Nothing else needs editing.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ── the information architecture ────────────────────────────────────────────
# (label, href, [(child label, child href), ...])  — children make it a dropdown.
NAV = [
    ("Overview", "index.html", []),
    ("Build", "build.html", [
        ("Overview", "build.html"),
        ("Bill of materials", "bom.html"),
        ("Hardware assembly", "assembly.html"),
        ("Wiring", "wiring.html"),
        ("Firmware", "firmware.html"),
    ]),
    ("Hardware", "hardware.html", [
        ("Overview", "hardware.html"),
        ("Hands", "hardware-hands.html"),
        ("Arms", "hardware-arms.html"),
        ("Base", "hardware-base.html"),
        ("Lift", "hardware-lift.html"),
        ("Body", "hardware-body.html"),
        ("Sensors", "hardware-sensors.html"),
        ("Electronics", "hardware-electronics.html"),
    ]),
    ("Software", "software.html", [
        ("Overview", "software.html"),
        ("ROS 2", "ros.html"),
        ("Server &amp; Bridge", "server.html"),
        ("Simulation", "simulation.html"),
    ]),
    ("Teleop", "teleop.html", [
        ("Overview", "teleop.html"),
        ("Retargeting", "retargeting.html"),
        ("Vision Pro", "teleop-visionpro.html"),
        ("iPhone", "teleop-ios.html"),
    ]),
    ("Controller", "controller.html", [
        ("Overview", "controller.html"),
        ("Whole-Body Control", "wbc.html"),
    ]),
    ("Navigation", "navigation.html", []),
    ("Autonomy", "autonomy.html", [
        ("Overview", "autonomy.html"),
        ("Data", "data.html"),
        ("Learning", "learning.html"),
    ]),
    ("Connect", "connect.html", []),
]

PAPER = '<a href="#" class="ext">Paper ↗</a>'
ON = ' class="on"'  # f-strings cannot contain backslashes, so escape it once here


def group_of(page: str):
    """Which top-level group a page belongs to, and that group's children."""
    for label, href, kids in NAV:
        if page == href or page in [k[1] for k in kids]:
            return label, href, kids
    return None, None, []


def desktop(page: str) -> str:
    out = []
    for label, href, kids in NAV:
        active = page == href or page in [k[1] for k in kids]
        if not kids:
            out.append(f'<a href="{href}"{ON if active else ""}>{label}</a>')
        else:
            items = "".join(
                f'<a href="{k[1]}"{ON if page == k[1] else ""}>{k[0]}</a>' for k in kids)
            out.append(
                f'<div class="nav-group{" on" if active else ""}">'
                f'<button type="button" class="nav-grp-btn" data-href="{href}">{label}'
                f'<span class="nav-caret">▾</span></button>'
                f'<div class="nav-menu">{items}</div></div>')
    return "\n    ".join(out + [PAPER])


def mobile(page: str) -> str:
    out = []
    for label, href, kids in NAV:
        if not kids:
            out.append(f'<a href="{href}">{label}</a>')
        else:
            out.append(f'<span class="mob-grp">{label}</span>')
            out += [f'<a class="sub" href="{k[1]}">{k[0]}</a>' for k in kids]
    return "".join(out + [PAPER])


def sidenav(page: str) -> str:
    """Section nav for pages that belong to a group with siblings."""
    label, _, kids = group_of(page)
    if not kids:
        return ""
    items = "".join(
        f'<a href="{k[1]}"{ON if page == k[1] else ""}>{k[0]}</a>' for k in kids)
    return (f'<aside class="sidenav" aria-label="{label} section navigation">\n'
            f'  <div class="sidenav-title">{label}</div>\n  {items}\n</aside>')


HEADER = """<header class="nav" id="nav">
  <a href="index.html" class="nav-logo"><span class="dot"></span> MABEL</a>
  <nav class="nav-links">
    {desktop}
  </nav>
  <button class="hbg" id="hbg" aria-label="Menu"><span></span><span></span><span></span></button>
</header>
<nav class="mob" id="mob">
  {mobile}
</nav>"""

# must span BOTH blocks: the header and the mobile menu that follows it.
# A lazy match to the first </nav> stops inside the header and shreds the page.
NAV_RE = re.compile(r'<header class="nav".*?</header>\s*<nav class="mob".*?</nav>\s*', re.S)
SIDE_RE = re.compile(r'<aside class="sidenav".*?</aside>\s*', re.S)


def render(page: str, text: str) -> str:
    block = HEADER.format(desktop=desktop(page), mobile=mobile(page))
    side = sidenav(page)
    if not NAV_RE.search(text):
        raise SystemExit(f"{page}: no <header class=\"nav\"> block found")
    text = NAV_RE.sub(lambda _: block + "\n\n", text, count=1)
    if SIDE_RE.search(text):
        text = SIDE_RE.sub(lambda _: (side + "\n\n") if side else "", text, count=1)
    elif side:
        text = text.replace(block + "\n\n", block + "\n\n" + side + "\n\n", 1)
    return text


def main():
    check = "--check" in sys.argv
    known = {href for _, href, _ in NAV} | {k[1] for _, _, kids in NAV for k in kids}
    on_disk = {p.name for p in ROOT.glob("*.html")}
    if missing := known - on_disk:
        raise SystemExit(f"NAV lists pages that do not exist: {sorted(missing)}")
    if extra := on_disk - known:
        raise SystemExit(f"pages exist but are in no nav (archive them or add to NAV): {sorted(extra)}")

    drift = []
    for name in sorted(on_disk):
        p = ROOT / name
        old = p.read_text()
        new = render(name, old)
        if new != old:
            drift.append(name)
            if not check:
                p.write_text(new)
    if check:
        print("nav drift:", drift or "none")
        sys.exit(1 if drift else 0)
    print(f"nav rebuilt on {len(drift)} of {len(on_disk)} pages")


if __name__ == "__main__":
    main()
