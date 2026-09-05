#!/usr/bin/env python3
"""The published harness surface must match the repo's own command registry.

This page exists to say what the AI harness can do. The failure mode is not
that it looks wrong — it is that it stays plausible while the repo moves: a
command gets renamed, a new one ships, and the page keeps confidently listing
the old set. Nobody notices, because a list of 25 plausible commands looks
exactly like a list of 25 correct ones.

So this checks the page against the JSON it was generated from, and the JSON
against the registry it was generated from:

  * every command in assets/data/harness.json is on the page, once
  * the count the hero claims is the count the page renders
  * the filters filter, and their tallies match what they show
  * the search searches
  * every safety badge rendered is one the legend explains
  * a card that claims a `note` renders it

`scripts/build_harness.py --check` covers JSON-vs-registry, and
`mabel.py drift` covers registry-vs-disk in both directions. The three
together mean a command cannot exist without appearing here, and cannot
appear here without existing.

    python scripts/hxtest.py [url]
"""
import asyncio, json, os, random, subprocess, sys, time, urllib.request, websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
DATA = os.path.join(SITE, "assets", "data", "harness.json")

P = 9931 + random.randrange(50)        # its own port AND profile: two checks in
PROF = f"/tmp/cdp-hx-{P}"              # flight collided and one died mid-run
subprocess.run(["rm", "-rf", PROF])
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={P}",
                      f"--user-data-dir={PROF}", "--window-size=1440,1000",
                      "--hide-scrollbars", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8741/harness.html"


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
    reg = json.load(open(DATA))
    bad = 0

    async with websockets.connect(ws, max_size=None) as c:
        n = [0]

        async def cmd(m, pr=None):
            n[0] += 1
            await c.send(json.dumps({"id": n[0], "method": m, "params": pr or {}}))
            while True:
                r = json.loads(await asyncio.wait_for(c.recv(), 60))
                if r.get("id") == n[0]:
                    return r

        async def ev(e):
            r = await cmd("Runtime.evaluate",
                          {"expression": e, "returnByValue": True, "awaitPromise": True})
            return r.get("result", {}).get("result", {}).get("value")

        await cmd("Page.navigate", {"url": URL})
        await asyncio.sleep(2.4)

        shown = await ev("[].map.call(document.querySelectorAll('.ahx-card'),"
                         "function(c){return c.dataset.name;})") or []
        want = [c["name"] for g in reg["groups"] for c in g["commands"]]
        print(f"registry {len(want)} commands · page renders {len(shown)}")

        missing = [w for w in want if w not in shown]
        extra = [s for s in shown if s not in want]
        dupes = sorted({s for s in shown if shown.count(s) > 1})
        for label, items in (("on the page but not in the registry", extra),
                             ("in the registry but not on the page", missing),
                             ("rendered more than once", dupes)):
            if items:
                print(f"  ✗ {label}: {items}"); bad += 1
        if not (missing or extra or dupes):
            print("  ✓ the rendered set is exactly the registry set")

        # the hero's own claim must be the number it renders
        hero = await ev("(document.body.innerText.match(/(\\d+)\\s+commands/) || [])[1]")
        if hero and int(hero) != len(want):
            print(f"  ✗ the page says '{hero} commands' and renders {len(want)}"); bad += 1
        else:
            print(f"  ✓ the page's own count ({hero}) matches")

        # every filter shows what its tally promises
        print()
        for g in reg["groups"]:
            got = await ev(f"""(()=>{{const b=[...document.querySelectorAll('.ahx-filters button')]
              .find(x=>x.dataset.g==='{g["id"]}'); if(!b) return null; b.click();
              return {{n:document.querySelectorAll('.ahx-card').length,
                       tally:+b.querySelector('.ahx-n').textContent,
                       blurb:document.getElementById('ahxBlurb').textContent.length}};}})()""")
            await asyncio.sleep(0.2)
            ok = got and got["n"] == len(g["commands"]) == got["tally"] and got["blurb"] > 10
            if not ok:
                bad += 1
            print(f"  {'✓' if ok else '✗'} filter {g['id']:<10} shows {got and got['n']}"
                  f"  · tally {got and got['tally']}  · registry {len(g['commands'])}")

        # the search must actually narrow
        await ev("[...document.querySelectorAll('.ahx-filters button')][0].click()")
        await asyncio.sleep(0.2)
        res = await ev("""(()=>{const q=document.getElementById('ahxQ');
          q.value='firmware'; q.dispatchEvent(new Event('input'));
          const n=document.querySelectorAll('.ahx-card').length;
          q.value='zzzznope'; q.dispatchEvent(new Event('input'));
          const z=document.querySelectorAll('.ahx-card').length;
          const empty=!document.getElementById('ahxNone').hidden;
          q.value=''; q.dispatchEvent(new Event('input'));
          return {hits:n, none:z, emptyMsg:empty,
                  back:document.querySelectorAll('.ahx-card').length};})()""")
        ok = res and 0 < res["hits"] < len(want) and res["none"] == 0 \
            and res["emptyMsg"] and res["back"] == len(want)
        if not ok:
            bad += 1
        print(f"\n  {'✓' if ok else '✗'} search: 'firmware' → {res and res['hits']} · "
              f"nonsense → {res and res['none']} (empty message "
              f"{'shown' if res and res['emptyMsg'] else 'MISSING'}) · "
              f"cleared → {res and res['back']}")

        # every badge on a card is one the legend explains
        badges = await ev("""(()=>{const cards=[...document.querySelectorAll('.ahx-card .ahx-badge')]
          .map(b=>b.textContent.trim().toLowerCase());
          const legend=[...document.querySelectorAll('#ahxLegend .ahx-badge')]
          .map(b=>b.textContent.trim().toLowerCase());
          const statuses=['partial','planned','experimental'];
          return {unexplained:[...new Set(cards)].filter(x=>!legend.includes(x)&&!statuses.includes(x)),
                  legend:legend.length};})()""")
        if not badges or badges["unexplained"] or badges["legend"] < 3:
            print(f"  ✗ badges with no legend entry: {badges and badges['unexplained']}"); bad += 1
        else:
            print(f"  ✓ every badge is explained ({badges['legend']} in the legend)")

        # the "won't do" list is rendered, not just declared
        nb = await ev("document.querySelectorAll('#ahxNotBuilt li').length")
        if nb != len(reg.get("not_built", [])):
            print(f"  ✗ 'what it won't do' renders {nb}, registry has "
                  f"{len(reg.get('not_built', []))}"); bad += 1
        else:
            print(f"  ✓ the deliberate-omissions list renders all {nb}")

        # a note in the registry must reach the card
        noted = [c["name"] for g in reg["groups"] for c in g["commands"] if c.get("note")]
        got = await ev("[].map.call(document.querySelectorAll('.ahx-card:has(.ahx-note)'),"
                       "function(c){return c.dataset.name;})") or []
        if sorted(got) != sorted(noted):
            print(f"  ✗ notes rendered {sorted(got)} · registry says {sorted(noted)}"); bad += 1
        else:
            print(f"  ✓ every registry note reaches its card ({len(noted)})")

        errs = await ev("(window.__ahx && window.__ahx.count) || 0")
        if errs != len(want):
            print(f"  ✗ the widget's own count is {errs}"); bad += 1

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
