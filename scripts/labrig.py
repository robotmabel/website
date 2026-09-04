"""Measure the motion-model lab's robot: which way it faces, and its lift stroke.

Two things a screenshot argues about and a measurement settles:

  facing  the front swerve pair must sit to the RIGHT of the back module on
          screen (world +X), i.e. the robot drives toward the right edge.
  lift    the column is a CASCADED two-stage tendon. Commanding the full
          height into one stage overshoots the top and can never reach the
          bottom; each stage must take half. Head height at 0.635 m minus head
          height at 0 m has to equal the 0.635 m stroke from the MJCF.

    python scripts/labrig.py http://localhost:8741/software.html
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9284 + random.randrange(60)  # a port and profile per run:
                             # two checks in flight collided and one died
prof = f"/tmp/cdp-labrig-{P}"
subprocess.run(["rm", "-rf", prof])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={prof}", "--window-size=1440,1000",
                      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                      "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

STROKE = 0.635          # m, mabel_full.xml: two l_slide stages of 0.3175


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/software.html"
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await c.recv())
                if r.get("id") == i[0]:
                    return r

        async def ev(expr):
            r = await cmd("Runtime.evaluate",
                          {"expression": expr, "returnByValue": True,
                           "awaitPromise": True})
            return r["result"]["result"].get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Page.navigate", {"url": url})
        # The 3-D modules are deferred until their canvas nears the viewport
        # (assets/defer-module.js), so a check that waits for their test hook
        # waits forever. Ask for them — but RETRY, because right after
        # Page.navigate the loader script has not run yet and the hook it
        # installs does not exist.
        for _ in range(40):
            if await ev("!!(window.__loadDeferred && window.__loadDeferred())"):
                break
            await asyncio.sleep(0.15)
        # the rig loads a GLB and then a JSON manifest — wait for both
        ok = False
        for _ in range(60):
            await asyncio.sleep(0.5)
            if await ev("!!(window.__tipRig && window.__tipRig())"):
                ok = True
                break
        if not ok:
            print("the lab rig never became ready"); print("RESULT: FAIL"); return

        bad = 0
        r0 = json.loads(await ev("JSON.stringify(window.__tipRig(0))"))
        rT = json.loads(await ev("JSON.stringify(window.__tipRig(%f))" % STROKE))
        rH = json.loads(await ev("JSON.stringify(window.__tipRig(%f))" % (STROKE / 2)))

        print(f"lift stages driven        {r0['stages']}")
        if r0["stages"] != 2:
            print("   *** expected 2 cascaded stages"); bad += 1

        fx, bx = r0["front"][0], r0["back"][0]
        print(f"front x {fx:+.3f}   back x {bx:+.3f}   "
              f"→ faces {'RIGHT (+X)' if fx > bx else 'LEFT (-X)'}")
        if not fx > bx + 0.05:
            print("   *** the robot is not facing the direction of travel"); bad += 1

        rise = rT["head"][1] - r0["head"][1]
        half = rH["head"][1] - r0["head"][1]
        print(f"head rise 0 → {STROKE} m      {rise:.4f} m   (want {STROKE})")
        print(f"head rise 0 → {STROKE/2} m    {half:.4f} m   (want {STROKE/2})")
        if abs(rise - STROKE) > 0.01:
            print("   *** the lift does not travel its URDF stroke"); bad += 1
        if abs(half - STROKE / 2) > 0.01:
            print("   *** the two stages are not sharing the command"); bad += 1

        # the two stages must move together, not one of them alone
        dmid = rT["mid"][1] - r0["mid"][1]
        dtop = rT["top"][1] - r0["top"][1]
        print(f"stage travel              mid {dmid:.4f} m   top {dtop:.4f} m")
        if abs(dmid - STROKE / 2) > 0.01 or abs(dtop - STROKE) > 0.01:
            print("   *** stage displacement is wrong (top rides on mid)"); bad += 1

        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
