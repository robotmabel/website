#!/usr/bin/env python3
"""Export measured arm/torso poses, never per-link mesh overrides.

Uses the same hardware logs and time mapping as build_accuracy.py. Hand joints
were not logged by these tests; the complete assembled hands remain at rest.
The path plot reports the original three-trial aggregate; the viewer replays
trial 0. No metric is recomputed or altered here.
"""
import argparse,gzip,json,sys
from pathlib import Path
import numpy as np
SITE=Path(__file__).resolve().parents[1]
JOINTS=[f'{s}_arm_{i}' for s in ['left','right'] for i in range(1,8)]+['torso']
def load(path):
 with gzip.open(path,'rt') as f:return [json.loads(line) for line in f if line.strip()]
def pack(rows,times,query):
 q=np.array([[r['jointPositions'].get(n,0) for n in JOINTS] for r in rows]);t=np.array(times)
 return np.round(np.column_stack([np.interp(query,t,q[:,i]) for i in range(len(JOINTS))]),6).tolist()
def main():
 a=argparse.ArgumentParser();a.add_argument('--archive',type=Path,required=True);args=a.parse_args();exp=args.archive/'experiments'
 rows=[r for f in sorted((exp/'repeatability/data').glob('real_cycle*.jsonl.gz')) for r in load(f) if 'jointPositions' in r]
 t=np.array([r['t']-rows[0]['t'] for r in rows]);end=next(r['t'] for r in reversed(rows) if r.get('cycle')==rows[0]['cycle'])-rows[0]['t'];vt=np.linspace(0,9.2,1105)
 source=np.where(vt<=5,vt/5*end,np.where(vt<8.5,end+(vt-5)/3.5*(t[-1]-end),t[-1]))
 indices=np.minimum(np.searchsorted(t,source),len(rows)-1)
 rep=dict(t=np.round(vt,4).tolist(),q=pack(rows,t,source),station=[rows[i].get('station','HOME') for i in indices],cycle=[rows[i].get('cycle',0) for i in indices])
 refs=json.loads((exp/'path_following/data/reference_real.json').read_text());paths={}
 for f in sorted((exp/'path_following/data').glob('real_*_torso*_t0.jsonl.gz')):
  allrows=load(f);h=allrows[0]['header'];rr=[r for r in allrows if 'jointPositions' in r];ts=np.array([r['t']-rr[0]['t'] for r in rr]);vt=np.linspace(0,4.6,553);query=vt/4.6*ts[-1];ix=np.minimum(np.searchsorted(ts,query),len(rr)-1);ref=refs[h['reference']]
  paths[h['reference']]=dict(t=np.round(vt,4).tolist(),q=pack(rr,ts,query),x=[round(rr[i]['k']*ref['dt'],4) if rr[i].get('phase')=='trace' else None for i in ix],phase=[rr[i].get('phase','') for i in ix],trial=0)
 doc=dict(generated_by='scripts/build_accuracy_replays.py',source='Real robot hardware logs · 2026-10-08',joints=JOINTS,hand_state='Hand joints were not recorded; complete hands shown at their assembled rest pose.',repeat=rep,path=paths)
 out=SITE/'assets/data/accuracy-replays.json';out.write_text(json.dumps(doc,separators=(',',':'))+'\n');print(out.name,out.stat().st_size,'bytes',len(rows),'measured repeatability rows',len(paths),'path conditions')
if __name__=='__main__':main()
