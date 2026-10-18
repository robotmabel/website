#!/usr/bin/env python3
"""The nav bar must FIT, and the store dock must not sit on it.

The bar is a centred flex pill. When its items outgrow the viewport the
overflow spills out of BOTH ends, and the first thing to leave is the logo —
which is how the MABEL head ended up hanging off the left edge of the bar the
day a link was added. Measured here at the widths a laptop actually has.

    python scripts/navfit.py http://localhost:8741/index.html [more urls]
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
from _chrome import cleanup_on_exit
P = 9481 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-navfit-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}", f"--user-data-dir=/tmp/cdp-navfit-{P}",
                      "--window-size=1500,900", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cleanup_on_exit(p)
URLS = [a for a in sys.argv[1:] if a.startswith("http")] or ["http://localhost:8741/index.html"]
WIDTHS = [1200, 1280, 1366, 1440, 1680]
PHONE = [390, 768, 1024]


async def go():
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
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
                r = json.loads(await c.recv())
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        for url in URLS:
            await cmd("Page.navigate", {"url": url}); await asyncio.sleep(1.2)
            await ev("document.fonts.ready.then(function(){return true})")
            # The bar and the dock animate their positions (0.35 s). Under the load of
            # the full suite that outlasts any fixed wait, so the check measures with
            # transitions off: it is asking where things END UP, not how they get there.
            await ev("(function(){var st=document.createElement('style'); st.textContent='.nav,.store-dock{transition:none !important}'; document.head.appendChild(st); return true})()")
            await ev("document.fonts.ready.then(function(){return true})")
            name = url.rsplit("/", 1)[-1]
            for w in WIDTHS:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": w, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                await asyncio.sleep(0.25)
                await ev("window.__storeDock && window.__storeDock.place(); true")   # a resize re-places the dock; the emulated one fires no event
                await asyncio.sleep(0.45)   # the dock's top transitions for 0.35 s
                MEASURE = """(function(){var n=document.getElementById('nav'),l=n.querySelector('.nav-logo'),d=document.getElementById('storeDock'),h=document.getElementById('hbg');
                  var nr=n.getBoundingClientRect(),lr=l.getBoundingClientRect(),dr=d?d.getBoundingClientRect():null,hr=h.getBoundingClientRect();
                  var burger=getComputedStyle(h).display!=='none'; var links=n.querySelector('.nav-links'), kr=links?links.getBoundingClientRect():null; var first=links?links.querySelector('a,button'):null, fr=first?first.getBoundingClientRect():null;
                  var clear = !dr || (burger ? (dr.right<=hr.left+0.5 && dr.left>=nr.left) : (dr.left>=nr.right-0.5||dr.right<=nr.left+0.5));
                  var logoClear = burger || !fr || fr.left >= lr.right + 8;   /* the wordmark's glyphs overhang; 8 px of daylight is the floor */
                  var beside = burger || !dr || (dr.left - nr.right >= 12 && dr.left - nr.right <= 30 && Math.abs(dr.top - nr.top) <= 1 && Math.abs(dr.height - nr.height) <= 1);   /* beside the bar, the bar's height, top-aligned */
                  return {fits:n.scrollWidth<=n.clientWidth+1, navW:Math.round(nr.width), logoIn:lr.left>=nr.left-0.5&&lr.right<=nr.right+0.5&&logoClear, burger:burger,
                          dockClear:clear && beside, gap:dr?Math.round(dr.left-nr.right):null, dy:dr?Math.round(((dr.top+dr.bottom)-(nr.top+nr.bottom))/2):null, dock:dr?[Math.round(dr.left),Math.round(dr.right)]:null, nav:[Math.round(nr.left),Math.round(nr.right)]}})()"""
                m = await ev(MEASURE)
                ok = m["fits"] and m["logoIn"] and m["dockClear"]
                if not ok:   # a slow frame, or a real defect? Re-place and measure again; a defect fails twice.
                    await ev("window.__storeDock && window.__storeDock.place(); true"); await asyncio.sleep(0.6)
                    m = await ev(MEASURE)
                    ok = m["fits"] and m["logoIn"] and m["dockClear"]
                print(f"  {'✓' if ok else '✗'} {name:16s} {w}px  nav {m['navW']}px {m['nav']}  dock {m['dock']}  {'burger' if m['burger'] else 'bar   '} fits={m['fits']} logoIn={m['logoIn']} dockClear={m['dockClear']} gap={m['gap']} dy={m['dy']}")
                bad += 0 if ok else 1
            for w in PHONE:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": w, "height": 800, "deviceScaleFactor": 2, "mobile": True})
                await asyncio.sleep(0.25)
                await ev("window.__storeDock && window.__storeDock.place(); true"); await asyncio.sleep(0.45)
                m = await ev("""(function(){var n=document.getElementById('nav'),h=document.getElementById('hbg'),d=document.getElementById('storeDock');
                  var nr=n.getBoundingClientRect(),hr=h.getBoundingClientRect(),dr=d.getBoundingClientRect();
                  var inside=dr.left>=nr.left&&dr.right<=nr.right&&dr.top>=nr.top&&dr.bottom<=nr.bottom; var clear=dr.right<=hr.left+0.5;
                  var vis=getComputedStyle(h).display!=='none'; return {inside:inside,clear:clear,burger:vis,dock:[Math.round(dr.left),Math.round(dr.right),Math.round(dr.top),Math.round(dr.bottom)],nav:[Math.round(nr.top),Math.round(nr.bottom)],hb:[Math.round(hr.left)]}})()""")
                ok = m["inside"] and m["clear"] and m["burger"]
                print(f"  {'✓' if ok else '✗'} {name:16s} {w}px  dock inside the bar={m['inside']} left of the burger={m['clear']} {m['dock']} nav-y {m['nav']} burger-x {m['hb']}")
                bad += 0 if ok else 1
    print("RESULT: PASS" if not bad else f"RESULT: FAIL ({bad})")
    return bad


sys.exit(1 if asyncio.run(go()) else 0)
