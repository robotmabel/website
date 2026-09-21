#!/usr/bin/env python3
"""The buy page must sell one pick at a time, price like the server, hold a
cart, sign people in, and be usable on a phone — measured, not eyeballed.

    python scripts/ordertest.py http://localhost:8741/order.html [--shots DIR]

Two passes, desktop (1400×950) and phone (390×844, touch), and in each:
  * only the first step is open; every later step is grey and says which step
    to choose first; each pick opens exactly the next step;
  * the bar's price is the SERVER's price (commerce/pricing.py) for the picks
    so far with defaults for the rest, and says "From" until the last pick;
  * a base-only robot removes the wrist, head and end-effector steps; an
    upper-body-only robot removes the lidar and base camera;
  * add-on prices never read as a minus; the cheapest choice says Included;
  * the share link in the URL opens the page fully picked (the link a buyer
    is sent), and the bar then offers Add to cart at $25,000;
  * the gallery follows the pick and its arrows and dots work;
  * what's in the box switches with the tier; delivery has three tiles;
  * the parts grid shows a preview, expands to every SKU, filters by tab and
    search, and adds to the cart from one tap;
  * the cart: quantities, remove, deposit, a loud failure when checkout is
    unreachable; the account sheet validates, offers a code only when the
    server can send one, and keeps a bearer token rather than a cookie.
Phone-only:
  * no horizontal overflow at 390 and 360, with the drawer and sheet open;
  * every interactive element in the store's widgets is at least 44 px tall;
  * the sticky bar rides the configurator only, and never overlaps the dock.
`--shots DIR` saves a viewport screenshot of each state to look at.
"""
import asyncio, base64, json, os, pathlib, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))   # commerce/
from _chrome import cleanup_on_exit
from commerce import pricing
P = 9441 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-order-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir=/tmp/cdp-order-{P}", "--window-size=1400,950",
                      "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cleanup_on_exit(p)
