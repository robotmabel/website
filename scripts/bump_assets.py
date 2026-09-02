#!/usr/bin/env python3
"""Re-stamp ?v=<hash> on the shared CSS/JS in every page.

Run after ANY edit to assets/mabel.css or the shared scripts. Without it a
freshly deployed page pairs with a cached older stylesheet — which is what
made the pop-up cards render unstyled, and what made a sticker fix look
like it had no effect during testing.
"""
import glob, hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Every shared stylesheet/script the pages reference. Missing one here means
# a deployed page can pair with a cached older copy of it — which is exactly
# how a verified bom-table.js fix appeared to do nothing in the browser.
TRACKED = ["assets/mabel.css", "assets/mabel.js",
           "assets/comic-pop.js", "assets/tipover-lab.js",
           "assets/bom-table.js", "assets/bom-pie.js", "assets/reach-globe.js",
           "assets/wbc-viewer.js", "assets/robot-viewer.js", "assets/hero-rig.js",
           "assets/anatomy.js", "assets/explode-viewer.js", "assets/asm-art.js", "assets/burst-variety.js", "assets/rail-loop.js", "assets/film-player.js"]

def h(path):
    p = os.path.join(ROOT, path)
    return hashlib.md5(open(p, "rb").read()).hexdigest()[:8] if os.path.exists(p) else None

def main():
    n = 0
    vers = {p: h(p) for p in TRACKED}
    for f in glob.glob(os.path.join(ROOT, "*.html")):
        s = o = open(f).read()
        for path, v in vers.items():
            if not v:
                continue
            attr = "href" if path.endswith(".css") else "src"
            s = re.sub(r'(%s="%s)(\?v=[a-f0-9]+)?"' % (attr, re.escape(path)),
                       r'\1?v=' + v + '"', s)
        if s != o:
            open(f, "w").write(s); n += 1
    print("stamped %d pages: %s" % (n, ", ".join(f"{k.split('/')[-1]}={v}" for k, v in vers.items() if v)))

if __name__ == "__main__":
    main()
