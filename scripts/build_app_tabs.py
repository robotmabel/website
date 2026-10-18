"""Illustrated tabs for teleop.html — the iPhone app, the Vision Pro app and the
web Control Studio, one SVG per card.

These are DIAGRAMS of the current UI, not screenshots: each draws the layout a
tab actually has (read from the app source, cited per card) with numbered
callouts that match the list beside it on the page. They carry no hostnames,
addresses, robot names or keys — the real screens show all of those.

Colours are the site's tokens (style="fill:var(--ink)" etc.), so the figures
must be INLINED (data-inline-src) — which is also what lets them use the
site's type. Re-run after an app's layout changes:

    python3 scripts/build_app_tabs.py

Sources (repo-relative):
    ios_apps/iOS_v2/MABEL Mobile App/  ContentView.swift, Features/Robot/RobotSpaceView.swift,
        Features/Policies/PoliciesView.swift, Features/Autonomy/AutonomyTimelineView.swift,
        Features/Settings/RobotView.swift, DesignSystem/Components/GlobalStatusBar.swift
    vision_os_apps/VisionOS_V2/MabelTeleop/  Features/Root/ContentView.swift,
        Features/Robot/RobotSpaceView.swift, Features/Teleop/TeleopImmersiveView.swift,
        App/MabelTeleopApp.swift, Features/Settings/RobotSettingsView.swift
    web_gui/simulation_control_center/web/  index.html, js/viewrail.js, js/modules.js, js/app.js
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
OUT = os.path.join(SITE, "assets", "apptabs")

W, H = 640, 400

# ── tokens ──────────────────────────────────────────────────────────────────
INK, PANEL, BONE, HI, POP, YEL, BLUE, GREEN, ASH, RUST = (
    "var(--ink)", "var(--panel)", "var(--bone)", "var(--hi)", "var(--pop)",
    "var(--yellow)", "var(--blue)", "var(--green)", "var(--ash)", "var(--rust)")
GLASS = "rgba(253,246,226,.82)"
SCENE = "#2A3140"          # the 3-D viewport's dusk backdrop (a scene colour, not a UI token)
SCENE_FLOOR = "#363E50"


def st(fill="none", stroke=None, sw=None, extra=""):
    s = f"fill:{fill};"
    if stroke:
        s += f"stroke:{stroke};stroke-width:{sw or 2};stroke-linejoin:round;stroke-linecap:round;"
    return f'style="{s}{extra}"'


def rect(x, y, w, h, r=6, fill=PANEL, stroke=INK, sw=2.5, extra=""):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" {st(fill, stroke, sw, extra)}/>'


def circ(cx, cy, r, fill=PANEL, stroke=INK, sw=2.5):
    return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" {st(fill, stroke, sw)}/>'


def line(x1, y1, x2, y2, stroke=INK, sw=2.5, dash=None):
    d = f"stroke-dasharray:{dash};" if dash else ""
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" {st("none", stroke, sw, d)}/>'


def path(d, fill="none", stroke=INK, sw=2.5, extra=""):
    return f'<path d="{d}" {st(fill, stroke, sw, extra)}/>'


def text(x, y, s, size=11, fill=INK, font="mono", anchor="start", weight=400, ls=0.04):
    fam = {"mono": "var(--font-mono)", "comic": "var(--font-comic)", "head": "var(--font-head)"}[font]
    return (f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" '
            f'style="font-family:{fam};font-size:{size}px;font-weight:{weight};fill:{fill};letter-spacing:{ls}em">{s}</text>')


def pill(x, y, w, h, label, fill=PANEL, color=INK, size=9.5, font="mono", stroke=INK, sw=2):
    return rect(x, y, w, h, h / 2, fill, stroke, sw) + text(x + w / 2, y + h / 2 + size * 0.36, label, size, color, font, "middle", 700)


def seg(x, y, labels, on=0, h=20, size=8.5, cw=None, dark=False):
    """A segmented control; returns svg and total width."""
    cw = cw or [max(30, 7.2 * len(l) + 14) for l in labels]
    if isinstance(cw, (int, float)):
        cw = [cw] * len(labels)
    tot = sum(cw)
    out = rect(x, y, tot, h, h / 2, "rgba(21,24,32,.55)" if dark else BONE, INK, 2)
    cx = x
    for i, (l, w) in enumerate(zip(labels, cw)):
        if i == on:
            out += rect(cx + 2, y + 2, w - 4, h - 4, (h - 4) / 2, HI, None, 0)
        out += text(cx + w / 2, y + h / 2 + size * 0.36, l, size, "#FFF9F0" if i == on else (BONE if dark else INK), "mono", "middle", 700)
        cx += w
    return out, tot


def stick(cx, cy, r, label, dark=True, knob=(0.35, -0.25)):
    out = circ(cx, cy, r, "rgba(253,246,226,.16)" if dark else BONE, BONE if dark else INK, 2)
    out += circ(cx + knob[0] * r, cy + knob[1] * r, r * 0.38, HI, INK, 2)
    out += text(cx, cy + r + 13, label, 8, BONE if dark else INK, "mono", "middle", 700, 0.1)
    return out


def callout(n, x, y):
    return (circ(x, y, 10, POP, INK, 2.2) +
            text(x, y + 3.8, str(n), 11, INK, "mono", "middle", 700, 0))


def floor_grid(x, y, w, h, horizon, color="rgba(244,234,210,.16)", n=9):
    """Perspective floor grid inside a viewport box (x,y,w,h); horizon = y of the vanishing line."""
    out = []
    vx = x + w / 2
    for i in range(n + 1):
        bx = x - w * 0.6 + i * (w * 2.2) / n
        out.append(line(vx, horizon, bx, y + h, color, 1.2))
    for k in range(1, 7):
        t = (k / 6) ** 1.9
        yy = horizon + (y + h - horizon) * t
        out.append(line(x, yy, x + w, yy, color, 1.2))
    return "".join(out)


def robot(cx, base_y, s=1.0, arms="out", eyes=True):
    """MABEL, front view, white shells: swerve base, lift column, torso, head with antennas."""
    k = s
    out = []
    bw, bh = 46 * k, 22 * k
    out.append(rect(cx - bw / 2, base_y - bh, bw, bh, 5 * k, "#F4F1E8", INK, 2))
    out.append(rect(cx - 5 * k, base_y - bh - 46 * k, 10 * k, 46 * k, 2, "#ECE7DA", INK, 2))
    ty = base_y - bh - 46 * k
    tw, th = 30 * k, 30 * k
    out.append(rect(cx - tw / 2, ty - th, tw, th, 7 * k, "#F4F1E8", INK, 2))
    # arms
    sh_y = ty - th + 8 * k
    for sgn in (-1, 1):
        sx = cx + sgn * (tw / 2 + 2 * k)
        out.append(circ(sx, sh_y, 5 * k, "#E6E1D4", INK, 2))
        if arms == "out":
            ex, ey = sx + sgn * 16 * k, sh_y + 10 * k
            hx, hy = ex + sgn * 14 * k, ey - 6 * k
        elif arms == "up":
            ex, ey = sx + sgn * 12 * k, sh_y - 8 * k
            hx, hy = ex + sgn * 4 * k, ey - 16 * k
        else:   # down
            ex, ey = sx + sgn * 4 * k, sh_y + 16 * k
            hx, hy = ex + sgn * 2 * k, ey + 14 * k
        out.append(line(sx, sh_y, ex, ey, INK, 5.5 * k))
        out.append(line(sx, sh_y, ex, ey, "#ECE7DA", 3.2 * k))
        out.append(line(ex, ey, hx, hy, INK, 5 * k))
        out.append(line(ex, ey, hx, hy, "#ECE7DA", 2.8 * k))
        out.append(circ(hx, hy, 3.6 * k, "#3B3F48", INK, 1.5))
    # head
    hy0 = ty - th - 4 * k
    out.append(line(cx, ty - th, cx, hy0, INK, 2))
    out.append(line(cx - 9 * k, hy0 - 10 * k, cx - 13 * k, hy0 - 24 * k, INK, 1.8))
    out.append(line(cx + 9 * k, hy0 - 10 * k, cx + 13 * k, hy0 - 24 * k, INK, 1.8))
    out.append(rect(cx - 16 * k, hy0 - 14 * k, 32 * k, 14 * k, 7 * k, "#F4F1E8", INK, 2))
    if eyes:
        out.append(circ(cx - 6 * k, hy0 - 7 * k, 3 * k, INK, None, 0))
        out.append(circ(cx + 6 * k, hy0 - 7 * k, 3 * k, INK, None, 0))
    return "".join(out)


def svg(body, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="{label}">'
            f'{body}</svg>\n')


# ── device frames ───────────────────────────────────────────────────────────
def phone_portrait(x, y, h=372):
    w = h * 0.47
    return rect(x, y, w, h, 30, INK, INK, 3) + rect(x + 7, y + 7, w - 14, h - 14, 24, SCENE, None, 0), (x + 7, y + 7, w - 14, h - 14)


def phone_landscape(x, y, w=600):
    h = w * 0.47
    return rect(x, y, w, h, 34, INK, INK, 3) + rect(x + 9, y + 9, w - 18, h - 18, 27, SCENE, None, 0), (x + 9, y + 9, w - 18, h - 18)


def status_bar(x, y, w, compact=False, dark=True):
    """The global status bar: robot switcher, transport chip, (vitals), HOME, E-STOP."""
    out = rect(x, y, w, 22, 11, "rgba(21,24,32,.6)" if dark else GLASS, BONE if dark else INK, 1.5)
    out += robot_glyph(x + 14, y + 11, 0.32, BONE if dark else INK)
    out += pill(x + 26, y + 4, 38, 14, "WI-FI", GREEN, "#FFF9F0", 7)
    if not compact:
        out += text(x + 72, y + 14.5, "▮▮▮ 84%", 7.5, BONE if dark else INK)
    out += pill(x + w - 86, y + 4, 34, 14, "HOME", "transparent", BONE if dark else INK, 7, stroke=BONE if dark else INK, sw=1.2)
    out += pill(x + w - 48, y + 4, 44, 14, "E-STOP", RUST, "#FFF9F0", 7, stroke=RUST)
    return out


def robot_glyph(cx, cy, s, color):
    k = s * 30
    return (rect(cx - k * 0.32, cy - k * 0.5, k * 0.64, k * 0.28, k * 0.14, "none", color, 1.4) +
            rect(cx - k * 0.22, cy - k * 0.16, k * 0.44, k * 0.4, k * 0.08, "none", color, 1.4) +
            line(cx, cy + k * 0.24, cx, cy + k * 0.42, color, 1.4) +
            rect(cx - k * 0.3, cy + k * 0.42, k * 0.6, k * 0.12, 2, "none", color, 1.4))


def tabbar_portrait(cx, y, active=0, dark=True):
    w = 132
    out = rect(cx - w / 2, y, w, 30, 15, GLASS, INK, 2)
    icons = ["robot", "brain", "gear"]
    for i, ic in enumerate(icons):
        ix = cx - w / 2 + 22 + i * 44
        if i == active:
            out += rect(ix - 18, y + 4, 36, 22, 11, HI, None, 0)
        col = "#FFF9F0" if i == active else INK
        out += icon(ic, ix, y + 15, col)
    return out


def icon(kind, x, y, col, s=1.0):
    if kind == "robot":
        return robot_glyph(x, y, 0.42 * s, col)
    if kind == "brain":
        return (path(f"M{x-6} {y+5} q-4 -6 0 -10 q2 -5 7 -3 q5 -3 7 3 q4 4 0 10 z", "none", col, 1.6) +
                line(x + 1, y - 7, x + 1, y + 5, col, 1.3))
    if kind == "gear":
        out = circ(x, y, 4.5, "none", col, 1.6)
        for a in range(0, 360, 45):
            r = math.radians(a)
            out += line(x + 6 * math.cos(r), y + 6 * math.sin(r), x + 8.5 * math.cos(r), y + 8.5 * math.sin(r), col, 2)
        return out
    return ""


# ── iPhone ──────────────────────────────────────────────────────────────────
def ios_robot():
    """Robot tab, portrait: the twin IS the map. Tap the floor for a nav goal."""
    b = ""
    fr, (sx, sy, sw, sh) = phone_portrait(40, 14)
    b += fr
    b += f'<clipPath id="ios1"><rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" rx="24"/></clipPath><g clip-path="url(#ios1)">'
    b += rect(sx, sy + sh * 0.42, sw, sh * 0.58, 0, SCENE_FLOOR, None, 0)
    b += floor_grid(sx, sy, sw, sh, sy + sh * 0.42)
    # SLAM mesh blocks (walls / furniture) — the live map
    b += rect(sx + 8, sy + sh * 0.30, 40, 62, 3, "rgba(35,87,126,.75)", BLUE, 1.5)
    b += rect(sx + sw - 46, sy + sh * 0.34, 38, 46, 3, "rgba(46,125,79,.7)", GREEN, 1.5)
    # path + goal
    b += path(f"M{sx+sw/2} {sy+sh*0.72} Q{sx+sw*0.62} {sy+sh*0.6} {sx+sw*0.72} {sy+sh*0.56}", "none", POP, 2.5, "stroke-dasharray:5 4;")
    b += f'<ellipse cx="{sx+sw*0.72:.1f}" cy="{sy+sh*0.56:.1f}" rx="13" ry="5" {st("none", GREEN, 3)}/>'
    b += line(sx + sw * 0.72, sy + sh * 0.56, sx + sw * 0.72, sy + sh * 0.47, GREEN, 3)
    b += robot(sx + sw / 2, sy + sh * 0.76, 0.62, "down")
    b += status_bar(sx + 6, sy + 22, sw - 12, compact=True)
    b += pill(sx + 8, sy + 52, 58, 16, "LIVE SLAM", BLUE, "#FFF9F0", 7)
    b += pill(sx + sw / 2 - 30, sy + 74, 60, 18, "▶ TELEOP", HI, "#FFF9F0", 7.5)
    b += pill(sx + sw - 48, sy + 98, 40, 18, "GO", GREEN, "#FFF9F0", 7.5)
    s1, _ = seg(sx + 10, sy + sh - 78, ["3rd", "1st"], 0, 18, 7.5, 28, dark=True)
    b += s1
    b += pill(sx + sw - 50, sy + sh - 78, 40, 18, "⌃", "rgba(21,24,32,.6)", BONE, 10, stroke=BONE, sw=1.2)
    b += tabbar_portrait(sx + sw / 2, sy + sh - 44, 0)
    b += "</g>"
    # callouts on the side
    b += callout(1, sx + sw * 0.72 + 18, sy + sh * 0.5)
    b += callout(2, sx + sw / 2 + 40, sy + 83)
    b += callout(3, sx + 3, sy + sh - 69)
    b += callout(4, sx + sw + 4, sy + sh - 69)
    b += callout(5, sx + sw + 4, sy + 33)
    # big caption art on the right: a hand tapping the floor
    b += _tap_hint(420, 170)
    return svg(b, "iPhone Robot tab: the live 3D twin is the map; tap the floor to send a navigation goal")


def _tap_hint(x, y):
    out = circ(x, y, 34, "none", POP, 3) + circ(x, y, 20, "none", POP, 3) + circ(x, y, 7, POP, INK, 2)
    out += text(x, y + 62, "TAP THE FLOOR", 14, INK, "comic", "middle", 400, 0.06)
    out += text(x, y + 80, "A* plans it · the base drives it", 10, ASH, "mono", "middle")
    return out


def ios_drive():
    """Robot tab, landscape, Teleop on, Drive: TRANSLATE · LIFT · ROTATE."""
    b = ""
    fr, (sx, sy, sw, sh) = phone_landscape(20, 60)
    b += fr
    b += f'<clipPath id="ios2"><rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" rx="27"/></clipPath><g clip-path="url(#ios2)">'
    # first-person: the head camera view (a kitchen counter, drawn flat)
    b += rect(sx, sy, sw, sh, 0, "#5B6475", None, 0)
    b += rect(sx, sy + sh * 0.58, sw, sh * 0.42, 0, "#8C7A63", None, 0)
    b += rect(sx + sw * 0.18, sy + sh * 0.2, sw * 0.26, sh * 0.38, 3, "#3F4757", INK, 1.5)
    b += rect(sx + sw * 0.56, sy + sh * 0.24, sw * 0.2, sh * 0.34, 3, "#E8E2D4", INK, 1.5)
    # wrist tips in view
    b += path(f"M{sx+sw*0.3} {sy+sh} l18 -46 l16 4 l-6 42 z", "#ECE7DA", INK, 2)
    b += path(f"M{sx+sw*0.7} {sy+sh} l-18 -46 l-16 4 l6 42 z", "#ECE7DA", INK, 2)
    s1, w1 = seg(sx + 16, sy + 12, ["DRIVE", "JOINT", "TASK"], 0, 20, 8, 46, dark=True)
    b += s1
    b += pill(sx + sw / 2 - 34, sy + 12, 68, 20, "■ STOP", RUST, "#FFF9F0", 8, stroke=RUST)
    b += pill(sx + sw - 70, sy + 12, 54, 20, "E-STOP", RUST, "#FFF9F0", 8, stroke=RUST)
    b += stick(sx + 74, sy + sh - 66, 38, "TRANSLATE")
    # lift: vertical rate slider
    b += rect(sx + sw / 2 - 9, sy + sh - 120, 18, 84, 9, "rgba(253,246,226,.16)", BONE, 2)
    b += rect(sx + sw / 2 - 13, sy + sh - 92, 26, 16, 8, HI, INK, 2)
    b += text(sx + sw / 2, sy + sh - 22, "LIFT", 8, BONE, "mono", "middle", 700, 0.1)
    # rotate: 1-D horizontal
    b += rect(sx + sw - 140, sy + sh - 76, 110, 20, 10, "rgba(253,246,226,.16)", BONE, 2)
    b += circ(sx + sw - 70, sy + sh - 66, 13, HI, INK, 2)
    b += text(sx + sw - 85, sy + sh - 40, "ROTATE", 8, BONE, "mono", "middle", 700, 0.1)
    b += "</g>"
    b += callout(1, sx + 74 - 50, sy + sh - 112)
    b += callout(2, sx + sw / 2 + 24, sy + sh - 120)
    b += callout(3, sx + sw - 30, sy + sh - 96)
    b += callout(4, sx + 16 + w1 + 14, sy + 22)
    b += callout(5, sx + sw - 8, sy + 2)
    b += text(W / 2, 36, "LANDSCAPE · FIRST PERSON", 13, INK, "comic", "middle", 400, 0.08)
    return svg(b, "iPhone Robot tab in landscape: drive with the translate stick, lift slider and rotate stick over the head camera")


def ios_joint_task():
    """Joint: module rail + sliders. Task: drag the green wrist ball, Execute."""
    b = ""
    for k, (ox, mode) in enumerate([(30, "joint"), (338, "task")]):
        fr, (sx, sy, sw, sh) = phone_portrait(ox + 40, 20, 350)
        b += fr
        cid = f"iosjt{k}"
        b += f'<clipPath id="{cid}"><rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" rx="24"/></clipPath><g clip-path="url(#{cid})">'
        b += rect(sx, sy + sh * 0.5, sw, sh * 0.5, 0, SCENE_FLOOR, None, 0)
        b += floor_grid(sx, sy, sw, sh, sy + sh * 0.5, n=7)
        b += robot(sx + sw / 2 + 8, sy + sh * 0.78, 0.9, "out")
        s1, _ = seg(sx + 8, sy + 16, ["DRIVE", "JOINT", "TASK"], 1 if mode == "joint" else 2, 18, 6.5, 40, dark=True)
        b += s1
        if mode == "joint":
            for i, lab in enumerate(["L", "R", "N", "H", "T"]):
                b += rect(sx + 8, sy + 46 + i * 24, 20, 20, 6, HI if i == 0 else GLASS, INK, 1.5)
                b += text(sx + 18, sy + 59.5 + i * 24, lab, 8, "#FFF9F0" if i == 0 else INK, "mono", "middle", 700)
            px, py = sx + sw - 92, sy + sh - 120
            b += rect(px, py, 84, 92, 8, GLASS, INK, 1.5)
            for i in range(5):
                yy = py + 14 + i * 16
                b += line(px + 8, yy, px + 76, yy, ASH, 2)
                b += circ(px + 20 + (i * 13) % 50, yy, 4.5, HI, INK, 1.4)
        else:
            gx, gy = sx + sw / 2 + 48, sy + sh * 0.45
            b += circ(gx, gy, 12, "rgba(46,125,79,.85)", INK, 2)
            b += path(f"M{gx-26} {gy+30} L{gx-10} {gy+12}", "none", POP, 2.5, "stroke-dasharray:4 3;")
            b += pill(sx + sw / 2 - 30, sy + sh - 62, 60, 18, "EXECUTE", GREEN, "#FFF9F0", 7.5)
            for i, lab in enumerate(["L GRIP", "R GRIP"]):
                yy = sy + sh - 92 + i * 0
                xx = sx + 10 + i * (sw - 60)
                b += rect(xx, sy + sh * 0.36, 10, 70, 5, "rgba(253,246,226,.2)", BONE, 1.5)
                b += rect(xx - 2, sy + sh * 0.36 + 40, 14, 10, 4, HI, INK, 1.5)
                b += text(xx + 5, sy + sh * 0.36 + 84, lab, 6.5, BONE, "mono", "middle", 700)
        b += "</g>"
        b += text(sx + sw / 2, sy + sh + 30, "JOINT" if mode == "joint" else "TASK", 15, INK, "comic", "middle", 400, 0.08)
        if mode == "joint":
            b += callout(1, sx - 6, sy + 70)
            b += callout(2, sx + sw + 4, sy + sh - 110)
        else:
            b += callout(3, sx + sw / 2 + 48 + 22, sy + sh * 0.45 - 18)
            b += callout(4, sx + sw / 2 + 40, sy + sh - 66)
            b += callout(5, sx - 6, sy + sh * 0.36 + 30)
    return svg(b, "iPhone Robot tab, Joint and Task modes: per-module sliders, or drag the wrist target and execute")


def ios_console():
    """The pull-up console: voice, layers, cameras, telemetry."""
    b = ""
    fr, (sx, sy, sw, sh) = phone_portrait(40, 14)
    b += fr
    b += f'<clipPath id="ios4"><rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" rx="24"/></clipPath><g clip-path="url(#ios4)">'
    b += rect(sx, sy + sh * 0.3, sw, sh * 0.7, 0, SCENE_FLOOR, None, 0)
    b += robot(sx + sw / 2, sy + sh * 0.36, 0.5, "down")
    b += status_bar(sx + 6, sy + 22, sw - 12, compact=True)
    py = sy + sh * 0.38
    b += rect(sx, py, sw, sh, 18, GLASS, INK, 2)
    b += rect(sx + sw / 2 - 18, py + 6, 36, 4, 2, ASH, None, 0)
    b += text(sx + 12, py + 26, "VOICE", 8, RUST, "mono", "start", 700, 0.1)
    b += pill(sx + 12, py + 32, 46, 16, "TALK", HI, "#FFF9F0", 7)
    b += pill(sx + 62, py + 32, 50, 16, "LISTEN", BONE, INK, 7)
    b += path(f"M{sx+120} {py+40} " + " ".join(f"l4 {(-1)**i*(3+(i*7)%6)}" for i in range(10)), "none", BLUE, 1.6)
    b += text(sx + 12, py + 66, "LAYERS", 8, RUST, "mono", "start", 700, 0.1)
    for i, lab in enumerate(["MESH", "CLOUD", "LIDAR", "CAM 3D"]):
        b += pill(sx + 12 + i * 37, py + 72, 34, 15, lab, GREEN if i < 3 else BONE, "#FFF9F0" if i < 3 else INK, 6)
    b += text(sx + 12, py + 106, "CAMERAS & LIDAR", 8, RUST, "mono", "start", 700, 0.1)
    for i in range(4):
        cx, cy = sx + 12 + (i % 2) * ((sw - 30) / 2 + 6), py + 112 + (i // 2) * 38
        b += rect(cx, cy, (sw - 30) / 2, 32, 5, "#5B6475", INK, 1.5)
        b += text(cx + 4, cy + 28, ["HEAD", "L WRIST", "R WRIST", "BASE"][i], 6, BONE, "mono", "start", 700)
    b += text(sx + 12, py + 202, "TELEMETRY · POS VEL TORQUE", 7, RUST, "mono", "start", 700, 0.08)
    b += "</g>"
    b += callout(1, sx + sw + 4, py + 40)
    b += callout(2, sx + sw + 4, py + 80)
    b += callout(3, sx + sw + 4, py + 140)
    b += callout(4, sx + sw + 4, py + 200)
    # swipe hint
    b += path("M420 300 L420 140", "none", POP, 5)
    b += path("M406 156 L420 138 L434 156", "none", POP, 5)
    b += text(420, 330, "SWIPE UP", 14, INK, "comic", "middle", 400, 0.06)
    b += text(420, 348, "the console rides over the live twin", 10, ASH, "mono", "middle")
    return svg(b, "iPhone pull-up console: voice, map layers, the four cameras and telemetry")


def autonomy_art(prefix, device="phone"):
    """Autonomy: Compose (choreography timeline) | Hub (assistant, robot control, automations, skills)."""
    b = ""
    # Compose panel (left)
    x0, y0 = 24, 30
    b += rect(x0, y0, 360, 330, 14, PANEL, INK, 3)
    s1, _ = seg(x0 + 14, y0 + 12, ["COMPOSE", "HUB"], 0, 22, 8.5, 70)
    b += s1
    b += pill(x0 + 360 - 92, y0 + 12, 78, 22, "EXECUTE", HI, "#FFF9F0", 8.5)
    b += rect(x0 + 14, y0 + 46, 332, 132, 8, SCENE, INK, 2)
    b += floor_grid(x0 + 14, y0 + 46, 332, 132, y0 + 120, n=8)
    b += robot(x0 + 180, y0 + 168, 0.72, "up")
    b += text(x0 + 24, y0 + 168, "▶  0:04 / 0:12", 9, BONE, "mono")
    lanes = [("NAV", BLUE, [(0, 0.35), (0.55, 0.9)]), ("MANIP", HI, [(0.2, 0.62)]), ("VOICE", GREEN, [(0.05, 0.25), (0.7, 0.85)])]
    for i, (lab, col, blocks) in enumerate(lanes):
        ly = y0 + 196 + i * 40
        b += text(x0 + 16, ly + 18, lab, 9, INK, "mono", "start", 700)
        b += rect(x0 + 66, ly, 280, 28, 6, BONE, INK, 1.5)
        for a, z in blocks:
            b += rect(x0 + 68 + a * 276, ly + 3, (z - a) * 276, 22, 5, col, INK, 1.5)
    b += line(x0 + 66 + 0.33 * 280, y0 + 190, x0 + 66 + 0.33 * 280, y0 + 318, RUST, 2.5)
    # Hub panel (right)
    hx = 404
    b += rect(hx, y0, 212, 330, 14, PANEL, INK, 3)
    s2, _ = seg(hx + 14, y0 + 12, ["COMPOSE", "HUB"], 1, 22, 8.5, 70)
    b += s2
    cards = [("ASSISTANT", "“Bring me a cup”", BLUE), ("ROBOT CONTROL", "Dock · Home · Sleep", INK),
             ("AUTOMATIONS", "Mon–Fri 8:00 tidy", GREEN), ("SKILLS", "Pick · Place · Collect", HI)]
    for i, (t, sub, col) in enumerate(cards):
        cy = y0 + 46 + i * 70
        b += rect(hx + 14, cy, 184, 60, 8, BONE, INK, 2)
        b += rect(hx + 14, cy, 8, 60, 4, col, None, 0)
        b += text(hx + 30, cy + 22, t, 9, INK, "mono", "start", 700, 0.08)
        b += text(hx + 30, cy + 42, sub, 11, INK, "head", "start", 500, 0)
    b += callout(1, x0 + 10, y0 + 112)
    b += callout(2, x0 + 10, y0 + 236)
    b += callout(3, x0 + 352, y0 + 22)
    b += callout(4, hx + 206, y0 + 74)
    b += callout(5, hx + 206, y0 + 284)
    return svg(b, "Autonomy tab: Compose a timeline of navigation, manipulation and voice, or use the Hub's assistant, automations and skills")


def settings_art(extra=None):
    b = ""
    cards = [("STATUS", "Battery · torque · latency", GREEN), ("ROBOTS", "Find on Wi-Fi · Bluetooth · relay", BLUE),
             ("SECURITY", "Access code to drive the real robot", RUST), ("SPEED LIMITS", "Caps for base · lift · arms", HI),
             ("DATA COLLECTION", "Record sessions as episodes", YEL), ("ASSISTANT", "Your own API key, on device", INK)]
    if extra:
        cards.insert(3, extra)
        cards = cards[:6]
    for i, (t, sub, col) in enumerate(cards):
        cx, cy = 30 + (i % 2) * 296, 40 + (i // 2) * 112
        b += rect(cx, cy, 280, 96, 12, PANEL, INK, 3)
        b += rect(cx, cy, 10, 96, 5, col, None, 0)
        b += text(cx + 24, cy + 32, t, 11, INK, "mono", "start", 700, 0.1)
        b += text(cx + 24, cy + 58, sub, 14, INK, "head", "start", 500, 0)
        if t in ("SPEED LIMITS",):
            b += line(cx + 24, cy + 76, cx + 250, cy + 76, ASH, 3) + circ(cx + 160, cy + 76, 7, HI, INK, 2)
        if t == "SECURITY":
            b += text(cx + 24, cy + 82, "● ● ● ● ● ●", 11, INK, "mono")
        if t == "STATUS":
            b += pill(cx + 24, cy + 70, 56, 16, "LIVE", GREEN, "#FFF9F0", 7.5)
    for n, (x, y) in enumerate([(300, 50), (596, 50), (300, 162), (596, 162), (300, 274)], 1):
        b += callout(n, x, y)
    return svg(b, "Settings tab: status, robots, security, speed limits, data collection and the assistant")


# ── Vision Pro ──────────────────────────────────────────────────────────────
def vp_room(b=""):
    b += rect(0, 0, W, H, 0, "#D9CFB8", None, 0)
    b += path(f"M0 270 L{W} 270 L{W} {H} L0 {H} Z", "#BFAF92", None, 0)
    b += line(0, 270, W, 270, "rgba(21,24,32,.25)", 2)
    return b


def glass_window(x, y, w, h, r=22):
    return rect(x, y, w, h, r, "rgba(253,246,226,.9)", INK, 2.5)


def vp_robot():
    b = vp_room()
    x, y, w, h = 110, 70, 420, 250
    b += glass_window(x, y, w, h)
    # the 3-D stage protrudes: a floor disc + robot breaking the window line
    b += f'<ellipse cx="{x+w/2}" cy="{y+h-28}" rx="150" ry="26" {st("rgba(35,87,126,.18)", BLUE, 2)}/>'
    b += robot(x + w / 2, y + h - 22, 1.35, "out")
    # top bar
    s1, w1 = seg(x + w / 2 - 70, y + 12, ["DRIVE", "JOINT", "TASK"], 0, 20, 8, 46)
    b += s1
    b += pill(x + w / 2 - 54, y + 38, 108, 20, "▶ START TELEOP", HI, "#FFF9F0", 8)
    b += pill(x + 14, y + 12, 50, 20, "3D", BONE, INK, 8)
    b += pill(x + w - 74, y + 12, 60, 20, "STIFF", BONE, INK, 8)
    # leading ornament: nav rail
    b += rect(x - 52, y + 40, 40, 132, 20, GLASS, INK, 2)
    for i, ic in enumerate(["robot", "brain", "gear"]):
        cy = y + 64 + i * 42
        if i == 0:
            b += circ(x - 32, cy, 15, HI, None, 0)
        b += icon(ic, x - 32, cy, "#FFF9F0" if i == 0 else INK)
    # trailing ornament: Cams · Joints · Trends
    b += rect(x + w + 12, y + 40, 46, 120, 20, GLASS, INK, 2)
    for i, lab in enumerate(["CAMS", "JNTS", "TRND"]):
        b += text(x + w + 35, y + 72 + i * 36, lab, 8, INK, "mono", "middle", 700)
    # bottom ornament: drive pad
    b += rect(x + w / 2 - 110, y + h + 12, 220, 52, 24, GLASS, INK, 2)
    b += circ(x + w / 2 - 70, y + h + 38, 18, BONE, INK, 2) + circ(x + w / 2 - 64, y + h + 33, 7, HI, INK, 1.5)
    b += rect(x + w / 2 - 6, y + h + 20, 12, 36, 6, BONE, INK, 2)
    b += rect(x + w / 2 + 34, y + h + 30, 70, 16, 8, BONE, INK, 2) + circ(x + w / 2 + 74, y + h + 38, 8, HI, INK, 1.5)
    b += callout(1, x - 32, y + 26)
    b += callout(2, x + w / 2 + 84, y + 22)
    b += callout(3, x + w / 2 + 66, y + 48)
    b += callout(4, x + w + 35, y + 26)
    b += callout(5, x + w / 2 + 124, y + h + 38)
    return svg(b, "Vision Pro Robot tab: a glass window whose 3D stage protrudes into the room, with rails and a drive pad as ornaments")


def vp_immersive():
    b = rect(0, 0, W, H, 0, "#20252F", None, 0)
    # the robot's world wraps around: stereo head view as the room
    b += rect(0, 210, W, 190, 0, "#6E6352", None, 0)
    b += rect(80, 70, 150, 140, 4, "#3C4454", INK, 1.5)
    b += rect(390, 90, 170, 120, 4, "#D8D1C2", INK, 1.5)
    # the operator's hands (outlines) driving the robot's hands
    for sgn, hx in ((-1, 150), (1, 490)):
        b += path(f"M{hx} 380 C{hx+sgn*-10} 330 {hx+sgn*-6} 300 {hx} 286 l{sgn*10} -30 l{sgn*6} 2 l{-sgn*4} 32 "
                  f"l{sgn*14} -36 l{sgn*7} 3 l{-sgn*8} 38 l{sgn*14} -30 l{sgn*6} 4 l{-sgn*12} 40 l{sgn*16} -14 l{sgn*4} 6 "
                  f"C{hx+sgn*60} 330 {hx+sgn*50} 370 {hx+sgn*40} 380 Z", "rgba(253,246,226,.18)", BONE, 2, "stroke-dasharray:6 4;")
    # head-locked stereo window + wrist cams + deck
    b += rect(170, 40, 300, 168, 14, "rgba(21,24,32,.35)", POP, 3)
    b += text(320, 32, "HEAD-LOCKED STEREO", 10, POP, "mono", "middle", 700, 0.1)
    for i, lab in enumerate(["L WRIST", "R WRIST"]):
        x = 40 + i * 470
        b += rect(x, 70, 120, 80, 10, "#5B6475", BONE, 2)
        b += text(x + 8, 142, lab, 8, BONE, "mono", "start", 700)
    b += rect(200, 222, 240, 46, 22, GLASS, INK, 2)
    b += pill(212, 234, 70, 22, "■ STOP", RUST, "#FFF9F0", 8, stroke=RUST)
    b += pill(290, 234, 66, 22, "WHOLE", HI, "#FFF9F0", 8)
    b += pill(364, 234, 66, 22, "NECK", BONE, INK, 8)
    b += text(320, 316, "YOUR HANDS ARE ITS HANDS", 18, POP, "comic", "middle", 400, 0.06)
    b += text(320, 338, "pinch to grip · look to aim the neck", 10, BONE, "mono", "middle")
    b += callout(1, 470, 48)
    b += callout(2, 164, 78)
    b += callout(3, 446, 245)
    b += callout(4, 536, 300)
    return svg(b, "Vision Pro full immersion: a head-locked stereo window, both wrist cameras, a control deck, and your hands driving the robot's")


def vp_windows():
    b = vp_room()
    wins = [(40, 50, 230, 140, "CAMERA", "cam"), (300, 40, 300, 120, "JOINT BARS", "bars"),
            (60, 210, 220, 130, "TRENDS", "trend"), (320, 190, 260, 160, "2D MAP", "map")]
    for i, (x, y, w, h, t, kind) in enumerate(wins):
        b += glass_window(x, y, w, h, 16)
        b += text(x + 14, y + 22, t, 9, INK, "mono", "start", 700, 0.1)
        if kind == "cam":
            b += rect(x + 14, y + 32, w - 28, h - 46, 6, "#5B6475", INK, 1.5)
            b += robot(x + w / 2, y + h - 18, 0.5, "out", eyes=False)
        elif kind == "bars":
            for j in range(14):
                hh = 16 + (j * 37) % 60
                b += rect(x + 16 + j * 19.5, y + h - 14 - hh, 12, hh, 2, [HI, BLUE, GREEN][j % 3], INK, 1.2)
        elif kind == "trend":
            for k, col in enumerate([HI, BLUE]):
                pts = " ".join(f"{x+16+j*12:.0f},{y+80+math.sin(j*0.7+k)*22-k*10:.0f}" for j in range(17))
                b += f'<polyline points="{pts}" {st("none", col, 2.5)}/>'
        else:
            b += rect(x + 14, y + 32, w - 28, h - 46, 6, BONE, INK, 1.5)
            b += path(f"M{x+30} {y+60} h70 v40 h60 v-30 h70", "none", INK, 4)
            b += path(f"M{x+60} {y+130} Q{x+130} {y+90} {x+200} {y+110}", "none", GREEN, 2.5, "stroke-dasharray:5 4;")
            b += circ(x + 200, y + 110, 6, GREEN, INK, 2)
        b += callout(i + 1, x + w - 6, y + 6)
    return svg(b, "Vision Pro extra windows: cameras, joint bars, trends and a 2D map, each its own floating window")


# ── Control Studio (web) ───────────────────────────────────────────────────
def browser(x=14, y=14, w=612, h=372):
    b = rect(x, y, w, h, 12, PANEL, INK, 3)
    b += line(x, y + 26, x + w, y + 26, INK, 2)
    for i, c in enumerate([RUST, YEL, GREEN]):
        b += circ(x + 16 + i * 14, y + 13, 4.5, c, INK, 1.2)
    b += rect(x + 70, y + 6, 220, 14, 7, BONE, INK, 1.2)
    b += text(x + 80, y + 16.5, "Control Studio", 8, ASH, "mono")
    return b, (x, y + 26, w, h - 26)


def studio_topbar(x, y, w):
    b = rect(x, y, w, 26, 0, INK, None, 0)
    b += text(x + 10, y + 17, "MABEL", 11, POP, "comic", "start", 400, 0.06)
    b += pill(x + 62, y + 6, 32, 14, "SIM", BLUE, "#FFF9F0", 7, stroke=BLUE)
    b += pill(x + w / 2 - 80, y + 5, 74, 16, "⚡ TORQUE ON", POP, INK, 7, stroke=POP)
    b += pill(x + w / 2, y + 5, 40, 16, "⌂", "transparent", BONE, 8, stroke=BONE, sw=1.2)
    b += pill(x + w / 2 + 46, y + 5, 64, 16, "STIFF|SOFT", "transparent", BONE, 7, stroke=BONE, sw=1.2)
    b += pill(x + w - 140, y + 5, 48, 16, "● REC", RUST, "#FFF9F0", 7, stroke=RUST)
    b += pill(x + w - 86, y + 5, 60, 16, "+ WINDOW", "transparent", BONE, 7, stroke=BONE, sw=1.2)
    b += circ(x + w - 14, y + 13, 4, GREEN, None, 0)
    return b


def studio_workspace(focus):
    b, (x, y, w, h) = browser()
    b += studio_topbar(x, y, w)
    y2 = y + 26
    # left panel
    lw = 84
    b += rect(x, y2, lw, h - 26 - 86, 0, BONE, INK, 1.5)
    b += text(x + 8, y2 + 16, "NETWORK", 8, RUST, "mono", "start", 700, 0.1)
    for i in range(5):
        b += line(x + 8, y2 + 30 + i * 14, x + lw - 10 - (i * 9) % 30, y2 + 30 + i * 14, ASH, 3)
    # right dock
    rw = 120
    rx = x + w - rw
    b += rect(rx, y2, rw, h - 26 - 86, 0, BONE, INK, 1.5)
    for i, lab in enumerate(["STATUS", "DATA", "SKILLS"]):
        on = (focus == "dock" and i == 0) or (focus != "dock" and i == 0)
        b += rect(rx + 4 + i * 38, y2 + 5, 36, 16, 4, HI if on else PANEL, INK, 1.2)
        b += text(rx + 22 + i * 38, y2 + 16, lab, 6.5, "#FFF9F0" if on else INK, "mono", "middle", 700)
    for i in range(8):
        b += text(rx + 8, y2 + 38 + i * 14, ["arm_l1", "arm_l2", "arm_l3", "arm_r1", "neck_y", "lift", "torso", "base_v"][i], 7, INK)
        b += rect(rx + 52, y2 + 31 + i * 14, 60, 7, 3, PANEL, INK, 1)
        b += rect(rx + 52, y2 + 31 + i * 14, 12 + (i * 17) % 46, 7, 3, [HI, BLUE, GREEN][i % 3], None, 0)
    # viewer
    vx, vw, vh = x + lw, w - lw - rw, h - 26 - 86
    b += rect(vx, y2, vw, vh, 0, SCENE, None, 0)
    b += floor_grid(vx, y2, vw, vh, y2 + vh * 0.45, n=10)
    b += robot(vx + vw / 2, y2 + vh * 0.86, 0.95, "out")
    s1, sw1 = seg(vx + vw / 2 - 96, y2 + 8, ["DRIVE", "TASK", "JOINT"], {"drive": 0, "task": 1}.get(focus, 0), 18, 7, 40, dark=True)
    b += s1
    s2, _ = seg(vx + vw / 2 + 32, y2 + 8, ["3RD", "1ST"], 0, 18, 7, 30, dark=True)
    b += s2
    for i in range(6):
        b += rect(vx + 6, y2 + 34 + i * 20, 16, 16, 4, GLASS, INK, 1.2)
    # camera strip + timeline
    ty = y + h - 86
    b += rect(x, ty, w, 26, 0, INK, None, 0)
    for i in range(5):
        b += rect(x + 8 + i * 70, ty + 4, 62, 18, 3, "#5B6475", BONE, 1)
    tly = ty + 26
    b += rect(x, tly, w, 60, 0, PANEL, INK, 1.5)
    b += pill(x + 8, tly + 6, 50, 14, "+ NAV", BLUE, "#FFF9F0", 6.5, stroke=BLUE)
    b += pill(x + 62, tly + 6, 60, 14, "+ POLICY", HI, "#FFF9F0", 6.5, stroke=HI)
    b += pill(x + 126, tly + 6, 50, 14, "+ POSE", GREEN, "#FFF9F0", 6.5, stroke=GREEN)
    b += pill(x + w - 120, tly + 6, 54, 14, "▶ PREVIEW", BONE, INK, 6.5)
    b += pill(x + w - 62, tly + 6, 54, 14, "⚡ EXECUTE", POP, INK, 6.5, stroke=INK)
    for i, (a, z, col) in enumerate([(0.05, 0.3, BLUE), (0.32, 0.6, HI), (0.62, 0.8, GREEN)]):
        b += rect(x + 8 + a * (w - 16), tly + 28, (z - a) * (w - 16), 22, 4, col, INK, 1.2)
    return b, dict(x=x, y=y, w=w, h=h, y2=y2, lw=lw, rx=rx, rw=rw, vx=vx, vw=vw, vh=vh, ty=ty, tly=tly)


def studio_overview():
    b, g = studio_workspace("drive")
    b += callout(1, g["x"] + g["w"] / 2 - 96, g["y"] + 13)
    b += callout(2, g["x"] + 42, g["y2"] + 70)
    b += callout(3, g["vx"] + g["vw"] / 2, g["y2"] + g["vh"] * 0.4)
    b += callout(4, g["rx"] + 60, g["y2"] + 130)
    b += callout(5, g["x"] + g["w"] / 2, g["tly"] + 40)
    return svg(b, "Control Studio workspace: top bar, network panel, the 3D viewer, the status dock and the timeline")


def studio_drive():
    b, (x, y, w, h) = browser()
    b += studio_topbar(x, y, w)
    y2 = y + 26
    vh = h - 26
    b += rect(x, y2, w, vh, 0, "#5B6475", None, 0)
    b += rect(x, y2 + vh * 0.6, w, vh * 0.4, 0, "#8C7A63", None, 0)
    b += rect(x + 90, y2 + 50, 140, 110, 3, "#3F4757", INK, 1.5)
    b += rect(x + 380, y2 + 70, 120, 90, 3, "#E8E2D4", INK, 1.5)
    s1, _ = seg(x + w / 2 - 96, y2 + 10, ["DRIVE", "TASK", "JOINT"], 0, 20, 7.5, 44, dark=True)
    b += s1
    s2, _ = seg(x + w / 2 + 44, y2 + 10, ["3RD", "1ST"], 1, 20, 7.5, 32, dark=True)
    b += s2
    # 3D PiP
    b += rect(x + w - 150, y2 + 40, 136, 96, 8, SCENE, BONE, 2)
    b += robot(x + w - 82, y2 + 128, 0.55, "out")
    b += stick(x + 80, y2 + vh - 70, 40, "TRANSLATE")
    b += stick(x + w - 80, y2 + vh - 70, 40, "ROTATE · LIFT", knob=(-0.3, -0.35))
    b += rect(x + w / 2 - 110, y2 + vh - 34, 220, 22, 11, "rgba(21,24,32,.6)", BONE, 1.5)
    b += text(x + w / 2, y2 + vh - 19, "WASD drive · QE turn · RF lift", 9, BONE, "mono", "middle", 700)
    b += callout(1, x + 80 - 48, y2 + vh - 118)
    b += callout(2, x + w - 30, y2 + vh - 118)
    b += callout(3, x + w / 2 + 120, y2 + vh - 23)
    b += callout(4, x + w - 156, y2 + 40)
    b += callout(5, x + w / 2 + 124, y2 + 20)
    return svg(b, "Control Studio Drive: first-person head camera with a 3D picture-in-picture, two sticks and keyboard driving")


def studio_task():
    b, g = studio_workspace("task")
    vx, vw, vh, y2 = g["vx"], g["vw"], g["vh"], g["y2"]
    # wrist target + plan
    tx, ty = vx + vw / 2 + 70, y2 + vh * 0.42
    b += circ(tx, ty, 11, "rgba(46,125,79,.85)", INK, 2)
    b += path(f"M{vx+vw/2+30} {y2+vh*0.62} Q{tx-10} {ty+30} {tx-6} {ty+8}", "none", POP, 2.5, "stroke-dasharray:5 4;")
    b += rect(vx + vw / 2 - 90, y2 + vh - 30, 180, 22, 11, GLASS, INK, 1.5)
    b += text(vx + vw / 2 - 80, y2 + vh - 15, "WRIST PLAN", 8, INK, "mono", "start", 700)
    b += pill(vx + vw / 2 + 28, y2 + vh - 27, 56, 16, "EXECUTE", GREEN, "#FFF9F0", 7)
    s3, _ = seg(vx + vw / 2 - 72, y2 + 32, ["ARM", "UPPER", "WHOLE"], 2, 16, 6.5, 48, dark=True)
    b += s3
    b += pill(vx + vw - 104, y2 + 32, 96, 16, "▶ WEBCAM TELEOP", HI, "#FFF9F0", 6.5)
    b += callout(1, tx + 18, ty - 14)
    b += callout(2, vx + vw / 2 + 92, y2 + vh - 19)
    b += callout(3, vx + vw / 2 + 80, y2 + 40)
    b += callout(4, vx + vw - 6, y2 + 50)
    b += callout(5, vx + 14, y2 + 26)
    return svg(b, "Control Studio Task: drag a wrist target, plan and execute; choose arm, upper body or whole body; or teleoperate from a webcam")


def studio_dock():
    b, (x, y, w, h) = browser()
    b += studio_topbar(x, y, w)
    y2 = y + 26
    tabs = [("STATUS", 0), ("DATA", 1), ("SKILLS", 2)]
    for i, (t, _) in enumerate(tabs):
        px = x + 14 + i * 200
        b += rect(px, y2 + 14, 186, h - 26 - 28, 10, BONE, INK, 2)
        b += pill(px + 12, y2 + 24, 70, 18, t, HI, "#FFF9F0", 8)
        if t == "STATUS":
            b += text(px + 12, y2 + 64, "JOINT STATE · 59 DOF", 8, RUST, "mono", "start", 700, 0.08)
            for j in range(10):
                yy = y2 + 76 + j * 20
                b += text(px + 12, yy + 9, ["arm_l1", "arm_l2", "arm_l3", "arm_r1", "arm_r2", "hand_l", "hand_r", "neck", "lift", "torso"][j], 8, INK)
                for k, col in enumerate([HI, BLUE, GREEN]):
                    b += rect(px + 62 + k * 38, yy, 34, 9, 3, PANEL, INK, 1)
                    b += rect(px + 62 + k * 38, yy, 6 + (j * 7 + k * 11) % 28, 9, 3, col, None, 0)
            b += text(px + 62, y2 + 290, "POS   VEL   TORQUE", 7.5, ASH, "mono")
        elif t == "DATA":
            for j in range(5):
                yy = y2 + 64 + j * 46
                b += rect(px + 12, yy, 162, 38, 6, PANEL, INK, 1.5)
                b += rect(px + 18, yy + 6, 40, 26, 3, "#5B6475", INK, 1)
                b += text(px + 66, yy + 17, f"episode {j+1:03d}", 9, INK, "mono", "start", 700)
                b += text(px + 66, yy + 31, ["0:42 · pick", "1:10 · drawer", "0:35 · wipe", "0:58 · place", "1:22 · fridge"][j], 8, ASH, "mono")
        else:
            for j, (s, c) in enumerate([("Pick up", HI), ("Open drawer", BLUE), ("Wipe table", GREEN), ("Go home", INK), ("Collect data", YEL)]):
                yy = y2 + 64 + j * 46
                b += rect(px + 12, yy, 162, 38, 6, PANEL, INK, 1.5)
                b += rect(px + 12, yy, 7, 38, 3, c, None, 0)
                b += text(px + 28, yy + 24, s, 12, INK, "head", "start", 600, 0)
                b += text(px + 160, yy + 24, "▶", 12, HI, "head", "end", 700, 0)
        b += callout(i + 1, px + 176, y2 + 22)
    return svg(b, "Control Studio dock: Status with all 59 joints, Data with recorded episodes, Skills to run")


def studio_windows():
    b, (x, y, w, h) = browser()
    b += studio_topbar(x, y, w)
    y2 = y + 26
    b += rect(x, y2, w, h - 26, 0, SCENE, None, 0)
    b += floor_grid(x, y2, w, h - 26, y2 + 120, n=12)
    b += rect(x + w - 150, y + 30, 128, 116, 8, PANEL, INK, 2)
    for i, lab in enumerate(["MuJoCo viewer", "Camera", "Joint history", "2D map", "TF tree"]):
        b += text(x + w - 140, y + 52 + i * 20, lab, 9, INK, "head", "start", 500, 0)
    wins = [(x + 30, y2 + 30, 200, 130, "MUJOCO"), (x + 250, y2 + 140, 190, 120, "JOINT HISTORY"), (x + 40, y2 + 190, 180, 130, "TF TREE")]
    for i, (wx, wy, ww, wh, t) in enumerate(wins):
        b += rect(wx, wy, ww, wh, 8, PANEL, INK, 2)
        b += rect(wx, wy, ww, 18, 8, INK, None, 0)
        b += text(wx + 8, wy + 13, t, 8, BONE, "mono", "start", 700, 0.1)
        if t == "MUJOCO":
            b += rect(wx + 6, wy + 24, ww - 12, wh - 30, 4, "#4A5468", None, 0)
            b += robot(wx + ww / 2, wy + wh - 10, 0.7, "out")
        elif t == "JOINT HISTORY":
            for k, col in enumerate([HI, BLUE, GREEN]):
                pts = " ".join(f"{wx+10+j*10:.0f},{wy+70+math.sin(j*0.5+k*1.3)*24:.0f}" for j in range(18))
                b += f'<polyline points="{pts}" {st("none", col, 2)}/>'
        else:
            nodes = [(wx + 90, wy + 36), (wx + 50, wy + 70), (wx + 130, wy + 70), (wx + 30, wy + 104), (wx + 70, wy + 104), (wx + 150, wy + 104)]
            for a, c in [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5)]:
                b += line(*nodes[a], *nodes[c], INK, 1.5)
            for nx, ny in nodes:
                b += circ(nx, ny, 7, YEL, INK, 1.5)
    b += callout(1, x + w - 28, y + 8 + 26)
    b += callout(2, x + 224, y2 + 34)
    b += callout(3, x + 434, y2 + 144)
    b += callout(4, x + 214, y2 + 194)
    return svg(b, "Control Studio windows: open a MuJoCo viewer, cameras, joint history, a 2D map or the TF tree as floating windows")


FIGS = {
    "ios-robot": ios_robot, "ios-drive": ios_drive, "ios-jointtask": ios_joint_task, "ios-console": ios_console,
    "ios-autonomy": lambda: autonomy_art("ios"), "ios-settings": lambda: settings_art(),
    "vp-robot": vp_robot, "vp-immersive": vp_immersive, "vp-windows": vp_windows,
    "vp-autonomy": lambda: autonomy_art("vp", "vp"),
    "vp-settings": lambda: settings_art(("CALIBRATION", "Your arm length and shoulders, per pilot", GREEN)),
    "studio-overview": studio_overview, "studio-drive": studio_drive, "studio-task": studio_task,
    "studio-dock": studio_dock, "studio-windows": studio_windows,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        if old.endswith(".svg"):
            os.remove(os.path.join(OUT, old))
    total = 0
    for name, fn in FIGS.items():
        s = fn()
        with open(os.path.join(OUT, name + ".svg"), "w") as f:
            f.write(s)
        total += len(s)
    print(f"wrote {len(FIGS)} figures to assets/apptabs/ ({total/1024:.0f} kB)")


if __name__ == "__main__":
    main()
