#!/usr/bin/env python3
"""Every build cost the site quotes must be the one the bill of materials produces.

The pages said "from $8,722" and "$9,670 as built" for a while after the BOM
had moved on (and the paper's robot was never the $9,670 build: it carries a
Jetson Thor). This reads BOM/generated/bom_summary.json and checks that the
figures the pages quote — the "From $" on the front page, the "$E – $M BOM"
range on the hardware page, every "recommended build" figure — are the current
Essential, Recommended and Maximum totals, and that no page still carries a
figure from the stale list below.

    python scripts/bomclaims.py
"""
import json, pathlib, re, sys

SITE = pathlib.Path(__file__).resolve().parent.parent
REPO = SITE.parent
STALE = ["8,722", "9,670", "8,464", "9,691", "15,129", "8,058"]      # totals the BOM used to produce; add to this when one changes

def main() -> int:
    d = json.loads((REPO / "BOM" / "generated" / "bom_summary.json").read_text())
    B = {b["id"]: f"{round(b['total']):,}" for b in d["builds"]}
    E, R, M = B["essential"], B["recommended"], B["maximum"]
    bad = 0
    def check(ok, msg):
        nonlocal bad
        print(("  ✓ " if ok else "  ✗ ") + msg); bad += 0 if ok else 1
    pages = {p.name if p.parent == SITE else f"docs/{p.name}": p.read_text()
             for p in list(SITE.glob("*.html")) + list((SITE / "docs").glob("*.html"))}
    # Figures also hide in scripts and data: the wiki hub's card, the community
    # blurb, a comic pop-up's SVG. Every text file under the site except the
    # vendored three.js is scanned for the stale list.
    for p in list(SITE.rglob("*.js")) + list(SITE.rglob("*.json")) + list(SITE.rglob("*.svg")):
        rel = str(p.relative_to(SITE))
        if rel.startswith("assets/three/") or rel.startswith("scripts/"):
            continue
        s = p.read_text(errors="ignore")
        for st in STALE:
            if "$" + st in s:
                check(False, f"{rel}: stale ${st}")
    for name, s in pages.items():
        for st in STALE:
            check(("$" + st) not in s, f"{name}: no stale ${st}")
        if name in ("index.html", "hardware.html") or name.startswith("docs/"):   # the store's "From $15,000" is a kit price, not a build
            for m in re.finditer(r"From\s*(?:</span><b>)?\$([0-9,]{5,6})", s):
                check(m.group(1) == E, f"{name}: 'From ${m.group(1)}' is the Essential build (${E})")
        for m in re.finditer(r"\$([0-9,]{5,6}) (?:–|-|&ndash;) \$([0-9,]{5,6}) BOM", s):
            check((m.group(1), m.group(2)) == (E, M), f"{name}: BOM range ${m.group(1)}–${m.group(2)} is Essential–Maximum")
        for m in re.finditer(r"\$([0-9,]{5,6})[^<]{0,40}recommended build", s):
            check(m.group(1) == R, f"{name}: recommended-build figure ${m.group(1)} is ${R}")
        check(" as built" not in s or "$" + R + " as built" not in s, f"{name}: the Recommended build is not called 'as built'")
    check("$" + E in pages["index.html"] and "$" + E in pages["hardware.html"], f"the front and hardware pages quote the Essential build ${E}")
    # the stats strip abbreviates: <span class="counter" data-target="8.5">0</span><span class="unit">k USD</span>
    ek = f"{[b['total'] for b in d['builds'] if b['id'] == 'essential'][0] / 1000:.1f}"
    for name, s in pages.items():
        for m in re.finditer(r'data-target="([0-9.]+)">0</span><span class="unit">k USD', s):
            check(m.group(1) == ek, f"{name}: the 'k USD' stat is {m.group(1)}, the Essential build is {ek}")
    print("RESULT: PASS" if not bad else f"RESULT: FAIL ({bad})")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
