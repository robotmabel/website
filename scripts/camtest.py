#!/usr/bin/env python3
"""The retargeting demo must render the real rig and stay inert until the
reader starts the camera (no getUserMedia on page load)."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9307; subprocess.run(["rm","-rf","/tmp/cdp-rc"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-rc","--window-size=1400,900","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def go():
    for _ in range(40):
        try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception: time.sleep(0.4)
    ws=[t for t in tabs if t["type"]=="page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i=[0]; errs=[]
        async def cmd(m,pp=None):
            i[0]+=1; await c.send(json.dumps({"id":i[0],"method":m,"params":pp or {}}))
            while True:
                r=json.loads(await c.recv())
                if r.get("method")=="Runtime.exceptionThrown":
                    d=r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description") or d.get("text"))[:180])
                if r.get("id")==i[0]: return r
        async def ev(e):
            r=await cmd("Runtime.evaluate",{"expression":e,"returnByValue":True})
            if "exceptionDetails" in r.get("result",{}): return "JSERR"
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        # trip if anything asks for the camera without a click
        await cmd("Runtime.evaluate",{"expression":
          "navigator.mediaDevices.getUserMedia = function(){window.__askedForCam=1;"
          "return Promise.reject(new Error('blocked by test'));};"})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(4.0)
        await ev("document.getElementById('retargetCam').scrollIntoView({block:'center',behavior:'instant'})")
        await asyncio.sleep(5.0)
        st = json.loads(await ev("""JSON.stringify({
          mounted: !!document.querySelector('.rc-grid'),
          idleShown: !document.querySelector('.rc-idle').hidden,
          askedForCam: !!window.__askedForCam,
          rig: window.__rcReady || null,
          painted: (function(){var c=document.querySelector('.rc-3d');
            if(!c||!c.width) return 0;
            var gl=c.getContext('webgl2')||c.getContext('webgl');
            if(!gl) return -1;
            var px=new Uint8Array(4*64);
            gl.readPixels(c.width/2-8,c.height/2-8,8,8,gl.RGBA,gl.UNSIGNED_BYTE,px);
            var s=new Set(); for(var i=0;i<px.length;i+=4) s.add(px[i]+','+px[i+1]+','+px[i+2]);
            return s.size;})()})"""))
        print("demo:", st)
        print("errors:", errs[:2] or "none")
        ok = st["mounted"] and st["idleShown"] and not st["askedForCam"]
        print("RESULT:", "PASS" if ok else "FAIL")
asyncio.run(go()); p.terminate()
