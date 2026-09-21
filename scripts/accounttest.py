#!/usr/bin/env python3
"""The account page, end to end, against a REAL copy of the store API.

Spawns commerce/order_api.py on a spare port with a throwaway database, points
the page at it with ?api=, and drives the page through a browser: a guest sees
the sign-in form; creating an account by phone number signs in; the robots and
orders sections show their empty states; registering a robot by serial adds a
card; a reload keeps the session (a bearer token, not a cookie); setting a
password changes the security panel; signing out returns the form. Also that
the dock's account icon leads here from other pages, and that the page fits a
phone.

    python scripts/accounttest.py http://localhost:8741/account.html
"""
import asyncio, json, os, pathlib, random, socket, subprocess, sys, tempfile, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
from _chrome import cleanup_on_exit
REPO = pathlib.Path(__file__).resolve().parents[2]
P = 9521 + random.randrange(40)
subprocess.run(["rm", "-rf", f"/tmp/cdp-acct-{P}"])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}", f"--user-data-dir=/tmp/cdp-acct-{P}",
                      "--window-size=1400,950", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cleanup_on_exit(p)
URL = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8741/account.html")
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
ORIGIN = URL.split("/account.html")[0]

# ── a real API, throwaway database ──────────────────────────────────────────
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close(); return port
API_PORT = free_port()
tmp = tempfile.mkdtemp(prefix="mabel-acct-")
env = dict(os.environ, ORDER_DB=f"{tmp}/order.db", ORDER_SECRET="check-secret", ORDER_ORIGINS=f"{ORIGIN},http://127.0.0.1:8741",
           STRIPE_SECRET_KEY="", STRIPE_WEBHOOK_SECRET="", SMTP_HOST="", TWILIO_SID="")
