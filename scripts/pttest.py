#!/usr/bin/env python3
"""The landscape table must FILTER, and its headline claim must be checked.

The page says MABEL is the only open, hand-dexterous, neck-articulated platform
under $10k. That is a claim about data, so this applies exactly those filters
and asserts the survey agrees — if a platform ever appears that also qualifies,
this fails and the page's verdict line already says so by itself.

    python scripts/pttest.py http://localhost:8741/index.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9501 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-pt-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-pt-{P}", "--window-size=1500,1000",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/index.html"
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
                r = json.loads(await asyncio.wait_for(c.recv(), 45))
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description"))[:140])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Page.navigate", {"url": url})
        for _ in range(60):
            await asyncio.sleep(0.4)
            if await ev("!!window.__platformTable"):
                break
        bad = 0
        n = await ev("window.__platformTable.data.platforms.length")
        shown = await ev("window.__platformTable.shown()")
        print(f"{n} platforms surveyed, {shown} shown unfiltered")
        if n < 20 or shown != n:
            print("   *** the survey did not load in full"); bad += 1

        cases = [
            (["open"], "open source"),
            (["single"], "one arm"),
            (["closed", "holo"], "commercial + holonomic"),
        ]
        for keys, label in cases:
            await ev("window.__platformTable.setFilters(%s)" % json.dumps(keys))
            await asyncio.sleep(0.3)
            k = await ev("window.__platformTable.shown()")
            print(f"  {label:28s} {k} rows")
            if not (0 < k < n):
                print("   *** that filter did not narrow the field"); bad += 1

        # THE CLAIM
        await ev("""window.__platformTable.setFilters(
            ['open','hands','neck','cheap'])""")
        await asyncio.sleep(0.4)
        k = await ev("window.__platformTable.shown()")
        v = await ev("window.__platformTable.verdict()")
        print(f"\nopen + real hand + actuated neck + under $10k: {k} row(s)")
        print(f"   verdict: {v}")
        if k != 1:
            print("   *** the survey no longer supports 'only MABEL' — "
                  "update the claim, not the test"); bad += 1

        print("errors:", errs[:2] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
