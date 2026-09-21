#!/usr/bin/env python3
"""Price the store from the bill of materials, and write the catalog the order
page AND the checkout server read.

    python3 scripts/build_order.py            # writes assets/data/order.json + the margin report
    python3 scripts/build_order.py --check    # fails if order.json has drifted from this script

Every list price on order.html comes out of this file. The cost basis is the
July 2026 BOM (BOM/data/*.csv, converted by BOM/tools/build_bom.py into
BOM/generated/bom_summary.json); the pricing RULE is the set of constants below,
chosen so that the anchor configuration — a complete robot with ORCA hands, a
Raspberry Pi 5 and the standard cameras — lists at $25,000 assembled and $15,000
as a kit, with a gross margin inside the 50-70 % band on the assembled robot.
Add-ons that are pass-through silicon (Jetsons, RealSense) carry a thinner
margin on purpose: nobody pays 2.5x for a dev kit they can buy retail.

The public JSON carries prices only. The margin table goes to
commerce/pricing_report.md, which is generated and internal.
"""
import csv
import json
import math
import pathlib
import sys
from datetime import date

SITE = pathlib.Path(__file__).resolve().parent.parent
REPO = SITE.parent
BOM = REPO / "BOM"
OUT = SITE / "assets" / "data" / "order.json"
REPORT = REPO / "commerce" / "pricing_report.md"

API = "https://order.mabelrobot.duckdns.org"

# ── the rule ──────────────────────────────────────────────────────────────────
KIT_FACTOR = 0.60          # a kit lists at 60 % of the assembled price: 25k -> 15k
DEPOSIT = 0.10             # reserve with 10 %, balance invoiced before shipping
MARK_STOCK = 1.35          # spare parts we pass through from a vendor
MARK_MADE = 2.00           # spare parts we fabricate or print ourselves
MARK_COMPUTE = 1.12        # a Jetson is a Jetson; we charge for the fitting
MARK_SENSOR = 1.30

# Module list prices, assembled. These four sum to the $25,000 anchor.
MODULE_PRICE = {
    "base": 7500,     # three-module swerve base, batteries, network spine
    "lift": 1300,     # the 0.635 m column and its Pico/driver loop
    "upper": 12600,   # torso, two 7-DOF arms, 3-DOF head, harness, controllers
    "orca": 3600,     # a pair of 17-DOF ORCA hands, built from the open design
    "fixed_column": 200,   # replaces the lift on the fixed-height configuration
    "bench_fixture": 300,  # the upper body's stand when it ships without a base
}
EFFECTOR_PRICE = {"ee_none": 0, "ee_openarm": 1900, "ee_orca": 3600, "ee_gripette": 2400}
COMPUTE_DELTA = {"pi5": 0, "orin_nano": 600, "orin_nx16": 1700, "agx_orin": 4900, "agx_thor": 7900}
SENSOR_DELTA = {
    "wrist_std": 0, "wrist_1200": 150, "wrist_d405": 900,
    "head_std": 0, "head_d435i": 500, "head_zed": 700,
    "lidar_none": 0, "lidar_ld19": 250, "lidar_c1": 300, "lidar_a2m12": 500,
    "basecam_none": 0, "basecam_d435i": 650,
}

# Uncosted items the BOM lists as gaps (BOM/data/open_items.csv), carried at the
# midpoint of their range so the margin is not flattered.
GAPS = {"hand_kit_pair": 450.0, "teensy_pair": 63.0, "pcbs": 270.0,
        "estop": 55.0, "usb_can": 35.0, "mic": 20.0}
# Estimates for parts the BOM does not carry at all.
EST = {"pi5_kit": 175.0,        # Pi 5 16 GB + NVMe + cooler
       "nvme": 45.0,            # boot SSD for any Jetson
       "battery_upgrade": 150.0,   # the 60 W boards need a bigger pack
       "openarm_gripper_pair": 320.0, "gripette_pair": 250.0,
       "fixed_column": 90.0, "bench_fixture": 120.0, "mount": 15.0}


