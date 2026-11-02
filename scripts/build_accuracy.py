"""The platform-accuracy measurements, exported for the website.

Two questions, two archives, both from the REAL robot on 2026-10-08 — the runs
behind the submission video's "in our tests" claims (median encoder-referenced
upper-body repeatability 1.65 mm; geometric path error below 7 mm RMS):

  REPEATABILITY (ISO 9283). Both arms and the torso visit 8 table-top stations
  and HOME, 10 cycles. Per station and palm: RP = mean(l) + 3 sd(l), with l the
  distance of each visit from the barycentre; AP = barycentre − commanded palm.

  PATH FOLLOWING. Both palms trace a spiral and a square as mirror images, the
  torso held at 0° or −10°, 3 trials each. Tracking error |p_meas(t) − p_ref(k)|
  (time-aligned, so lag shows) and contour error (distance to the nearest point
  of the reference path — the shape alone).

Both are read through the experiments' OWN code (their analyze.py helpers and
the robot's URDF forward kinematics in experiments/common/body.py) — never a
number retyped — and each visit / sample is also stamped with the time at which
the submission render (marketing/ral_video/tools/render_v16_tests.py) shows it,
so the page can draw the plots in step with the clip.

    python3 scripts/build_accuracy.py [--archive DIR]

Reads:  <archive>/experiments/repeatability/data/real_cycle*.jsonl.gz
        <archive>/experiments/path_following/data/real_*_torso*_t*.jsonl.gz
        <archive>/experiments/path_following/data/reference_real.json
        (the archive is the experiments checkout: $ACCURACY_ARCHIVE or --archive)
Writes: assets/data/accuracy.json

FK on encoders excludes backlash and link bending, so every number here is a
lower bound on the true end-effector error. The page says so.
"""
import argparse
import glob
import importlib.util
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
ROOT = os.path.dirname(SITE)
OUT = os.path.join(SITE, "assets", "data", "accuracy.json")
TAG = "real"
HANDS = ("left", "right")
# The frontal plane (lateral y, height z): what the camera of the render sees,
# and the plane both traced shapes are drawn in.
PLANE = (1, 2)

# ── the submission render's clock (render_v16_tests.py, `repeat_stamp` and
#    `panel`): copied as constants, and checked against the clip's length ──
CLIP_S = 9.2           # both panels, 50 fps
REP_FIRST_S = 5.0      # cycle 0 plays over the first 5 s …
REP_REST_S = 3.5       # … cycles 1–9 over the next 3.5 s, then a 0.7 s hold
PATH_SPLIT_S = 4.6     # spiral (trial 0, torso 0°) then square, 4.6 s each


def _module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def repeatability(EXP, body):
    """Every visit's palm about its station's barycentre, plus the ISO stats."""
    RA = _module(os.path.join(EXP, "repeatability", "analyze.py"), "_rep_analyze")
    rows = RA.load(TAG, os.path.join(EXP, "repeatability", "data"))
    if not rows:
        raise SystemExit("no repeatability rows")
    order = []
    for r in rows:
        if r.get("phase") == "dwell" and r.get("station") not in order:
            order.append(r["station"])
    order.append("HOME")
    t0 = rows[0]["t"]
    cyc0 = [r for r in rows if r.get("cycle") == rows[0].get("cycle")]
    first_end = cyc0[-1]["t"] - t0
    total = rows[-1]["t"] - t0

    def video_t(s):              # source seconds → the render's seconds
        if s <= first_end:
            return s / first_end * REP_FIRST_S
        return REP_FIRST_S + (s - first_end) / (total - first_end) * REP_REST_S

    V = []
    for v in RA.visits(rows):
        t_end = v[-1]["t"]
        w = [r for r in v if r["t"] >= t_end - RA.SAMPLE_S]
        q = {j: float(np.mean([r["jointPositions"][j] for r in w])) for j in RA.M.DRIVEN}
        sp = {j: float(np.mean([r["sp"][j] for r in w])) for j in RA.M.DRIVEN}
        V.append(dict(cycle=int(v[0]["cycle"]), station=v[0]["station"],
                      vt=round(video_t(t_end - t0), 3),
                      palm={s: np.asarray(body.palm(s, q)) for s in HANDS},
                      cmd={s: np.asarray(body.palm(s, sp)) for s in HANDS}))
    stations = []
    for st in order:
        vs = [v for v in V if v["station"] == st]
        rec = {"name": st, "hands": {}}
        for s in HANDS:
            P = np.array([v["palm"][s] for v in vs])
            c, rp, l = RA.iso(P)
            ap = float(np.linalg.norm(c - np.mean([v["cmd"][s] for v in vs], 0)))
            d = (P - c) * 1e3
            rec["hands"][s] = {
                "n": len(vs),
                "RP_mm": round(rp * 1e3, 2), "AP_mm": round(ap * 1e3, 2),
                "mean_mm": round(float(l.mean()) * 1e3, 2), "max_mm": round(float(l.max()) * 1e3, 2),
                # [lateral, height, |l|, cycle, video seconds]
                "pts": [[round(float(p[PLANE[0]]), 3), round(float(p[PLANE[1]]), 3),
                         round(float(li) * 1e3, 3), v["cycle"], v["vt"]]
                        for p, li, v in zip(d, l, vs)],
            }
        stations.append(rec)
    rps = [s["hands"][h]["RP_mm"] for s in stations for h in HANDS]
    return {
        "date": "2026-10-08", "cycles": len({v["cycle"] for v in V}), "visits": len(V),
        "median_RP_mm": round(float(np.median(rps)), 2),
        "best_RP_mm": min(rps), "worst_RP_mm": max(rps),
        "stations": stations,
    }


