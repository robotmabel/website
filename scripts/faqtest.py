#!/usr/bin/env python3
"""The troubleshooting pop-ups must actually open, with their figure.

These four panels were inline in build.html and moved into the wiki when the
build page folded into it. Three things broke in the move and none of them
were visible without opening a panel:

  * the handler was an inline <script> in build.html — it had to become a
    shared asset, and a missing <script src> leaves four cards that do nothing;
  * every path inside the templates was written from the site ROOT
    (assets/paper/…, docs/software.html). One level down they resolve to
    docs/assets/… and docs/docs/… — a broken figure and a dead link, in a
    pop-up nobody opens during a normal read;
  * the cards used the site's `.card`, whose recipe is built on glass tokens
    docs.css never imports, so they rendered as unstyled buttons.

So: open every panel, and assert the figure DECODED (naturalWidth > 0, not
just that an <img> exists) and that every link in the body resolves to a real
page. A 404 answers with a page, so the link check follows the href and
demands a 200.

    python scripts/faqtest.py http://localhost:8741/docs/troubleshoot.html
"""
import asyncio, json, random, subprocess, sys, time, urllib.parse, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
P = 9601 + random.randrange(60)   # its own port AND profile: two checks in
PROF = f"/tmp/cdp-faq-{P}"        # flight collided and one died mid-run
subprocess.run(["rm", "-rf", PROF])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={PROF}", "--window-size=1400,1000",
                      "--hide-scrollbars", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/docs/troubleshoot.html"

# Opening sets img.src, so the decode is ASYNC — reading naturalWidth straight
# after the click measures a race, not the figure. The first panel opened on a
# cold connection reported 0 px while the same image decoded fine on a rerun.
# So: await the load event (or a 6 s timeout) before measuring.
OPEN = """(function (i) {
  var cards = document.querySelectorAll('.faq-card');
  if (!cards[i]) return Promise.resolve(null);
  cards[i].click();
  var o = document.getElementById('faq-overlay');
  var img = document.getElementById('faq-pop-img');
  var settled = (img.complete && img.naturalWidth > 0)
    ? Promise.resolve()
    : new Promise(function (res) {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 6000);
      });
  return settled.then(function () {
    return { hidden: o.hidden,
             title: document.getElementById('faq-pop-title').textContent.trim(),
             bang: o.querySelector('.faq-bang').textContent,
             imgSrc: img.getAttribute('src') || '',
             imgW: img.naturalWidth,
             body: document.getElementById('faq-pop-body').textContent.trim().length,
             links: [].map.call(document.querySelectorAll('#faq-pop-body a'),
                                function (a) { return a.href; }),
             titleFace: getComputedStyle(document.getElementById('faq-pop-title')).fontFamily,
             cardFace: getComputedStyle(cards[i].querySelector('h4')).fontFamily,
             shadow: getComputedStyle(cards[i]).boxShadow };
  });
})"""


def reachable(u):
    try:
        req = urllib.request.Request(u, method="HEAD")
        return urllib.request.urlopen(req, timeout=6).status == 200
    except Exception:
        return False


async def go():
    tabs = None
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception:
            time.sleep(0.4)
    if not tabs:
        print(f"chrome never answered on :{P}\n\nRESULT: FAIL"); return 1
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    bad = 0
    async with websockets.connect(ws, max_size=None) as c:
        n = [0]

        async def cmd(m, pr=None):
            n[0] += 1
            await c.send(json.dumps({"id": n[0], "method": m, "params": pr or {}}))
            while True:
                r = json.loads(await c.recv())
                if r.get("id") == n[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True, "awaitPromise": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.navigate", {"url": URL})
        await asyncio.sleep(2.2)

        cards = await ev("document.querySelectorAll('.faq-card').length")
        temps = await ev("document.querySelectorAll('template[id^=faq-]').length")
        print(f"cards {cards}   templates {temps}")
        if not cards or cards != temps:
            print("  ✗ every card must name a template"); bad += 1

        for i in range(cards or 0):
            d = await ev(f"({OPEN})({i})")
            if not d:
                print(f"  ✗ card {i} vanished"); bad += 1; continue
            ok = True
            if d["hidden"]:
                print(f"  ✗ {i}: click did not open the overlay "
                      f"(is assets/faq-pop.js loaded?)"); ok = False
            if d["imgW"] == 0:
                print(f"  ✗ {i}: figure did not decode — {d['imgSrc']}"); ok = False
            if d["body"] < 120:
                print(f"  ✗ {i}: body is {d['body']} chars"); ok = False
            if "Limelight" not in d["titleFace"]:
                print(f"  ✗ {i}: title is {d['titleFace']}, not Limelight"); ok = False
            if "Bangers" not in d["cardFace"]:
                print(f"  ✗ {i}: card heading is {d['cardFace']}, not Bangers"); ok = False
            if d["shadow"] in ("none", ""):
                print(f"  ✗ {i}: card has no comic shadow — build.css missing?"); ok = False
            dead = [u for u in d["links"] if not reachable(u)]
            if dead:
                print(f"  ✗ {i}: dead link(s) {dead}"); ok = False
            bad += 0 if ok else 1
            print(f"  {'✓' if ok else '✗'} {d['bang']:<5} {d['title'][:38]:<40}"
                  f"img {d['imgW']}px   links {len(d['links'])}")
            await ev("document.getElementById('faq-x').click()")
            await asyncio.sleep(0.25)
            if not await ev("document.getElementById('faq-overlay').hidden"):
                print(f"  ✗ {i}: close button did not close it"); bad += 1
            if not await ev("document.body.style.overflow === ''"):
                print(f"  ✗ {i}: page scroll left locked"); bad += 1

        if await ev("(()=>{const g=document.querySelector('.faq-grid');"
                    "return !!g && g.scrollWidth > g.clientWidth + 1;})()"):
            print("  ✗ the card grid scrolls sideways"); bad += 1

    print(f"\nRESULT: {'PASS' if bad == 0 else 'FAIL'}")
    return 1 if bad else 0


try:
    code = asyncio.run(go())
finally:
    # Chrome does not always exit on SIGTERM inside the deadline, and a
    # TimeoutExpired here printed a traceback AFTER the verdict — noise that
    # looks like a failed check and could hide a real one.
    p.terminate()
    try:
        p.wait(timeout=10)      # rm races a still-running Chrome otherwise
    except subprocess.TimeoutExpired:
        p.kill()
    subprocess.run(["rm", "-rf", PROF])
sys.exit(code)
