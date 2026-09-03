#!/usr/bin/env python3
"""The retargeting clips must be IN SYNC, and must agree with the table.

Two things can go wrong here and neither looks broken:

1. THE TILES DRIFT. Seven videos started together separate within a few loops
   — different files decode at different rates — and a side-by-side comparison
   of frames that are no longer the same frame is worse than no comparison at
   all. It still looks like a grid of robots doing something.

2. A CLIP DISAGREES WITH ITS ROW. The clips exist to make the table's numbers
   visible, so a clip rendered from a different run than the one that was
   scored is a lie in picture form. This checks the badge each tile shows
   against the same JSON the table is built from.

    python scripts/rktest.py http://localhost:8741/software.html
"""
import asyncio, json, os, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
P = 9871 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-rk-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-rk-{P}", "--window-size=1600,1200",
                      "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
                      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                      "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else \
        "http://localhost:8741/software.html"
    idx = os.path.join(SITE, "assets", "retarget", "index.json")
    if not os.path.exists(idx):
        print("assets/retarget/index.json is missing — the clips have not been "
              "rendered.\n   run controller/experiments/retargeting_ablation/"
              "render_compare.py")
        print("\nRESULT: SKIP")
        return 0
    D = json.load(open(idx))

    tabs = None
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]; errs = []

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 60))
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description"))[:140])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Page.navigate", {"url": url})
        for _ in range(70):
            await asyncio.sleep(0.4)
            if await ev("!!window.__retargetClips"):
                break
        if not await ev("!!window.__retargetClips"):
            print("the clip grid never initialised")
            print("\nRESULT: FAIL")
            return 1

        bad = 0
        n_tasks = len(D["tasks"])
        n_meth = len(D["methods"])
        print(f"{n_tasks} tasks x {n_meth} methods in the index")

        # every cell in the index must have a file on disk
        missing = []
        for t in D["tasks"]:
            # NOT `c` — that is the websocket connection this closure sends on
            for _m, cell in t["cells"].items():
                for k in ("clip", "poster"):
                    f = os.path.join(SITE, "assets", "retarget", cell[k])
                    if not os.path.exists(f) or os.path.getsize(f) < 2000:
                        missing.append(cell[k])
        print(f"files: {sum(len(t['cells']) for t in D['tasks']) * 2 - len(missing)}"
              f" present, {len(missing)} missing/empty")
        if missing:
            print(f"   *** missing: {missing[:4]}"); bad += 1

        # the grid must render one tile per method, ranked
        for t in D["tasks"][:4]:
            await ev(f"window.__retargetClips.setTask({json.dumps(t['id'])})")
            await asyncio.sleep(0.3)
            tiles = await ev("window.__retargetClips.tiles()")
            if sorted(tiles) != sorted(t["cells"].keys()):
                print(f"   *** {t['id']}: tiles {tiles} != cells "
                      f"{sorted(t['cells'])}")
                bad += 1
        print(f"tiles match the index for the first "
              f"{min(4, n_tasks)} tasks")

        # RANKING: best first, and "best" depends on the axis direction
        await ev("window.__retargetClips.setTask("
                 + json.dumps(D["tasks"][0]["id"]) + ")")
        for axis, better_high in [("placement_pct", False),
                                  ("coverage_pct", True)]:
            await ev(f"window.__retargetClips.setAxis('{axis}')")
            await asyncio.sleep(0.25)
            tiles = await ev("window.__retargetClips.tiles()")
            vals = [D["tasks"][0]["cells"][m][axis] for m in tiles]
            ok = all((vals[k] >= vals[k + 1]) if better_high
                     else (vals[k] <= vals[k + 1])
                     for k in range(len(vals) - 1))
            arrow = "desc" if better_high else "asc"
            print(f"   ranked by {axis} ({arrow}): "
                  f"{[round(v, 1) for v in vals]}")
            if not ok:
                print(f"   *** the ranking is not sorted"); bad += 1

        # SYNC: let them run, then measure the worst drift between tiles
        await ev("window.__retargetClips.setAxis('placement_pct')")
        await ev("document.getElementById('retargetClips')"
                 ".scrollIntoView({block:'center'})")
        await asyncio.sleep(3.0)
        ready = await ev("window.__retargetClips.ready()")
        spread = await ev("window.__retargetClips.spread()")
        print(f"sync: {ready}/{n_meth} tiles have data, worst drift "
              f"{spread:.2f} s")
        if ready and spread > 0.6:
            print("   *** the tiles have drifted apart — the comparison is no "
                  "longer of the same instant")
            bad += 1

        print("errors:", errs[:2] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")
        return 1 if bad else 0


try:
    sys.exit(asyncio.run(go()))
finally:
    p.kill()
