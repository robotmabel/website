#!/usr/bin/env python3
"""The accuracy lab must DRAW what the archives measured.

Not "did the section appear". A section appears just as happily with an empty
SVG in it, which is how a brightness check once passed on a fallen robot. This
counts the landings actually rendered, asserts the shared frame really is
shared (switching station must NOT rescale the axes — that is the whole point
of the panel), and checks the deployed-gains number on screen against the JSON.

    python scripts/acctest.py http://localhost:8741/hardware.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9631 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-acc-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-acc-{P}", "--window-size=1500,1200",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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

        D = await ev("window.__accuracyLab.data")
        lim0 = await ev("window.__accuracyLab.limit")
        print(f"frame ±{lim0} mm · {D['rep_trials']} ISO cycles · "
              f"{len(D['stations'])} stations · {len(D['paths'])} paths")

        for s in D["stations"]:
            await ev(f"window.__accuracyLab.setStation({json.dumps(s['name'])})")
            lim = await ev("window.__accuracyLab.limit")
            got = await ev("window.__accuracyLab.dots()")
            want = sum(s["hands"][h]["n"] for h in s["hands"])
            r = s["hands"]["right_index_tip"]
            print(f"   {s['name']:16s} {got:3d}/{want:3d} landings  "
                  f"RP {r['RP_mm']:5.1f}  Rmax {r['Rmax_mm']:5.1f} mm")
            if got < want:
                bad.append(f"{s['name']} drew {got} of {want} landings")
            if lim != lim0:
                bad.append(f"{s['name']} RESCALED the shared frame: {lim0} → {lim}")

        for path, cs in D["paths"].items():
            await ev(f"window.__accuracyLab.setPath({json.dumps(path)})")
            n = await ev("window.__accuracyLab.lines()")
            print(f"   {path:16s} {n} curves  "
                  f"{cs[0]['rms_mm']:6.1f} → {cs[-1]['rms_mm']:5.1f} mm RMS "
                  f"({cs[0]['rms_mm'] / max(cs[-1]['rms_mm'], 1e-9):.0f}×)")
            if n != len(cs):
                bad.append(f"{path} drew {n} of {len(cs)} condition curves")
            txt = await ev("document.getElementById('accuracyLab').textContent")
            if f"{cs[-1]['rms_mm']:.1f} mm" not in txt:
                bad.append(f"{path}: deployed RMS {cs[-1]['rms_mm']:.1f} mm "
                           "is not on screen")

        # The callout drawing. inline-svg.js REPLACES the <img> with an inline
        # <svg> so the figure gets the page's webfonts, so "is the img loaded"
        # is the wrong question — it measures the rendered box and the number
        # of leader lines actually drawn instead.
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
