"""Generate faithful iPhone-app mockups (SVG) of the MABEL Mobile App for the site.

Reproduces the real warm bone/rust dark theme (DesignSystem/Theme.swift) and the
real sections/features (Drive joysticks, Arm + Whole-Body, Navigate tap-to-goal
A*, Policies library, auto-connect). SMIL animations play in <img>. Run:

    python3 tools/gen_ios_app.py
-> assets/img/app-ios-{drive,arm,nav,policies,home}.svg
"""
import os
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# warm palette (Theme.swift)
BG, INK = "#0C0A08", "#161412"
CARD, ELEV, HAIR = "#19150F", "#231D17", "rgba(242,238,230,0.12)"
TX, TX2, TX3 = "#F2EEE6", "#B9B3A8", "#857F75"
ACCENT, DEEP, CLAY = "#C25B2A", "#8B3F1D", "#9A6A3C"
LIVE, WARN, DANGER, IMIT = "#2E9E52", "#CC8A1E", "#D23B2A", "#B18CFF"
SANS = "-apple-system, 'SF Pro Text', Inter, 'Helvetica Neue', Arial, sans-serif"
MONO = "'SF Mono', Menlo, 'Geist Mono', monospace"
W, H = 390, 820


def rr(x, y, w, h, r, fill, stroke=None, sw=1, op=1, dash=None):
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" opacity="{op}"'
    if stroke: s += f' stroke="{stroke}" stroke-width="{sw}"'
    if dash: s += f' stroke-dasharray="{dash}"'
    return s + "/>"


def tx(x, y, s, fill=TX, size=13, w=400, font=SANS, anc="start", sp=None):
    sps = f' letter-spacing="{sp}"' if sp else ""
    return (f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{w}" '
            f'font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>')


def dot(x, y, c, r=4): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'


def chrome(active):
    """phone frame + status bar + global status row + bottom tab bar (real app)."""
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{SANS}">']
    o.append(rr(0, 0, W, H, 46, "#000"))
    o.append(rr(6, 6, W - 12, H - 12, 42, BG))
    o.append(rr(W / 2 - 52, 18, 104, 30, 15, "#000"))
    o.append(tx(34, 36, "9:41", TX, 14, 600))
    o.append(rr(W - 56, 26, 22, 11, 3, "none", stroke=TX2, sw=1))
    o.append(rr(W - 54, 28, 16, 7, 1.5, LIVE))
    # global status row (Connected · battery · STOP) like the real app
    o.append(rr(20, 56, 86, 24, 12, CARD, stroke=HAIR, sw=1)); o.append(dot(34, 68, LIVE, 3.5))
    o.append(tx(44, 72, "Connected", TX, 10, 600))
    o.append(rr(112, 56, 48, 24, 12, CARD, stroke=HAIR, sw=1)); o.append(tx(136, 72, "77%", TX, 10, 600, font=MONO, anc="middle"))
    o.append(rr(W - 96, 56, 76, 24, 12, DANGER)); o.append(tx(W - 58, 72, "STOP", "#fff", 11, 700, anc="middle"))
    # bottom tab bar (real)
    ty = H - 78
    o.append(rr(6, ty, W - 12, 72, 0, BG))
    o.append(f'<line x1="6" y1="{ty}" x2="{W-6}" y2="{ty}" stroke="{HAIR}" stroke-width="1"/>')
    tabs = ["Drive", "Body", "Maps", "Policies", "Robot"]
    tw = (W - 12) / 5
    for i, t in enumerate(tabs):
        cx = 6 + tw * (i + 0.5)
        on = (t == active)
        o.append(f'<circle cx="{cx}" cy="{ty+26}" r="3.5" fill="{ACCENT if on else TX3}"/>')
        o.append(tx(cx, ty + 50, t, ACCENT if on else TX3, 10, 600 if on else 500, anc="middle"))
    o.append(f'<rect x="{W/2-60}" y="{H-20}" width="120" height="5" rx="2.5" fill="{TX2}"/>')
    return o


