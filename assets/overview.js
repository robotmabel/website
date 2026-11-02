/* Overview interactions keep the summaries short and the evidence inspectable. */
(function () {
  'use strict';
  // Original cursor-following cover model, deferred until the page has settled.
  if (document.getElementById('heroRig')) {
    var loadHero = function () { var script=document.createElement('script');script.type='module';script.src='assets/hero-rig.js?v=cover-frame-2';document.body.appendChild(script); };
    var idle = function () { if(window.requestIdleCallback) requestIdleCallback(loadHero,{timeout:2500});else setTimeout(loadHero,400); };
    if(document.readyState==='complete') idle();else addEventListener('load',idle,{once:true});
  }
  // The cover robot becomes a small companion once it scrolls out of view.
  var rig=document.getElementById('heroRig'),hero=document.getElementById('hero');
  if(rig&&hero){
    var home=document.createComment('cover robot home');rig.after(home);var mini=false,rigFrame=false;
    function dockRig(){rigFrame=false;var wanted=innerWidth<980&&scrollY>Math.max(180,hero.offsetHeight-innerHeight+180);if(wanted===mini)return;mini=wanted;
      rig.classList.toggle('mini',mini);if(mini)document.body.appendChild(rig);else hero.insertBefore(rig,home);
      dispatchEvent(new Event('resize'));
    }
    function scheduleRig(){if(!rigFrame){rigFrame=true;requestAnimationFrame(dockRig);}}
    addEventListener('scroll',scheduleRig,{passive:true});addEventListener('resize',scheduleRig);scheduleRig();
  }
  var submission=document.getElementById('submissionDialog');
  if(submission){
    var film=submission.querySelector('video'),opener=null,status=document.getElementById('submissionStatus'),start=document.getElementById('submissionStart');
    function startFilm(){
      film.muted=false;film.playsInline=true;status.textContent='Loading the final submission…';start.hidden=false;
      var promise=film.play();
      if(promise&&promise.catch)promise.catch(function(){status.textContent='Tap Start video or the player’s play control to begin with sound.';start.hidden=false;});
    }
    document.querySelectorAll('[data-submission-play]').forEach(function(button){button.addEventListener('click',function(event){
      if(typeof submission.showModal!=='function')return;
      event.preventDefault();opener=button;
      document.querySelectorAll('video').forEach(function(video){if(video!==film&&!video.paused){video.dataset.modalPaused='true';video.pause();}});
      submission.showModal();document.body.classList.add('pop-locked');
      // The MP4 source is already selected before this gesture; retain it between opens.
      startFilm();
    });});
    start.addEventListener('click',startFilm);
    film.addEventListener('playing',function(){status.textContent='Final submission · sound on';start.hidden=true;});
    film.addEventListener('waiting',function(){status.textContent='Buffering…';});
    film.addEventListener('error',function(){status.textContent='The video could not load. Use Open video to watch the same file directly.';start.hidden=false;});
    submission.querySelector('.film-close').addEventListener('click',function(){submission.close();});
    submission.addEventListener('click',function(event){if(event.target===submission){var r=submission.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)submission.close();}});
    submission.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();submission.close();}});
    submission.addEventListener('close',function(){film.pause();film.currentTime=0;document.body.classList.remove('pop-locked');document.querySelectorAll('video[data-modal-paused]').forEach(function(video){delete video.dataset.modalPaused;if(!matchMedia('(prefers-reduced-motion: reduce)').matches){var r=video.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)video.play().catch(function(){});}});if(opener)opener.focus({preventScroll:true});});
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
