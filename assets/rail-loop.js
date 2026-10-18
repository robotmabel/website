/* The in-the-wild rail drifts forever.
 *
 * The strip used to stop dead at the last card. Cloning the run once and
 * translating the track by exactly -50% makes the wrap seamless: the copy
 * is in the same place the original started. Duration scales with content
 * so the speed is constant however many cards there are.
 */
(function () {
  'use strict';
  document.querySelectorAll('.marquee-track').forEach(function (track) {
    var cards = Array.prototype.slice.call(track.children);
    if (cards.length < 2 || track.dataset.looped) return;
    track.dataset.looped = '1';

    /* one duplicate run, hidden from assistive tech */
    cards.forEach(function (c) {
      var copy = c.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      /* a cloned <video> must not double the decode cost: let the lazy
         loader treat it as a normal clip, it will only play in view */
      track.appendChild(copy);
    });

    /* constant speed: ~70 px/s regardless of how many cards there are */
    var span = track.scrollWidth / 2;
    track.style.setProperty('--rail-dur', Math.max(40, Math.round(span / 70)) + 's');
    track.classList.add('auto');

    /* dragging takes over, then the drift resumes */
    var down = false;
    track.addEventListener('pointerdown', function () {
      down = true; track.classList.add('paused');
    });
    window.addEventListener('pointerup', function () {
      if (!down) return;
      down = false;
      setTimeout(function () { track.classList.remove('paused'); }, 1800);
    });
  });
})();