def money(x):
    """Round a list price the way a price list does: whole dollars under $100,
    $5 steps under $1,000, $10 steps above. Always up — never under-charge by rounding."""
    if x < 100:
        return int(math.ceil(x))
    if x < 1000:
        return int(math.ceil(x / 5.0) * 5)
    return int(math.ceil(x / 10.0) * 10)


def read_csv(p):
    with open(p, newline="") as f:
        return list(csv.DictReader(f))


def main(check=False):
    summary = json.loads((BOM / "generated" / "bom_summary.json").read_text())
    fx = summary["cny_to_usd"]
    core = read_csv(BOM / "data" / "core.csv")
    choices = read_csv(BOM / "data" / "choices.csv")
    sec = {s["name"]: s["usd"] for s in summary["core_sections"]}

    def usd(row):
        v = float(row["unit_price"])
        return v * fx if row["currency"] == "CNY" else v

    line = {r["ref"]: r for r in core}
    ext = {r["ref"]: usd(r) * float(r["qty"]) for r in core}

    # ── cost basis per module (documented allocation) ────────────────────────
    electronics, structural, printed = sec["Electronics, power & cabling"], sec["Structural hardware"], sec["3D printed material"]
    lift_cost = ext["2.01"] + ext["2.02"] + ext["7.11"] + ext["7.12"]
    cost = {
        "base": sec["Mobile base"] + 0.45 * electronics + 0.30 * structural + 0.20 * printed
                + GAPS["teensy_pair"] / 2 + GAPS["pcbs"] / 2 + GAPS["estop"],
        "lift": lift_cost,
        "upper": (sec["Body / torso"] - lift_cost) + sec["Arms - both"] + sec["Neck / head"]
                 + 0.70 * structural + 0.55 * electronics + 0.60 * printed
                 + GAPS["teensy_pair"] / 2 + GAPS["pcbs"] / 2 + GAPS["mic"],
        "orca": sec["Hands - both"] + GAPS["hand_kit_pair"] + 0.20 * printed,
        "fixed_column": EST["fixed_column"], "bench_fixture": EST["bench_fixture"],
    }
    ee_cost = {"ee_none": 0.0, "ee_openarm": EST["openarm_gripper_pair"],
               "ee_orca": cost["orca"], "ee_gripette": EST["gripette_pair"]}

    ch = {}
    for r in choices:
        ch.setdefault(r["choice_id"], []).append(r)

    def opt(cid, name_prefix):
        for r in ch[cid]:
            if r["option"].startswith(name_prefix):
                return float(r["unit_price"]) * float(r["qty"])
        raise KeyError((cid, name_prefix))

    compute_cost = {"pi5": EST["pi5_kit"],
                    "orin_nano": opt("9.1", "NVIDIA Jetson Orin Nano") + EST["nvme"],
                    "orin_nx16": opt("9.1", "NVIDIA Jetson Orin NX 16") + EST["nvme"],
                    "agx_orin": opt("9.1", "NVIDIA Jetson AGX Orin") + EST["nvme"] + EST["battery_upgrade"],
                    "agx_thor": opt("9.1", "NVIDIA Jetson AGX Thor") + EST["nvme"] + EST["battery_upgrade"]}
    sensor_cost = {"wrist_std": opt("9.2", "MMlove AR0144 GS-720P"), "wrist_1200": opt("9.2", "MMlove AR0144 GS-1200P"),
                   "wrist_d405": opt("9.2", "Intel RealSense D405") + 13.99,
                   "head_std": opt("9.3", "MMlove 1200P"), "head_d435i": opt("9.3", "Intel RealSense D435i"),
                   "head_zed": opt("9.3", "Stereolabs ZED Mini") + 20.68,
                   "lidar_none": 0.0, "lidar_ld19": opt("9.5", "youyeetoo FHL-LD19") + EST["mount"],
                   "lidar_c1": opt("9.5", "Slamtec RPLIDAR C1") + EST["mount"],
                   "lidar_a2m12": opt("9.5", "Slamtec RPLIDAR A2M12") + EST["mount"],
                   "basecam_none": 0.0, "basecam_d435i": opt("9.4", "Intel RealSense D435i") + EST["mount"]}

    P = MODULE_PRICE
    robots = [
        {"id": "complete", "name": "MABEL, complete", "tag": "The whole robot",
         "spec": "Holonomic swerve base · 0.635 m lift · torso · two 7-DOF arms · 3-DOF head",
         "blurb": "Everything in the paper: drives, lifts, reaches from the floor to a top shelf.",
         "image": "assets/hw/body-sm.png", "has": ["base", "lift", "upper"], "default": True,
         "_cost": cost["base"] + cost["lift"] + cost["upper"], "_price": P["base"] + P["lift"] + P["upper"]},
        {"id": "fixed", "name": "Fixed height", "tag": "No lift",
         "spec": "Swerve base · fixed column · torso · two arms · head",
         "blurb": "The same mobile manipulator with a fixed column instead of the lift. Table-height work only.",
         "image": "assets/hw/arms-sm.png", "has": ["base", "upper"],
         "_cost": cost["base"] + cost["fixed_column"] + cost["upper"], "_price": P["base"] + P["fixed_column"] + P["upper"]},
        {"id": "upper", "name": "Upper body only", "tag": "Bench-mounted",
         "spec": "Torso · two 7-DOF arms · 3-DOF head · bench fixture",
         "blurb": "Bimanual manipulation on a desk or a cart of your own. No base, no lift.",
         "image": "assets/hw/head-sm.png", "has": ["upper"],
         "_cost": cost["upper"] + cost["bench_fixture"], "_price": P["upper"] + P["bench_fixture"]},
        {"id": "base", "name": "Mobile base only", "tag": "Just the platform",
         "spec": "Three REV swerve modules · batteries · network spine · compute tray",
         "blurb": "A holonomic platform for your own payload. Wrist, head and hand options do not apply.",
         "image": "assets/hw/base-sm.png", "has": ["base"],
         "_cost": cost["base"], "_price": P["base"]},
    ]
    for r in robots:
        r["price"] = {"assembled": money(r["_price"]), "kit": money(r["_price"] * KIT_FACTOR)}

    computes = [
        {"id": "pi5", "name": "Raspberry Pi 5, 16 GB", "spec": "Teleop, data collection and the studios. Policies run off-board.", "default": True},
        {"id": "orin_nano", "name": "NVIDIA Jetson Orin Nano Super", "spec": "8 GB · 67 TOPS. Small on-board policies."},
        {"id": "orin_nx16", "name": "NVIDIA Jetson Orin NX 16 GB", "spec": "157 TOPS. The recommended build: policy, SLAM and every camera resident at once.", "tag": "Recommended"},
        {"id": "agx_orin", "name": "NVIDIA Jetson AGX Orin 64 GB", "spec": "275 TOPS, 60 W. Includes the larger battery pack the board needs."},
        {"id": "agx_thor", "name": "NVIDIA Jetson AGX Thor", "spec": "128 GB · 2070 TFLOPS. VLA-class models on the robot. Larger pack included."},
    ]
    for c in computes:
        c["price"] = {"assembled": COMPUTE_DELTA[c["id"]], "kit": COMPUTE_DELTA[c["id"]]}

    def sopt(i, name, spec, **kw):
        d = {"id": i, "name": name, "spec": spec, "price": {"assembled": SENSOR_DELTA[i], "kit": SENSOR_DELTA[i]}}
        d.update(kw)
        return d

    sensors = [
        {"id": "wrist", "title": "Wrist cameras", "requires": "upper", "note": "One per arm.", "options": [
            sopt("wrist_std", "Global-shutter 720p pair", "1280×720 at 60 fps, 170° fisheye. The standard wrist view.", default=True),
            sopt("wrist_1200", "Global-shutter 1200p pair", "1600×1200 at 90 fps on the same board. The fine detail a manipulation policy learns from.", tag="Recommended"),
            sopt("wrist_d405", "Intel RealSense D405 pair", "Adds metric depth from 7 to 50 cm at the wrist."),
        ]},
        {"id": "head", "title": "Head camera", "requires": "upper", "options": [
            sopt("head_std", "Synchronised stereo 1200p", "3200×1200 at 60 fps, 112° field of view. Matching runs on the host.", default=True),
            sopt("head_d435i", "Intel RealSense D435i", "On-board depth and an IMU."),
            sopt("head_zed", "Stereolabs ZED Mini", "On-board depth engine and visual-inertial odometry."),
        ]},
        {"id": "lidar", "title": "2-D lidar", "requires": "base", "note": "Nav2 maps and plans from the scan.", "options": [
            sopt("lidar_none", "No lidar", "Drive by teleop only.", default=True),
            sopt("lidar_ld19", "youyeetoo LD19", "Direct time-of-flight, 12 m, 10 Hz. Enough for SLAM at walking pace."),
            sopt("lidar_c1", "Slamtec RPLIDAR C1", "Direct time-of-flight, 12 m, 5 kHz sample rate.", tag="Recommended"),
            sopt("lidar_a2m12", "Slamtec RPLIDAR A2M12", "16 kHz sample rate for fast rotation."),
        ]},
        {"id": "basecam", "title": "Base camera", "requires": "base", "note": "3-D obstacle detection for navigation: overhangs, table edges, low clutter.", "options": [
            sopt("basecam_none", "None", "Rely on the lidar's single plane.", default=True),
            sopt("basecam_d435i", "Intel RealSense D435i at the base", "Feeds the Nav2 costmap with a point cloud."),
        ]},
    ]

    effectors = [
        {"id": "ee_none", "name": "No end effector", "spec": "Bare wrist flanges. Fit your own.", "image": "assets/hw/arms-sm.png"},
        {"id": "ee_openarm", "name": "OpenArm 2.0 gripper pair", "spec": "Two-finger parallel gripper, 30 N, built-in RGB camera, swappable fingers.", "image": "assets/hw/arms-sm.png"},
        {"id": "ee_orca", "name": "ORCA hands pair", "spec": "Two 17-DOF tendon-driven hands built from the open ETH design. The standard MABEL.", "image": "assets/hw/hands-sm.png", "default": True, "tag": "Standard"},
        {"id": "ee_gripette", "name": "Pollen Robotics Gripette pair", "spec": "The robot-side twin of the Grabette handheld recorder, for UMI-style data collection.", "image": "assets/hw/arms-sm.png"},
    ]
    for e in effectors:
        e["price"] = {"assembled": money(EFFECTOR_PRICE[e["id"]]) if EFFECTOR_PRICE[e["id"]] else 0,
                      "kit": money(EFFECTOR_PRICE[e["id"]] * KIT_FACTOR) if EFFECTOR_PRICE[e["id"]] else 0}

    # ── spare parts ──────────────────────────────────────────────────────────
    parts = []
    skip = {"7.17", "7.18", "7.19", "8.01", "8.02", "8.03"}   # a flashlight, unreleased PCBs, raw filament
    for r in core:
        if r["ref"] in skip:
            continue
        made = r["vendor"] == "Custom fabrication"
        unit = usd(r)
        parts.append({"sku": f"P-{r['ref']}", "ref": r["ref"], "name": r["item"], "spec": r["spec"],
                      "group": r["section"], "made": made, "price": money(unit * (MARK_MADE if made else MARK_STOCK)),
                      "_cost": unit, "note": ("Sold as the dual-arm set." if r["ref"] == "3.04" else "")})
    seen = set()
    for r in choices:
        if r["choice_id"] not in ("9.1", "9.2", "9.3", "9.4", "9.5") or float(r["unit_price"]) == 0:
            continue
        if r["option"] in seen:
            continue
        seen.add(r["option"])
        unit = float(r["unit_price"])
        grp = "Compute" if r["choice_id"] == "9.1" else "Sensors"
        parts.append({"sku": f"P-{r['choice_id']}-{len(seen)}", "ref": r["choice_id"], "name": r["option"], "spec": r["spec"],
                      "group": grp, "made": False, "price": money(unit * (MARK_COMPUTE if grp == "Compute" else MARK_SENSOR)),
                      "_cost": unit, "note": "Each." if r["qty"] == "2" else ""})
    # Parts the BOM carries as gaps or that only we make.
    own = [
        ("P-PI5", "Compute", "Raspberry Pi 5, 16 GB, with NVMe and cooler", "The standard compute tray.", EST["pi5_kit"], MARK_COMPUTE),
        ("P-TEENSY", "Electronics, power & cabling", "Teensy 4.1, flashed", "One runs the base, one runs arms, torso and neck at 500 Hz.", GAPS["teensy_pair"] / 2, MARK_STOCK * 1.3),
        ("P-ESTOP", "Electronics, power & cabling", "Hardware E-stop kit", "Switch and contactor that de-energise every actuator independently of the host.", GAPS["estop"], MARK_STOCK),
        ("P-HANDKIT", "Hands - both", "ORCA hand structural kit, one hand", "Printed frame, tendon, bearings, tensioners and fingertip pads. Servos not included.", GAPS["hand_kit_pair"] / 2, MARK_MADE),
        ("P-HAND", "Hands - both", "ORCA hand, one, assembled and tuned", "17 servos, frame, tendons, calibrated. Left or right.", cost["orca"] / 2, 2.15),
        ("P-ARM", "Arms - both", "Arm, one side, assembled", "Seven DAMIAO actuators on the OpenArm structure, harnessed and calibrated.", sec["Arms - both"] / 2 + 60, 2.2),
        ("P-SHELLS", "3D printed material", "Printed shell and cover set", "Every cover on the robot, in the standard jade white.", 4 * 22.99 + 80, MARK_MADE),
        ("P-MOUNTS", "3D printed material", "Printed sensor mount set", "Wrist, head, lidar and base-camera mounts.", 22.99 + 15, MARK_MADE),
    ]
    for sku, grp, name, spec, c, m in own:
        parts.append({"sku": sku, "ref": "", "name": name, "spec": spec, "group": grp, "made": True,
                      "price": money(c * m), "_cost": c, "note": ""})
    groups = ["Mobile base", "Body / torso", "Arms - both", "Hands - both", "Neck / head", "Structural hardware",
              "Electronics, power & cabling", "3D printed material", "Compute", "Sensors"]

    # ── the page's other sections, as data: what's in the box, delivery, the
    #    gallery. The lift stroke comes from assets/data/hw-modules.json (rendered
    #    from the MJCF and the BOM) so the caption never drifts from the hardware page.
    hw = {m["id"]: dict(m["specs"]) for m in json.loads((SITE / "assets" / "data" / "hw-modules.json").read_text())["modules"]}
    stroke = hw["lift"]["Stroke"].split(" (")[0]
    box = {
        "assembled": [
            {"t": "The robot, assembled and calibrated", "s": "Every joint zeroed, the hands tuned, the whole-body controller burned in.", "img": "assets/hw/body-sm.png"},
            {"t": "Your compute, fitted", "s": "Flashed with the stack and the studios, on the tray.", "img": "assets/hw/electronics-sm.png"},
            {"t": "Your sensors, fitted", "s": "Mounted, cabled and calibrated to the head and wrists.", "img": "assets/hw/sensors-sm.png"},
            {"t": "Batteries and charger", "s": "Two packs, the mains charger and the power cord."},
            {"t": "Hardware E-stop", "s": "De-energises every actuator, independently of the host."},
            {"t": "USB-CAN bench adapter", "s": "For bring-up and calibration at a desk."},
            {"t": "Calibration report", "s": "The numbers this robot shipped with."},
            {"t": "Quick-start card", "s": "Power on, connect the app, drive — and the wiki for the rest."},
        ],
        "kit": [
            {"t": "Sheet metal and extrusion, cut", "s": "Every plate bent and tapped, every extrusion cut to length.", "img": "assets/hw/base-sm.png"},
            {"t": "Every printed part", "s": "Shells, mounts, hand frames — printed and cleaned.", "img": "assets/hw/hands-sm.png"},
            {"t": "Actuators, pre-addressed", "s": "Arm, torso, neck and hand actuators with their bus IDs set.", "img": "assets/hw/arms-sm.png"},
            {"t": "Harness, boards, batteries", "s": "The two rails, the network spine, both Teensys flashed."},
            {"t": "Your compute and sensors", "s": "In the box, with their mounts and cables."},
            {"t": "Fasteners, bagged by chapter", "s": "Each bag matches a chapter of the assembly guide."},
            {"t": "Hardware E-stop", "s": "Fit it first."},
            {"t": "Printed build guide", "s": "The wiki's assembly, electronics and bring-up chapters, on paper."},
        ],
    }
    delivery = [
        {"t": "Parts kit", "s": "Ships in about two weeks by tracked courier, in one crate and a few boxes.", "k": "~2 weeks"},
        {"t": "Assembled robot", "s": "Built, calibrated and burn-in tested, then crated freight; ships in about a month. Freight is quoted after checkout.", "k": "~1 month + freight"},
        {"t": "Spare parts", "s": "A few days by courier. Pass-through parts follow their vendor's stock.", "k": "days"},
    ]
    gallery = [   # real photographs only — the renders belong to the hardware page
        {"src": "assets/wild/store/front.jpg", "cap": "MABEL, as built", "key": "photo", "w": 1600, "h": 1067},
        {"src": "assets/wild/store/pose.jpg", "cap": "Two 7-DOF arms, 2.23 m fingertip to fingertip", "key": "pose", "w": 1600, "h": 1067},
        {"src": "assets/wild/store/tabletop.jpg", "cap": "Bimanual work at a table", "key": "tabletop", "w": 1600, "h": 1067},
        {"src": "assets/wild/store/laptop.jpg", "cap": "ORCA hands at a keyboard", "key": "laptop", "w": 1067, "h": 1600},
        {"src": "assets/wild/store/laptop-close.jpg", "cap": "Seventeen degrees of freedom per hand", "key": "hands", "w": 1067, "h": 1600},
        {"src": "assets/wild/store/skyline-dusk.jpg", "cap": "Outdoors, at dusk", "key": "dusk", "w": 1600, "h": 1067},
        {"src": "assets/wild/store/skyline-night.jpg", "cap": "Outdoors, at night", "key": "night", "w": 1600, "h": 1067},
    ]
    catalog = {
        "generated_by": "website/scripts/build_order.py", "price_date": summary["price_date"],
        "box": box, "delivery": delivery, "gallery": gallery,
        "currency": "usd", "api": API, "deposit_fraction": DEPOSIT, "kit_factor": KIT_FACTOR,
        "tiers": [
            {"id": "assembled", "name": "Assembled & tested", "short": "Assembled",
             "lead": "Built, calibrated and burn-in tested; ships in about a month",
             "blurb": "Arrives calibrated. Drive it the day the crate opens."},
            {"id": "kit", "name": "Parts kit", "short": "Kit",
             "lead": "Ships in about two weeks; builds in about a week",
             "blurb": "Cut, printed and flashed. You assemble with the illustrated guide."},
        ],
        "steps": [
            {"id": "robot", "num": 1, "title": "Robot", "help": "Which body.", "options": robots},
            {"id": "compute", "num": 2, "title": "Compute", "help": "What runs on board.", "options": computes},
            {"id": "sensors", "num": 3, "title": "Sensors", "help": "What it sees.", "groups": sensors},
            {"id": "effector", "num": 4, "title": "End effector", "help": "What it holds with.", "requires": "upper", "options": effectors},
        ],
        "groups": groups, "parts": parts,
    }

    # ── margin report (internal) ────────────────────────────────────────────
    lines = ["# Store pricing report", "", f"Generated by `website/scripts/build_order.py` from the BOM priced {summary['price_date']}",
             f"(1 CNY = ${fx:.4f}). Gaps from `BOM/data/open_items.csv` carried at range midpoints. INTERNAL.", "",
             "## Anchor configuration", "", "| Tier | List | Cost basis | Gross margin |", "|---|---:|---:|---:|"]
    anchor_cost = cost["base"] + cost["lift"] + cost["upper"] + cost["orca"] + compute_cost["pi5"] + sensor_cost["wrist_std"] + sensor_cost["head_std"]
    for t, price in (("assembled", 25000), ("kit", 15000)):
        lines.append(f"| {t} | ${price:,} | ${anchor_cost:,.0f} | {100 * (price - anchor_cost) / price:.1f} % |")
    lines += ["", "## Modules", "", "| Module | Assembled | Kit | Cost | Margin (assembled) |", "|---|---:|---:|---:|---:|"]
    for k in ("base", "lift", "upper", "orca", "fixed_column", "bench_fixture"):
        lines.append(f"| {k} | ${P[k]:,} | ${money(P[k] * KIT_FACTOR):,} | ${cost[k]:,.0f} | {100 * (P[k] - cost[k]) / P[k]:.1f} % |")
    lines += ["", "## Configurations (no end effector, no add-ons)", "", "| Robot | Assembled | Kit | Cost | Margin |", "|---|---:|---:|---:|---:|"]
    for r in robots:
        lines.append(f"| {r['name']} | ${r['price']['assembled']:,} | ${r['price']['kit']:,} | ${r['_cost']:,.0f} | {100 * (r['price']['assembled'] - r['_cost']) / r['price']['assembled']:.1f} % |")
    lines += ["", "## Add-ons (delta over the included option)", "", "| Option | Delta | Delta cost | Margin on the delta |", "|---|---:|---:|---:|"]
    base_c = {"compute": compute_cost["pi5"], "wrist": sensor_cost["wrist_std"], "head": sensor_cost["head_std"], "lidar": 0.0, "basecam": 0.0}
    for e in effectors:
        d = e["price"]["assembled"]; c = ee_cost[e["id"]]
        lines.append(f"| {e['name']} | ${d:,} | ${c:,.0f} | {(100 * (d - c) / d) if d else 0:.1f} % |")
    for c in computes:
        d = c["price"]["assembled"]; dc = compute_cost[c["id"]] - base_c["compute"]
        lines.append(f"| {c['name']} | ${d:,} | ${dc:,.0f} | {(100 * (d - dc) / d) if d else 0:.1f} % |")
    for g in sensors:
        for o in g["options"]:
            d = o["price"]["assembled"]; dc = sensor_cost[o["id"]] - base_c[g["id"]]
            lines.append(f"| {g['title']}: {o['name']} | ${d:,} | ${dc:,.0f} | {(100 * (d - dc) / d) if d else 0:.1f} % |")
    lines += ["", "## Spare parts", "", "| SKU | Part | List | Cost | Margin |", "|---|---|---:|---:|---:|"]
    for p in parts:
        lines.append(f"| {p['sku']} | {p['name']} | ${p['price']:,} | ${p['_cost']:,.2f} | {100 * (p['price'] - p['_cost']) / p['price']:.1f} % |")
    report = "\n".join(lines) + "\n"

    # strip the internal fields before publishing
    def public(o):
        if isinstance(o, dict):
            return {k: public(v) for k, v in o.items() if not k.startswith("_")}
        if isinstance(o, list):
            return [public(v) for v in o]
        return o
    pub = public(catalog)
    text = json.dumps(pub, indent=1, ensure_ascii=False) + "\n"

    if check:
        cur = OUT.read_text() if OUT.exists() else ""
        if cur != text:
            print("order.json has DRIFTED from scripts/build_order.py — re-run it")
            return 1
        print("order.json matches build_order.py  RESULT: PASS")
        return 0
    OUT.write_text(text)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(report)
    print(report)
    print(f"wrote {OUT.relative_to(REPO)} ({len(parts)} parts) and {REPORT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(check="--check" in sys.argv))
