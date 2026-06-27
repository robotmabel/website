"""Generate faithful SVG mockups of MABEL's firmware GUIs for the website.

These reproduce the real iOS-dark design tokens and panel layout of the Tkinter
apps (firmware/swerve_drive/gui/theme.py, firmware/orca_hand/feetech/gui/style.py)
since the live Tk windows can't be captured headlessly. Run:

    python3 assets/tools/gen_gui_mockups.py
-> assets/gui-swerve.svg, assets/gui-hand.svg
"""
import os

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# exact tokens from the GUIs
BG, PANEL, SURF, ELEV, SEP = "#000000", "#121214", "#1C1C1E", "#2C2C2E", "#38383A"
LABEL, LABEL2, LABEL3 = "#FFFFFF", "#8E8E93", "#636366"
ORANGE, GREEN, RED, BLUE, YELLOW, PURPLE = "#FF9F0A", "#30D158", "#FF453A", "#0A84FF", "#FFD60A", "#BF5AF2"
SANS = "-apple-system, 'SF Pro Text', Inter, 'Helvetica Neue', Arial, sans-serif"
MONO = "'SF Mono', Menlo, 'Geist Mono', monospace"


def rr(x, y, w, h, r, fill, stroke=None, sw=1, op=1):
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" opacity="{op}"'
    if stroke:
        s += f' stroke="{stroke}" stroke-width="{sw}"'
    return s + "/>"


def txt(x, y, s, fill=LABEL, size=13, weight=400, font=SANS, anchor="start", spacing=None):
    sp = f' letter-spacing="{spacing}"' if spacing else ""
    return (f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{weight}" '
            f'font-family="{font}" text-anchor="{anchor}"{sp}>{s}</text>')


def slider(x, y, w, frac, color, knob=True):
    out = [rr(x, y - 3, w, 6, 3, ELEV)]
    fw = max(6, int(w * frac))
    out.append(rr(x, y - 3, fw, 6, 3, color))
    if knob:
        out.append(f'<circle cx="{x + fw}" cy="{y}" r="9" fill="#fff"/>')
        out.append(f'<circle cx="{x + fw}" cy="{y}" r="9" fill="none" stroke="#0006" stroke-width="0.5"/>')
    return "".join(out)


def toggle(x, y, on, color=GREEN):
    w, h = 40, 24
    track = color if on else "#39393D"
    kx = x + w - 12 if on else x + 12
    return rr(x, y, w, h, 12, track) + f'<circle cx="{kx}" cy="{y + 12}" r="10" fill="#fff"/>'


def dot(x, y, color, r=4):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"/>'


def chrome(W, H):
    """window frame + traffic lights"""
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{SANS}">']
    out.append(rr(0, 0, W, H, 16, BG, stroke=SEP, sw=1))
    out.append(rr(0, 0, W, 40, 16, "#0A0A0B"))
    out.append(rr(0, 24, W, 16, 0, "#0A0A0B"))
    for i, c in enumerate(("#FF5F57", "#FEBC2E", "#28C840")):
        out.append(f'<circle cx="{20 + i * 20}" cy="20" r="6" fill="{c}"/>')
    out.append(f'<line x1="0" y1="40" x2="{W}" y2="40" stroke="{SEP}" stroke-width="1"/>')
    return out


# ── Swerve Studio ─────────────────────────────────────────────────────────────

def swerve_svg():
    W, H = 1280, 800
    o = chrome(W, H)
    o.append(txt(W / 2, 25, "MABEL · Swerve Studio", LABEL, 14, 600, anchor="middle"))
    # toolbar
    ty = 56
    o.append(rr(20, ty, W - 40, 56, 14, SURF))
    o.append(dot(44, ty + 28, GREEN, 5))
    o.append(txt(58, ty + 33, "can0 · live", LABEL, 14, 600, font=MONO))
    o.append(txt(58, ty + 33 - 18, "BUS", LABEL3, 9, 700, spacing="1.5"))
    o.append(txt(210, ty + 33, "1 Mbit/s · 6 dev", LABEL2, 12, 500, font=MONO))
    # segmented control
    sx = W - 280
    o.append(rr(sx, ty + 12, 240, 32, 9, ELEV))
    o.append(rr(sx + 4, ty + 16, 116, 24, 7, "#48484A"))
    o.append(txt(sx + 62, ty + 32, "Drive", LABEL, 12, 600, anchor="middle"))
    o.append(txt(sx + 180, ty + 32, "CAN Bus", LABEL2, 12, 500, anchor="middle"))

    body_y = ty + 72
    # ── telemetry sidebar
    sbx, sbw = 20, 300
    o.append(rr(sbx, body_y, sbw, H - body_y - 20, 14, PANEL))
    o.append(txt(sbx + 20, body_y + 28, "TELEMETRY", LABEL2, 10, 700, spacing="2"))
    mods = [("FRONT-LEFT", PURPLE), ("FRONT-RIGHT", PURPLE), ("BACK", PURPLE)]
    rows = [("drive", "vel", "rpm"), ("steer", "abs", "rev")]
    ry = body_y + 52
    data = [
        [("3120", "8.4", "31°"), ("0.412", "2.1", "29°")],
        [("2980", "9.1", "33°"), ("0.733", "1.8", "30°")],
        [("3050", "7.7", "30°"), ("0.118", "2.4", "28°")],
    ]
    for mi, (mname, _) in enumerate(mods):
        o.append(rr(sbx + 12, ry, sbw - 24, 96, 12, SURF))
        o.append(dot(sbx + 28, ry + 22, GREEN, 4))
        o.append(txt(sbx + 40, ry + 27, mname, LABEL, 12, 600, spacing="0.5"))
        # two rows: drive / steer
        for j in range(2):
            yy = ry + 48 + j * 26
            lbl = "DRIVE" if j == 0 else "STEER"
            o.append(txt(sbx + 28, yy, lbl, LABEL3, 9, 700, font=MONO))
            v, a, t = data[mi][j]
            o.append(txt(sbx + 92, yy, f"{v}", LABEL, 12, 500, font=MONO))
            o.append(txt(sbx + 170, yy, f"{a}A", BLUE, 11, 500, font=MONO))
            tc = YELLOW if j == 0 and mi == 1 else LABEL2
            o.append(txt(sbx + 240, yy, t, tc, 11, 500, font=MONO))
        ry += 110

    # ── drive panel (module cards)
    px = sbx + sbw + 16
    pw = W - px - 20
    cardw = (pw - 16) / 2
    cards = [("Front-Left", 1, 2, 0.62, 0.40),
             ("Front-Right", 3, 4, 0.58, 0.74),
             ("Back", 5, 6, 0.71, 0.12)]
    positions = [(px, body_y), (px + cardw + 16, body_y),
                 (px, body_y + 196)]
    for (name, did, sid, dfrac, sfrac), (cx, cy) in zip(cards, positions):
        ch = 180
        o.append(rr(cx, cy, cardw, ch, 14, SURF))
        o.append(txt(cx + 20, cy + 30, name, LABEL, 15, 600))
        o.append(txt(cx + cardw - 20, cy + 30, f"id {did}·{sid}", LABEL3, 11, 500, font=MONO, anchor="end"))
        o.append(toggle(cx + cardw - 60, cy + 44, True))
        # steering row (purple)
        o.append(txt(cx + 20, cy + 80, "STEER", PURPLE, 9, 700, spacing="1"))
        o.append(txt(cx + cardw - 20, cy + 80, f"{int(sfrac*360)}°", LABEL, 12, 600, font=MONO, anchor="end"))
        o.append(slider(cx + 20, cy + 98, cardw - 40, sfrac, PURPLE))
        # drive row (orange)
        o.append(txt(cx + 20, cy + 138, "DRIVE", ORANGE, 9, 700, spacing="1"))
        o.append(txt(cx + cardw - 20, cy + 138, f"{int(dfrac*100)}%", LABEL, 12, 600, font=MONO, anchor="end"))
        o.append(slider(cx + 20, cy + 156, cardw - 40, dfrac, ORANGE))

    # footer actions (bottom-right area under back card / beside)
    fy = body_y + 196
    fx = px + cardw + 16
    o.append(rr(fx, fy, cardw, 180, 14, SURF))
    o.append(txt(fx + 20, fy + 30, "Actions", LABEL, 15, 600))
    o.append(rr(fx + 20, fy + 48, cardw - 40, 36, 9, ELEV))
    o.append(txt(fx + cardw / 2, fy + 71, "Enable All", GREEN, 13, 600, anchor="middle"))
    o.append(rr(fx + 20, fy + 92, cardw - 40, 36, 9, ELEV))
    o.append(txt(fx + cardw / 2, fy + 115, "Disable All", LABEL, 13, 600, anchor="middle"))
    o.append(rr(fx + 20, fy + 136, cardw - 40, 36, 9, RED))
    o.append(txt(fx + cardw / 2, fy + 159, "E-STOP", "#fff", 13, 700, anchor="middle"))

    o.append("</svg>")
    return "\n".join(o)


