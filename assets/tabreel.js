/* Tab reels: one horizontally sliding row of cards per app (teleop.html).
 *
 *   <div class="tabreel" data-tabreel>
 *     <div class="trl-track"> <figure class="trl-card">…</figure> … </div>
 *   </div>
 *
 * The track is a native scroll-snap row, so touch, trackpad and shift-wheel all
 * work without this script. The script adds the furniture: prev/next arrows, a
 * row of tab chips that name each card and jump to it, the active state as the
 * row scrolls, and arrow-key stepping when the reel has focus.
 */
(function () {
  'use strict';
  [].forEach.call(document.querySelectorAll('[data-tabreel]'), function (reel) {
    var track = reel.querySelector('.trl-track');
    var cards = [].slice.call(track.querySelectorAll('.trl-card'));
    if (!cards.length) return;

    var bar = document.createElement('div');
    bar.className = 'trl-bar';
    var chips = document.createElement('div');
    chips.className = 'trl-chips';
    chips.setAttribute('role', 'tablist');
    cards.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'trl-chip'; b.setAttribute('role', 'tab');
      b.textContent = c.getAttribute('data-tab') || String(i + 1);
      b.addEventListener('click', function () { go(i); });
      chips.appendChild(b);
    });
    var prev = arrow('prev', '←', 'Previous tab'), next = arrow('next', '→', 'Next tab');
    bar.appendChild(chips); bar.appendChild(prev); bar.appendChild(next);
    reel.insertBefore(bar, track);

    function arrow(cls, glyph, label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'trl-arrow ' + cls; b.textContent = glyph;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', function () { go(cur + (cls === 'next' ? 1 : -1)); });
      return b;
    }

    var cur = 0;
    function go(i) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: cards[i].offsetLeft - track.offsetLeft - parseFloat(getComputedStyle(track).paddingLeft || 0), behavior: 'smooth' });
    }
    function sync() {
      var x = track.scrollLeft, best = 0, bd = 1e9;
      cards.forEach(function (c, i) {
        var d = Math.abs(c.offsetLeft - track.offsetLeft - x);
        if (d < bd) { bd = d; best = i; }
      });
      // at the far right the last card may never reach the left edge
      if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 4) best = cards.length - 1;
      cur = best;
      [].forEach.call(chips.children, function (b, i) {
        b.classList.toggle('on', i === best); b.setAttribute('aria-selected', i === best ? 'true' : 'false');
      });
      cards.forEach(function (c, i) { c.classList.toggle('on', i === best); });
      prev.disabled = best === 0; next.disabled = best === cards.length - 1;
    }
    var t = 0;
    track.addEventListener('scroll', function () { cancelAnimationFrame(t); t = requestAnimationFrame(sync); }, { passive: true });
    window.addEventListener('resize', sync);
    track.tabIndex = 0;
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { go(cur + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); }
    });
    sync();

    // annotated screenshots: a pin and its numbered line light up together
    cards.forEach(function (card) {
      var items = [].slice.call(card.querySelectorAll('[data-n]'));
      function light(n) {
        items.forEach(function (el) { el.classList.toggle('lit', el.getAttribute('data-n') === n); });
      }
      items.forEach(function (el) {
        var n = el.getAttribute('data-n');
        el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') light(n); });
        el.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') light(null); });
        el.addEventListener('focus', function () { if (el.matches(':focus-visible')) light(n); });
        el.addEventListener('blur', function () { light(null); });
        // a tap (no hover on touch) toggles the pair
        el.addEventListener('click', function (e) { if (e.pointerType !== 'mouse') light(el.classList.contains('lit') ? null : n); });
      });
    });
  });
})();
