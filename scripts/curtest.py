#!/usr/bin/env python3
"""The curation lab must FIND the faults that are really in the episodes.

render_curation_clips.py injects a known fault into two of the three takes; the
browser detector is a port of learning/data_curation/server/quality.py. If the
port drifts, the demo starts performing a result instead of producing one — so
this asserts each injected fault is found, the clean take scores 1.00, and the
editor's blade / trim / delete actually change the edit.

    python scripts/curtest.py http://localhost:8741/autonomy.html
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9351
subprocess.run(["rm", "-rf", "/tmp/cdp-cur"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      "--user-data-dir=/tmp/cdp-cur", "--window-size=1400,950",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

WANT = {"ep01": [], "ep02": ["frozen", "gap"], "ep03": ["rate"]}


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/autonomy.html"
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
                return "JSERR " + str(r["result"]["exceptionDetails"].get("text"))[:120]
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Page.navigate", {"url": url})
        for _ in range(50):
            await asyncio.sleep(0.4)
            if await ev("!!window.__curationLab"):
                break
        bad = 0

        rep = json.loads(await ev("""JSON.stringify(
          Object.keys(window.__curationLab.report).reduce(function(o,k){
            var r=window.__curationLab.report[k];
            o[k]={score:r.score, types:r.defects.map(function(d){return d.type;}),
                  labels:r.defects.map(function(d){return d.label;})};
            return o;},{}))"""))
        for ep, want in WANT.items():
            got = rep.get(ep, {})
            types = got.get("types", [])
            print(f"{ep}  score {got.get('score')}  found {types or 'nothing'}")
            for lab in got.get("labels", []):
                print(f"        {lab}")
            missing = [w for w in want if w not in types]
            if missing:
                print(f"   *** injected {missing} was not detected"); bad += 1
            if not want:
                if types:
                    print("   *** the clean take was flagged"); bad += 1
                if got.get("score") != 1.0:
                    print("   *** the clean take did not score 1.00"); bad += 1
            elif got.get("score", 1) >= 1.0:
                print("   *** a faulty take scored a clean 1.00"); bad += 1

        # the editor actually edits
        n0 = await ev("window.__curationLab.edl().length")
        await ev("window.__curationLab.seek(60); window.__curationLab.act('blade')")
        n1 = await ev("window.__curationLab.edl().length")
        t0 = await ev("window.__curationLab.total()")
        await ev("window.__curationLab.act('del')")
        n2 = await ev("window.__curationLab.edl().length")
        t1 = await ev("window.__curationLab.total()")
        print(f"\nclips {n0} → blade {n1} → ripple delete {n2}   "
              f"frames {t0} → {t1}")
        if not (n1 == n0 + 1):
            print("   *** blade did not split a clip"); bad += 1
        if not (n2 == n1 - 1 and t1 < t0):
            print("   *** ripple delete did not shorten the edit"); bad += 1

        print("errors:", errs[:3] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
