"""Check the latency budget against independently computed great-circle
distances — the widget must not invent numbers."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets, math, base64
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9271 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died
prof = f"/tmp/cdp-globe-{P}"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1400,950","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
NYC=(40.71,-74.01)
REF={"Shanghai":(31.23,121.47),"London":(51.51,-0.13),"Tokyo":(35.68,139.69),
     "Sydney":(-33.87,151.21),"Toronto":(43.65,-79.38)}
def gc(a,b):
    p1,p2=math.radians(a[0]),math.radians(b[0])
    dp,dl=math.radians(b[0]-a[0]),math.radians(b[1]-a[1])
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 6371*2*math.atan2(math.sqrt(h),math.sqrt(1-h))
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
            if "exceptionDetails" in r.get("result",{}): return None
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.6)
        ok=True
        for name,(la,lo) in REF.items():
            v=await ev(f"JSON.stringify(window.__reachBudget && window.__reachBudget('{name}'))")
            if not v or v=="null": print(f"{name}: NO DATA"); ok=False; continue
            d=json.loads(v); mine=gc(NYC,(la,lo))
            err=abs(d["km"]-mine)/mine*100
            print(f"{name:10s} km={d['km']:8.0f} (ref {mine:8.0f}, {err:.2f}% err) "
                  f"rtt={d['rtt']:6.1f} ms  glass={d['glass']:6.1f} ms")
            if err>0.5: ok=False
        # the globe must actually paint
        painted = await ev("""(function(){var c=document.querySelector('.rg-canvas');
          if(!c) return 0; var d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          var s={}; for(var i=0;i<d.length;i+=4000) s[d[i]+','+d[i+1]+','+d[i+2]]=1;
          return Object.keys(s).length;})()""")
        print("distinct colours on canvas:", painted)
        r=await cmd("Page.captureScreenshot",{"format":"png"})
        open(sys.argv[2],"wb").write(base64.b64decode(r["result"]["data"]))
        print("RESULT:", "PASS" if ok and (painted or 0) > 3 else "FAIL")
asyncio.run(go()); p.terminate()
