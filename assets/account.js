/* account.html — the robots on the account and where each one is in its build,
   the orders, the tools an owner uses, and how they sign in. Reads everything
   from /api/auth/me through assets/store-api.js. Exposes window.__account for
   scripts/accounttest.py. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = window.MabelStore, user = null, otp = { email: false, sms: false }, mode = 'login', codeSentTo = '';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg) { var t = $('ordToast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 2200); }
  function day(s) { return s ? String(s).slice(0, 10) : ''; }
  function plusYear(s) { if (!s) return ''; var d = new Date(s.slice(0, 10)); if (isNaN(d)) return ''; d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); }

  /* ── signed-in view ── */
  function render() {
    var guest = $('acctGuest'), me = $('acctUser');
    guest.hidden = !!user; me.hidden = !user;
    if (!user) { renderForm(); return; }
    $('acctHello').textContent = 'Hello.';
    $('acctMeta').innerHTML = 'Signed in as <b>' + esc(user.ident) + '</b>' + (user.created ? ' · account since ' + esc(day(user.created)) : '');
    renderRobots(); renderOrders();
    $('secHow').textContent = (user.kind === 'phone' ? 'By phone number ' : 'By email ') + user.ident + (user.has_password ? ', with a password.' : ', with a one-time code. Set a password below to sign in without one.');
    $('pwTitle').textContent = user.has_password ? 'Change password' : 'Set a password';
    $('pwHint').textContent = user.has_password ? 'At least eight characters. Other devices stay signed in.' : 'At least eight characters.';
  }
  var STAGE_LABEL = { ordered: 'Ordered', building: 'Building', testing: 'Testing', shipped: 'Shipped', delivered: 'Delivered' };
  function renderRobots() {
    var list = $('robotList'); list.innerHTML = '';
    var robots = user.robots || [];
    if (!robots.length) {
      list.innerHTML = '<div class="acct-empty"><p>No robots on this account yet. Configure one, or register one you have built.</p><a class="btn btn-primary" href="order.html">Configure a MABEL</a></div>';
      return;
    }
    robots.forEach(function (r) {
      var c = document.createElement('article'); c.className = 'robot-card'; c.dataset.serial = r.serial || '';
      var stages = r.stages || [], at = stages.indexOf(r.stage);
      var dates = { ordered: day(r.ordered), shipped: day(r.shipped), delivered: day(r.delivered) };
      var steps = stages.map(function (s, i) {
        var cls = i < at ? 'is-done' : (i === at ? 'is-now' : '');
        var extra = s === 'shipped' && r.tracking ? '<small>' + esc(r.tracking) + '</small>' : (dates[s] ? '<small>' + esc(dates[s]) + '</small>' : '');
        return '<div class="robot-step ' + cls + '">' + STAGE_LABEL[s] + extra + '</div>';
      }).join('');
      var title = r.source === 'order' ? r.name : (r.name || 'MABEL') + ' · ' + (r.source === 'kit' ? 'built from the kit' : 'built from the plans');
      var serial = r.serial ? '<span class="robot-serial">Serial ' + esc(r.serial) + '</span>' : '<span class="robot-serial is-tbd">Serial assigned at shipping</span>';
      var warranty = r.source === 'order'
        ? (r.delivered ? 'Warranty until ' + plusYear(r.delivered) + '.' : 'Twelve-month warranty starts at delivery.')
        : 'Registered ' + day(r.registered) + '. Parts we make carry twelve months from purchase.';
      c.innerHTML = '<div class="robot-head"><b>' + esc(title) + '</b>' + serial + '</div>' +
        (r.config ? '<p class="robot-config">' + esc(r.config) + '</p>' : '') +
        (r.source === 'order' ? '<div class="robot-steps">' + steps + '</div>' : '') +
        (r.note ? '<p class="robot-config">' + esc(r.note) + '</p>' : '') +
        '<div class="robot-foot"><span class="robot-warranty">' + esc(warranty) + '</span><div class="robot-links">' +
        '<a href="software.html#firmware">Software &amp; firmware</a><a href="teleop.html">Apps</a><a href="order.html#parts">Parts</a><a href="docs/troubleshoot.html">Support</a>' +
        (r.source !== 'order' ? '<button type="button" data-unregister="' + esc(r.serial) + '">Remove</button>' : '') + '</div></div>';
      var rm = c.querySelector('[data-unregister]');
      if (rm) rm.addEventListener('click', function () {
        S.unregisterRobot(r.serial).then(function (j) { user.robots = j.robots; renderRobots(); toast('Removed ' + r.serial); }).catch(function (e) { toast(e.message); });
      });
      list.appendChild(c);
    });
  }
  function renderOrders() {
    var list = $('orderList'); list.innerHTML = '';
    var orders = user.orders || [];
    if (!orders.length) { list.innerHTML = '<div class="acct-empty"><p>No orders yet.</p></div>'; return; }
    orders.forEach(function (o) {
      var d = document.createElement('div'); d.className = 'ord-row';
      var chip = o.status === 'paid' ? (o.mode === 'deposit' ? 'Deposit paid' : 'Paid') : (o.status === 'pending' ? 'Awaiting payment' : o.status);
      var cls = o.status === 'paid' ? 'is-paid' : (o.status === 'pending' ? 'is-pending' : 'is-expired');
      var first = (o.lines && o.lines[0]) ? o.lines[0] : null;
      var more = o.lines && o.lines.length > 1 ? ' + ' + (o.lines.length - 1) + ' more' : '';
      d.innerHTML = '<span class="ord-id">#' + o.id + '<br/>' + esc(day(o.created)) + '</span>' +
        '<div class="ord-items"><b>' + esc(first ? (first.qty > 1 ? first.qty + '× ' : '') + first.name : 'Order') + more + '</b><span>' + esc(first ? first.desc : '') + (o.stage ? ' · ' + STAGE_LABEL[o.stage] : '') + '</span></div>' +
        '<span class="ord-total">' + S.usd(o.total) + (o.mode === 'deposit' ? '<small>deposit ' + S.usd(o.due) + ' · balance invoiced</small>' : '') + '</span>' +
        '<span class="ord-chip ' + cls + '">' + esc(chip) + '</span>';
      list.appendChild(d);
    });
  }

  /* ── the sign-in form ── */
  function renderForm() {
    var code = mode === 'code';
    $('acctSubmit').textContent = code ? (codeSentTo ? 'Verify code' : 'Send code') : (mode === 'login' ? 'Sign in' : 'Create account');
    $('acctPwRow').hidden = code; $('acctCodeRow').hidden = !(code && codeSentTo);
    $('acctPass').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    $('acctCodeHint').textContent = codeSentTo ? 'Sent to ' + codeSentTo + '. It lasts 10 minutes.' : '';
    document.querySelectorAll('.acct-tabs [role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.mode === mode)); b.parentElement.style.display = code ? 'none' : ''; });
    $('acctUseCode').hidden = code || !(otp.email || otp.sms);
    $('acctUsePw').hidden = !code;
  }
  function submit(e) {
    e.preventDefault();
    var ident = $('acctIdent').value.trim(), pw = $('acctPass').value, err = $('acctErr'), btn = $('acctSubmit');
    err.textContent = '';
    if (!S.validIdent(ident)) { err.textContent = 'Enter a valid email, or a phone number with its country code.'; return; }
    btn.disabled = true;
    var done = function () { btn.disabled = false; };
    var ok = function (j) { done(); user = j.user; $('acctPass').value = ''; $('acctCode').value = ''; codeSentTo = ''; load(); toast(mode === 'register' ? 'Account created' : 'Signed in'); };
    var fail = function (ex) { done(); err.textContent = ex.message; };
    if (mode === 'code') {
      if (!codeSentTo) S.sendCode(ident).then(function (j) { done(); codeSentTo = j.to; renderForm(); $('acctCode').focus(); }).catch(fail);
      else {
        var c = $('acctCode').value.trim();
        if (!/^\d{6}$/.test(c)) { done(); err.textContent = 'Enter the six digits from the message.'; return; }
        S.verify(codeSentTo, c).then(ok).catch(fail);
      }
      return;
    }
    if (pw.length < 8) { done(); err.textContent = 'Use at least 8 characters.'; return; }
    (mode === 'login' ? S.login(ident, pw) : S.register(ident, pw)).then(ok).catch(fail);
  }
  function load() {
    return S.whoami().then(function (j) { user = j.user || null; render(); }).catch(function () { user = null; render(); });
  }

  /* ── wire ── */
  document.querySelectorAll('.acct-tabs [role="tab"]').forEach(function (b) { b.addEventListener('click', function () { mode = b.dataset.mode; $('acctErr').textContent = ''; renderForm(); }); });
  $('acctUseCode').addEventListener('click', function () { mode = 'code'; codeSentTo = ''; $('acctErr').textContent = ''; renderForm(); });
  $('acctUsePw').addEventListener('click', function () { mode = 'login'; codeSentTo = ''; $('acctErr').textContent = ''; renderForm(); });
  $('acctForm').addEventListener('submit', submit);
  $('acctLogout').addEventListener('click', function () { S.logout().then(function () { user = null; render(); toast('Signed out'); }); });
  $('acctPwForm').addEventListener('submit', function (e) {
    e.preventDefault(); var pw = $('acctNewPw').value;
    if (pw.length < 8) { toast('Use at least 8 characters'); return; }
    S.setPassword(pw).then(function () { if (user) user.has_password = true; $('acctNewPw').value = ''; render(); toast('Password saved'); }).catch(function (ex) { toast(ex.message); });
  });
  $('regForm').addEventListener('submit', function (e) {
    e.preventDefault(); var serial = $('regSerial').value.trim(), name = $('regName').value.trim(), src = $('regSource').value;
    if (serial.length < 3) { toast('Enter the serial printed on the robot'); return; }
    S.registerRobot(serial, name, src).then(function (j) { user.robots = j.robots; renderRobots(); $('regSerial').value = ''; $('regName').value = ''; $('regBox').open = false; toast('Registered ' + serial.toUpperCase()); })
      .catch(function (ex) { toast(ex.message); });
  });
  $('citeCopy').addEventListener('click', function () {
    var t = $('citeText').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('BibTeX copied'); }, function () { prompt('Copy the citation', t); });
    else prompt('Copy the citation', t);
  });
  var sa = $('storeAcct'); if (sa) sa.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0 }); });

  S.health().then(function (h) { otp = h.otp || otp; renderForm(); }).catch(function () {});
  load().then(function () {
    window.__account = { get user() { return user; }, set otp(v) { otp = v; renderForm(); }, reload: load, get mode() { return mode; } };
    document.dispatchEvent(new CustomEvent('account:ready'));
  });
})();