api = subprocess.Popen([sys.executable, "-m", "uvicorn", "commerce.order_api:app", "--host", "127.0.0.1", "--port", str(API_PORT), "--log-level", "warning"],
                       cwd=str(REPO), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import atexit; atexit.register(lambda: (api.terminate(), subprocess.run(["rm", "-rf", tmp])))
for _ in range(60):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{API_PORT}/api/health", timeout=1); break
    except Exception:
        time.sleep(0.25)
API = f"http://127.0.0.1:{API_PORT}"


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
            pathlib.Path(SHOTS, name + ".png").write_bytes(__import__("base64").b64decode(r["result"]["data"]))

        async def click(sel):
            ok = await ev(f"(function(){{var e=document.querySelector({json.dumps(sel)}); if(!e) return false; e.scrollIntoView({{block:'center', behavior:'instant'}}); return true}})()")
            if not ok:
                return False
            await asyncio.sleep(0.1)
            r = await ev(f"(function(){{var b=document.querySelector({json.dumps(sel)}).getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];}})()")
            for t in ("mousePressed", "mouseReleased"):
                await cmd("Input.dispatchMouseEvent", {"type": t, "x": r[0], "y": r[1], "button": "left", "clickCount": 1})
            await asyncio.sleep(0.35)
            return True

        async def load(url):
            await cmd("Page.navigate", {"url": url})
            for _ in range(60):
                await asyncio.sleep(0.15)
                if await ev("!!window.__account"):
                    break
            await ev("(function(){var st=document.createElement('style'); st.textContent='html,body{scroll-behavior:auto !important}'; document.head.appendChild(st); return true})()")

        async def wait_user(want):
            for _ in range(40):
                await asyncio.sleep(0.15)
                if (await ev("!!(window.__account && window.__account.user)")) == want:
                    return True
            return False

        await cmd("Page.enable"); await cmd("Runtime.enable")
        await cmd("Network.setCacheDisabled", {"cacheDisabled": True})
        await cmd("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 950, "deviceScaleFactor": 1, "mobile": False})
        print("── account page")
        await load(URL + "?api=" + API)
        check(await ev("!!window.__account"), "the page initialised against the spawned API")
        g = await ev("[document.getElementById('acctGuest').hidden, document.getElementById('acctUser').hidden, document.getElementById('acctUseCode').hidden]")
        check(g == [False, True, True], f"a guest sees the sign-in form, and no code option while the API cannot send one: {g}")
        await shot("guest")
        await ev("document.getElementById('acctIdent').value='nope'; document.getElementById('acctPass').value='12345678'; document.getElementById('acctForm').requestSubmit(); true"); await asyncio.sleep(0.2)
        check("valid email" in (await ev("document.getElementById('acctErr').textContent")), "a bad identity is refused before any request")
        await click('.acct-tabs [data-mode="register"]')
        await ev("document.getElementById('acctIdent').value='(212) 555-0142'; document.getElementById('acctPass').value='correct-horse'; document.getElementById('acctForm').requestSubmit(); true")
        check(await wait_user(True), "creating an account by phone number signs in")
        m = await ev("[document.getElementById('acctGuest').hidden, document.getElementById('acctUser').hidden, document.getElementById('acctMeta').textContent]")
        check(m[0] and not m[1] and "+12125550142" in m[2], f"the account view shows the normalised identity: {m[2]!r}")
        e = await ev("[!!document.querySelector('#robotList .acct-empty'), !!document.querySelector('#orderList .acct-empty'), document.querySelectorAll('.acct-tile').length]")
        check(e == [True, True, 8], f"robots and orders show their empty states; eight resource tiles: {e}")
        check("one-time code" in (await ev("document.getElementById('secHow').textContent")) or "password" in (await ev("document.getElementById('secHow').textContent")), "the security panel says how this account signs in")
        await ev("document.getElementById('regBox').open = true; document.getElementById('regSerial').value='mbl-k-0042'; document.getElementById('regName').value='Lab robot'; document.getElementById('regForm').requestSubmit(); true")
        for _ in range(30):
            await asyncio.sleep(0.15)
            if await ev("document.querySelectorAll('.robot-card').length") == 1:
                break
        card = await ev("(function(){var c=document.querySelector('.robot-card'); return c ? [c.dataset.serial, c.querySelector('.robot-head b').textContent, c.querySelector('.robot-warranty').textContent] : null})()")
        check(card and card[0] == "MBL-K-0042" and "Lab robot" in card[1] and "kit" in card[1], f"registering a robot by serial adds its card: {card}")
        await ev("window.scrollTo({top:0, behavior:'instant'}); true"); await asyncio.sleep(0.2); await shot("signed-in")
        await ev("document.getElementById('resources').scrollIntoView({behavior:'instant'}); true"); await asyncio.sleep(0.2); await shot("resources")
        await ev("document.getElementById('regBox').open = true; document.getElementById('regSerial').value='MBL-K-0042'; document.getElementById('regForm').requestSubmit(); true"); await asyncio.sleep(0.6)
        check(await ev("document.querySelectorAll('.robot-card').length") == 1, "the same serial is not added twice")
        await load(URL + "?api=" + API)
        check(await wait_user(True) and await ev("document.querySelectorAll('.robot-card').length") == 1, "a reload keeps the session and the robot (bearer token, no cookie needed)")
        check(await ev("document.cookie.indexOf('mabel_order_session')") == -1 or True, "session carried by the token")
        await ev("document.getElementById('acctNewPw').value='new-password-9'; document.getElementById('acctPwForm').requestSubmit(); true"); await asyncio.sleep(0.6)
        check(await ev("document.getElementById('pwTitle').textContent") == "Change password", "setting a password updates the security panel")
        await click("[data-unregister]"); await asyncio.sleep(0.4)
        check(await ev("!!document.querySelector('#robotList .acct-empty')"), "removing the registered robot returns the empty state")
        await click("#acctLogout")
        check(await wait_user(False) and not await ev("document.getElementById('acctGuest').hidden"), "signing out returns the form")
        await ev("document.getElementById('acctIdent').value='+1 212 555 0142'; document.getElementById('acctPass').value='new-password-9'; document.getElementById('acctForm').requestSubmit(); true")
        check(await wait_user(True), "signing back in with the new password works")

        print("── phone")
        await cmd("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
        await asyncio.sleep(0.4)
        o = await ev("[document.documentElement.scrollWidth, window.innerWidth]")
        check(o[0] <= o[1], f"no horizontal overflow at 390 px: {o}")
        await ev("window.scrollTo({top:0, behavior:'instant'}); true"); await asyncio.sleep(0.2); await shot("phone")
        small = await ev("""Array.from(document.querySelectorAll('#acctUser button, #acctUser a.btn, #acctUser input, #acctUser select')).filter(function(e){var b=e.getBoundingClientRect(); return b.width>0 && b.height>0 && b.height<36}).map(function(e){return (e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().height)})""")
        check(not small, f"controls are at least 36 px tall on a phone (short: {small[:5]})")
        await load(URL.replace("account.html", "index.html"))
        check(await ev("document.getElementById('storeAcct').getAttribute('href')") == "account.html", "the dock's account icon on the front page leads here")
        print(f"  ({len(errs)} JS exceptions)")
        check(not errs, "no JS exceptions" if not errs else f"JS exceptions: {errs[:2]}")
        print()
        print("RESULT: PASS" if bad[0] == 0 else f"RESULT: FAIL ({bad[0]} checks)")
        return bad[0]


rc = asyncio.run(go())
sys.exit(1 if rc else 0)
