#!/usr/bin/env python3
"""Drive the webcam retargeter with synthetic operators and check where the
robot's hands actually end up.

The demo used to be tested only for "it mounted and it did not open the camera",
which is exactly why a wrong frame mapping shipped: every static check passed
while the arms went to the wrong place. This feeds MediaPipe-shaped world
landmarks straight into the retarget path (window.__wt.feed) and asserts the
DIRECTION the rig moves, which is the thing that was wrong:

  raise the right hand   → the rig's right palm goes UP
  reach forward          → it goes toward the robot's front (GLB −X)
  reach to your right    → it goes toward the robot's right (GLB −Z)
  lean forward           → the torso joint pitches forward (negative q)
  and the operator's RIGHT hand drives the robot's RIGHT arm, not the left.

    python scripts/camtest.py http://localhost:8741/software.html
"""
import asyncio, json, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
import random
P = 9307 + random.randrange(40)   # a fresh port per run: two
                                # checks in flight used to collide on one profile
subprocess.run(["rm", "-rf", f"/tmp/cdp-rc-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-rc-{P}", "--window-size=1400,900",
                      "--hide-scrollbars", "--use-angle=swiftshader",
                      "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# A standing operator in MediaPipe WORLD coordinates: metres, origin at the hip
# centre, +x image-right, +y DOWN, +z away from the camera. Landmark 11 is the
# person's LEFT shoulder, which faces the camera on the image right, so +x.
POSE_JS = r"""
window.__mkPose = function (o) {
  o = o || {};
  var lean = o.lean || 0;            // + = leaning toward the camera
  // head: [turnLeft, lookDown, roll] in metres of landmark displacement. The
  // operator's LEFT is image +x, so turning that way swings the nose to +x
  // while the ears rotate about the head centre.
  var hd = o.head || [0, 0, 0];   // [turnLeft, lookDown, roll]
  var P = new Array(33);
  for (var i = 0; i < 33; i++) P[i] = { x: 0, y: 0, z: 0, visibility: 1 };
  var put = function (i, x, y, z) { P[i] = { x: x, y: y, z: z, visibility: 1 }; };
  var dz = -lean * 0.5, dy = 0.02 * lean;
  // The head is a rigid triangle (nose out front, ears either side) that is
  // ROTATED, not translated: a yaw about the head centre swings the nose one
  // way and pulls one ear forward and the other back. Sliding the nose alone
  // would let a mapping bug pass by never testing the ear geometry.
  var hc = [0.00, -0.655 + dy, 0.02 + dz];          // head centre
  var yaw = hd[0] * 4.0, pit = hd[1] * 4.0, rol = hd[2] * 4.0;
  var rot = function (p) {
    // yaw about the up axis (mp y is DOWN, so a positive yaw takes +x to −z),
    // then pitch about the image-right axis, then roll about the gaze axis
    var x = p[0], y = p[1], z = p[2], c, s;
    c = Math.cos(yaw); s = Math.sin(yaw);
    var x1 = x * c - z * s, z1 = x * s + z * c;
    c = Math.cos(pit); s = Math.sin(pit);
    var y1 = y * c - z1 * s, z2 = y * s + z1 * c;
    c = Math.cos(rol); s = Math.sin(rol);
    var x2 = x1 * c - y1 * s, y2 = x1 * s + y1 * c;
    return [hc[0] + x2, hc[1] + y2, hc[2] + z2];
  };
  var hp = function (i, x, y, z) { var q = rot([x, y, z]); put(i, q[0], q[1], q[2]); };
  // A head looking level: the nose tip sits at about the height of the ear
  // canals, not above them. Putting it 2 cm higher — as the first version of
  // this fixture did — IS a 16° upward tilt, and the retargeter was right to
  // report one.
  hp(0,  0.00, -0.005, -0.075);                     // nose, out in front
  hp(2,  0.030, -0.028, -0.055);                    // eyes
  hp(5, -0.030, -0.028, -0.055);
  hp(7,  0.070, -0.005,  0.000);                    // left ear
  hp(8, -0.070, -0.005,  0.000);                    // right ear
  put(11,  0.19, -0.50 + dy, dz);                   // left shoulder
  put(12, -0.19, -0.50 + dy, dz);                   // right shoulder
  put(23,  0.11, 0.00, 0.00);                       // left hip
  put(24, -0.11, 0.00, 0.00);                       // right hip
  put(25,  0.11, 0.42, 0.02); put(26, -0.11, 0.42, 0.02);
  put(27,  0.11, 0.84, 0.04); put(28, -0.11, 0.84, 0.04);
  var LW = o.lw || [0.28, -0.14, 0.02], RW = o.rw || [-0.28, -0.14, 0.02];
  var LE = o.le || [0.26, -0.30, 0.02], RE = o.re || [-0.26, -0.30, 0.02];
  put(13, LE[0], LE[1], LE[2]); put(14, RE[0], RE[1], RE[2]);
  put(15, LW[0], LW[1], LW[2]); put(16, RW[0], RW[1], RW[2]);
  return P;
};
window.__probe = function (o) {
  var w = window.__mkPose(o);
  var vis = w.map(function () { return 1; });
  return window.__wt.feed(w, vis, {}, null);
};
"""


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
        i = [0]; errs = []

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                # a bounded wait, so a page that blocks its JS thread shows up
                # as a named step timing out instead of the whole run hanging
                r = json.loads(await asyncio.wait_for(c.recv(), 45))
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description")
                                    or d.get("text"))[:180])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            try:
                r = await cmd("Runtime.evaluate",
                              {"expression": e, "returnByValue": True})
            except asyncio.TimeoutError:
                print(f"   *** BLOCKED evaluating: {e[:70]}")
                raise
            if "exceptionDetails" in r.get("result", {}):
                return "JSERR: " + str(r["result"]["exceptionDetails"].get("text"))[:120]
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        # trip if anything asks for the camera without a click
        await cmd("Runtime.evaluate", {"expression":
            "navigator.mediaDevices.getUserMedia = function(){window.__askedForCam=1;"
            "return Promise.reject(new Error('blocked by test'));};"})
        await cmd("Page.navigate", {"url": url})
        await asyncio.sleep(3.0)
        await ev("document.getElementById('retargetCam')"
                 ".scrollIntoView({block:'center',behavior:'instant'})")
        ready = False
        # the GLB + its joint manifest, then a first paint, all under a software
        # rasteriser: 20 s was not always enough and the run then reported "the
        # rig did not load" over a rig that had, in fact, loaded
        for _ in range(90):
            await asyncio.sleep(0.5)
            if await ev("!!(window.__wtReady && window.__wt)"):
                ready = True
                break

        st = json.loads(await ev("""JSON.stringify({
          mounted: !!document.querySelector('.wt-grid'),
          idleShown: !document.querySelector('.wt-idle').hidden,
          askedForCam: !!window.__askedForCam,
          rig: window.__wtReady || null,
          orbit: !!document.querySelector('.wt-view'),
          painted: (function(){var c=document.querySelector('.wt-3d');
            if(!c||!c.width) return 0;
            var gl=c.getContext('webgl2')||c.getContext('webgl');
            if(!gl) return -1;
            var px=new Uint8Array(4*64);
            gl.readPixels(c.width/2-8,c.height/2-8,8,8,gl.RGBA,gl.UNSIGNED_BYTE,px);
            var s=new Set(); for(var i=0;i<px.length;i+=4) s.add(px[i]+','+px[i+1]+','+px[i+2]);
            return s.size;})()})"""))
        bad = 0
        print("mounted", st["mounted"], "· idle shown", st["idleShown"],
              "· asked for camera", st["askedForCam"], "· orbit button", st["orbit"])
        print("rig:", st["rig"])
        for k, want in (("mounted", True), ("idleShown", True),
                        ("askedForCam", False), ("orbit", True)):
            if st[k] != want:
                print(f"   *** {k} is {st[k]}, want {want}"); bad += 1
        if not ready or not st["rig"] or st["rig"]["arm"] < 14 or not st["rig"]["palms"]:
            print(f"   *** the rig did not load its arms "
                  f"(ready={ready} rig={st['rig']})"); bad += 1
            print("errors:", errs[:3] or "none")
            print("RESULT: FAIL"); return

        await cmd("Runtime.evaluate", {"expression": POSE_JS})
        # measure the MATH, not the software rasteriser
        await ev("window.__wt.pause(true)")

        async def probe(**o):
            r = await ev("JSON.stringify(window.__probe(%s))" % json.dumps(o))
            if isinstance(r, str) and r.startswith("JSERR"):
                return None
            return json.loads(r) if r else None

        rest = await probe()
        if not rest:
            print("   *** the retarget path returned nothing for a rest pose")
            await ev("window.__wt.pause(false)")
            print("errors:", errs[:3] or "none")
            print("RESULT: FAIL")
            return

        print(f"\nrest      right palm {fmt(rest['r']['palm'])}  "
              f"target {fmt(rest['r']['target'])}  err {rest['r']['err']*1000:.0f} mm")

        # 1 — raise the RIGHT hand (mp x negative side), high above the shoulder
        up = await probe(rw=[-0.30, -0.95, 0.02], re=[-0.30, -0.55, 0.02])
        d = up["r"]["target"][1] - rest["r"]["target"][1]
        print(f"hand up   right target Δy {d:+.3f} m")
        if not d > 0.15:
            print("   *** raising the hand did not raise the target"); bad += 1
        dl = abs(up["l"]["target"][1] - rest["l"]["target"][1])
        if dl > 0.06:
            print(f"   *** the LEFT target moved {dl:.3f} m too — the sides are crossed")
            bad += 1

        # 2 — reach FORWARD (toward the camera = mp z negative)
        fwd = await probe(rw=[-0.24, -0.30, -0.42], re=[-0.26, -0.34, -0.10])
        dx = fwd["r"]["target"][0] - rest["r"]["target"][0]
        print(f"reach fwd right target Δx {dx:+.3f} m  (robot front is −X)")
        if not dx < -0.15:
            print("   *** reaching forward did not move the target to the front"); bad += 1

        # 3 — reach to the operator's OWN RIGHT (mp x further negative)
        side = await probe(rw=[-0.62, -0.30, 0.02], re=[-0.40, -0.34, 0.02])
        dz = side["r"]["target"][2] - rest["r"]["target"][2]
        print(f"reach rt  right target Δz {dz:+.3f} m  (robot right is −Z)")
        if not dz < -0.15:
            print("   *** reaching right did not move the target to the robot's right")
            bad += 1

        # 4 — lean forward: the torso must pitch forward, which is negative q
        lean = await probe(lean=1.0)
        print(f"lean      torso {lean['torsoDeg']:+.1f}°  → joint q {lean['torsoQ']:+.3f} rad "
              f"(rest {rest['torsoQ']:+.3f})")
        if not (lean["torsoDeg"] > 8 and lean["torsoQ"] < rest["torsoQ"] - 0.05):
            print("   *** leaning forward did not pitch the torso forward"); bad += 1

        # 5 — THE GAZE. Facing the camera squarely, the robot must look along
        # its own forward (GLB −X). Turn the head and the gaze must follow the
        # right way round; look down and it must pitch down, not roll.
        print()
        print(f"gaze      facing forward {fmt(rest['gaze'])}  "
              f"neck y/p/r {rest['neck']['yaw']:+.2f} {rest['neck']['pitch']:+.2f} "
              f"{rest['neck']['roll']:+.2f}")
        if not (rest["gaze"][0] < -0.9 and abs(rest["gaze"][1]) < 0.2):
            print("   *** a squarely-facing operator does not aim the gaze forward")
            bad += 1

        # turn the head to the operator's LEFT: the nose swings toward image
        # right (+x) and the ears follow. The robot's head must turn to ITS
        # left, which with forward = −X and right = −Z means gaze z goes +.
        # The preview beside this widget is MIRRORED, so turning your head to
        # your own left moves your image to the left of that frame and the
        # robot must follow it there. Screen-left is −Z with the camera in
        # front of the robot, so the gaze z must go NEGATIVE.
        turn = await probe(head=[0.10, 0.0, 0.0])
        print(f"turn left gaze {fmt(turn['gaze'])}  Δz {turn['gaze'][2]-rest['gaze'][2]:+.2f}")
        if not (turn["gaze"][2] - rest["gaze"][2] < -0.15):
            print("   *** turning the head does not match the mirrored preview"); bad += 1

        down = await probe(head=[0.0, 0.10, 0.0])
        print(f"look down gaze {fmt(down['gaze'])}  Δy {down['gaze'][1]-rest['gaze'][1]:+.2f}")
        if not (down["gaze"][1] - rest["gaze"][1] < -0.10):
            print("   *** looking down did not pitch the gaze down"); bad += 1
        if abs(down["gaze"][2] - rest["gaze"][2]) > 0.25:
            print("   *** looking down also swung the gaze sideways (axes crossed)")
            bad += 1

        # 6 — ROLL. Tilting your head toward a shoulder has to reach the neck,
        # and aiming a direction alone cannot carry it.
        roll = await probe(head=[0.0, 0.0, 0.12])
        print(f"head roll neck roll {roll['neck']['roll']:+.2f} rad "
              f"(rest {rest['neck']['roll']:+.2f})")
        if abs(roll["neck"]["roll"] - rest["neck"]["roll"]) < 0.10:
            print("   *** tilting the head does not roll the neck"); bad += 1
        if abs(roll["gaze"][1] - rest["gaze"][1]) > 0.25:
            print("   *** a pure roll also pitched the gaze"); bad += 1

        # 7 — HOLD ON LOSS. A dropped detection must freeze the arms, not
        # spring them back: relaxing on every lost frame is what made them
        # twitch whenever a hand left the frame.
        before = json.loads(await ev("JSON.stringify(window.__wt.targets())"))
        await ev("window.__wt.lose()")
        after = json.loads(await ev("JSON.stringify(window.__wt.targets())"))
        moved = max(abs(a - b) for a, b in zip(before["r"], after["r"]))
        print(f"\ntracking lost → target moved {moved*1000:.1f} mm")
        if moved > 0.001:
            print("   *** losing tracking moved the arm"); bad += 1

        # 8 — the solve has to fit in a frame
        bench = json.loads(await ev("JSON.stringify(window.__wt.bench(40))"))
        ms, cnt = bench["ms"], bench["n"]
        print(f"solve cost {ms:.2f} ms per frame over {cnt} solves "
              f"→ {1000 / max(0.01, ms):.0f} fps ceiling")
        if ms > 6.0:
            print("   *** the solve alone cannot hold 60 fps"); bad += 1

        # 9 — the solver actually converges on the target it was given
        worst = max(rest["r"]["err"], up["r"]["err"], fwd["r"]["err"]) * 1000
        print(f"\nworst tracking residual {worst:.0f} mm")
        if worst > 260:
            print("   *** the arm is not reaching its target"); bad += 1

        await ev("window.__wt.pause(false)")
        print("errors:", errs[:3] or "none")
        if errs:
            bad += 1
        print("\nRESULT:", "PASS" if bad == 0 else "FAIL")


def fmt(v):
    return "[" + " ".join(f"{x:+.2f}" for x in v) + "]"


asyncio.run(go())
p.terminate()
