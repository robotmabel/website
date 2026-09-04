#!/usr/bin/env python3
"""The scene gallery must build from the registry and filter on both axes.

It used to be 37 hand-written figures whose category counts were typed in by
hand; it is now generated from assets/sim/scenes/index.json, which the renderer
writes. This checks the grid exists, that the moving/still split matches the
manifest, and that both filters actually hide cells.

    python scripts/scenetest.py http://localhost:8741/software.html
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9371 + random.randrange(40)   # a fresh port per run: two
                                # checks in flight used to collide on one profile
subprocess.run(["rm", "-rf", f"/tmp/cdp-scene-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-scene-{P}", "--window-size=1400,950",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/software.html"
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]; errs = []

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await c.recv())
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description")
                                    or d.get("text"))[:150])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Page.navigate", {"url": url})
        # The 3-D modules are deferred until their canvas nears the viewport
        # (assets/defer-module.js), so a check that waits for their test hook
        # waits forever. Ask for them — but RETRY, because right after
        # Page.navigate the loader script has not run yet and the hook it
        # installs does not exist.
        for _ in range(40):
            if await ev("!!(window.__loadDeferred && window.__loadDeferred())"):
                break
            await asyncio.sleep(0.15)
        for _ in range(40):
            await asyncio.sleep(0.4)
            if await ev("!!window.__sceneGrid"):
                break
        bad = 0
        n = await ev("document.querySelectorAll('.scene-cell').length")
        nmov = await ev("document.querySelectorAll('.scene-cell.moving').length")
        cats = await ev("document.querySelectorAll('.scene-filters.cats button').length")
        print(f"cells {n}   moving {nmov}   category buttons {cats}")
        if not n or n < 20:
            print("   *** the gallery did not build"); bad += 1
        if not nmov:
            print("   *** nothing is marked as moving"); bad += 1

        def vis():
            return ev("document.querySelectorAll('.scene-cell:not([hidden])').length")

        await ev("""document.querySelector('[data-mv="1"]').click()""")
        await asyncio.sleep(0.4)
        onlyMoving = await vis()
        await ev("""document.querySelector('[data-mv="0"]').click()""")
        await asyncio.sleep(0.4)
        onlyStill = await vis()
        await ev("""document.querySelector('[data-mv=""]').click()""")
        await asyncio.sleep(0.4)
        allv = await vis()
        print(f"filter moving {onlyMoving} · still {onlyStill} · all {allv}")
        if onlyMoving != nmov or onlyStill != n - nmov or allv != n:
            print("   *** the moving/still filter does not match the manifest"); bad += 1

        # a category filter narrows it further
        await ev("""document.querySelectorAll('.scene-filters.cats button')[1].click()""")
        await asyncio.sleep(0.4)
        oneCat = await vis()
        print(f"first category shows {oneCat}")
        if not (0 < oneCat < n):
            print("   *** the category filter did nothing"); bad += 1

        print("errors:", errs[:3] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
