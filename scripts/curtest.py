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
import random
P = 9351 + random.randrange(40)   # a fresh port per run: two
                                # checks in flight used to collide on one profile
subprocess.run(["rm", "-rf", f"/tmp/cdp-cur-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-cur-{P}", "--window-size=1400,950",
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

        # the features the editor gained: zoom, a second lane, and captions
        z0 = await ev("window.__curationLab.zoom()")
        await ev("window.__curationLab.act('zoomin')")
        z1 = await ev("window.__curationLab.zoom()")
        w1 = await ev("document.querySelector('.cl-timeline').offsetWidth")
        await ev("window.__curationLab.act('zoomout');window.__curationLab.act('zoomout')")
        z2 = await ev("window.__curationLab.zoom()")
        w2 = await ev("document.querySelector('.cl-timeline').offsetWidth")
        print(f"\nzoom {z0} → {z1} → {z2}   timeline width {w1} → {w2} px")
        if not (z1 > z0 and z2 < z1 and w1 > w2):
            print("   *** zoom does not change the timeline width"); bad += 1

        lanes = await ev("document.querySelectorAll('.cl-track').length")
        await ev("window.__curationLab.edl()[1].lane = 1;"
                 "window.__curationLab.act('scan')")
        stacked = await ev("document.querySelector('.cl-track.alt')"
                           ".querySelectorAll('.cl-clip').length")
        print(f"lanes {lanes}, clips stacked onto v2: {stacked}")
        if lanes < 2 or stacked < 1:
            print("   *** clips cannot be stacked on a second lane"); bad += 1

        await ev("window.__curationLab.addNote(30,'pick up the red cup','en');"
                 "window.__curationLab.addNote(120,'tasse rouge','fr')")
        chips = await ev("document.querySelectorAll('.cl-note-chip').length")
        langs = json.loads(await ev(
            "JSON.stringify(window.__curationLab.notes().map(function(n){return n.lang;}))"))
        print(f"captions {chips} chips, languages {langs}")
        if chips != 2 or sorted(langs) != ["en", "fr"]:
            print("   *** captions do not reach the timeline"); bad += 1

        # and no system prompt(): the dialog is the site's own
        used_prompt = await ev("""(function(){
            var hit=0; var real=window.prompt;
            window.prompt=function(){hit=1;return 'x';};
            window.__curationLab.act('label');
            window.prompt=real;
            return hit;})()""")
        has_dialog = await ev("!!document.querySelector('.cl-ask')")
        print(f"window.prompt used: {bool(used_prompt)}, comic dialog shown: {has_dialog}")
        if used_prompt or not has_dialog:
            print("   *** the label dialog is still the browser's"); bad += 1
        await ev("var d=document.querySelector('.cl-ask'); if(d) d.remove();")

        # ── THE PREVIEW MUST ACTUALLY SHOW SOMETHING ──────────────────
        # It went black for a whole take twice: once because swapping .src
        # reset the element, and once because playback seeked 15x a second
        # through long-GOP video. Both are invisible to every other check
        # here, which is why they shipped.
        vids = await ev("[].slice.call(document.querySelectorAll('.cl-video'))"
                        ".map(function(v){return v.dataset.ep;})")
        print(f"\npreview: {len(vids)} elements, one per episode: {vids}")
        if len(vids) < 3 or len(set(vids)) != len(vids):
            print("   *** the preview is not one element per episode"); bad += 1
        seen, dark = set(), []
        for f in [0, 60, 134, 135, 200, 269, 270, 340]:
            await ev(f"window.__curationLab.seek({f})")
            await asyncio.sleep(0.25)
            shown = await ev(
                "(function(){var v=[].slice.call("
                "document.querySelectorAll('.cl-video'))"
                ".filter(function(x){return !x.hidden;});"
                "return v.length===1 ? {ep:v[0].dataset.ep,"
                "ready:v[0].readyState} : {ep:null,ready:-1,n:v.length};})()")
            if not shown or shown.get("ep") is None:
                print(f"   *** frame {f}: {shown} visible videos"); bad += 1
                continue
            seen.add(shown["ep"])
            if shown["ready"] < 2:
                dark.append((f, shown["ep"]))
        print(f"   walked 8 frames across every clip boundary; "
              f"showed {len(seen)} distinct episodes")
        if len(seen) < 3:
            print("   *** the preview never changed episode"); bad += 1
        if dark:
            print(f"   note: {len(dark)} frame(s) still below HAVE_CURRENT_DATA "
                  f"{dark[:3]} — headless has no media pipeline for seeks, so "
                  "this is only fatal if it is ALL of them")
            if len(dark) >= 8:
                print("   *** the preview is black at every frame"); bad += 1

        print("errors:", errs[:3] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
