/* Drive the robot; watch the map appear. SLAM, in the page.
 *
 * WHAT THIS ACTUALLY IS, so nobody has to guess: a 2-D occupancy grid built
 * from a simulated 360-beam lidar, updated with the same LOG-ODDS rule
 * slam_toolbox uses, on a pose corrected by scan matching against the map
 * built so far. The floor plan is hidden from the viewer and hidden from the
 * mapper — the grid you watch fill in is inferred from range readings alone,
 * exactly as it is on the robot.
 *
 * WHAT IT IS NOT: there is no loop closure and no pose graph. Drive a long
 * circuit and the map will shear, which is the honest behaviour of scan
 * matching without a back end and is worth seeing. The robot runs
 * slam_toolbox (2-D) and cuVSLAM (visual) and both close loops.
 *
 * Controls: ← → drive, ↑ ↓ or W/S turn. Held keys integrate at 60 Hz.
 *
 * Everything here is O(beams) per frame: 360 ray-segment intersections
 * against ~40 wall segments, and a Bresenham walk per beam. That is a few
 * thousand operations a frame — it runs on a phone.
 */
(function () {
  'use strict';
  var host = document.getElementById('slamLab');
  if (!host) return;

  /* ── the world the viewer cannot see ───────────────────────────────────
     A floor plan as wall segments, in metres. Rooms off a corridor, which is
     what a 2-D mapper is actually for. */
  var W = [];
  function room(x, y, w, h, doors) {
    var segs = [[x, y, x + w, y], [x + w, y, x + w, y + h],
                [x + w, y + h, x, y + h], [x, y + h, x, y]];
    segs.forEach(function (s, i) {
      var d = (doors || []).filter(function (dd) { return dd[0] === i; })[0];
      if (!d) { W.push(s); return; }
      /* a doorway: split the wall, leaving a gap of d[2] at fraction d[1] */
      var ax = s[0], ay = s[1], bx = s[2], by = s[3];
      var len = Math.hypot(bx - ax, by - ay);
      var t0 = Math.max(0, d[1] - d[2] / 2 / len), t1 = Math.min(1, d[1] + d[2] / 2 / len);
      W.push([ax, ay, ax + (bx - ax) * t0, ay + (by - ay) * t0]);
      W.push([ax + (bx - ax) * t1, ay + (by - ay) * t1, bx, by]);
    });
  }
  room(0, 0, 18, 9);                                   // the outer shell
  room(0, 0, 6, 4.2, [[1, 0.55, 1.3]]);                // lab
  room(0, 4.8, 6, 4.2, [[1, 0.45, 1.3]]);              // workshop
  room(12, 0, 6, 4.2, [[3, 0.5, 1.3]]);                // office
  room(12, 4.8, 6, 4.2, [[3, 0.5, 1.3]]);              // store
  W.push([7.5, 2.6, 10.5, 2.6]);                       // a bench in the corridor
  W.push([7.5, 6.4, 10.5, 6.4]);

  /* ── the grid ──────────────────────────────────────────────────────── */
  var RES = 0.08, GW = Math.ceil(18 / RES) + 2, GH = Math.ceil(9 / RES) + 2;
  var logodds = new Float32Array(GW * GH);
  var L_OCC = 0.85, L_FREE = -0.42, L_MIN = -4.0, L_MAX = 4.0;

  var BEAMS = 240, RANGE = 12.0, FOV = Math.PI * 2;

  /* ── state ─────────────────────────────────────────────────────────── */
  var S = {
    x: 9.0, y: 1.3, th: 0,          // true pose
    ex: 9.0, ey: 1.3, eth: 0,       // estimated pose (what the map is built on)
    v: 0, w: 0, keys: {},
    trail: [], truth: [],
    scan: new Float32Array(BEAMS),
    matched: 0, drift: 0, cells: 0, frames: 0, on: true
  };

  /* ── raycasting ────────────────────────────────────────────────────── */
  function cast(px, py, ang) {
    var dx = Math.cos(ang), dy = Math.sin(ang), best = RANGE;
    for (var i = 0; i < W.length; i++) {
      var s = W[i];
      var ax = s[0], ay = s[1], bx = s[2] - ax, by = s[3] - ay;
      var den = dx * by - dy * bx;
      if (Math.abs(den) < 1e-12) continue;
      var t = ((s[0] - px) * by - (s[1] - py) * bx) / den;      // along the ray
      var u = ((s[0] - px) * dy - (s[1] - py) * dx) / den;      // along the wall
      if (t > 0.02 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  }
  function scan(px, py, pth, out) {
    for (var i = 0; i < BEAMS; i++) {
      out[i] = cast(px, py, pth + (i / BEAMS) * FOV);
    }
    return out;
  }

  /* ── the map ───────────────────────────────────────────────────────── */
  var gi = function (cx, cy) { return cy * GW + cx; };
  function integrate(px, py, pth, rs) {
    var hit = 0;
    for (var i = 0; i < BEAMS; i++) {
      var r = rs[i], a = pth + (i / BEAMS) * FOV;
      var free = Math.min(r, RANGE) - RES;
      /* walk the free space, then mark the endpoint */
      var steps = Math.max(1, Math.floor(free / RES));
      for (var k = 0; k < steps; k++) {
        var d = k * RES;
        var cx = Math.round((px + Math.cos(a) * d) / RES);
        var cy = Math.round((py + Math.sin(a) * d) / RES);
        if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) break;
        var j = gi(cx, cy);
        logodds[j] = Math.max(L_MIN, logodds[j] + L_FREE);
      }
      if (r < RANGE - 1e-3) {
        var hx = Math.round((px + Math.cos(a) * r) / RES);
        var hy = Math.round((py + Math.sin(a) * r) / RES);
        if (hx >= 0 && hy >= 0 && hx < GW && hy < GH) {
          var m = gi(hx, hy);
          logodds[m] = Math.min(L_MAX, logodds[m] + L_OCC);
          hit++;
        }
      }
    }
    return hit;
  }

  /* ── scan matching ─────────────────────────────────────────────────────
     A small exhaustive search over (dx, dy, dth) scoring the scan endpoints
     against the map built so far — the correlative matcher slam_toolbox uses,
     at one resolution and a tiny window, which is all this needs to stop
     odometry drift from smearing the walls. */
  function score(px, py, pth, rs) {
    var s = 0;
    for (var i = 0; i < BEAMS; i += 3) {
      var r = rs[i];
      if (r >= RANGE - 1e-3) continue;
      var a = pth + (i / BEAMS) * FOV;
      var cx = Math.round((px + Math.cos(a) * r) / RES);
      var cy = Math.round((py + Math.sin(a) * r) / RES);
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue;
      s += logodds[gi(cx, cy)];
    }
    return s;
  }
  function match(px, py, pth, rs) {
    var best = score(px, py, pth, rs), bx = 0, by = 0, bt = 0;
    var STEP = RES, ASTEP = 0.012;
    for (var i = -1; i <= 1; i++) {
      for (var j = -1; j <= 1; j++) {
        for (var k = -1; k <= 1; k++) {
          if (!i && !j && !k) continue;
          var s = score(px + i * STEP, py + j * STEP, pth + k * ASTEP, rs);
          if (s > best) { best = s; bx = i * STEP; by = j * STEP; bt = k * ASTEP; }
        }
      }
    }
    return [bx, by, bt];
  }

  /* ── the page ──────────────────────────────────────────────────────── */
  host.innerHTML =
    '<div class="sl-head">' +
      '<span class="sl-kick">Live · runs in this page</span>' +
      '<h3 class="sl-title">Drive it. Watch the map appear.</h3>' +
      '<p class="sl-say">A simulated 240-beam scan, a log-odds occupancy grid ' +
        'and a correlative scan matcher — the same three pieces slam_toolbox ' +
        'runs on the robot. The floor plan is hidden from you <em>and</em> from ' +
        'the mapper: everything you see is inferred from ranges.</p>' +
    '</div>' +
    '<div class="sl-stage">' +
      '<canvas class="sl-canvas" width="1080" height="560"></canvas>' +
      '<div class="sl-keys" aria-hidden="true">' +
        '<span class="sl-k" data-k="ArrowUp">↑</span>' +
        '<span class="sl-k" data-k="ArrowLeft">←</span>' +
        '<span class="sl-k" data-k="ArrowDown">↓</span>' +
        '<span class="sl-k" data-k="ArrowRight">→</span>' +
        '<i>drive · ← → turn · W/S also</i>' +
      '</div>' +
      '<div class="sl-hud">' +
        '<span><b class="sl-cov">0</b>% mapped</span>' +
        '<span><b class="sl-drift">0.0</b> cm drift</span>' +
        '<span><b class="sl-hz">0</b> Hz</span>' +
      '</div>' +
    '</div>' +
    '<div class="sl-bar">' +
      '<button type="button" class="sl-btn sl-reset">Clear the map</button>' +
      '<label class="sl-tog"><input type="checkbox" class="sl-match" checked> ' +
        'scan matching</label>' +
      '<span class="sl-note">Turn it off and drive a lap: odometry alone ' +
        'shears the walls. That is what the matcher is for.</span>' +
    '</div>';

  var cv = host.querySelector('.sl-canvas'), ctx = cv.getContext('2d');
  var elCov = host.querySelector('.sl-cov'), elDrift = host.querySelector('.sl-drift'),
      elHz = host.querySelector('.sl-hz'), cbMatch = host.querySelector('.sl-match');

  host.querySelector('.sl-reset').addEventListener('click', function () {
    logodds.fill(0); S.trail.length = 0; S.truth.length = 0;
    S.ex = S.x; S.ey = S.y; S.eth = S.th;
  });

  var KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
               w: 1, s: 1, W: 1, S: 1 };
  function key(e, down) {
    if (!KEYS[e.key]) return;
    var r = host.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;      // not on screen
    S.keys[e.key] = down;
    e.preventDefault();
    host.querySelectorAll('[data-k]').forEach(function (n) {
      n.classList.toggle('on', !!S.keys[n.dataset.k]);
    });
  }
  addEventListener('keydown', function (e) { key(e, true); }, { passive: false });
  addEventListener('keyup', function (e) { key(e, false); }, { passive: false });

  /* ── the loop ──────────────────────────────────────────────────────── */
  var last = 0, fps = 0, acc = 0, nf = 0;
  function tick(t) {
    requestAnimationFrame(tick);
    var dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    var r = host.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) return;   // off screen

    var K = S.keys;
    var drive = (K.ArrowUp ? 1 : 0) - (K.ArrowDown ? 1 : 0);
    var turn = (K.ArrowLeft ? 1 : 0) - (K.ArrowRight ? 1 : 0)
             + (K.w || K.W ? 1 : 0) - (K.s || K.S ? 1 : 0);
    S.v += (drive * 1.15 - S.v) * Math.min(1, dt * 6);
    S.w += (turn * 1.5 - S.w) * Math.min(1, dt * 8);

    /* true motion, and the ODOMETRY the robot thinks it made — the same
       command with a systematic scale error and a little noise, which is what
       wheel odometry on a real base gives you */
    var ds = S.v * dt, dth = S.w * dt;
    var nx = S.x + Math.cos(S.th + dth / 2) * ds;
    var ny = S.y + Math.sin(S.th + dth / 2) * ds;
    if (cast(S.x, S.y, Math.atan2(ny - S.y, nx - S.x)) > 0.34 || ds === 0) {
      S.x = nx; S.y = ny;
    }
    S.th += dth;
    var odoS = ds * 1.035 + (Math.random() - 0.5) * Math.abs(ds) * 0.06;
    var odoT = dth * 1.03 + (Math.random() - 0.5) * Math.abs(dth) * 0.08;
    S.ex += Math.cos(S.eth + odoT / 2) * odoS;
    S.ey += Math.sin(S.eth + odoT / 2) * odoS;
    S.eth += odoT;

    scan(S.x, S.y, S.th, S.scan);
    if (cbMatch.checked && (S.frames & 1) === 0) {
      var c = match(S.ex, S.ey, S.eth, S.scan);
      S.ex += c[0]; S.ey += c[1]; S.eth += c[2];
    }
    if ((S.frames & 1) === 0) integrate(S.ex, S.ey, S.eth, S.scan);
    S.frames++;

    if (S.frames % 4 === 0) {
      S.trail.push([S.ex, S.ey]); S.truth.push([S.x, S.y]);
      if (S.trail.length > 900) { S.trail.shift(); S.truth.shift(); }
    }
    S.drift = Math.hypot(S.ex - S.x, S.ey - S.y);

    draw();
    acc += dt; nf++;
    if (acc > 0.5) { fps = nf / acc; acc = 0; nf = 0; update(); }
  }

  function update() {
    var known = 0;
    for (var i = 0; i < logodds.length; i++) if (Math.abs(logodds[i]) > 0.6) known++;
    elCov.textContent = Math.round(100 * known / logodds.length);
    elDrift.textContent = (S.drift * 100).toFixed(1);
    elHz.textContent = Math.round(fps);
  }

  /* ── drawing ───────────────────────────────────────────────────────── */
  var img = ctx.createImageData(GW, GH);
  var buf = document.createElement('canvas');
  buf.width = GW; buf.height = GH;
  var bctx = buf.getContext('2d');

  function draw() {
    var w = cv.width, h = cv.height;
    ctx.fillStyle = '#0B0E15'; ctx.fillRect(0, 0, w, h);
    var sc = Math.min(w / 18.4, h / 9.4), ox = (w - 18 * sc) / 2, oy = (h - 9 * sc) / 2;

    /* the grid, as an image */
    var d = img.data;
    for (var i = 0, p = 0; i < logodds.length; i++, p += 4) {
      var v = logodds[i];
      if (v > 0.6) { d[p] = 21; d[p + 1] = 24; d[p + 2] = 32; d[p + 3] = 255; }
      else if (v < -0.6) { d[p] = 244; d[p + 1] = 234; d[p + 2] = 210; d[p + 3] = 235; }
      else { d[p + 3] = 0; }
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, ox, oy, 18 * sc, 9 * sc);
    ctx.imageSmoothingEnabled = true;

    var X = function (x) { return ox + x * sc; }, Y = function (y) { return oy + y * sc; };

    /* the live scan, from the ESTIMATED pose — this is what the mapper sees */
    ctx.strokeStyle = 'rgba(255,206,10,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var b = 0; b < BEAMS; b += 3) {
      var a = S.eth + (b / BEAMS) * FOV, r = S.scan[b];
      ctx.moveTo(X(S.ex), Y(S.ey));
      ctx.lineTo(X(S.ex + Math.cos(a) * r), Y(S.ey + Math.sin(a) * r));
    }
    ctx.stroke();

    /* the path it thinks it took, and the one it did */
    var line = function (pts, col, wd) {
      if (pts.length < 2) return;
      ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
      ctx.stroke();
    };
    line(S.truth, 'rgba(46,125,79,0.55)', 2);
    line(S.trail, '#E4442A', 2);

    /* the robot */
    ctx.fillStyle = '#E4442A'; ctx.strokeStyle = '#FFF9F0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(S.ex), Y(S.ey), 7, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#FFCE0A'; ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(X(S.ex), Y(S.ey));
    ctx.lineTo(X(S.ex + Math.cos(S.eth) * 0.55), Y(S.ey + Math.sin(S.eth) * 0.55));
    ctx.stroke();
  }

  requestAnimationFrame(tick);

  window.__slamLab = {
    state: S, walls: W,
    coverage: function () {
      var k = 0;
      for (var i = 0; i < logodds.length; i++) if (Math.abs(logodds[i]) > 0.6) k++;
      return k / logodds.length;
    },
    drive: function (keys, secs) {          // for the checks
      Object.keys(keys).forEach(function (k) { S.keys[k] = keys[k]; });
      return new Promise(function (r) {
        setTimeout(function () { S.keys = {}; r(true); }, secs * 1000);
      });
    },
    drift: function () { return S.drift; },
    reset: function () { logodds.fill(0); S.trail.length = 0; S.truth.length = 0; }
  };
})();
