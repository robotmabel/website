#!/usr/bin/env python3
"""Isolated, simulation-only MuJoCo experiments with a 120 s public FIFO lease.

No hardware imports, device access, shell commands or arbitrary file paths in
client messages. Uses a separate SimWorld instance and state file. Rendering
runs in each visitor's browser; the 5080 only steps CPU physics.
"""
import argparse,asyncio,contextlib,json,math,os,sys,threading,time
from pathlib import Path
import numpy as np
from aiohttp import web,WSMsgType
from sim_queue_server import SimulationQueue

def scene_file(root,cache):
 cache.mkdir(parents=True,exist_ok=True)
 blocks=[dict(x=float(x),y=float(side*8),sx=2.3,sy=2.0,h=float(5+(i*7+side)%9)) for side in [-1,1] for i,x in enumerate(range(-36,37,7))]
 scene=cache/'nyc-night.xml'
 model=(root/'simulation/mabel_mujoco/models/mabel_full.xml').resolve()
 geometry=''.join(f'<geom name="city_{i}" type="box" pos="{b["x"]} {b["y"]} {b["h"]/2}" size="{b["sx"]} {b["sy"]} {b["h"]/2}" rgba=".05 .07 .12 1"/>' for i,b in enumerate(blocks))
 scene.write_text(f'<mujoco model="MABEL NYC night"><compiler angle="radian"/><option gravity="0 0 -9.81" timestep="0.002" integrator="implicitfast" cone="elliptic"/><include file="{model}"/><worldbody><geom name="street" type="plane" size="80 12 .1" friction="1.5 .05 .001" rgba=".04 .05 .08 1"/>{geometry}</worldbody></mujoco>')
 return scene,blocks

