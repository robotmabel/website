"""The wall clips must survive the low→high swap without ever showing an
empty video element (which is what flickered the speech balloons)."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9281; prof="/tmp/cdp-vid"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1400,900","--hide-scrollbars",
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
            r=await cmd("Runtime.evaluate",{"expression":e,"returnByValue":True,"awaitPromise":True})
            if "exceptionDetails" in r.get("result",{}):
                return "JSERR "+str(r["result"]["exceptionDetails"].get("text"))
            return r.get("result",{}).get("result",{}).get("value")
        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable"); await cmd("Network.setCacheDisabled",{"cacheDisabled":True})
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.0)
        await ev("document.querySelector('.wall-item video').scrollIntoView({block:'center',behavior:'instant'})")
        # watch the wall for 8 s: sample every 120 ms and record any moment a
        # visible clip has no readyState (i.e. a blank frame)
        res = await ev("""new Promise(function(res){
          var blanks=0, samples=0, swapped=0, start=performance.now();
          var t=setInterval(function(){
            samples++;
            document.querySelectorAll('.wall-item video').forEach(function(v){
              var b=v.getBoundingClientRect();
              if(b.bottom<0||b.top>innerHeight||b.width<10) return;
              // only a VISIBLE element with no decoded data can flicker
              if(v.src && v.readyState===0 && parseFloat(getComputedStyle(v).opacity)>0.05) blanks++;
              if(v.src && v.src.indexOf('blob:')===0) swapped=1;
            });
            if(performance.now()-start>8000){clearInterval(t);
              res(JSON.stringify({samples:samples, blankFrames:blanks, sawHiSwap:!!swapped,
                clips:document.querySelectorAll('.wall-item video').length}));}
          },120);})""")
        print(res)
        d=json.loads(res)
        print("RESULT:", "PASS" if d["blankFrames"]==0 else "FAIL — blank frames during swap")
asyncio.run(go()); p.terminate()
