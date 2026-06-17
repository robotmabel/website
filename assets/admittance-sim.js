/* ═══════════════════════════════════════════════════════════════════
   MABEL — live admittance simulator (outer control loop)
   Numerically integrates the virtual mass–spring–damper that the
   controller's outer loop runs:   M·ẍ_c + D·ẋ_c + K·x_c = F_ext
   Push the robot (apply F_ext), tune K_d / D_d, and watch the compliant
   yield x_c(t) respond — under/critically/over-damped per ζ = D/(2√(KM)).
   A browser stand-in for the figure; the same ODE runs on hardware.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var root = document.getElementById('admSim');
  if (!root) return;
  var canvas = root.querySelector('canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var M = 4.5, K = 120, D = 40;     // virtual mass / stiffness / damping
  var Fext = 0, x = 0, v = 0;       // applied force, compliant displacement + velocity
  var WIN = 6;                      // seconds of history shown
  var hist = [];                    // { t, F, x }
  var t0 = null, last = null, impulseUntil = 0;

  var kEl = root.querySelector('[data-adm="k"]');
  var dEl = root.querySelector('[data-adm="d"]');
  var kOut = root.querySelector('[data-adm-out="k"]');
  var dOut = root.querySelector('[data-adm-out="d"]');
  var zOut = root.querySelector('[data-adm-out="zeta"]');
  var yOut = root.querySelector('[data-adm-out="yield"]');
  var regime = root.querySelector('[data-adm-regime]');

  function sync() {
    if (kEl) { K = parseFloat(kEl.value) || K; if (kOut) kOut.textContent = Math.round(K) + ' N/m'; }
    if (dEl) { D = parseFloat(dEl.value) || D; if (dOut) dOut.textContent = Math.round(D) + ' N·s/m'; }
    var zeta = D / (2 * Math.sqrt(K * M));
    if (zOut) zOut.textContent = 'ζ ' + zeta.toFixed(2);
    if (regime) {
      var cls = 'crit', txt = '≈ critically damped';
      if (zeta < 0.92) { cls = 'under'; txt = 'underdamped — overshoots'; }
      else if (zeta > 1.08) { cls = 'over'; txt = 'overdamped — sluggish'; }
      regime.className = 'adm-regime ' + cls;
      regime.textContent = txt;
    }
  }
  if (kEl) kEl.addEventListener('input', sync);
  if (dEl) dEl.addEventListener('input', sync);

  function press(el, val) {
    if (!el) return;
    var down = function (e) { e.preventDefault(); Fext = val; };
    var up = function () { Fext = 0; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }
  press(root.querySelector('[data-adm-push]'), 32);
  var imp = root.querySelector('[data-adm-impulse]');
  if (imp) imp.addEventListener('click', function () { impulseUntil = (last || 0) + 130; });

  var W = 0, H = 0;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    W = r.width || 320; H = r.height || 220;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  var Fmax = 100, Xmax = 0.30;
  function draw(tsec) {
    ctx.clearRect(0, 0, W, H);
    var midY = H * 0.52, amp = H * 0.40;
    ctx.strokeStyle = 'rgba(22,20,18,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
    var xpix = function (t) { return W * (1 - (tsec - t) / WIN); };
    var plot = function (key, scale, color, w) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath();
      for (var i = 0; i < hist.length; i++) {
        var px = xpix(hist[i].t), py = midY - (hist[i][key] / scale) * amp;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    plot('F', Fmax, '#2f9d5b', 2);
    plot('x', Xmax, '#C25B2A', 2.4);
    if (hist.length) {
      var s = hist[hist.length - 1];
      ctx.fillStyle = '#C25B2A';
      ctx.beginPath(); ctx.arc(W - 3, midY - (s.x / Xmax) * amp, 3.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  function frame(now) {
    if (t0 === null) t0 = now;
    if (last === null) last = now;
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!W) resize();
    var f = Fext + (now < impulseUntil ? 75 : 0);
    var steps = 6, h = dt / steps;
    for (var i = 0; i < steps; i++) {
      var a = (f - D * v - K * x) / M;
      v += a * h; x += v * h;
    }
    var tsec = (now - t0) / 1000;
    hist.push({ t: tsec, F: f, x: x });
    while (hist.length && hist[0].t < tsec - WIN) hist.shift();
    if (yOut) yOut.textContent = (x * 100).toFixed(1) + ' cm';
    draw(tsec);
    requestAnimationFrame(frame);
  }

  resize(); sync();
  requestAnimationFrame(frame);
})();
