#!/usr/bin/env python3
"""Screenshot a page, or one element on it, so a layout can be LOOKED at.

    python scripts/shot.py <url> <out.png> [selector] [width] [height]

Waits for webfonts and for any three.js canvas the page exposes, because
capturing before those settle is how a passing screenshot check once got taken
of a robot that had fallen over.
"""
import asyncio, base64, json, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import os, random
P = 9331 + random.randrange(60)   # a fresh port per run, so two
prof = f"/tmp/cdp-shot-{P}"      # screenshots in a row do not collide
url = sys.argv[1]
out = sys.argv[2]
sel = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "-" else None
W = int(sys.argv[4]) if len(sys.argv) > 4 else 1440
H = int(sys.argv[5]) if len(sys.argv) > 5 else 1000

subprocess.run(["rm", "-rf", prof])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={prof}", f"--window-size={W},{H}",
                      "--hide-scrollbars", "--force-device-scale-factor=2",
                      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                      "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
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
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Emulation.setDeviceMetricsOverride",
                  {"width": W, "height": H, "deviceScaleFactor": 2, "mobile": False})
        await cmd("Page.navigate", {"url": url})
        await asyncio.sleep(2.0)
        for _ in range(30):
            if await ev("document.fonts.status==='loaded' && document.readyState==='complete'"):
                break
            await asyncio.sleep(0.3)
        clip = None
        if sel:
            for _ in range(40):
                await ev(f"(document.querySelector({sel!r})||{{scrollIntoView:function(){{}}}})"
                         ".scrollIntoView({block:'center',behavior:'instant'})")
                await asyncio.sleep(0.4)
                r = await ev(f"""(function(){{var e=document.querySelector({sel!r});
                  if(!e) return null; var b=e.getBoundingClientRect();
                  return JSON.stringify({{x:b.x+scrollX,y:b.y+scrollY,
                    w:b.width,h:b.height}});}})()""")
                if r:
                    b = json.loads(r)
                    if b["h"] > 40:
                        clip = {"x": max(0, b["x"] - 8), "y": max(0, b["y"] - 8),
                                "width": min(W, b["w"] + 16),
                                "height": min(H * 4, b["h"] + 16), "scale": 1}
                        break
        await asyncio.sleep(2.5)      # let three.js paint a few frames
        pp = {"format": "png", "captureBeyondViewport": True}
        if clip:
            pp["clip"] = clip
        r = await cmd("Page.captureScreenshot", pp)
        data = r["result"]["data"]
        with open(out, "wb") as f:
            f.write(base64.b64decode(data))
        print(f"wrote {out}  ({len(data)*3//4//1024} kB)"
              + (f"  clip {clip['width']:.0f}×{clip['height']:.0f}" if clip else ""))


asyncio.run(go())
p.terminate()
