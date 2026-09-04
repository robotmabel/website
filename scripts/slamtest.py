#!/usr/bin/env python3
"""The SLAM lab has to actually map, and the matcher has to actually matter.

Two claims on the page, and a screenshot can support neither: that driving
builds a map from range readings alone, and that switching scan matching off
lets odometry drift shear it. Both are numbers, so both are measured here —
drive the robot from the outside and read the coverage and the pose error.

    python scripts/slamtest.py http://localhost:8741/autonomy.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9451 + random.randrange(60)
PROF = f"/tmp/cdp-slam-{P}"
subprocess.run(["rm", "-rf", PROF])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={PROF}", "--window-size=1400,1000",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else \
        "http://localhost:8741/autonomy.html"
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
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]; errs = []

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 120))
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description"))[:140])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True,
                           "awaitPromise": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Page.navigate", {"url": url})
        for _ in range(60):
            await asyncio.sleep(0.3)
            if await ev("!!window.__slamLab"):
                break
        if not await ev("!!window.__slamLab"):
            print("the SLAM lab never initialised\n\nRESULT: FAIL"); return 1
        await ev("document.getElementById('slamLab')"
                 ".scrollIntoView({block:'center',behavior:'instant'})")
        await asyncio.sleep(1.2)

        bad = 0
        walls = await ev("window.__slamLab.walls.length")
        print(f"floor plan: {walls} wall segments")
        if walls < 12:
            print("   *** there is no world to map"); bad += 1

        async def lap(matching):
            await ev(f"document.querySelector('.sl-match').checked = {str(matching).lower()}")
            await ev("window.__slamLab.reset()")
            await asyncio.sleep(0.4)
            for keys, secs in ((["ArrowUp"], 2.4), (["ArrowLeft"], 0.9),
                               (["ArrowUp"], 2.4), (["ArrowRight"], 0.9),
                               (["ArrowUp"], 2.0)):
                k = "{" + ",".join(f"'{x}':true" for x in keys) + "}"
                await ev(f"window.__slamLab.drive({k},{secs})")
                await asyncio.sleep(secs + 0.35)
            await asyncio.sleep(0.4)
            return (await ev("window.__slamLab.coverage()"),
                    await ev("window.__slamLab.drift()"))

        cov_on, drift_on = await lap(True)
        print(f"with matching:    {cov_on*100:5.1f}% mapped, "
              f"{drift_on*100:5.1f} cm pose error")
        if cov_on < 0.25:
            print("   *** driving the robot did not build a map"); bad += 1

        cov_off, drift_off = await lap(False)
        print(f"matching off:     {cov_off*100:5.1f}% mapped, "
              f"{drift_off*100:5.1f} cm pose error")
        # The page claims the matcher is what stops odometry drift. If turning
        # it off does not make the pose worse, the claim is decoration.
        if drift_off <= drift_on * 1.5:
            print(f"   *** the scan matcher makes no measurable difference "
                  f"({drift_on*100:.1f} -> {drift_off*100:.1f} cm) — the page "
                  "says it is what stops the drift")
            bad += 1
        else:
            print(f"   the matcher is worth {drift_off/max(drift_on,1e-6):.1f}x "
                  "in pose error, which is what the page claims it is for")

        print("errors:", errs[:2] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")
        return 1 if bad else 0


try:
    sys.exit(asyncio.run(go()))
finally:
    p.kill()
