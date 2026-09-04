#!/usr/bin/env python3
"""Clicking a playable film card must open the lightbox and start playing."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9301 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died; subprocess.run(["rm","-rf",f"/tmp/cdp-fp-{P}"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir=/tmp/cdp-fp-{P}","--window-size=1400,900","--hide-scrollbars",
  "--autoplay-policy=no-user-gesture-required",
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
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.2)
        n = await ev("document.querySelectorAll('.film-card.is-playable').length")
        print("playable cards:", n)
        ok = (n == 2)
        for k in range(n or 0):
            await ev(f"document.querySelectorAll('.film-card.is-playable')[{k}].click()")
            await asyncio.sleep(1.6)
            st = json.loads(await ev("""JSON.stringify((function(){
              var b=document.querySelector('.film-lightbox'), v=b.querySelector('video');
              return {open:!b.hidden, src:(v.src||'').split('/').pop(),
                      playing: !v.paused, t:+v.currentTime.toFixed(2),
                      cap:(b.querySelector('figcaption')||{}).textContent.slice(0,34)};})())"""))
            print(f"  film {k+1}: open={st['open']} playing={st['playing']} t={st['t']}s "
                  f"src={st['src']} cap={st['cap']!r}")
            if not (st["open"] and st["src"]): ok = False
            await cmd("Input.dispatchKeyEvent",{"type":"keyDown","key":"Escape","code":"Escape","windowsVirtualKeyCode":27})
            await cmd("Input.dispatchKeyEvent",{"type":"keyUp","key":"Escape","code":"Escape","windowsVirtualKeyCode":27})
            await asyncio.sleep(0.4)
            if not await ev("document.querySelector('.film-lightbox').hidden"):
                print("   *** Escape did not close"); ok = False
        print("RESULT:", "PASS" if ok else "FAIL")
asyncio.run(go()); p.terminate()
