"""Report any sticker whose box overlaps real text. Run across every page."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9267; prof="/tmp/cdp-st"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1440,1000","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
CHECK = """(function(){
  // Collect the RECTANGLE OF EVERY LINE OF TEXT via Range, not elementFromPoint:
  // a point over a section's blank padding still resolves to that section,
  // whose textContent is the whole page — which produced false positives.
  var lines=[];
  var walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
    acceptNode:function(n){
      if(!n.nodeValue||!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      var p=n.parentElement;
      if(!p||p.closest('.sticker')) return NodeFilter.FILTER_REJECT;
      var cs=getComputedStyle(p);
      if(cs.visibility==='hidden'||cs.opacity==='0'||cs.display==='none')
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;}});
  var n; var r=document.createRange();
  while((n=walk.nextNode())){
    r.selectNodeContents(n);
    var rects=r.getClientRects();
    for(var i=0;i<rects.length;i++){
      var b=rects[i];
      if(b.width<2||b.height<2) continue;
      if(b.bottom<-50||b.top>innerHeight+50) continue;
      lines.push({l:b.left,t:b.top,r:b.right,b:b.bottom,
                  s:(n.nodeValue||'').trim().slice(0,30)});
    }
  }
  var out=[];
  document.querySelectorAll('.sticker').forEach(function(st){
    var b=st.getBoundingClientRect();
    if(b.width===0||b.bottom<0||b.top>innerHeight) return;
    // shrink slightly: the SVG art has transparent margins
    var pad=6, L=b.left+pad, T=b.top+pad, R=b.right-pad, B=b.bottom-pad;
    for(var i=0;i<lines.length;i++){
      var q=lines[i];
      var ox=Math.min(R,q.r)-Math.max(L,q.l);
      var oy=Math.min(B,q.b)-Math.max(T,q.t);
      if(ox>3&&oy>3){
        out.push({sticker:(st.getAttribute('src')||'').split('/').pop(),
                  top:Math.round(b.top+scrollY), overlap:Math.round(ox)+'x'+Math.round(oy),
                  text:q.s});
        break;
      }
    }
  });
  return JSON.stringify(out);})()"""
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
        for url in sys.argv[1:]:
            await cmd("Page.navigate",{"url":url}); await asyncio.sleep(2.6)
            # walk the page so every sticker is laid out and sampled in view
            n=await cmd("Runtime.evaluate",{"returnByValue":True,
              "expression":"document.querySelectorAll('.sticker').length"})
            total=n.get("result",{}).get("result",{}).get("value") or 0
            found=[]
            steps=await cmd("Runtime.evaluate",{"returnByValue":True,
              "expression":"Math.ceil(document.body.scrollHeight/800)"})
            nsteps=steps.get("result",{}).get("result",{}).get("value") or 12
            for k in range(nsteps):
                await cmd("Runtime.evaluate",{"expression":f"window.scrollTo({{top:{k*800},behavior:'instant'}})"})
                await asyncio.sleep(0.25)
                r=await cmd("Runtime.evaluate",{"expression":CHECK,"returnByValue":True})
                v=r.get("result",{}).get("result",{}).get("value")
                if v is None:
                    print("   (eval error)", str(r.get("result",{}).get("exceptionDetails",{}).get("text"))[:90]); continue
                found += json.loads(v)
            uniq={json.dumps(f,sort_keys=True) for f in found}
            page=url.rsplit('/',1)[-1] or 'index'
            if uniq:
                bad+=len(uniq)
                print(f"{page}: {total} stickers, {len(uniq)} OVERLAPPING")
                for u in sorted(uniq)[:4]: print("   ", u)
            else:
                print(f"{page}: {total} stickers, none overlapping text")
        print("TOTAL OVERLAPS:", bad)
asyncio.run(go()); p.terminate()