# ── ORCA Hand Control Studio ──────────────────────────────────────────────────

def hand_svg():
    W, H = 1280, 800
    o = chrome(W, H)
    o.append(txt(W / 2, 25, "MABEL · ORCA Hand Control Studio", LABEL, 14, 600, anchor="middle"))
    ty = 56
    o.append(rr(20, ty, W - 40, 56, 14, SURF))
    o.append(dot(44, ty + 28, GREEN, 5))
    o.append(txt(58, ty + 33, "/dev/ttyUSB0 · 1 Mbit", LABEL, 13, 600, font=MONO))
    o.append(txt(58, ty + 15, "FEETECH TTL", LABEL3, 9, 700, spacing="1.5"))
    o.append(txt(360, ty + 33, "17 / 17 servos", GREEN, 12, 500, font=MONO))
    # torque + stop
    o.append(rr(W - 300, ty + 12, 130, 32, 9, ELEV))
    o.append(txt(W - 235, ty + 32, "Torque ●", GREEN, 12, 600, anchor="middle"))
    o.append(rr(W - 160, ty + 12, 140, 32, 9, RED))
    o.append(txt(W - 90, ty + 32, "STOP", "#fff", 13, 700, anchor="middle"))

    body_y = ty + 72
    # left: preset / gestures rail
    sbx, sbw = 20, 280
    o.append(rr(sbx, body_y, sbw, H - body_y - 20, 14, PANEL))
    o.append(txt(sbx + 20, body_y + 28, "GRASPS", LABEL2, 10, 700, spacing="2"))
    presets = [("Open", GREEN), ("Fist", ORANGE), ("Pinch", BLUE),
               ("Tripod", PURPLE), ("Point", BLUE), ("Teach + Repeat", LABEL2)]
    gy = body_y + 46
    for nm, c in presets:
        o.append(rr(sbx + 16, gy, sbw - 32, 44, 11, SURF))
        o.append(dot(sbx + 34, gy + 22, c, 4))
        o.append(txt(sbx + 48, gy + 27, nm, LABEL, 13, 600))
        gy += 52

    # right: per-finger joint sliders
    px = sbx + sbw + 16
    pw = W - px - 20
    o.append(rr(px, body_y, pw, H - body_y - 20, 14, SURF))
    o.append(txt(px + 24, body_y + 30, "Joint control", LABEL, 16, 600))
    o.append(txt(px + pw - 24, body_y + 30, "17 DOF · per-finger", LABEL3, 11, 500, font=MONO, anchor="end"))
    fingers = [("Thumb", ["CMC", "ABD", "MCP", "IP"], [0.55, 0.30, 0.62, 0.48]),
               ("Index", ["ABD", "MCP", "PIP"], [0.40, 0.70, 0.66]),
               ("Middle", ["ABD", "MCP", "PIP"], [0.50, 0.74, 0.70]),
               ("Ring", ["ABD", "MCP", "PIP"], [0.46, 0.68, 0.64]),
               ("Pinky", ["ABD", "MCP", "PIP"], [0.52, 0.60, 0.58])]
    colw = (pw - 48 - 16 * 4) / 5
    for fi, (fname, joints, fracs) in enumerate(fingers):
        cx = px + 24 + fi * (colw + 16)
        cy = body_y + 56
        o.append(txt(cx + colw / 2, cy + 14, fname, LABEL, 12, 600, anchor="middle"))
        jy = cy + 44
        for jn, fr in zip(joints, fracs):
            o.append(txt(cx, jy - 14, jn, LABEL3, 9, 700, font=MONO))
            o.append(txt(cx + colw, jy - 14, f"{int(fr*100)}", LABEL2, 9, 500, font=MONO, anchor="end"))
            # vertical-ish compact horizontal slider
            o.append(slider(cx, jy, colw, fr, ORANGE if fname != "Thumb" else PURPLE, knob=True))
            jy += 52
    o.append("</svg>")
    return "\n".join(o)


# ── Animated "how to use the GUI" demo (SMIL, plays in <img>) ─────────────────

