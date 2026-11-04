#!/usr/bin/env python3
"""The buy page while the store is closed: "coming soon" and a form — measured.

    python scripts/ordertest.py http://localhost:8741/order.html [--shots DIR]

The robot's price must not appear anywhere on the page (the build-your-own
cost is the only figure), and the form must reach the store API and say so.
Spawns a REAL copy of commerce/order_api.py (private repo, beside this one)
with a throwaway database when it is there; without it, only the page checks run.

Two passes, desktop (1400×950) and phone (390×844, touch), and in each:
  * the page says coming soon, shows no robot price, and quotes the open build;
  * the gallery loads from order.json and its arrows and dots move it;
  * an empty submit is refused with a message and focus on the first bad field;
  * a filled form posts and the thank-you replaces the form, and the server
    stored every field (name, email, how, parts, uses, why, quantity, when);
  * an unreachable API fails LOUDLY and keeps the form.
Phone-only: no horizontal overflow at 390 and 360; every chip, field and
button is at least 44 px tall.
"""
import asyncio, base64, json, os, pathlib, random, socket, sqlite3, subprocess, sys, tempfile, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
from _chrome import cleanup_on_exit
REPO = pathlib.Path(__file__).resolve().parents[2]
P = 9441 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-order-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}", f"--user-data-dir=/tmp/cdp-order-{P}",
                      "--window-size=1400,950", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cleanup_on_exit(p)
URL = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8741/order.html").split("?")[0]
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
ORIGIN = URL.split("/order.html")[0]

HAVE_API = (REPO / "commerce" / "order_api.py").exists()
API = DB = None
if HAVE_API:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    tmp = tempfile.mkdtemp(prefix="mabel-soon-")
    DB = f"{tmp}/order.db"
    env = dict(os.environ, ORDER_DB=DB, ORDER_SECRET="check-secret", ORDER_ORIGINS=f"{ORIGIN},http://127.0.0.1:8741",
               STRIPE_SECRET_KEY="", STRIPE_WEBHOOK_SECRET="", SMTP_HOST="", TWILIO_SID="")
    # Keep the full API and email parser; only supply deterministic DNS records.
    # This test must never depend on Internet DNS or send mail to an inbox.
    boot = ("from types import SimpleNamespace; from commerce import interest_email; "
            "interest_email.RESOLVER = SimpleNamespace(resolve=lambda domain, kind: [SimpleNamespace(preference=10, exchange='mail.'+domain)]); "
            f"import uvicorn; uvicorn.run('commerce.order_api:app', host='127.0.0.1', port={port}, log_level='warning')")
    api = subprocess.Popen([sys.executable, "-c", boot],
                           cwd=str(REPO), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import atexit; atexit.register(lambda: (api.terminate(), subprocess.run(["rm", "-rf", tmp])))
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1); break
        except Exception:
            time.sleep(0.25)
    API = f"http://127.0.0.1:{port}"


