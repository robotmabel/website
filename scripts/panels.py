import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9291; subprocess.run(["rm","-rf","/tmp/cdp-pn"])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  "--user-data-dir=/tmp/cdp-pn","--window-size=1440,900","--hide-scrollbars",
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
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.2)
        r=await cmd("Runtime.evaluate",{"returnByValue":True,"expression":"""(function(){
          var out=[];
          document.querySelectorAll('ol.asm-steps').forEach(function(ol){
            var lis=[...ol.children];
            var last=lis[lis.length-1].getBoundingClientRect();
            var box=ol.getBoundingClientRect();
            out.push({sec:(ol.closest('section')||{}).id, n:lis.length,
              lastFillsRow: Math.round(box.right - last.right) < 6,
              gapRight: Math.round(box.right - last.right)});});
          return JSON.stringify(out);})()"""})
        d=json.loads(r["result"]["result"]["value"])
        bad=0
        for s in d:
            ok = s["lastFillsRow"]
            if not ok: bad+=1
            print(f"  {s['sec']:12s} {s['n']} panels  last panel right-gap {s['gapRight']:4d}px  {'ok' if ok else 'HOLE'}")
        print("RESULT:", "PASS" if bad==0 else f"{bad} module(s) end with a hole")
asyncio.run(go()); p.terminate()
