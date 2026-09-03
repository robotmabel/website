#!/usr/bin/env python3
"""The stylesheet's own structure — braces, and the class collisions.

Two defects this catches, both of which shipped:

1. A DANGLING SELECTOR LIST. `a, b, c,` followed by `}` is not an error the
   browser reports. CSS recovers by consuming whatever comes next until it
   finds a `{`, so the NEXT rule is silently eaten as part of the broken
   selector. `.burst.b-blast::before` lost its shape that way and nothing
   anywhere said so.

2. A SINGLE-WORD CONTAINER CLASS COLLIDING WITH A UTILITY CLASS. `.sm` was
   the stack map's card AND the burst's size modifier, so every small
   starburst on the site got a cream box, a 3 px border and an 8 px drop
   shadow behind it. This is the third time (`.rc-`, `.cl-view`, `.sm`), so
   it is now a test: any bare one- or two-character class that also appears
   as a utility on an element with other classes is reported.

    python scripts/csscheck.py
"""
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
CSS = os.path.join(SITE, "assets", "mabel.css")

#: Utility/modifier classes — ones that appear ALONGSIDE another class on an
#: element rather than naming a component. A bare rule on one of these paints
#: every element that happens to carry it.
UTILITY = {"sm", "lg", "md", "xs", "on", "in", "pin", "alt", "hi", "lo",
           "up", "dim", "top", "left", "right", "gold", "night", "ours"}

#: Ancestors that do NOT scope a rule to a component — every section carries
#: one, so `.dark-sec .sm` reaches just as far as `.sm` does.
WRAPPERS = {"", "dark-sec", "wrap", "pad-y", "sec-page", "fade-up"}


def strip_comments(s):
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)


def main():
    raw = open(CSS).read()
    src = strip_comments(raw)
    bad = []

    # ── braces balance, comments excluded ────────────────────────────────
    depth, line, strays = 0, 1, []
    for ch in src:
        if ch == "\n":
            line += 1
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                strays.append(line)
                depth = 0
    print(f"braces: depth {depth} at EOF, {len(strays)} stray closers")
    if depth or strays:
        bad.append(f"unbalanced braces (depth {depth}, strays at {strays[:5]})")

    # ── dangling selector lists ─────────────────────────────────────────
    dangling = []
    for m in re.finditer(r",\s*\}", src):
        dangling.append(src[:m.start()].count("\n") + 1)
    print(f"dangling selector lists: {len(dangling)}")
    if dangling:
        bad.append(f"a selector list ends with a comma at line(s) {dangling[:5]} "
                   "— CSS will swallow the next rule")

    # ── bare rules on utility class names ───────────────────────────────
    # "Bare" means UNSCOPED: exactly `.x`, or `.x` under a page-wide wrapper
    # like `.dark-sec` that every section carries. `.data-table .hi` is fine —
    # a component scopes it, so it cannot reach a burst. `.dark-sec .sm` is
    # NOT fine, because `.dark-sec` is a theme, not a component.
    hits = defaultdict(list)
    for m in re.finditer(r"(^|[\n}])\s*([^{}@]+?)\{", src):
        sel = m.group(2).strip()
        ln = src[:m.start()].count("\n") + 1
        for part in sel.split(","):
            part = part.strip()
            t = re.fullmatch(r"(?:\.([\w-]+)\s+)?\.([\w-]+)", part)
            if t and t.group(2) in UTILITY and (t.group(1) or "") in WRAPPERS:
                hits[t.group(2)].append((ln, part))
    for name, where in sorted(hits.items()):
        lines = ", ".join(f"{w[1]!r} (line {w[0]})" for w in where[:3])
        print(f"  ✗ bare rule on utility class .{name}: {lines}")
        bad.append(f".{name} is a utility class — a bare rule on it paints "
                   "every element that carries it")
    if not hits:
        print(f"utility collisions: none "
              f"({len(UTILITY)} names checked)")

    for b in bad:
        print("  ✗", b)
    print("\nRESULT:", "FAIL" if bad else "PASS")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
