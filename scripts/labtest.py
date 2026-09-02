"""Frame-rate-independent test of the tip-over lab's physics.

The browser's requestAnimationFrame is throttled in headless Chrome, which
starved the animation loop and made earlier measurements meaningless. This
drives the extracted pure integrator (window.__tipStep) in a tight loop with
a fixed dt instead, so the result depends only on the law."""
import asyncio, json, subprocess, sys, time, urllib.request, websockets
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P=9265; prof="/tmp/cdp-lt"; subprocess.run(["rm","-rf",prof])
p=subprocess.Popen([CHROME,"--headless=new",f"--remote-debugging-port={P}",
  f"--user-data-dir={prof}","--window-size=1200,800","--hide-scrollbars",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank"],
  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
SIM = """(function(){
  var f=window.__tipStep; if(!f) return 'NO STEP FN';
  function run(cmd, lift, safe, cruise_s, stop_s){
    var S={cmd:cmd,lift:lift,safe:safe,v:0,tilt:0,tiltRate:0,x:0,
           braking:false,tipped:false};
    var dt=1/120, peak=0;
    for(var t=0;t<cruise_s;t+=dt) f(S,dt);
    var vCruise=S.v;
    S.cmd=0;                                   // slam the brakes
    for(var t=0;t<stop_s;t+=dt){ f(S,dt); peak=Math.max(peak,S.tilt); }
    return {vCruise:+vCruise.toFixed(3), peakTilt:+peak.toFixed(2),
            tipped:S.tipped, finalV:+S.v.toFixed(3)};
  }
  return JSON.stringify({
    on_lift0   : run(1.4, 0.0,  true, 4, 3),
    on_lift03  : run(1.4, 0.30, true, 4, 3),
    on_liftmax : run(1.4, 0.635,true, 4, 3),
    off_lift0  : run(1.4, 0.0,  false,4, 3),
    off_lift03 : run(1.4, 0.30, false,4, 3),
    off_liftmax: run(1.4, 0.635,false,4, 3)
  },null,1);})()"""
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
        await cmd("Page.navigate",{"url":sys.argv[1]}); await asyncio.sleep(3.0)
        r=await cmd("Runtime.evaluate",{"expression":SIM,"returnByValue":True})
        if "exceptionDetails" in r.get("result",{}):
            print("JSERR", r["result"]["exceptionDetails"].get("text")); return
        print(r["result"]["result"]["value"])
asyncio.run(go()); p.terminate()
