import asyncio, json, subprocess, sys, time, urllib.request, websockets, base64
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9275 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died
prof = f"/tmp/cdp-bt-{P}"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1440,950","--hide-scrollbars",
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
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.4)
        print("rows rendered:", await ev("document.querySelectorAll('#bomTable tbody tr').length"))
        print("count line:", await ev("(document.querySelector('.bt-count')||{}).textContent"))
        # hover the third row and check the preview
        await ev("document.querySelector('#bomTable').scrollIntoView({block:'center',behavior:'instant'})")
        await asyncio.sleep(0.4)
        box = await ev("""(function(){
          var rows=[...document.querySelectorAll('#bomTable tbody tr')];
          var tr=rows.find(function(r){var b=r.getBoundingClientRect();
            return b.top>90 && b.bottom<innerHeight-20 && b.height>0;});
          if(!tr) return JSON.stringify({err:'no row in viewport'});
          var b=tr.getBoundingClientRect();
          return JSON.stringify({x:Math.round(b.left+60),y:Math.round(b.top+b.height/2),
                                 ref:tr.dataset.ref});})()""")
        q=json.loads(box)
        if q.get('err'): print('hover skipped:', q['err'])
        else:
            print("hovering row", q["ref"])
            for dx in (-40,-20,0):
                await cmd("Input.dispatchMouseEvent",{"type":"mouseMoved","x":q["x"]+dx,"y":q["y"]})
                await asyncio.sleep(0.12)
            await asyncio.sleep(0.5)
        print("preview:", await ev("""JSON.stringify({
          shown: !document.querySelector('.bt-preview').hidden,
          name: (document.querySelector('.bt-pv-name')||{}).textContent,
          price: (document.querySelector('.bt-pv-price')||{}).textContent,
          hasArt: !!document.querySelector('.bt-pv-art svg, .bt-pv-art img')})"""))
        # filtering
        await ev("""(function(){var b=[...document.querySelectorAll('.bt-filters button')]
          .find(x=>x.dataset.sec==='Hands - both'); if(b) b.click();})()""")
        await asyncio.sleep(0.4)
        print("filtered:", await ev("document.querySelectorAll('#bomTable tbody tr').length"),
              await ev("(document.querySelector('.bt-count')||{}).textContent"))
        await ev("[...document.querySelectorAll('.bt-filters button')].find(x=>x.dataset.sec==='').click()")
        await asyncio.sleep(0.3)
        await ev("document.querySelector('#bomTable').scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-70)")
        await asyncio.sleep(0.4)
        box2 = await ev("""(function(){
          var rows=[...document.querySelectorAll('#bomTable tbody tr')];
          var tr=rows.find(function(r){var b=r.getBoundingClientRect();
            return b.top>200 && b.bottom<innerHeight-40;});
          if(!tr) return '{}';
          var b=tr.getBoundingClientRect();
          return JSON.stringify({x:Math.round(b.left+70),y:Math.round(b.top+b.height/2)});})()""")
        q2=json.loads(box2)
        if q2:
            for dx in (-40,-20,0):
                await cmd("Input.dispatchMouseEvent",{"type":"mouseMoved","x":q2["x"]+dx,"y":q2["y"]})
                await asyncio.sleep(0.12)
            await asyncio.sleep(0.5)
        r=await cmd("Page.captureScreenshot",{"format":"png"})
        open(sys.argv[2],"wb").write(base64.b64decode(r["result"]["data"]))
asyncio.run(go()); p.terminate()
