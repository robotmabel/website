"""Vendor the Control Studio's retargeter into the website, verbatim.

The webcam demo on software.html must not be a second, hand-rolled estimator —
that is exactly how it ended up producing a different (and wrong) answer from
the studio. It runs the SAME code: this copies the pure-math half of

    web_gui/simulation_control_center/web/js/bodyteleop.js

up to (not including) its browser-runtime section, which is the part that is
node-safe and unit-tested by that studio's own tests/js/bodyteleop.test.mjs.
The runtime half is skipped because it loads models from the studio's local
/vendor path and speaks the teleop websocket; the website supplies its own.

    python3 scripts/sync_bodyteleop.py           # rewrite the vendored copy
    python3 scripts/sync_bodyteleop.py --check    # fail if it has drifted
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
REPO = os.path.dirname(SITE)
SRC = os.path.join(REPO, "web_gui", "simulation_control_center", "web", "js",
                   "bodyteleop.js")
DST = os.path.join(SITE, "assets", "bodyteleop-core.js")
CUT = "// ── browser runtime ──"

HEADER = """/* VENDORED — DO NOT EDIT.
 *
 * The pure-math half of the Control Studio's retargeter, copied verbatim from
 *     web_gui/simulation_control_center/web/js/bodyteleop.js
 * by website/scripts/sync_bodyteleop.py. The webcam demo on software.html runs
 * THIS, not a second estimator of its own, so the browser and the studio agree
 * about where an operator's wrists are. Everything below is unit-tested in
 * web_gui/simulation_control_center/tests/js/bodyteleop.test.mjs.
 *
 * source sha256: %s
 * regenerate:    python3 scripts/sync_bodyteleop.py
 */
"""


def extract():
    with open(SRC) as f:
        src = f.read()
    i = src.index(CUT)
    body = src[:i].rstrip() + "\n"
    return HEADER % hashlib.sha256(src.encode()).hexdigest()[:16] + body


def main():
    out = extract()
    if "--check" in sys.argv:
        have = open(DST).read() if os.path.exists(DST) else ""
        if have != out:
            print("bodyteleop-core.js has DRIFTED from the studio copy — "
                  "run scripts/sync_bodyteleop.py")
            print("RESULT: FAIL")
            sys.exit(1)
        print(f"vendored copy matches {os.path.relpath(SRC, REPO)}")
        print("RESULT: PASS")
        return
    with open(DST, "w") as f:
        f.write(out)
    print(f"wrote {os.path.relpath(DST, SITE)}  "
          f"({len(out.splitlines())} lines from {os.path.relpath(SRC, REPO)})")


if __name__ == "__main__":
    main()
