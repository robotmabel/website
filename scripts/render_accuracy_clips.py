"""The accuracy lab's two clips: the SAME renders the submission video shows.

hardware.html's accuracy panels play the two "tests" panels of the RA-L
submission video (tests_separate_0 = repeatability, tests_separate_1 = path
following), rendered by marketing/ral_video/tools/render_v16_tests.py from the
2026-10-08 hardware logs — every link posed by the URDF forward kinematics of
the measured joints, every dot a measured return hold, every drawn path the
measured palm. Reusing the render (rather than re-rendering) means the site and
the video cannot show two different robots doing two different runs.

The page draws its plots IN STEP with these clips, using the render's own
clock, which scripts/build_accuracy.py exports into accuracy.json (clip_s,
path_split_s, each visit's `vt`, each synced condition's `sync`). Change the
render's timing and both must be regenerated together.

    python3 scripts/render_accuracy_clips.py [--src DIR]

Reads:  <src>/tests_separate_{0,1}.mov   (ProRes, 900×720, 50 fps, 9.2 s)
        default: ../marketing/ral_video/renders/v16_grid/refined_media
Writes: assets/accuracy/{repeat,path}.mp4 (+ -lo.mp4, .jpg) and index.json
"""
import argparse
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
ROOT = os.path.dirname(SITE)
OUT = os.path.join(SITE, "assets", "accuracy")
CLIPS = {
    "repeat": ("tests_separate_0.mov", "ISO 9283 on the real robot: 10 cycles, every return hold marked"),
    "path": ("tests_separate_1.mov", "Spiral, then square, both palms, torso at 0°"),
}


def ff(*a):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ROOT, "marketing", "ral_video", "renders", "v16_grid", "refined_media"))
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    idx = {"generated_by": "website/scripts/render_accuracy_clips.py",
           "note": "the submission video's test panels, re-encoded; plots sync to the render's clock (accuracy.json)",
           "clips": {}}
    for key, (src, title) in CLIPS.items():
        f = os.path.join(a.src, src)
        o = os.path.join(OUT, key)
        # -map_metadata -1: no encoder/host/path tags in a public file
        ff("-i", f, "-map_metadata", "-1", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", o + ".mp4")
        ff("-i", f, "-map_metadata", "-1", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "29",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "25", "-vf", "scale=480:384", o + "-lo.mp4")
        ff("-ss", "7.5", "-i", f, "-frames:v", "1", "-map_metadata", "-1", "-q:v", "5", o + ".jpg")
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", o + ".mp4"],
                                   capture_output=True, text=True, check=True).stdout)
        idx["clips"][key] = {"clip": key + ".mp4", "lo": key + "-lo.mp4", "poster": key + ".jpg",
                             "w": 900, "h": 720, "duration_s": round(dur, 2), "title": title}
        print(f"{key}: {os.path.getsize(o + '.mp4') / 1024:.0f} kB + lo {os.path.getsize(o + '-lo.mp4') / 1024:.0f} kB, {dur:.2f} s")
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(idx, fh, indent=1)


if __name__ == "__main__":
    main()
