"""The accuracy experiments, as clips — the robot actually doing them.

The panels on hardware.html plot where the fingertip landed and how well it
followed a path. Both are true and neither shows the robot moving, so a reader
has no idea what "the ISO 9283 schedule" or "the circle path" physically IS.

These are REPLAYS, not re-runs. Each frame sets qpos from the archived joint
trajectory — the same rows the metrics were computed from — and renders it. So
the clip and the scatter beside it are the same trial, and there is no second
simulation that could disagree with the first.

    python3 scripts/render_accuracy_clips.py

Reads:  experiments/repeatability/data/, experiments/path_following/data/
Writes: assets/accuracy/{stations,path}.mp4 + .jpg, and index.json
"""
import json
import os
import sys
import tempfile

import numpy as np
import mujoco
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
ROOT = os.path.dirname(SITE)
EXP = os.path.join(ROOT, "experiments")
SIM = os.path.join(ROOT, "simulation", "mabel_mujoco")
OUT = os.path.join(SITE, "assets", "accuracy")
sys.path.insert(0, EXP)
sys.path.insert(0, os.path.join(SIM, "scripts", "tools"))

from common import runio                                        # noqa: E402
import render_task_clips as H                                   # noqa: E402

MODEL = os.path.join(SIM, "models", "mabel_full.xml")
W, HP = 640, 440
FPS = 25
SECS = 7.0

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:                                              # pragma: no cover
    FFMPEG = "ffmpeg"


def open_model():
    m = mujoco.MjModel.from_xml_path(MODEL)
    # mabel_full.xml has a freejoint and NO FLOOR: anything that STEPS it
    # free-falls. Nothing here steps — every frame is a qpos assignment and an
    # mj_forward — but gravity off keeps that true if someone adds a step.
    m.opt.gravity[:] = 0.0
    m.vis.global_.offwidth = max(W, int(m.vis.global_.offwidth))
    m.vis.global_.offheight = max(HP, int(m.vis.global_.offheight))
    H.hide_markers(m)
    # mabel_full.xml is lit for physics work, not for recording: at this
    # framing the upper body sits in near-darkness and the clip reads as a
    # silhouette. Lifting the headlight touches no dynamics — and nothing here
    # has dynamics anyway.
    m.vis.headlight.ambient[:] = [0.58, 0.58, 0.60]
    m.vis.headlight.diffuse[:] = [0.70, 0.70, 0.70]
    m.vis.headlight.specular[:] = [0.10, 0.10, 0.10]
    return m


def qpos_track(model, d):
    """The archived joint rows, mapped onto this model's qpos addresses.

    The archive stores `joints` (names) and `q` (rows). Matching by NAME rather
    than by index is the point: a model whose joint order changed would
    otherwise replay a trajectory limb-by-limb onto the wrong limbs and look
    like a plausible, wrong robot.
    """
    names = d["timeseries"]["joints"]
    q = np.asarray(d["timeseries"]["q"], float)
    adr, col = [], []
    for i, n in enumerate(names):
        try:
            j = model.joint(n)
        except Exception:
            continue
        adr.append(int(model.jnt_qposadr[j.id]))
        col.append(i)
    return np.array(adr), np.array(col), q


def marker(scn, pos, rgba, size=0.012):
    if scn.ngeom >= scn.maxgeom:
        return
    g = scn.geoms[scn.ngeom]
    mujoco.mjv_initGeom(g, mujoco.mjtGeom.mjGEOM_SPHERE,
                        np.array([size] * 3), np.asarray(pos, float),
                        np.eye(3).flatten(), np.asarray(rgba, np.float32))
    scn.ngeom += 1