def swerve_demo_svg():
    W, H = 1280, 720
    DUR = "9s"
    o = chrome(W, H)
    o.append(txt(W / 2, 25, "MABEL · Swerve Studio", LABEL, 14, 600, anchor="middle"))
    ty = 56
    o.append(rr(20, ty, W - 40, 56, 14, SURF))
    o.append(dot(44, ty + 28, GREEN, 5))
    # blinking live dot
    o.append(f'<circle cx="44" cy="{ty+28}" r="5" fill="{GREEN}">'
             f'<animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite"/></circle>')
    o.append(txt(58, ty + 33, "can0 · live", LABEL, 14, 600, font=MONO))
    o.append(txt(210, ty + 33, "1 Mbit/s · 6 dev", LABEL2, 12, 500, font=MONO))

    body_y = ty + 80
    # telemetry card (single module, "live" feel via blinking current dot)
    sbx, sbw = 20, 320
    o.append(rr(sbx, body_y, sbw, 250, 14, PANEL))
    o.append(txt(sbx + 20, body_y + 28, "TELEMETRY · FRONT-LEFT", LABEL2, 10, 700, spacing="1.5"))
    rows = [("DRIVE rpm", "3120", BLUE), ("STEER abs", "0.41 rev", PURPLE),
            ("CURRENT", "8.4 A", BLUE), ("TEMP", "31 °C", LABEL2)]
    for i, (lbl, val, c) in enumerate(rows):
        yy = body_y + 64 + i * 40
        o.append(txt(sbx + 24, yy, lbl, LABEL3, 11, 700, font=MONO))
        o.append(txt(sbx + sbw - 24, yy, val, c, 14, 500, font=MONO, anchor="end"))
        o.append(f'<line x1="{sbx+24}" y1="{yy+14}" x2="{sbx+sbw-24}" y2="{yy+14}" stroke="{SEP}"/>')

    # big control card
    cx, cy, cw, ch = sbx + sbw + 24, body_y, W - (sbx + sbw + 24) - 20, 320
    o.append(rr(cx, cy, cw, ch, 16, SURF))
    o.append(txt(cx + 26, cy + 38, "Front-Left module", LABEL, 17, 600))
    o.append(txt(cx + cw - 26, cy + 38, "id 1 · 2", LABEL3, 12, 500, font=MONO, anchor="end"))
    # animated enable toggle (off -> on)
    tx, tyy = cx + cw - 90, cy + 54
    o.append(f'<rect x="{tx}" y="{tyy}" width="40" height="24" rx="12" fill="#39393D">'
             f'<animate attributeName="fill" values="#39393D;#39393D;{GREEN};{GREEN};#39393D" '
             f'keyTimes="0;0.18;0.22;0.9;1" dur="{DUR}" repeatCount="indefinite"/></rect>')
    o.append(f'<circle cy="{tyy+12}" r="10" fill="#fff"><animate attributeName="cx" '
             f'values="{tx+12};{tx+12};{tx+28};{tx+28};{tx+12}" keyTimes="0;0.18;0.22;0.9;1" '
             f'dur="{DUR}" repeatCount="indefinite"/></circle>')

    # STEER slider (animated, dragged by pointer)
    sx, sy, sw = cx + 26, cy + 130, cw - 52
    o.append(txt(sx, sy - 18, "STEER", PURPLE, 10, 700, spacing="1"))
    o.append(rr(sx, sy - 3, sw, 6, 3, ELEV))
    s0, s1 = 0.18, 0.72
    fillv = f"{int(sw*s0)};{int(sw*s0)};{int(sw*s1)};{int(sw*s1)};{int(sw*s0)}"
    o.append(f'<rect x="{sx}" y="{sy-3}" height="6" rx="3" fill="{PURPLE}">'
             f'<animate attributeName="width" values="{fillv}" keyTimes="0;0.25;0.5;0.85;1" dur="{DUR}" repeatCount="indefinite"/></rect>')
    kx0, kx1 = sx + int(sw * s0), sx + int(sw * s1)
    kxv = f"{kx0};{kx0};{kx1};{kx1};{kx0}"
    o.append(f'<circle cy="{sy}" r="11" fill="#fff"><animate attributeName="cx" values="{kxv}" keyTimes="0;0.25;0.5;0.85;1" dur="{DUR}" repeatCount="indefinite"/></circle>')

    # DRIVE slider (auto-sweep throttle)
    dx, dy, dw = cx + 26, cy + 210, cw - 52
    o.append(txt(dx, dy - 18, "DRIVE", ORANGE, 10, 700, spacing="1"))
    o.append(rr(dx, dy - 3, dw, 6, 3, ELEV))
    o.append(f'<rect x="{dx}" y="{dy-3}" height="6" rx="3" fill="{ORANGE}">'
             f'<animate attributeName="width" values="0;{int(dw*0.7)};{int(dw*0.3)};0" keyTimes="0;0.45;0.75;1" dur="{DUR}" repeatCount="indefinite"/></rect>')
    o.append(f'<circle cy="{dy}" r="11" fill="#fff"><animate attributeName="cx" values="{dx};{dx+int(dw*0.7)};{dx+int(dw*0.3)};{dx}" keyTimes="0;0.45;0.75;1" dur="{DUR}" repeatCount="indefinite"/></circle>')

    # E-STOP
    o.append(rr(cx + 26, cy + 250, 160, 40, 10, RED))
    o.append(txt(cx + 106, cy + 275, "E-STOP", "#fff", 13, 700, anchor="middle"))

    # animated pointer cursor: idles, drags steer knob, taps toggle
    px0, py0 = sx + int(sw * s0), sy
    o.append(f'<g><circle r="9" fill="#fff" opacity="0.92"/><circle r="9" fill="none" stroke="#000" stroke-width="1" opacity="0.3"/>'
             f'<animateMotion dur="{DUR}" repeatCount="indefinite" keyTimes="0;0.2;0.25;0.5;0.85;1" '
             f'path="M {tx+20} {tyy+12} L {tx+20} {tyy+12} L {px0} {py0} L {kx1} {sy} L {px0} {py0} L {px0} {py0}" '
             f'calcMode="linear"/></g>')

    # caption that cycles via opacity
    caps = ["Toggle a motor on", "Drag to steer — absolute angle", "Throttle the drive wheel"]
    cwid = 460
    ccx = cx + cw / 2
    o.append(rr(ccx - cwid / 2, H - 60, cwid, 40, 20, "#000", stroke=SEP, sw=1, op=0.85))
    for i, c in enumerate(caps):
        vals = "0;0;1;1;0;0"
        kt = {0: "0;0;0.05;0.28;0.33;1", 1: "0;0.30;0.36;0.58;0.63;1",
              2: "0;0.63;0.69;0.92;0.97;1"}[i]
        o.append(f'<text x="{ccx}" y="{H-35}" fill="{LABEL}" font-size="14" font-weight="600" '
                 f'font-family="{SANS}" text-anchor="middle" opacity="0">{c}'
                 f'<animate attributeName="opacity" values="{vals}" keyTimes="{kt}" dur="{DUR}" repeatCount="indefinite"/></text>')

    o.append("</svg>")
    return "\n".join(o)


# ── Teleop data-flow diagram ──────────────────────────────────────────────────

def dataflow_svg():
    W, H = 1280, 560
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{SANS}">']
    o.append(rr(0, 0, W, H, 18, "#0B0A09", stroke=SEP, sw=1))

    def node(x, y, w, h, title, sub, accent):
        o.append(rr(x, y, w, h, 16, SURF, stroke=accent, sw=1.5))
        o.append(txt(x + w / 2, y + 40, title, LABEL, 19, 600, anchor="middle"))
        for i, line in enumerate(sub):
            o.append(txt(x + w / 2, y + 68 + i * 22, line, LABEL2, 12.5, 500,
                         font=MONO, anchor="middle"))
        o.append(dot(x + 20, y + 24, accent, 5))

    nw, nh = 300, 150
    y0 = 150
    node(40, y0, nw, nh, "Operator device", ["Apple Vision Pro", "· or ·", "iPhone / iPad"], BLUE)
    node(W / 2 - nw / 2, y0, nw, nh + 20, "Mac / Jetson bridge",
         ["Retargeter (clutch)", "WholeBodyIK + lazy base", "MJPEG camera server"], ORANGE)
    node(W - 40 - nw, y0, nw, nh, "MABEL", ["robot · or ·", "MuJoCo twin", "51 DOF"], GREEN)

    # uplink arrow (top, left -> right)
    ay = 100
    o.append(f'<path d="M {40+nw} {ay} H {W-40-nw}" stroke="{BLUE}" stroke-width="2.5" fill="none" marker-end="url(#ab)"/>')
    o.append(txt(W / 2, ay - 30, "UPLINK · operator → robot   ·   WebSocket :9090 · 60 Hz", BLUE, 13, 600, anchor="middle", spacing="0.5"))
    o.append(txt(W / 2, ay - 10, "TeleopFrame: head pose · 27 hand joints/side · mode · nav joysticks", LABEL2, 12, 500, font=MONO, anchor="middle"))

    # downlink arrows (bottom, right -> left)
    by = H - 90
    o.append(f'<path d="M {W-40-nw} {by} H {40+nw}" stroke="{GREEN}" stroke-width="2.5" fill="none" marker-end="url(#ag)"/>')
    o.append(txt(W / 2, by + 26, "DOWNLINK · robot → operator", GREEN, 13, 600, anchor="middle", spacing="0.5"))
    o.append(txt(W / 2, by + 46, "Stereo MJPEG video :8080 (head ZED + wrists)  ·  RobotState: battery · mode · latency", LABEL2, 12, 500, font=MONO, anchor="middle"))

    # markers
    o.append(f'<defs>'
             f'<marker id="ab" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="{BLUE}"/></marker>'
             f'<marker id="ag" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="{GREEN}"/></marker>'
             f'</defs>')
    o.append("</svg>")
    return "\n".join(o)


# ── Animated ROS node graph (SMIL flowing data, plays in <img>) ───────────────

