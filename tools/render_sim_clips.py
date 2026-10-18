#!/usr/bin/env python3
"""
render_sim_clips.py — regenerate website/assets/sim/*.mp4 from the CURRENT model.

Kinematic playback (mj_forward, no physics) of four simple predefined
animations ported from the Control Studio's clip library
(web_gui/control_center/web/js/motions.js) — enough to show the digital twin
is the real model, nothing fancy. Renders offscreen in the open-field scene
and encodes browser-safe H.264 with ffmpeg.

    ~/anaconda3/bin/python3 website/tools/render_sim_clips.py

Re-run after visual MJCF changes (same spirit as the sprite bake).
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile

import mujoco
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCENE = os.path.join(ROOT, "simulation", "mabel_mujoco", "scenes", "mabel_open_field.xml")
OUT = os.path.join(ROOT, "website", "assets", "sim")
W, H, FPS = 640, 480, 30

m = mujoco.MjModel.from_xml_path(SCENE)
d = mujoco.MjData(m)
mujoco.mj_resetDataKeyframe(m, d, 0)          # ALWAYS seed the home keyframe
mujoco.mj_forward(m, d)
Q0 = d.qpos.copy()

jadr = {m.joint(i).name: m.jnt_qposadr[m.joint(i).id] for i in range(m.njnt)}
jrange = {m.joint(i).name: m.jnt_range[m.joint(i).id] for i in range(m.njnt)}
free_j = next(i for i in range(m.njnt)
              if m.jnt_type[m.joint(i).id] == mujoco.mjtJoint.mjJNT_FREE)
FREE = m.jnt_qposadr[free_j]
BASE0 = Q0[FREE:FREE + 3].copy()

def setj(name, val):
    a = jadr.get(name)
    if a is None:
        return
    lo, hi = jrange[name]
    if lo < hi:
        val = min(max(val, lo), hi)
    d.qpos[a] = val

def addj(name, delta):
    a = jadr.get(name)
    if a is not None:
        setj(name, Q0[a] + delta)

def base_pose(x, y, yaw):
    d.qpos[FREE:FREE + 3] = [BASE0[0] + x, BASE0[1] + y, BASE0[2]]
    d.qpos[FREE + 3:FREE + 7] = [math.cos(yaw / 2), 0, 0, math.sin(yaw / 2)]

# ── envelopes ported from motions.js ─────────────────────────────────────────
def smooth(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)

def win(t, t0, t1, ramp):
    return smooth((t - t0) / ramp) * smooth((t1 - t) / ramp)

def osc(t, t0, hz, t1, amp):
    if t < t0 or t > t1:
        return 0.0
    return amp * math.sin(2 * math.pi * hz * (t - t0)) * win(t, t0, t1, 0.4)

# finger joints per side, discovered from the model (curl DoFs only)
def finger_joints(side):
    toks = ("thumb", "index", "middle", "ring", "pinky")
    out = []
    for i in range(m.njnt):
        n = m.joint(i).name
        ln = n.lower()
        if side in ln and any(f in ln for f in toks) and "abd" not in ln:
            out.append(n)
    return sorted(out)

R_FINGERS = finger_joints("right")
L_FINGERS = finger_joints("left")

# ── the four clips ───────────────────────────────────────────────────────────
def clip_swerve(t, dur, cam):
    """nav_* composite: a holonomic circle — translating AND spinning at once."""
    u = t / dur
    yaw = 2 * math.pi * u                      # one full spin
    ang = 2 * math.pi * u                      # one full circle
    R = 0.7
    # the table sits dead ahead at x=-1.03 — keep the whole loop in +x
    base_pose(R * (1 - math.cos(ang)), R * math.sin(ang), yaw)
    for n in jadr:
        if "Drive" in n or "drive" in n:
            addj(n, 18.0 * t)                  # wheels roll
    cam.lookat[:] = [d.qpos[FREE], d.qpos[FREE + 1], 0.7]
    cam.azimuth, cam.elevation, cam.distance = 135 + 8 * math.sin(2 * math.pi * u), -18, 3.4

def clip_wave(t, dur, cam):
    """motions.js `wave` — right arm up beside the head, elbow carries the wave."""
    up = win(t, 0.1, dur - 0.1, 1.3)
    wig = osc(t, 0.95, 1.2, dur - 1.0, 0.35)
    addj("Right Arm 1", 1.6 * up)              # upper arm up and out
    addj("Right Arm 2", -0.45 * up)
    addj("Right Arm 4", (-0.85 + wig) * up)    # elbow carries the wave
    addj("Right Arm 7", 0.5 * wig * up)
    addj("Torso", -0.05 * up)
    cam.lookat[:] = [BASE0[0], BASE0[1], 0.95]
    cam.azimuth, cam.elevation, cam.distance = 160, -12, 2.6

def clip_lift(t, dur, cam):
    """lift_up + lift_down: full 0.635 m travel and back."""
    u = win(t, 0.2, dur - 0.2, 1.6)
    setj("Lift Lower", 0.02 + 0.29 * u)
    setj("Lift Upper", 0.02 + 0.29 * u)
    cam.lookat[:] = [BASE0[0], BASE0[1], 0.75 + 0.25 * u]
    cam.azimuth, cam.elevation, cam.distance = 115, -10, 3.1

def clip_hands(t, dur, cam):
    """per-finger curl wave on the right ORCA hand, camera in close."""
    for k, n in enumerate(R_FINGERS):
        a = jadr[n]
        lo, hi = jrange[n]
        amp = (hi - lo) if lo < hi else 1.2
        u = 0.5 + 0.5 * math.sin(2 * math.pi * 0.45 * t + 0.6 * k)
        setj(n, Q0[a] + 0.55 * amp * u * win(t, 0.1, dur - 0.1, 0.8))
    addj("Right Arm 1", 1.2)                   # bring the hand up into frame
    addj("Right Arm 4", -1.1)
    # find the right palm body to aim at
    try:
        bid = next(i for i in range(m.nbody) if "right" in m.body(i).name.lower()
                   and "palm" in m.body(i).name.lower())
    except StopIteration:
        bid = next(i for i in range(m.nbody) if "right_hand" in m.body(i).name.lower())
    mujoco.mj_forward(m, d)
    cam.lookat[:] = d.xpos[bid]
    cam.azimuth, cam.elevation, cam.distance = 150 + 10 * math.sin(0.8 * t), -14, 0.55

CLIPS = [("swerve", 6.0, clip_swerve), ("wave", 5.0, clip_wave),
         ("lift", 6.0, clip_lift), ("hands", 6.0, clip_hands)]

def main():
    os.makedirs(OUT, exist_ok=True)
    r = mujoco.Renderer(m, height=H, width=W)
    cam = mujoco.MjvCamera()
    opt = mujoco.MjvOption()                    # hide lidar ray visualization
    opt.flags[mujoco.mjtVisFlag.mjVIS_RANGEFINDER] = False
    for name, dur, fn in CLIPS:
        tmp = tempfile.mkdtemp(prefix=f"clip_{name}_")
        n = int(dur * FPS)
        for f in range(n):
            t = f / FPS
            d.qpos[:] = Q0
            fn(t, dur, cam)
            mujoco.mj_forward(m, d)
            r.update_scene(d, camera=cam, scene_option=opt)
            img = r.render()
            import imageio.v2 as imageio
            imageio.imwrite(os.path.join(tmp, f"f{f:04d}.png"), img)
        dst = os.path.join(OUT, f"{name}.mp4")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(FPS),
                        "-i", os.path.join(tmp, "f%04d.png"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24",
                        "-movflags", "+faststart", dst], check=True)
        shutil.rmtree(tmp)
        print(f"{name}.mp4  {os.path.getsize(dst) // 1024} KB  ({n} frames)")

if __name__ == "__main__":
    main()
