/* Click a film, watch it full-size.
 *
 * The cards autoplay a muted loop as a preview; clicking one opens a
 * lightbox that plays the full clip with sound available and controls.
 * Cards marked .soon have nothing to play and stay inert.
 */
(function () {
  'use strict';
  var cards = document.querySelectorAll('.film-card:not(.soon)');
  if (!cards.length) return;

  var box = document.createElement('div');
  box.className = 'film-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.hidden = true;
  box.innerHTML =
    '<button class="film-close" aria-label="Close">✕</button>' +
    '<figure class="film-stage">' +
      '<video controls playsinline preload="metadata"></video>' +
      '<figcaption></figcaption>' +
    '</figure>';
  document.body.appendChild(box);

  var vid = box.querySelector('video');
  var cap = box.querySelector('figcaption');
  var last = null;

  function open(card) {
    var src = card.dataset.film ||
      (card.querySelector('video') || {}).dataset &&
      card.querySelector('video').dataset.lazyvid;
    if (!src) return;
    last = card;
    vid.src = src;
    vid.currentTime = 0;
    var b = card.querySelector('b'), s = card.querySelector('figcaption span:not(.film-tag)');
    cap.textContent = (b ? b.textContent : '') + (s ? ' — ' + s.textContent : '');
    box.hidden = false;
    document.body.classList.add('pop-locked');
    var p = vid.play();
    if (p && p.catch) p.catch(function () {});
    box.querySelector('.film-close').focus();
  }
  function close() {
    box.hidden = true;
    document.body.classList.remove('pop-locked');
    try { vid.pause(); } catch (e) {}
    vid.removeAttribute('src'); vid.load();
    if (last) { last.focus(); last = null; }
  }

  box.addEventListener('click', function (e) {
    if (e.target === box || e.target.closest('.film-close')) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) close();
  });

  Array.prototype.forEach.call(cards, function (c) {
    c.classList.add('is-playable');
    c.setAttribute('tabindex', '0');
    c.setAttribute('role', 'button');
    c.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;     // the docs link still wins
      open(c);
    });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(c); }
    });
  });
})();