def header(o, title, sub, conn=None):
    o.append(tx(28, 116, title, TX, 26, 700))
    if sub: o.append(tx(28, 138, sub, TX2, 13, 500))


def seg(o, y, items, active):
    x0, wseg = 28, W - 56
    o.append(rr(x0, y, wseg, 40, 12, CARD, stroke=HAIR, sw=1))
    iw = wseg / len(items)
    for i, it in enumerate(items):
        if it == active:
            o.append(rr(x0 + 4 + i * iw, y + 4, iw - 8, 32, 9, ELEV))
        o.append(tx(x0 + iw * (i + 0.5), y + 25, it, TX if it == active else TX2,
                    13, 600 if it == active else 500, anc="middle"))


def joystick(o, cx, cy, r, dx, dy, animate=None):
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{CARD}" stroke="{HAIR}" stroke-width="1.2"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{r-10}" fill="none" stroke="{HAIR}" stroke-width="0.8"/>')
    kx, ky = cx + dx * (r - 22), cy + dy * (r - 22)
    kr = r * 0.42
    knob = f'<circle cx="{kx}" cy="{ky}" r="{kr}" fill="url(#rg)"/>'
    if animate:
        ax, ay = animate
        knob = (f'<circle r="{kr}" fill="url(#rg)"><animate attributeName="cx" values="{ax[0]}" '
                f'dur="6s" repeatCount="indefinite" keyTimes="{ax[1]}"/>'
                f'<animate attributeName="cy" values="{ay[0]}" dur="6s" repeatCount="indefinite" keyTimes="{ay[1]}"/></circle>')
    o.append(knob)


DEFS = (f'<defs><radialGradient id="rg" cx="0.4" cy="0.35" r="0.8">'
        f'<stop offset="0" stop-color="#E07A45"/><stop offset="1" stop-color="{ACCENT}"/></radialGradient>'
        f'<linearGradient id="cam" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="#26201a"/><stop offset="1" stop-color="#0e0b09"/></linearGradient></defs>')


# ── DRIVE (animated joysticks) ────────────────────────────────────────────────

def drive():
    o = chrome("Teleop"); o.append(DEFS)
    header(o, "Teleop", "Drive · holonomic base")
    seg(o, 130, ["Drive", "Arm", "Whole Body"], "Drive")
    # camera feed
    o.append(rr(28, 184, W - 56, 200, 16, "url(#cam)", stroke=HAIR, sw=1))
    o.append(f'<line x1="28" y1="300" x2="{W-28}" y2="284" stroke="rgba(242,238,230,0.10)" stroke-width="1"/>')
    o.append(rr(40, 196, 96, 22, 11, "rgba(8,7,6,0.6)"))
    o.append(dot(54, 207, DANGER, 4))
    o.append(f'<circle cx="54" cy="207" r="4" fill="{DANGER}"><animate attributeName="opacity" values="1;0.3;1" dur="1.3s" repeatCount="indefinite"/></circle>')
    o.append(tx(66, 211, "LIVE · head cam", TX, 10, 600, font=MONO))
    o.append(tx(W - 40, 211, "31 ms", LIVE, 10, 600, font=MONO, anc="end"))
    # speed governor
    o.append(tx(28, 420, "SPEED GOVERNOR", TX3, 10, 700, sp="1"))
    o.append(tx(W - 28, 420, "60%", TX, 12, 700, font=MONO, anc="end"))
    o.append(rr(28, 430, W - 56, 6, 3, ELEV))
    o.append(rr(28, 430, (W - 56) * 0.6, 6, 3, ACCENT))
    # joysticks
    cyj = 540
    o.append(tx(92, 638, "TRANSLATE", TX3, 10, 700, anc="middle", sp="0.5"))
    o.append(tx(W - 92, 638, "ROTATE", TX3, 10, 700, anc="middle", sp="0.5"))
    # left stick: forward/back + strafe (animated figure-eight-ish)
    lx, ly = 92, cyj
    joystick(o, lx, ly, 64, 0, 0, animate=(
        (f"{lx};{lx+22};{lx};{lx-22};{lx}", "0;0.25;0.5;0.75;1"),
        (f"{ly};{ly-26};{ly};{ly-10};{ly}", "0;0.25;0.5;0.75;1")))
    rx, ry = W - 92, cyj
    joystick(o, rx, ry, 64, 0, 0, animate=(
        (f"{rx};{rx+24};{rx};{rx-24};{rx}", "0;0.3;0.6;0.85;1"),
        (f"{ry};{ry};{ry};{ry};{ry}", "0;0.3;0.6;0.85;1")))
    # E-STOP
    o.append(rr(28, H - 150, W - 56, 44, 12, "rgba(210,59,42,0.16)", stroke=DANGER, sw=1.4))
    o.append(tx(W / 2, H - 122, "E-STOP", DANGER, 15, 700, anc="middle", sp="1"))
    o.append("</svg>")
    return "\n".join(o)


