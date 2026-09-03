"""Drag a palm in each stiffness mode and check the two laws differ:
soft must keep the displacement after release; stiff must return."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9269 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died
prof = f"/tmp/cdp-stiff-{P}"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1400,950","--hide-scrollbars",
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
            r=await cmd("Runtime.evaluate",{"expression":e,"returnByValue":True,"awaitPromise":True})
            if "exceptionDetails" in r.get("result",{}):
                d=r["result"]["exceptionDetails"]
                return "JSERR "+str(d.get("text"))+" | "+str((d.get("exception") or {}).get("description"))[:300]
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(4.0)
        for _ in range(30):
            if await ev("!!(window.__wbc && window.__wbc.grabOff)"): break
            await asyncio.sleep(1.0)
        print("widget present:", await ev("!!document.querySelector('[data-wbc-stiff]')"))
        # drive the viewer object directly: rAF is throttled headless, so step it
        sim = """(function(mode, pull){
          var v = window.__wbc; if(!v) return 'NO VIEWER';
          if(!v.grabOff) return 'NOT READY: grabOff missing (ready=' + v.ready + ')';
          if (v.opMode === 'nav') { v.opMode = 'arm'; v._applyOpMode && v._applyOpMode(); }
          v.stiff = (mode === 'stiff');
          var s = 'r';
          v.grabOff[s].set(0,0,0);
          // simulate a drag of `pull` metres, applying the same law the
          // pointermove handler applies
          var delta = v.grabOff[s].clone().set(pull, 0, 0);
          v.grabOff[s].copy(v.stiff ? delta.multiplyScalar(v.K_STIFF) : delta);
          var during = v.grabOff[s].length();
          // release: run the law for 1.5 s
          v._grabSide = function(){ return null; };
          for (var k=0;k<90;k++) v._stepGrab(1/60);
          var after = v.grabOff[s].length();
          return JSON.stringify({during:+during.toFixed(3), after:+after.toFixed(3)});
        })"""
        await ev("window.__sim = " + sim)
        soft = await ev("__sim('soft', 0.25)")
        stiff = await ev("__sim('stiff', 0.25)")
        print("soft  (pull 0.250 m):", soft)
        print("stiff (pull 0.250 m):", stiff)
asyncio.run(go()); p.terminate()
