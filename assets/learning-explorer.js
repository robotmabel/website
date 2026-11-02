/* Current hand-grasping dataset and the ACT observation → action interface. */
(function () {
 'use strict';
 var host = document.getElementById('learningExplorer');
 var datasetHosts = document.querySelectorAll('[data-learning-dataset]');
 if (!host && !datasetHosts.length) return;
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
   detail.replaceChildren();var h=document.createElement('h3'),p=document.createElement('p'),ul=document.createElement('ul');h.textContent=title;p.textContent=text;
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
   button.querySelector('img').src=camera.image;button.querySelector('img').alt=camera.label+' view of ORCA hand grasping, dataset v2';
   button.addEventListener('click',function () { selectStage('collect');render(camera.label.toLowerCase()+' camera','A real hand-grasping frame from dataset v2.',['Same episode and time across all three views.','One of the three ACT camera inputs.'],['Episode '+V.preview.episode+', frame '+V.preview.frame+' at '+V.preview.seconds+' s. Images are extracted from the export without added blur.']);button.setAttribute('aria-pressed','true'); });
  });
  document.getElementById('lpChunkLabel').textContent=D.chunk.steps+' steps · '+duration+' s';slider.max=D.chunk.steps-1;slider.value=execute-1;
  for (var i=0;i<D.chunk.steps;i++) { var cell=document.createElement('i');cell.className=i<execute?'executed':'';cells.appendChild(cell); }
  function inspectStep() { var index=+slider.value;Array.from(cells.children).forEach(function (cell,i) { cell.classList.toggle('inspected',i===index); });document.getElementById('lpStepReadout').value=(index+1)+' / '+D.chunk.steps+' · '+(index/D.chunk.hz).toFixed(2)+' s';document.getElementById('lpStepDetail').textContent=index<execute?'Executed before the next observation.':'Prediction only; the next observation triggers a new chunk.'; }
  slider.addEventListener('input',inspectStep);inspectStep();
  host.querySelectorAll('[data-target]').forEach(function (b) { b.addEventListener('click',function () { host.querySelectorAll('[data-target]').forEach(function (other) { other.setAttribute('aria-pressed',String(other===b)); });document.getElementById('lpTargetLabel').textContent=b.dataset.target==='sim'?'Simulation bridge → digital twin':'Hardware bridge → robot';selectStage('deploy'); }); });
  var groups=document.getElementById('lpStateGroups');D.state_groups.forEach(function (group) { var b=document.createElement('button');b.type='button';b.style.setProperty('--count',group.count);b.innerHTML='<b>'+group.count+'</b><span>'+group.name+'</span>';b.addEventListener('click',function () { selectStage('train');render(group.name+': '+group.count+' coordinates','Part of the 59-coordinate state.',['Wrists count within the hand coordinates.','Base twist and lift rate are separate action fields.']); });groups.appendChild(b); });
  selectStage('collect');window.__learningExplorer={data:D,selectStage:selectStage};
 }).catch(function () { if (host) document.getElementById('learningDetail').textContent='Learning data could not load. Reload to try again.';datasetHosts.forEach(function (target) { target.textContent='Dataset summary could not load. Reload to try again.'; }); });
})();
