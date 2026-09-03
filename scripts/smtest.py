#!/usr/bin/env python3
"""The stack map must match the repo's architecture invariants, not a ladder.

The diagram it replaced put ROS 2 between the controller and the firmware,
which is the opposite of how MABEL is wired. Two rules from the root CLAUDE.md
decide the graph, and this asserts the graph obeys them:

  * hardware_bridge is the SOLE hardware owner — every command path ends
    ... -> hal -> fw -> robot, and nothing reaches the firmware another way.
  * controller/ is the SOLE gate — every command path passes through the
    motion model before it reaches the HAL.
  * video does NOT go through the gateway.

    python scripts/smtest.py http://localhost:8741/index.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9541 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-sm-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-sm-{P}", "--window-size=1500,1000",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

COMMAND_PATHS = ["teleop", "auto", "navp"]


async def go():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/index.html"
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]; errs = []

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 45))
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description"))[:140])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Page.navigate", {"url": url})
        for _ in range(60):
            await asyncio.sleep(0.4)
            if await ev("!!window.__stackMap"):
                break
        bad = 0
        paths = json.loads(await ev(
            "JSON.stringify(window.__stackMap.paths.map(function(p){"
            "return {id:p[0],name:p[1],route:p[3]};}))"))
        print(f"{len(paths)} routes")
        for p_ in paths:
            r = p_["route"]
            print(f"  {p_['name']:24s} {' → '.join(r)}")
            if p_["id"] in COMMAND_PATHS:
                if r[-3:] != ["hal", "fw", "robot"]:
                    print("     *** a command path does not end hal → fw → robot")
                    bad += 1
                if "motion" not in r:
                    print("     *** a command path skips the motion model — "
                          "controller/ is supposed to be the only gate")
                    bad += 1
            if p_["id"] == "video" and "server" in r:
                print("     *** video is routed through the gateway"); bad += 1
            if "fw" in r and r[r.index("fw") - 1] != "hal" and r[0] != "robot":
                print("     *** something reaches the firmware without the HAL")
                bad += 1

        # ROS must not sit between the controller and the hardware
        nodes = json.loads(await ev(
            "JSON.stringify(window.__stackMap.nodes.map(function(n){"
            "return {id:n[0],col:n[3]};}))"))
        col = {n["id"]: n["col"] for n in nodes}
        print(f"\ncolumns: controller {col['motion']}, hal {col['hal']}, "
              f"ros {col['ros']}, firmware {col['fw']}")
        if not (col["motion"] < col["hal"] < col["fw"] and col["ros"] > col["hal"]):
            print("   *** ROS is drawn under the bridge again"); bad += 1

        # lighting a path actually lights it
        await ev("window.__stackMap.show('teleop')")
        await asyncio.sleep(0.4)
        lit = await ev("window.__stackMap.lit().length")
        edges = await ev("window.__stackMap.litEdges()")
        print(f"teleop path lights {lit} nodes and {edges} edges")
        if lit != 9 or edges != lit - 1:
            print("   *** the highlight does not cover the whole route "
                  f"(want {lit-1} edges for {lit} nodes)")
            bad += 1

        # EVERY route must draw its lines. "Video -> your screen" lit four
        # nodes and NOT ONE EDGE for a week, because the two links it needs
        # (robot->perception, HAL->device) were never in the edge list. A route
        # with no line is not a route, and nothing here noticed.
        for pth in paths:
            await ev(f"window.__stackMap.show('{pth['id']}')")
            await asyncio.sleep(0.15)
            ln = await ev("window.__stackMap.lit().length")
            le = await ev("window.__stackMap.litEdges()")
            print(f"   {pth['name']:24s} {ln} nodes, {le} edges")
            if le != len(pth["route"]) - 1:
                print(f"     *** {pth['name']} is missing "
                      f"{len(pth['route'])-1-le} of its lines")
                bad += 1

        # EVERY BLOCK must respond to a click. Blocks on no named route
        # (localization, SLAM, the relay) light their own neighbourhood; a
        # block that does nothing reads as broken rather than as off-route.
        ids = await ev("window.__stackMap.nodes.map(function(n){return n[0];})")
        dead = []
        for nid in ids:                     # NOT `i` — that is the closure's
            await ev("window.__stackMap.show(null)")   # request counter
            await ev(f"window.__stackMap.clickNode('{nid}')")
            await asyncio.sleep(0.08)
            if (await ev("window.__stackMap.lit()") or []).count(nid) == 0:
                dead.append(nid)
        if dead:
            print(f"   *** clicking these does nothing: {', '.join(dead)}")
            bad += 1
        else:
            print(f"all {len(ids)} blocks respond to a click")

        # ── the sim/real split ────────────────────────────────────────
        w = await ev("window.__stackMap.worlds()")
        print(f"\nworlds: {w}")
        if not (w.get("sim") and w.get("real") and w.get("both")):
            print("   *** the diagram no longer distinguishes sim from real")
            bad += 1
        simp = [x for x in paths if x["id"] == "sim"]
        if not simp:
            print("   *** there is no route through the simulator"); bad += 1
        else:
            await ev("window.__stackMap.show('sim')")
            slit = await ev("window.__stackMap.lit()")
            real = [x for x in paths if x["id"] == "teleop"][0]["route"]
            shared = [n for n in slit if n in real]
            print(f"sim route lights {len(slit)}; {len(shared)} of them are on "
                  f"the real route too")
            if len(shared) < 6:
                print("   *** sim and real barely overlap — the shared-spine "
                      "claim is not what the graph draws")
                bad += 1
            if "mujoco" not in slit:
                print("   *** the sim route never reaches MuJoCo"); bad += 1

        # ── every command source is CLICKABLE and lights its own route ──
        for src in ["vp", "policy", "nav"]:
            if not await ev(f"window.__stackMap.clickNode('{src}')"):
                print(f"   *** {src} is not on the diagram"); bad += 1; continue
            if src not in (await ev("window.__stackMap.lit()")):
                print(f"   *** clicking {src} lit no route through it"); bad += 1
        print("every command source is clickable")

        # ── hovering ANY block must produce a card with text in it ──────
        ids = await ev("window.__stackMap.nodes.map(function(n){return n[0];})")
        empty = [nid for nid in ids
                 if not await ev(f"window.__stackMap.hover('{nid}')")]
        if empty:
            print(f"   *** no hover card for: {', '.join(empty)}"); bad += 1
        else:
            print(f"all {len(ids)} blocks have a hover card")

        print("errors:", errs[:2] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


asyncio.run(go())
p.terminate()
