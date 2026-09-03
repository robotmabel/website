"""Hover several rows, including ones near the bottom of the viewport, and
assert the preview card stays vertically next to the row under the cursor."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9279 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died
prof = f"/tmp/cdp-hov-{P}"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1440,900","--hide-scrollbars",
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
            if "exceptionDetails" in r.get("result",{}): return "JSERR"
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.4)
        await ev("document.querySelector('#bomTable').scrollIntoView({block:'start',behavior:'instant'})")
        await asyncio.sleep(0.6)
        # pick rows near the top, middle and BOTTOM of the viewport
        picks = await ev("""(function(){
          var rows=[...document.querySelectorAll('#bomTable tbody tr')]
            .filter(function(r){var b=r.getBoundingClientRect();
              return b.top>120 && b.bottom<innerHeight-6;});
          if(rows.length<3) return '[]';
          var pick=[rows[0], rows[Math.floor(rows.length/2)], rows[rows.length-1]];
          return JSON.stringify(pick.map(function(r){var b=r.getBoundingClientRect();
            return {ref:r.dataset.ref, x:Math.round(b.left+80),
                    y:Math.round(b.top+b.height/2)};}));})()""")
        print("  innerHeight:", await ev("innerHeight"))
        ok=True
        for q in json.loads(picks):
            for dx in (-40,-20,0):
                await cmd("Input.dispatchMouseEvent",{"type":"mouseMoved","x":q["x"]+dx,"y":q["y"]})
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.35)
            res = json.loads(await ev("""(function(){
              var pv=document.querySelector('.bt-preview');
              if(pv.hidden) return JSON.stringify({shown:false});
              var b=pv.getBoundingClientRect();
              return JSON.stringify({shown:true, top:Math.round(b.top),
                bottom:Math.round(b.bottom), h:Math.round(b.height),
                name:(document.querySelector('.bt-pv-name')||{}).textContent});})()"""))
            if not res.get("shown"):
                print(f"  row {q['ref']}: NOT SHOWN"); ok=False; continue
            # the card's bottom edge must sit just above the cursor (top-right),
            # or just below it when there was no room above
            above = abs(res["bottom"] - q["y"])
            below = abs(res["top"] - q["y"])
            gap = min(above, below)
            verdict = "ok" if gap <= 30 else f"OFF BY {gap}px"
            if gap > 30: ok=False
            print(f"  row {q['ref']:5s} cursorY={q['y']:4d}  card {res['top']}–{res['bottom']} "
                  f"(h={res['h']})  {verdict}  “{res['name'][:26]}”")
        print("RESULT:", "PASS" if ok else "FAIL")
asyncio.run(go()); p.terminate()
