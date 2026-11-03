#!/usr/bin/env python3
"""Export robot joint snapshots for orbitable, synchronized benchmark replays.

Runs the existing offline ablation harness. Only robot poses are exported;
the source human motion stays in its local dataset cache. No hardware is used.
"""
from pathlib import Path
import argparse,concurrent.futures,hashlib,json,os,sys,time
SITE=Path(__file__).resolve().parents[1]
def run_job(job):
 root,task,episode,method,seconds=job
 import numpy as np
 exp=Path(root)/'controller/experiments';sys.path[:0]=[str(exp/'retargeting_ablation'),str(exp),str(Path(root)/'controller')]
 import run as R
 if not hasattr(run_job,'episodes'):run_job.episodes=R.pick_episodes(20,select='spread')
 ep=next(e for e in run_job.episodes if e.task==task and e.index==episode)
 rig=R.AblationRig('map',method,ep)
 definitions=json.loads((SITE/'assets/mabel_joints.json').read_text())['joints'];addresses=[]
 lookup={rig.model.joint(i).name.lower().replace(' ','_'):i for i in range(rig.model.njnt)}
 for j in definitions:
  joint=lookup[j['name']];addresses.append(int(rig.model.jnt_qposadr[joint]))
 refs=np.array([j.get('ref',0) for j in definitions]);frames=[];clock=[];bases=[]
 class Complete(Exception):pass
 def capture(k,t,i,engine):
  if t>seconds:raise Complete()
  if k%3:return
  clock.append(round(float(t),4));frames.append(np.round(rig.data.qpos[addresses]-refs,5).tolist());bases.append(np.round(rig.data.qpos[:7],5).tolist())
 started=time.monotonic()
 try:rig.run(ep,on_tick=capture)
 except Complete:pass
 finally:
  pool=getattr(rig.teleop.controller,'_pool',None)
  if pool:pool.shutdown(wait=True)
 assert len(frames)>5,(task,method,'No replay frames')
 out=SITE/'assets/retarget/replays';out.mkdir(exist_ok=True)
 target=out/(task+'__ep'+str(episode)+'__'+method+'.json')
 target.write_text(json.dumps(dict(task=task,episode=episode,method=method,t=clock,q=frames,base=bases),separators=(',',':'))+'\n')
 return task,method,len(frames),round(time.monotonic()-started,1)
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--robot-root',type=Path,required=True);ap.add_argument('--workers',type=int,default=4);ap.add_argument('--seconds',type=float,default=6);ap.add_argument('--task');ap.add_argument('--method');args=ap.parse_args()
 index=json.loads((SITE/'assets/retarget/index.json').read_text());jobs=[]
 labels={t['id']:t['label'] for t in index['tasks']}
 rows=json.loads((SITE/'assets/data/retarget-compare.json').read_text())['rows']['ours']
 index['tasks']=[dict(id=r['task'],label=labels[r['task']],episode=r['episode']) for r in rows]
 for task in index['tasks']:
  if args.task and task['id']!=args.task:continue
  for method in index['methods']:
   if args.method and method['id']!=args.method:continue
   target=SITE/'assets/retarget/replays'/(task['id']+'__ep'+str(task['episode'])+'__'+method['id']+'.json')
   old=SITE/'assets/retarget/replays'/(task['id']+'__'+method['id']+'.json')
   if old.exists() and json.loads(old.read_text())['episode']==task['episode']:old.rename(target)
   if target.exists():continue
   jobs.append((str(args.robot_root.resolve()),task['id'],task['episode'],method['id'],args.seconds))
 with concurrent.futures.ProcessPoolExecutor(args.workers) as pool:
  for result in pool.map(run_job,jobs):print(*result,flush=True)
 definitions=json.loads((SITE/'assets/mabel_joints.json').read_text())['joints']
 meta=dict(source='Existing offline retargeting ablation harness',robot_pose_only=True,joints=[j['name'] for j in definitions],source_sha256=hashlib.sha256((args.robot_root/'controller/experiments/retargeting_ablation/run.py').read_bytes()).hexdigest(),tasks=[])
 for task in index['tasks']:
  methods={m['id']:'assets/retarget/replays/'+task['id']+'__ep'+str(task['episode'])+'__'+m['id']+'.json' for m in index['methods'] if (SITE/'assets/retarget/replays'/(task['id']+'__ep'+str(task['episode'])+'__'+m['id']+'.json')).exists()}
  if methods:meta['tasks'].append(dict(id=task['id'],label=task['label'],episode=task['episode'],methods=methods))
 labels={'wrist_ik':'Frozen fingers','wb_ik':'Posture variant','gmr':'GMR-like','ours':'MABEL'}
 meta['methods']=[dict(id=m['id'],label=labels.get(m['id'],m['label'])) for m in index['methods']]
 (SITE/'assets/data/retarget-replays.json').write_text(json.dumps(meta,indent=2)+'\n')
if __name__=='__main__':main()
