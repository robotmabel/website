/* Shared studio lighting and orbit controls for the site's recorded 3D views. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export { THREE };
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),cache=new Map();
export function loadModel(url='assets/mabel_rig.glb'){
 if(!cache.has(url))cache.set(url,loader.loadAsync(url).then(g=>{
  const seen=new Set();g.scene.traverse(n=>{if(!n.isMesh)return;n.castShadow=true;n.receiveShadow=true;
   for(const m of (Array.isArray(n.material)?n.material:[n.material])){
    if(!m?.color||seen.has(m))continue;seen.add(m);const hsl={};m.color.getHSL(hsl);
    m.color.setHSL(hsl.h,hsl.s,Math.min(.94,.06+hsl.l*.95));m.roughness=.38;m.metalness=Math.max(...m.color.toArray())<.35?.3:.12;
   }
  });return g.scene;
 }));return cache.get(url);
}
let definitions;
export async function robot(){
 const source=await loadModel();definitions??=await fetch('assets/mabel_joints.json').then(r=>r.json());
 const raw=source.clone(true),model=new THREE.Group();model.add(raw);
 const baseNode=raw.getObjectByName('base_link'),baseOrientation=baseNode.quaternion.clone();
 const joints=definitions.joints.map(j=>{const n=raw.getObjectByName(j.node);return {...j,n,p:n.position.clone(),q:n.quaternion.clone(),a:new THREE.Vector3(...j.axis)};});
 return {model,raw,joints,pose(values,base){
  joints.forEach((j,i)=>{const v=Array.isArray(values)?values[i]:values[j.name];if(v===undefined)return;
   if(j.type==='prismatic')j.n.position.copy(j.p).add(j.a.clone().applyQuaternion(j.q).multiplyScalar(v));
   else j.n.quaternion.copy(j.q).multiply(new THREE.Quaternion().setFromAxisAngle(j.a,v));
  });
  if(base){baseNode.position.set(base[0],base[2],-base[1]);baseNode.quaternion.copy(baseOrientation).multiply(new THREE.Quaternion(base[4],base[5],base[6],base[3]));}
 }};
}
export function isolate(raw,id){
 const choose={base:b=>b==='mabel_chassis'||/^(fl_|fr_|b_)/.test(b),lift:b=>['lift_base','lift_mid','lift_top'].includes(b),body:b=>['body_mount','torso','head_mount'].includes(b),arms:b=>/^r_/.test(b)&&!b.includes('hand'),hands:b=>b.startsWith('right_')||b==='r_hand_mount',head:b=>['head_mount','neck_1','neck_2','head'].includes(b),sensors:b=>b==='head'}[id];
 const group=new THREE.Group();raw.updateMatrixWorld(true);
 raw.traverse(n=>{if(!n.isMesh)return;let p=n.parent;while(p&&p.isMesh)p=p.parent;if(!choose(p?.name||''))return;const m=n.clone();m.matrixAutoUpdate=false;m.matrix.copy(n.matrixWorld);group.add(m);});
 if(!group.children.length)throw Error('No CAD geometry for '+id);
 return group;
}
export class StudioGrid {
 constructor(host){
  this.host=host;host.__studioGrid=this;this.views=[];this.dirty=true;this.running=true;
  host.classList.add('studio-grid');this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.9;
  this.renderer.domElement.className='studio-canvas';this.renderer.domElement.setAttribute('aria-hidden','true');host.prepend(this.renderer.domElement);
  const room=new THREE.Scene();room.add(new THREE.Mesh(new THREE.BoxGeometry(12,10,12),new THREE.MeshBasicMaterial({color:0x5d6068,side:THREE.BackSide})));
  for(const [p,size] of [[[-3,2,0],[.1,4,3]],[[3,2,-2],[.1,3,2]],[[0,4,1],[3,.1,3]]]){const m=new THREE.MeshBasicMaterial();m.color.setRGB(2,2,2);const panel=new THREE.Mesh(new THREE.BoxGeometry(...size),m);panel.position.set(...p);room.add(panel);}
  const pmrem=new THREE.PMREMGenerator(this.renderer);this.environment=pmrem.fromScene(room,.04).texture;pmrem.dispose();
  new ResizeObserver(()=>{this.dirty=true;}).observe(host);addEventListener('scroll',()=>{this.dirty=true;},{passive:true,capture:true});
  this.observer=new IntersectionObserver(es=>{for(const e of es){const v=this.views.find(v=>v.slot===e.target);if(v)v.visible=e.isIntersecting;}this.dirty=true;},{rootMargin:'60px'});
  const frame=t=>{if(this.running){this.onframe?.(t);if(this.dirty&&!document.hidden)this.render();requestAnimationFrame(frame);}};requestAnimationFrame(frame);
 }
 add(slot,object,{direction=[-3,2.2,4],clip=null}={}){
  const scene=new THREE.Scene();scene.environment=this.environment;scene.add(object);
  scene.add(new THREE.HemisphereLight(0xfff7eb,0x707580,.9));
  for(const [pos,power] of [[[-3,5,4],2.0],[[4,3,-2],1.1],[[1,1,5],.45]]){const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(...pos);scene.add(light);}
  const camera=new THREE.PerspectiveCamera(32,1,.001,100),controls=new OrbitControls(camera,slot);controls.enableDamping=false;controls.enablePan=true;
  const view={slot,object,scene,camera,controls,direction:new THREE.Vector3(...direction),clip,visible:false};this.views.push(view);this.observer.observe(slot);
  controls.addEventListener('change',()=>{this.dirty=true;});controls.addEventListener('start',()=>{view.touched=true;});
  const reset=document.createElement('button');reset.type='button';reset.className='studio-recenter';reset.textContent='Recenter';reset.setAttribute('aria-label','Recenter '+(slot.dataset.label||'3D view'));
  reset.addEventListener('pointerdown',e=>e.stopPropagation());reset.addEventListener('click',e=>{e.stopPropagation();this.recenter(view);});slot.append(reset);
  slot.tabIndex=0;slot.setAttribute('aria-label',(slot.dataset.label||'Robot')+' · drag to rotate, right-drag to pan');
  slot.addEventListener('keydown',e=>{if(e.target!==slot)return;if(e.key==='Home'){this.recenter(view);e.preventDefault();e.stopPropagation();}if(['ArrowLeft','ArrowRight'].includes(e.key)){const d=camera.position.clone().sub(controls.target);d.applyAxisAngle(new THREE.Vector3(0,1,0),e.key==='ArrowLeft'?.15:-.15);camera.position.copy(controls.target).add(d);controls.update();this.dirty=true;e.preventDefault();e.stopPropagation();}});
  this.recenter(view);slot.classList.add('studio-ready');return view;
 }
 recenter(v){
  const box=new THREE.Box3().setFromObject(v.object),sphere=box.getBoundingSphere(new THREE.Sphere()),r=Math.max(sphere.radius,.01),a=v.slot.clientWidth/Math.max(1,v.slot.clientHeight);
  v.camera.aspect=a;const vf=THREE.MathUtils.degToRad(v.camera.fov/2),hf=Math.atan(Math.tan(vf)*a),distance=r/Math.sin(Math.min(vf,hf))*1.10;
  v.touched=false;v.aspect=a;v.controls.target.copy(sphere.center);v.camera.position.copy(sphere.center).add(v.direction.clone().normalize().multiplyScalar(distance));v.camera.near=r/100;v.camera.far=r*100;v.camera.updateProjectionMatrix();v.controls.minDistance=r*.5;v.controls.maxDistance=r*20;v.controls.update();this.dirty=true;
 }
 render(){
  const rect=this.host.getBoundingClientRect(),w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;
  if(this.width!==w||this.height!==h){this.width=w;this.height=h;this.renderer.setSize(w,h,false);}
  const r=this.renderer;r.setScissorTest(false);r.setClearColor(0,0);r.clear();r.setScissorTest(true);
  for(const v of this.views){if(!v.visible||v.slot.closest('[hidden]'))continue;const s=v.slot.getBoundingClientRect(),c=v.clip?.getBoundingClientRect()||rect;
   const left=Math.max(s.left,rect.left,c.left),right=Math.min(s.right,rect.right,c.right),top=Math.max(s.top,rect.top,c.top),bottom=Math.min(s.bottom,rect.bottom,c.bottom);if(right<=left||bottom<=top)continue;
   const aspect=s.width/s.height;if(Math.abs(aspect-v.aspect)>.01){if(!v.touched)this.recenter(v);v.aspect=aspect;}v.camera.aspect=aspect;v.camera.updateProjectionMatrix();r.setViewport(s.left-rect.left,rect.bottom-s.bottom,s.width,s.height);r.setScissor(left-rect.left,rect.bottom-bottom,right-left,bottom-top);r.render(v.scene,v.camera);
  }
  this.dirty=false;
 }
 clear(){for(const v of this.views){v.controls.dispose();this.observer.unobserve(v.slot);}this.views=[];this.dirty=true;}
}
