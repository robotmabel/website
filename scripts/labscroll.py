#!/usr/bin/env python3
"""The background must sweep past in linear proportion to the robot's speed."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9313; subprocess.run(["rm","-rf","/tmp/cdp-ls"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-ls","--window-size=1400,900","--hide-scrollbars",
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
            if "exceptionDetails" in r.get("result",{}): return "JSERR "+str(r["result"]["exceptionDetails"].get("text"))
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.4)
        # drive the pure integrator at fixed dt and measure distance per second
        r = await ev("""(function(){
          var f = window.__tipStep; if(!f) return 'NO STEP FN';
          function run(cmdV){
            var S={cmd:cmdV,lift:0.0,safe:false,v:0,tilt:0,tiltRate:0,x:0,
                   braking:false,tipped:false};
            var dt=1/120;
            for(var t=0;t<3;t+=dt) f(S,dt);           // reach steady speed
            var x0=S.x;
            for(var t=0;t<1;t+=dt) f(S,dt);           // one second of travel
            return {v:+S.v.toFixed(3), dx:+(S.x-x0).toFixed(3)};
          }
          var a=run(0.3), b=run(0.6), c=run(1.2);
          return JSON.stringify({a:a,b:b,c:c,
            ratio_b_a:+(b.dx/a.dx).toFixed(2), ratio_c_a:+(c.dx/a.dx).toFixed(2)});})()""")
        d = json.loads(r)
        print("0.3 m/s →", d["a"], " 0.6 m/s →", d["b"], " 1.2 m/s →", d["c"])
        print(f"scroll ratio 0.6/0.3 = {d['ratio_b_a']} (want 2.0), "
              f"1.2/0.3 = {d['ratio_c_a']} (want 4.0)")
        ok = abs(d["ratio_b_a"]-2) < 0.15 and abs(d["ratio_c_a"]-4) < 0.3
        print("RESULT:", "PASS — background speed is linear in robot speed" if ok else "FAIL")
asyncio.run(go()); p.terminate()
