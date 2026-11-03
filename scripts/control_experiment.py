"""Simulation-only adapter for MABEL's existing WBCEngine.

Called exclusively from the SimWorld physics thread. UI messages only update
bounded parameters; they never step physics or alter live hardware controls.
"""
import math,threading,time
import numpy as np

class ControlExperiment:
 def __init__(self,world):
  from mabel.whole_body_controller.engine import WBCEngine
  self.world=world;self.m=world.model;self.d=world.data;self.mj=world.mujoco;self.wbc=WBCEngine(self.m,self.d);self.lock=threading.Lock();self.version=0;self.configured=None;self.force_time=0;self.force=None;self.state={}
  self.joints={self.m.joint(i).name.lower().replace(' ','_'):self.m.joint(i).name for i in range(self.m.njnt) if self.m.joint(i).name in [f'{s} Arm {j}' for s in ['Left','Right'] for j in range(1,8)]+['Torso']}
  self.bodies={self.m.body(i).name:i for i in range(self.m.nbody) if any(k in self.m.body(i).name.lower() for k in ['shoulder','elbow','forearm','wrist','palm','hand_mount'])}
  self.palms={s:self.m.body(s+'_palm').id for s in ['left','right']};self.params=dict(space='force',law='impedance',stiffness='stiff',region='arm',side='left',targets={},offset=[0,0,0]);self.home={};self.task_q={}
  self.ik=self.mj.MjData(self.m)
 def number(self,v,lo,hi):
  if not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v):raise ValueError('Expected a finite number')
  return max(lo,min(hi,float(v)))
 def configure(self,p):
  with self.lock:
   q={**self.params,'targets':dict(self.params['targets'])}
   choices={'space':['joint','task','force'],'law':['impedance','gravity'],'stiffness':['stiff','soft'],'region':['arm','whole_body'],'side':['left','right']}
   changed=False
   for k,allowed in choices.items():
    if k in p:
     if p[k] not in allowed:raise ValueError('Unknown control '+k)
     changed=changed or (k in ['law','region','side','space'] and q[k]!=p[k]);q[k]=p[k]
   if changed:q['targets']={};q['offset']=[0,0,0];self.version+=1
   if 'joint' in p:
    name=p['joint']
    if name not in self.joints:raise ValueError('Unknown joint')
    j=self.m.joint(self.joints[name]);lo,hi=j.range if j.limited else [-math.pi,math.pi];q['targets'][name]=self.number(p.get('value'),float(lo)+.025,float(hi)-.025)
   if 'offset' in p:
    if not isinstance(p['offset'],list) or len(p['offset'])!=3:raise ValueError('Expected three task coordinates')
    q['offset']=[self.number(v,-.18,.18) for v in p['offset']]
   if 'force' in p:
    f=p['force']
    if not isinstance(f,dict) or f.get('body') not in self.bodies:raise ValueError('Unknown force body')
    v=f.get('vector');
    if not isinstance(v,list) or len(v)!=3:raise ValueError('Expected a force vector')
    v=np.array([self.number(x,-35,35) for x in v]);v*=min(1,35/max(float(np.linalg.norm(v)),.001));self.force=(f['body'],v);self.force_time=time.monotonic()
   self.params=q
 def reset(self):
  with self.lock:self.version+=1;self.force=None;self.params={**self.params,'targets':{},'offset':[0,0,0]}
 def step(self,enabled):
  if not enabled:
   if self.wbc.active:self.wbc.exit()
   self.configured=None;return
  with self.lock:p=self.params;version=self.version;force=self.force;fresh=time.monotonic()-self.force_time<.25
  if self.configured!=version:
   self.wbc.enter('impedance' if p['law']=='impedance' else 'compliance',p['region']);self.wbc.reset_targets();self.wbc.set_self_collision(True)
   self.wbc.base.vx=self.wbc.base.vy=self.wbc.base.w=0.;self.wbc.vx=self.wbc.vy=self.wbc.w=0.
   self.home={s:self.d.xpos[b].copy() for s,b in self.palms.items()};self.task_q={name:float(self.d.joint(mj).qpos[0]) for name,mj in self.joints.items()};self.task_active=False;self.configured=version
  self.wbc.set_stiffness(60 if p['stiffness']=='stiff' else 8)
  self.wbc.set_targets(p['targets'])
  if p['space']=='task' and p['law']=='impedance':
   if not self.task_active and any(abs(v)>.0001 for v in p['offset']):
    self.home={s:self.d.xpos[b].copy() for s,b in self.palms.items()};self.task_q={name:float(self.d.joint(mj).qpos[0]) for name,mj in self.joints.items()};self.task_active=True
   side=p['side'];body=self.palms[side];goal=self.home[side]+np.array(p['offset'])
   names=[f'{side}_arm_{j}' for j in range(1,8)];self.ik.qpos[:]=self.d.qpos
   for n in names:self.ik.joint(self.joints[n]).qpos[0]=self.task_q[n]
   self.mj.mj_forward(self.m,self.ik);error=goal-self.ik.xpos[body]
   jp=np.zeros((3,self.m.nv));jr=jp.copy();self.mj.mj_jacBody(self.m,self.ik,jp,jr,body)
   dofs=[int(self.m.joint(self.joints[n]).dofadr[0]) for n in names];J=jp[:,dofs]
   dq=J.T@np.linalg.solve(J@J.T+np.eye(3)*.003,error*2.5);dq=np.clip(dq,-.45,.45)
   for n,v in zip(names,dq):
    j=self.m.joint(self.joints[n]);lo,hi=j.range;self.task_q[n]=float(np.clip(self.task_q[n]+v*self.m.opt.timestep,lo+.03,hi-.03))
   self.wbc.set_targets({n:self.task_q[n] for n in names})
  if force and fresh and not self.world.cmd.estop:self.d.xfrc_applied[self.bodies[force[0]],:3]+=force[1]
  self.wbc.step(float(self.m.opt.timestep))
  self.state=dict(space=p['space'],law=p['law'],stiffness=p['stiffness'],region=p['region'],side=p['side'],force=float(np.linalg.norm(force[1])) if force and fresh else 0.,palms={s:self.d.xpos[b].tolist() for s,b in self.palms.items()},bodies=list(self.bodies),targets=dict(p['targets']))