def ros_graph_svg():
    """Topic-bus layout: every wire is a vertical stub to a horizontal rail, so
    no two lines ever cross. All real mabel_ws nodes + the unified sim node."""
    W, H = 1320, 940
    CYAN, SIM = "#32D0C8", "#BF5AF2"
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{SANS}">']
    o.append(rr(0, 0, W, H, 18, "#0B0A09", stroke=SEP, sw=1))
    o.append(txt(36, 42, "mabel_ws · live graph", LABEL2, 12, 700, font=MONO, spacing="1.5"))

    def esc(s):
        return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")
    def nodebox(cx, y, w, h, title, sub, accent, tag=None, desc=None):
        x = cx - w / 2
        if desc is not None:
            o.append(f'<g class="rg-node" data-title="{esc(title)}" data-desc="{esc(desc)}" data-accent="{accent}">')
        o.append(rr(x, y, w, h, 12, SURF, stroke=accent, sw=1.4))
        o.append(dot(cx, y + 16, accent, 3.5))   # centered above the title
        o.append(txt(cx, y + 34, title, LABEL, 11, 600, font=MONO, anchor="middle"))
        for i, s in enumerate(sub):
            o.append(txt(cx, y + 51 + i * 15, s, LABEL2, 9.5, 500, anchor="middle"))
        if tag:
            o.append(rr(x + w - 52, y - 9, 52, 18, 9, accent))
            o.append(txt(x + w - 26, y + 2, tag, "#0B0A09", 9, 700, anchor="middle"))
        if desc is not None:
            o.append('</g>')

    def rail(y, h, fill, stroke, head, topics, desc=None):
        if desc is not None:
            o.append(f'<g class="rg-node" data-title="{esc(head.split("  ·")[0].strip())}" data-desc="{esc(desc)}" data-accent="{stroke}">')
        o.append(rr(50, y, W - 100, h, 14, fill, stroke=stroke, sw=1.3))
        o.append(txt(70, y + 22, head, stroke, 10.5, 700, spacing="1.5"))
        o.append(txt(70, y + h - 14, topics, LABEL, 12.5, 500, font=MONO))
        if desc is not None:
            o.append('</g>')

    def vstub(x, y1, y2, color, delay=0.0, dur=1.8):
        ya, yb = (y1, y2) if y1 < y2 else (y2, y1)
        o.append(f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="{color}" stroke-width="1.6" opacity="0.45"/>')
        o.append(f'<circle cx="{x}" r="3.5" fill="{color}"><animate attributeName="cy" values="{y1};{y2}" '
                 f'dur="{dur}s" begin="{delay}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="opacity" values="0;1;1;0" dur="{dur}s" begin="{delay}s" repeatCount="indefinite"/></circle>')

    # ── bands (top → bottom) ───────────────────────────────────────────────
    # inputs
    nodebox(440, 60, 200, 62, "teleop", ["Vision Pro · iOS · keys"], BLUE,
            desc="Vision Pro, the iPhone app, and a keyboard fallback publish operator intent — body twist, arm targets, and hand poses — straight onto the command bus.")
    nodebox(700, 60, 200, 62, "autonomy", ["Nav2 · policy · WBC"], BLUE,
            desc="Nav2, the policy runtime, and whole-body control write the same command topics autonomously — the robot drives itself with no operator in the loop.")
    # command bus
    cb_y = 156
    rail(cb_y, 64, "#10161F", BLUE,
         "COMMAND TOPICS  ·  subscribed by the driver nodes",
         "/mabel_cmd   /body/command   /arms/command   /left_hand/command   /right_hand/command",
         desc="The command bus — the handful of topics every driver (and the sim) subscribes to. It is the only path that ever writes to hardware.")
    # producer node row
    ny, nw, nh = 300, 132, 74
    centers = [120 + i * 132 for i in range(9)]   # 9 nodes
    drivers = [
        (centers[0], "swerve_node", ["base + lift", "REV CAN"],
         "Owns the three-module swerve base and the lift column over REV CAN — runs swerve IK and the tip-safe envelope, publishes /joint_states + /odom at 200 Hz."),
        (centers[1], "body_node", ["torso · neck", "Damiao · Dynamixel"],
         "Drives the tilting torso (Damiao CAN) and the pan/tilt/roll neck (Dynamixel), exposing both as ordinary joints on /joint_states."),
        (centers[2], "arms_node", ["14-DOF arms", "Damiao CAN"],
         "Streams the two backdriveable 7-DOF arms (14 DOF total, OpenArm-derived) over Damiao CAN at 200 Hz."),
        (centers[3], "hand_node", ["2× 17-DOF", "Feetech"],
         "Runs both 17-DOF ORCA hands over Feetech serial — 16 tendon-driven finger joints plus an active wrist roll per hand."),
    ]
    sensors = [
        (centers[4], "head_stereo", ["ZED stereo", "L + R eyes"],
         "ZED stereo camera on the neck — publishes rectified left/right images for perception and Vision Pro passthrough."),
        (centers[5], "left_wrist_cam", ["v4l2 · rectify"],
         "Eye-in-hand camera in the left wrist; v4l2 capture, rectified, for close-in manipulation."),
        (centers[6], "right_wrist_cam", ["v4l2 · rectify"],
         "Eye-in-hand camera in the right wrist; v4l2 capture, rectified, for close-in manipulation."),
        (centers[7], "rplidar", ["base 2-D LiDAR", "RPLIDAR A3"],
         "RPLIDAR A3 under the base — publishes /scan for SLAM, localization, and obstacle avoidance."),
    ]
    for cx, t, s, d in drivers:
        nodebox(cx, ny, nw, nh, t, s, ORANGE, desc=d)
    for cx, t, s, d in sensors:
        nodebox(cx, ny, nw, nh, t, s, CYAN, desc=d)
    # unified sim node
    nodebox(centers[8], ny, nw, nh, "mujoco_sim", ["whole robot", "use_sim:=true"], SIM, tag="SIM",
            desc="With use_sim:=true this single node replaces every driver above — it owns the MuJoCo physics and publishes the exact same topics, so nothing upstream can tell sim from real.")
    # group labels + dividers
    o.append(txt((centers[0] + centers[3]) / 2, ny - 18, "ACTUATOR DRIVERS", ORANGE, 10, 700, anchor="middle", spacing="1.2"))
    o.append(txt((centers[4] + centers[7]) / 2, ny - 18, "SENSOR NODES", CYAN, 10, 700, anchor="middle", spacing="1.2"))
    o.append(txt(centers[8], ny - 18, "SIMULATION", SIM, 10, 700, anchor="middle", spacing="1.2"))
    # state + sensor bus
    sb_y = 470
    for dx in ((centers[3] + centers[4]) / 2, (centers[7] + centers[8]) / 2):
        o.append(f'<line x1="{dx}" y1="{ny-30}" x2="{dx}" y2="{sb_y-14}" stroke="{SEP}" stroke-width="1" stroke-dasharray="3 5"/>')
    rail(sb_y, 86, "#0E1A13", GREEN,
         "STATE + SENSOR TOPICS  ·  published up to consumers",
         "/joint_states   /odom   /sensors/head/left·right/image   /sensors/{left,right}_wrist/image   /scan",
         desc="The state + sensor bus — joint states, odometry, the camera images, and the LiDAR scan, published up to every consumer at once.")
    o.append(txt(70, sb_y + 56, "sensor_msgs/JointState · nav_msgs/Odometry · sensor_msgs/Image · LaserScan", LABEL3, 10.5, 500, font=MONO))
    # consumers
    cy2 = 640
    cons = [("robot_state_publisher", ["URDF → /tf"],
             "Reads the URDF plus /joint_states and broadcasts /tf — the live kinematic tree every other node depends on."),
            ("rviz2 · Foxglove", ["visualize"],
             "Visualizes the topics live — joints, frames, cameras, and the LiDAR scan — for debugging in sim or on the real robot."),
            ("whole_body_control", ["IK · compliance"],
             "Solves IK and compliance across all 51 joints, turning one Cartesian goal into coordinated base, lift, arm, and hand commands."),
            ("nav2 · slam", ["map · localize"],
             "Builds a map and localizes from /scan + /odom, then plans a path and publishes velocity commands back onto the command bus."),
            ("learning", ["log · train"],
             "Logs synchronized observations and actions for imitation learning, and replays trained policies as just another command publisher.")]
    ccenters = [180 + i * 240 for i in range(5)]
    for cx, (t, s, d) in zip(ccenters, cons):
        nodebox(cx, cy2, 210, 66, t, s, "#9aa0a6", desc=d)

    # ── vertical stubs (no diagonals) ──────────────────────────────────────
    # inputs -> command bus
    vstub(440, 122, cb_y, BLUE, 0.0); vstub(700, 122, cb_y, BLUE, 0.4)
    # command bus -> drivers (+sim) ; sensors do NOT subscribe
    for i, cx in enumerate([centers[k] for k in (0, 1, 2, 3, 8)]):
        vstub(cx, cb_y + 64, ny, BLUE, 0.15 * i)
    # producers -> state bus (all 9)
    for i, cx in enumerate(centers):
        vstub(cx, ny + nh, sb_y, GREEN if i < 4 or i == 8 else CYAN, 0.12 * i)
    # state bus -> consumers
    for i, cx in enumerate(ccenters):
        vstub(cx, sb_y + 86, cy2, GREEN, 0.18 * i)

    # legend
    ly = H - 26
    for i, (c, t) in enumerate(((BLUE, "commands"), (ORANGE, "drivers"), (CYAN, "sensors"),
                                (SIM, "sim (unified)"), (GREEN, "state + sensors out"))):
        x = 60 + i * 200
        o.append(dot(x, ly - 4, c, 5)); o.append(txt(x + 14, ly, t, LABEL2, 12, 500))
    o.append(txt(W - 36, ly, "one DDS graph · sim or real", LABEL3, 12, 600, font=MONO, anchor="end"))
    o.append("</svg>")
    return "\n".join(o)


# ── System architecture (Figure 1) — animated, plays in <img> ─────────────────

def _arch_common():
    return dict(PAPER="#FAF8F2", WHITE="#FFFFFF", BONE="#F2EEE6", INK="#161412",
                INKS="#2A2622", ASH="#6B6660", ASHL="#A09A91", RUST="#C25B2A",
                HAIR="rgba(22,20,18,0.14)",
                FS="'Geist', -apple-system, 'Helvetica Neue', Arial, sans-serif",
                FM="'Geist Mono', 'SF Mono', Menlo, monospace")

def system_arch_svg():
    """Control stack that branches into Real robot + Digital twin, with connecting lines."""
    g = _arch_common(); PAPER,WHITE,BONE,INK,INKS,ASH,ASHL,RUST,HAIR,FS,FM = (
        g['PAPER'],g['WHITE'],g['BONE'],g['INK'],g['INKS'],g['ASH'],g['ASHL'],g['RUST'],g['HAIR'],g['FS'],g['FM'])
    W, H = 1360, 824
    def R(x,y,w,h,r,fill,stroke=None,sw=1,dash=None):
        s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
        if stroke: s+=f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: s+=f' stroke-dasharray="{dash}"'
        return s+"/>"
    def T(x,y,s,fill=INK,size=12,w=400,font=FS,anc="start",sp=None):
        sps=f' letter-spacing="{sp}"' if sp else ""
        return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{w}" font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>'
    def Dt(x,y,c,r=4): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'
    def A(href,inner): return f'<a href="{href}" target="_top">{inner}</a>'
    def L(x1,y1,x2,y2,color=HAIR,sw=1.2,dash=None):
        d=f' stroke-dasharray="{dash}"' if dash else ''
        return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}"{d}/>'
    def chev(cx,ay,c=RUST):
        return f'<path d="M {cx-7} {ay} L {cx} {ay+7} L {cx+7} {ay}" stroke="{c}" stroke-width="1.6" fill="none" opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/>'
    STYLE=('<style>a{cursor:pointer}a rect,a text{transition:fill .15s,stroke .15s}'
           'a:hover rect{stroke:#C25B2A;stroke-width:2;fill:#FBEFE7}a:hover text{fill:#C25B2A}</style>')
    o=[]
    chip_h=30
    def chips(items,x0,y0,maxw):
        cx,cy=x0,y0
        for t,href in items:
            w=int(len(t)*6.2)+24
            if cx+w>x0+maxw: cx=x0; cy+=chip_h+9
            o.append(A(href, R(cx,cy,w,chip_h,8,BONE,stroke=HAIR,sw=1)+T(cx+w/2,cy+chip_h/2+3.6,t,INKS,11,500,font=FM,anc="middle")))
            cx+=w+10
        return cy+chip_h
    def box(x,y,w,label,lhref,items,dashed=False):
        n=len(o)
        bottom=chips(items,x+24,y+52,w-48)
        bh=(bottom-y)+18
        o.insert(n, R(x,y,w,bh,14,WHITE,stroke=HAIR,sw=1.2,dash="2 5" if dashed else None))
        o.insert(n+1, Dt(x+22,y+25,RUST,3.5))
        o.insert(n+2, A(lhref, T(x+36,y+30,label,INKS,11,600,sp="0.5")))
        return y+bh
    bx,bw=170,1020
    # ── shared control stack (full width) — identical for sim and real ──
    tiers=[
        ("OPERATOR · AUTONOMY","teleop.html",
         [("Vision Pro teleop","teleop.html"),("iPhone app","teleop.html"),("Learned policies","learning.html"),("Nav goals","navigation.html")]),
        ("ONBOARD INTELLIGENCE · Jetson Thor","wbc.html",
         [("Whole-body control (QP)","wbc.html"),("Nav2 + SLAM","navigation.html"),("Policy runtime","learning.html"),("Perception","ros.html")]),
        ("ROS 2 MIDDLEWARE · mabel_ws (DDS)","ros.html",
         [("driver nodes","ros.html"),("/joint_states","ros.html"),("/odom","ros.html"),("sensor topics","ros.html"),("/cmd","ros.html")]),
    ]
    y=92; ys=[]
    for label,lhref,items in tiers:
        b=box(bx,y,bw,label,lhref,items)
        ys.append((y,b)); y=b+30
    for i in range(len(ys)-1):
        o.append(chev(bx+bw/2, ys[i][1]+8))
    rosb=ys[-1][1]  # ROS 2 bottom — the stack forks here
    # ── fork after ROS 2: real robot (adds firmware) vs digital twin (no firmware) ──
    half=(bw-30)/2
    lcx, rcx = bx+half/2, bx+bw-half/2          # left/right column centres
    busy=rosb+42
    by=rosb+92                                   # branch headers top
    # LEFT branch — real robot: firmware → hardware
    fb=box(bx, by, half, "FIRMWARE · per-MCU","firmware.html",
           [("swerve · REV CAN","firmware.html"),("arms + body · Damiao","firmware.html"),("hands · Feetech","firmware.html"),("neck · Dynamixel","firmware.html"),("lift · Pico","firmware.html")])
    rby=fb+28
    o.append(chev(lcx, fb+14)); o.append(L(lcx, fb, lcx, rby, RUST, 1.4))
    rb=box(bx, rby, half, "REAL ROBOT · 51 DOF","hardware.html",
           [("Base","hardware-base.html"),("Lift","hardware-lift.html"),("Body + neck","hardware-body.html"),("Arms 2×7","hardware-arms.html"),("Hands 2×17","hardware-hands.html"),("Sensors","hardware.html"),("PCB + power","hardware-electronics.html")])
    # RIGHT branch — digital twin: ROS 2 talks straight to MuJoCo, no firmware
    tb=box(bx+half+30, by, half, "DIGITAL TWIN · MuJoCo","simulation.html",
           [("Same URDF → MJCF","simulation.html"),("Same ROS 2 interface","simulation.html"),("Same control code","simulation.html"),("No firmware — direct","simulation.html"),("Sim or real, one flag","simulation.html")], dashed=True)
    # connecting lines: ROS 2 → bus → each branch head
    cxm=bx+bw/2
    o.append(L(cxm, rosb+18, cxm, busy, RUST, 1.4))
    o.append(L(lcx, busy, rcx, busy, RUST, 1.4))
    o.append(L(lcx, busy, lcx, by, RUST, 1.4))
    o.append(L(rcx, busy, rcx, by, RUST, 1.4))
    o.append(chev(lcx, by-9)); o.append(chev(rcx, by-9))
    o.append(T(lcx, busy-9, "ON HARDWARE", RUST, 10.5, 700, font=FM, anc="middle", sp="0.8"))
    o.append(T(rcx, busy-9, "IN SIMULATION", RUST, 10.5, 700, font=FM, anc="middle", sp="0.8"))
    o.append(T(cxm, busy+20, "the stack is identical down to ROS 2 — only the real robot adds a firmware layer; the twin drives MuJoCo directly", ASH, 11, 500, font=FM, anc="middle"))
    # dynamic canvas height
    H=int(max(rb,tb)+56)
    head=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{FS}">',
          R(0,0,W,H,16,PAPER,stroke=HAIR,sw=1), STYLE,
          T(40,46,"Figure 1 — MABEL system architecture  ·  click any block to open its page",ASH,13,500,font=FM,sp="0.3")]
    o=head+o
    o.append(T(W/2, H-22, "commands flow down to the joints · state and perception flow back up · sim and real share every interface above ROS 2", ASHL, 12, 400, anc="middle"))
    o.append("</svg>")
    return chr(10).join(o)

