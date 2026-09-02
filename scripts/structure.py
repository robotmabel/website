#!/usr/bin/env python3
"""Tag balance and dangling-anchor check for every page."""
import re, sys, urllib.request
TAGS = ('section', 'div', 'figure', 'ol', 'li', 'p', 'table', 'video')
bad_total = 0
for page in sys.argv[1:]:
    h = urllib.request.urlopen(page, timeout=25).read().decode()
    bad = []
    for t in TAGS:
        o = len(re.findall(r'<' + t + r'[\s>]', h))
        c = len(re.findall(r'</' + t + r'>', h))
        if o != c:
            bad.append(t + ' ' + str(o) + '/' + str(c))
    ids = set(re.findall(r'id="([^"]+)"', h))
    dang = [a for a in set(re.findall(r'href="#([^"]+)"', h)) if a and a not in ids]
    name = page.rsplit('/', 1)[-1]
    print("%-14s %-28s %s" % (name,
          'tags OK' if not bad else 'TAGS ' + ','.join(bad),
          'anchors OK' if not dang else 'DANGLING ' + str(dang)))
    bad_total += len(bad) + len(dang)
print("RESULT:", "PASS" if bad_total == 0 else "FAIL")