# ── ARM / WHOLE-BODY (3D twin + sliders) ──────────────────────────────────────

def arm():
    o = chrome("Teleop"); o.append(DEFS)
    header(o, "Teleop", "Whole Body · 3D twin")
    seg(o, 130, ["Drive", "Arm", "Whole Body"], "Whole Body")
    # twin viewport
    o.append(rr(28, 184, W - 56, 220, 16, "url(#cam)", stroke=HAIR, sw=1))
    # stylized robot twin
    cx = W / 2
    o.append(rr(cx - 34, 360, 68, 26, 8, "#3a322a"))                 # base
    o.append(rr(cx - 7, 300, 14, 64, 5, "#4a4038"))                  # lift column
    o.append(rr(cx - 26, 280, 52, 34, 9, "#5a4e44"))                 # torso
    o.append(f'<circle cx="{cx}" cy="262" r="15" fill="#6a5d51"/>')   # head
    o.append(dot(cx - 5, 260, ACCENT, 2.5)); o.append(dot(cx + 5, 260, ACCENT, 2.5))
    o.append(f'<path d="M {cx-24} 292 q -26 6 -22 40" stroke="{ACCENT}" stroke-width="6" fill="none" stroke-linecap="round"/>')
    o.append(f'<path d="M {cx+24} 292 q 26 6 22 40" stroke="#7a6d61" stroke-width="6" fill="none" stroke-linecap="round"/>')
    o.append(tx(40, 206, "DIGITAL TWIN · live joints", TX2, 10, 600, font=MONO))
    # joint sliders
    rows = [("Lift", 0.55, ACCENT), ("Neck pitch", 0.40, CLAY),
            ("L · shoulder", 0.62, ACCENT), ("L · elbow", 0.48, ACCENT),
            ("R · shoulder", 0.58, CLAY)]
    yy = 440
    for name, frac, c in rows:
        o.append(tx(28, yy, name, TX, 12, 500))
        o.append(tx(W - 28, yy, f"{int(frac*180-90):+d}°", TX2, 11, 500, font=MONO, anc="end"))
        o.append(rr(28, yy + 9, W - 56, 5, 2.5, ELEV))
        o.append(rr(28, yy + 9, (W - 56) * frac, 5, 2.5, c))
        o.append(f'<circle cx="{28+(W-56)*frac}" cy="{yy+11.5}" r="8" fill="#fff"/>')
        yy += 46
    o.append("</svg>")
    return "\n".join(o)


# ── NAVIGATE (animated A* path) ───────────────────────────────────────────────

