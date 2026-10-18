"""Export the retargeting comparison to the website, from the paper's own JSON.

controller/experiments/retargeting_ablation/results/map.json is what
`papers/ral2026/Tables/12_experiments_retargettable.tex` is generated from —
seven maps replayed over the same archived EgoDex episodes through the same
plant, gains, supervisor, collision guard and metric code, so a difference
between columns is a difference in the MAP and nothing else.

This copies the PER-EPISODE rows rather than the paper's pre-aggregated cells,
which is what lets the page filter by task and re-average live. The page and the
paper therefore agree by construction: same source, same arithmetic.

    python3 scripts/build_retarget_table.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
REPO = os.path.dirname(SITE)
SRC = os.path.join(REPO, "controller", "experiments", "retargeting_ablation",
                   "results", "map.json")
OUT = os.path.join(SITE, "assets", "data", "retarget-compare.json")

# name, blurb, and whether it is a reimplementation rather than the authors' code
METHODS = [
    ("direct", "Direct copy", None,
     "Operator joint angles written straight onto the robot. No IK, no scale — "
     "the strawman the morphology gap defeats.", False),
    ("abs", "Absolute + scale", None,
     "Head-anchored hand position times one number. What most VR teleop "
     "interfaces ship.", False),
    ("wrist_ik", "Wrist IK", "Open-TeleVision / AnyTeleop",
     "The same wrist SE(3) target ours solves, with the hand at a fixed preset "
     "— so the difference is what per-finger retargeting is worth.", True),
    ("ext", "Extension map", None,
     "Per-shoulder anchoring carrying the operator's extension fraction across.",
     False),
    ("gmr", "GMR", "general motion retargeting",
     "Non-uniform local scaling per axis.", True),
    ("wb_ik", "Whole-body IK", "RelaxedIK",
     "One weighted solve over the whole body at once.", True),
    ("ours", "MABEL", None,
     "Wrist SE(3) with an elbow-direction term and a precomputed posture table.",
     False),
]

# key, label, unit, higher-is-better, decimals, and one line on what it means.
# The decimals are run.py's FMT, not a guess — the paper prints Swivel and
# Workspace whole and Placement to a tenth, and a table that rounds differently
# from the one it claims to reproduce is a table that disagrees with it.
AXES = [
    ("placement_pct", "Placement", "% reach", False, 1,
     "How far the robot's hand lands from where the operator put theirs, as a "
     "fraction of the arm's own reach. Scale-free, so it compares two robots."),
    ("orientation_deg", "Orientation", "°", False, 1,
     "Angle between the palm the operator presented and the one the robot "
     "achieved. This is the axis a flipped hand shows up on."),
    ("posture_deg", "Swivel", "°", False, 0,
     "How far the elbow sits from where the operator's was. A redundant arm "
     "can hit the same hand pose with a very different elbow."),
    ("coverage_pct", "Workspace", "%", True, 0,
     "How much of the robot's reachable volume the map can actually command. "
     "A safe map that can only reach a third of the workspace is not safe, it "
     "is small."),
    ("selfcol_pct", "Self-collision", "% frames", False, 1,
     "Frames where the arms were inside the body or each other."),
    ("infeasible_pct", "Infeasible", "% frames", False, 1,
     "Frames the solver could not satisfy at all."),
    ("sat_pct", "Saturation", "% pairs", False, 0,
     "Joint pairs pinned against a limit — the arm is out of room to move."),
    ("grasp_r", "Grasp tracking", "r", True, 2,
     "Correlation between the operator's grasp aperture and the robot's."),
    ("step_ms", "Step time", "ms", False, 1,
     "Cost of one retarget tick. All seven fit the budget; this is here to "
     "show that none of them wins by spending more compute."),
    ("track_mm", "Own target", "mm", None, 0,
     "How close each map got to ITS OWN target. Not a comparison between maps "
     "— a map that commands an easy target scores well here while placing the "
     "hand in the wrong place, which is exactly what Direct copy does."),
]


def main():
    with open(SRC) as f:
        raw = json.load(f)

    tasks = sorted({r["task"] for rows in raw.values() for r in rows})
    keys = [a[0] for a in AXES]
    rows = {}
    for m, _, _, _, _ in METHODS:
        rows[m] = [{"task": r["task"], "episode": r["episode"],
                    **{k: round(float(r[k]), 4) for k in keys if k in r}}
                   for r in raw.get(m, [])]

    out = {
        "generated_by": "website/scripts/build_retarget_table.py",
        # The paper's own two statistics, carried over so the page reproduces
        # its table rather than approximating it:
        #   agg   MEDIAN across episodes — the tail matters more than the
        #         centre here, and on typical seated motion every competent map
        #         is fine. `infeasible_pct` is the exception and is MEANED,
        #         because its median is 0 for every map including the ones that
        #         fail half the time, which erases the axis.
        #   rank  two cells closer than the pooled standard error are NOT
        #         distinguishable by the experiment and must not be ranked
        #         against each other. Without that rule the grasp row printed a
        #         bold winner chosen by noise.
        "agg": "median",
        "agg_mean_keys": ["infeasible_pct"],
        "rank_rule": ("two cells closer than the pooled across-episode standard "
                      "error are not distinguishable and are not ranked"),
        "source": ("controller/experiments/retargeting_ablation/results/map.json"
                   " — the same JSON papers/ral2026/Tables/"
                   "12_experiments_retargettable.tex is built from"),
        "motion": ("EgoDex (Apple), arXiv:2505.11709 — recorded Apple Vision Pro "
                   "hand and head motion, replayed through MABEL's own headset "
                   "wire format"),
        "protocol": ("Every method replays the SAME episodes through the SAME "
                     "plant, PD gains, engagement supervisor, collision guard "
                     "and metric code. A difference between columns is a "
                     "difference in the map and nothing else."),
        "episodes": len(rows["ours"]),
        "tasks": tasks,
        "methods": [{"id": m, "name": n, "cites": c, "why": w, "reimpl": r}
                    for m, n, c, w, r in METHODS],
        "axes": [{"key": k, "label": l, "unit": u, "higher": h, "dp": d, "why": w}
                 for k, l, u, h, d, w in AXES],
        "rows": rows,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"wrote {os.path.relpath(OUT, SITE)}  "
          f"({os.path.getsize(OUT) / 1024:.0f} kB)")
    print(f"{len(METHODS)} methods x {len(rows['ours'])} episodes "
          f"over {len(tasks)} tasks, {len(AXES)} axes")
    # a sanity line per method, using the PAPER's statistic, so a mismatch with
    # the printed table shows up here and not on the page
    def med(v):
        v = sorted(v)
        n = len(v)
        if not n:
            return float("nan")
        return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2
    for m, n, _, _, _ in METHODS:
        rs = rows[m]
        p = med([r["placement_pct"] for r in rs])
        o = med([r["orientation_deg"] for r in rs])
        print(f"   {n:18s} placement {p:5.1f}%   orientation {o:5.1f}°")


if __name__ == "__main__":
    main()
