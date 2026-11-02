#!/usr/bin/env python3
"""Encode the original campus footage without added blur or background processing.

python3 scripts/build_street_media.py --source-dir /path/to/Sony/clips
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse,subprocess
SITE=Path(__file__).resolve().parents[1]
CLIPS=[('t-field-wave','C0036.mov',.55),('t-field-arms','C0037.mov',.55),('t-field-reach','C0037 2.mov',.50),('t-path','C0039.mov',.55)]
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--source-dir',type=Path,required=True);args=ap.parse_args()
    def one(row):
        key,source,center=row
        # Keep the original 4:3 gallery composition; no masks, blur, or retouching.
        for suffix,width,crf in [('-original',960,25),('-original-lo',480,28)]:
            crop=f'crop=ih*4/3:ih:max(0\\,min(iw-ih*4/3\\,iw*{center}-ih*2/3)):0'
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(args.source_dir/source),'-an','-map_metadata','-1','-vf',crop+f',fps=24,scale={width}:-2','-c:v','libx264','-preset','fast','-crf',str(crf),'-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(SITE/'assets/wild'/(key+suffix+'.mp4'))],check=True)
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(SITE/'assets/wild'/(key+'-original.mp4')),'-frames:v','1','-threads','1','-q:v','3',str(SITE/'assets/wild'/(key+'-original.jpg'))],check=True)
        print(key,'original footage ready',flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(one,CLIPS))
if __name__=='__main__':main()
