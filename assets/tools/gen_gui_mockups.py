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


def main():
    for name, fn in (("gui-swerve.svg", swerve_svg), ("gui-hand.svg", hand_svg)):
        p = os.path.join(OUT, name)
        with open(p, "w") as f:
            f.write(fn())
        print("wrote", p, f"({os.path.getsize(p)} B)")


if __name__ == "__main__":
    main()
