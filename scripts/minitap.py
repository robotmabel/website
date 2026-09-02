"""On a phone, scroll past the hero so the robot docks, tap it, and check a
comic sound effect appears ON SCREEN at a size that suits the small model."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets, base64
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9283; prof="/tmp/cdp-mini"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=390,844","--hide-scrollbars",
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
        await cmd("Emulation.setDeviceMetricsOverride",
                  {"width":390,"height":844,"deviceScaleFactor":2,"mobile":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(6.0)
        await ev("window.scrollTo({top:1600,behavior:'instant'})")
        await asyncio.sleep(1.5)
        st = await ev("""(function(){var b=document.querySelector('.hero-rig');
          if(!b) return JSON.stringify({found:false});
          var r=b.getBoundingClientRect();
          return JSON.stringify({found:true, mini:b.classList.contains('mini'),
            x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
            w:Math.round(r.width), h:Math.round(r.height)});})()""")
        d=json.loads(st); print("dock:", d)
        if not d.get("mini"): print("RESULT: FAIL — robot did not dock"); return
        for n in range(3):
            for ty in ("mousePressed","mouseReleased"):
                await cmd("Input.dispatchMouseEvent",{"type":ty,"x":d["x"],"y":d["y"],
                          "button":"left","clickCount":1})
            await asyncio.sleep(0.45)
            sfx = await ev("""(function(){var e=document.querySelector('.sfx');
              if(!e) return JSON.stringify({sfx:false});
              var r=e.getBoundingClientRect(), cs=getComputedStyle(e);
              return JSON.stringify({sfx:true, text:e.textContent,
                onScreen: r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight,
                fontPx: Math.round(parseFloat(cs.fontSize)),
                pos: cs.position, top:Math.round(r.top), left:Math.round(r.left)});})()""")
            print(f"  tap {n+1}:", sfx)
            await asyncio.sleep(1.2)
        r=await cmd("Page.captureScreenshot",{"format":"png"})
        open(sys.argv[2],"wb").write(base64.b64decode(r["result"]["data"]))
asyncio.run(go()); p.terminate()
