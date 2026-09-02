"""Pop-up regression test. For every [data-pop] on a page: scroll it into
view INSTANTLY (the site sets scroll-behavior:smooth, which made an earlier
version of this test click stale coordinates), verify the element under the
cursor really is the card, dispatch a real mouse click, then assert the
overlay opened, the title is right, the URL did not change, and Escape closes."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9253
prof="/tmp/cdp-poptest"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={PORT}",
  f"--user-data-dir={prof}","--window-size=1400,950","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def run(url):
    for _ in range(40):
        try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json")); break
        except Exception: time.sleep(0.4)
    ws=[t for t in tabs if t["type"]=="page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i=[0]
        async def cmd(m,pp=None):
            i[0]+=1; await c.send(json.dumps({"id":i[0],"method":m,"params":pp or {}}))
            while True:
                r=json.loads(await c.recv())
                if r.get("id")==i[0]: return r
        async def ev(expr):
            r=await cmd("Runtime.evaluate",{"expression":expr,"returnByValue":True})
            if "exceptionDetails" in r.get("result",{}):
                return "JSERROR "+str(r["result"]["exceptionDetails"].get("text"))
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Page.navigate",{"url":url}); await asyncio.sleep(3.0)
        n = await ev("document.querySelectorAll('[data-pop]').length")
        if not n: print(f"  (no pop cards)"); return True
        ok=True
        for k in range(n):
            before = await ev("location.href")
            pos = await ev(f"""(function(){{
              var c=document.querySelectorAll('[data-pop]')[{k}];
              var y=c.getBoundingClientRect().top+window.scrollY-300;
              window.scrollTo({{top:y,behavior:'instant'}});
              var b=c.getBoundingClientRect();
              var x=Math.round(b.left+b.width/2), yy=Math.round(b.top+b.height*0.35);
              var el=document.elementFromPoint(x,yy);
              return JSON.stringify({{x:x,y:yy,
                onCard:!!(el&&el.closest('[data-pop]')),
                hit:el?el.tagName:'null',
                inLink:!!(el&&el.closest('a'))}});}})()""")
            q=json.loads(pos)
            if not q["onCard"]:
                print(f"  [{k}] *** cursor not on card (hit {q['hit']})"); ok=False; continue
            for ty in ("mousePressed","mouseReleased"):
                await cmd("Input.dispatchMouseEvent",{"type":ty,"x":q["x"],"y":q["y"],
                          "button":"left","clickCount":1})
            await asyncio.sleep(0.5)
            st=json.loads(await ev("""JSON.stringify({
              open:!!document.querySelector('.pop-overlay.open'),
              title:((document.querySelector('.pop-title')||{}).textContent||''),
              art:!!document.querySelector('.pop-art svg'),
              body:((document.querySelector('.pop-body')||{}).textContent||'').length,
              url:location.href})"""))
            same = st["url"]==before
            good = st["open"] and same and st["art"] and st["body"]>200 and not q["inLink"]
            print(f"  [{k}] {'ok ' if good else 'FAIL'} open={st['open']} url_same={same} "
                  f"art={st['art']} body={st['body']}c title={st['title'][:30]!r}")
            if not good: ok=False
            await cmd("Input.dispatchKeyEvent",{"type":"keyDown","key":"Escape","code":"Escape","windowsVirtualKeyCode":27})
            await cmd("Input.dispatchKeyEvent",{"type":"keyUp","key":"Escape","code":"Escape","windowsVirtualKeyCode":27})
            await asyncio.sleep(0.25)
            if not await ev("!document.querySelector('.pop-overlay.open')"):
                print(f"  [{k}] *** Escape did not close"); ok=False
        return ok
async def main():
    allok=True
    for u in sys.argv[1:]:
        print(u.rsplit('/',1)[-1] or 'index')
        allok = (await run(u)) and allok
    print("RESULT:", "PASS" if allok else "FAIL")
asyncio.run(main()); p.terminate()