def nav():
    o = chrome("Navigate"); o.append(DEFS)
    header(o, "Maps", "Tap to set a goal · A*")
    # occupancy map
    mx, my, mw, mh = 28, 150, W - 56, 420
    o.append(rr(mx, my, mw, mh, 18, "#14100c", stroke=HAIR, sw=1))
    # walls (warm)
    walls = [(50,190,300,8),(50,190,8,210),(342,190,8,150),(50,392,150,8),
             (250,340,100,8),(180,250,8,90)]
    for x,y,w,h in walls:
        o.append(rr(x,y,w,h,3,"rgba(194,91,42,0.35)"))
    # free-space dots (lidar feel)
    # robot start + goal
    sx, sy, gx, gy = 90, 520, 300, 230
    # A* path (drawn)
    pathd = f"M {sx} {sy} L 90 430 L 160 430 L 160 300 L 300 300 L {gx} {gy}"
    o.append(f'<path d="{pathd}" stroke="{ACCENT}" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="600" stroke-dashoffset="600"><animate attributeName="stroke-dashoffset" values="600;0" dur="2.2s" begin="0.4s" fill="freeze"/></path>')
    # goal pin (pulse)
    o.append(f'<circle cx="{gx}" cy="{gy}" r="9" fill="none" stroke="{ACCENT}" stroke-width="2"><animate attributeName="r" values="9;18;9" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite"/></circle>')
    o.append(f'<circle cx="{gx}" cy="{gy}" r="7" fill="{ACCENT}"/>')
    o.append(tx(gx + 14, gy + 4, "goal", ACCENT, 11, 700, font=MONO))
    # robot marker travelling the path
    o.append(f'<g opacity="0"><animate attributeName="opacity" values="0;1" begin="1.2s" dur="0.1s" fill="freeze"/><polygon points="-7,6 7,6 0,-9" fill="{TX}"/><animateMotion dur="3.6s" begin="1.2s" repeatCount="indefinite" rotate="auto" path="{pathd}"/></g>')
    o.append(tx(mx + 14, my + mh - 16, "warehouse_01 · 84 m² · 19k pts", TX2, 10, 600, font=MONO))
    # saved places
    o.append(tx(28, 612, "SAVED PLACES", TX3, 10, 700, sp="1"))
    for i, p in enumerate(["Dock", "Staging", "Counter"]):
        x = 28 + i * 112
        o.append(rr(x, 624, 100, 34, 11, CARD, stroke=HAIR, sw=1))
        o.append(dot(x + 16, 641, ACCENT, 3.5))
        o.append(tx(x + 28, 645, p, TX, 12, 600))
    o.append("</svg>")
    return "\n".join(o)


# ── POLICIES ──────────────────────────────────────────────────────────────────

def policies():
    o = chrome("Policies"); o.append(DEFS)
    header(o, "Policies", "Dispatch a learned skill")
    lib = [
        ("Home → Set Dressing", "Navigation", 97, "20 Hz", ACCENT),
        ("Cinematic Crane Reach", "Imitation · CVAE", 88, "15 s", IMIT),
        ("Bimanual Lift", "Imitation · CVAE", 82, "18 s", IMIT),
        ("Track Subject", "Scripted", 94, "live", LIVE),
        ("Return to Dock", "Navigation", 99, "55 s", ACCENT),
    ]
    yy = 158
    for name, kind, rate, hz, c in lib:
        o.append(rr(28, yy, W - 56, 92, 16, CARD, stroke=HAIR, sw=1))
        o.append(rr(40, yy + 14, 10, 64, 4, c))
        o.append(tx(62, yy + 30, name, TX, 14, 600))
        o.append(rr(62, yy + 42, 12 + len(kind) * 6.4, 20, 10, "rgba(242,238,230,0.06)", stroke=c, sw=1))
        o.append(tx(70, yy + 56, kind, c, 10, 600))
        # success ring
        o.append(tx(W - 92, yy + 40, f"{rate}%", TX, 18, 700, font=MONO, anc="end"))
        o.append(tx(W - 92, yy + 58, "success", TX3, 9, 600, anc="end"))
        o.append(tx(W - 92, yy + 74, hz, TX2, 10, 600, font=MONO, anc="end"))
        # run button
        o.append(rr(W - 78, yy + 30, 42, 42, 12, ACCENT))
        o.append(f'<polygon points="{W-62},{yy+44} {W-62},{yy+58} {W-50},{yy+51}" fill="#fff"/>')
        yy += 104
    o.append("</svg>")
    return "\n".join(o)


