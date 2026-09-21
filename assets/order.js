/* order.html — the buy flow: one pick at a time (later steps stay grey until the
   earlier ones are made), a gallery that follows the pick, what's in the box,
   delivery, the comparison, the parts grid, the cart and the account.
   Prices come from assets/data/order.json through assets/order-pricing.js; the
   checkout server prices the same cart again, so this file never has the last
   word on money. Exposes window.__order for scripts/ordertest.py. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = window.MabelOrderPricing;
  var CART_KEY = 'mabel.cart.v1', SESSION_KEY = 'mabel.session';
  var cat = null, pick = {}, cart = [], user = null, pay = 'full', otp = { email: false, sms: false };
  var api = (function () {
    try {
      var q = new URLSearchParams(location.search).get('api');
      if (q) localStorage.setItem('mabel.order.api', q);
      return localStorage.getItem('mabel.order.api') || '';
    } catch (e) { return ''; }
  })();

  function usd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg) {
    var t = $('ordToast'); t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 2200);
  }
  function stepDef(id) { for (var i = 0; i < cat.steps.length; i++) if (cat.steps[i].id === id) return cat.steps[i]; }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function tierOf(id) { return find(cat.tiers, id); }
  function robotHas() {
    var r = pick.robot && find(stepDef('robot').options, pick.robot);
    var has = {}; if (r) r.has.forEach(function (h) { has[h] = true; });
    return has;
  }

  /* ── the sequence of picks ─────────────────────────────────────────────── */
  function sequence() {
    var has = robotHas();
    var seq = [
      { id: 'tier', title: 'How it ships.', q: 'Assembled and tested, or the parts kit?', options: cat.tiers.map(function (t) {
          var base = P.priceConfig(cat, t.id, P.defaults(cat)).total;
          return { id: t.id, name: t.name, spec: t.blurb + ' ' + t.lead + '.', label: 'From ' + usd(base) };
        }), slide: 'photo' },
      { id: 'robot', title: 'Robot.', q: 'Which body?', options: stepDef('robot').options.map(function (o) {
          return { id: o.id, name: o.name, spec: o.spec, tag: o.tag, label: pick.tier ? usd(o.price[pick.tier]) : '', slide: { complete: 'body', fixed: 'arms', upper: 'head', base: 'base' }[o.id] };
        }), slide: 'body' },
      { id: 'compute', title: 'Compute.', q: 'What runs on board?', options: deltaOpts(stepDef('compute').options), slide: 'electronics' },
    ];
    stepDef('sensors').groups.forEach(function (g) {
      if (pick.robot && !has[g.requires]) return;   // not on this body — hidden, exactly like the price ignores it
      seq.push({ id: g.id, title: g.title + '.', q: g.note || 'What it sees.', options: deltaOpts(g.options), slide: 'sensors', requires: g.requires });
    });
    var eff = stepDef('effector');
    if (!pick.robot || has[eff.requires]) {
      seq.push({ id: 'effector', title: 'End effector.', q: 'What it holds with?', options: deltaOpts(eff.options).map(function (o) {
        o.slide = o.id === 'ee_orca' ? 'hands' : 'arms'; return o; }), slide: 'hands', requires: eff.requires });
    }
    return seq;
  }
  function deltaOpts(options) {
    // prices are add-ons over the cheapest choice in the step, so nothing ever reads as a minus
    var t = pick.tier || 'assembled', floor = Math.min.apply(null, options.map(function (o) { return o.price[t]; }));
    return options.map(function (o) {
      var d = o.price[t] - floor;
      return { id: o.id, name: o.name, spec: o.spec, tag: o.tag, label: d === 0 ? 'Included' : '+ ' + usd(d), zero: d === 0 };
    });
  }
  function states(seq) {
    // open = every earlier step is picked; done = picked; locked = otherwise
    var out = [], gate = true;
    seq.forEach(function (s) {
      var picked = !!pick[s.id] && !!find(s.options, pick[s.id]);
      out.push(picked ? 'done' : (gate ? 'open' : 'locked'));
      if (!picked) gate = false;
    });
    return out;
  }
  function complete() { var seq = sequence(); return states(seq).every(function (s) { return s === 'done'; }); }
  function selection() {
    // the selection the pricer sees: picks, with defaults for anything not yet chosen
    var sel = P.defaults(cat);
    Object.keys(pick).forEach(function (k) { if (k !== 'tier' && pick[k]) sel[k] = pick[k]; });
    return sel;
  }

  function renderSteps() {
    var seq = sequence(), st = states(seq), root = $('buySteps'); root.innerHTML = '';
    seq.forEach(function (s, i) {
      var sec = document.createElement('section'); sec.className = 'buy-step'; sec.id = 'buy-' + s.id; sec.dataset.state = st[i]; sec.dataset.step = s.id;
      var chosen = st[i] === 'done' ? find(s.options, pick[s.id]) : null;
      sec.innerHTML = '<div class="buy-step-head"><h3><span>' + (i + 1) + '</span>' + esc(s.title) + '</h3><p class="buy-step-q">' +
        (chosen ? esc(chosen.name) : esc(s.q)) + '</p></div>';
      if (st[i] === 'locked') {
        var prev = seq[i - 1];
        var lock = document.createElement('div'); lock.className = 'buy-step-lock';
        lock.textContent = 'Choose ' + prev.title.replace(/\.$/, '').toLowerCase() + ' first.';
        sec.appendChild(lock);
      } else {
        var g = document.createElement('div'); g.className = 'buy-opts'; g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', s.title);
        s.options.forEach(function (o) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'buy-opt'; b.setAttribute('role', 'radio');
          b.dataset.step = s.id; b.dataset.opt = o.id; b.setAttribute('aria-checked', String(pick[s.id] === o.id));
          b.innerHTML = '<span class="buy-opt-body"><span class="buy-opt-name">' + esc(o.name) + (o.tag ? '<span class="buy-tag">' + esc(o.tag) + '</span>' : '') + '</span>' +
            '<span class="buy-opt-spec">' + esc(o.spec) + '</span></span>' +
            '<span class="buy-opt-price' + (o.zero ? ' is-zero' : '') + '">' + esc(o.label) + '</span>';
          b.addEventListener('click', function () { choose(s, o); });
          g.appendChild(b);
        });
        sec.appendChild(g);
      }
      root.appendChild(sec);
    });
    renderBar();
    try { history.replaceState(null, '', location.pathname + (complete() ? '?c=' + encode() : '') + location.hash); } catch (e) {}
  }
  function choose(step, opt) {
    var was = pick[step.id];
    pick[step.id] = opt.id;
    if (step.id === 'robot' && was !== opt.id) {
      // a new body: keep compatible picks, drop the rest so the sequence re-asks them
      var has = robotHas();
      stepDef('sensors').groups.forEach(function (g) { if (!has[g.requires]) delete pick[g.id]; });
      if (!has[stepDef('effector').requires]) delete pick.effector;
    }
    if (opt.slide) showSlide(opt.slide); else if (step.slide) showSlide(step.slide);
    renderSteps();
    // walk to the next open step, the way a form does
    var seq = sequence(), st = states(seq);
    for (var i = 0; i < seq.length; i++) {
      if (st[i] === 'open') {
        var el = $('buy-' + seq[i].id);
        if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 60);   // the stylesheet decides smooth vs instant
        break;
      }
    }
  }
  function renderBar() {
    var bar = $('buyBar'), btn = $('buyAdd'), sum = $('buyBarSum'), price = $('buyBarPrice');
    var seq = sequence(), st = states(seq);
    var picked = seq.filter(function (s, i) { return st[i] === 'done'; }).map(function (s) { return find(s.options, pick[s.id]).name; });
    var done = complete();
    if (!pick.tier) { price.textContent = 'From ' + usd(P.priceConfig(cat, 'kit', P.defaults(cat)).total); sum.textContent = 'Pick how it ships to begin.'; }
    else {
      var total = P.priceConfig(cat, pick.tier, selection()).total;
      price.textContent = (done ? '' : 'From ') + usd(total);
      sum.textContent = picked.join(' · ') + (done ? '' : ' · pick the rest');
    }
    btn.disabled = !done;
    btn.textContent = done ? 'Add to cart' : 'Pick the rest';
    bar.dataset.complete = String(done);
  }
  function addConfig() {
    if (!complete()) return;
    var sel = selection();
    cart.push({ kind: 'config', tier: pick.tier, sel: sel, qty: 1 });
    saveCart(); openCart();
  }

  /* ── share link: ?c=tier.robot.compute.wrist.head.lidar.basecam.effector ── */
  var ORDER = ['robot', 'compute', 'wrist', 'head', 'lidar', 'basecam', 'effector'];
  function encode() { var s = selection(); return [pick.tier].concat(ORDER.map(function (k) { return s[k]; })).join('.'); }
  function decode(str) {
    if (!str) return false;
    var parts = str.split('.');
    if (parts.length !== ORDER.length + 1 || !tierOf(parts[0])) return false;
    var trial = {};
    for (var i = 0; i < ORDER.length; i++) trial[ORDER[i]] = parts[i + 1];
    try { P.priceConfig(cat, parts[0], trial); } catch (e) { return false; }
    pick = { tier: parts[0] }; Object.keys(trial).forEach(function (k) { pick[k] = trial[k]; });
    return true;
  }

  /* ── gallery ───────────────────────────────────────────────────────────── */
  var slideAt = 0;
  function renderDots() {
    var d = $('buyDots'); d.innerHTML = '';
    cat.gallery.forEach(function (g, i) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', g.cap);
      b.setAttribute('aria-selected', String(i === slideAt)); b.addEventListener('click', function () { goSlide(i); });
      d.appendChild(b);
    });
  }
  function goSlide(i) {
    var n = cat.gallery.length; slideAt = ((i % n) + n) % n;
    var g = cat.gallery[slideAt], img = $('buySlide');
    img.src = g.src; img.alt = g.cap; img.classList.toggle('is-contain', g.key === 'exploded');
    $('buyCap').textContent = g.cap;
    $('buyDots').querySelectorAll('button').forEach(function (b, k) { b.setAttribute('aria-selected', String(k === slideAt)); });
    var nx = cat.gallery[(slideAt + 1) % n]; var pre = new Image(); pre.src = nx.src;   // the next one is ready before the arrow
  }
  function showSlide(key) { for (var i = 0; i < cat.gallery.length; i++) if (cat.gallery[i].key === key) { goSlide(i); return; } }

  /* ── in the box, delivery, compare ─────────────────────────────────────── */
  var boxTier = 'assembled';
  function renderBox() {
    var tabs = $('boxTabs'); tabs.innerHTML = '';
    cat.tiers.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = t.name;
      b.setAttribute('aria-selected', String(t.id === boxTier)); b.addEventListener('click', function () { boxTier = t.id; renderBox(); });
      tabs.appendChild(b);
    });
    var g = $('boxGrid'); g.innerHTML = '';
    cat.box[boxTier].forEach(function (it, i) {
      var d = document.createElement('div'); d.className = 'box-tile';
      d.innerHTML = (it.img ? '<img src="' + esc(it.img) + '" width="500" height="375" alt="" loading="lazy" />' : '<div class="box-ph" aria-hidden="true">' + (i + 1) + '</div>') +
        '<b>' + esc(it.t) + '</b><p>' + esc(it.s) + '</p>';
      g.appendChild(d);
    });
  }
  function renderDelivery() {
    var g = $('dlvGrid'); g.innerHTML = '';
    cat.delivery.forEach(function (it) {
      var d = document.createElement('div'); d.className = 'dlv-tile';
      d.innerHTML = '<b>' + esc(it.t) + '</b><span class="dlv-k">' + esc(it.k) + '</span><p>' + esc(it.s) + '</p>';
      g.appendChild(d);
    });
  }
  var cmpShow = 1;
  function renderCompare() {
    var c = cat.compare, t = $('cmpTable'), sel = $('cmpSel');
    var html = '<thead><tr><th></th>' + c.cols.map(function (h, i) { return '<th class="' + (i + 1 === cmpShow ? 'is-shown' : '') + '">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    c.rows.forEach(function (r) {
      var priceRow = r[0] === 'Assembled' || r[0] === 'Kit';
      html += '<tr><td>' + esc(r[0]) + '</td>' + r.slice(1).map(function (v, i) { return '<td class="' + (i + 1 === cmpShow ? 'is-shown ' : '') + (priceRow ? 'is-price' : '') + '">' + esc(v) + '</td>'; }).join('') + '</tr>';
    });
    t.innerHTML = html + '</tbody>';
    if (!sel.options.length) {
      c.cols.forEach(function (h, i) { var o = document.createElement('option'); o.value = String(i + 1); o.textContent = h; sel.appendChild(o); });
      sel.addEventListener('change', function () { cmpShow = +sel.value; renderCompare(); });
    }
    sel.value = String(cmpShow);
    var w = $('ways'); w.innerHTML = '';
    c.ways.cols.forEach(function (h, i) {
      var col = document.createElement('div'); col.className = 'ways-col' + (i === 2 ? ' is-lead' : '');
      col.innerHTML = '<h4>' + esc(h) + '</h4><dl>' + c.ways.rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[i + 1]) + '</dd>'; }).join('') + '</dl>';
      w.appendChild(col);
    });
  }

  /* ── parts & accessories ───────────────────────────────────────────────── */
  var partsGroup = 'All', partsQ = '', partsAll = false, PREVIEW = 8;
  var GROUP_IMG = { 'Mobile base': 'base', 'Body / torso': 'lift', 'Arms - both': 'arms', 'Hands - both': 'hands', 'Neck / head': 'head',
                    'Structural hardware': 'body', 'Electronics, power & cabling': 'electronics', '3D printed material': 'body', 'Compute': 'electronics', 'Sensors': 'sensors' };
  function renderTabs() {
    var el = $('partsTabs'); el.innerHTML = '';
    ['All'].concat(cat.groups).forEach(function (g) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'parts-tab'; b.textContent = g.replace(' - both', '');
      b.dataset.group = g; b.setAttribute('aria-pressed', String(g === partsGroup));
      b.addEventListener('click', function () { partsGroup = g; partsAll = false; renderTabs(); renderParts(); });
      el.appendChild(b);
    });
  }
  function renderParts() {
    var grid = $('partsGrid'); grid.innerHTML = '';
    var q = partsQ.trim().toLowerCase();
    var list = cat.parts.filter(function (p) {
      if (partsGroup !== 'All' && p.group !== partsGroup) return false;
      if (!q) return true;
      return (p.name + ' ' + p.spec + ' ' + p.sku + ' ' + p.group).toLowerCase().indexOf(q) >= 0;
    });
    var truncated = partsGroup === 'All' && !q && !partsAll && list.length > PREVIEW;
    var shown = truncated ? list.slice(0, PREVIEW) : list;
    if (!list.length) grid.innerHTML = '<div class="parts-empty">Nothing matches. Try a model number, or clear the filter.</div>';
    shown.forEach(function (p) {
      var c = document.createElement('article'); c.className = 'parts-card'; c.dataset.sku = p.sku;
      c.innerHTML = '<img src="assets/hw/' + (GROUP_IMG[p.group] || 'body') + '-sm.png" width="500" height="375" alt="" loading="lazy" />' +
        '<span class="parts-name">' + esc(p.name) + '</span><span class="parts-spec" title="' + esc(p.spec) + '">' + esc(p.spec) + '</span>' +
        '<div class="parts-row"><span class="parts-price">' + usd(p.price) + '</span><button type="button" class="parts-add" aria-label="Add ' + esc(p.name) + ' to cart">Add</button></div>';
      c.querySelector('.parts-add').addEventListener('click', function () { addPart(p.sku, 1); });
      grid.appendChild(c);
    });
    var more = $('partsMoreWrap'); more.hidden = !truncated;
    $('partsMore').textContent = 'Show all ' + list.length + ' parts';
  }
  function addPart(sku, qty) {
    var hit = null;
    cart.forEach(function (it) { if (it.kind === 'part' && it.sku === sku) hit = it; });
    if (hit) hit.qty = Math.min(99, hit.qty + qty); else cart.push({ kind: 'part', sku: sku, qty: qty });
    saveCart(); toast('Added — ' + P.part(cat, sku).name);
  }

  /* ── cart ──────────────────────────────────────────────────────────────── */
  function loadCart() { try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) { cart = []; } if (!Array.isArray(cart)) cart = []; }
  var syncT = null;
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    renderCart();
    document.dispatchEvent(new CustomEvent('order:cart'));
    if (user && api) { clearTimeout(syncT); syncT = setTimeout(function () { req('PUT', '/api/cart', { items: cart }).catch(function () {}); }, 400); }
  }
  function renderCart() {
    var list = $('cartList'); list.innerHTML = '';
    var hasConfig = cart.some(function (it) { return it.kind === 'config'; });
    $('cartPay').style.display = hasConfig ? '' : 'none';
    if (!hasConfig) pay = 'full';
    $('cartPay').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.pay === pay)); });
    if (!cart.length) {
      list.innerHTML = '<div class="cart-empty">Your cart is empty. Configure a robot above, or add a part.</div>';
      $('cartTotal').textContent = '$0'; $('cartSumLabel').textContent = 'Total'; $('cartCheckout').disabled = true;
    } else {
      var priced;
      try { priced = P.priceCart(cat, cart); } catch (e) { cart = []; saveCart(); return; }
      priced.lines.forEach(function (l, i) {
        var it = cart[i];
        var d = document.createElement('div'); d.className = 'cart-item';
        d.innerHTML = '<div class="cart-item-name">' + esc(l.name) + '</div><div class="cart-item-desc">' + esc(l.desc) + '</div>' +
          '<div class="cart-item-row"><span class="cart-qty"><button type="button" aria-label="Fewer">−</button><output>' + l.qty + '</output><button type="button" aria-label="More">+</button></span>' +
          '<span class="cart-item-amt">' + usd(l.amount) + '</span></div><div class="cart-item-row"><button type="button" class="cart-rm">Remove</button><span></span></div>';
        var qb = d.querySelectorAll('.cart-qty button');
        qb[0].addEventListener('click', function () { if (it.qty > 1) { it.qty--; saveCart(); } });
        qb[1].addEventListener('click', function () { if (it.qty < 99) { it.qty++; saveCart(); } });
        d.querySelector('.cart-rm').addEventListener('click', function () { cart.splice(i, 1); saveCart(); });
        list.appendChild(d);
      });
      var due = pay === 'deposit' ? P.depositAmount(cat, priced.total) : priced.total;
      $('cartTotal').textContent = usd(due);
      $('cartSumLabel').textContent = pay === 'deposit' ? 'Deposit now · ' + usd(priced.total) + ' total' : 'Total';
      $('cartCheckout').disabled = false;
    }
    $('cartAcct').innerHTML = user ? 'Saved to <b>' + esc(user.ident) + '</b>' : '<button type="button" id="cartSignIn">Sign in</button> to save your cart across devices.';
    var si = $('cartSignIn'); if (si) si.addEventListener('click', function () { closeCart(); openAcct(); });
  }
  function openCart() { $('cart').classList.add('is-open'); $('cartVeil').classList.add('is-open'); $('cart').setAttribute('aria-hidden', 'false'); $('cartMsg').hidden = true; }
  function closeCart() { $('cart').classList.remove('is-open'); $('cartVeil').classList.remove('is-open'); $('cart').setAttribute('aria-hidden', 'true'); }
  function cartMessage(text, err) { var m = $('cartMsg'); m.textContent = text; m.classList.toggle('is-err', !!err); m.hidden = false; }

  /* ── API (bearer token; the cookie is a bonus Safari will not keep) ────── */
  function token() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(SESSION_KEY, t); else localStorage.removeItem(SESSION_KEY); } catch (e) {} document.dispatchEvent(new CustomEvent('order:auth')); }
  function req(method, path, body) {
    if (!api) return Promise.reject(new Error('no api'));
    var h = { 'Content-Type': 'application/json' }, t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    return fetch(api + path, { method: method, credentials: 'include', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.detail || j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function checkout() {
    if (!cart.length) return;
    var btn = $('cartCheckout'); btn.disabled = true; btn.textContent = 'Opening checkout…';
    req('POST', '/api/checkout', { items: cart, mode: pay, return_to: location.origin + location.pathname })
      .then(function (j) { if (!j.url) throw new Error('no checkout url'); location.href = j.url; })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = 'Checkout';
        cartMessage('Checkout could not be completed (' + e.message + '). Your cart is saved; please try again in a moment.', true);
      });
  }

  /* ── account ───────────────────────────────────────────────────────────── */
  var acctMode = 'login', codeSentTo = '';
  function openAcct() { $('acct').classList.add('is-open'); renderAcct(); setTimeout(function () { var f = $('acctIdent'); if (f && !user) f.focus(); }, 60); }
  function closeAcct() { $('acct').classList.remove('is-open'); }
  function renderAcct() {
    var code = acctMode === 'code';
    $('acctGuest').hidden = !!user; $('acctUser').hidden = !user;
    $('acctTitle').textContent = user ? 'Your account' : (code ? 'Sign in with a code' : (acctMode === 'login' ? 'Sign in' : 'Create account'));
    $('acctSubmit').textContent = code ? (codeSentTo ? 'Verify code' : 'Send code') : (acctMode === 'login' ? 'Sign in' : 'Create account');
    $('acctPwRow').hidden = code; $('acctCodeRow').hidden = !(code && codeSentTo);
    $('acctPass').setAttribute('autocomplete', acctMode === 'register' ? 'new-password' : 'current-password');
    $('acctCodeHint').textContent = codeSentTo ? 'Sent to ' + codeSentTo + '. It lasts 10 minutes.' : '';
    document.querySelectorAll('#acct [role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.mode === acctMode)); b.parentElement.style.display = code ? 'none' : ''; });
    $('acctUseCode').hidden = code || !(otp.email || otp.sms);
    $('acctUsePw').hidden = !code;
    if (user) {
      $('acctWho').textContent = user.ident;
      $('acctPwForm').hidden = !!user.has_password;
      var ol = $('acctOrders'); ol.innerHTML = '';
      (user.orders || []).forEach(function (o) {
        var li = document.createElement('li');
        li.innerHTML = '<div>' + esc(o.summary) + '</div><span>' + esc(o.created) + ' · ' + usd(o.total) + (o.mode === 'deposit' ? ' (deposit ' + usd(o.due) + ')' : '') +
          ' · <em class="' + (o.status === 'paid' ? 'is-paid' : '') + '">' + esc(o.status) + '</em></span>';
        ol.appendChild(li);
      });
      if (!(user.orders || []).length) ol.innerHTML = '<li><span>No orders yet.</span></li>';
    }
    renderCart();
  }
  function whoami() {
    if (!api || !token()) { user = null; renderAcct(); return Promise.resolve(); }
    return req('GET', '/api/auth/me').then(function (j) {
      user = j.user || null;
      if (!user) setToken('');
      if (user && j.cart && j.cart.length && !cart.length) { cart = j.cart; try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} document.dispatchEvent(new CustomEvent('order:cart')); }
      else if (user && cart.length) req('PUT', '/api/cart', { items: cart }).catch(function () {});
      renderAcct();
    }).catch(function () { user = null; renderAcct(); });
  }
  function signedIn(j, msg) {
    setToken(j.token); user = j.user || null;
    if (cart.length) req('PUT', '/api/cart', { items: cart }).catch(function () {});
    renderAcct(); $('acctPass').value = ''; $('acctCode').value = ''; codeSentTo = '';
    if (user && user.has_password) closeAcct();
    toast(msg);
  }
  function validIdent(s) { s = s.trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s) || /^\+?[\d\s\-().]{8,20}$/.test(s); }
  function submitAcct(e) {
    e.preventDefault();
    var ident = $('acctIdent').value.trim(), pw = $('acctPass').value, err = $('acctErr'), btn = $('acctSubmit');
    err.textContent = '';
    if (!validIdent(ident)) { err.textContent = 'Enter a valid email, or a phone number with its country code.'; return; }
    if (!api) { err.textContent = 'Accounts are not connected on this copy of the site.'; return; }
    btn.disabled = true;
    var done = function () { btn.disabled = false; };
    if (acctMode === 'code') {
      if (!codeSentTo) {
        req('POST', '/api/auth/code', { ident: ident }).then(function (j) { done(); codeSentTo = j.to; renderAcct(); setTimeout(function () { $('acctCode').focus(); }, 40); })
          .catch(function (ex) { done(); err.textContent = ex.message; });
      } else {
        var code = $('acctCode').value.trim();
        if (!/^\d{6}$/.test(code)) { done(); err.textContent = 'Enter the six digits from the message.'; return; }
        req('POST', '/api/auth/verify', { ident: codeSentTo, code: code }).then(function (j) { done(); signedIn(j, 'Signed in'); })
          .catch(function (ex) { done(); err.textContent = ex.message; });
      }
      return;
    }
    if (pw.length < 8) { done(); err.textContent = 'Use at least 8 characters.'; return; }
    req('POST', acctMode === 'login' ? '/api/auth/login' : '/api/auth/register', { ident: ident, password: pw })
      .then(function (j) { done(); signedIn(j, acctMode === 'login' ? 'Signed in' : 'Account created'); })
      .catch(function (ex) { done(); err.textContent = ex.message; });
  }
  function savePassword(e) {
    e.preventDefault();
    var pw = $('acctNewPw').value;
    if (pw.length < 8) { toast('Use at least 8 characters'); return; }
    req('POST', '/api/auth/password', { password: pw }).then(function () { if (user) user.has_password = true; $('acctNewPw').value = ''; renderAcct(); toast('Password saved'); })
      .catch(function (ex) { toast(ex.message); });
  }
  function logout() { req('POST', '/api/auth/logout').catch(function () {}).then(function () { setToken(''); user = null; renderAcct(); toast('Signed out'); }); }

  /* ── return from Stripe ────────────────────────────────────────────────── */
  function afterCheckout() {
    var q = new URLSearchParams(location.search), st = q.get('checkout'), open = q.get('open');
    if (open === 'cart') openCart();
    if (open === 'account') openAcct();
    if (st === 'cancel') toast('Checkout cancelled. Your cart is saved.');
    if (st === 'success') {
      var sid = q.get('session_id'), done = $('ordDone'), txt = $('ordDoneText');
      done.hidden = false; txt.textContent = 'Thank you. A receipt is on its way.';
      cart = []; saveCart();
      if (sid && api) req('GET', '/api/checkout/status?session_id=' + encodeURIComponent(sid)).then(function (j) {
        if (j.order) txt.textContent = 'Order #' + j.order.id + ' — ' + j.order.summary + '. ' + (j.order.status === 'paid' ? 'Paid ' + usd(j.order.due) + '.' : 'Payment ' + j.order.status + '.') + ' A receipt is on its way.';
      }).catch(function () {});
      try { done.scrollIntoView({ block: 'center' }); } catch (e) {}
    }
    if (st || open) { try { history.replaceState(null, '', location.pathname + (q.get('c') ? '?c=' + q.get('c') : '') + location.hash); } catch (e) {} }
  }

  /* ── wire ──────────────────────────────────────────────────────────────── */
  function wire() {
    $('buyAdd').addEventListener('click', addConfig);
    $('buyPrev').addEventListener('click', function () { goSlide(slideAt - 1); });
    $('buyNext').addEventListener('click', function () { goSlide(slideAt + 1); });
    var sx = null, slide = $('buySlide');
    slide.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    slide.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) goSlide(slideAt + (dx < 0 ? 1 : -1)); sx = null; }, { passive: true });
    var sc = $('storeCart'), sa = $('storeAcct');
    if (sc) sc.addEventListener('click', function (e) { e.preventDefault(); openCart(); });
    if (sa) sa.addEventListener('click', function (e) { e.preventDefault(); openAcct(); });
    $('cartClose').addEventListener('click', closeCart); $('cartVeil').addEventListener('click', closeCart);
    $('cartCheckout').addEventListener('click', checkout);
    $('cartPay').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { pay = b.dataset.pay; renderCart(); }); });
    $('acctClose').addEventListener('click', closeAcct);
    $('acct').addEventListener('click', function (e) { if (e.target === $('acct')) closeAcct(); });
    document.querySelectorAll('#acct [role="tab"]').forEach(function (b) { b.addEventListener('click', function () { acctMode = b.dataset.mode; $('acctErr').textContent = ''; renderAcct(); }); });
    $('acctUseCode').addEventListener('click', function () { acctMode = 'code'; codeSentTo = ''; $('acctErr').textContent = ''; renderAcct(); });
    $('acctUsePw').addEventListener('click', function () { acctMode = 'login'; codeSentTo = ''; $('acctErr').textContent = ''; renderAcct(); });
    $('acctForm').addEventListener('submit', submitAcct); $('acctPwForm').addEventListener('submit', savePassword); $('acctLogout').addEventListener('click', logout);
    $('partsSearch').addEventListener('input', function () { partsQ = this.value; partsAll = false; renderParts(); });
    $('partsMore').addEventListener('click', function () { partsAll = true; renderParts(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeCart(); closeAcct(); } });
    /* the sticky bar belongs to the configurator: it rides along only while
       that section is on screen, so the rest of the page keeps its full height */
    var bar = $('buyBar'), sec = $('configure');
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { var on = es[0].isIntersecting; bar.classList.toggle('is-on', on); document.body.classList.toggle('bar-on', on); },
                               { rootMargin: '-80px 0px -40px 0px' }).observe(sec);
    } else { bar.classList.add('is-on'); }
  }

  fetch('assets/data/order.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (c) {
    cat = c;
    if (!api) api = c.api || '';
    pick = {};
    try { decode(new URLSearchParams(location.search).get('c')); } catch (e) {}
    loadCart(); wire(); renderDots(); goSlide(0); renderSteps(); renderBox(); renderDelivery(); renderCompare(); renderTabs(); renderParts(); renderCart(); renderAcct();
    $('partsNote').textContent = 'List prices from the bill of materials priced ' + c.price_date + ', computed by scripts/build_order.py. Pass-through parts follow their vendor’s pricing and may move; parts we make are priced by us. ' + c.parts.length + ' parts.';
    afterCheckout();
    if (api) fetch(api + '/api/health').then(function (r) { return r.json(); }).then(function (h) { otp = h.otp || otp; renderAcct(); }).catch(function () {});
    whoami();
    window.__order = { get cat() { return cat; }, get pick() { return pick; }, get cart() { return cart; }, get user() { return user; }, get slide() { return cat.gallery[slideAt].key; },
                       set api(v) { api = v; }, get api() { return api; }, set otp(v) { otp = v; renderAcct(); },
                       choose: function (step, opt) { pick[step] = opt; renderSteps(); }, reset: function () { pick = {}; renderSteps(); },
                       complete: complete, selection: selection, update: renderSteps, openCart: openCart, closeCart: closeCart, openAcct: openAcct, closeAcct: closeAcct,
                       addPart: addPart, addConfig: addConfig, checkout: checkout, clear: function () { cart = []; saveCart(); } };
    document.dispatchEvent(new CustomEvent('order:ready'));
  }).catch(function (e) {
    $('buySteps').innerHTML = '<div class="buy-step-lock">The catalog could not be loaded (' + esc(e.message) + '). Reload the page.</div>';
  });
})();
