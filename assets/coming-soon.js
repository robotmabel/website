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
    if (img.getAttribute('src') !== g.src) img.src = g.src;   // a clip's poster doubles as its still
    img.alt = g.cap; img.width = g.w || 1600; img.height = g.h || 1067;
    clip(g);
    $('csCap').textContent = g.cap;
    $('csDots').querySelectorAll('button').forEach(function (b, k) { b.setAttribute('aria-selected', String(k === at)); });
    if (browsed) { var pre = new Image(); pre.src = gallery[(at + 1) % n].src; }   // a cold visit downloads one photo
    browsed = true;
  }
  /* a gallery item with a `video` plays over its own poster, in the same frame */
  var vid = null;
  function clip(g) {
    var box = document.querySelector('.cs-slide'), spin = box.querySelector('.vid-spin');
    if (!g.video) { if (vid) { vid.pause(); vid.hidden = true; } if (spin) spin.remove(); return; }
    if (!vid) {
      vid = document.createElement('video'); vid.id = 'csVid'; vid.muted = true; vid.loop = true; vid.playsInline = true;
      vid.setAttribute('playsinline', ''); vid.preload = 'auto';
      vid.addEventListener('playing', function () { var s = box.querySelector('.vid-spin'); if (s) s.remove(); });
      vid.addEventListener('waiting', function () { if (!box.querySelector('.vid-spin')) box.appendChild(ring()); });
      box.insertBefore(vid, $('csPrev'));
    }
    vid.hidden = false;
    if (vid.getAttribute('src') !== g.video) {
      vid.poster = g.src; vid.src = g.video;
      if (!box.querySelector('.vid-spin')) box.appendChild(ring());
    }
    var p = vid.play(); if (p && p.catch) p.catch(function () {});
  }
  function ring() { var s = document.createElement('span'); s.className = 'vid-spin'; s.setAttribute('aria-hidden', 'true'); return s; }

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
  function cleanEmail(value) {
    value = value.trim(); var at = value.lastIndexOf('@');
    return at < 0 ? value : value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
  }
  function emailProblem(value) {
    var parts = value.split('@'), local = parts[0] || '', domain = parts[1] || '';
    if (parts.length !== 2 || !local || !domain) return 'Enter an email address, such as name@university.edu.';
    if (value.length > 254 || local.length > 64 || !/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~.-]+$/.test(local) || local[0] === '.' || local.slice(-1) === '.' || local.indexOf('..') >= 0) return 'Check the part of your email address before @.';
    if (/[\s/\\?#:%\[\]]/.test(domain)) return 'Check the domain after @ in your email address.';
    try { domain = new URL('https://' + domain).hostname; } catch (ex) { return 'Check the domain after @ in your email address.'; }
    var top = domain.split('.').slice(-1)[0];
    if (!domain.includes('.') || domain.length > 253 || !domain.split('.').every(function (part) { return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part); }) || !(top.startsWith('xn--') || /^[a-z]{2,63}$/i.test(top))) return 'Enter a complete email domain, such as gmail.com or university.edu.';
    return '';
  }
  var emailVersion = 0, emailSuggestion = '';
  var emailTypos = { 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cmo': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'icloud.con': 'icloud.com' };
  function emailMessage(message, state) {
    $('csEmailHint').textContent = message; $('csEmailHint').dataset.state = state || '';
    $('csEmail').setAttribute('aria-invalid', String(state === 'error'));
  }
  function suggestEmail(value) {
    var at = value.lastIndexOf('@'), fix = emailTypos[value.slice(at + 1)];
    emailSuggestion = fix ? value.slice(0, at + 1) + fix : '';
    $('csEmailFix').hidden = !emailSuggestion;
    $('csEmailFix').textContent = emailSuggestion ? 'Use ' + emailSuggestion + '?' : '';
  }
  function checkEmail() {
    var value = cleanEmail($('csEmail').value), version = ++emailVersion;
    $('csEmail').value = value; suggestEmail(value);
    if (!value) { emailMessage('Use an address where we can reach you.'); return; }
    var problem = emailProblem(value);
    if (problem) { emailMessage(problem, 'error'); return; }
    emailMessage(emailSuggestion ? 'Possible typo — check the suggested address below.' : 'Checking email domain…');
    S.req('POST', '/api/interest/email-check', { email: value }).then(function () {
      if (version !== emailVersion) return;
      emailMessage(emailSuggestion ? 'Possible typo — check the suggested address below.' : 'This domain accepts email. Please double-check the address.');
    }).catch(function (ex) {
      if (version !== emailVersion) return;
      emailMessage(ex.status === 400 ? ex.message : 'Email check is temporarily unavailable. We will check again when you submit.', ex.status === 400 ? 'error' : '');
    });
  }
  function collect() {
    var f = $('csForm');
    return {
      name: f.name.value.trim(), email: cleanEmail(f.email.value), org: f.org.value.trim(), role: f.role.value,
      country: f.country.value.trim(), how: values('how')[0] || '', parts: values('parts'), uses: values('uses'),
      why: f.why.value.trim(), use_detail: f.use_detail.value.trim(), qty: f.qty.value, when: f.when.value,
      website: f.website.value
    };
  }
  function validate(d) {
    if (!d.name) return ['csName', 'Tell us your name.'];
    var problem = emailProblem(d.email);
    if (problem) return ['csEmail', problem];
    if (d.why.length < 10) return ['csWhy', 'Tell us, in a sentence or two, why you need MABEL.'];
    return null;
  }
  function submit(e) {
    e.preventDefault();
    var d = collect(), err = $('csErr'), btn = $('csSubmit'), bad = validate(d);
    err.textContent = '';
    if (bad) { err.textContent = bad[1]; if (bad[0] === 'csEmail') emailMessage(bad[1], 'error'); $(bad[0]).focus(); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    S.req('POST', '/api/interest', d).then(function (result) {
      emailVersion++; d.email = result.email || d.email;
      $('csForm').hidden = true; $('csDone').hidden = false;
      $('csDoneText').textContent = 'We have your note, ' + d.name.split(' ')[0] + ', and will write to ' + d.email + ' when MABEL opens.';
      try { $('csDone').scrollIntoView({ block: 'center' }); } catch (x) {}
    }).catch(function (ex) {
      btn.disabled = false; btn.textContent = 'Keep me posted';
      err.textContent = 'Your note could not be sent. ' + ex.message + ' Your information is still here.';
      if (ex.field === 'email') { emailVersion++; emailMessage(ex.message, ex.status === 400 ? 'error' : ''); $('csEmail').focus(); }
    });
  }

  $('csForm').addEventListener('submit', submit);
  $('csEmail').addEventListener('input', function () { emailVersion++; $('csEmailFix').hidden = true; emailMessage('Use an address where we can reach you.'); });
  $('csEmail').addEventListener('blur', checkEmail);
  $('csEmailFix').addEventListener('click', function () { $('csEmail').value = emailSuggestion; $('csEmail').focus(); checkEmail(); });
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
