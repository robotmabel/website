#!/usr/bin/env python3
"""Build the Sony teleop demo grid and campus clips from an author source map.

The source map records key, label, path, original_name, start, duration,
speed and collection. Frames are preserved, without added blur or retouching.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse,json,subprocess
SITE=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--sources',type=Path,required=True);args=ap.parse_args();rows=json.loads(args.sources.read_text());out=SITE/'assets/demos';out.mkdir(exist_ok=True)
 def one(row):
  for suffix,width,crf in [('',960,24),('-lo',480,27)]:
   dest=out/(row['key']+suffix+'.mp4')
   if dest.exists():continue
   subprocess.run(['ffmpeg','-v','error','-y','-ss',str(row['start']),'-t',str(row['duration']),'-i',row['path'],'-an','-map_metadata','-1','-vf',f"setpts=(PTS-STARTPTS)/{row['speed']},fps=24,scale={width}:-2,setsar=1",'-c:v','libx264','-preset','fast','-crf',str(crf),'-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(dest)],check=True)
  poster=out/(row['key']+'.jpg')
  if not poster.exists():subprocess.run(['ffmpeg','-v','error','-y','-ss','0.4','-i',str(out/(row['key']+'.mp4')),'-frames:v','1','-threads','1','-q:v','4',str(poster)],check=True)
  result={k:v for k,v in row.items() if k!='path'};result.update(video='assets/demos/'+row['key']+'.mp4',lo='assets/demos/'+row['key']+'-lo.mp4',poster='assets/demos/'+row['key']+'.jpg');print(row['key'],'ready',flush=True);return result
 with ThreadPoolExecutor(max_workers=2) as pool:data=list(pool.map(one,rows))
 (SITE/'assets/data/demo-gallery.json').write_text(json.dumps(dict(source='Sony camera originals and Sony exports used in the submission',clips=data),indent=2)+'\n')
if __name__=='__main__':main()
