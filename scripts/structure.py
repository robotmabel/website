#!/usr/bin/env python3
"""Tag balance and dangling-anchor check for every page.

Tag balance is read from the SOURCE, because that is where an unclosed tag is.
Anchors are checked against the RENDERED DOM: the hardware slider and the scene
gallery build their sections from JSON at runtime, so their ids do not exist in
the file — and a source-only check called every one of them dangling while the
links worked perfectly in a browser.
"""
import asyncio, json, re, subprocess, sys, time, urllib.request, urllib.parse
import websockets

TAGS = ('section', 'div', 'figure', 'ol', 'li', 'p', 'table', 'video')
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9381 + random.randrange(40)   # a fresh port per run: two
                                # checks in flight used to collide on one profile
subprocess.run(["rm", "-rf", f"/tmp/cdp-struct-{P}"])
proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                         f"--user-data-dir=/tmp/cdp-struct-{P}", "--window-size=1400,900",
                         "--hide-scrollbars", "--use-angle=swiftshader",
                         "--enable-unsafe-swiftshader", "about:blank"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def main():
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    bad_total = 0
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
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})

        for page in sys.argv[1:]:
            h = urllib.request.urlopen(page, timeout=25).read().decode()
            bad = []
            for t in TAGS:
                o = len(re.findall(r'<' + t + r'[\s>]', h))
                cl = len(re.findall(r'</' + t + r'>', h))
                if o != cl:
                    bad.append(f"{t} {o}/{cl}")

            await cmd("Page.navigate", {"url": page})
            for _ in range(30):
                await asyncio.sleep(0.4)
                if await ev("document.readyState==='complete'"):
                    break
            await asyncio.sleep(2.2)          # let the JS-built sections mount
            live = json.loads(await ev("""JSON.stringify({
              ids: [].slice.call(document.querySelectorAll('[id]'))
                     .map(function(e){return e.id;}),
              hrefs: [].slice.call(document.querySelectorAll('a[href^="#"]'))
                     .map(function(a){return a.getAttribute('href').slice(1);})})"""))
            ids = set(live["ids"])
            dang = sorted({a for a in live["hrefs"] if a and a not in ids})
            name = page.rsplit("/", 1)[-1]
            print("%-14s %-28s %s" % (
                name,
                "tags OK" if not bad else "TAGS " + ",".join(bad),
                "anchors OK" if not dang else "DANGLING " + str(dang)))
            bad_total += len(bad) + len(dang)
    print("RESULT:", "PASS" if bad_total == 0 else "FAIL")


asyncio.run(main())
proc.terminate()
