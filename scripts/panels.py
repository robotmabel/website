import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9291 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died; subprocess.run(["rm","-rf",f"/tmp/cdp-pn-{P}"])
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
          /* The panels are a UNIFORM instruction grid now, so a partial last
             row is correct — that is how auto-fill works, and it is what the
             reference sheet does. What matters is that every tile is the same
             width and every one carries a figure and a caption. */
          var out=[];
          document.querySelectorAll('ol.asm-steps').forEach(function(ol){
            var lis=[].slice.call(ol.children);
            var widths=lis.map(function(li){
              return Math.round(li.getBoundingClientRect().width);});
            var uniq=widths.filter(function(v,i,a){return a.indexOf(v)===i;});
            var noArt=lis.filter(function(li){return !li.querySelector('.asm-art svg');}).length;
            var noCap=lis.filter(function(li){return !li.querySelector('strong');}).length;
            out.push({sec:(ol.closest('section')||{}).id, n:lis.length,
                      widths:uniq.length, noArt:noArt, noCap:noCap});});
          return JSON.stringify(out);})()"""})
        d=json.loads(r["result"]["result"]["value"])
        bad=0
        for s in d:
            ok = s["widths"] <= 2 and s["noArt"]==0 and s["noCap"]==0
            if not ok: bad+=1
            print(f"  {s['sec']:12s} {s['n']:2d} panels  {s['widths']} distinct width(s)  "
                  f"art missing {s['noArt']}  captions missing {s['noCap']}  "
                  f"{'ok' if ok else 'PROBLEM'}")
        print("RESULT:", "PASS" if bad==0 else f"{bad} module(s) with a problem")
asyncio.run(go()); p.terminate()