def system_arch_mobile_svg():
    g=_arch_common(); PAPER,WHITE,BONE,INK,INKS,ASH,ASHL,RUST,HAIR,FS,FM = (
        g['PAPER'],g['WHITE'],g['BONE'],g['INK'],g['INKS'],g['ASH'],g['ASHL'],g['RUST'],g['HAIR'],g['FS'],g['FM'])
    W=430
    def R(x,y,w,h,r,fill,stroke=None,sw=1,dash=None):
        s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
        if stroke: s+=f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: s+=f' stroke-dasharray="{dash}"'
        return s+"/>"
    def T(x,y,s,fill=INK,size=12,w=400,font=FS,anc="start",sp=None):
        sps=f' letter-spacing="{sp}"' if sp else ""
        return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{w}" font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>'
    def Dt(x,y,c,r=4): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'
    def A(href,inner): return f'<a href="{href}" target="_top">{inner}</a>'
    STYLE=('<style>a{cursor:pointer}a:hover rect{stroke:#C25B2A;stroke-width:2;fill:#FBEFE7}a:hover text{fill:#C25B2A}</style>')
    body=[]; mx,mw=16,W-32; chip_h=30
    def chips(items,x0,y0,maxw):
        cx,cy=x0,y0
        for t,href in items:
            w=int(len(t)*7.0)+22
            if cx+w>x0+maxw: cx=x0; cy+=chip_h+8
            body.append(A(href, R(cx,cy,w,chip_h,8,BONE,stroke=HAIR,sw=1)+T(cx+w/2,cy+chip_h/2+4,t,INKS,12.5,500,font=FM,anc="middle")))
            cx+=w+8
        return cy+chip_h
    def Tm(x,yy,s,fill=INK,size=12,w=400,font=FS,anc="start",sp=None):
        sps=f' letter-spacing="{sp}"' if sp else ""
        return f'<text x="{x}" y="{yy}" fill="{fill}" font-size="{size}" font-weight="{w}" font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>'
    def chevm(ay): body.append(f'<path d="M {W/2-7} {ay} L {W/2} {ay+7} L {W/2+7} {ay}" stroke="{RUST}" stroke-width="1.6" fill="none" opacity="0.55" stroke-linecap="round" stroke-linejoin="round"/>')
    def tier(y,label,lhref,items,dashed=False):
        n=len(body)
        bottom=chips(items,mx+16,y+48,mw-32)
        bh=(bottom-y)+16
        body.insert(n, R(mx,y,mw,bh,13,WHITE if not dashed else BONE,stroke=HAIR,sw=1.2,dash="2 5" if dashed else None))
        body.insert(n+1, Dt(mx+22,y+24,RUST,3.5))
        body.insert(n+2, A(lhref, Tm(mx+34,y+29,label,INKS,12,600,sp="0.4")))
        return y+bh
    # shared control stack
    shared=[
        ("OPERATOR · AUTONOMY","teleop.html",[("Vision Pro","teleop.html"),("iPhone app","teleop.html"),("Policies","learning.html"),("Nav goals","navigation.html")]),
        ("ONBOARD · Jetson Thor","wbc.html",[("Whole-body control","wbc.html"),("Nav2 + SLAM","navigation.html"),("Policy runtime","learning.html"),("Perception","ros.html")]),
        ("ROS 2 · mabel_ws","ros.html",[("driver nodes","ros.html"),("/joint_states","ros.html"),("/odom","ros.html"),("sensors","ros.html"),("/cmd","ros.html")]),
    ]
    y=96
    for label,lhref,items in shared:
        bh_end=tier(y,label,lhref,items)
        chevm(bh_end+6); y=bh_end+30
    # fork divider
    body.append(Tm(W/2,y+8,"forks after ROS 2",RUST,11,700,font=FM,anc="middle",sp="0.6"))
    y+=28
    # ON HARDWARE branch — firmware then real robot
    body.append(Tm(mx,y,"ON HARDWARE",ASH,10.5,700,font=FM,sp="0.8")); y+=14
    bh_end=tier(y,"FIRMWARE · per-MCU","firmware.html",[("Swerve · REV","firmware.html"),("Arms+Body · Damiao","firmware.html"),("Hands · Feetech","firmware.html"),("Neck · Dynamixel","firmware.html"),("Lift · Pico","firmware.html")])
    chevm(bh_end+6); y=bh_end+30
    bh_end=tier(y,"REAL ROBOT · 51 DOF","hardware.html",[("Base","hardware-base.html"),("Lift","hardware-lift.html"),("Body + neck","hardware-body.html"),("Arms 2×7","hardware-arms.html"),("Hands 2×17","hardware-hands.html"),("Sensors","hardware.html"),("PCB + power","hardware-electronics.html")])
    y=bh_end+34
    # IN SIMULATION branch — MuJoCo, no firmware
    body.append(Tm(mx,y,"IN SIMULATION",ASH,10.5,700,font=FM,sp="0.8")); y+=14
    bh_end=tier(y,"DIGITAL TWIN · MuJoCo","simulation.html",[("Same URDF","simulation.html"),("Same ROS interface","simulation.html"),("Same control code","simulation.html"),("No firmware — direct","simulation.html"),("Sim or real","simulation.html")],dashed=True)
    y=bh_end+18
    Hh=int(y+40)
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {Hh}" font-family="{FS}">']
    o.append(R(0,0,W,Hh,16,PAPER,stroke=HAIR,sw=1)); o.append(STYLE)
    o.append(T(16,40,"Figure 1 — System architecture",ASH,13,500,font=FM,sp="0.3"))
    o.append(T(16,62,"tap any block to open its page",RUST,11.5,600))
    o+=body
    o.append(T(W/2,Hh-16,"one interface drives the real robot and the twin",ASHL,11,400,anc="middle"))
    o.append("</svg>")
    return chr(10).join(o)

