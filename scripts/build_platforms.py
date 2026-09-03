"""The platform landscape, from the paper's own survey.

papers/ral2026/Tables/02_related_comparison.tex is the FULL survey (the printed
figure abridges the commercial block to its four most articulated rows). This
carries all of it, plus the single-arm open platforms the paper discusses in
prose rather than tabulating, so the page can filter across the whole set.

Survey date is the paper's: July 2026. Prices are the hardware list or estimate
in thousands of USD, manufacturer-stated unless the note says otherwise;
commercial prices are frequently inquiry-only.

    python3 scripts/build_platforms.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
OUT = os.path.join(SITE, "assets", "data", "platforms.json")

# Where each platform can be read about. Taken from the paper's own
# bibliography (papers/ral2026/citations.bib) — a URL where it gives one, an
# arXiv id where it gives that instead, and NOTHING where it gives neither.
# Guessing a company's URL from its name is how a comparison table starts
# linking to the wrong company.
LINKS = {
    "Mobile ALOHA": "https://mobile-aloha.github.io/",
    "AhaRobot": "https://arxiv.org/abs/2503.10070",
    "XLeRobot": "https://github.com/Vector-Wangel/XLeRobot",
    "YOR": "https://arxiv.org/abs/2602.11150",
    "Trossen Mobile AI": "https://www.trossenrobotics.com/mobile-ai",
    "Reachy 2": "https://www.pollen-robotics.com/reachy/",
    "LeKiwi": "https://github.com/SIGRobotics-UIUC/LeKiwi",
    "Reflex": "https://www.reflexrobotics.com/",
    "Rainbow RB-Y1": "https://www.rainbow-robotics.com/en_rby1",
    "Sunday Memo": "https://www.sunday.ai/",
    "Weave Isaac 1": "https://www.weaverobotics.com/isaac-1",
    "Galaxea R1": "https://galaxea.ai/",
    "Galbot G1": "https://www.galbot.com/en",
    "DexMate Vega": "https://www.dexmate.ai/product/vega",
    "Astribot S1": "https://www.astribot.com/product",
    "AgiBot Genie G1": "https://www.agibot.com/",
    "Unitree R1-A7-D": "https://www.unitree.com/",
    "MABEL": "https://github.com/robotmabel/MABEL",
}

# name, year, base, holonomic (True/False/None=unstated), arms "NxM",
# hand DOF per hand, neck DOF, lift/torso, cost k$ (None = undisclosed),
# open?, focus, note
P = [
    # ── open, bimanual ───────────────────────────────────────────────────
    ("Mobile ALOHA", 2024, "Differential", False, "6×2", 1, 0, "—", 32.0, True,
     "Bimanual mobile imitation learning", None),
    ("AhaRobot", 2025, "Differential", False, "6×2", 1, 2, "Lift", 1.0, True,
     "Ultra-low-cost bimanual mobile manipulation", "estimate"),
    ("Cone-E", 2025, "Holonomic", True, "6×2", 1, 0, "Lift", 12.0, True,
     "Low-cost mobile manipulation", None),
    ("XLeRobot", 2025, "Holonomic", True, "5×2", 1, 0, "—", 0.66, True,
     "Hobby-scale bimanual mobile base", None),
    ("YOR", 2024, "4-module swerve", True, "6×2", 1, 0, "Lift", 9.3, True,
     "Low-cost generalizable mobile manipulation", None),
    ("Trossen Mobile AI", 2025, "Differential", False, "7×2", 1, 0, "—", 34.0, True,
     "Open ALOHA-style research kit", None),
    ("OpenPyRo-A1", 2025, "Fixed", None, "7×2", 1, 0, "Waist", 14.0, True,
     "Open bimanual torso", None),
    ("Reachy 2", 2025, "Omni wheeled", True, "7×2", 1, 3, "—", 70.0, True,
     "Open teleoperation and manipulation", None),
    # ── open, single-arm ─────────────────────────────────────────────────
    ("TidyBot++", 2024, "Holonomic", True, "7×1", 1, 0, "—", 6.0, True,
     "Open holonomic mobile manipulator", "arm not included"),
    ("LeKiwi", 2024, "Holonomic", True, "5×1", 1, 0, "—", 0.6, True,
     "Hobby-scale mobile arm", None),
    # ── commercial ───────────────────────────────────────────────────────
    ("Reflex", 2024, "3-module swerve", True, "2", 1, 3, "Spine lift", None, False,
     "Teleoperated warehouse manipulation", "gripper, not in-hand dexterity"),
    ("Rainbow RB-Y1", 2024, "Differential", False, "7×2", 1, 0, "Torso ×6", 80.0, False,
     "Industrial bimanual coordination", None),
    ("Sunday Memo", 2025, "Omni (3-wheel)", None, "7×2", 4, 2, "Lift", 10.0, False,
     "Learn-from-demonstration home chores", "target at scale; beta ~$20k"),
    ("Weave Isaac 1", 2026, "Wheeled", None, "6×2", 1, 2, "Lift", 8.0, False,
     "Teleoperation-assisted home robot", None),
    ("Galaxea R1", 2024, "Omni (3-wheel)", True, "7×2", 1, 0, "Torso ×4", 27.0, False,
     "Generalist mobile manipulation", "base model; R1 Pro ~$70k"),
    ("Galbot G1", 2024, "Omni wheeled", True, "7×2", 1, 2, "Waist + lift", 88.0, False,
     "Retail and pharmacy manipulation", "suction + 1-DOF jaw; retail-listed"),
    ("DexMate Vega", 2025, "Omni (caster)", True, "7×2", 6, 3, "Torso + lift", 90.0, False,
     "General-purpose research robot", None),
    ("Astribot S1", 2024, "Omni wheeled", True, "7×2", 1, 2, "Torso ×4", 100.0, False,
     "High-speed bimanual manipulation", "third-party price"),
    ("AgiBot Genie G1", 2025, "Wheeled", None, "7×2", 1, 2, "Lift + waist", 22.0, False,
     "Fleet-scale data collection", "third-party price"),
    ("Unitree R1-A7-D", 2026, "Differential", False, "7×2", 7, 2, "Lift + waist", 4.3, False,
     "Modular dual-arm mobile manipulation", "lineup from $4,290; -D quote-based"),
    # ── ours ─────────────────────────────────────────────────────────────
    ("MABEL", 2026, "3-module swerve", True, "7×2", 17, 3, "Lift + torso", 9.7, True,
     "Open anthropomorphic dexterity + spatial teleoperation", None),
]


def main():
    rows = []
    for (name, yr, base, holo, arms, hand, neck, lift, cost, is_open,
         focus, note) in P:
        n_arms = 1 if arms.endswith("×1") else (2 if "×2" in arms else
                                                int(arms) if arms.isdigit() else 2)
        rows.append({
            "name": name, "year": yr, "base": base, "holo": holo,
            "arms": arms, "n_arms": n_arms, "hand": hand, "neck": neck,
            "lift": lift, "cost": cost, "open": is_open, "focus": focus,
            "note": note, "mobile": base != "Fixed", "ours": name == "MABEL",
            "link": LINKS.get(name, ""),
        })
    out = {
        "generated_by": "website/scripts/build_platforms.py",
        "source": ("papers/ral2026/Tables/02_related_comparison.tex — the full "
                   "survey behind the printed figure, plus the single-arm open "
                   "platforms the paper discusses in prose"),
        "surveyed": "July 2026",
        "cost_note": ("hardware list or estimate, thousands of USD, "
                      "manufacturer-stated unless noted; commercial prices are "
                      "frequently inquiry-only"),
        "platforms": rows,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)

    n_link = sum(1 for r in rows if r["link"])
    print(f"   {n_link}/{len(rows)} carry a link from the bibliography")
    n_open = sum(1 for r in rows if r["open"])
    print(f"wrote {os.path.relpath(OUT, SITE)} — {len(rows)} platforms "
          f"({n_open} open, {len(rows)-n_open} commercial)")
    # the claim the page makes, checked against the data rather than asserted
    rivals = [r for r in rows if not r["ours"] and r["open"] and r["hand"] > 1
              and r["neck"] >= 1 and (r["cost"] or 1e9) < 10]
    print(f"open AND hand-dexterous AND neck-articulated AND under $10k, "
          f"besides MABEL: {len(rivals)}  {[r['name'] for r in rivals] or '(none)'}")


if __name__ == "__main__":
    main()
