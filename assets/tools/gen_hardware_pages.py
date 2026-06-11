"""Generate the 6 hardware module pages + rewrite the grouped nav across the site.

Hardware ▾ dropdown = Hands, Arms, Base, Lift, Body, Electronics (separate pages,
no Overview). The main hardware.html stays as the (un-listed) overview.
Run from the website/ dir:  python3 assets/tools/gen_hardware_pages.py
"""
import os, re, glob

HERE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.chdir(HERE)

HW = [("hardware-hands.html","Hands"),("hardware-arms.html","Arms"),
      ("hardware-base.html","Base"),("hardware-lift.html","Lift"),
      ("hardware-body.html","Body"),("hardware-electronics.html","Electronics")]
SW = [("firmware.html","Firmware"),("ros.html","ROS"),("simulation.html","Simulation"),("wbc.html","Whole-Body Control")]
AU = [("navigation.html","Navigation"),("teleop.html","Teleop"),("learning.html","Learning")]

def link(href,label,active):
    return f'<a href="{href}" class="on">{label}</a>' if active else f'<a href="{href}">{label}</a>'

def group(name, items, active_grp, active_page):
    on = " on" if active_grp else ""
    menu = "".join(link(h,l,h==active_page) for h,l in items)
    return (f'<div class="nav-group{on}"><button type="button" class="nav-grp-btn">{name}'
            f'<span class="nav-caret">▾</span></button><div class="nav-menu">{menu}</div></div>')

def mobgroup(name, items):
    return f'<span class="mob-grp">{name}</span>' + "".join(f'<a class="sub" href="{h}">{l}</a>' for h,l in items)

def build_nav(active):
    hw = active=="hardware.html" or active.startswith("hardware-")
    sw = active in [h for h,_ in SW]
    au = active in [h for h,_ in AU]
    desk = ('<header class="nav" id="nav">\n'
        '  <a href="index.html" class="nav-logo"><span class="dot"></span> MABEL</a>\n'
        '  <nav class="nav-links">\n'
        f'    {link("index.html","Overview",active=="index.html")}\n'
        f'    {group("Hardware",HW,hw,active)}\n'
        f'    {group("Software",SW,sw,active)}\n'
        f'    {group("Autonomy",AU,au,active)}\n'
        f'    {link("connect.html","Connect",active=="connect.html")}\n'
        '    <a href="#" class="ext">Paper ↗</a>\n'
        '  </nav>\n'
        '  <button class="hbg" id="hbg" aria-label="Menu"><span></span><span></span><span></span></button>\n'
        '</header>')
    mob = ('<nav class="mob" id="mob">\n'
        '  <a href="index.html">Overview</a>'
        f'{mobgroup("Hardware",HW)}{mobgroup("Software",SW)}{mobgroup("Autonomy",AU)}'
        '<a href="connect.html">Connect</a><a href="#" class="ext">Paper ↗</a>\n'
        '</nav>')
    return desk + "\n" + mob

FOOTER = '''<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <div class="foot-brand">MABEL</div>
        <p class="foot-brand-sub">Mobile Animated Bimanual Extensible Platform. Open hardware, open software, open from day one.</p>
        <div class="foot-mini"><a href="https://github.com/thejerrycheng/MABEL" target="_blank" rel="noopener">GitHub ↗</a><a href="#" target="_blank" rel="noopener">Discord ↗</a></div>
      </div>
      <div class="foot-col"><h6>Hardware</h6><a href="hardware-arms.html">Arms</a><a href="hardware-hands.html">Hands</a><a href="hardware-base.html">Base</a><a href="hardware-electronics.html">Electronics</a></div>
      <div class="foot-col"><h6>Build</h6><a href="hardware.html#bom">Bill of materials</a><a href="hardware.html#build">Assembly guide</a><a href="hardware.html#model">3D model</a></div>
      <div class="foot-col"><h6>Project</h6><a href="connect.html">Connect</a><a href="index.html#paper">Paper</a><a href="https://github.com/thejerrycheng/MABEL" target="_blank" rel="noopener">GitHub ↗</a></div>
    </div>
    <div class="foot-bottom"><span>© 2026 Cheng et al · MIT License</span><span>Built in New York · v1.0.0</span></div>
  </div>
</footer>'''

def page(slug, name, num, title, lede, specs, points, cta):
    fname = f"hardware-{slug}.html"
    spec = "".join(f"<span>{s}</span>" for s in specs)
    pts = "".join(
        f'<div class="point"><div class="num">{i+1:02d}</div><div><h5>{h}</h5><p>{p}</p></div></div>'
        for i,(h,p) in enumerate(points))
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#161412" />
<title>MABEL — {name}</title>
<meta name="description" content="MABEL hardware · {name}: {lede}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="assets/mabel.css" />
<script>document.documentElement.classList.add('js');</script>
</head>
<body>

<div id="progress"></div>

{build_nav(fname)}