# ── HOME / CONNECT ────────────────────────────────────────────────────────────

def home():
    o = chrome("Home"); o.append(DEFS)
    o.append(tx(28, 92, "MABEL", TX, 26, 700))
    o.append(tx(28, 114, "Mobile console", TX2, 13, 500))
    # connection hero
    o.append(rr(28, 134, W - 56, 110, 18, CARD, stroke=HAIR, sw=1))
    o.append(f'<circle cx="64" cy="180" r="16" fill="none" stroke="{LIVE}" stroke-width="2.5"/>')
    o.append(f'<circle cx="64" cy="180" r="16" fill="none" stroke="{LIVE}" stroke-width="2.5"><animate attributeName="r" values="16;26;16" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0;0.8" dur="2s" repeatCount="indefinite"/></circle>')
    o.append(dot(64, 180, LIVE, 6))
    o.append(tx(96, 170, "Connected", TX, 17, 700))
    o.append(tx(96, 190, "auto-discovered · mabel.local:9090", TX2, 11, 500, font=MONO))
    o.append(rr(96, 202, 96, 22, 11, "rgba(46,158,82,0.16)", stroke=LIVE, sw=1))
    o.append(tx(108, 217, "Demo · sim", LIVE, 11, 600))
    o.append(rr(200, 202, 88, 22, 11, "rgba(242,238,230,0.05)", stroke=HAIR, sw=1))
    o.append(tx(212, 217, "Robot", TX2, 11, 600))
    # vitals
    tiles = [("Battery", "82%", LIVE), ("Speed", "0.0", TX), ("Link", "31ms", LIVE)]
    for i, (lab, val, c) in enumerate(tiles):
        x = 28 + i * ((W - 56) / 3 + 0)
        w = (W - 56 - 24) / 3
        x = 28 + i * (w + 12)
        o.append(rr(x, 258, w, 70, 14, CARD, stroke=HAIR, sw=1))
        o.append(tx(x + 12, 284, lab.upper(), TX3, 9, 700, sp="0.5"))
        o.append(tx(x + 12, 312, val, c, 20, 700, font=MONO))
    # twin
    o.append(rr(28, 344, W - 56, 234, 18, "url(#cam)", stroke=HAIR, sw=1))
    cx = W / 2
    o.append(rr(cx - 34, 520, 68, 26, 8, "#3a322a"))
    o.append(rr(cx - 7, 462, 14, 62, 5, "#4a4038"))
    o.append(rr(cx - 26, 442, 52, 34, 9, "#5a4e44"))
    o.append(f'<circle cx="{cx}" cy="424" r="15" fill="#6a5d51"/>')
    o.append(f'<path d="M {cx-24} 454 q -24 8 -20 40" stroke="{ACCENT}" stroke-width="6" fill="none" stroke-linecap="round"/>')
    o.append(f'<path d="M {cx+24} 454 q 24 8 20 40" stroke="#7a6d61" stroke-width="6" fill="none" stroke-linecap="round"/>')
    o.append(tx(40, 366, "DIGITAL TWIN", TX2, 10, 600, font=MONO))
    o.append("</svg>")
    return "\n".join(o)


def main():
    for name, fn in (("app-ios-drive.svg", drive), ("app-ios-arm.svg", arm),
                     ("app-ios-nav.svg", nav), ("app-ios-policies.svg", policies),
                     ("app-ios-home.svg", home)):
        p = os.path.join(OUT, name)
        open(p, "w").write(fn())
        print("wrote", p, f"({os.path.getsize(p)} B)")


if __name__ == "__main__":
    main()
