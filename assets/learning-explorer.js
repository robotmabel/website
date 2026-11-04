/* Current hand-grasping dataset and the ACT observation → action interface. */
(function () {
 'use strict';
 var host = document.getElementById('learningExplorer');
 var datasetHosts = document.querySelectorAll('[data-learning-dataset]');
 if (!host && !datasetHosts.length) return;
 if (host) {
  var families = {
   act: {title:'ACT · Action Chunking Transformer',status:'Saved ACT training run',text:'Learn a sequence of robot references from camera features and recent state. Chunking gives the policy a short motion horizon before it observes and plans again.',flow:['Camera images + state history','Transformer + latent action model','Action chunk','Shared controller'],data:'The current hand-grasping run uses three camera views, one second of state history, and 120 action steps at 30 Hz. It executes the first second before observing again.',link:'https://trainer.mabelrobot.duckdns.org/?arch=ACT',label:'Configure ACT ↗',paper:'https://tonyzhaozh.github.io/aloha/'},
   dp: {title:'DP · Diffusion Policy',status:'DiT diffusion backend in Training Studio',text:'Condition a denoising process on images and robot state to produce an action sequence. The studio’s implementation uses a Diffusion Transformer (DiT) action model.',flow:['Camera images + robot state','Conditioned action denoising','Action sequence','Shared controller'],data:'Training needs aligned observation–action pairs, action normalization and a selected prediction horizon. Compare checkpoints on held-out takes before closed-loop evaluation.',link:'https://trainer.mabelrobot.duckdns.org/?arch=DiT',label:'Configure diffusion training ↗',paper:'https://diffusion-policy.cs.columbia.edu/'},
   vla: {title:'VLA · π0.5',status:'π0.5 fine-tuning configuration available',text:'Combine visual observations, language instructions and robot state with a pretrained vision-language-action model. Adapt its action interface to the selected robot modules.',flow:['Images + instruction + state','Pretrained VLA + action expert','Robot action chunk','Shared controller'],data:'Curated episodes need task instructions and consistent embodiment-specific action channels. The studio exposes π0.5 configuration; a completed MABEL hardware result is not reported here.',link:'https://trainer.mabelrobot.duckdns.org/?arch=pi0.5',label:'Configure π0.5 ↗',paper:'https://www.pi.website/blog/pi0.5'},
   wam: {title:'WAM · World Action Models',status:'Research integration track',text:'Learn future visual dynamics together with the actions that cause them. A world-action model can use video and action sequences to connect anticipated changes in the scene with robot behavior.',flow:['Video + instruction + state','Joint video–action model','Future visual dynamics + actions','Embodiment adapter'],data:'This track needs temporally aligned video and actions, task descriptions and an embodiment adapter. WAM training and deployment remain a research integration; no completed MABEL WAM run is claimed.',link:'https://arxiv.org/abs/2602.15922',label:'Explore World Action Models ↗',paper:'https://arxiv.org/abs/2602.15922'}
  };
  var tabs=Array.from(host.querySelectorAll('[data-family]')),panel=document.getElementById('lpFamilyPanel');
  function selectFamily(key) {
   var family=families[key];if(!family||!panel)return;
   host.dataset.family=key;panel.setAttribute('aria-labelledby','lpFamily-'+key);
   tabs.forEach(function(button){var active=button.dataset.family===key;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
   panel.innerHTML='<div class="lp-family-title"><h4>'+family.title+'</h4><span>'+family.status+'</span></div><p>'+family.text+'</p><div class="lp-family-flow">'+family.flow.map(function(text){return '<span>'+text+'</span>';}).join('')+'</div><p class="lp-family-data">'+family.data+'</p><div class="lp-family-links"><a href="'+family.link+'" target="_blank" rel="noopener">'+family.label+'</a><a href="'+family.paper+'" target="_blank" rel="noopener">Method reference ↗</a></div>';
  }
  tabs.forEach(function(button,index){
   button.addEventListener('click',function(){selectFamily(button.dataset.family);});
   button.addEventListener('keydown',function(event){var next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();tabs[next].focus();selectFamily(tabs[next].dataset.family);});
  });
  selectFamily('act');
 }
 var number = function (value) { return value.toLocaleString('en-US'); };
 fetch('assets/data/learning-pipeline.json', {cache:'no-cache'}).then(function (r) {
  if (!r.ok) throw Error('learning data'); return r.json();
 }).then(function (D) {
  var V = D.dataset, execute = Math.round(D.chunk.execute_seconds * D.chunk.hz), duration = D.chunk.steps / D.chunk.hz;
  datasetHosts.forEach(function (target) {
   target.innerHTML = '<div class="lp-paper-head"><h3>Hand grasping · Dataset v2</h3><span class="lp-success">30 fps · LeRobot v3</span></div>' +
    '<div class="lp-metrics">' + [[V.minutes.toFixed(1)+' min','Demonstrations · '+V.hours+' h'],[number(V.frames),'Frames'],[V.episodes,'Curated episodes'],[V.takes,'Takes']].map(function (m) { return '<div><b>'+m[0]+'</b><span>'+m[1]+'</span></div>'; }).join('') + '</div>' +
    '<p class="lp-dataset-meta">'+V.export_gb+' GB export <span>·</span> '+V.frame_cache_gb+' GB training cache <span>·</span> '+V.camera_videos+' camera videos + joint data</p>' +
    '<div class="lp-split-heading"><h4>Split by take</h4><span>80 / 10 / 10 · seed '+V.seed+'</span></div>' +
    '<div class="lp-split-tabs" role="group" aria-label="Dataset split"><button type="button" data-split="train" aria-pressed="true">Train</button><button type="button" data-split="val" aria-pressed="false">Validation</button><button type="button" data-split="test" aria-pressed="false">Test</button></div><div class="lp-split-stats" aria-live="polite"></div>' +
    '<p class="lp-mini">Every episode from one take stays in the same split, keeping near-duplicate frames out of validation and test.</p>' +
    '<details class="lp-dataset-details"><summary>Samples and data quality</summary><p>One clip pairs camera frames and state with the next '+duration+' s of actions. Clips overlap: '+number(V.splits[0].clips)+' train clips represent '+V.splits[0].minutes.toFixed(1)+' minutes of distinct demonstrations.</p>' +
    '<p>Training progress uses '+V.validation_clips+' validation clips per check, every '+number(V.eval_every_steps)+' steps. Test is reserved for final evaluation.</p>' +
    '<dl><div><dt>Held-command rows during dropouts</dt><dd>'+number(V.quality.held_command_rows)+'</dd></div><div><dt>Joint rows filled by interpolation</dt><dd>'+number(V.quality.interpolated_joint_rows)+'</dd></div><div><dt>Maximum accepted gap</dt><dd>'+V.quality.max_gap_seconds+' s</dd></div><div><dt>Rows with a stale camera frame</dt><dd>'+V.quality.stale_camera_rows+'</dd></div></dl>' +
    '<p>No rows exceeded the joint/log gap limit. Sample filtering still excludes '+V.quality.dropped_clips.stale_now+' stale-frame starts and '+number(V.quality.dropped_clips.short_future)+' starts with insufficient future actions.</p><p>Cache images: '+D.recording.image_size_hw.join(' × ')+' (height × width). The export retains four views; ACT uses left head and both wrists.</p></details>' +
    '<div class="lp-dataset-links"><a href="assets/data/learning-pipeline.json">Dataset summary ↗</a><a href="autonomy.html#learning">Learning details →</a></div>';
   // Supporting metadata stays available without crowding the overview card.
   var extra=target.querySelector('.lp-dataset-details');
   extra.insertBefore(target.querySelector('.lp-dataset-meta'),extra.children[1]);
   extra.append(target.querySelector('.lp-mini'),target.querySelector('.lp-dataset-links'));
   function split(key) {
    var row=V.splits.find(function (r) { return r.key===key; });
    target.querySelectorAll('[data-split]').forEach(function (b) { b.setAttribute('aria-pressed',String(b.dataset.split===key)); });
    target.querySelector('.lp-split-stats').innerHTML=[[row.takes,'Takes'],[row.episodes,'Episodes'],[number(row.frames),'Frames'],[row.minutes.toFixed(1)+' min','Distinct data'],[number(row.clips),'Clips']].map(function (m) { return '<div><b>'+m[0]+'</b><span>'+m[1]+'</span></div>'; }).join('');
    target.dataset.selectedSplit=key;
   }
   target.querySelectorAll('[data-split]').forEach(function (b) { b.addEventListener('click',function () { split(b.dataset.split); }); });
   split('train');
  });
  if (!host) return;
  var detail=document.getElementById('learningDetail'), slider=document.getElementById('lpStep'), cells=document.getElementById('lpChunkCells');
  var stages={
   collect:['Collect demonstrations','Record camera views and robot motion together.',['4 RGB streams at 30 fps.','Measured state and target commands stay distinct.'],['Raw control telemetry is recorded at nominal 50 Hz. ACT uses left head and both wrist images; the right head view remains in the export.']],
   export:['Curate and export','Trim takes, align streams, then export to LeRobot.',['v2 contains '+V.episodes+' episodes at '+V.fps+' fps.','Keep timestamps and data-quality flags.'],['Short gaps are repaired and tracked. Dataset splits keep whole takes together.']],
   train:['Train the ACT policy','Camera features and state history predict the next motion.',['3 camera views + 1 s of joint history.','120 action steps predict 4 s ahead.'],['v2 uses 59 state coordinates and 63 action channels: 59 joint references plus base twist and lift-rate commands.']],
   deploy:['Execute and re-plan','Use the same controller as teleoperation.',['Execute 1 s, then observe again.','Send the next chunk through the shared controller.'],['The configured execution window is 30 steps at 30 Hz, with no temporal ensembling.']]
  };
  function render(title,text,items,more) {
   detail.hidden=false;detail.replaceChildren();var h=document.createElement('h3'),p=document.createElement('p'),ul=document.createElement('ul');h.textContent=title;p.textContent=text;
   items.forEach(function (item) { var li=document.createElement('li');li.textContent=item;ul.appendChild(li); });detail.append(h,p,ul);
   if (more && more.length) { var disclosure=document.createElement('details'),summary=document.createElement('summary');summary.textContent='More details';disclosure.appendChild(summary);more.forEach(function (text) { var note=document.createElement('p');note.textContent=text;disclosure.appendChild(note); });detail.appendChild(disclosure); }
  }
  function selectStage(key) {
   var data=stages[key];render(data[0],data[1],data[2],data[3]);host.dataset.stage=key;
   host.querySelectorAll('[data-learn]').forEach(function (b) { b.setAttribute('aria-pressed',String(b.dataset.learn===key)); });
   host.querySelectorAll('[data-camera],[data-node]').forEach(function (b) { b.setAttribute('aria-pressed','false'); });
  }
  host.querySelectorAll('[data-learn]').forEach(function (b) { b.addEventListener('click',function () { selectStage(b.dataset.learn); }); });
  var nodes={
   encoders:['Image encoders','Turn each camera view into visual features.',['One encoder per policy camera.','320 × 240 pixels per image.']],
   transformer:['ACT transformer','Fuse visual features with recent joint state.',['Read 1 s of state history at 5 Hz.','Predict the next 120 action steps.']],
   state:['59-coordinate state','The robot’s measured joint configuration.',['Arms, hands, neck, torso, lift and swerve.','The coupled lift counts as one coordinate.']],
   references:['Action chunk','Four seconds of predicted actions.',['120 steps at 30 Hz.','Execute the first 30, then re-plan.'],['The v2 action has 63 channels: 59 joint references, three base-twist fields and one lift-rate field.']],
   controller:['Shared controller','Policy and operator use the same execution path.',['Track references within controller limits.','Route them to the robot or digital twin.']]
  };
  host.querySelectorAll('[data-node]').forEach(function (b) { b.addEventListener('click',function () { var data=nodes[b.dataset.node];selectStage(['references','controller'].includes(b.dataset.node)?'deploy':'train');render(data[0],data[1],data[2],data[3]);b.setAttribute('aria-pressed','true'); }); });
  D.recording.cameras.forEach(function (camera) {
   var key={head_left:'head',wrist_left:'left',wrist_right:'right'}[camera.key],button=host.querySelector('[data-camera="'+key+'"]');
   var video=button.querySelector('video');video.dataset.clip=camera.video;video.dataset.poster=camera.image;
   button.addEventListener('click',function () { selectStage('collect');render(camera.label.toLowerCase()+' camera','Hand-grasping demonstration · dataset v2.',['Three synchronized views of the same recorded episode.','One of the three ACT camera inputs.'],['Episode '+V.preview.episode+', '+V.preview.video_frames+' frames at '+D.recording.camera_hz+' fps. Recorded data, with no added blur.']);button.setAttribute('aria-pressed','true'); });
  });
  // One playback group: buffer, pause, resume and loop all camera inputs together.
  // These are recorded observations, not a running policy or a live robot feed.
  (function cameraPlayback(){
   var group=host.querySelector('.lp-cameras'),videos=Array.from(group.querySelectorAll('video')),master=videos[0],visible=false,loaded=false,starting=false,stalled=false,blocked=false,previous=0;
   var play=document.createElement('button');play.type='button';play.className='lp-camera-play';play.textContent='Play camera views';play.hidden=true;group.appendChild(play);
   function pause(){videos.forEach(function(v){v.pause();});}
   function sync(force){var t=master.currentTime;videos.slice(1).forEach(function(v){if(v.readyState>=2&&(force||Math.abs(v.currentTime-t)>.055))v.currentTime=t;});previous=t;}
   async function resume(){
    if(starting||!loaded||!visible||document.hidden||videos.some(function(v){return v.readyState<3;}))return;
    starting=true;sync(true);
    var result=await Promise.allSettled(videos.map(function(v){return v.play();}));starting=false;
    if(!visible||document.hidden){pause();return;}
    blocked=result.some(function(r){return r.status==='rejected';});stalled=blocked;play.hidden=!blocked;
    if(blocked)pause();
   }
   videos.forEach(function(v){
    v.muted=true;v.defaultMuted=true;v.playsInline=true;v.loop=true;
    v.addEventListener('waiting',function(){if(visible&&!starting){stalled=true;pause();}});
    v.addEventListener('canplay',function(){if(!blocked&&(stalled||videos.every(function(x){return x.paused;}))){stalled=false;resume();}});
    v.addEventListener('error',function(){pause();blocked=true;play.hidden=false;play.textContent='Retry camera views';});
   });
   play.addEventListener('click',function(){blocked=false;videos.forEach(function(v){if(v.error)v.load();});resume();});
   new IntersectionObserver(function(entries){
    visible=entries[0].isIntersecting;
    if(visible&&!loaded){loaded=true;videos.forEach(function(v){v.poster=v.dataset.poster;v.src=v.dataset.clip;v.load();});}
    if(visible)resume();else pause();
   },{rootMargin:'120px',threshold:0}).observe(group);
   document.addEventListener('visibilitychange',function(){if(document.hidden)pause();else resume();});
   function frame(){if(visible&&!master.paused){sync(master.currentTime<previous);}if(master.requestVideoFrameCallback)master.requestVideoFrameCallback(frame);}
   if(master.requestVideoFrameCallback)master.requestVideoFrameCallback(frame);else setInterval(function(){if(visible&&!master.paused)sync(master.currentTime<previous);},80);
  })();
  document.getElementById('lpChunkLabel').textContent=D.chunk.steps+' steps · '+duration+' s';slider.max=D.chunk.steps-1;slider.value=execute-1;
  for (var i=0;i<D.chunk.steps;i++) { var cell=document.createElement('i');cell.className=i<execute?'executed':'';cells.appendChild(cell); }
  function inspectStep() { var index=+slider.value;Array.from(cells.children).forEach(function (cell,i) { cell.classList.toggle('inspected',i===index); });document.getElementById('lpStepReadout').value=(index+1)+' / '+D.chunk.steps+' · '+(index/D.chunk.hz).toFixed(2)+' s';document.getElementById('lpStepDetail').textContent=index<execute?'Executed before the next observation.':'Prediction only; the next observation triggers a new chunk.'; }
  slider.addEventListener('input',inspectStep);inspectStep();
  host.querySelectorAll('[data-target]').forEach(function (b) { b.addEventListener('click',function () { host.querySelectorAll('[data-target]').forEach(function (other) { other.setAttribute('aria-pressed',String(other===b)); });document.getElementById('lpTargetLabel').textContent=b.dataset.target==='sim'?'Simulation bridge → digital twin':'Hardware bridge → robot';selectStage('deploy'); }); });
  var groups=document.getElementById('lpStateGroups');if(groups)D.state_groups.forEach(function (group) { var b=document.createElement('button');b.type='button';b.style.setProperty('--count',group.count);b.innerHTML='<b>'+group.count+'</b><span>'+group.name+'</span>';b.addEventListener('click',function () { selectStage('train');render(group.name+': '+group.count+' coordinates','Part of the 59-coordinate state.',['Wrists count within the hand coordinates.','Base twist and lift rate are separate action fields.']); });groups.appendChild(b); });
  selectStage('collect');detail.hidden=true;window.__learningExplorer={data:D,selectStage:selectStage};
 }).catch(function () { if (host) document.getElementById('learningDetail').textContent='Learning data could not load. Reload to try again.';datasetHosts.forEach(function (target) { target.textContent='Dataset summary could not load. Reload to try again.'; }); });
})();
