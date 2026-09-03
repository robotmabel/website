#!/usr/bin/env python3
"""Report which illustration each assembly step received, so a mis-keyed
figure (a robot hand on a leadscrew step) is visible at a glance."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9293 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died; subprocess.run(["rm","-rf",f"/tmp/cdp-art-{P}"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-art","--window-size=1400,900","--hide-scrollbars",
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
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.4)
        r=await cmd("Runtime.evaluate",{"returnByValue":True,"expression":"""(function(){
          var out=[], missing=0;
          document.querySelectorAll('ol.asm-steps li').forEach(function(li){
            var fig=li.querySelector('.asm-art svg');
            if(!fig){missing++; return;}
            var words=[...fig.querySelectorAll('text')].map(function(t){return t.textContent;}).join(' ');
            out.push({sec:(li.closest('section')||{}).id,
                      step:(li.querySelector('strong')||{}).textContent.slice(0,40),
                      words:words.slice(0,24)});});
          return JSON.stringify({n:out.length, missing:missing, rows:out});})()"""})
        d=json.loads(r["result"]["result"]["value"])
        print(f"{d['n']} panels illustrated, {d['missing']} missing")
        for row in d["rows"]:
            print(f"  {row['sec']:12s} {row['step']:42s} {row['words']}")
        print("RESULT:", "PASS" if d["missing"]==0 else "FAIL")
asyncio.run(go()); p.terminate()
