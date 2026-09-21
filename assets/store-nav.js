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
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  window.__storeDock = { paint: paint, count: count };
})();
