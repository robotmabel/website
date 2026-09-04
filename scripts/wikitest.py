#!/usr/bin/env python3
"""The wiki must stay an extension of the site, not a second publication.

It was one once: a dark manual with its own accent colours (#ffc24b, #57c7ff)
and no display faces, hosted next door to a cream comic-set site. Nobody
noticed for a long time because each page looked internally consistent — you
have to put them side by side, or measure.

So this measures. Every page under docs/ must render on the SITE'S ground, in
the SITE'S faces, and must not reintroduce a palette of its own.

    python scripts/wikitest.py [url ...]
"""
import asyncio, json, os, random, re, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
DOCS = os.path.join(SITE, "docs")

#: read from assets/mabel.css so the two cannot drift apart in one direction
WANT_BG = "rgb(244, 234, 210)"          # --bone
WANT_INK = "rgb(21, 24, 32)"            # --ink, the sidebar
WANT_BODY = "Jost"
WANT_H1 = "Limelight"
#: the dark manual's palette. If any of these come back, it has regressed.
BANNED = ("#ffc24b", "#57c7ff", "#10131a", "#0d1016", "#1b1f2a", "#e8eaf0",
          "#9aa1b0", "#2a2f3c")

P = 9511 + random.randrange(60)
PROF = f"/tmp/cdp-wiki-{P}"
subprocess.run(["rm", "-rf", PROF])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={PROF}", "--window-size=1400,1000",
                      "--hide-scrollbars", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    pages = sys.argv[1:] or ["http://localhost:8741/docs/" + f
                             for f in sorted(os.listdir(DOCS))
                             if f.endswith(".html")]
    tabs = None
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    if not tabs:
        print(f"chrome never answered on :{P}\n\nRESULT: FAIL"); return 1
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    bad = 0

    # the stylesheet must not carry the old palette at all
    # COMMENTS STRIPPED FIRST. The stylesheet's own header names the two
    # colours it replaced, so scanning the raw file flags the sentence
    # explaining the fix as the bug it fixed.
    css = re.sub(r"/\*.*?\*/", "",
                 open(os.path.join(DOCS, "docs.css")).read(), flags=re.S).lower()
    leftovers = [b for b in BANNED if b in css]
    print(f"docs.css: {len(leftovers)} colours from the dark manual")
    if leftovers:
        print(f"   *** still present: {', '.join(leftovers)}"); bad += 1

    async with websockets.connect(ws, max_size=None) as c:
        i = [0]

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 60))
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        for pg in pages:
            await cmd("Page.navigate", {"url": pg})
            for _ in range(30):
                await asyncio.sleep(0.2)
                if await ev("document.readyState === 'complete'"):
                    break
            await asyncio.sleep(0.5)
            got = await ev("""(function(){
              var cs = getComputedStyle(document.body);
              var h1 = document.querySelector('h1');
              var side = document.querySelector('nav.side');
              return {
                bg: cs.backgroundColor,
                body: cs.fontFamily.split(',')[0].replace(/["']/g,''),
                h1: h1 ? getComputedStyle(h1).fontFamily.split(',')[0]
                          .replace(/["']/g,'') : null,
                side: side ? getComputedStyle(side).backgroundColor : null,
                here: !!document.querySelector('.tree a.here'),
                bleed: document.documentElement.scrollWidth - innerWidth,
                links: [].slice.call(document.querySelectorAll('a[href]'))
                  .map(function(a){return a.getAttribute('href');})
                  .filter(function(h){return h && !/^(#|https?:|mailto:)/.test(h);})
              };})()""")
            name = pg.rsplit("/", 1)[-1]
            fail = []
            if got["bg"] != WANT_BG:
                fail.append(f"ground {got['bg']}")
            if got["body"] != WANT_BODY:
                fail.append(f"body face {got['body']}")
            if got["h1"] != WANT_H1:
                fail.append(f"h1 face {got['h1']}")
            if got["side"] and got["side"] != WANT_INK:
                fail.append(f"sidebar {got['side']}")
            if not got["here"]:
                fail.append("no page is marked current in the nav")
            if got["bleed"] > 2:
                fail.append(f"{got['bleed']}px of horizontal bleed")
            # a manual whose links do not resolve is worse than no manual
            for h in got["links"]:
                t = h.split("#")[0]
                if not t:
                    continue
                base = DOCS if not t.startswith("..") else SITE
                path = os.path.normpath(os.path.join(base, t.replace("../", "", 1)
                                                     if t.startswith("..") else t))
                if not os.path.exists(path):
                    fail.append(f"dead link {h}")
            print(f"  {name:20s} " + ("ok" if not fail else "  ".join(fail[:3])))
            bad += len(fail)

    print("\nRESULT:", "PASS" if bad == 0 else "FAIL")
    return 1 if bad else 0


try:
    sys.exit(asyncio.run(go()))
finally:
    p.kill()
