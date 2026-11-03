/* Does it go where you tell it? — the bench measurements, drawn live.
 *
 * Two runs on the real robot, 2026-10-08, the ones the submission video quotes:
 *
 *   REPEATABILITY (ISO 9283). Both arms and the torso visit 8 stations and HOME,
 *   10 cycles. Every return hold is a dot, in the frontal plane, about its
 *   station's barycentre. RP = mean(l) + 3 sd(l) is the ISO radius.
 *
 *   PATH FOLLOWING. Both palms trace a spiral and a square, torso at 0° or −10°,
 *   3 trials each. Tracking error (time-aligned: lag counts) and contour error
 *   (distance to the path's shape) along the trace, mean ± 1 s.d. over trials.
 *
 * LIVE. Each panel plays the submission render of that run, and the plot follows
 * the clip on the render's own clock (exported by scripts/build_accuracy.py):
 * a landing appears the moment the clip marks it, and the line plot's playhead
 * sits where the drawn palm is on the path. Pick a station or a condition and
 * the plot stops following; "Follow the clip" picks it back up.
 *
 * Hover (or tap) a dot or a curve for the measured value. The legends toggle
 * series. Everything drawn comes from assets/data/accuracy.json — nothing here
 * is a number typed by hand. Colours are the site's tokens (STYLE.md): left
 * palm = --blue, right palm = --green, as in the render.
 *
 * ONE FRAME ACROSS ALL STATIONS. Switching station must not rescale the axes
 * under the reader; that comparison is the point of the panel.
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
  var HANDS = ['left', 'right'];
  var HC = { left: 'var(--blue)', right: 'var(--green)' };
  var HN = { left: 'Left palm', right: 'Right palm' };
  var pretty = function (s) {
    return s === 'HOME' ? 'Home' : s.replace(/^T(\d)_/, 'T$1 · ').replace(/_/g, ' ');
  };
  var condName = function (c) { return c.shape + ' · ' + (c.torso_deg ? '−10°' : '0°') + ' torso'; };
  var f1 = function (v) { return (+v).toFixed(1); };
  var f2 = function (v) { return (+v).toFixed(2); };

  Promise.all([
    fetch('assets/data/accuracy.json').then(function (r) { return r.json(); }),
    /* the clips are a nicety: a missing index must not take the measurements down */
    fetch('assets/accuracy/index.json').then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
  ]).then(function (both) { both[0].clips = (both[1] || {}).clips || {}; return both[0]; })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="al-err">Could not load the measurements.</p>';
      console.error('[accuracy-lab]', e);
    });

  function clipTile(D, key) {
    var c = (D.clips || {})[key];
    if (!c) return '';
    return '<figure class="al-clip" data-clip="' + key + '">' +
      '<video controls autoplay muted loop playsinline preload="none" width="' + (c.w || 900) + '" height="' + (c.h || 720) + '" ' +
        'data-poster="assets/accuracy/' + esc(c.poster) + '" ' +
        'data-lazyvid="assets/accuracy/' + esc(c.clip) + '"' +
        (c.lo ? ' data-lo="assets/accuracy/' + esc(c.lo) + '"' : '') + '></video>' +
      '</figure>';
  }

  function build(D) {
    var R = D.rep, PF = D.path;
    var CLIP = D.clip_s || 9.2;
    var st = { station: 'HOME', follow: true, t: D.clips.repeat ? 0 : null, hands: { left: true, right: true } };
    var pt = { cond: PF.conditions[0].id, follow: true, t: D.clips.path ? 0 : null,
               on: { left_track: true, right_track: true, left_contour: true, right_contour: true } };

    /* every visit, in the order the clip marks them */
    var visits = [];
    R.stations.forEach(function (s) {
      HANDS.forEach(function (h) {
        s.hands[h].pts.forEach(function (p, i) {
          if (h === 'left') visits.push({ station: s.name, cycle: p[3], vt: p[4], i: i });
        });
      });
    });
    visits.sort(function (a, b) { return a.vt - b.vt; });

    /* the shared frame, rounded up to a whole millimetre */
    var LIM = Math.ceil(R.stations.reduce(function (m, s) {
      return HANDS.reduce(function (n, h) { return Math.max(n, s.hands[h].max_mm, s.hands[h].RP_mm); }, m);
    }, 0) * 1.12);

    host.innerHTML =
      '<div class="al-grid">' +
        '<div class="al-panel" data-panel="rep">' +
          '<span class="al-kick">ISO 9283 · ' + R.cycles + ' cycles</span>' +
          '<h4 class="al-h">Repeatability</h4>' +
          '<p class="al-say"><b>' + f2(R.median_RP_mm) + ' mm</b> median RP</p>' +
          '<div class="al-chips" data-role="stations">' +
            '<button type="button" class="al-chip al-follow" data-follow="rep" aria-pressed="true">● Follow the clip</button>' +
            R.stations.map(function (s) {
              return '<button type="button" class="al-chip" data-s="' + esc(s.name) + '">' + esc(pretty(s.name)) + '</button>';
            }).join('') +
          '</div>' +
          clipTile(D, 'repeat') +
          '<div class="al-plot al-plotwrap" data-role="scatter"></div>' +
          '<div class="al-lg" data-role="replg">' + HANDS.map(function (h) {
            return '<button type="button" class="al-lg-b" data-h="' + h + '" aria-pressed="true" style="--c:' + HC[h] + '">' +
              '<span class="al-dot" style="background:' + HC[h] + '"></span>' + HN[h] + '</button>';
          }).join('') + '</div>' +
          '<p class="al-live" data-role="replive" aria-live="off"></p>' +
          '<div class="al-read" data-role="repread"></div>' +
        '</div>' +
        '<div class="al-panel" data-panel="path">' +
          '<span class="al-kick">Both palms · ' + PF.conditions[0].trials + ' trials</span>' +
          '<h4 class="al-h">Path tracking</h4>' +
          '<p class="al-say"><b>' + f2(PF.worst_contour_rms_mm) + ' mm RMS</b> worst contour error</p>' +
          '<div class="al-chips" data-role="paths">' +
            '<button type="button" class="al-chip al-follow" data-follow="path" aria-pressed="true">● Follow the clip</button>' +
            PF.conditions.map(function (c) {
              return '<button type="button" class="al-chip" data-p="' + esc(c.id) + '">' + esc(condName(c)) + '</button>';
            }).join('') +
          '</div>' +
          clipTile(D, 'path') +
          '<div class="al-plot al-plotwrap" data-role="err"></div>' +
          '<div class="al-lg" data-role="pathlg"></div>' +
          '<p class="al-live" data-role="pathlive" aria-live="off"></p>' +
          '<div class="al-read" data-role="pathread"></div>' +
        '</div>' +
      '</div>' +
      '<p class="al-src">Palm centre from forward kinematics of the measured joints, torso included — it excludes ' +
        'backlash and link bending, so these are lower bounds on the true error. Drawn from ' +
        '<code>assets/data/accuracy.json</code>, exported by <code>website/scripts/build_accuracy.py</code> from the ' +
        'hardware logs; the clips are the submission video\'s renders of the same logs.</p>';

    host.querySelectorAll('.al-panel').forEach(function(panel){
      var clip=panel.querySelector('.al-clip'),plot=panel.querySelector('.al-plot'),media=document.createElement('div'),plots=document.createElement('div');media.className='al-media';plots.className='al-plots';
      var header=document.createElement('div');header.className='al-panel-head';['.al-kick','.al-h','.al-say'].forEach(function(s){header.appendChild(panel.querySelector(s));});panel.prepend(header);
      media.append(clip,plots);plot.before(media);plots.appendChild(plot);
      ['.al-lg','.al-live'].forEach(function(s){var n=panel.querySelector(s);if(n)plots.appendChild(n);});
      var read=panel.querySelector('.al-read'),details=document.createElement('details');details.className='al-results';details.innerHTML='<summary>Results</summary>';read.before(details);details.appendChild(read);
    });
    var base=document.createElement('article');base.className='al-panel al-base';base.id='baseOdometry';base.innerHTML='<div class="al-panel-head"><span class="al-kick">Wheel encoders · ZED reference</span><h4 class="al-h">Base odometry</h4></div><div class="base-replay">Loading recorded base tests…</div>';
    host.querySelector('[data-panel="rep"]').after(base);
    new IntersectionObserver(function(entries,observer){if(entries.some(function(e){return e.isIntersecting;})){observer.disconnect();import('./base-odometry.js?v=a5797ce9');}},{rootMargin:'180px'}).observe(base);
    var source=host.querySelector('.al-src');var methods=document.createElement('details');methods.className='al-results al-methods';methods.innerHTML='<summary>Measurement methods</summary>';source.before(methods);methods.appendChild(source);
    var Q = function (r) { return host.querySelector('[data-role="' + r + '"]'); };
    var scatterBox = Q('scatter'), errBox = Q('err');
    var tip = document.createElement('div'); tip.className = 'al-tip'; tip.hidden = true;
    var tip2 = tip.cloneNode(); scatterBox.appendChild(tip); errBox.appendChild(tip2);
    function showTip(t, box, html, x, y) {
      t.innerHTML = html; t.hidden = false;
      var bw = box.clientWidth, tw = t.offsetWidth;
      t.style.left = Math.max(4, Math.min(bw - tw - 4, x + 12)) + 'px';
      t.style.top = Math.max(4, y - t.offsetHeight - 10) + 'px';
    }

    /* ── repeatability: the scatter ─────────────────────────────────────
       Following the clip it is a 3×3 of every station filling in as the clip
       marks each return (the clip marks 144 of them in 3.5 s, so one station
       at a time would only flicker). Pick a station for the single large view. */
    var S = 260, C = S / 2, K = (S / 2 - 16) / LIM, drawn = [];
    var G = 3, CELL = S / G, KC = (CELL / 2 - 9) / LIM;
    function stationOf(name) { return R.stations.filter(function (s) { return s.name === name; })[0]; }
    function repNow() {
      if (!st.follow) return { station: st.station, upto: Infinity, grid: false };
      if (st.t == null) return { station: null, upto: Infinity, grid: true };
      var landed = visits.filter(function (v) { return v.vt <= st.t; });
      var last = landed[landed.length - 1], nxt = visits[landed.length];
      return { station: last ? last.station : null, upto: st.t, grid: true, last: last, next: nxt, landed: landed.length };
    }
    function drawScatterFrame() {
      var old = scatterBox.querySelector('svg'); if (old) old.remove();
      scatterBox.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 ' + S + ' ' + S + '" class="al-svg" role="img" ' +
        'aria-label="Palm returns about their barycentre"><g data-role="frame"></g><g data-role="rings"></g><g data-role="pts"></g></svg>');
      frameMode = null;
    }
    var frameMode = null;
    function drawAxes(grid) {
      var g = [];
      if (!grid) {
        var step = LIM > 8 ? 2 : 1;
        for (var r = step; r <= LIM; r += step) g.push('<circle cx="' + C + '" cy="' + C + '" r="' + (r * K).toFixed(1) + '" class="al-ring"/>');
        g.push('<path d="M8 ' + C + ' H' + (S - 8) + ' M' + C + ' 8 V' + (S - 8) + '" class="al-ax"/>');
        g.push('<text x="' + (S - 8) + '" y="' + (C - 7) + '" class="al-tick" text-anchor="end">lateral →</text>');
        g.push('<text x="' + (C + 7) + '" y="16" class="al-tick">↑ height</text>');
        g.push('<text x="' + (C + LIM * K - 2) + '" y="' + (C + 14) + '" class="al-tick" text-anchor="end">' + LIM + ' mm</text>');
      } else {
        R.stations.forEach(function (s, n) {
          var cx = (n % G + 0.5) * CELL, cy = (Math.floor(n / G) + 0.5) * CELL;
          g.push('<rect class="al-cell" data-cell="' + esc(s.name) + '" x="' + (cx - CELL / 2 + 2) + '" y="' + (cy - CELL / 2 + 2) + '" width="' + (CELL - 4) + '" height="' + (CELL - 4) + '" rx="7"/>');
          g.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (LIM * KC).toFixed(1) + '" class="al-ring"/>');
          g.push('<path d="M' + (cx - LIM * KC) + ' ' + cy + ' H' + (cx + LIM * KC) + ' M' + cx + ' ' + (cy - LIM * KC) + ' V' + (cy + LIM * KC) + '" class="al-gl"/>');
          g.push('<text x="' + (cx - CELL / 2 + 7) + '" y="' + (cy - CELL / 2 + 14) + '" class="al-tick al-cell-t">' + esc(s.name === 'HOME' ? 'Home' : s.name.split('_')[0]) + '</text>');
        });
        g.push('<text x="' + (S - 6) + '" y="' + (S - 6) + '" class="al-tick" text-anchor="end">rings ' + LIM + ' mm</text>');
      }
      scatterBox.querySelector('[data-role="frame"]').innerHTML = g.join('');
      frameMode = grid;
    }
    function drawScatter() {
      var now = repNow();
      if (frameMode !== now.grid) drawAxes(now.grid);
      var ringG = scatterBox.querySelector('[data-role="rings"]'), ptG = scatterBox.querySelector('[data-role="pts"]');
      var rings = [], pts = []; drawn = [];
      var list = now.grid ? R.stations : [stationOf(now.station)];
      list.forEach(function (s) {
        var n = R.stations.indexOf(s);
        var cx = now.grid ? (n % G + 0.5) * CELL : C, cy = now.grid ? (Math.floor(n / G) + 0.5) * CELL : C, k = now.grid ? KC : K;
        HANDS.forEach(function (h) {
          if (!st.hands[h]) return;
          var d = s.hands[h];
          var seen = d.pts.filter(function (p) { return p[4] <= now.upto; });
          if (seen.length === d.pts.length) rings.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (d.RP_mm * k).toFixed(1) + '" class="al-rp" style="stroke:' + HC[h] + '"/>');
          seen.forEach(function (p) { drawn.push({ h: h, p: p, s: s.name, x: cx + p[0] * k, y: cy - p[1] * k }); });
        });
      });
      var big = !now.grid;
      drawn.forEach(function (o) {
        var fresh = now.last && o.p[4] === now.last.vt && o.s === now.last.station;
        pts.push('<circle class="al-pt' + (fresh ? ' is-new' : '') + '" cx="' + o.x.toFixed(1) + '" cy="' + o.y.toFixed(1) +
                 '" r="' + (fresh ? 4.6 : big ? 3.6 : (o.s === 'HOME' ? 1.5 : 2.4)) + '" style="fill:' + HC[o.h] + '"/>');
      });
      ringG.innerHTML = rings.join(''); ptG.innerHTML = pts.join('');
      scatterBox.querySelectorAll('[data-cell]').forEach(function (c) { c.classList.toggle('is-now', !!now.last && c.dataset.cell === now.station); });
      host.querySelectorAll('[data-s]').forEach(function (b) { b.classList.toggle('on', !now.grid && b.dataset.s === now.station); });
      var fb = host.querySelector('[data-follow="rep"]');
      fb.setAttribute('aria-pressed', String(st.follow)); fb.classList.toggle('on', st.follow);

      var live = Q('replive');
      if (!now.grid) live.textContent = 'All ' + stationOf(now.station).hands.left.n + ' returns to ' + pretty(now.station) + ', every cycle. Hover a dot for its value.';
      else if (now.upto === Infinity) live.textContent = 'All ' + visits.length + ' returns, every station. Play the clip to watch them land, or pick a station.';
      else live.innerHTML = '<b>Cycle ' + ((now.next || now.last || visits[0]).cycle + 1) + ' of ' + R.cycles + '</b> · ' +
        (now.last ? 'just measured ' + esc(pretty(now.last.station)) : 'leaving Home') + ' · ' + now.landed + ' of ' + visits.length + ' holds';

      var s = now.station ? stationOf(now.station) : null;
      Q('repread').innerHTML = (s ? HANDS.map(function (h) {
        var d = s.hands[h];
        return '<div class="al-stat' + (st.hands[h] ? '' : ' is-off') + '"><span class="al-dot" style="background:' + HC[h] + '"></span><b>' + HN[h] + '</b>' +
          '<span><i>' + esc(pretty(s.name)) + '</i></span><span><i>RP</i>' + f2(d.RP_mm) + ' mm</span><span><i>AP</i>' + f1(d.AP_mm) + ' mm</span>' +
          '<span><i>max l</i>' + f2(d.max_mm) + '</span><span><i>n</i>' + d.n + '</span></div>';
      }).join('') : '<div class="al-stat"><b>All stations</b><span><i>median RP</i>' + f2(R.median_RP_mm) + ' mm</span><span><i>best</i>' +
          f2(R.best_RP_mm) + '</span><span><i>worst</i>' + f2(R.worst_RP_mm) + ' mm</span><span><i>n</i>' + visits.length + ' holds × 2 palms</span></div>') +
      '<p class="al-fine"><b>RP</b> (dashed ring, once a station\'s returns are all in) is the ISO 9283 radius that holds mean + 3σ of the returns. ' +
        '<b>AP</b> is how far their centre sits from the commanded pose — calibration, not repeatability. Home is entered after every station, so it has ' +
        stationOf('HOME').hands.left.n + ' returns.</p>';
    }
    scatterBox.addEventListener('click', function (e) {
      var c = e.target.closest('[data-cell]'); if (!c) return;
      st.follow = false; st.station = c.dataset.cell; drawScatter();
    });

    scatterBox.addEventListener('pointermove', scatterTip);
    scatterBox.addEventListener('pointerdown', scatterTip);
    scatterBox.addEventListener('pointerleave', function () { tip.hidden = true; });
    function scatterTip(e) {
      var svg = scatterBox.querySelector('svg'); if (!svg) return;
      var b = svg.getBoundingClientRect(), k = S / b.width;
      var x = (e.clientX - b.left) * k, y = (e.clientY - b.top) * k, best = null, bd = 12;
      drawn.forEach(function (o) { var d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } });
      if (!best) { tip.hidden = true; return; }
      var bb = scatterBox.getBoundingClientRect();
      showTip(tip, scatterBox, '<b style="color:' + HC[best.h] + '">' + HN[best.h] + '</b> · ' + esc(pretty(repNow().station)) +
        ' · cycle ' + (best.p[3] + 1) + '<br/>' + f2(best.p[2]) + ' mm from the centre<br/><i>' +
        (best.p[0] >= 0 ? '+' : '') + f2(best.p[0]) + ' lateral, ' + (best.p[1] >= 0 ? '+' : '') + f2(best.p[1]) + ' height</i>',
        e.clientX - bb.left, e.clientY - bb.top);
    }

    /* ── path following: the line plot ──────────────────────────────────── */
    var SER = [
      { key: 'left_track', h: 'left', kind: 'track', label: 'Left · tracking' },
      { key: 'right_track', h: 'right', kind: 'track', label: 'Right · tracking' },
      { key: 'left_contour', h: 'left', kind: 'contour', label: 'Left · contour' },
      { key: 'right_contour', h: 'right', kind: 'contour', label: 'Right · contour' }
    ];
    var W = 440, H = 230, L = 38, RR = 10, T = 12, B = 32, geom = null;
    function condOf(id) { return PF.conditions.filter(function (c) { return c.id === id; })[0]; }
    function pathNow() {
      if (!pt.follow || pt.t == null) return { cond: pt.cond, x: null };
      var shape = pt.t < (D.path_split_s || CLIP / 2) ? 'spiral' : 'square';
      var c = PF.conditions.filter(function (q) { return q.shape === shape && q.sync; })[0];
      var s = c.sync, x = null, phase = 'tracing';
      if (pt.t < s[0][0]) phase = 'moving to the start';
      else if (pt.t > s[s.length - 1][0]) phase = 'holding at the end';
      else for (var i = 1; i < s.length; i++) if (s[i][0] >= pt.t) {
        x = s[i - 1][1] + (s[i][1] - s[i - 1][1]) * (pt.t - s[i - 1][0]) / Math.max(1e-6, s[i][0] - s[i - 1][0]); break;
      }
      return { cond: c.id, x: x, phase: phase };
    }
    function drawErr() {
      var now = pathNow(), c = condOf(now.cond);
      var hi = 0; SER.forEach(function (s) { c.series[s.key].hi.forEach(function (v) { hi = Math.max(hi, v); }); });
      var top = Math.ceil(hi * 1.08 / 5) * 5, xmax = c.x[c.x.length - 1];
      var X = function (x) { return L + (W - L - RR) * x / xmax; };
      var Y = function (v) { return T + (H - T - B) * (1 - v / top); };
      geom = { X: X, Y: Y, c: c, xmax: xmax };
      var g = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="al-svg" role="img" aria-label="Palm error along the ' + esc(condName(c)) + '">'];
      for (var v = 0; v <= top; v += 5) {
        g.push('<path d="M' + L + ' ' + Y(v).toFixed(1) + ' H' + (W - RR) + '" class="al-gl"/>');
        g.push('<text x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" class="al-tick" text-anchor="end">' + v + '</text>');
      }
      g.push('<text x="6" y="' + (T + 2) + '" class="al-tick">mm</text>');
      var xs = xmax > 10 ? 2 : 1;
      for (var x = 0; x <= xmax + 1e-6; x += xs) {
        g.push('<path d="M' + X(x).toFixed(1) + ' ' + (H - B) + ' v5" class="al-ax"/>');
        g.push('<text x="' + X(x).toFixed(1) + '" y="' + (H - B + 17) + '" class="al-tick" text-anchor="middle">' + x + '</text>');
      }
      g.push('<text x="' + ((L + W - RR) / 2) + '" y="' + (H - 3) + '" class="al-tick" text-anchor="middle">seconds along the path</text>');
      g.push('<path d="M' + L + ' ' + T + ' V' + (H - B) + ' H' + (W - RR) + '" class="al-ax"/>');
      g.push('<defs><clipPath id="accuracyTraceWindow"><rect data-role="trace-window" x="' + L + '" y="0" width="0" height="' + H + '"/></clipPath></defs><g clip-path="url(#accuracyTraceWindow)">');
      SER.forEach(function (s) {
        if (!pt.on[s.key]) return;
        var d = c.series[s.key], col = HC[s.h];
        var band = c.x.map(function (x, i) { return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(d.hi[i]).toFixed(1); }).join('') +
          c.x.slice().reverse().map(function (x, i) { var j = c.x.length - 1 - i; return 'L' + X(x).toFixed(1) + ' ' + Y(d.lo[j]).toFixed(1); }).join('') + 'Z';
        g.push('<path class="al-band" d="' + band + '" style="fill:' + col + '"/>');
        g.push('<path class="al-line' + (s.kind === 'contour' ? ' is-contour' : '') + '" data-c="' + s.key + '" style="stroke:' + col + '" d="' +
          c.x.map(function (x, i) { return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(d.mean[i]).toFixed(1); }).join('') + '"/>');
      });
      g.push('</g><g data-role="ph"></g><g data-role="hov"></g></svg>');
      var old = errBox.querySelector('svg'); if (old) old.remove();
      errBox.insertAdjacentHTML('afterbegin', g.join(''));
      drawn2 = c.id;
      host.querySelectorAll('[data-p]').forEach(function (b) { b.classList.toggle('on', b.dataset.p === c.id); });
      host.querySelector('[data-follow="path"]').setAttribute('aria-pressed', String(pt.follow));
      host.querySelector('[data-follow="path"]').classList.toggle('on', pt.follow);

      Q('pathlg').innerHTML = SER.map(function (s) {
        var m = c.stats[s.h][s.kind === 'track' ? 'track_rms_mm' : 'contour_rms_mm'];
        return '<button type="button" class="al-lg-b' + (s.kind === 'contour' ? ' is-contour' : '') + '" data-k="' + s.key + '" aria-pressed="' + pt.on[s.key] +
          '" style="--c:' + HC[s.h] + '"><span class="al-lg-sw"></span>' + s.label + ' <em>' + f1(m) + ' mm RMS</em></button>';
      }).join('');
      Q('pathread').innerHTML =
        '<table class="al-tbl"><thead><tr><th></th><th>track RMS</th><th>p95</th><th>contour RMS</th><th>contour max</th><th>trial spread</th></tr></thead><tbody>' +
        HANDS.map(function (h) {
          var m = c.stats[h];
          return '<tr><th><span class="al-dot" style="background:' + HC[h] + '"></span> ' + HN[h] + '</th><td>' + f1(m.track_rms_mm) + '</td><td>' +
            f1(m.track_p95_mm) + '</td><td>' + f1(m.contour_rms_mm) + '</td><td>' + f1(m.contour_max_mm) + '</td><td>' + f2(m.trial_spread_mm) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="al-fine">mm, mean over ' + c.trials + ' trials of ' + esc(condName(c)) + '. Tracking error is mostly lag — the palm runs ' +
          'a few centimetres behind a 10 cm/s reference — which is why the contour error, the shape it actually draws, is several times smaller. ' +
          'Trial spread is how far the same point of the path lands from trial to trial.</p>';
      drawPlayhead();
    }
    var drawn2 = null;
    function drawPlayhead() {
      var now = pathNow(), ph = errBox.querySelector('[data-role="ph"]'), live = Q('pathlive');
      if (!ph || !geom) return;
      // Reveal measured samples only as the matching robot replay reaches them.
      var reveal=errBox.querySelector('[data-role="trace-window"]');
      var upto=(!pt.follow || pt.t==null || now.phase==='holding at the end') ? geom.xmax : (now.x==null ? 0 : now.x);
      if(reveal)reveal.setAttribute('width',Math.max(0,geom.X(Math.min(geom.xmax,upto))-L).toFixed(2));
      if (now.x == null) {
        ph.innerHTML = '';
        live.innerHTML = pt.follow && pt.t != null ? 'The clip: <b>' + esc(condName(condOf(now.cond))) + '</b>, trial 1 — ' + now.phase + '.'
          : 'Hover the plot for the error at any point of the path.';
        return;
      }
      var c = geom.c, i = 0;
      while (i < c.x.length - 1 && c.x[i + 1] <= now.x) i++;
      var X = geom.X(now.x), g = ['<path class="al-ph" d="M' + X.toFixed(1) + ' ' + T + ' V' + (H - B) + '"/>'];
      var parts = [];
      SER.forEach(function (s) {
        if (!pt.on[s.key]) return;
        var v = c.series[s.key].mean[i];
        g.push('<circle cx="' + X.toFixed(1) + '" cy="' + geom.Y(v).toFixed(1) + '" r="3.6" class="al-pt" style="fill:' + HC[s.h] + '"/>');
        parts.push(s.label.toLowerCase() + ' ' + f1(v));
      });
      ph.innerHTML = g.join('');
      ph.dataset.x = now.x.toFixed(2);
      live.innerHTML = 'The clip: <b>' + esc(condName(c)) + '</b> at ' + f1(now.x) + ' s — ' + esc(parts.join(' · ')) + ' mm (mean of ' + c.trials + ' trials)';
    }
    errBox.addEventListener('pointermove', errTip);
    errBox.addEventListener('pointerdown', errTip);
    errBox.addEventListener('pointerleave', function () { tip2.hidden = true; var h = errBox.querySelector('[data-role="hov"]'); if (h) h.innerHTML = ''; });
    function errTip(e) {
      var svg = errBox.querySelector('svg'); if (!svg || !geom) return;
      var b = svg.getBoundingClientRect(), k = W / b.width, x = (e.clientX - b.left) * k;
      if (x < L || x > W - RR) { tip2.hidden = true; return; }
      var c = geom.c, xv = (x - L) / (W - L - RR) * geom.xmax, i = 0;
      while (i < c.x.length - 1 && Math.abs(c.x[i + 1] - xv) < Math.abs(c.x[i] - xv)) i++;
      var X = geom.X(c.x[i]), hov = errBox.querySelector('[data-role="hov"]'), rows = [], g = ['<path class="al-ph is-hover" d="M' + X.toFixed(1) + ' ' + T + ' V' + (H - B) + '"/>'];
      SER.forEach(function (s) {
        if (!pt.on[s.key]) return;
        var d = c.series[s.key];
        g.push('<circle cx="' + X.toFixed(1) + '" cy="' + geom.Y(d.mean[i]).toFixed(1) + '" r="3.2" class="al-pt" style="fill:' + HC[s.h] + '"/>');
        rows.push('<span style="color:' + HC[s.h] + '">●</span> ' + s.label + ' <b>' + f1(d.mean[i]) + '</b> ± ' + f1((d.hi[i] - d.lo[i]) / 2) + ' mm');
      });
      hov.innerHTML = g.join('');
      if (!rows.length) { tip2.hidden = true; return; }
      var bb = errBox.getBoundingClientRect();
      showTip(tip2, errBox, '<b>' + f1(c.x[i]) + ' s</b> along the ' + esc(c.shape) + '<br/>' + rows.join('<br/>'), e.clientX - bb.left, e.clientY - bb.top);
    }

    /* ── controls ───────────────────────────────────────────────────────── */
    host.querySelector('[data-role="stations"]').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.follow) { st.follow = !st.follow; if (!st.follow) st.station = repNow().station; }
      else { st.follow = false; st.station = b.dataset.s; }
      drawScatter();
    });
    host.querySelector('[data-role="paths"]').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.follow) { pt.follow = !pt.follow; if (!pt.follow) pt.cond = pathNow().cond; }
      else { pt.follow = false; pt.cond = b.dataset.p; }
      drawErr();
    });
    Q('replg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-h]'); if (!b) return;
      st.hands[b.dataset.h] = !st.hands[b.dataset.h];
      if (!st.hands.left && !st.hands.right) st.hands[b.dataset.h === 'left' ? 'right' : 'left'] = true;   // never an empty plot
      Q('replg').querySelectorAll('[data-h]').forEach(function (x) { x.setAttribute('aria-pressed', String(st.hands[x.dataset.h])); });
      drawScatter();
    });
    Q('pathlg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      pt.on[b.dataset.k] = !pt.on[b.dataset.k];
      if (!SER.some(function (s) { return pt.on[s.key]; })) pt.on[b.dataset.k] = true;
      drawErr();
    });
    Q('pathlg').addEventListener('pointerover', function (e) {
      var b = e.target.closest('[data-k]');
      errBox.querySelectorAll('.al-line').forEach(function (l) {
        l.classList.toggle('dim', !!b && l.dataset.c !== b.dataset.k);
        l.classList.toggle('up', !!b && l.dataset.c === b.dataset.k);
      });
    });
    Q('pathlg').addEventListener('pointerleave', function () {
      errBox.querySelectorAll('.al-line').forEach(function (l) { l.classList.remove('dim', 'up'); });
    });

    /* ── the clock: the clips drive the plots ───────────────────────────── */
    function vid(key) { var f = host.querySelector('[data-clip="' + key + '"]'); return f && f.querySelector('video'); }
    function setRepT(t) {
      st.t = t;
      var now = repNow(), n = now.landed == null ? -2 : now.landed;
      if (n !== lastN || now.station !== lastS) { lastN = n; lastS = now.station; drawScatter(); }
    }
    var lastN = -1, lastS = null;
    function setPathT(t) {
      pt.t = t;
      var now = pathNow();
      if (now.cond !== drawn2) drawErr(); else drawPlayhead();
    }
    var raf = 0, held = false;
    function tick() {
      raf = 0;
      if (held) return;
      var a = vid('repeat'), b = vid('path'), more = false;
      if (a && a.readyState >= 2) { setRepT(a.currentTime); more = more || !a.paused; }
      if (b && b.readyState >= 2) { setPathT(b.currentTime); more = more || !b.paused; }
      if (more) raf = requestAnimationFrame(tick);
    }
    ['play', 'playing', 'seeked', 'timeupdate', 'loadeddata'].forEach(function (ev) {
      host.addEventListener(ev, function () { if (!raf) raf = requestAnimationFrame(tick); }, true);   // media events do not bubble; capture does
    });

    drawScatterFrame();
    drawScatter();
    drawErr();
    if (window.__lazyVid) window.__lazyVid(host);
    // Set the DOM properties too: Safari needs a muted inline video before
    // loading its source. Retry when decoding or returning to this section.
    var clips=Array.from(host.querySelectorAll('video'));
    function resume(v){var r=v.getBoundingClientRect();if(document.hidden||r.bottom<=0||r.top>=innerHeight)return;var promise=v.play();if(promise)promise.catch(function(){});}
    clips.forEach(function(v){
      v.autoplay=true;v.muted=true;v.defaultMuted=true;v.loop=true;v.playsInline=true;v.setAttribute('webkit-playsinline','');
      ['loadeddata','canplay'].forEach(function(ev){v.addEventListener(ev,function(){resume(v);});});
    });
    new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting)resume(e.target);});},{threshold:.1}).observe(clips[0]);
    if(clips[1])new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting)resume(e.target);});},{threshold:.1}).observe(clips[1]);
    ['pageshow','focus'].forEach(function(ev){window.addEventListener(ev,function(){clips.forEach(resume);});});
    document.addEventListener('visibilitychange',function(){clips.forEach(resume);});
    document.addEventListener('pointerup',function(){clips.forEach(function(v){if(v.paused&&v.currentTime===0)resume(v);});},{passive:true});

    window.__accuracyLab = {
      data: D, limit: LIM, visits: visits,
      station: function () { return repNow().station; },
      grid: function () { return repNow().grid; },
      cond: function () { return pathNow().cond; },
      setStation: function (s) { st.follow = false; st.station = s; drawScatter(); },
      setCond: function (c) { pt.follow = false; pt.cond = c; drawErr(); },
      follow: function (on) { st.follow = pt.follow = on; drawScatter(); drawErr(); },
      at: function (t) { setRepT(t); setPathT(t); },          // drive both plots as the clip would at t seconds
      hold: function (on) { held = !!on; },                    // checks: stop the clips' clock from driving the plots
      dots: function () { return scatterBox.querySelectorAll('[data-role="pts"] circle').length; },
      lines: function () { return errBox.querySelectorAll('.al-line').length; },
      playhead: function () { var p = errBox.querySelector('[data-role="ph"]'); return p && p.dataset.x && p.innerHTML ? +p.dataset.x : null; },
      dotXY: function (i) {
        var o = drawn[i], svg = scatterBox.querySelector('svg'); if (!o || !svg) return null;
        var b = svg.getBoundingClientRect(); return { x: b.left + o.x * b.width / S, y: b.top + o.y * b.width / S, h: o.h, s: o.s, mm: o.p[2], cycle: o.p[3] };
      },
      plotXY: function (xs) {
        var svg = errBox.querySelector('svg'); if (!svg || !geom) return null;
        var b = svg.getBoundingClientRect(); return { x: b.left + geom.X(xs) * b.width / W, y: b.top + b.height / 2 };
      }
    };
  }
})();