def render(name, d, tip_body, trail_rgba, title, every=None):
    """`tip_body` is `right_index_ip` — the last INDEX PHALANX body. There is
    no `*_index_tip` body in the MJCF (the fingertip is a site on it), and
    asking for one by that name is how this failed the first time."""
    model = open_model()
    data = mujoco.MjData(model)
    adr, col, q = qpos_track(model, d)
    n = len(q)
    frames_wanted = int(SECS * FPS)
    every = every or max(1, n // frames_wanted)
    idx = list(range(0, n, every))[:frames_wanted]
    print(f"  {name}: {len(adr)}/{len(d['timeseries']['joints'])} joints matched, "
          f"{n} rows -> {len(idx)} frames")
    if len(adr) < 10:
        print("   *** too few joints matched — refusing to render a robot "
              "that is not the one that was measured")
        return None

    # FRAME THE WHOLE SWEPT VOLUME, not the first pose. Aiming at frame 0 puts
    # the robot wherever it happened to start and lets the rest of the motion
    # wander out of shot — the one thing a clip of a MOTION must not do. The
    # bounds of the fingertip over the whole replay are cheap (one forward pass
    # per sample) and are exactly what has to stay in view.
    pts = []
    for r in range(0, n, max(1, n // 60)):
        data.qpos[adr] = q[r, col]
        mujoco.mj_forward(model, data)
        pts.append(data.body(tip_body).xpos.copy())
    pts = np.array(pts)
    data.qpos[adr] = q[0, col]
    mujoco.mj_forward(model, data)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    # AIM BETWEEN THE ROBOT AND THE WORK, not at the work. Centring on the
    # fingertip sweep alone put the robot off to one side of every frame,
    # because the sweep is out in front of it by most of an arm's length.
    chas = data.body("mabel_chassis").xpos.copy()
    sweep = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2,
                      (lo[2] + hi[2]) / 2])
    centre = np.array([(chas[0] + sweep[0]) / 2, (chas[1] + sweep[1]) / 2,
                       max(0.95, sweep[2])])
    reach = float(np.linalg.norm(hi - lo))
    print(f"     fingertip sweeps {reach:.2f} m")

    ren = mujoco.Renderer(model, height=HP, width=W, max_geom=8000)
    cam = mujoco.MjvCamera(); mujoco.mjv_defaultCamera(cam)
    cam.lookat[:] = centre
    cam.distance = max(1.35, min(2.1, reach * 1.9 + 0.9))
    # AZIMUTH 16, NOT 196 — the robot was showing its back. MuJoCo puts the
    # eye at lookat − d·(cos az, sin az, sin el) and looks along that vector,
    # and MABEL's forward is −X, so the camera sees the FRONT only when
    # cos(az) > 0. At 196 it sat behind the robot looking at the back of its
    # head; 16 is the same three-quarter view from the other side.
    cam.azimuth, cam.elevation = 16, -8
    opt = H.clean_option()

    tmp = tempfile.mkdtemp(prefix=f"acc_{name}_")
    trail = []
    for k, r in enumerate(idx):
        data.qpos[adr] = q[r, col]
        mujoco.mj_forward(model, data)
        trail.append(data.body(tip_body).xpos.copy())
        ren.update_scene(data, camera=cam, scene_option=opt)
        # THE TRAIL IS THE POINT. Without it this is a robot waving; with it,
        # the shape the experiment measures is drawn in the air as it is made.
        for j, p in enumerate(trail[-160:]):
            f = (j + 1) / min(len(trail), 160)
            marker(ren.scene, p,
                   list(trail_rgba[:3]) + [0.18 + 0.7 * f],
                   0.006 + 0.004 * f)
        Image.fromarray(ren.render()).save(os.path.join(tmp, f"f_{k:04d}.png"))
    ren.close()

    os.makedirs(OUT, exist_ok=True)
    mp4 = os.path.join(OUT, name + ".mp4")
    os.system(f'"{FFMPEG}" -y -loglevel error -framerate {FPS} '
              f'-i "{tmp}/f_%04d.png" -c:v libx264 -preset slow -crf 28 '
              f'-pix_fmt yuv420p -movflags +faststart "{mp4}"')
    os.system(f'"{FFMPEG}" -y -loglevel error -i "{mp4}" -frames:v 1 -q:v 5 '
              f'"{os.path.join(OUT, name)}.jpg"')
    kb = os.path.getsize(mp4) / 1024
    print(f"     {len(idx)} frames, {kb:.0f} kB")
    return {"clip": name + ".mp4", "poster": name + ".jpg",
            "frames": len(idx), "title": title,
            "trial": d["meta"].get("trial"), "rows": n}


def main():
    out = {"generated_by": "website/scripts/render_accuracy_clips.py",
           "note": ("replays of the archived trials the panels are scored "
                    "from — qpos is assigned per frame from the same rows, "
                    "never re-simulated"),
           "clips": {}}

    rep = [d for d in runio.load_all(os.path.join(EXP, "repeatability", "data"))
           if d["meta"]["condition"] == "real"]
    if rep:
        got = render("stations", rep[0], "right_index_ip", (0.90, 0.27, 0.16),
                     "The ISO 9283 schedule, on the real robot")
        if got:
            out["clips"]["stations"] = got

    pf = [d for d in runio.load_all(os.path.join(EXP, "path_following", "data"))
          if d["meta"].get("cond_tag") == "gff_fric_stiff"
          and d["meta"].get("path") == "circle"]
    if pf:
        got = render("path", pf[0], "right_index_ip", (0.18, 0.49, 0.31),
                     "Tracing the circle, on the gains we deploy")
        if got:
            out["clips"]["path"] = got

    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"\n{len(out['clips'])} clips -> {os.path.relpath(OUT, SITE)}")


if __name__ == "__main__":
    main()
