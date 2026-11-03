#!/usr/bin/env python3
"""Export the current hand-grasping dataset, training split and camera examples.

Reads the LeRobot export and the run's saved config/report/split. Only aggregate
statistics and synchronized camera excerpts are published; local take paths stay local.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess
SITE=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--dataset',type=Path,required=True)
 ap.add_argument('--run',type=Path,required=True)
 ap.add_argument('--export-gb',type=float,default=1.5)
 ap.add_argument('--cache-gb',type=float,default=5.1)
 ap.add_argument('--preview-episode',type=int,default=20)
 ap.add_argument('--preview-frame',type=int,default=272)
 ap.add_argument('--preview-start-frame',type=int,default=0)
 ap.add_argument('--preview-frames',type=int)
 a=ap.parse_args()
 sources={name:path for name,path in [('info',a.dataset/'meta/info.json'),('config',a.run/'config.json'),('report',a.run/'data_report.json'),('split',a.run/'split.json'),('stats',a.run/'stats.json')]}
 docs={k:json.loads(p.read_text()) for k,p in sources.items()};info=docs['info'];cfg=docs['config'];report=docs['report'];split=docs['split'];stats=docs['stats']
 fps=info['fps'];assert cfg['dataset']==a.dataset.name
 assert sum(v['frames'] for v in report['split'].values())==info['total_frames']==report['rows']
 assert sum(v['episodes'] for v in report['split'].values())==info['total_episodes']
 # Every episode of a take must retain that take's split.
 episodes=[json.loads(line) for line in (a.dataset/'meta/milo_episodes.jsonl').read_text().splitlines()]
 take_split={Path(k).name:v for k,v in split['by_take'].items()}
 for ep in episodes:
  take=Path(ep['raw']).name
  assert split['by_episode'][str(ep['episode_index'])]==take_split[take], 'Take leakage in saved split'
 groups=[dict(name=n,count=c) for n,c in [('Arms',14),('Hands + wrists',34),('Neck',3),('Torso',1),('Lift',1),('Swerve',6)]]
 state_count=len(stats['state']['mean']);action_count=len(stats['action']['mean']);assert sum(g['count'] for g in groups)==state_count
 cameras=[{'key':c,'label':{'head_left':'Left head','wrist_left':'Left wrist','wrist_right':'Right wrist'}[c]} for c in cfg['cameras']]
 preview=next(ep for ep in episodes if ep['episode_index']==a.preview_episode);assert a.preview_frame<preview['frames']
 start=a.preview_start_frame;end=min(preview['frames'],start+(a.preview_frames or preview['frames']))
 assert 0<=start<end
 out=SITE/'assets/learning';out.mkdir(exist_ok=True)
 for c in cameras:
  c['image']='assets/learning/hand-v2-'+c['key']+'.jpg'
  c['video']='assets/learning/hand-v2-'+c['key']+'.mp4'
  src=a.dataset/info['video_path'].format(video_key='observation.images.'+c['key'],chunk_index=0,file_index=a.preview_episode)
  subprocess.run(['ffmpeg','-v','error','-y','-ss',str(a.preview_frame/fps),'-i',str(src),'-frames:v','1','-q:v','3','-threads','1',str(SITE/c['image'])],check=True)
  subprocess.run(['ffmpeg','-v','error','-y','-i',str(src),'-vf',f'trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS,scale={cfg["image_size"][1]}:{cfg["image_size"][0]}',
                  '-an','-c:v','libx264','-profile:v','main','-pix_fmt','yuv420p','-crf','24','-preset','medium','-r',str(fps),'-g',str(fps),'-movflags','+faststart','-threads','2',str(SITE/c['video'])],check=True)
 data=dict(source='hand_pick_n_place_v2 export and act_v2 saved training reports',source_sha256={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in sources.items()},recording=dict(camera_hz=fps,control_hz=50,coordinates=state_count,action_channels=action_count,cameras=cameras,image_size_hw=cfg['image_size'],history_seconds=cfg['history_s'],history_hz=1/cfg['history_stride_s']),chunk=dict(steps=report['chunk'],hz=fps,execute_seconds=cfg['n_action_steps']/fps,temporal_ensembling=cfg['act']['temporal_ensemble_coeff'] is not None),state_groups=groups,dataset=dict(id=a.dataset.name,version=2,frames=info['total_frames'],episodes=info['total_episodes'],takes=sum(v['takes'] for v in report['split'].values()),seconds=info['total_frames']/fps,minutes=round(info['total_frames']/fps/60,1),hours=round(info['total_frames']/fps/3600,2),fps=fps,camera_videos=sum(v['dtype']=='video' for v in info['features'].values()),export_gb=a.export_gb,frame_cache_gb=a.cache_gb,split_percent=[round(v*100) for v in cfg['split']],seed=cfg['seed'],splits=[dict(key=k,label={'train':'Train','val':'Validation','test':'Test'}[k],**v,minutes=round(v['frames']/fps/60,1)) for k,v in report['split'].items()],validation_clips=cfg['val_clips'],eval_every_steps=cfg['eval_every'],quality=dict(held_command_rows=report['held_log_rows'],interpolated_joint_rows=report['interpolated_joint_rows'],max_gap_seconds=cfg['max_interp_s'],stale_camera_rows=report['stale_video_rows'],unusable_joint_rows=report['bad_prop_rows'],dropped_clips=report['dropped_clips']),preview=dict(episode=a.preview_episode,frame=a.preview_frame,seconds=round(a.preview_frame/fps,3))))
 data['dataset']['preview'].update(start_frame=start,video_frames=end-start,duration_seconds=(end-start)/fps)
 (SITE/'assets/data/learning-pipeline.json').write_text(json.dumps(data,indent=2)+'\n')
 print(f"Dataset v2: {data['dataset']['takes']} takes, {info['total_episodes']} episodes, {info['total_frames']:,} frames; take split verified")
if __name__=='__main__':main()
