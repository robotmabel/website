#!/usr/bin/env python3
"""Export the active paper's ACT interface and experiment for the website."""
from pathlib import Path
import argparse,json,re,hashlib
SITE=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--paper',type=Path,required=True);a=ap.parse_args()
 def active(name):return '\n'.join(x for x in (a.paper/'Sections'/name).read_text().splitlines() if not x.lstrip().startswith('%'))
 infra=active('11_autonomy.tex');exp=active('12_experiments.tex')
 patterns=[r'collected (\d+) whole-body',r'segmented into (\d+) episodes',r'totaling \\SI\{([\d.]+)\}\{min\}',r'K=(\d+)',r'split by take \((\d+)/(\d+)/(\d+) train/val/test\)',r'train for ([\d{},]+) steps with batch size (\d+)',r'policy succeeds in (\d+)']
 values=[re.search(p,exp) for p in patterns];assert all(values),'Paper learning interface changed: review the export'
 demos,episodes,minutes,steps,split,training,success=values
 out=dict(source='Active RA-L paper · Simulation and Learning Infrastructure; Policy Learning',paper_sha256=hashlib.sha256((infra+exp).encode()).hexdigest(),recording=dict(camera_hz=30,control_hz=50,coordinates=59,cameras=['Left head','Left wrist','Right wrist'],image_size=[320,240],history_seconds=1,history_hz=5),chunk=dict(steps=int(steps[1]),hz=30,execute_seconds=1,temporal_ensembling=False),state_groups=[dict(name=n,count=c) for n,c in [('Arms',14),('Hands + wrists',34),('Neck',3),('Torso',1),('Lift',1),('Swerve',6)]],experiment=dict(demonstrations=int(demos[1]),episodes=int(episodes[1]),minutes=float(minutes[1]),split=[int(n) for n in split.groups()],train_steps=int(re.sub(r'[^\d]','',training[1])),batch_size=int(training[2]),hours=6,device='Apple M1 Max',successes=int(success[1]),trials=10,timeout_seconds=60,placement_cm=[20,20],scope='Grasp-and-place with both ORCA hands. Demonstrations were mostly upper-body; the base and lift stayed near their initial configuration.'))
 assert sum(g['count'] for g in out['state_groups'])==out['recording']['coordinates']
 (SITE/'assets/data/learning-pipeline.json').write_text(json.dumps(out,indent=2)+'\n');print('Learning overview exported from active paper')
if __name__=='__main__':main()
