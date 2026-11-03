#!/usr/bin/env python3
"""Export the paper's frozen base measurements for the website replay."""
from pathlib import Path
import argparse,csv,gzip,hashlib,io,json,math
SITE=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--paper',type=Path,required=True);args=ap.parse_args();source=args.paper/'Figures/src/mobile_base_odometry_v1';manifest=json.loads((source/'trials.json').read_text());runs=[]
 for meta in manifest['trials']:
  compressed=(source/meta['csv_file']).read_bytes();assert hashlib.sha256(compressed).hexdigest()==meta['gzip_sha256'];raw=gzip.decompress(compressed);assert hashlib.sha256(raw).hexdigest()==meta['csv_sha256'];rows=list(csv.DictReader(io.StringIO(raw.decode())));m=meta['metrics'];assert len(rows)==m['samples']
  rms=math.sqrt(sum(float(r['error_x_mm'])**2+float(r['error_y_mm'])**2 for r in rows)/len(rows));assert abs(rms-m['xy_mm']['rms'])<1e-6
  keep=list(range(0,len(rows),3));keep.append(len(rows)-1)
  fields=['time_s','wheel_x_m','wheel_y_m','wheel_yaw_rad','vio_x_m','vio_y_m','imu_yaw_rad','error_x_mm','error_y_mm']
  runs.append(dict(id=meta['key'],label='Turn + square' if meta['key']=='path' else 'Repeated paths · partial',completed=m['completed'],seconds=m['duration_s'],distance_m=m['distance_5hz_m'],position_rms_mm=rms,yaw_rms_deg=m['yaw_imu_deg']['rms'],source_sha256=meta['csv_sha256'],fields=fields,samples=[[round(float(rows[i][f]),5) for f in fields] for i in keep]))
 runs.sort(key=lambda r:r['id']!='path');(SITE/'assets/data/base-odometry.json').write_text(json.dumps(dict(source='Frozen wheel odometry and independent ZED VIO / IMU comparison; no fitted lag, rotation or scale.',runs=runs),separators=(',',':'))+'\n')
 print('Verified and exported',len(runs),'recorded base tests')
if __name__=='__main__':main()
