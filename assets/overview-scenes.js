/* Screen-sized overview chapters, with horizontal panels for supporting visuals. */
(function () {
 'use strict';
 if(!document.body.classList.contains('overview-page'))return;
 var rails=[],chapters=Array.from(document.querySelectorAll('#story,#home,#paper,#anatomy,#demo,#play,#architecture,#learning'));
 function el(tag,cls){var n=document.createElement(tag);if(cls)n.className=cls;return n;}
 function group(nodes,cls){var n=el('div',cls);nodes.filter(Boolean).forEach(function(x){n.appendChild(x);});return n;}
 function rail(host,items,labels){
  host.classList.add('ov-rail');var controls=el('div','ov-rail-controls'),prev=el('button','ov-rail-arrow'),next=el('button','ov-rail-arrow'),tabs=el('div','ov-rail-tabs'),track=el('div','ov-rail-track');
  prev.type=next.type='button';prev.textContent='←';next.textContent='→';prev.setAttribute('aria-label','Previous panel');next.setAttribute('aria-label','Next panel');tabs.setAttribute('role','tablist');
  var panels=items.map(function(item,i){var panel=el('div','ov-panel');panel.appendChild(item);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-label',labels[i]);track.appendChild(panel);return panel;});
  var buttons=labels.map(function(label,i){var b=el('button');b.type='button';b.textContent=label;b.setAttribute('role','tab');b.addEventListener('click',function(){go(i);});tabs.appendChild(b);return b;});
  controls.append(prev,tabs,next);host.replaceChildren(controls,track);var active=0,scheduled=false;
  function fit(){
   scheduled=false;var left=track.getBoundingClientRect().left;
   active=panels.reduce(function(best,p,i){return Math.abs(p.getBoundingClientRect().left-left)<Math.abs(panels[best].getBoundingClientRect().left-left)?i:best;},0);
   buttons.forEach(function(b,i){b.setAttribute('aria-selected',String(i===active));b.tabIndex=i===active?0:-1;});prev.disabled=active===0;next.disabled=active===panels.length-1;
   var budget=parseFloat(getComputedStyle(host).getPropertyValue('--ov-panel-height'))||600;
   var height=Math.min(budget,Math.max(120,panels[active].scrollHeight));
   if(track.style.height!==Math.ceil(height)+'px')track.style.height=Math.ceil(height)+'px';
   host.dataset.panel=String(active);
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(fit);}}
  function go(index){index=Math.max(0,Math.min(panels.length-1,index));var x=panels[index].getBoundingClientRect().left-track.getBoundingClientRect().left+track.scrollLeft;track.scrollTo({left:x,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  prev.addEventListener('click',function(){go(active-1);});next.addEventListener('click',function(){go(active+1);});
  tabs.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();var i=Math.max(0,Math.min(panels.length-1,active+(e.key==='ArrowRight'?1:-1)));buttons[i].focus();go(i);}});
  track.addEventListener('scroll',schedule,{passive:true});var resize=new ResizeObserver(schedule);resize.observe(track);panels.forEach(function(p){resize.observe(p);});
  var api={fit:schedule,go:go,host:host,destroy:function(){resize.disconnect();}};rails.push(api);schedule();return api;
 }
 function sectionRail(id,items,labels){var wrap=document.querySelector('#'+id+' > .wrap'),host=el('div');wrap.appendChild(host);return rail(host,items,labels);}
 chapters.forEach(function(section){section.classList.add('ov-scene');});
 var abstract=document.querySelector('#story .abstract-grid'),contrib=document.querySelector('#story .ov-contributions');
 sectionRail('story',[abstract,contrib],['Abstract','Contributions']);
 var book=document.getElementById('rgGrid');rail(book,Array.from(book.querySelectorAll('.rg-chap')),['Shop','Home','Street']);
 var design=document.querySelector('#anatomy .anat-wrap'),render=document.querySelector('#anatomy .ov-hardware-reel'),specs=document.getElementById('specs'),files=document.querySelector('#anatomy .oh-strip'),reach=document.querySelector('#anatomy .ov-details');
 sectionRail('anatomy',[design,render,specs,group([files,reach])],['Design','Render','Specs','Build files']);document.querySelector('#anatomy .ov-hardware-grid')?.remove();
 var modes=document.querySelector('#demo .ov-two'),tracking=document.querySelector('#demo .ov-details'),demos=document.querySelector('#demo .dg-collection');
 sectionRail('demo',[group([modes,tracking]),demos],['Modes','Demonstrations']);
 var sim=document.querySelector('#play .sim-embed'),simClips=Array.from(document.querySelectorAll('#play .ov-two > article')),twin=document.querySelector('#play .ov-details');
 sectionRail('play',[sim].concat(simClips).concat([twin]),['Try it','MuJoCo','Isaac Lab','Models']);document.querySelector('#play .ov-two')?.remove();document.querySelector('#play .ov-console-head')?.remove();
 var learning=document.getElementById('learningExplorer'),diagram=learning.querySelector('.lp-architecture'),workflow=learning.querySelector('.lp-inspector'),dataset=learning.querySelector('[data-learning-dataset]'),coordinates=learning.querySelector('.lp-state-breakdown'),phone=matchMedia('(max-width:1050px)'),learningRail;
 function learningLayout(){
  if(learningRail)learningRail.destroy();rails=rails.filter(function(r){return r!==learningRail;});learning.replaceChildren();learning.classList.add('ov-learning-scenes');
  if(phone.matches)learningRail=rail(learning,[diagram,workflow,group([dataset,coordinates])],['Diagram','Workflow','Dataset v2']);
  else learningRail=rail(learning,[group([diagram,workflow],'ov-learning-pair'),group([dataset,coordinates])],['Architecture','Dataset v2']);
  size();
 }
 learningLayout();phone.addEventListener('change',learningLayout);
 learning.addEventListener('click',function(e){if(phone.matches&&e.target.closest('[data-camera],[data-node],#lpStateGroups button'))learningRail.go(1);});
 function size(){
  var nav=document.querySelector('.ov-nav'),top=Math.max(document.getElementById('nav').getBoundingClientRect().bottom,(parseFloat(getComputedStyle(nav).top)||0)+nav.offsetHeight)+12;
  document.documentElement.style.setProperty('--ov-anchor-offset',Math.ceil(top)+'px');
  chapters.forEach(function(section){var head=section.querySelector('.sec-head'),h=head?head.getBoundingClientRect().height:0;var budget=Math.max(180,innerHeight-top-h-124);section.style.setProperty('--ov-panel-height',Math.floor(budget)+'px');});
  rails.forEach(function(r){r.fit();});
 }
 addEventListener('resize',size);document.fonts?.ready.then(size);size();
 // The embedded dock follows the visible viewport while remaining inside its console.
 var boot=document.getElementById('simBoot'),frame;
 function viewport(){if(!frame)return;var r=frame.getBoundingClientRect(),visible=r.top<innerHeight-90&&r.bottom>160&&r.right>innerWidth*.2&&r.left<innerWidth*.8;document.body.classList.toggle('sim-view-active',visible);frame.contentWindow.postMessage({type:'mabel-sim-viewport',bottom:Math.max(14,r.bottom-innerHeight+14)},location.origin);}
 function startSimulation(){
  if(frame)return;var stage=document.getElementById('simStage');frame=document.createElement('iframe');frame.src='simulator.html?embed=1&overview=1';frame.allow='fullscreen';frame.title='MABEL simulation console';frame.addEventListener('load',viewport);stage.replaceChildren(frame);
 }
 boot?.addEventListener('click',startSimulation);
 new IntersectionObserver(function(entries,observer){if(entries.some(function(e){return e.isIntersecting;})){startSimulation();observer.disconnect();}},{threshold:.1}).observe(document.getElementById('simStage'));
 addEventListener('scroll',viewport,{passive:true,capture:true});addEventListener('resize',viewport);addEventListener('fullscreenchange',viewport);
 addEventListener('message',function(e){if(frame&&e.origin===location.origin&&e.source===frame.contentWindow&&e.data?.type==='mabel-sim-ready')viewport();});
 window.__overviewScenes={rails:rails,size:size,startSimulation:startSimulation};
})();
