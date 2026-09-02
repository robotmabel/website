#!/usr/bin/env python3
"""Figures must not outgrow the page's type scale, and must stay whole at
every width (viewBox SVGs scale; nothing should clip)."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P=9303
async def run(url, width):
    global P
    P += 1
    subprocess.run(["rm","-rf","/tmp/cdp-fs"])
    p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
      "--user-data-dir=/tmp/cdp-fs",f"--window-size={width},900","--hide-scrollbars",
      "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
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
            await cmd("Page.enable"); await cmd("Runtime.enable")
            await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
            await cmd("Emulation.setDeviceMetricsOverride",
                      {"width":width,"height":900,"deviceScaleFactor":1,"mobile":width<700})
            await cmd("Page.navigate",{"url":url}); await asyncio.sleep(2.8)
            r=await cmd("Runtime.evaluate",{"returnByValue":True,"expression":"""(function(){
              var out=[];
              document.querySelectorAll('.panel-frame > svg, .paper-fig svg').forEach(function(s){
                var b=s.getBoundingClientRect();
                var vb=(s.getAttribute('viewBox')||'0 0 1 1').split(/\\s+/).map(Number);
                var host=s.closest('.panel-frame,.paper-fig');
                var hb=host.getBoundingClientRect();
                out.push({w:Math.round(b.width),
                          scale:+(b.width/(vb[2]||1)).toFixed(2),
                          clipped: b.width > hb.width + 2});});
              return JSON.stringify(out);})()"""})
            d=json.loads(r["result"]["result"]["value"])
            if not d: print(f"  {width}px: no figures"); return True
            mx=max(x["scale"] for x in d); clip=[x for x in d if x["clipped"]]
            print(f"  {width:5d}px: {len(d)} figures, max scale {mx:.2f}×, "
                  f"{'no clipping' if not clip else str(len(clip))+' CLIPPED'}")
            return mx <= 1.05 and not clip
    finally:
        p.terminate()
async def main():
    ok=True
    for w in (1600, 1440, 1100, 820, 500, 390):
        ok = (await run(sys.argv[1], w)) and ok
    print("RESULT:", "PASS" if ok else "FAIL")
asyncio.run(main())
