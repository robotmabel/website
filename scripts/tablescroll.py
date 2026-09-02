"""Report every table that scrolls horizontally at phone width."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9277; prof="/tmp/cdp-tbl"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=390,844","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
CHECK = """(function(){
  var out=[];
  document.querySelectorAll('table').forEach(function(t,i){
    var sc = t.closest('.table-scroll,.bt-scroll,[style*="overflow"]') || t.parentElement;
    var cs=getComputedStyle(t);
    var over = t.scrollWidth - (sc ? sc.clientWidth : innerWidth);
    if (over > 2) out.push({i:i, cls:(t.className||'(none)'),
      tableW:Math.round(t.scrollWidth), boxW:Math.round(sc?sc.clientWidth:innerWidth),
      over:Math.round(over), cols:t.rows[0]?t.rows[0].cells.length:0,
      disp:cs.display, id:t.id, mq:matchMedia('(max-width: 620px)').matches, iw:innerWidth,
      first:(t.rows[0]&&t.rows[0].cells[0]?t.rows[0].cells[0].textContent.trim().slice(0,20):'')});
  });
  // also any element wider than the viewport (page-level bleed)
  var bleed = document.documentElement.scrollWidth - innerWidth;
  return JSON.stringify({tables:out, pageBleed:Math.round(bleed)});})()"""
async def go():
    for _ in range(40):
        try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception: time.sleep(0.4)
    ws=[t for t in tabs if t["type"]=="page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i=[0]; bad=0
        async def cmd(m,pp=None):
            i[0]+=1; await c.send(json.dumps({"id":i[0],"method":m,"params":pp or {}}))
            while True:
                r=json.loads(await c.recv())
                if r.get("id")==i[0]: return r
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Emulation.setDeviceMetricsOverride",
                  {"width":390,"height":844,"deviceScaleFactor":2,"mobile":True})
        for url in sys.argv[1:]:
            await cmd("Page.navigate",{"url":url}); await asyncio.sleep(3.0)
            r=await cmd("Runtime.evaluate",{"expression":CHECK,"returnByValue":True})
            d=json.loads(r["result"]["result"]["value"])
            page=url.rsplit('/',1)[-1]
            if d["tables"] or d["pageBleed"]>2:
                print(f"{page}: pageBleed={d['pageBleed']}px, {len(d['tables'])} scrolling table(s)")
                for t in d["tables"][:4]:
                    print(f"    .{t['cls'][:28]:30s} {t['cols']} cols  {t['tableW']}px in {t['boxW']}px  (+{t['over']})  “{t['first']}”")
                bad += len(d["tables"])
            else:
                print(f"{page}: clean")
        print("TOTAL SCROLLING TABLES:", bad)
asyncio.run(go()); p.terminate()