async def go():
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{P}/json")); break
        except Exception:
            time.sleep(0.4)
    ws = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
    async with websockets.connect(ws, max_size=None) as c:
        i = [0]; errs = []; bad = [0]

        async def cmd(m, pp=None):
            i[0] += 1
            await c.send(json.dumps({"id": i[0], "method": m, "params": pp or {}}))
            while True:
                r = json.loads(await c.recv())
                if r.get("method") == "Runtime.exceptionThrown":
                    d = r["params"]["exceptionDetails"]
                    errs.append(str((d.get("exception") or {}).get("description") or d.get("text"))[:160])
                if r.get("id") == i[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True})
            if "exceptionDetails" in r.get("result", {}):
                return "JSERR " + str(r["result"]["exceptionDetails"].get("exception", {}).get("description", ""))[:160]
            return r.get("result", {}).get("result", {}).get("value")

        def check(ok, msg):
            print(("  ✓ " if ok else "  ✗ ") + msg)
            if not ok:
                bad[0] += 1

        async def shot(name):
            if not SHOTS:
                return
            os.makedirs(SHOTS, exist_ok=True)
            r = await cmd("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
            pathlib.Path(SHOTS, name + ".png").write_bytes(base64.b64decode(r["result"]["data"]))

        async def click(sel):
            """Through the input pipeline, not .click(): a phone check that
            dispatches synthetic clicks proves nothing about what a finger hits."""
            ok = await ev(f"(function(){{var e=document.querySelector({json.dumps(sel)}); if(!e) return false; e.scrollIntoView({{block:'center', behavior:'instant'}}); return true}})()")
            if not ok:
                return False
            await asyncio.sleep(0.1)
            r = await ev(f"(function(){{var b=document.querySelector({json.dumps(sel)}).getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];}})()")
            for t in ("mousePressed", "mouseReleased"):
                await cmd("Input.dispatchMouseEvent", {"type": t, "x": r[0], "y": r[1], "button": "left", "clickCount": 1})
            await asyncio.sleep(0.25)
            return True

        async def typ(sel, text):
            await ev(f"document.querySelector({json.dumps(sel)}).focus()")
            await cmd("Input.insertText", {"text": text})

        async def load(url):
            await cmd("Page.navigate", {"url": url})
            for _ in range(80):
                await asyncio.sleep(0.15)
                if await ev("!!(window.__soon && window.__soon.gallery.length)"):
                    break
            await ev("document.fonts.ready.then(function(){return true})")
            await ev("(function(){var st=document.createElement('style'); st.textContent='html,body{scroll-behavior:auto !important}'; document.head.appendChild(st); return true})()")

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        essential = None
        bs = REPO / "BOM" / "generated" / "bom_summary.json"
        if bs.exists():
            essential = "$" + f"{round(next(b['total'] for b in json.loads(bs.read_text())['builds'] if b['id'] == 'essential')):,}"

        for mobile in (False, True):
            tag = "phone" if mobile else "desktop"
            print(f"── {tag}")
            if mobile:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
                await cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            else:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 950, "deviceScaleFactor": 1, "mobile": False})
                await cmd("Emulation.setTouchEmulationEnabled", {"enabled": False})
            await load(URL + (f"?api={API}" if API else ""))
            await shot(f"{tag}-top")
            text = await ev("document.body.innerText")
            check("coming soon" in text.lower(), "the page says coming soon")
            check("$15,000" not in text and "$25,000" not in text and "Add to cart" not in text, "no robot price and no cart on the page")
            dollars = sorted(set(w.strip(".,·") for w in text.split() if w.startswith("$")))
            if essential:
                check(dollars == [essential], f"the only figure is the open build {essential} (saw {dollars})")
            n = await ev("window.__soon.gallery.length")
            check(n >= 3 and await ev("document.querySelectorAll('#csDots button').length") == n, f"the gallery has {n} photos and a dot each")
            src0 = await ev("document.getElementById('csSlide').getAttribute('src')")
            await click("#csNext")
            check(await ev("window.__soon.at") == 1 and await ev("document.getElementById('csSlide').getAttribute('src')") != src0, "the next arrow moves the gallery")
            await click("#csDots button:last-child")
            check(await ev("window.__soon.at") == n - 1, "a dot jumps to its photo")
            # every photo, portrait or landscape, sits in the SAME frame (a portrait shot once grew it to 1.5x)
            sizes = []
            for k in range(n):
                await ev(f"window.__soon.go({k}); true"); await asyncio.sleep(0.25)
                sizes.append(await ev("(function(){var a=document.querySelector('.cs-slide').getBoundingClientRect(), b=document.getElementById('csSlide').getBoundingClientRect(); return [Math.round(a.width),Math.round(a.height),Math.round(b.width),Math.round(b.height)]})()"))
            w, h = sizes[0][0], sizes[0][1]
            check(len({tuple(z) for z in sizes}) == 1 and abs(w / h - 1.5) < 0.02 and sizes[0][2:] == sizes[0][:2],
                  f"all {n} photos fill one 3:2 frame ({w}x{h}; distinct sizes: {len({tuple(z) for z in sizes})})")

            # empty submit: refused, focus on the name
            await click("#csSubmit")
            check("name" in (await ev("document.getElementById('csErr').textContent")).lower() and await ev("document.activeElement.id") == "csName",
                  "an empty form is refused, with focus on the name")
            name, email = f"Test {tag}", f"{tag}@example.org"
            await typ("#csName", name); await typ("#csEmail", "not-an-email")
            await click("#csSubmit")
            check(await ev("document.activeElement.id") == "csEmail", "a bad email is refused")
            await ev("document.getElementById('csEmail').value='ada@gmial.com'; document.getElementById('csEmail').dispatchEvent(new Event('blur')); true")
            await asyncio.sleep(.2)
            check(await ev("!document.getElementById('csEmailFix').hidden && document.getElementById('csEmail').value==='ada@gmial.com'"), "a provider typo gets an explicit suggestion, without silently changing the address")
            await click('#csEmailFix')
            check(await ev("document.getElementById('csEmail').value==='ada@gmail.com'"), "the suggested correction applies on request")
            await ev("document.getElementById('csEmail').value='ada..lab@gmail.com'; document.getElementById('csEmail').dispatchEvent(new Event('blur')); true")
            check(await ev("document.getElementById('csEmail').getAttribute('aria-invalid')==='true'"), "consecutive dots are refused inline")
            await ev("document.getElementById('csEmail').value=''"); await typ("#csEmail", email)
            await click('#csForm input[name=how][value=kit] + span')
            await click('#csForm input[name=parts][value="Arms"] + span')
            await click('#csForm input[name=parts][value="ORCA hands"] + span')
            await click('#csForm input[name=uses][value="Imitation learning"] + span')
            await ev("document.getElementById('csQty').value='2'; document.getElementById('csWhen').value='Within 6 months'; true")
            await typ("#csWhy", "Bimanual demonstrations for our manipulation lab.")
            d = await ev("window.__soon.collect()")
            check(d["how"] == "kit" and d["parts"] == ["Arms", "ORCA hands"] and d["uses"] == ["Imitation learning"], "the chips are picked by a tap")
            await shot(f"{tag}-filled")

            if mobile:
                for w in (390, 360):
                    await cmd("Emulation.setDeviceMetricsOverride", {"width": w, "height": 844, "deviceScaleFactor": 2, "mobile": True})
                    await asyncio.sleep(0.3)
                    ow = await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    check(ow <= 0, f"no horizontal overflow at {w} px ({ow} px)")
                small = await ev("""Array.from(document.querySelectorAll('#csForm input:not([type=checkbox]):not([type=radio]):not(#csSite), #csForm select, #csForm textarea, .cs-chip span, #csSubmit, .cs-arrow, .cs-dots button'))
                    .filter(function(e){var b=e.getBoundingClientRect(); return b.width && b.height < 44;}).map(function(e){return (e.id||e.textContent||e.className).slice(0,30)})""")
                check(not small, f"every control is at least 44 px tall {small or ''}")
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})

            if not API:
                print("  · no store API beside the site: skipping the submit")
                continue
            # an unreachable API fails loudly and keeps the form
            await ev("MabelStore.api='http://127.0.0.1:9'; true")
            await click("#csSubmit")
            for _ in range(30):
                await asyncio.sleep(0.15)
                if "could not be sent" in (await ev("document.getElementById('csErr').textContent")):
                    break
            check("could not be sent" in await ev("document.getElementById('csErr').textContent") and not await ev("document.getElementById('csForm').hidden"),
                  "an unreachable API fails loudly and keeps the form")
            await ev(f"MabelStore.api={json.dumps(API)}; true")
            await click("#csSubmit")
            for _ in range(40):
                await asyncio.sleep(0.15)
                if await ev("!document.getElementById('csDone').hidden"):
                    break
            check(await ev("!document.getElementById('csDone').hidden && document.getElementById('csForm').hidden"), "a sent note replaces the form with the thank-you")
            await shot(f"{tag}-sent")
            row = sqlite3.connect(DB).execute("SELECT name, email, data FROM interest WHERE email=?", (email,)).fetchone()
            ok = bool(row) and row[0] == name
            if ok:
                dd = json.loads(row[2])
                ok = dd["how"] == "kit" and dd["parts"] == ["Arms", "ORCA hands"] and dd["uses"] == ["Imitation learning"] and dd["qty"] == "2" \
                    and dd["when"] == "Within 6 months" and dd["why"].startswith("Bimanual")
            check(ok, "the server stored every field")

        check(not errs, f"no page errors {errs[:3] if errs else ''}")
        print("RESULT: PASS" if not bad[0] else f"RESULT: FAIL ({bad[0]})")
        return 1 if bad[0] else 0

sys.exit(asyncio.run(go()))
