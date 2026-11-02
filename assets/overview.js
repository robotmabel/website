/* Overview interactions keep the summaries short and the evidence inspectable. */
(function () {
  'use strict';
  // Original cursor-following cover model, deferred until the page has settled.
  if (document.getElementById('heroRig')) {
    var loadHero = function () { var script=document.createElement('script');script.type='module';script.src='assets/hero-rig.js?v=cover-frame-2';document.body.appendChild(script); };
    var idle = function () { if(window.requestIdleCallback) requestIdleCallback(loadHero,{timeout:2500});else setTimeout(loadHero,400); };
    if(document.readyState==='complete') idle();else addEventListener('load',idle,{once:true});
  }
  var submission=document.getElementById('submissionDialog');
  if(submission) {
    var film=submission.querySelector('video'),opener=null;
    document.querySelectorAll('[data-submission-play]').forEach(function(button){button.addEventListener('click',function(){
      opener=button;
      // Pause the surrounding silent loops while the full film plays with narration.
      document.querySelectorAll('video').forEach(function(video){if(video!==film && !video.paused){video.dataset.modalPaused='true';video.pause();}});
      if(!film.getAttribute('src')) film.src=film.dataset.src;
      submission.showModal();document.body.classList.add('pop-locked');
      var play=film.play();if(play)play.catch(function(){});
    });});
    submission.querySelector('.film-close').addEventListener('click',function(){submission.close();});
    submission.addEventListener('click',function(event){if(event.target===submission){var r=submission.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)submission.close();}});
    submission.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();submission.close();}});
    submission.addEventListener('close',function(){film.pause();film.removeAttribute('src');film.load();document.body.classList.remove('pop-locked');document.querySelectorAll('video[data-modal-paused]').forEach(function(video){delete video.dataset.modalPaused;if(!matchMedia('(prefers-reduced-motion: reduce)').matches){var r=video.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)video.play().catch(function(){});}});if(opener)opener.focus({preventScroll:true});});
  }
  var rail=document.querySelector('.ov-scroll-rail');
  if(rail){
    var dots=Array.from(rail.querySelectorAll('a')),progress=document.getElementById('pageProgress'),scheduled=false;
    function updateProgress(){scheduled=false;var total=document.documentElement.scrollHeight-innerHeight;var fraction=total>0?Math.min(1,Math.max(0,scrollY/total)):1;progress.value=Math.round(fraction*100)+'%';var current=0;
      dots.forEach(function(dot,i){var section=document.querySelector(dot.hash);if(section&&section.getBoundingClientRect().top<innerHeight*.4)current=i;});
      if(fraction>.995)current=dots.length-1;
      dots.forEach(function(dot,i){dot.classList.toggle('passed',i<current);if(i===current)dot.setAttribute('aria-current','location');else dot.removeAttribute('aria-current');});
    }
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(updateProgress);}}
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);new ResizeObserver(schedule).observe(document.body);updateProgress();
  }
  var xray = document.getElementById('loadXray');
  var xrayLoading = false;
  function loadXray() {
    if (xrayLoading) return;
    xrayLoading = true; xray.disabled = true; xray.textContent = 'Loading model…';
    import('./anatomy.js').then(function () {
      document.querySelector('.ov-xray-boot').remove();
    }).catch(function () {
      xrayLoading = false; xray.disabled = false; xray.textContent = 'Retry interactive X-ray';
    });
  }
  if (xray) { xray.addEventListener('click', loadXray); if ('IntersectionObserver' in window) { var xrayObserver=new IntersectionObserver(function(entries){if(entries.some(function(e){return e.isIntersecting;})){loadXray();xrayObserver.disconnect();}},{rootMargin:'250px 0px'});xrayObserver.observe(document.getElementById('anat3d'));}else loadXray(); }
  document.querySelectorAll('.anat-rail button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!xrayLoading) {
        var selected = b.dataset.module;
        loadXray();
        var box = document.getElementById('anat3d');
        var observer = new MutationObserver(function () {
          if (box.classList.contains('loaded')) { observer.disconnect(); b.click(); }
        });
        observer.observe(box, { attributes: true, attributeFilter: ['class'] });
      }
    });
  });
  var stages = {
    collect: ['Collect demonstrations', 'Vision Pro teleoperation records stereo head and wrist RGB, available depth, timestamped joint feedback, commanded references, base twist and lift-jog commands. Raw timestamps and validity flags are retained.'],
    export: ['Export to LeRobot v3', 'Curated episodes are exported on a 30 Hz grid using the latest available sample from each stream. The joint representation has 59 coordinates; base-twist and lift-jog commands are stored separately.'],
    train: ['Train ACT', 'Each camera image is encoded separately and fused with the joint state. ACT predicts 120 joint-reference steps, spanning four seconds at 30 Hz; the demonstrated references supervise training.'],
    deploy: ['Execute through the shared controller', 'The policy sends predicted joint references through the same whole-body controller used during teleoperation. In the paper experiment, the first second of each predicted chunk is executed before replanning.']
  };
  var panel = document.getElementById('learningDetail');
  function selectLearning(key) {
    if (!panel || !stages[key]) return;
    panel.replaceChildren();
    var h = document.createElement('h3'), p = document.createElement('p');
    h.textContent = stages[key][0]; p.textContent = stages[key][1];
    panel.append(h, p);
    document.querySelectorAll('[data-learn]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.learn === key));
    });
  }
  document.querySelectorAll('[data-learn]').forEach(function (b) {
    b.addEventListener('click', function () { selectLearning(b.dataset.learn); });
  });
  selectLearning('collect');
  var links = Array.from(document.querySelectorAll('.ov-nav a'));
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          if (link.hash === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-15% 0px -65% 0px' });
    links.forEach(function (link) { var section = document.querySelector(link.hash); if (section) observer.observe(section); });
  }
})();