def retarget_svg():
    """Two-stage teleop retargeting pipeline: human keypoints -> robot targets (hand
    keypoint optimization + whole-body QP) -> handed to whole-body control."""
    g=_arch_common(); PAPER,WHITE,BONE,INK,INKS,ASH,ASHL,RUST,HAIR,FS,FM = (
        g['PAPER'],g['WHITE'],g['BONE'],g['INK'],g['INKS'],g['ASH'],g['ASHL'],g['RUST'],g['HAIR'],g['FS'],g['FM'])
    W,H=1240,560
    def R(x,y,w,h,r,fill,stroke=None,sw=1,dash=None):
        s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
        if stroke: s+=f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: s+=f' stroke-dasharray="{dash}"'
        return s+"/>"
    def T(x,y,s,fill=INK,size=12,w=400,font=FS,anc="start",sp=None):
        sps=f' letter-spacing="{sp}"' if sp else ""
        return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{w}" font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>'
    def Dt(x,y,c,r=3.5): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'
    def A(href,inner): return f'<a href="{href}" target="_top">{inner}</a>'
    def arrow(x1,x2,y,c=RUST):
        return (f'<line x1="{x1}" y1="{y}" x2="{x2-7}" y2="{y}" stroke="{c}" stroke-width="1.6"/>'
                f'<path d="M {x2-9} {y-5} L {x2} {y} L {x2-9} {y+5}" stroke="{c}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    STYLE=('<style>a{cursor:pointer}a rect,a text{transition:fill .15s,stroke .15s}'
           'a:hover rect{stroke:#C25B2A;stroke-width:2;fill:#FBEFE7}a:hover text{fill:#C25B2A}</style>')
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{FS}">',
       R(0,0,W,H,16,PAPER,stroke=HAIR,sw=1), STYLE,
       T(40,46,"Figure — teleop retargeting: human keypoints → robot targets → joints",ASH,13,500,font=FM,sp="0.3")]
    def head(x,y,title,sub,c=RUST):
        o.append(Dt(x+10,y+13,c)); o.append(T(x+24,y+18,title,INKS,11,600,sp="0.5"))
        o.append(T(x+24,y+34,sub,ASH,10,500,font=FM))
    # ── Stage A: operator ──
    ax,aw=40,250; ay,ah=150,232
    o.append(R(ax,ay,aw,ah,14,WHITE,stroke=HAIR,sw=1.2)); head(ax,ay+8,"OPERATOR","Apple Vision Pro")
    for i,t in enumerate(["Head pose · 6-DoF","Left + right wrist · 6-DoF","Hand joints · 25 × 2","gaze · pinch state"]):
        yy=ay+74+i*36
        o.append(R(ax+18,yy,aw-36,28,8,BONE,stroke=HAIR,sw=1)); o.append(T(ax+30,yy+18,t,INKS,11,500,font=FM))
    # ── Stage B: two optimizers ──
    bx,bw=370,470
    # B1 hand
    b1y,b1h=98,160
    o.append(R(bx,b1y,bw,b1h,14,WHITE,stroke=HAIR,sw=1.2)); head(bx,b1y+8,"HAND RETARGETING","per-frame keypoint optimization")
    o.append(T(bx+56,b1y+72,"Σ‖ vᵢʰ − vᵢʳ(q) ‖²  +  λ‖q − q₋₁‖²",INKS,12.5,500,font=FM))
    o.append(T(bx+24,b1y+68,"min",INKS,12.5,500,font=FM)); o.append(T(bx+38,b1y+80,"q",ASH,8,500,font=FM,anc="middle"))
    o.append(T(bx+24,b1y+100,"s.t.  q⁻ ≤ q ≤ q⁺   joint limits",ASH,11,500,font=FM))
    o.append(T(bx+bw-22,b1y+132,"→ ORCA hand: 16 finger DOF + wrist roll",RUST,11,600,font=FM,anc="end"))
    # B2 body
    b2y,b2h=288,168
    o.append(R(bx,b2y,bw,b2h,14,WHITE,stroke=HAIR,sw=1.2)); head(bx,b2y+8,"WHOLE-BODY RETARGETING","Cartesian QP · redundancy resolution")
    o.append(T(bx+24,b2y+72,"head → neck      wrist → arm end-effector target",INKS,11.5,500,font=FM))
    o.append(T(bx+56,b2y+102,"‖ J q̇ − ẋ* ‖²  +  regularize the null space",INKS,12.5,500,font=FM))
    o.append(T(bx+24,b2y+98,"min",INKS,12.5,500,font=FM)); o.append(T(bx+39,b2y+110,"q̇",ASH,8,500,font=FM,anc="middle"))
    o.append(T(bx+bw-22,b2y+140,"→ arms 7×2 · torso · lift · base",RUST,11,600,font=FM,anc="end"))
    # ── Stage C: WBC ──
    cx,cw=900,300; cy,ch=150,232
    o.append(A("wbc.html", R(cx,cy,cw,ch,14,WHITE,stroke=HAIR,sw=1.2)+Dt(cx+10,cy+21,RUST)+T(cx+24,cy+26,"WHOLE-BODY CONTROL",INKS,11,600,sp="0.5")+T(cx+24,cy+42,"shared solver · click →",ASH,10,500,font=FM)))
    o.append(T(cx+24,cy+86,"resolves every target together",INKS,11.5,500))
    o.append(T(cx+24,cy+108,"across all 51 joints, with the",ASH,11,400))
    o.append(T(cx+24,cy+126,"tip-safe + balance constraints",ASH,11,400))
    o.append(R(cx+18,cy+150,cw-36,30,8,BONE,stroke=HAIR,sw=1)); o.append(T(cx+cw/2,cy+170,"→ 51 coordinated joint commands",RUST,11.5,600,font=FM,anc="middle"))
    o.append(T(cx+24,cy+ch-12,"the same solver autonomy uses",ASHL,10,400,font=FM))
    # arrows
    o.append(arrow(ax+aw, bx, ay+ah/2))
    o.append(arrow(bx+bw, cx, cy+ch/2))
    o.append(T(W/2, H-22, "human keypoints become robot targets, then one whole-body solve turns targets into joints — every frame at 60 Hz", ASHL,12,400,anc="middle"))
    o.append("</svg>")
    return chr(10).join(o)

