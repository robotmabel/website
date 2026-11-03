import {StudioGrid,robot,THREE} from './studio-3d.js?v=61386b7c';
const host=document.getElementById('baseOdometry');
if(host)boot().catch(e=>{host.querySelector('.base-replay').textContent='Base replay could not load. Reload to retry.';console.warn(e);});
async function boot(){
 const data=await fetch('assets/data/base-odometry.json').then(r=>r.json()),body=host.querySelector('.base-replay');
 body.innerHTML='<div class="base-controls"><select aria-label="Base test">'+data.runs.map((r,i)=>'<option value="'+i+'">'+r.label+'</option>').join('')+'</select><button type="button" data-base-play>Pause</button><span>4× replay</span><span class="base-metrics"></span></div><div class="base-layout"><div class="base-stage" data-label="Recorded base motion"></div><div class="base-plot"></div></div><label class="base-clock">Recorded time<input type="range" min="0" step=".01" value="0" aria-label="Base replay time"/><output></output></label><p class="base-note"></p>';
 const grid=new StudioGrid(body),rig=await robot(),slot=body.querySelector('.base-stage');grid.add(slot,rig.model);const view=grid.views[0];
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(32,32),new THREE.MeshStandardMaterial({color:0xeee6cf,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.001;view.scene.add(floor);view.scene.add(new THREE.GridHelper(32,64,0xa99f87,0xe0d0a6));let lastBase=null;
 const select=body.querySelector('select'),slider=body.querySelector('input'),play=body.querySelector('[data-base-play]'),plot=body.querySelector('.base-plot');let run,clock=0,playing=true,last=0;
 const svgStart='<svg viewBox="0 0 520 440" role="img" aria-label="Wheel odometry and ZED reference trajectory; position error over time">';
 function choose(){run=data.runs[+select.value];clock=0;slider.max=run.seconds;body.querySelector('.base-metrics').textContent=run.position_rms_mm.toFixed(1)+' mm RMS · '+run.yaw_rms_deg.toFixed(2)+'° yaw';body.querySelector('.base-note').textContent=run.completed?'Recorded odometry replay · wheel encoders versus ZED VIO and IMU.':'Partial recording · ended at the telemetry-stale guard; not an endurance result.';draw();grid.recenter(view);}
 function draw(){
  const rows=run.samples;let index=rows.findIndex(r=>r[0]>=clock);if(index<0)index=rows.length-1;const p=rows[index],a=index?rows[index-1]:p,u=p[0]===a[0]?0:(clock-a[0])/(p[0]-a[0]),x=a[1]+u*(p[1]-a[1]),y=a[2]+u*(p[2]-a[2]),yaw=a[3]+u*(p[3]-a[3]);const nowBase=new THREE.Vector3(x,.078,-y);if(lastBase){const delta=nowBase.clone().sub(lastBase);view.camera.position.add(delta);view.controls.target.add(delta);view.controls.update();}lastBase=nowBase;rig.pose({},[x,y,.078,Math.cos(yaw/2),0,0,Math.sin(yaw/2)]);grid.dirty=true;
  const range=Math.max(.4,...rows.map(r=>Math.max(Math.abs(r[1]),Math.abs(r[2]),Math.abs(r[4]),Math.abs(r[5]))))*1.15,k=115/range;
  const path=(cols)=>rows.slice(0,index+1).map((r,i)=>(i?'L':'M')+(260+r[cols[0]]*k).toFixed(1)+' '+(140-r[cols[1]]*k).toFixed(1)).join('');
  const maxError=Math.max(25,...rows.map(r=>Math.hypot(r[7],r[8])))*1.1;
  const errors=rows.slice(0,index+1).map((r,i)=>(i?'L':'M')+(45+r[0]/run.seconds*440).toFixed(1)+' '+(400-Math.hypot(r[7],r[8])/maxError*90).toFixed(1)).join('');
  plot.innerHTML=svgStart+'<g fill="none" stroke="var(--ash-light)"><path d="M145 140H375M260 25V255M45 300V400H485"/></g><g font-family="var(--font-head)" font-size="12" fill="var(--ink)"><text x="20" y="20">Trajectory · metres</text><text x="20" y="294">Position error · mm</text><text x="45" y="421">0</text><text x="460" y="421">'+run.seconds.toFixed(0)+' s</text><text x="12" y="316">'+maxError.toFixed(0)+'</text><text x="22" y="403">0</text><text x="270" y="138">0</text></g><path d="'+path([4,5])+'" stroke="var(--green)" stroke-width="2.5" fill="none"/><path d="'+path([1,2])+'" stroke="var(--blue)" stroke-width="2" stroke-dasharray="6 3" fill="none"/><circle cx="'+(260+x*k)+'" cy="'+(140-y*k)+'" r="4" fill="var(--blue)"/><path d="'+errors+'" stroke="var(--hi)" stroke-width="2" fill="none"/><g font-family="var(--font-head)" font-size="12"><text x="20" y="265" fill="var(--blue)">Wheel odometry</text><text x="200" y="265" fill="var(--green)">ZED reference</text></g></svg>';
  slider.value=clock;body.querySelector('output').textContent=clock.toFixed(1)+' / '+run.seconds.toFixed(1)+' s';
 }
 select.addEventListener('change',choose);slider.addEventListener('input',()=>{clock=+slider.value;draw();});play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'Pause':'Play';});choose();
 grid.onframe=t=>{const dt=last?Math.min(.1,(t-last)/1000):0;last=t;if(!view.visible||document.hidden)return;if(playing){clock=(clock+dt*4)%run.seconds;draw();}};
 host.__baseReplay={data,grid,get time(){return clock;}};
}
