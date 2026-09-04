/* faq-pop.js — the comic pop-up panels behind the troubleshooting cards.
 *
 * A `.faq-card` names a `<template>` by id in `data-faq`; the template holds
 * `<h_>`, `<img_>` and `<div_>` (invented tags, so the browser parses them
 * without running the images or laying anything out). Clicking a card fills the
 * single `#faq-overlay` and shows it.
 *
 * Was inline in build.html; lifted here when build.html folded into the wiki so
 * docs/troubleshoot.html can use it too.
 */
(function () {
  var overlay = document.getElementById('faq-overlay');
  if (!overlay) return;
  var title = document.getElementById('faq-pop-title');
  var img = document.getElementById('faq-pop-img');
  var body = document.getElementById('faq-pop-body');
  var bangs = ['FIX!', 'POW!', 'AHA!', 'ZAP!'];
  function open(id, i) {
    var t = document.getElementById(id);
    if (!t) return;
    var frag = t.content;
    title.textContent = frag.querySelector('h_').textContent;
    var f = frag.querySelector('img_');
    if (f) { img.src = f.getAttribute('src'); img.alt = f.getAttribute('alt') || ''; }
    body.innerHTML = frag.querySelector('div_').innerHTML;
    overlay.querySelector('.faq-bang').textContent = bangs[i % bangs.length];
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function close() { overlay.hidden = true; document.body.style.overflow = ''; }
  document.querySelectorAll('.faq-card').forEach(function (c, i) {
    c.addEventListener('click', function () { open(c.dataset.faq, i); });
  });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  var x = document.getElementById('faq-x');
  if (x) x.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) close(); });
})();