def bridge_svg():
    """The server abstraction layer: one two-port contract (WS uplink + MJPEG
    downlink) so any client drives sim or the real robot without touching ROS."""
    g=_arch_common(); PAPER,WHITE,BONE,INK,INKS,ASH,ASHL,RUST,HAIR,FS,FM = (
        g['PAPER'],g['WHITE'],g['BONE'],g['INK'],g['INKS'],g['ASH'],g['ASHL'],g['RUST'],g['HAIR'],g['FS'],g['FM'])
    W,H=1240,560
    def R(x,y,w,h,r,fill,stroke=None,sw=1,dash=None):
        s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
        if stroke: s+=f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: s+=f' stroke-dasharray="{dash}"'
        return s+"/>"
    def T(x,y,s,fill=INK,size=12,w=400,font=FS,anc="start",sp=None):
        sps=f' letter-spacing="{sp}"' if sp else ""
        return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{w}" font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>'
    def Dt(x,y,c,r=3.5): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'
    def head(x,y,title,sub,c=RUST):
        o.append(Dt(x+10,y+13,c)); o.append(T(x+24,y+18,title,INKS,11,600,sp="0.5"))
        if sub: o.append(T(x+24,y+34,sub,ASH,10,500,font=FM))
    def chip(x,y,w,t,c=INKS):
        o.append(R(x,y,w,28,8,BONE,stroke=HAIR,sw=1)); o.append(T(x+12,y+18,t,c,11,500,font=FM))
    def aR(x1,x2,y,c=RUST):  # arrow pointing right
        return (f'<line x1="{x1}" y1="{y}" x2="{x2-8}" y2="{y}" stroke="{c}" stroke-width="1.8"/>'
                f'<path d="M {x2-10} {y-5} L {x2} {y} L {x2-10} {y+5}" stroke="{c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    def aL(x1,x2,y,c=RUST):  # arrow pointing left (x1>x2)
        return (f'<line x1="{x1}" y1="{y}" x2="{x2+8}" y2="{y}" stroke="{c}" stroke-width="1.8"/>'
                f'<path d="M {x2+10} {y-5} L {x2} {y} L {x2+10} {y+5}" stroke="{c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    def aD(x,y1,y2,c=RUST):  # arrow pointing down
        return (f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2-8}" stroke="{c}" stroke-width="1.8"/>'
                f'<path d="M {x-5} {y2-10} L {x} {y2} L {x+5} {y2-10}" stroke="{c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{FS}">',
       R(0,0,W,H,16,PAPER,stroke=HAIR,sw=1),
       T(40,46,"Figure — the server: one two-port contract, no ROS on the client",ASH,13,500,font=FM,sp="0.3")]
    # APPS (tall, left — touches both lanes)
    ax,aw,ay,ah=40,210,120,380
    o.append(R(ax,ay,aw,ah,14,WHITE,stroke=HAIR,sw=1.2)); head(ax,ay+8,"OPERATOR APPS","no ROS on the client")
    chip(ax+18,ay+70,aw-36,"Apple Vision Pro · 60 Hz")
    chip(ax+18,ay+108,aw-36,"iPhone · 20 Hz")
    chip(ax+18,ay+146,aw-36,"any future client")
    o.append(T(ax+24,ay+210,"emit one JSON",ASH,11,400)); o.append(T(ax+24,ay+228,"TeleopFrame; render",ASH,11,400)); o.append(T(ax+24,ay+246,"MJPEG in a WKWebView.",ASH,11,400))
    # BRIDGE (center top)
    bx,bw,by,bh=370,330,120,168
    o.append(R(bx,by,bw,bh,14,WHITE,stroke=HAIR,sw=1.2)); head(bx,by+8,"THE BRIDGE","sim_teleop_bridge.py")
    for i,t in enumerate(["adapt headset hands → AVPFrame","clutch retarget → whole-body IK","step MuJoCo · real-time accumulator","newest-frame only · drop stale"]):
        o.append(Dt(bx+26,by+66+i*24,RUST,2.6)); o.append(T(bx+38,by+70+i*24,t,INKS,11,500,font=FM))
    # ROBOT (top right)
    rx,rw,ry,rh=760,200,120,168
    o.append(R(rx,ry,rw,rh,14,WHITE,stroke=HAIR,sw=1.2,dash="2 5")); head(rx,ry+8,"MuJoCo SIM","or REAL ROBOT")
    o.append(T(rx+24,ry+72,"116-DOF physics on",INKS,11,500)); o.append(T(rx+24,ry+90,"the Mac — or the",INKS,11,500)); o.append(T(rx+24,ry+108,"51-DOF robot.",INKS,11,500))
    o.append(T(rx+24,ry+138,"same control code,",RUST,10.5,600,font=FM)); o.append(T(rx+24,ry+154,"same two ports.",RUST,10.5,600,font=FM))
    # CAMERA BOX (bottom)
    cx,cw,cy,ch=370,590,400,118
    o.append(R(cx,cy,cw,ch,14,WHITE,stroke=HAIR,sw=1.2)); head(cx,cy+8,"CAMERA BOX","sim_camera_server.py · own core")
    o.append(T(cx+24,cy+74,"mmap qpos  →  render head ZED + wrist cams  →  serve MJPEG",INKS,11.5,500,font=FM))
    o.append(T(cx+24,cy+98,"separate process: the ~50–67 ms GPU readback never stalls physics",ASH,10.5,500,font=FM))
    # ── command lane (top, →) ──
    o.append(aR(ax+aw, bx, ay+92))
    o.append(T((ax+aw+bx)/2, ay+78, "ws :9090", RUST,10.5,700,font=FM,anc="middle"))
    o.append(T((ax+aw+bx)/2, ay+118, "TeleopFrame", ASH,9.5,500,font=FM,anc="middle"))
    o.append(aR(bx+bw, rx, by+90))
    o.append(T((bx+bw+rx)/2, by+78, "drives", RUST,10.5,700,font=FM,anc="middle"))
    # ── qpos down (robot → camera) ──
    o.append(aD(rx+rw/2, ry+rh, cy))
    o.append(T(rx+rw/2+10, (ry+rh+cy)/2+4, "qpos · mmap", ASH,10,600,font=FM))
    # ── video lane (bottom, ←) ──
    o.append(aL(cx, ax+aw, cy+ch-26))
    o.append(T((ax+aw+cx)/2, cy+ch-40, "http :8080/camera/*", RUST,10.5,700,font=FM,anc="middle"))
    o.append(T((ax+aw+cx)/2, cy+ch-12, "MJPEG · multipart", ASH,9.5,500,font=FM,anc="middle"))
    o.append(T(W/2, H-22, "uplink = operator intent (one WebSocket) · downlink = cameras (plain HTTP MJPEG) · Bonjour finds the Mac, no IP typing", ASHL,12,400,anc="middle"))
    o.append("</svg>")
    return chr(10).join(o)

def data_svg():
    """Data engine pipeline: teleop → record → one-schema HDF5 episodes → train."""
    g=_arch_common(); PAPER,WHITE,BONE,INK,INKS,ASH,ASHL,RUST,HAIR,FS,FM = (
        g['PAPER'],g['WHITE'],g['BONE'],g['INK'],g['INKS'],g['ASH'],g['ASHL'],g['RUST'],g['HAIR'],g['FS'],g['FM'])
    W,H=1240,470
    def R(x,y,w,h,r,fill,stroke=None,sw=1,dash=None):
        s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
        if stroke: s+=f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: s+=f' stroke-dasharray="{dash}"'
        return s+"/>"
    def T(x,y,s,fill=INK,size=12,w=400,font=FS,anc="start",sp=None):
        sps=f' letter-spacing="{sp}"' if sp else ""
        return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{w}" font-family="{font}" text-anchor="{anc}"{sps}>{s}</text>'
    def Dt(x,y,c,r=3.5): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'
    def aR(x1,x2,y,c=RUST):
        return (f'<line x1="{x1}" y1="{y}" x2="{x2-8}" y2="{y}" stroke="{c}" stroke-width="1.8"/>'
                f'<path d="M {x2-10} {y-5} L {x2} {y} L {x2-10} {y+5}" stroke="{c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="{FS}">',
       R(0,0,W,H,16,PAPER,stroke=HAIR,sw=1),
       T(40,46,"Figure — the data engine: teleop becomes a labelled dataset",ASH,13,500,font=FM,sp="0.3")]
    boxes=[
      ("01","TELEOP","drive to collect",["shared TeleopController","MuJoCo sim — or real robot","cut episodes on the fly · SPACE"]),
      ("02","RECORD","EpisodeRecorder · 15 Hz",["log every obs + the action","background-thread HDF5","one file per episode"]),
      ("03","EPISODE","HDF5 · one schema",["7 cams + LiDAR + 59 joints","action/ctrl [59] — the label","sim &amp; real share the keys"]),
      ("04","TRAIN","imitation learning",["ACT · CVAE · Diffusion","stats → normalization","→ deploy as a policy"]),
    ]
    bw,gap=250,53; y,h=120,250
    for i,(n,title,sub,lines) in enumerate(boxes):
        x=40+i*(bw+gap)
        o.append(R(x,y,bw,h,14,WHITE,stroke=HAIR,sw=1.2))
        o.append(Dt(x+18,y+22,RUST)); o.append(T(x+32,y+27,title,INKS,11.5,600,sp="0.5"))
        o.append(T(x+18,y+48,sub,ASH,10,500,font=FM))
        for j,t in enumerate(lines):
            o.append(Dt(x+22,y+82+j*30,RUST,2.4)); o.append(T(x+34,y+86+j*30,t,INKS,11,500,font=FM))
        o.append(T(x+18,y+h-16,f"step {n}",ASHL,9.5,600,font=FM))
        if i<3: o.append(aR(x+bw, x+bw+gap, y+h/2))
    o.append(T(W/2, H-20, "collection is a side effect of teleop · identical keys sim↔real → policies deploy without remapping I/O", ASHL,12,400,anc="middle"))
    o.append("</svg>")
    return chr(10).join(o)

def main():
    for name, fn in (("gui-swerve.svg", swerve_svg), ("gui-hand.svg", hand_svg),
                     ("retarget.svg", retarget_svg), ("bridge.svg", bridge_svg),
                     ("data-pipeline.svg", data_svg),
                     ("gui-swerve-demo.svg", swerve_demo_svg),
                     ("teleop-dataflow.svg", dataflow_svg),
                     ("ros-graph.svg", ros_graph_svg),
                     ("system-arch.svg", system_arch_svg),
                     ("system-arch-mobile.svg", system_arch_mobile_svg)):
        p = os.path.join(OUT, name)
        with open(p, "w") as f:
            f.write(fn())
        print("wrote", p, f"({os.path.getsize(p)} B)")


if __name__ == "__main__":
    main()