<!-- ─── PAGE HERO ─── -->
<section class="page-hero">
  <div class="page-hero-inner">
    <div class="crumbs"><a href="index.html">Overview</a> / <a href="hardware.html">Hardware</a> / {name}</div>
    <span class="eyebrow">Hardware · {name}</span>
    <h1 class="display-lg">{title}</h1>
    <p class="lede">{lede}</p>
    <div class="spec" style="margin-top:28px;">{spec}</div>
  </div>
</section>

<!-- ─── DETAIL ─── -->
<section class="pad-y">
  <div class="wrap">
    <div class="sec-head fade-up">
      <div>
        <span class="eyebrow">{name}</span>
        <h2 class="display-md title">Inside the <span class="italic accent">{name.lower()}.</span></h2>
      </div>
      <p class="lede">Real parts, open files. Here's what makes the {name.lower()} subsystem tick.</p>
    </div>
    <div class="points fade-up">
      {pts}
    </div>
  </div>
</section>

<!-- ─── CTA ─── -->
<section class="soft-sec pad-y">
  <div class="wrap-narrow" style="text-align:center;">
    <h2 class="display-sm fade-up" style="margin-bottom:24px;">{cta[0]}</h2>
    <div class="fade-up" style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
      {cta[1]}
      <a href="hardware.html" class="btn btn-ghost">← Hardware overview</a>
    </div>
  </div>
</section>

{FOOTER}

