/* The top-right dock on every page: cart count and signed-in state, read from
   the same localStorage the order page writes. On order.html the page's own
   script takes the clicks over (drawer / sheet); elsewhere they are links. */
(function () {
  'use strict';
  var dock = document.getElementById('storeDock');
  if (!dock) return;
  var n = document.getElementById('storeCartN'), acct = document.getElementById('storeAcct');
  function count() {
    try { return JSON.parse(localStorage.getItem('mabel.cart.v1') || '[]').reduce(function (a, i) { return a + (i.qty || 1); }, 0); }
    catch (e) { return 0; }
  }
  function paint() {
    var k = count();
    if (n) { n.textContent = String(k); n.hidden = k === 0; }
    var signed = false;
    try { signed = !!localStorage.getItem('mabel.session'); } catch (e) {}
    if (acct) acct.classList.toggle('is-in', signed);
  }
  paint();
  window.addEventListener('storage', paint);
  document.addEventListener('order:cart', paint);
  document.addEventListener('order:auth', paint);
  var last = -1;
  function onScroll() {
    var s = window.scrollY > 12 ? 1 : 0;
    if (s !== last) { dock.classList.toggle('scrolled', !!s); last = s; }
  }
  /* Sit BESIDE the bar, not at the viewport's edge. The bar is a centred pill
     whose width depends on the fonts and the viewport, so the gap is measured:
     10 px to the right of the bar, centred on its height. Below the burger
     breakpoint the stylesheet places the dock inside the bar instead. */
  var GAP = 18;   // daylight between the bar and the dock; the dock is the bar's height
  function place() {
    var nav = document.getElementById('nav'), hbg = document.getElementById('hbg');
    if (!nav) return;
    if (hbg && getComputedStyle(hbg).display !== 'none') { dock.style.left = ''; dock.style.right = ''; dock.style.height = ''; dock.style.removeProperty('--dock-top'); return; }
    var r = nav.getBoundingClientRect();
    var rest = r.top + (nav.classList.contains('scrolled') ? 4 : 0);   // the bar rises 4 px once scrolled
    dock.style.height = Math.round(r.height) + 'px';
    var w = dock.offsetWidth;
    dock.style.left = Math.min(r.right + GAP, window.innerWidth - w - 10) + 'px';
    dock.style.right = 'auto';
    dock.style.setProperty('--dock-top', Math.round(rest) + 'px');
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  window.addEventListener('resize', place); place();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  window.addEventListener('load', function () { place(); setTimeout(place, 300); });
  window.__storeDock = { paint: paint, count: count, place: place };
})();
