/* order.html while the store is closed: the photo gallery and the "coming soon"
   form. The gallery comes from assets/data/order.json (its photos only — no
   price on this page reads that file). The form posts to the store API's
   /api/interest (commerce/order_api.py); a failure is loud, never a silent
   "thanks". Exposes window.__soon for scripts/ordertest.py. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = window.MabelStore;
  var gallery = [], at = 0, browsed = false;

  function go(i) {
    if (!gallery.length) return;
    var n = gallery.length; at = ((i % n) + n) % n;
    var g = gallery[at], img = $('csSlide');
    if (img.getAttribute('src') !== g.src) img.src = g.src;
    img.alt = g.cap; img.width = g.w || 1600; img.height = g.h || 1067;
    $('csCap').textContent = g.cap;
    $('csDots').querySelectorAll('button').forEach(function (b, k) { b.setAttribute('aria-selected', String(k === at)); });
    if (browsed) { var pre = new Image(); pre.src = gallery[(at + 1) % n].src; }   // a cold visit downloads one photo
    browsed = true;
  }
  function renderDots() {
    var d = $('csDots'); d.innerHTML = '';
    gallery.forEach(function (g, i) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', g.cap);
      b.addEventListener('click', function () { go(i); }); d.appendChild(b);
    });
  }

  function values(name) {
    return Array.prototype.map.call(document.querySelectorAll('#csForm input[name="' + name + '"]:checked'), function (i) { return i.value; });
  }
  function collect() {
    var f = $('csForm');
    return {
      name: f.name.value.trim(), email: f.email.value.trim(), org: f.org.value.trim(), role: f.role.value,
      country: f.country.value.trim(), how: values('how')[0] || '', parts: values('parts'), uses: values('uses'),
      why: f.why.value.trim(), use_detail: f.use_detail.value.trim(), qty: f.qty.value, when: f.when.value,
      website: f.website.value
    };
  }
  function validate(d) {
    if (!d.name) return ['csName', 'Tell us your name.'];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(d.email)) return ['csEmail', 'Enter an email address so we can write back.'];
    if (d.why.length < 10) return ['csWhy', 'Tell us, in a sentence or two, why you need MABEL.'];
    return null;
  }
  function submit(e) {
    e.preventDefault();
    var d = collect(), err = $('csErr'), btn = $('csSubmit'), bad = validate(d);
    err.textContent = '';
    if (bad) { err.textContent = bad[1]; $(bad[0]).focus(); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    S.req('POST', '/api/interest', d).then(function () {
      $('csForm').hidden = true; $('csDone').hidden = false;
      $('csDoneText').textContent = 'We have your note, ' + d.name.split(' ')[0] + ', and will write to ' + d.email + ' when MABEL opens.';
      try { $('csDone').scrollIntoView({ block: 'center' }); } catch (x) {}
    }).catch(function (ex) {
      btn.disabled = false; btn.textContent = 'Keep me posted';
      err.textContent = 'Your note could not be sent (' + ex.message + '). Nothing was lost — please try again in a moment.';
    });
  }

  $('csForm').addEventListener('submit', submit);
  $('csPrev').addEventListener('click', function () { go(at - 1); });
  $('csNext').addEventListener('click', function () { go(at + 1); });
  var sx = null, img = $('csSlide');
  img.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1)); sx = null; }, { passive: true });

  window.__soon = { collect: collect, validate: validate, go: go, get gallery() { return gallery; }, get at() { return at; } };
  fetch('assets/data/order.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (c) {
    gallery = c.gallery || [];
    renderDots(); browsed = false; go(0); browsed = false;
    document.dispatchEvent(new CustomEvent('soon:ready'));
  }).catch(function () { document.dispatchEvent(new CustomEvent('soon:ready')); });
})();
