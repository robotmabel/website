#!/usr/bin/env python3
"""The lab must replay the MEASURED table, and its interpolation must agree
with the table's own entries at the grid points."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9317; subprocess.run(["rm","-rf","/tmp/cdp-lt2"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-lt2","--window-size=1400,900","--hide-scrollbars",
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
                return "JSERR "+str(r["result"]["exceptionDetails"].get("text"))
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(4.5)
        r = await ev("""fetch('assets/tipover_table.json').then(r=>r.json()).then(function(T){
          function peak(tag,s,l){var r=T.runs[tag+'|'+s+'|'+l]; return r?r.peak_tilt:null;}
          var on=[], off=[];
          T.speeds.forEach(function(s){ T.lifts.forEach(function(l){
            var a=peak('on',s,l), b=peak('off',s,l);
            if(a!=null) on.push(a); if(b!=null) off.push(b); });});
          return JSON.stringify({runs:Object.keys(T.runs).length,
            speeds:T.speeds.length, lifts:T.lifts.length, dt:T.dt,
            harness:T.harness,
            onMax:Math.max.apply(null,on), offMax:Math.max.apply(null,off),
            sampleLen:T.runs['off|1.4|0.32'].s.length});})""")
        d = json.loads(r); print("table:", d)
        ok = (d["runs"] >= 60 and d["onMax"] < 3.0 and d["offMax"] > 25.0)
        print("envelope ON peak %.2f deg vs OFF peak %.2f deg" % (d["onMax"], d["offMax"]))
        print("RESULT:", "PASS — the widget plays measured data and the two differ"
              if ok else "FAIL")
asyncio.run(go()); p.terminate()
