#!/usr/bin/env python3
"""Search and link-preview metadata for every page, plus sitemap.xml and robots.txt.

One table below is the source of truth: each indexable page's <title>, its
description, and its place in the sitemap. The script rewrites, in place:
  * <title> and <meta name="description">
  * a marked block of canonical + Open Graph + Twitter tags
    (<!-- seo:begin --> … <!-- seo:end -->), so re-running is idempotent
and writes sitemap.xml and robots.txt at the site root. The redirect stub
(build.html), the account page and the Search Console token are not indexed.

    python3 scripts/build_seo.py           # write
    python3 scripts/build_seo.py --check   # fail if any page or file is stale
"""
import datetime, html, pathlib, re, sys

SITE = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://robotmabel.github.io/website/"
OG_IMAGE = BASE + "assets/og.jpg"
NAME = "MABEL"
TAG = "open-source mobile bimanual robot"

# path: (title, description, priority)
PAGES = {
    "index.html": ("MABEL — Hardware, Teleoperation, Simulation and Learning",
                   "MABEL is an open-source 56-DOF mobile bimanual robot with an $8,056 parts subtotal. Explore hardware, robot comparisons, teleoperation, simulation, control and learning.", "1.0"),
    "hardware.html": (f"Hardware — MABEL, the {TAG}",
                      "MABEL's hardware: holonomic swerve base, 0.635 m lift, pitching torso, two 7-DOF arms, two 17-DOF ORCA hands and a 3-DOF head, with measured repeatability and path-following accuracy.", "0.9"),
    "anatomy.html": (f"Anatomy explorer — MABEL, the {TAG}",
                     "Explore MABEL module by module in 3-D: every actuator, bus and part of the open-source mobile bimanual robot.", "0.6"),
    "software.html": (f"Software — MABEL, the {TAG}",
                      "MABEL's software stack: ROS 2, the hardware abstraction layer, the whole-body controller, the tip-over motion model, retargeting and firmware.", "0.8"),
    "simulation.html": (f"Simulation — MABEL, the {TAG}",
                        "MABEL's MuJoCo digital twin: one canonical model, the same controller and wire contract as the robot, 35 scenes, simulated data collection and reinforcement learning.", "0.8"),
    "simulator.html": (f"Browser simulator — MABEL, the {TAG}",
                       "Explore MABEL with camera and orbitable 3D state views, a hosted MuJoCo connection when available, and an explicitly labelled browser kinematic fallback.", "0.6"),
    "teleop.html": (f"Teleoperation — MABEL, the {TAG}",
                    "Whole-body teleoperation of MABEL from an Apple Vision Pro without hand-held controllers, plus iPhone, browser and gamepad clients on one command interface.", "0.8"),
    "autonomy.html": (f"Autonomy — MABEL, the {TAG}",
                      "Localization, mapping, demonstration collection, data curation and imitation-learning policies (ACT, DiT, π0) deployed on MABEL.", "0.8"),
    "harness.html": (f"AI harness — MABEL, the {TAG}",
                     "A command layer for AI assistants working on MABEL: every answer is read from a registry, every fact cites a source file, and a gate fails when that file changes.", "0.6"),
    "connect.html": (f"Links — MABEL, the {TAG}",
                     "Source code, CAD, documentation and community links for MABEL, the open-source mobile bimanual robot.", "0.5"),
    "order.html": (f"Coming soon — MABEL, the {TAG}",
                   "MABEL is coming soon. Leave your details to hear when assembled robots, kits and parts open, or build your own from the open plans.", "0.7"),
    "docs/index.html": (f"Build guide — MABEL, the {TAG}",
                        "The MABEL build guide: bill of materials, printed parts, wiring, firmware, ROS, simulation, calibration, teleoperation and learning, in build order.", "0.9"),
    "docs/overview.html": ("00 · Overview — MABEL build guide",
                           "What you are building: MABEL's modules, numbers and the order of the build.", "0.7"),
    "docs/bom.html": ("01 · Bill of materials — MABEL build guide",
                      "Every part of MABEL with a vendor and a price, the core BOM and the perception and compute tiers, with CSV and PDF downloads.", "0.8"),
    "docs/assembly.html": ("02 · Mechanical assembly — MABEL build guide",
                           "Illustrated mechanical assembly of MABEL, module by module: base, lift, body, arms, hands and head.", "0.7"),
    "docs/electronics.html": ("03 · Electronics & wiring — MABEL build guide",
                              "MABEL's electronics: CAN, TTL and USB buses, power rails and the PCBs.", "0.7"),
    "docs/firmware.html": ("04 · Firmware — MABEL build guide",
                           "Firmware for every MABEL subsystem: build, flash and probe commands for each controller.", "0.7"),
    "docs/software.html": ("05 · Software install — MABEL build guide",
                           "Installing ROS 2 on the robot computer and the MuJoCo simulation on a laptop.", "0.7"),
    "docs/bringup.html": ("06 · Bring-up & calibration — MABEL build guide",
                          "First power-on, joint zeros, limits and centre-of-mass checks for a new MABEL.", "0.7"),
    "docs/operate.html": ("07 · Operating the robot — MABEL build guide",
                          "Driving MABEL from a browser, a phone or a headset, and the safety rules that bound its motion.", "0.7"),
    "docs/learning.html": ("08 · Data & learning — MABEL build guide",
                           "Recording demonstrations, curating datasets, training policies and deploying them on MABEL.", "0.7"),
    "docs/troubleshoot.html": ("09 · Troubleshooting — MABEL build guide",
                               "What usually goes wrong when building and running MABEL, and how to fix it.", "0.6"),
}
NOINDEX = ["account.html"]


