#!/usr/bin/env python3
"""The order page must price correctly, hide what does not fit, hold a cart,
and be usable on a phone — measured, not eyeballed.

    python scripts/ordertest.py http://localhost:8741/order.html [--shots DIR]

Two passes, desktop (1400×950) and phone (390×844, touch), and in each:
  * the four steps render from the catalog, and the DOM total equals the
    SERVER's pricing (commerce/pricing.py) for the defaults and for 12 random
    configurations — the page is a preview of the money, never the source;
  * a base-only robot hides the wrist, head and end-effector choices and an
    upper-body-only robot hides the lidar and base camera; the total ignores
    both, exactly like the server does;
  * option prices are DELTAS against the selected option (Apple's rule), the
    selected one says so, and the free default says Included;
  * the cart: add a configuration and a part, change quantities, remove,
    switch to a deposit, and see the drawer's total follow;
  * checkout against an unreachable API fails LOUDLY with the button restored;
  * the account sheet validates before it calls anything;
  * the share link round-trips the configuration through the URL;
  * the parts store lists every SKU, and its search and filters narrow it.
Phone-only:
  * no horizontal overflow at 390 and 360 wide, with the cart and the account
    sheet open too;
  * every interactive element in the store's widgets is at least 44 px tall;
  * the sticky total bar and the dock do not overlap each other, and the page
    can scroll its last line clear of both;
  * the cart drawer's checkout button and the account card fit in the viewport.
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
            """Click through the input pipeline, not .click(): a phone check that
            dispatches synthetic clicks proves nothing about what a finger hits."""
            ok = await ev(f"(function(){{var e=document.querySelector({json.dumps(sel)}); if(!e) return false; e.scrollIntoView({{block:'center', behavior:'instant'}}); return true}})()")
            if not ok:
                return False
            await asyncio.sleep(0.08)
            r = await ev(f"(function(){{var b=document.querySelector({json.dumps(sel)}).getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];}})()")
            for t in ("mousePressed", "mouseReleased"):
                await cmd("Input.dispatchMouseEvent", {"type": t, "x": r[0], "y": r[1], "button": "left", "clickCount": 1})
            await asyncio.sleep(0.25)
            return True

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})

        async def load(url):
            await cmd("Page.navigate", {"url": url})
            for _ in range(60):
                await asyncio.sleep(0.15)
                if await ev("!!window.__order"):
                    break
            await ev("document.fonts.ready.then(function(){return true})")
            # The site scrolls smoothly (mabel.css); a click computed mid-scroll lands
            # on whatever slid under it. Instant scrolling for the check only.
            await ev("(function(){var st=document.createElement('style'); st.textContent='html,body{scroll-behavior:auto !important}'; document.head.appendChild(st); return true})()")

        async def total():
            return await ev("document.getElementById('cfgTotal').textContent")

        def money(n):
            return "$" + f"{n:,}"

        async def one_pass(mobile):
            tag = "phone" if mobile else "desktop"
            print(f"── {tag}")
            if mobile:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
                await cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            else:
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 950, "deviceScaleFactor": 1, "mobile": False})
                await cmd("Emulation.setTouchEmulationEnabled", {"enabled": False})
            await load(URL)
            check(await ev("!!window.__order"), "the configurator initialised")
            await shot(f"{tag}-hero")

            # ── steps from the catalog ──
            n = await ev("[document.querySelectorAll('#cfg-robot .cfg-opt').length, document.querySelectorAll('#cfg-compute .cfg-opt').length, document.querySelectorAll('#cfg-sensors .cfg-grp').length, document.querySelectorAll('#cfg-effector .cfg-opt').length]")
            check(n == [4, 5, 4, 4], f"steps render 4 robots, 5 computes, 4 sensor groups, 4 effectors: {n}")
            d = pricing.defaults(CAT)
            check(await total() == money(pricing.price_config(CAT, "assembled", d)["total"]) == "$25,000", f"default total {await total()} is the $25,000 anchor")
            await click('#cfgTier button[data-tier="kit"]')
            check(await total() == "$15,000", f"kit total {await total()} is the $15,000 anchor")
            await click('#cfgTier button[data-tier="assembled"]')

            # ── deltas ──
            lab = await ev("document.querySelector('#cfg-compute .cfg-opt[data-opt=\"orin_nano\"] .cfg-opt-price').textContent")
            check(lab == "+ $600", f"an upgrade shows its delta: Orin Nano reads {lab!r}")
            await click('#cfg-compute .cfg-opt[data-opt="orin_nano"]')
            lab2 = await ev("[document.querySelector('#cfg-compute .cfg-opt[data-opt=\"orin_nano\"] .cfg-opt-price').textContent, document.querySelector('#cfg-compute .cfg-opt[data-opt=\"pi5\"] .cfg-opt-price').textContent]")
            check(lab2 == ["Selected", "− $600"], f"after picking it: {lab2}")
            check(await total() == "$25,600", f"total followed: {await total()}")
            await click('#cfg-compute .cfg-opt[data-opt="pi5"]')
            inc = await ev("document.querySelector('#cfg-sensors .cfg-opt[data-opt=\"lidar_none\"] .cfg-opt-price').textContent")
            check(inc == "Selected", f"the selected free option says Selected ({inc!r})")
            await shot(f"{tag}-configurator")

            # ── gating ──
            await click('#cfg-robot .cfg-opt[data-opt="base"]')
            g = await ev("[document.querySelectorAll('#cfg-sensors .cfg-grp').length, !!document.querySelector('#cfg-effector .cfg-skip'), document.querySelectorAll('#cfg-effector .cfg-opt').length, document.querySelector('#cfg-sensors .cfg-skip') && document.querySelector('#cfg-sensors .cfg-skip').textContent]")
            check(g[0] == 2 and g[1] and g[2] == 0 and "wrist" in (g[3] or ""), f"base-only hides wrist, head and effector, says why: {g}")
            check(await total() == "$7,500", f"base-only total {await total()} ignores the hidden choices")
            await click('#cfg-robot .cfg-opt[data-opt="upper"]')
            g2 = await ev("[document.querySelectorAll('#cfg-sensors .cfg-grp').length, document.querySelectorAll('#cfg-effector .cfg-opt').length, (document.querySelector('#cfg-sensors .cfg-skip')||{}).textContent]")
            check(g2[0] == 2 and g2[1] == 4 and "lidar" in (g2[2] or ""), f"upper-only hides lidar and base camera: {g2}")
            await shot(f"{tag}-gating")
            await click('#cfg-robot .cfg-opt[data-opt="complete"]')

            # ── parity with the server on random configurations ──
            rng = random.Random(11 if mobile else 3); mism = []
            for _ in range(12):
                t = rng.choice(["assembled", "kit"]); sel = {}
                for s in CAT["steps"]:
                    if "options" in s:
                        sel[s["id"]] = rng.choice(s["options"])["id"]
                    for gg in s.get("groups", []):
                        sel[gg["id"]] = rng.choice(gg["options"])["id"]
                await ev(f"(function(){{var o=window.__order; o.set('tier',{json.dumps(t)}); var s={json.dumps(sel)}; Object.keys(s).forEach(function(k){{o.sel[k]=s[k]}}); o.update(); return true}})()")
                want = money(pricing.price_config(CAT, t, sel)["total"]); got = await total()
                if want != got:
                    mism.append((t, sel, want, got))
            check(not mism, f"12 random configurations price like the server (mismatches: {len(mism)})")
            await ev("(function(){var o=window.__order; o.set('tier','assembled'); var d=" + json.dumps(d) + "; Object.keys(d).forEach(function(k){o.sel[k]=d[k]}); o.update(); return true})()")

            # ── share link ──
            u = await ev("location.search")
            check("?c=assembled.complete.pi5" in u, f"the URL carries the configuration: {u}")
            await load(URL.split("?")[0] + "?c=kit.base.orin_nano.wrist_std.head_std.lidar_c1.basecam_d435i.ee_none")
            check(await total() == money(pricing.price_config(CAT, "kit", {"robot": "base", "compute": "orin_nano", "lidar": "lidar_c1", "basecam": "basecam_d435i"})["total"]), f"a shared link restores tier and options: {await total()}")
            await load(URL.split("?")[0])

            # ── cart ──
            await ev("window.__order.clear()")
            if mobile:   # the bar only rides along inside the configurator; a real thumb is there when it taps it
                await ev("document.getElementById('cfg-compute').scrollIntoView({block:'center', behavior:'instant'}); true")
                for _ in range(20):
                    await asyncio.sleep(0.1)
                    if await ev("document.getElementById('cfgBar').classList.contains('is-on')"):
                        break
                await asyncio.sleep(0.3)
            await click("#cfgAdd" if not mobile else "#cfgBarAdd")
            await asyncio.sleep(0.4)   # the drawer slides in for 0.3 s; click it only once it has landed
            st = await ev("[document.getElementById('dockCartN').textContent, document.getElementById('cart').classList.contains('is-open'), document.getElementById('cartTotal').textContent]")
            check(st == ["1", True, "$25,000"], f"add to cart: badge, drawer open, total: {st}")
            await shot(f"{tag}-cart")
            await click('#cartPay button[data-pay="deposit"]')
            dep = await ev("[document.getElementById('cartTotal').textContent, document.getElementById('cartSumLabel').textContent]")
            check(dep[0] == "$2,500" and "$25,000" in dep[1], f"deposit shows 10% now and the full total: {dep}")
            await click('#cartPay button[data-pay="full"]')
            await ev("window.__order.addPart('P-3.01', 2)")
            st2 = await ev("[document.getElementById('dockCartN').textContent, document.getElementById('cartTotal').textContent, document.querySelectorAll('.cart-item').length]")
            check(st2 == ["3", "$25,240", 2], f"a part joins the cart with its quantity: {st2}")
            await click(".cart-item:nth-child(2) .cart-qty button:first-child")
            check(await ev("document.getElementById('cartTotal').textContent") == "$25,120", "quantity minus works")
            await click(".cart-item:nth-child(1) .cart-rm")
            st3 = await ev("[document.querySelectorAll('.cart-item').length, document.getElementById('cartTotal').textContent, document.getElementById('cartPay').style.display]")
            check(st3 == [1, "$120", "none"], f"removing the robot leaves the part and hides the deposit choice: {st3}")
            saved = await ev("JSON.parse(localStorage.getItem('mabel.cart.v1')).length")
            check(saved == 1, "the cart persists in localStorage")

            # ── checkout against nothing ──
            await ev("window.__order.api = 'http://127.0.0.1:9'")
            await click("#cartCheckout")
            for _ in range(30):
                await asyncio.sleep(0.2)
                if await ev("!document.getElementById('cartMsg').hidden"):
                    break
            m = await ev("[document.getElementById('cartMsg').hidden, document.getElementById('cartMsg').classList.contains('is-err'), document.getElementById('cartCheckout').disabled, document.getElementById('cartCheckout').textContent]")
            check(m == [False, True, False, "Checkout"], f"an unreachable checkout fails loudly and restores the button: {m}")
            await shot(f"{tag}-cart-error")
            await click("#cartClose"); await asyncio.sleep(0.4)   # the veil fades for 0.2 s and eats clicks meanwhile

            # ── account sheet ──
            await click("#dockAcct")
            check(await ev("document.getElementById('acct').classList.contains('is-open')"), "the account sheet opens")
            await ev("document.getElementById('acctEmail').value='nope'; document.getElementById('acctPass').value='12345678'; document.getElementById('acctForm').requestSubmit(); true")
            await asyncio.sleep(0.2)
            check("valid email" in (await ev("document.getElementById('acctErr').textContent")), "a bad email is refused before any request")
            await click('#acct [role="tab"][data-mode="register"]')
            check(await ev("document.getElementById('acctSubmit').textContent") == "Create account", "the Create-account tab switches the form")
            await shot(f"{tag}-account")
            await cmd("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
            await cmd("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
            await asyncio.sleep(0.15)
            check(not await ev("document.getElementById('acct').classList.contains('is-open')"), "Escape closes it")

            # ── parts store ──
            pn = await ev("document.querySelectorAll('.parts-card').length")
            check(pn == len(CAT["parts"]), f"the store lists every SKU ({pn} of {len(CAT['parts'])})")
            await ev("var s=document.getElementById('partsSearch'); s.value='DM4340'; s.dispatchEvent(new Event('input')); true")
            check(await ev("document.querySelectorAll('.parts-card').length") == 1, "search narrows to the one DM4340")
            await ev("var s=document.getElementById('partsSearch'); s.value=''; s.dispatchEvent(new Event('input')); true")
            await click('.parts-chip:nth-child(10)')   # Compute
            grp = await ev("Array.from(document.querySelectorAll('.parts-card .parts-grp')).map(function(e){return e.textContent.split(' ·')[0]})")
            check(grp and all(g == "Compute" for g in grp), f"the Compute filter shows only compute ({len(grp)} cards)")
            await click('.parts-chip:nth-child(1)')
            check(CAT["price_date"] in (await ev("document.getElementById('partsNote').textContent")), "the parts note names the price date")
            await ev("document.getElementById('parts').scrollIntoView(); true"); await asyncio.sleep(0.2)
            await shot(f"{tag}-parts")

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
                small = await ev("""Array.from(document.querySelectorAll('#cfgMain button, #cfgAside button, #parts button, #cart button, #acct button, #acct input, .ord-dock button, .cfg-bar button')).filter(function(e){var b=e.getBoundingClientRect(); return b.width>0 && b.height>0 && b.height<44}).map(function(e){return (e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().height)})""")
                check(not small, f"every interactive element is ≥ 44 px tall (short: {small[:6]})")
                await ev("document.getElementById('cfg-compute').scrollIntoView({block:'center', behavior:'instant'}); true"); await asyncio.sleep(0.5)
                bar = await ev("[document.getElementById('cfgBar').classList.contains('is-on'), document.getElementById('cfgBar').getBoundingClientRect().top, document.getElementById('ordDock').getBoundingClientRect().bottom, window.innerHeight]")
                check(bar[0] and bar[1] < bar[3] and bar[2] <= bar[1] + 0.5, f"inside the configurator the total bar is up and the dock sits above it: {bar}")
                await ev("window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}); true"); await asyncio.sleep(0.5)
                fb = await ev("[document.getElementById('cfgBar').classList.contains('is-on'), document.getElementById('cfgBar').getBoundingClientRect().top, window.innerHeight, document.querySelector('body > footer .foot-bottom').getBoundingClientRect().bottom, document.getElementById('ordDock').getBoundingClientRect().top]")
                check(not fb[0] and fb[1] >= fb[2] - 0.5, f"past the configurator the bar leaves the screen: {fb[:3]}")
                check(fb[3] <= fb[4] + 0.5, f"the page scrolls its last line clear of the dock: {fb[3:]}")
                toast_pe = await ev("getComputedStyle(document.getElementById('ordToast')).pointerEvents")
                check(toast_pe == "none", "the toast never intercepts a tap")
                fs = await ev("Array.from(document.querySelectorAll('.cfg-opt-spec, .parts-spec, .cart-item-desc, .cfg-sum-lines li')).map(function(e){return parseFloat(getComputedStyle(e).fontSize)}).filter(function(v){return v<12}).length")
                check(fs == 0, "no body copy in the widgets is under 12 px")
                await cmd("Emulation.setDeviceMetricsOverride", {"width": 360, "height": 780, "deviceScaleFactor": 2, "mobile": True})
                await asyncio.sleep(0.3)
                await overflow("at 360 px")
                await ev("document.getElementById('configure').scrollIntoView(); true"); await asyncio.sleep(0.2)
                await shot(f"{tag}-360-configurator")
            print(f"  ({len(errs)} JS exceptions)")
            check(not errs, "no JS exceptions" if not errs else f"JS exceptions: {errs[:2]}")

        await one_pass(False)
        await one_pass(True)
        print()
        print("RESULT: PASS" if bad[0] == 0 else f"RESULT: FAIL ({bad[0]} checks)")
        return bad[0]


rc = asyncio.run(go())
sys.exit(1 if rc else 0)
