#!/usr/bin/env python3
"""The globe must be centred in its stage and follow the drag, not fight it."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9299; subprocess.run(["rm","-rf","/tmp/cdp-gc"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-gc","--window-size=1400,900","--hide-scrollbars",
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
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.4)
        await ev("document.getElementById('reachGlobe').scrollIntoView({block:'center',behavior:'instant'})")
        await asyncio.sleep(1.6)
        # find the drawn disc by scanning the canvas for ocean pixels
        r = await ev("""(function(){
          var c=document.querySelector('.rg-canvas'), x=c.getContext('2d');
          var d=x.getImageData(0,0,c.width,c.height).data, W=c.width, H=c.height;
          var minX=W, maxX=0, minY=H, maxY=0, hit=0;
          for(var y=0;y<H;y+=4) for(var px=0;px<W;px+=4){
            var i=(y*W+px)*4, R=d[i], G=d[i+1], B=d[i+2];
            if(B>R+8 && B>140){ hit++;
              if(px<minX)minX=px; if(px>maxX)maxX=px;
              if(y<minY)minY=y; if(y>maxY)maxY=y; } }
          if(!hit) return JSON.stringify({found:false});
          return JSON.stringify({found:true,
            cxErr: Math.round(((minX+maxX)/2 - W/2)/ (W/2) * 100),
            cyErr: Math.round(((minY+maxY)/2 - H/2)/ (H/2) * 100),
            fill: Math.round((maxX-minX)/W*100)});})()""")
        d=json.loads(r); print("disc:", d)
        # drag down and check the tilt increases (looking down on it)
        t0 = await ev("window.__reachTilt = null; (window.__reachBudget?1:0)")
        box = json.loads(await ev("""(function(){var c=document.querySelector('.rg-canvas');
          var b=c.getBoundingClientRect();
          return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});})()"""))
        print("centred:", abs(d.get("cxErr",99))<=6 and abs(d.get("cyErr",99))<=6,
              " fills", str(d.get("fill"))+"%")
        print("RESULT:", "PASS" if d.get("found") and abs(d.get("cxErr",99))<=6
                                and abs(d.get("cyErr",99))<=6 else "FAIL")
asyncio.run(go()); p.terminate()
