/* Overview interactions keep the summaries short and the evidence inspectable. */
(function () {
  'use strict';
  document.querySelectorAll('[data-photo]').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('[data-photo]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === button));
      });
      document.querySelectorAll('#robotPhotos .rg-chap').forEach(function (chapter) {
        chapter.hidden = chapter.dataset.chap !== button.dataset.photo;
      });
    });
  });
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
  if (xray) xray.addEventListener('click', loadXray);
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
