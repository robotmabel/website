#!/usr/bin/env python3
import argparse,asyncio,json,tempfile
from pathlib import Path
from aiohttp import ClientSession,WSMsgType
from experiment_server import scene_file
SITE=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser(description='Record actual MuJoCo motion through the simulation queue')
ap.add_argument('--endpoint',required=True);ap.add_argument('--robot-root',type=Path,required=True);args=ap.parse_args()
async def main():
 frames=[]
 async with ClientSession() as s:
  async with s.ws_connect(args.endpoint) as ws:
   await ws.send_json({'type':'queue_join','payload':{}})
   owner=False;started=None;sent=set()
   async for e in ws:
    if e.type!=WSMsgType.TEXT:continue
    m=json.loads(e.data)
    if m['type']=='sim_queue' and m['payload']['role']=='driver':owner=True
    if m['type']!='robot_state' or not owner:continue
    state=m['payload']['experiment'];started=state['time'] if started is None else started;t=state['time']-started
    for at,command in [(0,{'mode':'motion','speed':.65,'lift':0,'envelope':True}),(5,{'mode':'motion','speed':0}),(8,{'mode':'motion','lift':.55}),(12,{'mode':'motion','speed':.65}),(17,{'mode':'motion','speed':0}),(21,{'mode':'motion','speed':-.5}),(25,{'mode':'motion','speed':0})]:
     if t>=at and at not in sent:sent.add(at);await ws.send_json({'type':'experiment','payload':command})
    state['time']=round(t,4);state.pop('host',None);frames.append(state)
    if t>28:await ws.send_json({'type':'queue_leave','payload':{}});break
 _,blocks=scene_file(args.robot_root.resolve(),Path(tempfile.mkdtemp(prefix='mabel-motion-scene-')))
 (SITE/'assets/data/motion-replay.json').write_text(json.dumps(dict(engine='MuJoCo',method='Measured states from a separate SimWorld instance; no hand-animated motion',blocks=blocks,frames=frames),separators=(',',':'))+'\n')
 print('Frames',len(frames),'speed',max(f['speed'] for f in frames),'tilt',max(f['tilt'] for f in frames))
asyncio.run(main())