class Experiment:
 def __init__(self,root,assets,cache):
  sys.path[:0]=[str(root),str(root/'controller')];os.environ['MABEL_ROOT']=str(root);os.environ['MABEL_SIM_SENSORS']='0'
  # Never share the regular simulator's memmap, lock, RPC port or process.
  os.environ['MABEL_STATE_FILE']=str(cache/'physics.f64');os.environ['MABEL_SIM_LOCK']=str(cache/'physics.lock')
  from simulation_bridge.engine import SimWorld
  from mabel.motion_model.tip_over import safe_base_step,max_speed
  self.safe_step,self.max_speed=safe_base_step,max_speed
  scene,self.blocks=scene_file(root,cache);self.world=SimWorld(str(scene),instance='website_experiments');self.assets=assets
  self.defs=json.loads((assets/'mabel_joints.json').read_text())['joints'];m=self.world.model
  lookup={m.joint(i).name.lower().replace(' ','_'):i for i in range(m.njnt)}
  self.qadr=[int(m.jnt_qposadr[lookup[j['name']]]) for j in self.defs];self.refs=np.array([j.get('ref',0) for j in self.defs])
  self.act={}
  for n in self.world._servo_acts:
   a=m.actuator(n).id;jid=int(m.actuator_trnid[a,0]);name=m.joint(jid).name.lower().replace(' ','_')
   idx=next((i for i,j in enumerate(self.defs) if j['name']==name),None)
   if idx is not None:self.act[n]=idx
  self.thread=threading.Thread(target=self.world.run,daemon=True);self.thread.start()
  self.lift=float(self.world.data.actuator('Lift').ctrl[0]);self.mode='motion';self.command=dict(speed=0.,turn=0.,lift=self.lift,envelope=True);self.velocity=(0.,0.,0.);self.phase=0;self.replay=None;self.replay_info=None;self.closed=False;self.tasks=[];self.peers=set();self.last_state={};self.error=''
 def reset(self):
  self.command=dict(speed=0.,turn=0.,lift=self.lift,envelope=True);self.velocity=(0.,0.,0.);self.replay=None;self.phase=0;self.world.reset(wait=True);self.lift=float(self.world.data.actuator('Lift').ctrl[0]);self.command['lift']=self.lift;self.replay_info=None;self.world.set_estop(False)
 def finite(self,v,lo,hi):
  if not isinstance(v,(int,float)) or not math.isfinite(v):raise ValueError('Expected a finite number')
  return min(hi,max(lo,float(v)))
 def handle(self,message):
  kind=message.get('type');p=message.get('payload') or {}
  if kind=='reset':self.reset();return
  if kind=='estop':self.world.set_estop(bool(p.get('active',True)));self.command['speed']=0;self.command['turn']=0;return
  if kind!='experiment':return
  mode=p.get('mode','motion')
  if mode=='motion':
   if self.mode!=mode:self.reset()
   self.mode=mode
   for key,lo,hi in [('speed',-1.2,1.2),('turn',-1.2,1.2),('lift',0,.635)]:
    if key in p:self.command[key]=self.finite(p[key],lo,hi)
   if 'envelope' in p:self.command['envelope']=bool(p['envelope'])
  elif mode=='retarget':
   # Resolve only entries in the robot-pose manifest, never a client path.
   index=json.loads((self.assets/'data/retarget-replays.json').read_text())
   task=next((t for t in index['tasks'] if t['id']==p.get('task') and t['episode']==p.get('episode')),None)
   if not task or p.get('method') not in task['methods']:raise ValueError('Unknown recorded episode or method')
   path=(self.assets.parent/task['methods'][p['method']]).resolve()
   if self.assets.resolve() not in path.parents:raise ValueError('Invalid replay')
   replay=json.loads(path.read_text());self.reset();self.mode=mode;self.replay=replay;self.replay_info={k:replay[k] for k in ['task','episode','method']}
  else:raise ValueError('Unknown experiment')
 async def clock(self):
  previous=time.monotonic();last_t=-1;last_pos=None
  try:
   while True:
    started=time.monotonic();dt=min(.1,started-previous);previous=started
    if self.mode=='motion':
     self.lift+=max(-.06*dt,min(.06*dt,self.command['lift']-self.lift))
     target=(-self.command['speed'],0.,self.command['turn'])
     self.velocity=self.safe_step(*self.velocity,*target,max(dt,.001),self.lift) if self.command['envelope'] else target
     self.world.set_twist(*self.velocity)
     # The Lift actuator drives the coupled two-stage column.
     if 'Lift' in self.world._servo_acts:self.world.set_targets({'Lift':self.lift})
    elif self.replay:
     self.phase+=dt;end=self.replay['t'][-1]
     t=min(self.phase,end);i=max(0,int(np.searchsorted(self.replay['t'],t,side='right')-1))
     q=np.asarray(self.replay['q'][i])+self.refs
     self.world.set_targets({n:float(q[ix]) for n,ix in self.act.items()});self.world.set_twist(0,0,0)
     if self.phase>end+1:self.world.reset(wait=True);self.phase=0
    d=self.world.data;qp=d.qpos.copy();ts=float(d.time);base=qp[:7].tolist();q=(qp[self.qadr]-self.refs).tolist()
    qw,qx,qy,qz=base[3:];tilt=math.degrees(math.acos(max(-1,min(1,1-2*(qx*qx+qy*qy)))))
    position=np.array(base[:2]);speed=float(np.linalg.norm(position-last_pos)/max(ts-last_t,.00001)) if last_pos is not None and ts>last_t else 0.;last_pos=position;last_t=ts
    self.last_state=dict(mode=self.mode,time=ts if self.mode=='motion' else self.phase,q=q,base=base,speed=speed,tilt=tilt,lift=self.lift,envelope=self.command['envelope'],limit=self.max_speed(self.lift),rate=self.world.rate_hz,engine='MuJoCo',host=os.environ.get('MABEL_EXPERIMENT_HOST','MuJoCo host'),replay=self.replay_info)
    msg=dict(type='robot_state',payload=dict(experiment=self.last_state))
    for ws in list(self.peers):
     try:await asyncio.wait_for(ws.send_json(msg),.3)
     except Exception:self.peers.discard(ws)
    await asyncio.sleep(max(.001,.05-(time.monotonic()-started)))
  finally:self.world.set_twist(0,0,0)
 async def upstream(self,request):
  # Caddy exposes /teleop only, never this internal connection.
  if request.remote not in ['127.0.0.1','::1']:raise web.HTTPForbidden()
  ws=web.WebSocketResponse(heartbeat=15,max_msg_size=65536);await ws.prepare(request);self.peers.add(ws)
  await ws.send_json(dict(type='hello',payload=dict(kind='sim',engine='MuJoCo',experiment=True)))
  try:
   async for ev in ws:
    if ev.type!=WSMsgType.TEXT:continue
    try:self.handle(json.loads(ev.data))
    except (ValueError,TypeError,KeyError) as e:await ws.send_json(dict(type='experiment_error',payload=dict(message=str(e))))
  finally:self.peers.discard(ws)
  return ws
 async def api_state(self,request):
  snap=self.world.snapshot();positions={k.lower().replace(' ','_'):v[0] for k,v in snap['joints'].items()};velocities={k.lower().replace(' ','_'):v[1] for k,v in snap['joints'].items()}
  groups={'left_arm':lambda n:n.startswith('left_arm_'),'right_arm':lambda n:n.startswith('right_arm_'),'torso':lambda n:n=='torso','neck':lambda n:n=='neck_yaw','neck_servos':lambda n:n in ['neck_pitch','neck_roll'],'left_hand':lambda n:n.startswith('left_') and not n.startswith('left_arm_'),'right_hand':lambda n:n.startswith('right_') and not n.startswith('right_arm_'),'base':lambda n:n.endswith(('_steer','_drive'))}
  modules={name:dict(connected=True,live=sum(1 for n in positions if pick(n)),n=sum(1 for n in positions if pick(n)),torque=True,rateHz=snap['rateHz']) for name,pick in groups.items()};modules['lift']=dict(connected=True,live=1,n=1,torque=True,rateHz=snap['rateHz'])
  return web.json_response(dict(timestamp=time.time(),plant='sim',jointPositions=positions,jointVelocities=velocities,live={k:True for k in positions},base=snap['base'],estop=snap['estop'],rateHz=snap['rateHz'],controlMode=dict(arms='position',base='twist'),torque=dict(any=True,modules=modules),lift=dict(live=True,calibrated=True,height=self.lift,min=0,max=.635,mode='sim'),experiment=self.last_state))
 async def hello(self,request):return web.json_response(dict(name='MABEL experiments',kind='sim',host='Simulation',server='mabel_simulation_bridge',version='1',wsPort=request.url.port,wsPath='/teleop'))
 async def start(self,app):self.tasks=[asyncio.create_task(self.clock())]
 async def stop(self,app):
  for t in self.tasks:t.cancel()
  await asyncio.gather(*self.tasks,return_exceptions=True);self.world.stop();self.thread.join(3)

