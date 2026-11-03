/* A continuous overview: visible media grids and inspectable diagrams. */
(function () {
 'use strict';
 if(!document.body.classList.contains('overview-page'))return;
 var chapters=Array.from(document.querySelectorAll('#story,#home,#paper,#anatomy,#demo,#play,#architecture,#learning'));
 function group(nodes,cls){var n=document.createElement('div');n.className=cls;nodes.filter(Boolean).forEach(function(x){n.appendChild(x);});return n;}
 chapters.forEach(function(section){section.classList.add('ov-scene');});
 document.querySelector('#story .ov-contributions')?.classList.add('ov-followup');
 var book=document.getElementById('rgGrid');book.classList.add('ov-gallery-vertical');
 book.querySelectorAll('.rg-chap').forEach(function(chap){
  chap.querySelector('.rg-lead h3').textContent={shop:'Shop',home:'Home',street:'Street'}[chap.dataset.chap];
 });
 dispatchEvent(new Event('resize'));
 var hardware=document.querySelector('#anatomy > .wrap'),design=document.querySelector('#anatomy .anat-wrap'),render=document.querySelector('#anatomy .ov-hardware-reel'),specs=document.getElementById('specs'),files=document.querySelector('#anatomy .oh-strip'),reach=document.querySelector('#anatomy .ov-details');
 hardware.append(design,group([render,specs],'ov-hardware-followup ov-followup'),group([files,reach],'ov-followup'));
 hardware.querySelector('.ov-hardware-grid')?.remove();
 var demonstrations=document.querySelector('#demo .dg-collection'),demoHeading=document.createElement('h3');demoHeading.className='ov-subtitle';demoHeading.textContent='Teleoperation demonstrations';demonstrations.prepend(demoHeading);demonstrations.classList.add('ov-followup');
 document.querySelector('#play .ov-details')?.remove();document.querySelector('#play .ov-console-head')?.remove();document.querySelector('#play .ov-two')?.classList.add('ov-followup');
 document.querySelector('#play .sec-head').after(document.querySelector('#play .sim-embed'));
 document.getElementById('learningExplorer').classList.add('ov-learning-visible');
 function size(){
  var nav=document.querySelector('.ov-nav'),top=Math.max(document.getElementById('nav').getBoundingClientRect().bottom,(parseFloat(getComputedStyle(nav).top)||0)+nav.offsetHeight)+12;
  document.documentElement.style.setProperty('--ov-anchor-offset',Math.ceil(top)+'px');
  chapters.forEach(function(section){var head=section.querySelector('.sec-head'),h=head?head.getBoundingClientRect().height:0;section.style.setProperty('--ov-panel-height',Math.floor(Math.max(220,innerHeight-top-h-70))+'px');});
 }
 addEventListener('resize',size);document.fonts?.ready.then(size);size();
 // Media widgets arriving above an anchor must not push its heading off screen.
 var pendingAnchor=null,anchorFrame=false;
 function alignAnchor(){anchorFrame=false;if(!pendingAnchor||performance.now()>pendingAnchor.until)return;if(performance.now()<pendingAnchor.after)return;var target=pendingAnchor.target,offset=parseFloat(getComputedStyle(target).scrollMarginTop)||140,delta=target.getBoundingClientRect().top-offset;if(Math.abs(delta)>3)scrollTo({top:scrollY+delta,behavior:'instant'});}
 document.addEventListener('click',function(event){var a=event.target.closest('.ov-nav a,.ov-scroll-rail a');if(!a)return;pendingAnchor=null;var section=document.querySelector(a.hash);if(section&&section.classList.contains('ov-scene')){pendingAnchor={target:section,after:performance.now()+650,until:performance.now()+6000};setTimeout(alignAnchor,700);}},true);
 document.addEventListener('pointerdown',function(event){if(!event.target.closest('.ov-nav a,.ov-scroll-rail a'))pendingAnchor=null;},{passive:true});
 ['wheel','touchstart','keydown'].forEach(function(type){addEventListener(type,function(){pendingAnchor=null;},{passive:true});});
 new ResizeObserver(function(){if(!anchorFrame){anchorFrame=true;requestAnimationFrame(alignAnchor);}}).observe(document.body);
 document.body.classList.add('ov-motion-ready');
 var reveal=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('ov-entered');reveal.unobserve(e.target);}});},{threshold:.04});
 chapters.forEach(function(section){reveal.observe(section);});document.querySelectorAll('.ov-followup,.rg-chap').forEach(function(block){block.classList.add('ov-reveal-block');reveal.observe(block);});
 var boot=document.getElementById('simBoot'),frame;
 function viewport(){if(!frame)return;var r=frame.getBoundingClientRect(),visible=r.top<innerHeight-90&&r.bottom>160&&r.right>innerWidth*.2&&r.left<innerWidth*.8;document.body.classList.toggle('sim-view-active',visible);frame.contentWindow.postMessage({type:'mabel-sim-viewport',bottom:Math.max(14,r.bottom-innerHeight+14)},location.origin);}
 function startSimulation(){if(frame)return;var stage=document.getElementById('simStage');frame=document.createElement('iframe');frame.src='simulator.html?embed=1&overview=1';frame.allow='fullscreen';frame.title='MABEL simulation console';frame.addEventListener('load',viewport);stage.replaceChildren(frame);}
 boot?.addEventListener('click',startSimulation);
 new IntersectionObserver(function(entries,observer){if(entries.some(function(e){return e.isIntersecting;})){startSimulation();observer.disconnect();}},{threshold:.1}).observe(document.getElementById('simStage'));
 addEventListener('scroll',viewport,{passive:true,capture:true});addEventListener('resize',viewport);addEventListener('fullscreenchange',viewport);
 addEventListener('message',function(e){
  if(!frame||e.origin!==location.origin||e.source!==frame.contentWindow)return;
  if(e.data?.type==='mabel-sim-ready')viewport();
  if(e.data?.type==='mabel-sim-focus'){
   pendingAnchor=null;
   var top=frame.getBoundingClientRect().top,offset=parseFloat(getComputedStyle(document.getElementById('play')).scrollMarginTop)||150;
   if(top<offset||frame.getBoundingClientRect().bottom>innerHeight-12)scrollTo({top:scrollY+top-offset,behavior:'smooth'});
  }
 });
 window.__overviewScenes={size:size,startSimulation:startSimulation};
})();
