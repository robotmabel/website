#!/usr/bin/env python3
"""Export the hardware light-test data used by the active RA-L latency section.

python3 scripts/build_latency.py --source /path/to/MILO/experiments/teleop_latency/results_g2g.json
"""
from pathlib import Path
import argparse,json
SITE=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--source',type=Path,required=True);a=ap.parse_args();raw=json.loads(a.source.read_text());rows=[]
 labels={'hotspot':('Robot hotspot','Direct Wi-Fi to the robot'),'lan':('LAN','Operator and robot on the local network'),'tailscale':('Tailscale','Private VPN connection'),'relay':('Public relay','Partly derived total; measured encode and transport')}
 for key,(name,sub) in labels.items():
  r=raw[key];g=r['g2g'];total=g['mean'];sd=g.get('sd');derived=r.get('derived',False)
  formatted=('≈' if derived else '')+str(round(total))
  if sd is not None:formatted+=' ± '+(str(round(sd,1)) if sd<1 else str(round(sd)))
  rows.append(dict(key=key,name=name,total=total,sd=sd,label=formatted+' ms',sub=sub,stages=r['stages'],derived=derived,trials=g.get('n'),trial_seconds=20,frames=g.get('frames_read'),p95=g.get('p95'),note=r.get('note','Gray-coded clock filmed by the head camera; both endpoints share one clock. Camera time is the residual after measured downstream stages.')))
 out=dict(generated_by='scripts/build_latency.py',source='MILO/experiments/teleop_latency/results_g2g.json',paper='Sections/12_experiments.tex · Teleoperation Latency',date='2026-10-27',units='ms',paths=rows)
 (SITE/'assets/data/latency.json').write_text(json.dumps(out,indent=2)+'\n');print('Latency export:',[(r['key'],r['label']) for r in rows])
if __name__=='__main__':main()
