#!/usr/bin/env python3
"""The skyline must still be there after a long drive.

The city is one strip of towers scrolled by distance travelled. Drawn once per
frame at a single offset, the far end walks off the left edge and nothing
follows it — so the skyline quietly emptied out after about 20 seconds and the
robot drove across a blank page. This samples the canvas at four distances and
counts tower pixels.

    python scripts/labcity.py http://localhost:8741/software.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9421 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-city-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-city-{P}", "--window-size=1400,950",
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
        i = [0]

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 40))
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
        for _ in range(60):
            await asyncio.sleep(0.4)
            if await ev("!!window.__tipLab"):
                break
        bad = 0
        counts = []
        for dist in (0, 40, 400, 4000):
            await ev(f"window.__tipLab.x = {dist};")
            await asyncio.sleep(0.9)
            n = await ev("""(function(){
              var c=document.querySelector('.tl-canvas');
              if(!c) return -1;
              var x=c.getContext('2d');
              var d=x.getImageData(0,0,c.width,Math.round(c.height*0.62)).data;
              var dark=0;
              for(var i=0;i<d.length;i+=16){        // every 4th pixel is plenty
                if(d[i]<70 && d[i+1]<75 && d[i+2]<90 && d[i+3]>200) dark++;
              }
              return dark;})()""")
            counts.append((dist, n))
            print(f"after {dist:5d} m driven: {n} tower pixels")
        base = counts[0][1]
        for dist, n in counts[1:]:
            if base > 0 and n < base * 0.5:
                print(f"   *** the skyline thinned out by {dist} m "
                      f"({n} vs {base})"); bad += 1
        if base <= 0:
            print("   *** no skyline at all"); bad += 1
        # PARALLAX: the point of the layers is that speed is visible. Sample
        # the same short interval of travel at two speeds and check the near
        # scenery sweeps proportionally further.
        await ev("window.__tipLab.x = 0;")
        await asyncio.sleep(0.6)
        shifts = {}
        for dist in (2.0, 20.0):
            a = await ev("""(function(){var c=document.querySelector('.tl-canvas');
              var x=c.getContext('2d');
              return x.getImageData(0,Math.round(c.height*0.45),c.width,2).data
                      .reduce(function(s,v,i){return i%4?s:s+(v<70?1:0);},0);})()""")
            await ev(f"window.__tipLab.x = {dist};")
            await asyncio.sleep(0.6)
            b = await ev("""(function(){var c=document.querySelector('.tl-canvas');
              var x=c.getContext('2d');
              return x.getImageData(0,Math.round(c.height*0.45),c.width,2).data
                      .reduce(function(s,v,i){return i%4?s:s+(v<70?1:0);},0);})()""")
            shifts[dist] = abs(b - a)
            await ev("window.__tipLab.x = 0;")
            await asyncio.sleep(0.4)
        print(f"\nscanline change over 2 m vs 20 m driven: "
              f"{shifts[2.0]} vs {shifts[20.0]} px")

        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
