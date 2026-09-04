#!/usr/bin/env python3
"""How heavy is each page, and what is making it heavy?

Not a lighthouse score — a list of what the browser actually fetched, biggest
first, so the answer to "why is this slow" is a filename rather than a grade.
Counts what a FIRST visitor pays: cache disabled, nothing warmed.

    python scripts/loadtest.py                 # every page
    python scripts/loadtest.py software.html   # one

Budgets are per page and deliberately tight for a static site: anything over
them is either a figure that was never resized or a video that should have
been lazy.
"""
import asyncio, json, os, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
# THE LOCAL SERVER DOES NOT GZIP AND GITHUB PAGES DOES, so raw transferred
# bytes overstate what a real visitor pays for every text asset — three.js is
# 1.24 MB on disk and about 310 kB on the wire. Budgets are set against the
# gzip-aware estimate; the raw number is printed beside it so a regression in
# either is visible.
BUDGET_KB = 700
BUDGET_REQ = 90
# index.html carries the hero rig — three.js plus a 1.87 MB GLB — and that is
# a deliberate cost, paid on an idle frame AFTER the load event so the page is
# interactive at ~200 ms without it. Everything else has to fit the budget.
PER_PAGE = {"index.html": 2100}
TEXT_TYPES = {"Script", "Stylesheet", "Document", "XHR", "Fetch", "Other"}
GZIP_RATIO = 0.28          # measured on three.module.js and mabel.css

P = 9931 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-load-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-load-{P}",
                      "--window-size=1400,900", "--hide-scrollbars",
                      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                      "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def measure(c, cmd, ev, url, base):
    seen = {}
    started_late = set()
    await cmd("Network.enable")
    await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
    await cmd("Page.navigate", {"url": url})
    t0 = time.time()
    # STOP AT THE LOAD EVENT. Draining for a fixed 9 s counted everything the
    # page fetches AFTERWARDS as part of its load cost — the hero rig, which is
    # deliberately deferred to an idle frame precisely so it is not part of it.
    # The budget is about how long a reader waits, so it ends when the reader
    # stops waiting.
    done_at = None
    while time.time() - t0 < 12.0:
        if done_at and time.time() > done_at:
            break
        if done_at is None and time.time() - t0 > 0.25:
            # poll on EVERY pass, not only when the event stream goes quiet: a
            # busy page never goes quiet, so the timeout branch alone never
            # noticed that the page had finished
            if await ev("document.readyState === 'complete'"):
                # 1.2 s of grace, because we now DROP anything that started
                # after this moment — the window only has to be long enough for
                # requests already in flight to report their sizes.
                done_at = time.time() + 1.2
        try:
            r = json.loads(await asyncio.wait_for(c.recv(), 0.5))
        except asyncio.TimeoutError:
            continue
        m = r.get("method")
        if m == "Network.requestWillBeSent" and done_at is not None:
            # STARTED AFTER THE LOAD EVENT — deliberately deferred work (the
            # hero rig, a 3-D viewer) that the reader never waits for. Counting
            # it made the budget depend on how long the grace window happened
            # to be, so the same page measured 105 kB and 3.4 MB on two runs.
            started_late.add(r["params"]["requestId"])
        if m == "Network.responseReceived":
            pr = r["params"]
            seen[pr["requestId"]] = {
                "url": pr["response"]["url"],
                "type": pr.get("type", "?"),
                "bytes": 0,
            }
        elif m == "Network.loadingFinished":
            rid = r["params"]["requestId"]
            if rid in seen:
                seen[rid]["bytes"] = r["params"].get("encodedDataLength", 0)
    timing = await ev(
        "(function(){var n=performance.getEntriesByType('navigation')[0];"
        "return n ? {dcl:Math.round(n.domContentLoadedEventEnd),"
        "load:Math.round(n.loadEventEnd)} : null;})()")
    for rid in started_late:
        seen.pop(rid, None)
    return list(seen.values()), timing


async def go():
    pages = sys.argv[1:] or [f for f in sorted(os.listdir(SITE))
                             if f.endswith(".html") and not f.startswith("_")]
    tabs = None
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    bad = 0
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 45))
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        for pg in pages:
            # SETTLE BETWEEN PAGES. Every page starts deferred work after its
            # load event — a 3-D viewer, the hero rig — and navigating straight
            # to the next page leaves those in flight, so their bytes land in
            # the NEXT page's total. Measured: hardware.html alone is 97 kB and
            # was reported as 1194 kB when it followed anatomy.html in a batch.
            await cmd("Page.navigate", {"url": "about:blank"})
            await asyncio.sleep(1.2)
            reqs, timing = await measure(
                c, cmd, ev, f"http://localhost:8741/{pg}", pg)
            kb = sum(r["bytes"] for r in reqs) / 1024
            # binary assets are already compressed; text is not
            wire = sum(r["bytes"] * (GZIP_RATIO if r["type"] in TEXT_TYPES
                                     and not r["url"].endswith(
                                         (".mp4", ".jpg", ".png", ".glb", ".webp"))
                                     else 1.0)
                       for r in reqs) / 1024
            cap = PER_PAGE.get(pg, BUDGET_KB)
            over = wire > cap or len(reqs) > BUDGET_REQ
            flag = "  OVER" if over else ""
            t = (f"  dcl {timing['dcl']} ms  load {timing['load']} ms"
                 if timing else "")
            print(f"\n{pg:20s} {wire:6.0f} kB gz ({kb:.0f} raw)  "
                  f"{len(reqs):3d} requests{t}{flag}")
            if over:
                bad += 1
            big = sorted(reqs, key=lambda r: -r["bytes"])[:5]
            for r in big:
                if r["bytes"] < 40 * 1024:
                    break
                print(f"    {r['bytes']/1024:7.0f} kB  {r['type']:10s} "
                      f"{r['url'].split('/')[-1][:56]}")
    print(f"\nbudget: {BUDGET_KB} kB gzipped and {BUDGET_REQ} requests per page")
    print("RESULT:", "FAIL" if bad else "PASS")
    return 1 if bad else 0


try:
    sys.exit(asyncio.run(go()))
finally:
    p.kill()
