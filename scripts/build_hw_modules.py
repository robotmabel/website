"""Build the hardware slider's data from the BOM, not from prose.

hardware.html used to carry its part numbers and prices as hand-typed HTML,
which is how the site ended up quoting servo model numbers the BOM disagrees
with. This reads BOM/data/*.csv — the same files that generate the printed
build guide — and emits website/assets/data/hw-modules.json, so a price change
in the BOM lands on the page the next time this runs.

The editorial copy (what a subsystem IS, why it is built that way) lives here,
because that is genuinely written rather than derived. Everything with a number
or a link in it comes from the CSVs.

    python3 scripts/build_hw_modules.py
"""
import csv
import json
import os
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
REPO = os.path.dirname(SITE)
BOM = os.path.join(REPO, "BOM", "data")
OUT = os.path.join(SITE, "assets", "data", "hw-modules.json")

# BOM section -> module, plus the parts a module borrows from other sections.
MODULES = [
    {
        "id": "base", "name": "Base", "kicker": "Holonomic",
        "sections": ["Mobile base"],
        "blurb": "Three independently steered-and-driven swerve modules in a "
                 "delta layout. It strafes through a doorway, spins on the "
                 "spot, and holds a heading while driving sideways — there is "
                 "no direction it has to turn to face first.",
        "why": "A delta is the smallest arrangement that is fully holonomic. "
               "Four modules would add a redundant constraint and a fourth "
               "thing to calibrate; three cannot disagree about where the "
               "robot is going.",
        "specs": [["Modules", "3 × REV MAXSwerve, delta"],
                  ["Wheel", "76.2 mm dia (38.1 mm radius)"],
                  ["Bus", "CAN 1 Mbit → 6 REV SPARK"],
                  ["Controller", "Teensy 4.1 over UDP :8888"],
                  ["Footprint", "0.49 m across"]],
        "gotcha": "REV's catalogue price is for the module ONLY — motors, "
                  "controllers and framing are not included. Budget a NEO, a "
                  "NEO 550, a SPARK Flex and a SPARK MAX per module on top.",
        "files": [["Firmware", "firmware/swerve_drive/"],
                  ["CAN protocol", "firmware/swerve_drive/rev_can_protocol.md"],
                  ["Kinematics", "controller/mabel/swerve.py"]],
    },
    {
        "id": "lift", "name": "Lift", "kicker": "0.635 m of reach",
        "sections": [],
        "refs": ["2.01", "2.02", "7.11", "7.12"],
        "blurb": "A two-stage worm-gear column lifts the whole upper body "
                 "through 0.635 m, so the same arms work at a floor socket and "
                 "at a top shelf.",
        "why": "The column is a stock standing-desk lift. It is non-back"
               "drivable, which means it holds its height with the motor off "
               "— and it is the single cheapest way to buy this much rigid, "
               "repeatable vertical travel.",
        "specs": [["Stroke", "0.635 m (two 0.3175 m stages)"],
                  ["Top stop", "0.9525 m"],
                  ["Drive", "RP2040 Pico + BTS7960"],
                  ["Link", "USB serial 115200"],
                  ["Holding", "worm gear — no power needed"]],
        "gotcha": "Both stages move together, each taking half the command. "
                  "Driving one stage with the whole height overshoots the top "
                  "and can never reach the bottom.",
        "files": [["Firmware", "firmware/lift/"],
                  ["Bring-up", "hardware_bridge/LIFT_VERIFY.md"]],
    },
    {
        "id": "body", "name": "Body & torso", "kicker": "One yaw, huge torque",
        "sections": ["Body / torso"],
        "skip": ["2.01"],
        "blurb": "A hollow-shaft planetary actuator turns the whole upper body "
                 "on the lift, so the arms can face a workspace the base is "
                 "not pointed at.",
        "why": "Turning the torso instead of the base is what lets the robot "
               "work at a bench without re-parking. The hollow shaft carries "
               "the arm harness through the joint rather than around it.",
        "specs": [["Actuator", "DAMIAO DM-J10422P"],
                  ["Torque", "100 N·m rated · 400 N·m peak"],
                  ["Range", "−60° to +15°"],
                  ["Bus", "DaMiao MIT CAN 1 Mbit"],
                  ["Plates", "5 custom bent-sheet parts"]],
        "files": [["Model", "simulation/mabel_mujoco/models/mabel_full.xml"],
                  ["Machined parts", "BOM/data/machined.csv"]],
    },
    {
        "id": "arms", "name": "Arms", "kicker": "14 DOF, back-drivable",
        "sections": ["Arms - both"],
        "blurb": "Two 7-DOF arms on the open OpenArm structure, driven by "
                 "quasi-direct-drive motors in MIT mode. Low gearing means a "
                 "commanded torque is a real torque, so gravity compensation "
                 "and Cartesian impedance are available rather than faked.",
        "why": "Seven joints give a null space: the elbow can move out of the "
               "way without the hand moving at all. That is what makes "
               "teleoperation feel like your own arm.",
        "specs": [["DOF", "14 (2 × 7)"],
                  ["Rate", "500 Hz, MIT CAN 1 Mbit"],
                  ["Reach", "0 – 2.23 m fingertip span"],
                  ["Housing", "8 printed parts, ~260 g PETG per arm"],
                  ["Fasteners", "14 × M2.5×10 per arm"]],
        "gotcha": "Verify each motor's (p_max, v_max, t_max) in the DaMiao "
                  "desktop tool first. A mismatch silently rescales every "
                  "packed value on the wire.",
        "files": [["Firmware", "firmware/openarm/"],
                  ["Housings", "mechanical/arm_housing/"],
                  ["Controller", "controller/mabel/"]],
    },
    {
        "id": "hands", "name": "Hands", "kicker": "34 DOF of fingers",
        "sections": ["Hands - both"],
        "blurb": "Two open-source ORCA hands: five tendon-routed fingers each, "
                 "17 actuated DOF per hand, on one serial chain per hand.",
        "why": "Tendons put the motors in the palm rather than the finger, so "
               "the fingers stay slim enough to fit a real handle — and a "
               "snapped tendon is a five-minute repair rather than a "
               "replacement joint.",
        "specs": [["DOF", "34 (17 per hand)"],
                  ["Servos", "32 × HL3915M + 2 × HL3930M"],
                  ["Bus", "TTL serial 1 Mbit, one chain per hand"],
                  ["Per finger", "abduction, MCP, PIP"],
                  ["Design", "open — print, string, run"]],
        "gotcha": "The two hand adapters are identical CH340s, so the USB "
                  "serial number is the only stable way to tell left from "
                  "right. Register both before first run.",
        "files": [["Firmware", "firmware/orca_hand/"],
                  ["Tensioning", "orca_core initial-tensioning docs"],
                  ["Config", "hardware_bridge/mabel_hw/config.py"]],
    },
    {
        "id": "head", "name": "Neck & head", "kicker": "Where it looks",
        "sections": ["Neck / head"],
        "blurb": "A 3-DOF neck — yaw on a DaMiao actuator, pitch and roll on a "
                 "dual-axis Dynamixel — carries the head camera.",
        "why": "Looking is separated from driving on purpose. The controller "
               "recovers the operator's torso frame, so a glance moves only "
               "the neck while an actual turn of the body drives the base.",
        "specs": [["DOF", "3 — yaw, pitch, roll"],
                  ["Yaw", "DaMiao FOCGM43, CAN"],
                  ["Pitch / roll", "Dynamixel 2XL430-W250-T"],
                  ["Range", "±90° yaw, ±45° pitch and roll"],
                  ["Bus", "Protocol 2.0 serial, in-house driver"]],
        "files": [["Driver", "hardware_bridge/mabel_hw/drivers/dynamixel.py"],
                  ["ROS node", "mabel_ws/src/mabel_body_hardware/"]],
    },
    {
        "id": "sensors", "name": "Sensors", "kicker": "Seven streams",
        "sections": [],
        "choices": ["9.2", "9.3", "9.4", "9.5"],
        "blurb": "A stereo head camera, a depth camera on the base, one camera "
                 "per wrist and a 2-D lidar. Every one of them is a documented "
                 "choice with a cheap option and an expensive one.",
        "why": "The lidar is the one we recommend you not skip. It makes "
               "mapping a CPU job, which leaves the GPU for the policy — the "
               "visual SLAM stack wants the same GPU your model does.",
        "specs": [["Head", "stereo, 1280×720"],
                  ["Wrists", "2 × global shutter, one USB-2 hub"],
                  ["Base", "depth, optional"],
                  ["Lidar", "2-D, 12 m, 360 pts"],
                  ["Measured", "front 26 Hz · head 10–15 Hz · wrists 13–15 Hz"]],
        "gotcha": "The two wrist cameras share one USB-2 hub and cap at about "
                  "15 Hz for the pair. Pin them by hub port with udev, or they "
                  "swap sides on reboot.",
        "files": [["Camera notes", "sensors/CAMERA_DEBUG.md"],
                  ["udev rules", "hardware_bridge/install/"]],
    },
    {
        "id": "electronics", "name": "Electronics", "kicker": "Two rails",
        "sections": ["Electronics, power & cabling"],
        "choices": ["9.1"],
        "blurb": "One 24 V supply, one buck converter, and a 12 V rail under "
                 "it. Compute, the lift controller and the torso bus each get "
                 "their own line from the supply; everything else hangs off "
                 "the buck.",
        "why": "Motor spikes must not reach the compute. That is the whole "
               "reason for the split, and the reason nothing shares a return "
               "run with the lift — which draws the biggest current spike on "
               "the robot.",
        "specs": [["Primary", "24 V — compute, torso, lift"],
                  ["Secondary", "12 V via one buck converter"],
                  ["On 12 V", "6 base drivers, both hands, USB tree, neck"],
                  ["Network", "6-port 2.5 GbE switch"],
                  ["MCUs", "2 × Teensy 4.1 + 1 × RP2040 Pico"]],
        "gotcha": "The buck converter is a single point of failure. If the "
                  "hands, the base and the whole USB tree die at once, check "
                  "it first.",
        "files": [["Wiring guide", "assets/bom/MABEL_Wiring_Guide.pdf"],
                  ["HAL config", "hardware_bridge/mabel_hw/config.py"]],
    },
]


