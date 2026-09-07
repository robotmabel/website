#!/usr/bin/env python3
"""Every nav-bearing page must offer the SAME top-level items, desktop and mobile.

connect.html once lost the "AI harness" dropdown from its desktop nav while a
stray copy of the group sat inside the MOBILE nav, where a hover dropdown cannot
open -- so the item vanished from the bar on the Links page and was duplicated
on phones. A per-page grep for the word "harness" found it on the page and said
nothing was wrong; what is wrong is the SET of items, so that is what this
checks.

Read from the source, not the DOM: the nav is static markup on every page and a
missing item is a missing tag, not a runtime condition.
"""
import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent

# Pages that carry the site nav. build.html and simulator.html are standalone
# (no nav at all) and docs/ has its own; none of them are checked here.
PAGES = sorted(p for p in SITE.glob("*.html")
               if '<nav class="nav-links">' in p.read_text())


def desktop_items(html: str) -> list[str]:
    """Top-level labels in the desktop bar, in order.

    The dropdown contents are stripped first: a `.nav-menu` link is a child of
    an item, not an item, and counting them reports every page as carrying a
    duplicate "Overview".
    """
    nav = re.search(r'<nav class="nav-links">(.*?)</nav>', html, re.S).group(1)
    nav = re.sub(r'<div class="nav-menu">.*?</div>', "", nav, flags=re.S)
    items = []
    for m in re.finditer(
            r'<button[^>]*class="nav-grp-btn"[^>]*>(.*?)<span class="nav-caret">'
            r'|<a\b(?![^>]*class="nav-(?:build|cta)")[^>]*>(.*?)</a>', nav):
        items.append((m.group(1) or m.group(2)).strip())
    return items


def mobile_items(html: str) -> list[str]:
    nav = re.search(r'<nav class="mob"[^>]*>(.*?)</nav>', html, re.S).group(1)
    return [m.group(1).strip() for m in re.finditer(
        r'<a\b(?![^>]*class="nav-(?:build|cta)")[^>]*>(.*?)</a>', nav)]


def main() -> int:
    desk = {p.name: desktop_items(p.read_text()) for p in PAGES}
    mob = {p.name: mobile_items(p.read_text()) for p in PAGES}

    # The majority list is the reference: a defect is one page disagreeing with
    # the rest, not a hand-maintained list here that would itself drift.
    def reference(d):
        counts = {}
        for items in d.values():
            counts[tuple(items)] = counts.get(tuple(items), 0) + 1
        return list(max(counts, key=counts.get))

    bad = 0
    for label, table in (("desktop", desk), ("mobile", mob)):
        ref = reference(table)
        for name, items in sorted(table.items()):
            if items != ref:
                bad += 1
                print(f"FAIL {name} [{label}]")
                print(f"     has      {items}")
                print(f"     expected {ref}")
                missing = [i for i in ref if i not in items]
                extra = [i for i in items if i not in ref]
                if missing:
                    print(f"     missing  {missing}")
                if extra:
                    print(f"     extra    {extra}")
        # A duplicate inside one nav is a defect even if the set matches.
        for name, items in sorted(table.items()):
            dupes = {i for i in items if items.count(i) > 1}
            if dupes:
                bad += 1
                print(f"FAIL {name} [{label}] duplicated: {sorted(dupes)}")

    print("desktop:", " | ".join(reference(desk)))
    print("mobile: ", " | ".join(reference(mob)))
    print(f"{len(PAGES)} pages checked, {bad} problem(s)")
    print("RESULT: FAIL" if bad else "RESULT: PASS")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