<script src="assets/mabel.js"></script>
</body>
</html>
'''
    open(fname,"w",encoding="utf-8").write(html)
    return fname

MODULES = {
"hands": dict(name="Hands", num="01",
  title="Two hands. Thirty-four joints.",
  lede="Two open-source ORCA hands give MABEL real dexterity — five tendon-routed fingers each, 17 actuated DOF per hand, driven by Feetech serial servos.",
  specs=["2× ORCA · 34 DOF","16× HLS3915 + wrist","Tendon-routed","1 MHz TTL serial","Open-source"],
  points=[
    ("Built on open ORCA","Each hand is the open-source <strong>ORCA</strong> hand — five fingers, tendon-routed, anthropomorphic. Print it, string it, run it; the design is fully released."),
    ("17 DOF per hand","Sixteen Feetech <strong>HLS3915</strong> finger servos plus an <strong>HLS3930</strong> wrist, all on one 1&nbsp;MHz TTL serial chain — abduction, MCP, and PIP per finger."),
    ("Grasps that transfer","Pinch, power, and tripod grasps; the same position commands drive the simulated and the real hand, so a grasp tuned in <a href=\"simulation.html\">sim</a> works on hardware."),
    ("Configured from our GUI","Assign servo IDs, write registers, and read live load and temperature from the ORCA Hand Control Studio — no vendor tool. See <a href=\"firmware.html\">Firmware</a>."),
  ],
  cta=("Open hands, open files.",'<a href="firmware.html" class="btn btn-primary">Firmware →</a>')),

"arms": dict(name="Arms", num="02",
  title="Two 7-DOF arms, back-drivable.",
  lede="Derived from the open-source OpenArm design and driven by Damiao quasi-direct-drive motors on CAN — low gearing means real torque control, gravity compensation, and compliance.",
  specs=["14 DOF · 2 × 7","OpenArm-derived","Damiao QDD · CAN","Torque-controlled","Back-drivable"],
  points=[
    ("OpenArm lineage","Two 7-DOF arms built on the open-source <strong>OpenArm</strong> design — a proven, printable, research-grade arm rather than a closed industrial unit."),
    ("Quasi-direct-drive","<strong>Damiao</strong> QDD motors on CAN close a high-rate current loop, so commanded torques become real ones with very little friction to fight."),
    ("Compliant by design","Low gearing makes the arms back-drivable — the foundation for gravity compensation and Cartesian impedance in the <a href=\"wbc.html\">whole-body controller</a>."),
    ("Human-scale reach","Link lengths and shoulder spacing are tuned to a person's, so <a href=\"teleop.html\">teleoperation</a> maps naturally and the embodiment gap stays small."),
  ],
  cta=("Reach, with feeling.",'<a href="wbc.html" class="btn btn-primary">Whole-Body Control →</a>')),

"base": dict(name="Base", num="03",
  title="Holonomic, on three modules.",
  lede="A 3-module delta swerve on REV SPARK controllers gives true holonomic motion — strafe through a doorway, rotate in place, hold a heading while driving.",
  specs=["3 × delta swerve","REV SPARK · NEO","38.1 mm wheels","Holonomic","Tip-safe"],
  points=[
    ("Delta swerve","Three independently steered-and-driven modules in a delta layout — full holonomic motion in any direction, decoupled from heading."),
    ("REV SPARK, owned","NEO / NEO550 brushless on REV SPARK controllers — driven through a <strong>reverse-engineered CAN stack</strong>, zero dependency on REV's tools. See <a href=\"firmware.html#rev\">Firmware</a>."),
    ("Anti-slip kinematics","Shortest-path steering and a cosine anti-slip choke keep the wheels from scrubbing; the math is shared with <a href=\"simulation.html\">simulation</a>."),
    ("Tip-safe envelope","A direction-aware tip-over model shrinks speed and braking limits as the lift raises the CoM — agile, but it won't tip."),
  ],
  cta=("Any direction, on command.",'<a href="firmware.html#rev" class="btn btn-primary">Reverse-engineered CAN →</a>')),

"lift": dict(name="Lift", num="04",
  title="Eye height, on demand.",
  lede="A cascaded Z-lift adds 0.635 m of vertical travel; an RP2040 Pico runs closed-loop position-plus-velocity control over a brushed actuator.",
  specs=["0.635 m travel","Cascaded stages","RP2040 Pico","BTS7960 + encoder","Pos + vel loop"],
  points=[
    ("Cascaded travel","Telescoping stages give <strong>0.635&nbsp;m</strong> of vertical range in a compact stow height — counter height to over a table."),
    ("Closed-loop on a Pico","An RP2040 Pico runs cascaded <strong>position + velocity</strong> control over a BTS7960 H-bridge and a quadrature encoder, with a host library and an iOS GUI. See <a href=\"firmware.html\">Firmware</a>."),
    ("Coupled to stability","Raising the lift raises the centre of mass, so the base's tip-safe limits tighten with height — modelled in <a href=\"wbc.html\">whole-body control</a>."),
    ("Eye height for teleop","Matching the operator's eye height shrinks the embodiment gap and makes <a href=\"teleop.html\">teleop</a> feel like wearing the robot."),
  ],
  cta=("Up to the task.",'<a href="firmware.html" class="btn btn-primary">Firmware →</a>')),

"body": dict(name="Body", num="05",
  title="An active body, not a cart.",
  lede="A pitching torso and a 3-DOF Dynamixel neck turn MABEL from an arm-on-a-cart into an active, expressive body that can lean, look, and gaze.",
  specs=["Torso pitch · Damiao","3-DOF neck · Dynamixel","Yaw / pitch / roll","Active perception","Small embodiment gap"],
  points=[
    ("Pitching torso","A Damiao-driven torso pitch extends low reach and lets the whole upper body lean into a task instead of over-stretching an arm."),
    ("Active head","A 3-DOF <strong>Dynamixel</strong> neck (yaw / pitch / roll) aims the head cameras — active perception and natural gaze for the operator."),
    ("Closing the embodiment gap","Eye height, lean, neck range, and arm length are matched to a person, so a <a href=\"teleop.html\">teleoperator</a> feels at home immediately."),
    ("Part of the reach","Torso and neck are degrees of freedom the <a href=\"wbc.html\">whole-body controller</a> coordinates alongside the base, lift, and arms."),
  ],
  cta=("It leans. It looks.",'<a href="teleop.html" class="btn btn-primary">Teleop →</a>')),

"electronics": dict(name="Electronics", num="06",
  title="Custom boards, one low-latency net.",
  lede="Custom base and body PCBs tie every actuator together over a single low-latency local network — CAN for the motor buses, Ethernet for the high-bandwidth links — with one Jetson Thor running it all onboard.",
  specs=["Custom base + body PCB","CAN + Ethernet","Jetson Thor","Onboard · untethered","Single battery"],
  points=[
    ("Custom PCBs","Purpose-built boards for the base and the body replace a rat's nest of breakouts — clean power distribution and bus routing for the whole robot."),
    ("One low-latency network","<strong>CAN</strong> carries the motor buses; <strong>Ethernet</strong> carries the high-bandwidth links. Keeping the local network unified cuts latency across the system."),
    ("Onboard compute","A single <strong>Jetson Thor</strong> runs SLAM, navigation, perception, and <a href=\"wbc.html\">whole-body control</a> — no cloud, no tether. See <a href=\"ros.html\">ROS</a>."),
    ("Untethered","One battery powers the whole platform; nothing trails behind it as it drives the room."),
  ],
  cta=("Wired for low latency.",'<a href="firmware.html" class="btn btn-primary">Firmware →</a>')),
}

# 1) write the 6 module pages
for slug, d in MODULES.items():
    f = page(slug, d["name"], d["num"], d["title"], d["lede"], d["specs"], d["points"], d["cta"])
    print("wrote", f)

# 2) rewrite nav across all existing pages
NAV_RE = re.compile(r'<header class="nav" id="nav">.*?<nav class="mob" id="mob">.*?</nav>', re.DOTALL)
for f in sorted(glob.glob("*.html")):
    s = open(f, encoding="utf-8").read()
    s2 = NAV_RE.sub(lambda m: build_nav(f), s, count=1)
    if s2 != s:
        open(f, "w", encoding="utf-8").write(s2)

# 3) drop the now-redundant inline subsystem section from hardware.html
hw = open("hardware.html", encoding="utf-8").read()
hw2 = re.sub(r'<!-- ─── SUBSYSTEMS ─── -->.*?(?=<!-- ─── EXPLODED VIEW)', '', hw, flags=re.DOTALL)
if hw2 != hw:
    open("hardware.html", "w", encoding="utf-8").write(hw2)
    print("removed inline #subsystems from hardware.html")
print("nav rewritten across all pages")
