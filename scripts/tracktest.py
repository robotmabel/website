#!/usr/bin/env python3
"""Drag a palm target and check the HAND actually follows it, in every mode.

Measures the distance from the end-effector to the green ball before and
after letting the solver run. If the arm is not tracking, that distance stays
at the full pull length — which is exactly what nav mode used to do.
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9311 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died; subprocess.run(["rm","-rf",f"/tmp/cdp-tt-{P}"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-tt","--window-size=1400,950","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def go():
    for _ in range(40):
        try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception: time.sleep(0.4)
    ws=[t for t in tabs if t["type"]=="page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i=[0]
        async def cmd(m,pp=None):
            i[0]+=1; await c.send(json.dumps({"id":i[0],"method":m,"params":pp or {}}))
            while True:
                r=json.loads(await c.recv())
                if r.get("id")==i[0]: return r
        async def ev(e):
            r=await cmd("Runtime.evaluate",{"expression":e,"returnByValue":True})
            if "exceptionDetails" in r.get("result",{}):
                return "JSERR "+str(r["result"]["exceptionDetails"].get("text"))
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(4.0)
        # The 3-D modules are deferred until their canvas nears the viewport
        # (assets/defer-module.js), so a check that waits for their test hook
        # waits forever. Ask for them — but RETRY, because right after
        # Page.navigate the loader script has not run yet and the hook it
        # installs does not exist.
        for _ in range(40):
            if await ev("!!(window.__loadDeferred && window.__loadDeferred())"):
                break
            await asyncio.sleep(0.15)
        for _ in range(30):
            if await ev("!!(window.__wbc && window.__wbc.grabOff && window.__wbc.ready)"): break
            await asyncio.sleep(1.0)
        SIM = """(function(mode, pull){
          var v = window.__wbc; if(!v || !v.grabOff) return 'NOT READY';
          v.opMode = mode; if (v._applyOpMode) v._applyOpMode();
          v.stiff = false;
          var s = 'r';
          v.grabOff[s].set(0,0,0); v.grabSmooth[s].set(0,0,0);
          v._grabSide = function(){ return s; };          // held, so no spring-back
          v.grabOff[s].set(pull, 0, 0);
          var before = null, after = null;
          for (var k = 0; k < 240; k++) {
            v._stepOperate(1/60);
            if (k === 0) {
              var ee0 = new (v.gTarget[s].constructor)();
              v.eeNode && v.eeNode[s] ? v.eeNode[s].getWorldPosition(ee0)
                                      : v.greenDot[s].getWorldPosition(ee0);
              before = ee0.distanceTo(v.gTarget[s]);
            }
          }
          var ee = new (v.gTarget[s].constructor)();
          var tip = (v.eeNode && v.eeNode[s]) || v._eeFor && v._eeFor(s);
          if (!tip) { tip = v.greenDot[s]; }
          tip.getWorldPosition(ee);
          after = ee.distanceTo(v.gTarget[s]);
          return JSON.stringify({pull:pull, before:+before.toFixed(3),
                                 after:+after.toFixed(3),
                                 offset:+v.grabSmooth[s].length().toFixed(3)});
        })"""
        await ev("window.__sim = " + SIM)
        ok = True
        for mode in ('nav', 'arm', 'whole'):
            r = await ev(f"__sim('{mode}', 0.30)")
            print(f"  {mode:6s} {r}")
            try:
                d = json.loads(r)
                if d["after"] > max(0.08, d["before"] * 0.5): ok = False
            except Exception:
                ok = False
        print("RESULT:", "PASS — the hand closes on the ball" if ok
              else "FAIL — the hand is not tracking")
asyncio.run(go()); p.terminate()
