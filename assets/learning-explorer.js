/* Inspect the paper's recording → ACT → shared-controller interface. */
(function(){
 'use strict';
 var host=document.getElementById('learningExplorer');if(!host)return;
 fetch('assets/data/learning-pipeline.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw Error('data');return r.json();}).then(function(D){
  var detail=document.getElementById('learningDetail'),slider=document.getElementById('lpStep'),cells=document.getElementById('lpChunkCells');
  var execute=Math.round(D.chunk.execute_seconds*D.chunk.hz),duration=D.chunk.steps/D.chunk.hz;
  var stages={
   collect:['Record intent and measured state','Vision Pro teleoperation records the complete episode, with raw timestamps and validity information.',[
    'Stereo head RGB and both wrist RGB streams: nominal '+D.recording.camera_hz+' Hz; available depth is retained.',
    'Joint feedback, commanded references, base twist and lift-jog commands: nominal '+D.recording.control_hz+' Hz.',
    'Measured state q and demonstrated command q* remain distinct; commands are the training targets.'
   ]],
   export:['Curate, align and export','Replay the video and robot state together, then trim or discard episodes while preserving the raw recordings.',[
    'Export curated episodes to LeRobot v3 on a 30 Hz grid.',
    'At each export time, take the latest available sample from each stream; keep timing and validity information.',
    'The 59-coordinate joint representation does not include the separately stored base-twist and lift-jog command fields.'
   ]],
   train:['Train the ACT policy','Three camera views and joint history become a chunk of '+D.chunk.steps+' predicted joint references.',[
    'Paper inputs: left head + both wrist images at 320 × 240; past 1 s of joint positions sampled at 5 Hz.',
    'Encode each camera separately, fuse image features and state, then use the transformer encoder/decoder to predict references for '+duration+' s at '+D.chunk.hz+' Hz.',
    'Supervise the prediction with demonstrated q* references, including finger and wrist targets.'
   ]],
   deploy:['Execute, observe and re-plan','The policy uses the same whole-body controller as teleoperation.',[
    'Execute the first '+execute+' references ('+D.chunk.execute_seconds+' s) from each '+D.chunk.steps+'-step chunk.',
    'Take new observations and predict the next chunk; the paper experiment uses no temporal ensembling.',
    'The shared controller and bridge route references to hardware or the digital twin.'
   ]]
  };
  function render(title,text,items){detail.replaceChildren();var h=document.createElement('h3'),p=document.createElement('p'),ul=document.createElement('ul');h.textContent=title;p.textContent=text;items.forEach(function(item){var li=document.createElement('li');li.textContent=item;ul.appendChild(li);});detail.append(h,p,ul);}
  function selectStage(key){var data=stages[key];render(data[0],data[1],data[2]);host.dataset.stage=key;host.querySelectorAll('[data-learn]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.learn===key));});host.querySelectorAll('[data-camera],[data-node]').forEach(function(b){b.setAttribute('aria-pressed','false');});}
  host.querySelectorAll('[data-learn]').forEach(function(b){b.addEventListener('click',function(){selectStage(b.dataset.learn);});});
  var nodeNotes={
   encoders:['Image encoders','The paper policy consumes three views: the left head image and both wrist images.',['Each 320 × 240 view is encoded separately.','The recording retains both stereo head streams; using the left head view for the policy is a training-input choice.','The three images shown here are real frames from the paper’s grasp demonstration.']],
   transformer:['ACT encoder / decoder','Image features are fused with measured joint history to predict a sequence of joint references.',['History covers the past 1 s at 5 Hz.','The output is 120 joint-reference steps at 30 Hz, including both hands’ fingers and wrists.','Demonstrated references supervise training; the browser diagram is an interface guide, not a running learned policy.']],
   state:['Joint state: 59 coordinates','The state includes the full robot representation used in the paper.',['14 arm + 34 hand/wrist + 3 neck + 1 torso + 1 lift + 6 swerve coordinates.','The coupled lift stages count as one height; wrist joints are already included in the 34 hand coordinates.','Base-twist and lift-jog commands are recorded as separate fields.']],
   references:['Predicted reference chunk','A four-second prediction is used in a one-second execution cycle.',['120 references × 1/30 s = 4 s of prediction.','Only the first 30 references are executed before observing again.','Use the slider to inspect the execution window versus the remaining prediction.']],
   controller:['One execution path','Policy references return through the same control path used to collect the demonstrations.',['The controller handles joint references, collision constraints and compliant tracking.','The motion model bounds base motion using lift height and the tip-over envelope.','Select Robot or Digital twin to inspect the destination bridge; this switch does not connect to a robot.']]
  };
  host.querySelectorAll('[data-node]').forEach(function(b){b.addEventListener('click',function(){var data=nodeNotes[b.dataset.node];selectStage(['references','controller'].includes(b.dataset.node)?'deploy':'train');render(data[0],data[1],data[2]);b.setAttribute('aria-pressed','true');});});
  var cameraNames={head:'Left head camera',left:'Left wrist camera',right:'Right wrist camera'};
  host.querySelectorAll('[data-camera]').forEach(function(b){b.addEventListener('click',function(){selectStage('collect');render(cameraNames[b.dataset.camera],'Recorded view used by the paper’s ACT policy.',['Nominal RGB recording rate: 30 Hz.','Policy image size: 320 × 240 pixels.','This is a recorded grasp frame; camera images are paired with measured state and demonstrated references during export.']);b.setAttribute('aria-pressed','true');});});
  document.getElementById('lpChunkLabel').textContent=D.chunk.steps+' steps · '+duration+' s';slider.max=D.chunk.steps-1;slider.value=execute-1;
  for(var i=0;i<D.chunk.steps;i++){var cell=document.createElement('i');cell.className=i<execute?'executed':'';cells.appendChild(cell);}
  function inspectStep(){var index=+slider.value;Array.from(cells.children).forEach(function(cell,i){cell.classList.toggle('inspected',i===index);});document.getElementById('lpStepReadout').value=(index+1)+' / '+D.chunk.steps+' · t + '+(index/D.chunk.hz).toFixed(2)+' s';document.getElementById('lpStepDetail').textContent=index<execute?'Inside the first-second execution window. After 30 references, collect new observations and re-plan.':'A later prediction in the chunk. In the paper experiment, the policy re-plans before this reference would be executed.';}
  slider.addEventListener('input',inspectStep);inspectStep();
  host.querySelectorAll('[data-target]').forEach(function(b){b.addEventListener('click',function(){host.querySelectorAll('[data-target]').forEach(function(other){other.setAttribute('aria-pressed',String(other===b));});document.getElementById('lpTargetLabel').textContent=b.dataset.target==='sim'?'Simulation bridge → MuJoCo / Isaac Lab':'Hardware bridge → robot';selectStage('deploy');});});
  var groups=document.getElementById('lpStateGroups');D.state_groups.forEach(function(group){var b=document.createElement('button');b.type='button';b.style.setProperty('--count',group.count);b.innerHTML='<b>'+group.count+'</b><span>'+group.name+'</span>';b.addEventListener('click',function(){selectStage('train');render(group.name+': '+group.count+' coordinates','Part of the paper’s 59-coordinate joint representation.',['The state and the predicted reference use the same coordinate convention.','The past second of measured joint state is sampled at 5 Hz for the policy input.','Wrists count inside the hand coordinates; base twist and lift-jog are separate command fields.']);});groups.appendChild(b);});
  var E=D.experiment,metrics=[[E.demonstrations,'Demonstrations'],[E.episodes,'Curated episodes'],[E.minutes+' min','Recorded data'],[E.split.join(' / '),'Takes: train / val / test'],[E.train_steps.toLocaleString(),'Training steps'],[E.batch_size,'Batch size'],[E.hours+' h','Training · '+E.device],[E.timeout_seconds+' s','Limit per autonomous trial']];
  document.getElementById('lpExperiment').innerHTML=metrics.map(function(m){return '<div><b>'+m[0]+'</b><span>'+m[1]+'</span></div>';}).join('');
  document.getElementById('lpSuccess').textContent=E.successes+' / '+E.trials+' successful autonomous trials';document.getElementById('lpScope').textContent=E.scope+' Objects were placed randomly within a '+E.placement_cm.join(' × ')+' cm region.';
  selectStage('collect');window.__learningExplorer={data:D,selectStage:selectStage};
 }).catch(function(){document.getElementById('learningDetail').textContent='Learning data could not load. See the paper and training tools for the full method.';});
})();
