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
           "assets/anatomy.js", "assets/explode-viewer.js", "assets/asm-art.js", "assets/burst-variety.js", "assets/rail-loop.js", "assets/film-player.js", "assets/scene-filter.js",
           "assets/faq-pop.js",
           # the wiki's own shell, and the widgets build.html handed it
           "docs/docs.css", "docs/docs.js", "docs/build.css",
           "docs/hub.css", "docs/hub.js"]

def h(path):
    p = os.path.join(ROOT, path)
    return hashlib.md5(open(p, "rb").read()).hexdigest()[:8] if os.path.exists(p) else None

def main():
    n = 0
    vers = {p: h(p) for p in TRACKED}
    # THE WIKI COUNTS. docs/*.html reference the same shared scripts (one level
    # up, as ../assets/…) plus a shell of their own, and this only ever globbed
    # the root — so every wiki page shipped unstamped and could pair with a
    # cached older copy of the very files it depends on.
    pages = (glob.glob(os.path.join(ROOT, "*.html")) +
             glob.glob(os.path.join(ROOT, "docs", "*.html")))
    for f in pages:
        s = o = open(f).read()
        # how this page spells the path: root pages "assets/x.js",
        # wiki pages "../assets/x.js" and their own shell as a bare name
        indocs = os.path.dirname(f).endswith("docs")
        for path, v in vers.items():
            if not v:
                continue
            attr = "href" if path.endswith(".css") else "src"
            if indocs:
                ref = path[len("docs/"):] if path.startswith("docs/") else "../" + path
            else:
                if path.startswith("docs/"):
                    continue           # a root page never loads the wiki shell
                ref = path
            s = re.sub(r'(%s="%s)(\?v=[a-f0-9]+)?"' % (attr, re.escape(ref)),
                       r'\1?v=' + v + '"', s)
        if s != o:
            open(f, "w").write(s); n += 1
    print("stamped %d pages: %s" % (n, ", ".join(f"{k.split('/')[-1]}={v}" for k, v in vers.items() if v)))

if __name__ == "__main__":
    main()
