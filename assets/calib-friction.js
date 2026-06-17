/* calib-friction.js — interactive Coulomb+viscous+Stribeck friction explorer
   for software.html#calib. Pure canvas, no deps. Mirrors mabel_actid's model:
     tau_f(w) = sgn(w)*[Fc + (Fs-Fc)*exp(-(|w|/vs)^2)] + Fv*w                  */
(function () {
  var cv = document.getElementById('calFricCanvas');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height;

  // measured DM-J4340P bench fit (direction-averaged), from results/DM-J4340P
  var FIT = { Fc: 0.3379, Fv: 0.2152, Fs: 0.3628, vs: 0.0877 };
  var DELTA = 2.0;
  var XMAX = 1.2, YMAX = 0.7;            // axis ranges (rad/s, N·m)
  // staircase velocities the bench actually drove (rad/s) → measured scatter
  var VS = [0.10, 0.15, 0.25, 0.36, 0.52, 0.75, 1.07];

  function model(w, p) {
    if (Math.abs(w) < 1e-6) return 0;
    var s = w > 0 ? 1 : -1;
    var stri = p.Fc + (p.Fs - p.Fc) * Math.exp(-Math.pow(Math.abs(w) / p.vs, DELTA));
    return s * stri + p.Fv * w;
  }

  // pad/plot transforms
  var L = 56, R = 16, T = 16, B = 42;
  function X(w) { return L + (w + XMAX) / (2 * XMAX) * (W - L - R); }
  function Y(t) { return T + (YMAX - t) / (2 * YMAX) * (H - T - B); }

  function grid() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.font = "12px 'Geist Mono', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // minor grid
    ctx.strokeStyle = 'rgba(242,238,230,0.07)';
    for (var w = -1; w <= 1; w += 0.5) { if (w === 0) continue; ctx.beginPath(); ctx.moveTo(X(w), T); ctx.lineTo(X(w), H - B); ctx.stroke(); }
    for (var t = -0.6; t <= 0.6; t += 0.2) { ctx.beginPath(); ctx.moveTo(L, Y(t)); ctx.lineTo(W - R, Y(t)); ctx.stroke(); }
    // axes
    ctx.strokeStyle = 'rgba(242,238,230,0.32)';
    ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(0), T); ctx.lineTo(X(0), H - B); ctx.stroke();
    // labels
    ctx.fillStyle = 'rgba(160,154,145,0.9)';
    for (var w2 = -1; w2 <= 1; w2 += 0.5) ctx.fillText(w2.toFixed(1), X(w2), H - B + 16);
    ctx.textAlign = 'right';
    for (var t2 = -0.6; t2 <= 0.6; t2 += 0.3) ctx.fillText(t2.toFixed(1), L - 8, Y(t2));
    ctx.textAlign = 'center';
    ctx.fillText('joint velocity  ω  [rad/s]', (L + W - R) / 2, H - 8);
    ctx.save();
    ctx.translate(15, (T + H - B) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('friction torque  τ_f  [N·m]', 0, 0);
    ctx.restore();
  }

  function curve(p, color, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = dash ? 2 : 2.4;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    var first = true;
    // draw the two branches separately so the break-away jump at 0 is visible
    for (var side = 0; side < 2; side++) {
      first = true;
      var a = side === 0 ? -XMAX : 0.001, b = side === 0 ? -0.001 : XMAX;
      for (var w = a; w <= b; w += (b - a) / 120) {
        var px = X(w), py = Y(model(w, p));
        if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.beginPath();
    }
    ctx.setLineDash([]);
  }

  function scatter() {
    ctx.fillStyle = '#cfe9d4';
    VS.forEach(function (w) {
      [w, -w].forEach(function (ww) {
        ctx.beginPath(); ctx.arc(X(ww), Y(model(ww, FIT)), 3.2, 0, 7); ctx.fill();
      });
    });
  }

  function params() {
    return {
      Fc: parseFloat(document.getElementById('fFc').value),
      Fv: parseFloat(document.getElementById('fFv').value),
      Fs: parseFloat(document.getElementById('fFs').value),
      vs: parseFloat(document.getElementById('fVs').value)
    };
  }

  function draw() {
    var p = params();
    if (p.Fs < p.Fc) p.Fs = p.Fc;                 // break-away ≥ Coulomb
    grid();
    curve(FIT, '#7fb98a', [7, 6]);                // bench fit (dashed green)
    scatter();                                    // measured points
    curve(p, '#C25B2A', null);                    // user model (solid rust)
    // readouts
    document.getElementById('vFc').textContent = p.Fc.toFixed(2);
    document.getElementById('vFv').textContent = p.Fv.toFixed(2);
    document.getElementById('vFs').textContent = p.Fs.toFixed(2);
    document.getElementById('vVs').textContent = p.vs.toFixed(3);
    document.getElementById('fMj').textContent =
      'frictionloss ' + p.Fc.toFixed(2) + ' · damping ' + p.Fv.toFixed(2);
  }

  ['fFc', 'fFv', 'fFs', 'fVs'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', draw);
  });
  document.getElementById('fSnap').addEventListener('click', function () {
    document.getElementById('fFc').value = FIT.Fc;
    document.getElementById('fFv').value = FIT.Fv;
    document.getElementById('fFs').value = FIT.Fs;
    document.getElementById('fVs').value = FIT.vs;
    draw();
  });

  draw();
})();
