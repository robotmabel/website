/* Does it go where you tell it? — the bench measurements, drawn live.
 *
 * Two archives, two questions:
 *
 *   REPEATABILITY (real robot, ISO 9283). Command the same pose again and
 *   again; measure where the index fingertip actually lands. RP is the ISO
 *   pose-repeatability radius — the sphere that holds 3σ of the landings — and
 *   R_max is the worst single one.
 *
 *   PATH FOLLOWING (simulated). Trace a commanded path and measure the tracking
 *   error along it, for four controller conditions in the order they were
 *   built. This is the plot that pays for the controller: PD alone is a quarter
 *   of a metre out.
 *
 * Everything drawn here comes from assets/data/accuracy.json, exported by
 * scripts/build_accuracy.py straight from the experiment archives. Nothing is
 * a number retyped from the paper.
 *
 * ONE FRAME ACROSS ALL SIX STATIONS. Home's scatter really is four times wider
 * than any single station's, and that is the comparison the panel exists to
 * make — so switching stations must not rescale the axes underneath the reader.
 */
(function () {
  'use strict';
  var host = document.getElementById('accuracyLab');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var pretty = function (s) {
    return s === 'home' ? 'Home' : s.replace(/^S(\d)_/, 'S$1 · ').replace(/_/g, ' ');
  };
  var HAND = {
    right_index_tip: ['Right index', '#23577E'],
    left_index_tip: ['Left index', '#E4442A']
  };
  var COND = { pd: '#6D6551', gff: '#23577E', gff_stiff: '#7A3E8F',
               gff_fric_stiff: '#2E7D4F' };

  fetch('assets/data/accuracy.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="al-err">Could not load the measurements.</p>';
      console.error('[accuracy-lab]', e);
    });

  function build(D) {
    var station = 'home';
    var pathName = Object.keys(D.paths)[0];

    /* the shared frame: whatever holds every station's worst circle, rounded up */
    var LIM = 10 * Math.ceil(D.stations.reduce(function (m, s) {
      return Object.keys(s.hands).reduce(function (n, h) {
        return Math.max(n, s.hands[h].RP_mm, s.hands[h].Rmax_mm);
      }, m);
    }, 0) * 1.12 / 10);

    host.innerHTML =
      '<div class="al-grid">' +
        '<div class="al-panel">' +
          '<span class="al-kick">On the robot · ISO 9283 · ' + D.rep_trials +
            ' cycles</span>' +
          '<h4 class="al-h">Where does the fingertip land?</h4>' +
          '<p class="al-say">Command the same pose again and again and mark every ' +
            'landing, in the frontal plane, about their own centre.</p>' +
          '<div class="al-chips" data-role="stations">' +
            D.stations.map(function (s) {
              return '<button type="button" class="al-chip" data-s="' +
                     esc(s.name) + '">' + esc(pretty(s.name)) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="al-plot" data-role="scatter"></div>' +
          '<div class="al-read" data-role="repread"></div>' +
        '</div>' +
        '<div class="al-panel">' +
          '<span class="al-kick">In simulation · four conditions</span>' +
          '<h4 class="al-h">And how well does it follow?</h4>' +
          '<p class="al-say">Tracking error along a commanded path, mean over ' +
            'trials, shaded ±1 s.d. Log scale — the whole point is the ' +
            'order of magnitude.</p>' +
          '<div class="al-chips" data-role="paths">' +
            Object.keys(D.paths).map(function (p) {
              return '<button type="button" class="al-chip" data-p="' + esc(p) +
                     '">' + esc(p) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="al-plot" data-role="err"></div>' +
          '<div class="al-legend" data-role="conds"></div>' +
        '</div>' +
      '</div>' +
      '<p class="al-src">Both panels are drawn from <code>' + esc(D.source) +
        '</code>, exported by <code>website/scripts/build_accuracy.py</code>. ' +
        'Lift at ' + D.lift_m.toFixed(2) + ' m. Plane: ' + esc(D.plane) + '.</p>';

    var scatter = host.querySelector('[data-role="scatter"]');
    var errBox = host.querySelector('[data-role="err"]');
    var repRead = host.querySelector('[data-role="repread"]');
    var condBox = host.querySelector('[data-role="conds"]');

    /* ── the scatter ──────────────────────────────────────────────────── */
    function drawScatter() {
      var s = D.stations.filter(function (x) { return x.name === station; })[0];
      var S = 300, C = S / 2, k = (S / 2 - 16) / LIM;      // mm → px
      var g = ['<svg viewBox="0 0 ' + S + ' ' + S + '" class="al-svg" role="img" ' +
               'aria-label="Landing scatter at ' + esc(pretty(station)) + '">'];

      /* grid: a ring every 10 mm, the decade ring called out */
      for (var r = 10; r <= LIM; r += 10) {
        g.push('<circle cx="' + C + '" cy="' + C + '" r="' + (r * k).toFixed(1) +
               '" class="al-ring' + (r % 50 === 0 ? ' al-ring-x' : '') + '"/>');
      }
      g.push('<path d="M8 ' + C + ' H' + (S - 8) + ' M' + C + ' 8 V' + (S - 8) +
             '" class="al-ax"/>');
      g.push('<text x="' + (S - 8) + '" y="' + (C - 7) + '" class="al-tick" ' +
             'text-anchor="end">lateral →</text>');
      g.push('<text x="' + (C + 7) + '" y="16" class="al-tick">↑ height</text>');
      g.push('<text x="' + (C + (LIM * k) - 2) + '" y="' + (C + 15) +
             '" class="al-tick" text-anchor="end">' + LIM + ' mm</text>');

      Object.keys(HAND).forEach(function (h) {
        var d = s.hands[h], col = HAND[h][1];
        g.push('<circle cx="' + C + '" cy="' + C + '" r="' +
               (d.Rmax_mm * k).toFixed(1) + '" class="al-rmax" stroke="' + col + '"/>');
        g.push('<circle cx="' + C + '" cy="' + C + '" r="' +
               (d.RP_mm * k).toFixed(1) + '" class="al-rp" stroke="' + col + '"/>');
        d.pts.forEach(function (p) {
          g.push('<circle cx="' + (C + p[0] * k).toFixed(1) + '" cy="' +
                 (C - p[1] * k).toFixed(1) + '" r="3.4" fill="' + col +
                 '" stroke="#151820" stroke-width="1.1"/>');
        });
      });
      g.push('</svg>');
      scatter.innerHTML = g.join('');

      repRead.innerHTML = Object.keys(HAND).map(function (h) {
        var d = s.hands[h];
        return '<div class="al-stat"><span class="al-dot" style="background:' +
          HAND[h][1] + '"></span><b>' + esc(HAND[h][0]) + '</b>' +
          '<span><i>RP</i>' + d.RP_mm.toFixed(1) + ' mm</span>' +
          '<span><i>R<sub>max</sub></i>' + d.Rmax_mm.toFixed(1) + ' mm</span>' +
          '<span><i>n</i>' + d.n + '</span></div>';
      }).join('') +
      '<p class="al-fine"><b>RP</b> is the ISO 9283 pose-repeatability radius — ' +
        'the sphere that holds 3σ of the landings (dashed). <b>R<sub>max</sub></b> ' +
        'is the worst single one (solid).' +
        (station === 'home'
          ? ' Home is entered from every direction, which is exactly why its ' +
            'scatter is the widest one here.'
          : ' This station is entered from Home each time, one approach direction.') +
        '</p>';

      host.querySelectorAll('[data-s]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.s === station);
      });
    }

    /* ── the error curves ─────────────────────────────────────────────── */
    function drawErr() {
      var cs = D.paths[pathName];
      var W = 460, H = 280, L = 46, R = 12, T = 14, B = 34;
      var lo = 1e9, hi = 0;
      cs.forEach(function (c) {
        c.lo.forEach(function (v) { lo = Math.min(lo, v); });
        c.hi.forEach(function (v) { hi = Math.max(hi, v); });
      });
      lo = Math.max(lo, 0.5); hi = hi * 1.15;
      var ly = Math.log10(lo), lh = Math.log10(hi);
      var X = function (x) { return L + (W - L - R) * x / 2; };
      var Y = function (v) {
        return T + (H - T - B) * (1 - (Math.log10(Math.max(v, lo)) - ly) / (lh - ly));
      };

      var g = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="al-svg" role="img" ' +
               'aria-label="Tracking error along the ' + esc(pathName) + ' path">'];
      /* decade gridlines, since the axis is a log axis and says so */
      for (var e = Math.floor(ly); e <= Math.ceil(lh); e++) {
        var v = Math.pow(10, e);
        if (v < lo || v > hi) continue;
        g.push('<path d="M' + L + ' ' + Y(v).toFixed(1) + ' H' + (W - R) +
               '" class="al-gl"/>');
        g.push('<text x="' + (L - 7) + '" y="' + (Y(v) + 4).toFixed(1) +
               '" class="al-tick" text-anchor="end">' +
               (v >= 1 ? v : v.toFixed(1)) + '</text>');
      }
      g.push('<text x="14" y="' + (T + 4) + '" class="al-tick">mm</text>');
      [0, 0.5, 1, 1.5, 2].forEach(function (x) {
        g.push('<path d="M' + X(x).toFixed(1) + ' ' + (H - B) + ' v5" class="al-ax"/>');
        g.push('<text x="' + X(x).toFixed(1) + '" y="' + (H - B + 18) +
               '" class="al-tick" text-anchor="middle">' + x + '</text>');
      });
      g.push('<text x="' + ((L + W - R) / 2) + '" y="' + (H - 4) +
             '" class="al-tick" text-anchor="middle">laps around the path</text>');
      g.push('<path d="M' + L + ' ' + T + ' V' + (H - B) + ' H' + (W - R) +
             '" class="al-ax"/>');

      cs.forEach(function (c) {
        var col = COND[c.tag] || '#151820';
        var band = c.x.map(function (x, i) {
          return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(c.hi[i]).toFixed(1);
        }).join('') + c.x.map(function (x, i) {
          var j = c.x.length - 1 - i;
          return 'L' + X(c.x[j]).toFixed(1) + ' ' + Y(c.lo[j]).toFixed(1);
        }).join('') + 'Z';
        g.push('<path d="' + band + '" fill="' + col + '" opacity=".14"/>');
        g.push('<path class="al-line" data-c="' + c.tag + '" stroke="' + col +
               '" d="' + c.x.map(function (x, i) {
                 return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' +
                        Y(c.mean[i]).toFixed(1);
               }).join('') + '"/>');
      });
      g.push('</svg>');
      errBox.innerHTML = g.join('');

      var first = cs[0], last = cs[cs.length - 1];
      condBox.innerHTML = cs.map(function (c) {
        return '<button type="button" class="al-cond" data-c="' + c.tag +
          '" style="--c:' + (COND[c.tag] || '#151820') + '">' +
          '<b>' + esc(c.label) + '</b>' +
          '<span>' + c.rms_mm.toFixed(1) + ' mm RMS</span>' +
          '<em>' + esc(c.why) + '</em></button>';
      }).join('') +
      '<p class="al-fine">Over the ' + esc(pathName) + ': <b>' +
        first.rms_mm.toFixed(0) + ' mm</b> on the joint controller alone, <b>' +
        last.rms_mm.toFixed(1) + ' mm</b> on the gains we deploy — ' +
        (first.rms_mm / Math.max(last.rms_mm, 1e-9)).toFixed(0) +
        '× better, ' + last.trials + ' trials per condition. Every term in ' +
        'between earns its place on this plot or it would not be in the ' +
        'controller.</p>';

      host.querySelectorAll('[data-p]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.p === pathName);
      });
    }

    host.querySelector('[data-role="stations"]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-s]');
      if (!b) return;
      station = b.dataset.s;
      drawScatter();
    });
    host.querySelector('[data-role="paths"]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]');
      if (!b) return;
      pathName = b.dataset.p;
      drawErr();
    });
    /* hovering a condition brings its curve forward — four log curves overlap */
    condBox.addEventListener('pointerover', function (e) {
      var b = e.target.closest('[data-c]');
      errBox.querySelectorAll('.al-line').forEach(function (l) {
        l.classList.toggle('dim', !!b && l.dataset.c !== b.dataset.c);
        l.classList.toggle('up', !!b && l.dataset.c === b.dataset.c);
      });
    });
    condBox.addEventListener('pointerleave', function () {
      errBox.querySelectorAll('.al-line').forEach(function (l) {
        l.classList.remove('dim', 'up');
      });
    });

    drawScatter();
    drawErr();

    window.__accuracyLab = {
      data: D, limit: LIM,
      station: function () { return station; },
      path: function () { return pathName; },
      setStation: function (s) { station = s; drawScatter(); },
      setPath: function (p) { pathName = p; drawErr(); },
      dots: function () { return scatter.querySelectorAll('circle[fill]').length; },
      lines: function () { return errBox.querySelectorAll('.al-line').length; }
    };
  }
})();