def url_of(path):
    if path == "index.html":
        return BASE
    if path.endswith("/index.html"):
        return BASE + path[: -len("index.html")]
    return BASE + path


def head_block(path, title, desc):
    u, t, d = url_of(path), html.escape(title, quote=True), html.escape(desc, quote=True)
    return ("<!-- seo:begin (scripts/build_seo.py) -->\n"
            f'<link rel="canonical" href="{u}" />\n'
            f'<meta property="og:type" content="website" />\n'
            f'<meta property="og:site_name" content="{NAME}" />\n'
            f'<meta property="og:title" content="{t}" />\n'
            f'<meta property="og:description" content="{d}" />\n'
            f'<meta property="og:url" content="{u}" />\n'
            f'<meta property="og:image" content="{OG_IMAGE}" />\n'
            f'<meta property="og:image:width" content="1200" />\n'
            f'<meta property="og:image:height" content="630" />\n'
            f'<meta name="twitter:card" content="summary_large_image" />\n'
            f'<meta name="twitter:title" content="{t}" />\n'
            f'<meta name="twitter:description" content="{d}" />\n'
            f'<meta name="twitter:image" content="{OG_IMAGE}" />\n'
            "<!-- seo:end -->")


def rewrite(path, title, desc, s):
    s = re.sub(r"<title>.*?</title>", "<title>" + html.escape(title, quote=False) + "</title>", s, count=1, flags=re.S)
    tag = f'<meta name="description" content="{html.escape(desc, quote=True)}" />'
    if re.search(r'<meta name="description"[^>]*>', s):
        s = re.sub(r'<meta name="description"[^>]*>', lambda m: tag, s, count=1)
    else:
        s = s.replace("</title>", "</title>\n" + tag, 1)
    block = head_block(path, title, desc)
    if "<!-- seo:begin" in s:
        s = re.sub(r"<!-- seo:begin.*?<!-- seo:end -->", lambda m: block, s, count=1, flags=re.S)
    else:
        s = s.replace(tag, tag + "\n" + block, 1)
    return s


def noindex(s):
    if 'name="robots"' not in s:
        s = s.replace("</title>", '</title>\n<meta name="robots" content="noindex" />', 1)
    return s


def sitemap():
    today = datetime.date.today().isoformat()
    rows = "".join(f"  <url><loc>{url_of(p)}</loc><lastmod>{today}</lastmod><priority>{pr}</priority></url>\n"
                   for p, (_, _, pr) in PAGES.items())
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "</urlset>\n")


ROBOTS = f"User-agent: *\nAllow: /\nDisallow: /website/account.html\n\nSitemap: {BASE}sitemap.xml\n"


def main():
    check = "--check" in sys.argv
    stale = []
    for path, (title, desc, _) in PAGES.items():
        f = SITE / path
        old = f.read_text()
        new = rewrite(path, title, desc, old)
        if new != old:
            stale.append(path)
            if not check:
                f.write_text(new)
    for path in NOINDEX:
        f = SITE / path
        old = f.read_text(); new = noindex(old)
        if new != old:
            stale.append(path)
            if not check:
                f.write_text(new)
    for name, body in (("robots.txt", ROBOTS),):
        f = SITE / name
        if not f.exists() or f.read_text() != body:
            stale.append(name)
            if not check:
                f.write_text(body)
    sm = SITE / "sitemap.xml"
    # lastmod moves daily, so compare the page list only
    locs = lambda x: re.findall(r"<loc>(.*?)</loc>", x)
    if not sm.exists() or locs(sm.read_text()) != locs(sitemap()):
        stale.append("sitemap.xml")
        if not check:
            sm.write_text(sitemap())
    if check:
        print("seo: " + ("up to date" if not stale else "STALE " + ", ".join(stale)))
        print("RESULT: PASS" if not stale else "RESULT: FAIL")
        return 1 if stale else 0
    print(f"seo: wrote {len(stale)} file(s): {', '.join(stale) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
