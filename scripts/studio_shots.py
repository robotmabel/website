#!/usr/bin/env python3
"""Screenshot the two live studios with something actually loaded.

A shot of an empty tool shows chrome and no work. This drives each studio far
enough to have data on screen — the curation studio loads its first dataset and
opens an episode; the trainer opens its architecture graph — and then captures.

    python scripts/studio_shots.py
"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "assets", "studios")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    {
        "name": "curation",
        "url": "https://studio.mabelrobot.duckdns.org/",
        # click the first "Load all" in the library, then the first episode card
        "steps": [
            ("click_text", "Load all"),
            ("wait", 6),
            ("click", ".ep-card, .episode, [data-episode], .lib-ep"),
            ("wait", 8),
        ],
    },
    {
        "name": "trainer",
        "url": "https://trainer.mabelrobot.duckdns.org/",
        "steps": [
            ("wait", 4),
            ("click_text", "Architecture"),
            ("wait", 6),
        ],
    },
]


async def shoot(job, W=1800, H=1125):
    port = 9361 + hash(job["name"]) % 40
    prof = f"/tmp/cdp-studio-{job['name']}"
    subprocess.run(["rm", "-rf", prof])
    p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}",
                          f"--user-data-dir={prof}", f"--window-size={W},{H}",
                          "--hide-scrollbars", "--force-device-scale-factor=2",
                          "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                          "about:blank"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
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
            await cmd("Page.navigate", {"url": job["url"]})
            await asyncio.sleep(6)
            for kind, arg in job["steps"]:
                if kind == "wait":
                    await asyncio.sleep(arg)
                elif kind == "click":
                    hit = await ev(f"""(function(){{
                        var e=document.querySelector({arg!r});
                        if(!e) return 0; e.click(); return 1;}})()""")
                    print(f"  click {arg!r} -> {'ok' if hit else 'not found'}")
                elif kind == "click_text":
                    hit = await ev(f"""(function(){{
                        var t={arg!r}.toLowerCase();
                        var all=[].slice.call(document.querySelectorAll(
                          'button,a,[role=button],.btn'));
                        var e=all.filter(function(x){{
                          return (x.textContent||'').toLowerCase().indexOf(t)>=0;}})[0];
                        if(!e) return 0; e.click(); return 1;}})()""")
                    print(f"  click text {arg!r} -> {'ok' if hit else 'not found'}")
            await asyncio.sleep(3)
            r = await cmd("Page.captureScreenshot", {"format": "png"})
            path = os.path.join(OUT, job["name"] + ".png")
            with open(path, "wb") as f:
                f.write(base64.b64decode(r["result"]["data"]))
            print(f"wrote {os.path.relpath(path, os.path.dirname(HERE))} "
                  f"({os.path.getsize(path)//1024} kB)")
    finally:
        p.terminate()


async def main():
    for job in JOBS:
        print(f"[{job['name']}] {job['url']}")
        try:
            await shoot(job)
        except Exception as e:
            print(f"  FAILED: {type(e).__name__}: {e}")


asyncio.run(main())
