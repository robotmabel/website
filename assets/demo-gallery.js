/* The same Sony teleoperation collection on the overview and teleop pages. */
(function () {
  'use strict';
  var hosts = document.querySelectorAll('[data-demo-gallery]');
  if (!hosts.length) return;
  fetch('assets/data/demo-gallery.json', {cache: 'no-cache'}).then(function (r) {
    if (!r.ok) throw new Error('gallery');
    return r.json();
  }).then(function (data) {
    hosts.forEach(function (host) {
      data.clips.filter(function (clip) { return clip.collection === host.dataset.demoGallery; }).forEach(function (clip) {
        var card = document.createElement('figure'), video = document.createElement('video');
        card.className = 'dg-card'; card.dataset.demo = clip.key;
        video.muted = true; video.loop = true; video.playsInline = true;
        video.preload = 'none'; video.dataset.poster = clip.poster;
        video.dataset.lazyvid = clip.video; video.dataset.lo = clip.lo;
        video.setAttribute('aria-label', clip.label + ', Sony teleoperated demonstration');
        var frame = document.createElement('div'), toggle = document.createElement('button');
        frame.className = 'dg-frame'; toggle.type = 'button'; toggle.className = 'dg-toggle';
        toggle.textContent = '▶'; toggle.setAttribute('aria-label', 'Play ' + clip.label);
        toggle.addEventListener('click', function () {
          var active = frame.querySelector('video');
          if (!active.paused) active.pause(); else active.play().catch(function () { active.controls = true; });
        });
        function state(event) {
          var playing = event.type === 'playing'; toggle.textContent = playing ? 'Ⅱ' : '▶';
          toggle.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + clip.label);
        }
        frame.addEventListener('playing', state, true); frame.addEventListener('pause', state, true);
        frame.append(video, toggle);
        var caption = document.createElement('figcaption'), label = document.createElement('a'), speed = document.createElement('span');
        label.textContent = clip.label; label.href = clip.video; label.target = '_blank'; label.rel = 'noopener';
        label.setAttribute('aria-label', 'Open full video: ' + clip.label); speed.textContent = clip.speed + '×';
        caption.append(label, speed); card.append(frame, caption); host.appendChild(card);
      });
      host.setAttribute('aria-busy', 'false');
      if (window.__lazyVid) window.__lazyVid(host);
    });
  }).catch(function () {
    hosts.forEach(function (host) { host.textContent = 'The demo collection could not load. Please reload to try again.'; host.setAttribute('aria-busy', 'false'); });
  });
})();
