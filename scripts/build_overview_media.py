#!/usr/bin/env python3
"""Extract Overview clips from the reviewed v21 submission, without audio or reframing.

python3 scripts/build_overview_media.py --video /path/to/MABEL_RAL_v21_clean_master.mp4
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse, subprocess
SITE=Path(__file__).resolve().parents[1]
# Windows from marketing/ral_video/renders/v21/section_plan.json.
WINDOWS=[('local',79.26,11.7),('global',90.96,7.54),('sim-twin',57.56,2.94),('sim-scenes',60.5,4.28),('control',106.82,5.9),('compliance',112.72,5.18),('motion',117.9,7.3),('learning',139.96,11.34)]
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--video',type=Path,required=True);a=ap.parse_args()
    out=SITE/'assets/overview';out.mkdir(exist_ok=True)
    def one(row):
        key,start,duration=row
        for suffix,width,crf in [('',960,24),('-lo',480,27)]:
            subprocess.run(['ffmpeg','-v','error','-y','-ss',str(start),'-i',str(a.video),'-t',str(duration),'-an','-vf',f'scale={width}:-2,fps=25','-c:v','libx264','-preset','fast','-crf',str(crf),'-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',str(out/(key+suffix+'.mp4'))],check=True)
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(out/(key+'.mp4')),'-vf','scale=640:-2,format=yuvj420p','-frames:v','1','-threads','1','-q:v','4',str(out/(key+'.jpg'))],check=True)
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(one,WINDOWS))
if __name__=='__main__':main()
