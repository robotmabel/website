import { StudioGrid,loadModel,isolate,THREE } from './studio-3d.js?v=61386b7c';
const host=document.getElementById('hwSlider');
if(host){
 async function init(){
  if(host.__studio||!host.querySelector('.hs-shot'))return;host.__studio=new StudioGrid(host);const raw=(await loadModel()).clone(true);
  // Show the right elbow extended, using the actual articulated CAD hierarchy.
  const arm=raw.getObjectByName('r_elbow');if(arm)arm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-.8));
  const rail=host.querySelector('.hs-rail');
  const observer=new IntersectionObserver(async entries=>{for(const e of entries){if(!e.isIntersecting||e.target.dataset.loaded)continue;const slot=e.target;slot.dataset.loaded='1';const id=slot.closest('.hs-card').dataset.id;slot.dataset.label=slot.closest('.hs-card').querySelector('h3').textContent;
   try{let model;if(id==='electronics'){const source=await loadModel('assets/hw/motherboard.glb');model=source.clone(true);}else model=isolate(raw,id);host.__studio.add(slot,model,{clip:rail});}
   catch(error){slot.dataset.loaded='';console.warn('Hardware viewer:',id,error.message);}
  }},{root:rail,rootMargin:'80px'});
  host.querySelectorAll('.hs-shot').forEach(s=>observer.observe(s));
 }
 if(host.querySelector('.hs-shot'))init();else new MutationObserver((_,o)=>{if(host.querySelector('.hs-shot')){o.disconnect();init();}}).observe(host,{childList:true});
}