def path_following(EXP, body):
    PA = _module(os.path.join(EXP, "path_following", "analyze.py"), "_pf_analyze")
    D = os.path.join(EXP, "path_following", "data")
    ref = json.load(open(os.path.join(D, f"reference_{TAG}.json")))
    traces = []
    for f in sorted(glob.glob(os.path.join(D, f"{TAG}_*_torso*_t*.jsonl.gz"))):
        rows = PA.load(f)
        if not rows:
            continue
        h = rows[0]["header"]
        R = ref[h["reference"]]
        tr = [r for r in rows[1:] if r.get("phase") == "trace" and "jointPositions" in r]
        k = np.array([r["k"] for r in tr])
        meas = {s: np.array([body.palm(s, r["jointPositions"]) for r in tr]) for s in HANDS}
        t = dict(shape=h["shape"], torso=int(h["torso_deg"]), trial=int(h["trial"]), k=k, dt=R["dt"], err={}, con={}, m={})
        for s in HANDS:
            pref = np.array(R["palm"][s])
            e = np.linalg.norm(meas[s] - pref[k], axis=1)
            d = np.sqrt(((meas[s][:, None, :] - pref[None, ::2, :]) ** 2).sum(-1)).min(1)   # as analyze.py
            t["err"][s], t["con"][s] = e * 1e3, d * 1e3
            t["m"][s] = dict(track_rms_mm=float(np.sqrt((e ** 2).mean()) * 1e3), track_p95_mm=float(np.percentile(e, 95) * 1e3),
                             track_max_mm=float(e.max() * 1e3), contour_rms_mm=float(np.sqrt((d ** 2).mean()) * 1e3),
                             contour_max_mm=float(d.max() * 1e3))
        t["meas"] = meas
        if t["torso"] == 0 and t["trial"] == 0:
            # the render's clip: every row with joints, t from the first; video = 4.6 s × fraction
            jr = [r for r in rows[1:] if "jointPositions" in r]
            T = jr[-1]["t"] - jr[0]["t"]
            off = 0.0 if t["shape"] == "spiral" else PATH_SPLIT_S
            pairs = [(off + PATH_SPLIT_S * (r["t"] - jr[0]["t"]) / T, r["k"] * R["dt"]) for r in tr]
            t["sync"] = [[round(a, 3), round(b, 3)] for a, b in pairs[::4] + [pairs[-1]]]
        traces.append(t)
    if not traces:
        raise SystemExit("no path-following traces")

    conds = []
    for shape in ("spiral", "square"):
        for torso in (0, -10):
            ts = sorted([t for t in traces if (t["shape"], t["torso"]) == (shape, torso)], key=lambda t: t["trial"])
            if not ts:
                continue
            # Each trial's ~50 Hz log lands on a different subset of reference
            # indices, so the indices common to all three are sparse (gaps over
            # 1 s). Interpolate every trial onto one uniform grid of path time
            # instead — interpolating in k, which is the reference's own clock.
            k0 = max(int(t["k"].min()) for t in ts); k1 = min(int(t["k"].max()) for t in ts)
            kk = np.linspace(k0, k1, 180)
            rec = {"id": f"{shape}_torso{torso}", "shape": shape, "torso_deg": torso, "trials": len(ts),
                   "x": [round(float(v * ts[0]["dt"]), 3) for v in kk], "series": {}, "stats": {}}
            for s in HANDS:
                for kind, key in (("track", "err"), ("contour", "con")):
                    E = np.array([np.interp(kk, t["k"], t[key][s]) for t in ts])
                    m, sd = E.mean(0), (E.std(0, ddof=1) if len(ts) > 1 else np.zeros(len(kk)))
                    rec["series"][f"{s}_{kind}"] = {"mean": [round(float(v), 2) for v in m],
                                                    "lo": [round(float(max(v, 0)), 2) for v in m - sd],
                                                    "hi": [round(float(v), 2) for v in m + sd]}
                st = {mk: round(float(np.mean([t["m"][s][mk] for t in ts])), 2) for mk in ts[0]["m"][s]}
                # trial-to-trial spread of the measured palm at the same reference index (analyze.py)
                kx = sorted(set.intersection(*[set(t["k"].tolist()) for t in ts]))
                P = np.array([[t["meas"][s][np.searchsorted(t["k"], q)] for q in kx] for t in ts])
                spread = np.linalg.norm(P - P.mean(0), axis=2)
                st["trial_spread_mm"] = round(float(np.sqrt((spread ** 2).mean()) * 1e3), 2)
                rec["stats"][s] = st
            sync = [t for t in ts if "sync" in t]
            if sync:
                rec["sync"] = sync[0]["sync"]
            conds.append(rec)
    worst = max(c["stats"][s]["contour_rms_mm"] for c in conds for s in HANDS)
    return {"date": "2026-10-08", "traces": len(traces), "worst_contour_rms_mm": worst, "conditions": conds}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", default=os.environ.get("ACCURACY_ARCHIVE", ""))
    a = ap.parse_args()
    EXP = os.path.join(a.archive, "experiments")
    sys.path.insert(0, os.path.join(EXP, "common"))
    from body import Body                                                  # noqa: E402
    body = Body()
    rep = repeatability(EXP, body)
    path = path_following(EXP, body)
    doc = {
        "generated_by": "website/scripts/build_accuracy.py",
        "robot": "real", "date": "2026-10-08",
        "measure": "palm centre from forward kinematics of the measured joints, torso included — "
                   "excludes backlash and link bending, so a lower bound on the true error",
        "plane": "frontal (lateral, height)",
        "clip_s": CLIP_S, "path_split_s": PATH_SPLIT_S,
        "rep": rep, "path": path,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {os.path.relpath(OUT, SITE)}  {os.path.getsize(OUT) / 1024:.0f} kB")
    print(f"   repeatability {rep['date']}: {rep['cycles']} cycles, {rep['visits']} visits, {len(rep['stations'])} stations; "
          f"median RP {rep['median_RP_mm']} mm (range {rep['best_RP_mm']}–{rep['worst_RP_mm']})")
    for s in rep["stations"]:
        print(f"      {s['name']:18s} " + "  ".join(f"{h[0].upper()} RP {s['hands'][h]['RP_mm']:5.2f} AP {s['hands'][h]['AP_mm']:5.2f} n={s['hands'][h]['n']}" for h in HANDS))
    print(f"   path following {path['date']}: {path['traces']} traces; worst contour RMS {path['worst_contour_rms_mm']} mm")
    for c in path["conditions"]:
        print(f"      {c['id']:18s} n={c['trials']} " + "  ".join(
            f"{h[0].upper()} track {c['stats'][h]['track_rms_mm']:5.2f} contour {c['stats'][h]['contour_rms_mm']:5.2f} spread {c['stats'][h]['trial_spread_mm']:4.2f}"
            for h in HANDS) + ("  [synced to clip]" if "sync" in c else ""))


if __name__ == "__main__":
    main()
