#!/usr/bin/env python3
"""The hardware slider must scroll, open, and link somewhere real.

The section it replaced had "— full page →" buttons that linked to the tab you
were already reading, so this checks the thing that was actually broken: every
button either scrolls the rail or opens a sheet with parts, prices and outbound
links, and no link on the page points at its own anchor.

    python scripts/hwtest.py http://localhost:8741/hardware.html
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9341
subprocess.run(["rm", "-rf", "/tmp/cdp-hw"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      "--user-data-dir=/tmp/cdp-hw", "--window-size=1400,950",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/hardware.html"
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
                r = json.loads(await c.recv())
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description")
                                    or d.get("text"))[:150])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True})
            if "exceptionDetails" in r.get("result", {}):
                return "JSERR " + str(r["result"]["exceptionDetails"].get("text"))[:100]
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Page.navigate", {"url": url})
        for _ in range(40):
            await asyncio.sleep(0.4)
            if await ev("!!window.__hwSlider"):
                break
        bad = 0

        n = await ev("document.querySelectorAll('.hs-card').length")
        # Fetch each portrait rather than reading naturalWidth: the cards past
        # the second are loading="lazy", so an off-screen one is legitimately
        # `complete: false` and the first version of this check failed on two
        # images that were perfectly fine.
        r = await cmd("Runtime.evaluate", {"expression": """(async function(){
            var srcs=[].slice.call(document.querySelectorAll('.hs-card img'))
              .map(function(i){return i.getAttribute('src');});
            var bad=[];
            for (var s of srcs){
              try { var q = await fetch(s); if(!q.ok) bad.push(s); }
              catch(e){ bad.push(s); }
            }
            return bad.length;})()""", "returnByValue": True, "awaitPromise": True})
        imgs = r.get("result", {}).get("result", {}).get("value", 0)
        print(f"cards {n}   images that failed to load {imgs}")
        if not n or n < 8:
            print("   *** the slider did not build"); bad += 1
        if imgs:
            print("   *** a module portrait is missing"); bad += 1

        # scrolling actually moves the rail
        before = await ev("document.querySelector('.hs-rail').scrollLeft")
        await ev("window.__hwSlider.step(1)")
        await asyncio.sleep(0.9)
        after = await ev("document.querySelector('.hs-rail').scrollLeft")
        print(f"rail scrollLeft {before} → {after}")
        if not after > before + 50:
            print("   *** the next arrow does not move the rail"); bad += 1

        # every card opens a sheet with parts AND outbound links
        rep = json.loads(await ev("""(function(){
          var out=[];
          window.__hwSlider.modules.forEach(function(m){
            window.__hwSlider.open(m);
            var s=document.querySelector('.hs-sheet-in');
            out.push({id:m.id,
              rows:s.querySelectorAll('.hs-table tbody tr').length,
              links:s.querySelectorAll('.hs-table a[href^="http"]').length,
              specs:s.querySelectorAll('.hs-specs.wide div').length,
              files:s.querySelectorAll('.hs-files li').length,
              price:m.price});
            window.__hwSlider.close();
          });
          return JSON.stringify(out);})()"""))
        print()
        for r in rep:
            print(f"  {r['id']:12s} {r['rows']:2d} part rows · {r['links']:2d} links · "
                  f"{r['specs']} specs · {r['files']} repo paths · ${r['price']:,.0f}")
            if r["rows"] == 0:
                print("     *** no parts listed"); bad += 1
            if r["specs"] < 4:
                print("     *** thin on specs"); bad += 1
            if r["files"] == 0:
                print("     *** no repo pointers"); bad += 1
        if sum(r["links"] for r in rep) < 30:
            print("   *** almost nothing links out to a vendor"); bad += 1

        # No link in the PAGE BODY may point at the page's own anchor -- that
        # was the original defect ("Hands - full page" going to the hands tab
        # you were reading). The nav's own #hw- anchors are exempt: they are
        # deep links that scroll the rail, and the next check proves they work.
        self_links = json.loads(await ev("""JSON.stringify(
          [].slice.call(document.querySelectorAll('main a[href], section a[href]'))
            .filter(function(a){return !a.closest('.nav,.mob,.sub,footer');})
            .map(function(a){return a.getAttribute('href');})
            .filter(function(h){return /^hardware\\.html#/.test(h);}))"""))
        print(f"\nself-referencing body links {len(self_links)} {self_links[:4]}")
        if self_links:
            print("   *** a link points at the page it is on"); bad += 1

        # the nav deep links must actually move the rail
        await ev("document.querySelector('.hs-rail').scrollLeft = 0")
        await ev("location.hash = '#hw-sensors'")
        await asyncio.sleep(1.2)
        moved = await ev("document.querySelector('.hs-rail').scrollLeft")
        print(f"#hw-sensors scrolled the rail to {moved}")
        if not moved > 200:
            print("   *** the nav deep link does not reach its card"); bad += 1

        print("errors:", errs[:3] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
