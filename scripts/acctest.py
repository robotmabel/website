#!/usr/bin/env python3
"""The accuracy lab must DRAW what the hardware logs measured, in step with measured joint replay.

Not "did the section appear" — a section appears just as happily with an empty
SVG in it. This checks, in a browser:
  * the data IS the latest archive: accuracy.json against the experiments' own
    results_real.json (every station's RP/AP, every condition's RMS), when the
    archive is beside the repo; the headline numbers are on screen;
  * every landing is drawn, and switching station never rescales the frame;
  * LIVE: driven to a clip time, the grid shows exactly the returns the render
    has marked by then, and the line plot's playhead sits at the path time the
    render's clock maps to (and is absent while the arm is still moving to the
    start); the clips are the 9.2 s submission renders;
  * hover a dot and a curve (through the input pipeline) and the tooltip says
    the measured value; the legends toggle series.

    python scripts/acctest.py http://localhost:8741/hardware.html
"""
import asyncio, os, json, pathlib, random, subprocess, sys, time, urllib.request, websockets
from _chrome import cleanup_on_exit   # scripts/ is on sys.path when run as a script

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9631 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-acc-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-acc-{P}", "--window-size=1500,1200",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cleanup_on_exit(p)   # kill Chrome + rm its profile on ANY exit


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else \
        "http://localhost:8741/hardware.html"
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
                r = json.loads(await asyncio.wait_for(c.recv(), 45))
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
            if await ev("!!window.__accuracyLab"):
                break

        bad = []
        if not await ev("!!window.__accuracyLab"):
            print("the lab never initialised")
            print("\nRESULT: FAIL")
            return 1
        def need(ok, msg):
            print(("   ✓ " if ok else "   ✗ ") + msg)
            if not ok:
                bad.append(msg)

        D = await ev("window.__accuracyLab.data")
        lim0 = await ev("window.__accuracyLab.limit")
        R, PF = D["rep"], D["path"]
        print(f"frame ±{lim0} mm · {R['cycles']} cycles · {len(R['stations'])} stations · {len(PF['conditions'])} conditions · {R['date']}")

        # ── the data is the latest archive ──
        arch = pathlib.Path(os.environ.get("ACCURACY_ARCHIVE", "/nonexistent")) / "experiments"   # the archive check runs only where it is set
        if (arch / "repeatability" / "results_real.json").exists():
            rr = json.loads((arch / "repeatability" / "results_real.json").read_text())
            off = [(s["name"], h) for s in R["stations"] for h in ("left", "right")
                   if abs(s["hands"][h]["RP_mm"] - rr["stations"][s["name"]][h]["RP_mm"]) > 0.01
                   or abs(s["hands"][h]["AP_mm"] - rr["stations"][s["name"]][h]["AP_mm"]) > 0.01]
            need(not off and len(R["stations"]) == len(rr["stations"]), f"every station's RP/AP equals the archive's results_real.json {off or ''}")
            pr = json.loads((arch / "path_following" / "results_real.json").read_text())["by_condition"]
            off = [c["id"] for c in PF["conditions"] for h in ("left", "right") for m in ("track_rms_mm", "contour_rms_mm")
                   if abs(c["stats"][h][m] - pr[c["id"]][h][m]) > 0.01]
            need(not off and len(PF["conditions"]) == len(pr), f"every path condition's RMS equals the archive's {off or ''}")
        else:
            print("   · archive not beside the repo: skipping the archive comparison")
        txt = await ev("document.getElementById('accuracyLab').textContent")
        need(f"{R['median_RP_mm']:.2f} mm" in txt and f"{PF['worst_contour_rms_mm']:.2f} mm" in txt,
             f"the headline median RP {R['median_RP_mm']:.2f} mm and worst contour {PF['worst_contour_rms_mm']:.2f} mm are on screen")
        need(await ev("document.querySelectorAll('#accuracyLab .al-test-stage').length===2"), "both test rows contain interactive 3D stages")
        for key in ['repeat','path']:
            await ev(f"document.querySelector('[data-clip={key}]').scrollIntoView({{block:'center',behavior:'instant'}})")
            for _ in range(60):
                await asyncio.sleep(.2)
                if await ev(f"!!window.__accuracyReplays?.{key}"):break
            need(await ev(f"!!window.__accuracyReplays?.{key}"), f'{key} resolves a complete articulated rig')
            start=await ev(f"window.__accuracyReplays.{key}.time")
            # A software-rendered headless frame can take more than 350 ms
            # while the second articulated rig is initializing. Require real
            # clock progress, with a bounded wait instead of a frame-rate guess.
            end=start
            for _ in range(25):
                await asyncio.sleep(.2)
                end=await ev(f"window.__accuracyReplays.{key}.time")
                if end != start: break
            need(start is not None and end is not None and end!=start, f'{key} replay advances automatically on entry')
        for width in [1440,1100,980]:
            await cmd('Emulation.setDeviceMetricsOverride',dict(width=width,height=1000,deviceScaleFactor=1,mobile=False))
            await asyncio.sleep(.2)
            aligned=await ev("[...document.querySelectorAll('#accuracyLab .al-media')].every(n=>Math.abs(n.querySelector('.al-clip').getBoundingClientRect().top-n.querySelector('.al-plots').getBoundingClientRect().top)<2)")
            need(aligned, f'each replay aligns with its plots at {width}px')
        await cmd('Emulation.setDeviceMetricsOverride',dict(width=1500,height=1200,deviceScaleFactor=1,mobile=False))

        # stop the clips' own clocks so the checks drive time
        await ev("window.__accuracyLab.hold(true); document.querySelectorAll('#accuracyLab video').forEach(function(v){v.pause();}); true")
        await asyncio.sleep(0.6)

        # ── every landing drawn, one frame ──
        for s in R["stations"]:
            await ev(f"window.__accuracyLab.setStation({json.dumps(s['name'])})")
            got = await ev("window.__accuracyLab.dots()")
            want = sum(s["hands"][h]["n"] for h in s["hands"])
            if got != want:
                bad.append(f"{s['name']} drew {got} of {want} landings")
            if await ev("window.__accuracyLab.limit") != lim0:
                bad.append(f"{s['name']} RESCALED the shared frame")
        need(not any("landings" in b or "RESCALED" in b for b in bad), "every station draws all its landings on one shared frame")

        # ── live: the grid fills in on the render's clock ──
        await ev("window.__accuracyLab.follow(true)")
        pts = [p for s in R["stations"] for h in ("left", "right") for p in s["hands"][h]["pts"]]
        for t in (0.0, 1.0, 3.06, 5.0, 6.7, 9.2):
            await ev(f"window.__accuracyLab.at({t})")
            got, want = await ev("window.__accuracyLab.dots()"), sum(1 for p in pts if p[4] <= t)
            need(got == want and await ev("window.__accuracyLab.grid()"), f"at {t:4.2f} s the grid shows the {want} returns the clip has marked (drew {got})")

        # ── live: the playhead follows the drawn palm ──
        for cc in [q for q in PF["conditions"] if "sync" in q]:
            sy = cc["sync"]
            mid = sy[len(sy) // 2]
            await ev(f"window.__accuracyLab.at({mid[0]})")
            cond, x = await ev("window.__accuracyLab.cond()"), await ev("window.__accuracyLab.playhead()")
            need(cond == cc["id"] and x is not None and abs(x - mid[1]) < 0.15, f"at {mid[0]:.2f} s the plot is {cc['id']} with the playhead at {mid[1]:.2f} s along the path (got {cond}, {x})")
            await ev(f"window.__accuracyLab.at({sy[0][0] - 0.3})")
            need(await ev("window.__accuracyLab.playhead()") is None, f"while the arm moves to the {cc['shape']}'s start there is no playhead")

        # The curves progressively reveal samples, rather than showing the
        # complete graph under a moving playhead from the first frame.
        sy=next(c['sync'] for c in PF['conditions'] if c['id']=='spiral_torso0')
        await ev(f"window.__accuracyLab.at({sy[0][0]-.1})")
        need(await ev("+document.querySelector('[data-role=trace-window]').getAttribute('width')===0"), 'no path samples appear before tracing starts')
        await ev(f"window.__accuracyLab.at({sy[len(sy)//3][0]})")
        early=await ev("+document.querySelector('[data-role=trace-window]').getAttribute('width')")
        await ev(f"window.__accuracyLab.at({sy[2*len(sy)//3][0]})")
        late=await ev("+document.querySelector('[data-role=trace-window]').getAttribute('width')")
        need(0<early<late<392, f'curve reveal grows with the robot clock ({early} → {late})')

        # ── hover tooltips, through the input pipeline ──
        async def hover(x, y):
            await cmd("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
            await asyncio.sleep(0.15)
            return await ev("Array.from(document.querySelectorAll('#accuracyLab .al-tip')).filter(function(t){return !t.hidden}).map(function(t){return t.textContent}).join('|')")
        await ev("window.__accuracyLab.setStation('T3_wide_high'); document.querySelector('[data-role=scatter]').scrollIntoView({block:'center',behavior:'instant'})")
        await asyncio.sleep(0.3)
        d0 = await ev("window.__accuracyLab.dotXY(0)")
        tt = await hover(d0["x"], d0["y"])
        need(f"{d0['mm']:.2f} mm" in tt and f"cycle {d0['cycle'] + 1}" in tt, f"hovering a dot shows its distance and cycle ('{tt[:70]}')")
        await ev("window.__accuracyLab.setCond('square_torso-10'); document.querySelector('[data-role=err]').scrollIntoView({block:'center',behavior:'instant'})")
        await asyncio.sleep(0.3)
        p5 = await ev("window.__accuracyLab.plotXY(5)")
        tt = await hover(p5["x"], p5["y"])
        need("5.0 s along the square" in tt and tt.count("mm") >= 4, f"hovering the line plot lists every visible series' value ('{tt[:70]}')")

        # ── legends toggle ──
        n0 = await ev("window.__accuracyLab.dots()")
        await ev("document.querySelector('[data-role=replg] [data-h=right]').click()")
        n1 = await ev("window.__accuracyLab.dots()")
        await ev("document.querySelector('[data-role=replg] [data-h=right]').click()")
        need(n1 * 2 == n0 and await ev("window.__accuracyLab.dots()") == n0, f"the palm legend hides and restores a palm ({n0} → {n1} → {n0})")
        await ev("document.querySelector('[data-role=pathlg] [data-k=left_contour]').click()")
        l1 = await ev("window.__accuracyLab.lines()")
        await ev("document.querySelector('[data-role=pathlg] [data-k=left_contour]').click()")
        need(l1 == 3 and await ev("window.__accuracyLab.lines()") == 4, f"the series legend hides and restores a curve (4 → {l1} → 4)")

        # The callout drawing. inline-svg.js REPLACES the <img> with an inline
        # <svg> so the figure gets the page's webfonts, so "is the img loaded"
        # is the wrong question — it measures the rendered box and the number
        # of leader lines actually drawn instead.
        #
        # SCROLL TO IT AND LET IT SETTLE. This measured the moment the accuracy
        # lab initialised, which is a different moment from "the figure below
        # it has a box" — the figure is lazy, so on a run where the lab came up
        # fast the check read 0x0 and called a perfectly good drawing missing.
        # The <img> now carries width/height so it reserves its box before it
        # loads, and this asks the question where a reader would see it.
        await ev("var f=document.querySelector('.callout-fig');"
                 "f && f.scrollIntoView({block:'center', behavior:'instant'})")
        await asyncio.sleep(1.2)
        cw = await ev("(function(){var f=document.querySelector('.callout-fig');"
                      "if(!f) return null; var g=f.querySelector('svg,img');"
                      "if(!g) return null; var r=g.getBoundingClientRect();"
                      "return {w:Math.round(r.width),h:Math.round(r.height),"
                      "tag:g.tagName.toLowerCase(),"
                      "leaders:f.querySelectorAll('path.ld').length,"
                      "labels:f.querySelectorAll('text.lb').length};})()")
        print(f"   callout: {cw}")
        if not cw or cw["w"] < 200 or cw["h"] < 200:
            bad.append(f"the callout drawing did not render ({cw})")
        elif cw["tag"] == "svg" and (cw["leaders"] < 10 or cw["labels"] < 10):
            bad.append(f"the callout is missing leader lines ({cw})")

        print("errors:", " | ".join(errs) or "none")
        for b in bad:
            print("  ✗", b)
        print("\nRESULT:", "FAIL" if (bad or errs) else "PASS")
        return 1 if (bad or errs) else 0


try:
    sys.exit(asyncio.run(go()))
finally:
    p.kill()
