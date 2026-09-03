"""The platform-accuracy measurements, exported for the website.

The paper's Fig. 12 answers two questions from two archives: where does the
fingertip actually land when you ask for the same pose again (repeatability,
ISO 9283), and how well does it follow a commanded path (path following). This
reads BOTH archives through the experiments' own analysis code — never a number
retyped — and writes what the page needs to draw them in the site's style.

    python3 scripts/build_accuracy.py

Reads:  experiments/repeatability/data/   (real robot, ISO 9283 schedule)
        experiments/path_following/data/  (sim, four controller conditions)
Writes: assets/data/accuracy.json

WHY EXPORT RATHER THAN EMBED THE PDF. The paper's figure is drawn at 3.1 in
wide with 5.5 pt type — legible in a printed column and illegible on a phone.
The measurements are the part worth keeping; the drawing is not. Redrawing them
in the browser also lets a reader switch stations and conditions, which the
static figure has to spend six panels on.
"""
import gzip
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
ROOT = os.path.dirname(SITE)
EXP = os.path.join(ROOT, "experiments")
OUT = os.path.join(SITE, "assets", "data", "accuracy.json")

sys.path.insert(0, EXP)
from common import runio                                       # noqa: E402

REP = os.path.join(EXP, "repeatability")
PF = os.path.join(EXP, "path_following")

HANDS = ["right_index_tip", "left_index_tip"]
# The frontal plane (lateral y, height z) — the same choice repeatability/analyze.py
# makes, and for the same reason: dx is the SMALLEST component of the deviation at
# every pose, so a top view plots the two axes that matter least.
PLANE = (1, 2)

PF_CONDS = [("pd", "PD only", "The joint controller alone."),
            ("gff", "+ gravity FF", "Feed the arm's own weight forward."),
            ("gff_stiff", "+ servo stiffness", "Identify what the servos give up."),
            ("gff_fric_stiff", "+ friction FF", "And what they lose to friction.")]


def _load_analyze():
    """Import repeatability/analyze.py under a private name.

    Both experiments ship a module called `analyze`, so a plain import binds
    whichever wins sys.path for BOTH — quietly mixing two experiments' code.
    """
    import importlib.util
    path = os.path.join(REP, "analyze.py")
    spec = importlib.util.spec_from_file_location("_rep_analyze", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_rep_analyze"] = mod
    spec.loader.exec_module(mod)
    return mod


def repeatability(RA, cond="real"):
    trials = [d for d in runio.load_all(os.path.join(REP, "data"))
              if d["meta"]["condition"] == cond]
    if not trials:
        raise SystemExit(f"no repeatability trials tagged {cond!r}")
    summary = RA.summarize(trials)
    pts, _ = RA.collect(trials)

    stations = ["home"] + sorted(n for n in summary["stations"] if n != "home")
    out = []
    for s in stations:
        rec = {"name": s, "hands": {}}
        for h in HANDS:
            P = np.asarray(pts[s][h], float)              # [n,3] metres
            c = P.mean(axis=0)
            d = (P - c) * 1e3                            # mm about the centroid
            st = summary["stations"][s][h]
            rec["hands"][h] = {
                "n": int(len(P)),
                "pts": [[round(float(v[PLANE[0]]), 2),
                         round(float(v[PLANE[1]]), 2)] for v in d],
                "RP_mm": round(float(st["RP_m"]) * 1e3, 2),
                "Rmax_mm": round(float(st["Rmax_m"]) * 1e3, 2),
            }
        out.append(rec)
    return out, len(trials)


def _traced_err(d, side="right"):
    """|error| over the traverse phase, aligned by the stamped reference index.

    Not resampled on time: that would absorb the lag this experiment exists to
    measure into an interpolation.
    """
    ts = d["timeseries"]
    ph = np.asarray(ts["phase"])
    k = np.asarray(ts["k_ref"])
    sel = (ph == "traverse") & (k >= 0)
    Pm = np.asarray(ts[f"p_{side}_index_tip"], float)[sel]
    Pr = np.asarray(d["meta"]["reference"]["p_ref"][side], float)[k[sel]]
    return np.linalg.norm(Pm - Pr, axis=1)


def path_following(paths=("circle", "helix", "square")):
    archive = runio.load_all(os.path.join(PF, "data"))
    out = {}
    for path in paths:
        curves = []
        for tag, label, why in PF_CONDS:
            # matched on cond_tag and path SEPARATELY: the tags are substrings of
            # one another (gff ⊂ gff_stiff ⊂ gff_fric_stiff), so any `in` match
            # silently pools four different conditions into one curve
            ds = [d for d in archive if d["meta"].get("cond_tag") == tag
                  and d["meta"].get("path") == path]
            if not ds:
                continue
            E = [_traced_err(d, "right") for d in ds]
            n = min(len(x) for x in E)
            E = np.array([x[:n] for x in E]) * 1e3
            # downsample to ~120 points: the curve is smooth and the browser does
            # not need 4000 of them per condition
            idx = np.linspace(0, n - 1, min(n, 120)).astype(int)
            m = E.mean(axis=0)
            s = E.std(axis=0, ddof=1) if len(E) > 1 else np.zeros_like(m)
            curves.append({
                "tag": tag, "label": label, "why": why, "trials": len(ds),
                "mean_mm": round(float(m.mean()), 1),
                "rms_mm": round(float(np.sqrt((m ** 2).mean())), 1),
                "p95_mm": round(float(np.percentile(E, 95)), 1),
                "x": [round(float(v), 4) for v in np.linspace(0, 2, n)[idx]],
                "mean": [round(float(v), 2) for v in m[idx]],
                "lo": [round(float(v), 2) for v in np.maximum(m - s, 1e-2)[idx]],
                "hi": [round(float(v), 2) for v in (m + s)[idx]],
            })
        if curves:
            out[path] = curves
    return out


def main():
    RA = _load_analyze()
    stations, n_trials = repeatability(RA)
    paths = path_following()

    home = [s for s in stations if s["name"] == "home"][0]
    doc = {
        "generated_by": "website/scripts/build_accuracy.py",
        "source": ("experiments/repeatability/data (real robot, ISO 9283) and "
                   "experiments/path_following/data (simulated, four controller "
                   "conditions) — the same archives behind the paper's Fig. 12"),
        "lift_m": 0.20,
        "plane": "frontal (lateral, height) — dx is the smallest deviation at "
                 "every pose, so a top view would plot the two axes that matter least",
        "rep_trials": n_trials,
        "stations": stations,
        "paths": paths,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"))

    kb = os.path.getsize(OUT) / 1024
    print(f"wrote {os.path.relpath(OUT, SITE)}  {kb:.0f} kB")
    print(f"   repeatability: {n_trials} trials, {len(stations)} stations")
    for s in stations:
        r = s["hands"]["right_index_tip"]
        print(f"      {s['name']:10s} n={r['n']:3d}  RP {r['RP_mm']:6.1f} mm  "
              f"Rmax {r['Rmax_mm']:6.1f} mm")
    for path, cs in paths.items():
        first, last = cs[0], cs[-1]
        print(f"   {path:8s} {first['label']} {first['rms_mm']:.0f} mm  →  "
              f"{last['label']} {last['rms_mm']:.1f} mm   "
              f"({first['rms_mm'] / max(last['rms_mm'], 1e-9):.0f}× better)")


if __name__ == "__main__":
    main()