def make_app(root,assets,cache,port,lease=120):
 exp=Experiment(root,assets,cache);gate=SimulationQueue(f'ws://127.0.0.1:{port}/upstream',lease)
 app=web.Application(client_max_size=65536);app['experiment']=exp;app['queue']=gate
 async def public_ws(request):
  origin=request.headers.get('Origin','')
  if origin and origin not in ['https://robotmabel.github.io','http://localhost:8742','http://127.0.0.1:8742']:raise web.HTTPForbidden(text='Unsupported origin')
  return await gate.websocket(request)
 app.router.add_get('/upstream',exp.upstream);app.router.add_get('/teleop',public_ws);app.router.add_get('/healthz',gate.health);app.router.add_get('/api/state',exp.api_state);app.router.add_get('/api/hello',exp.hello)
 # The public tunnel gets an allowlisted listener. Internal state APIs and
 # /upstream never pass through Funnel, so spectators cannot bypass the lease.
 public=web.Application(client_max_size=65536);public.router.add_get('/teleop',public_ws);public.router.add_get('/healthz',gate.health)
 async def public_start(app):
  runner=web.AppRunner(public,access_log=None);await runner.setup();app['public_runner']=runner;await web.TCPSite(runner,'127.0.0.1',port+1).start()
 async def public_stop(app):await app['public_runner'].cleanup()
 app.on_startup.extend([exp.start,gate.start,public_start]);app.on_shutdown.append(gate.stop);app.on_cleanup.extend([public_stop,exp.stop]);return app
if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--robot-root',type=Path,required=True);ap.add_argument('--assets',type=Path,required=True);ap.add_argument('--cache',type=Path,required=True);ap.add_argument('--port',type=int,default=18824);ap.add_argument('--lease-seconds',type=int,default=120);a=ap.parse_args();a.cache.mkdir(parents=True,exist_ok=True)
 web.run_app(make_app(a.robot_root.resolve(),a.assets.resolve(),a.cache.resolve(),a.port,a.lease_seconds),host='127.0.0.1',port=a.port,access_log=None)
