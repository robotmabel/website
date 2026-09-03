#!/usr/bin/env python3
"""The retargeting comparison must reproduce the paper's table, not approximate it.

Same source JSON, same statistic (median across episodes; mean for the one axis
whose median is zero for every map), same decimals, and the same refusal to rank
two cells the experiment cannot tell apart.

    python scripts/rctest.py http://localhost:8741/software.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9461 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-rc2-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-rc2-{P}", "--window-size=1500,1000",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# straight off papers/ral2026/Tables/12_experiments_retargettable.tex
PAPER = {
    "placement_pct":  ["59.0", "16.3", "15.2", "23.8", "12.5", "17.5", "15.3"],
    "orientation_deg": ["80.8", "5.3", "3.7", "11.3", "4.2", "15.2", "4.2"],
    "posture_deg":    ["72", "29", "15", "13", "18", "15", "16"],
    "coverage_pct":   ["30", "58", "87", "51", "88", "75", "87"],
    "selfcol_pct":    ["80.8", "0.0", "0.0", "3.3", "0.0", "0.0", "0.0"],
    "infeasible_pct": ["12.0", "8.3", "0.5", "3.5", "5.6", "0.5", "0.4"],
    "sat_pct":        ["30", "11", "10", "11", "11", "15", "10"],
    "track_mm":       ["364", "29", "31", "71", "35", "65", "31"],
}


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
            if await ev("!!window.__retargetCompare"):
                break
        bad = 0
        cells = json.loads(await ev("JSON.stringify(window.__retargetCompare.cells())"))
        got = {c["axis"]: c["vals"] for c in cells}
        best = {c["axis"]: c["best"] for c in cells}
        print("axis                published            page")
        for k, want in PAPER.items():
            have = got.get(k)
            same = have == want
            print(f"  {k:16s} {' '.join(want):26s} {' '.join(have or ['-'])}"
                  f"   {'ok' if same else '*** DIFFERS'}")
            if not same:
                bad += 1

        # the ranking rule: a row where every method is identical must not
        # crown one of them
        step = [c for c in cells if c["axis"] == "step_ms"]
        if step and sum(step[0]["best"]) not in (0, len(step[0]["best"])):
            print("   *** step time picked a winner among identical cells"); bad += 1
        print(f"\nstep-time row marks {sum(step[0]['best']) if step else 0} "
              f"of {len(step[0]['best']) if step else 0} cells best "
              "(they are all 2.2 — all or nothing is the only honest answer)")

        # filtering by one task must change the table
        before = json.dumps(got)
        await ev("""document.querySelectorAll('.rc2-chip')[1].click()""")
        await asyncio.sleep(0.5)
        after = await ev("JSON.stringify(window.__retargetCompare.cells())")
        n = await ev("Object.keys(window.__retargetCompare.picked()).length")
        print(f"filtering to 1 task: {n} selected, table changed: {after != before}")
        if n != 1 or after == before:
            print("   *** the task filter does not re-decide the table"); bad += 1

        print("errors:", errs[:2] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