URL = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8741/order.html")
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
CAT = pricing.load_catalog()
FULL = ["tier", "robot", "compute", "wrist", "head", "lidar", "basecam", "effector"]


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
            r = await cmd("Page.captureScreenshot", {"format": "png"})
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
            await asyncio.sleep(0.45)   # a pick re-renders and walks to the next step; let it land
            return True

        async def load(url):
            await cmd("Page.navigate", {"url": url})
            for _ in range(60):
                await asyncio.sleep(0.15)
                if await ev("!!window.__order"):
                    break
            await ev("document.fonts.ready.then(function(){return true})")
            # The site scrolls smoothly (mabel.css); a click computed mid-scroll lands
            # on whatever slid under it. Instant scrolling for the check only.
            await ev("(function(){var st=document.createElement('style'); st.textContent='html,body{scroll-behavior:auto !important} .buy-step,.buy-bar,.cart,.cart-veil,.acct{transition:none !important}'; document.head.appendChild(st); return true})()")

        async def states():
            return await ev("Array.from(document.querySelectorAll('.buy-step')).map(function(s){return s.dataset.step+':'+s.dataset.state})")

        async def price():
            return await ev("document.getElementById('buyBarPrice').textContent")

        def money(n):
            return "$" + f"{n:,}"

        def expect(tier, picks):
            sel = pricing.defaults(CAT); sel.update({k: v for k, v in picks.items() if k != "tier"})
            return pricing.price_config(CAT, tier, sel)["total"]

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})

        async def one_pass(mobile):
            tag = "phone" if mobile else "desktop"
            print(f"── {tag}")
            if mobile:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
                await cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            else:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 950, "deviceScaleFactor": 1, "mobile": False})
                await cmd("Emulation.setTouchEmulationEnabled", {"enabled": False})
            await load(URL.split("?")[0])
            check(await ev("!!window.__order"), "the buy flow initialised")
            await shot(f"{tag}-top")

            # ── one pick at a time ──
            st = await states()
            check(st[0] == "tier:open" and all(s.endswith(":locked") for s in st[1:]) and len(st) == len(FULL), f"only the first step is open: {st}")
            lock = await ev("document.querySelector('#buy-robot .buy-step-lock').textContent")
            check(lock == "Choose how it ships first.", f"a locked step says which to choose first: {lock!r}")
            check(await price() == "From $15,000" and await ev("document.getElementById('buyAdd').disabled"), f"before any pick the bar says From $15,000 and cannot add: {await price()}")
            await click('.buy-opt[data-step="tier"][data-opt="assembled"]')
            st = await states()
            check(st[0] == "tier:done" and st[1] == "robot:open" and st[2] == "compute:locked", f"picking the tier opens the robot step and nothing else: {st[:3]}")
            check(await price() == "From " + money(expect("assembled", {})), f"after the tier the bar prices the defaults: {await price()}")
            await click('.buy-opt[data-step="robot"][data-opt="complete"]')
            await click('.buy-opt[data-step="compute"][data-opt="orin_nano"]')
            st = await states()
            check(st[2] == "compute:done" and st[3] == "wrist:open" and st[4] == "head:locked", f"compute done opens the wrist step only: {st[2:5]}")
            check(await price() == "From " + money(expect("assembled", {"robot": "complete", "compute": "orin_nano"})), f"the bar follows the picks: {await price()}")
            lab = await ev("[document.querySelector('.buy-opt[data-opt=\"orin_nano\"] .buy-opt-price').textContent, document.querySelector('.buy-opt[data-opt=\"pi5\"] .buy-opt-price').textContent]")
            check(lab == ["+ $600", "Included"], f"add-ons over the cheapest, the cheapest says Included: {lab}")
            await shot(f"{tag}-midway")
            for step, opt in (("wrist", "wrist_std"), ("head", "head_std"), ("lidar", "lidar_none"), ("basecam", "basecam_none")):
                await click(f'.buy-opt[data-step="{step}"][data-opt="{opt}"]')
            eff = await ev("Array.from(document.querySelectorAll('.buy-opt[data-step=\"effector\"] .buy-opt-price')).map(function(e){return e.textContent})")
            check(eff and all("-" not in x and "−" not in x for x in eff) and eff[0] == "Included", f"end-effector prices never read as a minus: {eff}")
            await click('.buy-opt[data-step="effector"][data-opt="ee_orca"]')
            done = await ev("[window.__order.complete(), document.getElementById('buyAdd').disabled, document.getElementById('buyAdd').textContent]")
            check(done == [True, False, "Add to cart"], f"the last pick enables Add to cart: {done}")
            check(await price() == money(expect("assembled", {"robot": "complete", "compute": "orin_nano", "effector": "ee_orca"})) == "$25,600", f"complete: the bar drops From and shows the total: {await price()}")
            check("?c=assembled.complete.orin_nano" in (await ev("location.search")), "the URL carries the configuration once complete")
            await shot(f"{tag}-complete")

            # ── gating by body ──
            await click('.buy-opt[data-step="robot"][data-opt="base"]')
            st = await states()
            names = [s.split(":")[0] for s in st]
            check(names == ["tier", "robot", "compute", "lidar", "basecam"], f"base-only removes wrist, head and end effector: {names}")
            await click('.buy-opt[data-step="lidar"][data-opt="lidar_none"]'); await click('.buy-opt[data-step="basecam"][data-opt="basecam_none"]')
            want = money(expect("assembled", {"robot": "base", "compute": "orin_nano"}))
            check(await ev("window.__order.complete()") and await price() == want == "$8,100", f"base-only keeps the compute pick and ignores the hidden steps: {await price()} (want {want})")
            await click('.buy-opt[data-step="robot"][data-opt="upper"]')
            names = [s.split(":")[0] for s in await states()]
            check(names == ["tier", "robot", "compute", "wrist", "head", "effector"], f"upper-only removes lidar and base camera: {names}")
            await shot(f"{tag}-gating")

            # ── the link a buyer is sent ──
            await load(URL.split("?")[0] + "?c=assembled.complete.pi5.wrist_std.head_std.lidar_none.basecam_none.ee_orca")
            st = await states()
            check(all(s.endswith(":done") for s in st) and await price() == "$25,000" and not await ev("document.getElementById('buyAdd').disabled"), f"a share link opens fully picked at $25,000: {await price()}")

            # ── parity with the server on random complete configurations ──
            rng = random.Random(11 if mobile else 3); mism = []
            for _ in range(10):
                t = rng.choice(["assembled", "kit"]); sel = {}
                for s in CAT["steps"]:
                    if "options" in s:
                        sel[s["id"]] = rng.choice(s["options"])["id"]
                    for gg in s.get("groups", []):
                        sel[gg["id"]] = rng.choice(gg["options"])["id"]
                await ev(f"(function(){{var o=window.__order; o.reset(); o.choose('tier',{json.dumps(t)}); var s={json.dumps(sel)}; Object.keys(s).forEach(function(k){{o.choose(k,s[k])}}); return true}})()")
                want = money(pricing.price_config(CAT, t, sel)["total"]); got = await price()
                if want != got:
                    mism.append((t, sel, want, got))
            check(not mism, f"10 random complete configurations price like the server (mismatches: {len(mism)})")

            # ── gallery ──
            await load(URL.split("?")[0])
            g0 = await ev("[document.querySelectorAll('#buyDots button').length, window.__order.slide]")
            check(g0 == [len(CAT["gallery"]), "photo"], f"the gallery opens on the photo with a dot per slide: {g0}")
            await click('.buy-opt[data-step="tier"][data-opt="kit"]'); await click('.buy-opt[data-step="robot"][data-opt="base"]')
            check(await ev("window.__order.slide") == "base", "picking the base shows the base")
            await click("#buyNext"); s1 = await ev("window.__order.slide"); await click("#buyPrev"); s2 = await ev("window.__order.slide")
            check(s1 == "hands" and s2 == "base", f"the arrows step through the slides: {s1}, {s2}")
            await click("#buyDots button:nth-child(10)")
            check(await ev("window.__order.slide") == "exploded" and await ev("document.getElementById('buySlide').classList.contains('is-contain')"), "the exploded view fits inside the frame")

            # ── box, delivery, compare ──
            b = await ev("[document.querySelectorAll('#boxGrid .box-tile').length, document.querySelectorAll('#boxTabs button').length]")
            check(b == [len(CAT["box"]["assembled"]), 2], f"what's in the box renders the assembled list: {b}")
            await click("#boxTabs button:nth-child(2)")
            check(await ev("document.querySelectorAll('#boxGrid .box-tile').length") == len(CAT["box"]["kit"]), "…and switches to the kit")
            check(await ev("document.querySelectorAll('#dlvGrid .dlv-tile').length") == 3, "three delivery tiles")

            # ── parts ──
            pn = await ev("[document.querySelectorAll('.parts-card').length, document.getElementById('partsMoreWrap').hidden]")
            check(pn == [8, False], f"the parts grid previews eight with a Show-all: {pn}")
            await click("#partsMore")
            check(await ev("document.querySelectorAll('.parts-card').length") == len(CAT["parts"]), "Show all lists every SKU")
            await click('.parts-tab[data-group="Compute"]')
            grp = await ev("Array.from(document.querySelectorAll('.parts-card')).map(function(c){return c.dataset.sku})")
            check(grp and all(any(p["sku"] == s and p["group"] == "Compute" for p in CAT["parts"]) for s in grp), f"the Compute tab shows only compute ({len(grp)} cards)")
            await click('.parts-tab[data-group="All"]')
            await ev("var s=document.getElementById('partsSearch'); s.value='DM4340'; s.dispatchEvent(new Event('input')); true")
            check(await ev("document.querySelectorAll('.parts-card').length") == 1, "search narrows to the one DM4340")
            await ev("window.__order.clear(); true")
            await click(".parts-card .parts-add")
            check(await ev("document.getElementById('storeCartN').textContent") == "1" and not await ev("document.getElementById('storeCartN').hidden"), "one tap adds a part and the top-right dock counts it")
            await ev("var s=document.getElementById('partsSearch'); s.value=''; s.dispatchEvent(new Event('input')); true")
            await ev("document.getElementById('parts').scrollIntoView({behavior:'instant'}); true"); await asyncio.sleep(0.2)
            await shot(f"{tag}-parts")

            # ── cart ──
            await load(URL.split("?")[0] + "?c=assembled.complete.pi5.wrist_std.head_std.lidar_none.basecam_none.ee_orca")
            await ev("window.__order.clear(); true")
            await ev("document.getElementById('configure').scrollIntoView({behavior:'instant'}); true"); await asyncio.sleep(0.5)
            await click("#buyAdd"); await asyncio.sleep(0.4)
            st = await ev("[document.getElementById('storeCartN').textContent, document.getElementById('cart').classList.contains('is-open'), document.getElementById('cartTotal').textContent]")
            check(st == ["1", True, "$25,000"], f"add to cart: dock badge, drawer open, total: {st}")
            await shot(f"{tag}-cart")
            await click('#cartPay button[data-pay="deposit"]')
            dep = await ev("[document.getElementById('cartTotal').textContent, document.getElementById('cartSumLabel').textContent]")
            check(dep[0] == "$2,500" and "$25,000" in dep[1], f"deposit shows 10% now and the full total: {dep}")
            await click('#cartPay button[data-pay="full"]')
            await ev("window.__order.addPart('P-3.01', 2)")
            st2 = await ev("[document.getElementById('storeCartN').textContent, document.getElementById('cartTotal').textContent, document.querySelectorAll('.cart-item').length]")
            check(st2 == ["3", "$25,240", 2], f"a part joins the cart with its quantity: {st2}")
            await click(".cart-item:nth-child(2) .cart-qty button:first-child")
            check(await ev("document.getElementById('cartTotal').textContent") == "$25,120", "quantity minus works")
            await click(".cart-item:nth-child(1) .cart-rm")
            st3 = await ev("[document.querySelectorAll('.cart-item').length, document.getElementById('cartTotal').textContent, document.getElementById('cartPay').style.display]")
            check(st3 == [1, "$120", "none"], f"removing the robot leaves the part and hides the deposit choice: {st3}")
            await ev("window.__order.api = 'http://127.0.0.1:9'")
            await click("#cartCheckout")
            for _ in range(30):
                await asyncio.sleep(0.2)
                if await ev("!document.getElementById('cartMsg').hidden"):
                    break
            m = await ev("[document.getElementById('cartMsg').hidden, document.getElementById('cartMsg').classList.contains('is-err'), document.getElementById('cartCheckout').disabled, document.getElementById('cartCheckout').textContent]")
            check(m == [False, True, False, "Checkout"], f"an unreachable checkout fails loudly and restores the button: {m}")
            await click("#cartClose"); await asyncio.sleep(0.3)

            # ── account ──
            await click("#storeAcct")
            check(await ev("document.getElementById('acct').classList.contains('is-open')"), "the top-right account icon opens the sheet")
            check(await ev("document.getElementById('acctUseCode').hidden"), "no code option is offered while the server cannot send one")
            await ev("window.__order.otp = {email: true, sms: false}; true")
            check(not await ev("document.getElementById('acctUseCode').hidden"), "…and it appears when the server can")
            await ev("document.getElementById('acctIdent').value='nope'; document.getElementById('acctPass').value='12345678'; document.getElementById('acctForm').requestSubmit(); true")
            await asyncio.sleep(0.2)
            check("valid email" in (await ev("document.getElementById('acctErr').textContent")), "a bad identity is refused before any request")
            await ev("document.getElementById('acctIdent').value='+1 212 555 0100'; document.getElementById('acctPass').value='1234'; document.getElementById('acctForm').requestSubmit(); true")
            await asyncio.sleep(0.2)
            check("8 characters" in (await ev("document.getElementById('acctErr').textContent")), "a phone number is accepted as an identity and the short password is refused")
            await click('#acct [role="tab"][data-mode="register"]')
            check(await ev("document.getElementById('acctSubmit').textContent") == "Create account", "the Create-account tab switches the form")
            await click("#acctUseCode")
            check(await ev("[document.getElementById('acctPwRow').hidden, document.getElementById('acctSubmit').textContent]") == [True, "Send code"], "the code path hides the password and asks to send a code")
            check(await ev("document.cookie.indexOf('mabel_order_session')") == -1 and await ev("localStorage.getItem('mabel.session')") is None, "no session is invented client-side")
            await shot(f"{tag}-account")
            await cmd("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
            await cmd("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
            await asyncio.sleep(0.15)
            check(not await ev("document.getElementById('acct').classList.contains('is-open')"), "Escape closes it")

            if mobile:
                print("── phone layout")
                async def overflow(label):
                    o = await ev("[document.documentElement.scrollWidth, window.innerWidth]")
                    check(o[0] <= o[1], f"no horizontal overflow {label}: scrollWidth {o[0]} ≤ {o[1]}")
                await overflow("at 390 px")
                await ev("window.__order.openCart(); true"); await asyncio.sleep(0.35)
                await overflow("with the cart open")
                cw = await ev("[document.getElementById('cart').getBoundingClientRect().width, window.innerWidth, document.getElementById('cartCheckout').getBoundingClientRect().bottom, window.innerHeight]")
                check(cw[0] == cw[1] and cw[2] <= cw[3], f"the cart drawer is full width and its Checkout button is on screen: {cw}")
                await ev("window.__order.closeCart(); window.__order.openAcct(); true"); await asyncio.sleep(0.3)
                await overflow("with the account sheet open")
                ah = await ev("[document.querySelector('.acct-card').getBoundingClientRect().height, window.innerHeight]")
                check(ah[0] <= ah[1], f"the account card fits the viewport: {ah}")
                await ev("window.__order.closeAcct(); true")
                small = await ev("""Array.from(document.querySelectorAll('#buySteps button, #buyGallery button:not(.buy-dots button), #box button, #parts button, #cart button, #acct button, #acct input, .buy-bar button')).filter(function(e){var b=e.getBoundingClientRect(); return b.width>0 && b.height>0 && b.height<44}).map(function(e){return (e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().height)})""")
                check(not small, f"every interactive element is ≥ 44 px tall (short: {small[:6]})")
                dots = await ev("Array.from(document.querySelectorAll('.buy-dots button')).map(function(b){return b.getBoundingClientRect().height})")
                check(dots and min(dots) >= 28, f"the gallery dots have a 28 px hit area (the arrows are the 44 px control): {min(dots) if dots else None}")
                await ev("document.getElementById('buy-compute').scrollIntoView({block:'center', behavior:'instant'}); true"); await asyncio.sleep(0.5)
                bar = await ev("[document.getElementById('buyBar').classList.contains('is-on'), document.getElementById('buyBar').getBoundingClientRect().top, window.innerHeight, document.getElementById('storeDock').getBoundingClientRect().bottom]")
                check(bar[0] and bar[1] < bar[2] and bar[3] < bar[1], f"inside the configurator the bar is up, below the dock: {bar}")
                await shot(f"{tag}-bar")
                await ev("window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}); true"); await asyncio.sleep(0.5)
                fb = await ev("[document.getElementById('buyBar').classList.contains('is-on'), document.getElementById('buyBar').getBoundingClientRect().top, window.innerHeight]")
                check(not fb[0] and fb[1] >= fb[2] - 0.5, f"past the configurator the bar leaves the screen: {fb}")
                check(await ev("getComputedStyle(document.getElementById('ordToast')).pointerEvents") == "none", "the toast never intercepts a tap")
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 360, "height": 780, "deviceScaleFactor": 2, "mobile": True})
                await asyncio.sleep(0.3)
                await overflow("at 360 px")
            print(f"  ({len(errs)} JS exceptions)")
            check(not errs, "no JS exceptions" if not errs else f"JS exceptions: {errs[:2]}")

        await one_pass(False)
        await one_pass(True)
        print()
        print("RESULT: PASS" if bad[0] == 0 else f"RESULT: FAIL ({bad[0]} checks)")
        return bad[0]


rc = asyncio.run(go())
sys.exit(1 if rc else 0)