def load(name):
    with open(os.path.join(BOM, name)) as f:
        return list(csv.DictReader(f))


# Taobao and Amazon lines in the BOM often carry no URL — the guide tells you
# what to SEARCH for, because those listings move. Turning the recorded search
# string into a search URL keeps the page useful without pretending a dead
# product link is live; `search: true` lets the UI label it as a search.
def vendor_link(row, taobao):
    link = (row.get("link") or "").strip()
    if link:
        return link, False
    v = (row.get("vendor") or "").lower()
    item = (row.get("item") or "").strip()
    if "taobao" in v:
        q = taobao.get(item)
        if q:
            return ("https://s.taobao.com/search?q=" +
                    urllib.parse.quote(q)), True
    if "amazon" in v:
        return ("https://www.amazon.com/s?k=" +
                urllib.parse.quote(item + " " + (row.get("spec") or ""))), True
    if v and "." in v and "custom" not in v and v != "-":
        return "https://" + v.split()[0], False
    return "", False


def money(v):
    try:
        return float(v)
    except Exception:
        return 0.0


def main():
    core = load("core.csv")
    choices = load("choices.csv")
    taobao = {r["model"]: r["search_string"] for r in load("taobao.csv")}
    out = []
    for m in MODULES:
        parts, total = [], 0.0
        skip = set(m.get("skip", []))
        for r in core:
            if r["ref"] in skip:
                continue
            if r["section"] in m.get("sections", []) or r["ref"] in m.get("refs", []):
                qty = money(r["qty"]) or 1
                price = money(r["unit_price"])
                total += qty * price
                link, is_search = vendor_link(r, taobao)
                parts.append({"ref": r["ref"], "item": r["item"], "spec": r["spec"],
                              "qty": int(qty), "price": round(price, 2),
                              "vendor": r["vendor"], "link": link,
                              "search": is_search, "note": r.get("note", "")})
        opts = []
        for cid in m.get("choices", []):
            for r in choices:
                if r["choice_id"] != cid:
                    continue
                olink, osearch = vendor_link(
                    {"link": r["link"], "vendor": r["vendor"],
                     "item": r["option"], "spec": r["spec"]}, taobao)
                opts.append({"choice": r["choice"], "option": r["option"],
                             "spec": r["spec"], "qty": int(money(r["qty"]) or 1),
                             "price": round(money(r["unit_price"]), 2),
                             "tier": r["tier"], "vendor": r["vendor"],
                             "link": olink, "search": osearch})
        # a module's headline price is what it costs at the RECOMMENDED tier
        for cid in m.get("choices", []):
            same = [o for o in opts if o["choice"] ==
                    next(r["choice"] for r in choices if r["choice_id"] == cid)]
            pick = ([o for o in same if o["tier"] == "recommended"] or
                    [o for o in same if o["tier"] == "essential"] or same)
            if pick:
                total += pick[0]["price"] * pick[0]["qty"]
        rec = dict(m)
        rec.pop("sections", None); rec.pop("refs", None)
        rec.pop("skip", None); rec.pop("choices", None)
        rec["parts"] = parts
        rec["options"] = opts
        rec["price"] = round(total, 2)
        rec["img"] = f"assets/hw/{m['id']}.png"
        out.append(rec)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"generated_by": "scripts/build_hw_modules.py",
                   "source": "BOM/data/{core,choices}.csv",
                   "modules": out}, f, indent=1)
    print(f"wrote {os.path.relpath(OUT, SITE)}")
    for m in out:
        links = (sum(1 for p in m["parts"] if p["link"]) +
                 sum(1 for o in m["options"] if o["link"]))
        print(f"  {m['id']:12s} ${m['price']:>9,.0f}  "
              f"{len(m['parts']):2d} parts, {len(m['options'])} options, "
              f"{links} links")


if __name__ == "__main__":
    main()
