/* Complete CAD hierarchy driven by the hardware logs. The plots keep their own measured values. */
import {StudioGrid,robot,THREE} from './studio-3d.js?v=61386b7c';
const host=document.getElementById('accuracyLab'),api=window.__accuracyLab;
const data=await fetch('assets/data/accuracy-replays.json').then(r=>r.json());
window.__accuracyReplays={};
for(const key of ['repeat','path']){
 const figure=host.querySelector(`[data-clip="${key}"]`),slot=figure.querySelector('.al-test-stage'),grid=new StudioGrid(figure),rig=await robot();
 const view=grid.add(slot,rig.model,{direction:[-4,1.2,1.5]}),slider=figure.querySelector('input'),play=figure.querySelector('[data-test-play]'),output=figure.querySelector('output');
 const ground=new THREE.GridHelper(4,16,0xb8b2a4,0xe1d9c5);ground.material.transparent=true;ground.material.opacity=.38;view.scene.add(ground);
 let condition='spiral_torso0',record=key==='repeat'?data.repeat:data.path[condition],time=0,playing=true,last=0,lastDraw=0;
 const paths={},palms={};
 for(const side of ['left','right']){
  const node=rig.raw.getObjectByName(side+'_palm');rig.model.updateMatrixWorld(true);
  const center=new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());palms[side]={node,offset:node.worldToLocal(center)};
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(8000*3),3));geometry.setDrawRange(0,0);
  const color=getComputedStyle(document.documentElement).getPropertyValue(side==='left'?'--blue':'--green').trim();
  const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.75}));line.frustumCulled=false;view.scene.add(line);paths[side]={line,count:0};
 }
 function clearPaths(){for(const p of Object.values(paths)){p.count=0;p.line.geometry.setDrawRange(0,0);}}
 function apply(){
  let i=0;while(i<record.t.length-2&&record.t[i+1]<=time)i++;const next=Math.min(i+1,record.t.length-1),u=Math.max(0,Math.min(1,(time-record.t[i])/(record.t[next]-record.t[i]||1))),q={};
  data.joints.forEach((name,j)=>{const def=rig.joints.find(d=>d.name===name);q[name]=record.q[i][j]+(record.q[next][j]-record.q[i][j])*u-(def?.ref||0);});rig.pose(q);rig.model.updateMatrixWorld(true);
  for(const side of ['left','right']){const p=paths[side],palm=palms[side],v=palm.node.localToWorld(palm.offset.clone());if(p.count<8000){const a=p.line.geometry.attributes.position;a.setXYZ(p.count++,v.x,v.y,v.z);a.needsUpdate=true;p.line.geometry.setDrawRange(0,p.count);}}
  if(key==='repeat'){api.atRep(time);output.textContent='Cycle '+(record.cycle[i]+1)+' / 10';}
  else{const phase=record.phase[i],x=record.x[i];api.pathFrame(condition,x,phase==='trace'?'tracing':phase==='to_home'||phase==='to_start'?'moving to the start':'holding at the end');output.textContent=x===null?'Trial 1':x.toFixed(1)+' s';}
  slider.value=time;grid.dirty=true;
 }
 function seek(value){time=Math.max(0,Math.min(record.t.at(-1),value));clearPaths();apply();}
 slider.max=record.t.at(-1);slider.oninput=()=>seek(+slider.value);play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause':'Play';};
 if(key==='repeat')host.querySelector('[data-role="stations"]').addEventListener('click',e=>{const station=e.target.closest('[data-s]')?.dataset.s;if(!station)return;const visit=api.visits.find(v=>v.station===station);if(visit)seek(visit.vt);});
 else host.querySelector('[data-role="paths"]').addEventListener('click',e=>{const id=e.target.closest('[data-p]')?.dataset.p;if(!id)return;condition=id;record=data.path[id];api.followPath(true);seek(0);grid.recenter(view);});
 grid.onframe=now=>{const dt=last?Math.min(.1,(now-last)/1000):0;last=now;if(!view.visible||document.hidden||api.held())return;if(playing)time+=dt*.5;if(time>record.t.at(-1)){time=0;clearPaths();}if(now-lastDraw>33){lastDraw=now;apply();}};
 apply();grid.recenter(view);window.__accuracyReplays[key]={grid,rig,data:record,get time(){return time;},seek,get condition(){return condition;}};
}
