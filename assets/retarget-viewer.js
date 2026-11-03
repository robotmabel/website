/* Recorded robot states from the offline MuJoCo benchmark. One playback clock. */
import {StudioGrid,robot} from './studio-3d.js?v=61386b7c';
import {PhysicsLink} from './studio-physics.js?v=fca188bf';
const host=document.getElementById('retargetClips');
if(host)boot().catch(e=>{host.textContent='The 3D replay could not load. Please refresh.';console.error(e);});
async function boot(){
 const D=await fetch('assets/data/retarget-replays.json').then(r=>r.json()),selected=new Set(['ours','gmr','direct']);
 const tasks=[...new Map(D.tasks.map(t=>[t.id,t.label])).entries()];
 host.className='retarget-studio';host.innerHTML=`<div class="replay-toolbar"><label>Task<select data-task>${tasks.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label>Episode<select data-episode></select></label><div class="replay-modes"><button class="active" data-recorded>Recorded</button><button data-live>Live physics</button></div></div><fieldset class="replay-methods"><legend>Compare methods</legend>${[...D.methods].sort((a,b)=>(b.id==='ours')-(a.id==='ours')).map(m=>`<label><input type="checkbox" value="${m.id}" ${selected.has(m.id)?'checked':''}>${m.id==='ours'?'MABEL':m.label}</label>`).join('')}</fieldset><div class="replay-grid"></div><div class="replay-transport"><button data-play aria-label="Pause all recorded views">Pause</button><input aria-label="Replay time" data-time type="range" min="0" max="6" step=".01" value="0"><output data-clock>0.00 s</output></div><div class="replay-live" hidden><div data-queue></div><label>Live method<select data-live-method>${D.methods.map(m=>`<option value="${m.id}" ${m.id==='ours'?'selected':''}>${m.id==='ours'?'MABEL':m.label}</option>`).join('')}</select></label><button data-run>Replay episode</button></div><p class="replay-note" data-note>Recorded MuJoCo replay · drag to orbit. Motion: EgoDex (Apple).</p>`;
 const gridHost=host.querySelector('.replay-grid'),grid=new StudioGrid(gridHost),taskSelect=host.querySelector('[data-task]'),episodeSelect=host.querySelector('[data-episode]'),timeline=host.querySelector('[data-time]'),clock=host.querySelector('[data-clock]'),play=host.querySelector('[data-play]'),livePanel=host.querySelector('.replay-live'),note=host.querySelector('[data-note]');
 let wasDriver=false,records=[],time=0,playing=true,previous=0,generation=0,visible=false,isLive=false,liveRig=null;
 const dataCache=new Map();async function get(url){if(!dataCache.has(url))dataCache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}));return dataCache.get(url);}
 const link=new PhysicsLink(livePanel.querySelector('[data-queue]'),{onState:state=>{if(!isLive||state.mode!=='retarget'||!liveRig)return;liveRig.pose(state.q,state.base);grid.dirty=true;clock.textContent=state.time.toFixed(2)+' s';},onStatus:()=>{host.querySelector('[data-run]').disabled=!link.driver;if(link.driver&&!wasDriver)runLive();wasDriver=link.driver;}});
 function runLive(){if(!link.driver||!isLive)return;const T=current();link.send('experiment',{mode:'retarget',task:T.id,episode:T.episode,method:host.querySelector('[data-live-method]').value});}
 function current(){return D.tasks.find(t=>t.id===taskSelect.value&&String(t.episode)===episodeSelect.value);}
 async function render(){
  const run=++generation,T=current();records=[];grid.clear();gridHost.replaceChildren(grid.renderer.domElement);gridHost.classList.toggle('live-one',isLive);time=0;
  const mids=isLive?[host.querySelector('[data-live-method]').value]:[...selected];
  const loaded=await Promise.all(mids.map(async id=>({id,rig:await robot(),data:await get(T.methods[id])})));
  if(run!==generation)return;
  for(const r of loaded){const method=D.methods.find(m=>m.id===r.id),f=document.createElement('figure');f.className='replay-tile'+(r.id==='ours'?' ours':'');f.innerHTML=`<div class="rk-stage" data-label="${r.id==='ours'?'MABEL':method.label}"></div><figcaption>${r.id==='ours'?'MABEL':method.label}</figcaption>`;gridHost.append(f);r.rig.pose(r.data.q[0],r.data.base[0]);r.view=grid.add(f.querySelector('.rk-stage'),r.rig.model,{direction:[-2,1.3,4]});records.push(r);}
  liveRig=isLive?records[0]?.rig:null;if(isLive)runLive();timeline.max=Math.min(...records.map(r=>r.data.t.at(-1)));apply();
 }
 function apply(){if(isLive)return;for(const r of records){const t=r.data.t;let i=0;while(i<t.length-1&&t[i+1]<=time)i++;r.rig.pose(r.data.q[i],r.data.base[i]);}grid.dirty=true;timeline.value=time;clock.textContent=time.toFixed(2)+' s';}
 function episodes(){episodeSelect.innerHTML=D.tasks.filter(t=>t.id===taskSelect.value).map(t=>`<option value="${t.episode}">${t.episode}</option>`).join('');render();}
 taskSelect.onchange=episodes;episodeSelect.onchange=render;
 host.querySelectorAll('.replay-methods input').forEach(input=>input.onchange=()=>{if(input.checked)selected.add(input.value);else if(selected.size>1)selected.delete(input.value);else input.checked=true;render();});
 timeline.oninput=()=>{time=+timeline.value;apply();};play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause':'Play';play.setAttribute('aria-label',(playing?'Pause':'Play')+' all recorded views');};
 function mode(live){isLive=live;livePanel.hidden=!live;host.querySelector('.replay-methods').hidden=live;timeline.disabled=live;play.hidden=live;host.querySelector('[data-recorded]').classList.toggle('active',!live);host.querySelector('[data-live]').classList.toggle('active',live);note.textContent=live?'Live MuJoCo on the 5080 · replaying selected joint references.':'Recorded MuJoCo replay · drag to orbit. Motion: EgoDex (Apple).';if(live)link.connect();else link.disconnect();render();}
 host.querySelector('[data-recorded]').onclick=()=>mode(false);host.querySelector('[data-live]').onclick=()=>mode(true);host.querySelector('[data-live-method]').onchange=render;host.querySelector('[data-run]').onclick=runLive;
 new IntersectionObserver(es=>{visible=es[0].isIntersecting;},{rootMargin:'100px'}).observe(host);
 grid.onframe=now=>{const dt=previous?Math.min(.1,(now-previous)/1000):0;previous=now;if(!isLive&&playing&&visible&&!document.hidden&&records.length){time=(time+dt)%+timeline.max;apply();}};
 episodes();window.__retargetStudio={grid,selected,records:()=>records,time:()=>time};
}
