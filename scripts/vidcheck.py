#!/usr/bin/env python3
"""Every clip on the page must actually play.

Three times now a clip has shipped as a black rectangle, and each time it
looked like a rendering problem and was a LOADING problem:

  * the accuracy lab called window.__lazyVid behind an `if` guard, from a
    script tag one line above the file that defines it;
  * the curation preview swapped .src on one element, which resets it to
    readyState 0 and paints black;
  * the Vision Pro clips finished their hi-res swap off screen and the
    replacement element was never handed the observer.

None of those is visible to a screenshot check — a black video and a video
that has not decoded yet look identical. So this scrolls the page from top to
bottom, the way a reader does, and then asks every <video> whether it has
frames.

    python scripts/vidcheck.py [page ...]
"""
import asyncio, json, os, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = 9391 + random.randrange(60)
PROF = f"/tmp/cdp-vid-{P}"
subprocess.run(["rm", "-rf", PROF])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={PROF}", "--window-size=1400,1000",
                      "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
                      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                      "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def go():
    pages = sys.argv[1:] or ["http://localhost:8741/" + f
                             for f in sorted(os.listdir(SITE))
                             if f.endswith(".html") and not f.startswith("_")]
    tabs = None
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json"))
            break
        except Exception:
            time.sleep(0.4)
    if not tabs:
        print(f"chrome never answered on :{P}\n\nRESULT: FAIL"); return 1
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    bad = 0
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 300))
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True,
                           "awaitPromise": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        for pg in pages:
            await cmd("Page.navigate", {"url": pg})
            # WAIT FOR THE PAGE TO FINISH BUILDING ITSELF. Several widgets
            # fetch JSON and only then create their <video> elements; scrolling
            # past before they exist reports "0 clips seen" on a page that has
            # two. hardware.html did exactly that.
            for _ in range(40):
                await asyncio.sleep(0.25)
                if await ev("document.readyState === 'complete'"):
                    break
            await asyncio.sleep(1.5)
            await ev("window.__loadDeferred && window.__loadDeferred()")
            await asyncio.sleep(1.0)
            # SCROLL THE WHOLE PAGE, the way a reader does. Every clip here is
            # started by an IntersectionObserver, so a clip nobody scrolls past
            # is CORRECTLY not loaded and must not be scored as broken.
            # MEASURE A CLIP WHILE IT IS IN VIEW, not at the end of the
            # scroll. Every clip here is started by an IntersectionObserver, so
            # by the time the page is at the bottom the ones near the top are
            # off screen and paused — reading them there says nothing about
            # whether they ever loaded. The first version of this check did
            # exactly that and reported 7 dead clips on a page with none.
            # VISIT EVERY CLIP, one at a time. Scrolling past and
            # sampling is racy in a way that hides real defects and invents
            # fake ones: a page that grows as its lazy sections reveal, a
            # widget that mounts mid-pass, a clip that is on screen for one
            # 600 ms sample. Run to run the same page reported 53 clips, then
            # 0, then 7. Asking each clip in turn — scroll to it, wait, read it
            # — is slower and gives the same answer every time.
            # TOUCH EVERY CLIP, THEN READ THEM ALL. Two passes, because
            # they need different things: making a clip intersect is instant
            # (that is all the IntersectionObserver needs), while FETCHING it
            # takes a moment — and every clip can fetch at the same time. One
            # pass that waited on each clip in turn took 53 x 1.4 s on
            # software.html and timed out the connection.
            #
            # Scrolling past and sampling, which this replaced, was racy in a
            # way that both hid real defects and invented fake ones: run to run
            # the same page reported 53 clips, then 0, then 7.
            # TWO QUESTIONS, AND ONLY THE FIRST CAN BREAK: did the lazy
            # wiring FIRE for this clip (start() assigns .src the moment the
            # IntersectionObserver reports it), and did the file then load?
            #
            # They need different treatment. Firing is what a widget can get
            # wrong — a missed __lazyVid call, a swapped element that was never
            # re-observed, a src assignment that resets the media object — and
            # it is instant, so it is recorded per clip right after touching
            # it. Loading is the network's business and every clip can do it at
            # once, so it is read in one final pass.
            #
            # The horizontal marquee is why the recording is per clip: it is a
            # carousel, so scrolling the tenth card into view scrolls the first
            # one 3.5 metres off the left edge. Touch them all and then look,
            # and eight perfectly good clips read as broken.
            got = await ev("""(function(){
              var vs = [].slice.call(document.querySelectorAll('video'))
                .filter(function (v) {
                  var r = v.getBoundingClientRect();
                  return r.width > 4 && r.height > 4;   // never displayed
                });
              var round = 0;
              return new Promise(function (res) {
                (function touch(i) {
                  if (i >= vs.length) {
                    return setTimeout(function () {
                      // A SECOND ROUND FOR WHATEVER IS STILL EMPTY. In the
                      // horizontal marquee, touching card ten scrolls card one
                      // 3.5 m off the left edge — if its observer had not
                      // fired yet, it never will. One more pass over just
                      // those converges; anything still empty after two is
                      // genuinely not wired to anything.
                      var left = vs.filter(function (v) {
                        return !(v.src || v.currentSrc);
                      });
                      if (left.length && round < 2) {
                        round++;
                        return (function again(j) {
                          if (j >= left.length) return touch(vs.length);
                          left[j].scrollIntoView({block: 'center',
                            inline: 'center', behavior: 'instant'});
                          setTimeout(function () { again(j + 1); }, 420);
                        })(0);
                      }
                      res(vs.map(function (v, k) {
                        return {
                          src: (v.currentSrc || v.getAttribute('data-lazyvid')
                                || ('#' + k)).split('/').pop(),
                          wired: (v.src || v.currentSrc) ? 1 : 0,
                          ok: (v.readyState >= 2 && v.videoWidth > 0) ? 1 : 0,
                          err: v.error ? v.error.code : 0};
                      }));
                    }, 6000);
                  }
                  // BEHAVIOR 'instant'. The stylesheet sets
                  // `scroll-behavior: smooth`, so the default ANIMATES — the
                  // element is still on its way after a quarter second and
                  // every clip reads as never-wired.
                  vs[i].scrollIntoView({block: 'center', inline: 'center',
                                        behavior: 'instant'});
                  setTimeout(function () {
                    touch(i + 1);
                  }, 260);
                })(0);
              });})()""")
            got = got or []
            # A CLIP GLIMPSED IN PASSING IS NOT A BROKEN CLIP. Two looks is
            # 1.2 s of screen time, and a clip that enters view at the bottom
            # of one step and leaves at the top of the next has not been given
            # a fair chance to fetch — measured on the four sim strips, which
            # load perfectly when you actually stop on them. Three looks is
            # ~1.9 s, which is long enough on localhost by a wide margin.
            # a clip that never got a src is BROKEN WIRING; one that has a
            # src and no frames yet is just still fetching
            dead = [g for g in got if not g["wired"]]
            slow = [g for g in got if g["wired"] and not g["ok"]]
            errs = [g for g in got if g["err"]]
            name = pg.rsplit("/", 1)[-1]
            print(f"{name:16s} {len(got):3d} clips, "
                  f"{len(got)-len(dead):3d} wired"
                  + (f", {len(slow)} still fetching" if slow else "")
                  + ("" if not dead else
                     "   NEVER WIRED: " + ", ".join(sorted(
                         {d['src'] or '(no src)' for d in dead})[:4])))
            bad += len(dead) + len(errs)
    print("\nRESULT:", "PASS" if bad == 0 else "FAIL")
    return 1 if bad else 0


try:
    sys.exit(asyncio.run(go()))
finally:
    p.kill()
