#!/usr/bin/env python3
"""Both groupings must show every dollar of the core bill."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9305 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died; subprocess.run(["rm","-rf",f"/tmp/cdp-bg-{P}"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-bg","--window-size=1400,900","--hide-scrollbars",
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
        SNAP = """(function(){
          var rows=[...document.querySelectorAll('#bomRows tbody tr[data-sec]')];
          var sum=rows.reduce(function(a,r){
            return a + Number((r.cells[2].textContent||'').replace(/[^0-9.]/g,''));},0);
          return JSON.stringify({n:rows.length, sum:Math.round(sum),
            slices:document.querySelectorAll('#bomPie path').length,
            head:(document.querySelector('#bomRows thead th')||{}).textContent,
            names:rows.map(function(r){return r.cells[0].textContent.trim();}).slice(0,3)});})()"""
        a=json.loads(await ev(SNAP)); print("by module:", a)
        await ev("document.querySelectorAll('#bomGroupToggle button')[1].click()")
        await asyncio.sleep(0.6)
        b=json.loads(await ev(SNAP)); print("by type:  ", b)
        core = await ev("window.MABEL_BOM.core_total")
        ok = (abs(a["sum"]-round(core))<=8 and abs(b["sum"]-round(core))<=8
              and a["slices"]==a["n"] and b["slices"]==b["n"] and a["n"]!=b["n"])
        print(f"core total {round(core)} · module {a['sum']} · type {b['sum']}")
        print("RESULT:", "PASS" if ok else "FAIL")
asyncio.run(go()); p.terminate()
