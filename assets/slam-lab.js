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
 * Controls match the robot's own motion model. The base is a THREE-MODULE
 * SWERVE and it is holonomic — it can translate in any direction without
 * turning first — so the arrow keys translate (↑↓ forward and back, ←→
 * STRAFE) and W/S rotate. Mapping the arrows to "drive and turn" would have
 * been a differential base, which MABEL is not.
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
  /* Box–Muller, so the noise is Gaussian rather than the flat rand() that a
     first cut reaches for — a uniform error has no tails, and the tails are
     what a scan matcher is actually there to catch. */
  var spare = null;
  function gauss() {
    if (spare !== null) { var v = spare; spare = null; return v; }
    var u, v2, s2;
    do { u = Math.random() * 2 - 1; v2 = Math.random() * 2 - 1;
         s2 = u * u + v2 * v2; } while (!s2 || s2 >= 1);
    var m = Math.sqrt(-2 * Math.log(s2) / s2);
    spare = v2 * m;
    return u * m;
  }

  var S = {
    x: 9.0, y: 1.3, th: 0,          // true pose
    ex: 9.0, ey: 1.3, eth: 0,       // estimated pose (what the map is built on)
    vx: 0, vy: 0, w: 0, keys: {},
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
  /* RANGE NOISE AND DROPOUTS. A noiseless scan makes the whole problem
     trivial and the map comes out looking like a CAD trace, which teaches the
     wrong thing. sigma = 1.5 cm is about what an RPLiDAR gives at these
     ranges; roughly one beam in 300 returns nothing at all. */
  var SIGMA = 0.015, DROP = 0.0035;
  function scan(px, py, pth, out) {
    for (var i = 0; i < BEAMS; i++) {
      var r = cast(px, py, pth + (i / BEAMS) * FOV);
      if (r < RANGE - 1e-3) {
        r = Math.random() < DROP ? RANGE : Math.max(0.05, r + gauss() * SIGMA);
      }
      out[i] = r;
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
        'runs on the robot. <b>Left is the room as it really is</b> — the robot ' +
        'never sees that. <b>Right is everything it has:</b> a grid it inferred ' +
        'from noisy ranges and a pose it estimated. Compare them.</p>' +
    '</div>' +
    '<div class="sl-stage">' +
      '<canvas class="sl-canvas" width="1240" height="430"></canvas>' +
      '<div class="sl-keys" aria-hidden="true">' +
        '<span class="sl-k" data-k="ArrowUp">↑</span>' +
        '<span class="sl-k" data-k="ArrowLeft">←</span>' +
        '<span class="sl-k" data-k="ArrowDown">↓</span>' +
        '<span class="sl-k" data-k="ArrowRight">→</span>' +
        '<span class="sl-k sl-k-w" data-k="w">W</span>' +
        '<span class="sl-k sl-k-w" data-k="s">S</span>' +
        '<i>arrows translate — the base is holonomic · W/S rotate</i>' +
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
      var k = n.dataset.k;
      n.classList.toggle('on', !!(S.keys[k] || S.keys[k.toUpperCase()]));
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
    /* HOLONOMIC, because the base is. Forward/back on ↑↓, STRAFE on ←→,
       rotate on W/S — three independent velocities, which is exactly what a
       three-module swerve gives you and what the wire protocol carries. */
    var fwd = (K.ArrowUp ? 1 : 0) - (K.ArrowDown ? 1 : 0);
    var lat = (K.ArrowLeft ? 1 : 0) - (K.ArrowRight ? 1 : 0);
    var turn = (K.w || K.W ? 1 : 0) - (K.s || K.S ? 1 : 0);
    S.vx += (fwd * 1.15 - S.vx) * Math.min(1, dt * 6);
    S.vy += (lat * 1.0 - S.vy) * Math.min(1, dt * 6);
    S.w += (turn * 1.6 - S.w) * Math.min(1, dt * 8);

    /* body-frame velocity into the world */
    var dth = S.w * dt;
    var c = Math.cos(S.th + dth / 2), sn = Math.sin(S.th + dth / 2);
    var dxb = S.vx * dt, dyb = S.vy * dt;
    var nx = S.x + c * dxb - sn * dyb;
    var ny = S.y + sn * dxb + c * dyb;
    var step = Math.hypot(nx - S.x, ny - S.y);
    if (step < 1e-6 || cast(S.x, S.y, Math.atan2(ny - S.y, nx - S.x)) > 0.34) {
      S.x = nx; S.y = ny;
    }
    S.th += dth;

    /* THE ODOMETRY THE ROBOT THINKS IT MADE. A systematic scale error plus
       per-step noise, which is what wheel odometry on a real base gives you —
       and on a swerve the lateral channel is the worse of the two, because a
       strafing module scrubs. This is the error the scan matcher has to undo;
       without it the demonstration has nothing to demonstrate. */
    var oX = dxb * 1.04 + gauss() * Math.abs(dxb) * 0.10 + gauss() * 0.0008;
    var oY = dyb * 1.07 + gauss() * Math.abs(dyb) * 0.16 + gauss() * 0.0008;
    var oT = dth * 1.03 + gauss() * Math.abs(dth) * 0.09 + gauss() * 0.0006;
    var ec = Math.cos(S.eth + oT / 2), es = Math.sin(S.eth + oT / 2);
    S.ex += ec * oX - es * oY;
    S.ey += es * oX + ec * oY;
    S.eth += oT;

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

  /* ── drawing ───────────────────────────────────────────────────────────
     TWO PANELS, SIDE BY SIDE. Left is the world as it really is — the floor
     plan, the true pose, the beams actually cast. Right is everything the
     robot has: an occupancy grid it inferred and a pose it estimated. Putting
     them next to each other is the entire lesson; a single panel showing only
     the map cannot tell you whether the map is any good, and a single panel
     showing only the truth is not SLAM at all. */
  var img = ctx.createImageData(GW, GH);
  var buf = document.createElement('canvas');
  buf.width = GW; buf.height = GH;
  var bctx = buf.getContext('2d');

  function draw() {
    var w = cv.width, h = cv.height;
    ctx.fillStyle = '#0B0E15'; ctx.fillRect(0, 0, w, h);

    var GAP = 14, PW = (w - GAP * 3) / 2, PH = h - 44;
    var sc = Math.min(PW / 18.6, PH / 9.6);
    var pw = 18 * sc, ph = 9 * sc;
    var L = { ox: GAP + (PW - pw) / 2, oy: 34 + (PH - ph) / 2 };
    var R = { ox: GAP * 2 + PW + (PW - pw) / 2, oy: 34 + (PH - ph) / 2 };

    function label(p, t, sub) {
      /* measure the TITLE in the title's own font. Measuring it after the
         switch measured the subtitle font instead and the two overlapped. */
      ctx.textAlign = 'left';
      ctx.font = '600 12px Jost, system-ui, sans-serif';
      var tw = ctx.measureText(t).width;
      ctx.fillStyle = '#FFF9F0';
      ctx.fillText(t, p.ox, 22);
      ctx.font = '10px "Space Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,249,240,0.42)';
      ctx.fillText(sub, p.ox + tw + 12, 22);
    }
    var X = function (p, x) { return p.ox + x * sc; };
    var Y = function (p, y) { return p.oy + y * sc; };

    /* ── left: the world, top down ─────────────────────────────────── */
    label(L, 'THE ROOM', 'ground truth · the robot never sees this');
    ctx.fillStyle = 'rgba(244,234,210,0.06)';
    ctx.fillRect(L.ox, L.oy, pw, ph);
    ctx.strokeStyle = '#F4EAD2'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (var i = 0; i < W.length; i++) {
      ctx.moveTo(X(L, W[i][0]), Y(L, W[i][1]));
      ctx.lineTo(X(L, W[i][2]), Y(L, W[i][3]));
    }
    ctx.stroke();

    /* the beams actually cast, from the TRUE pose */
    ctx.strokeStyle = 'rgba(255,206,10,0.16)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var b2 = 0; b2 < BEAMS; b2 += 4) {
      var a2 = S.th + (b2 / BEAMS) * FOV, r2 = S.scan[b2];
      ctx.moveTo(X(L, S.x), Y(L, S.y));
      ctx.lineTo(X(L, S.x + Math.cos(a2) * r2), Y(L, S.y + Math.sin(a2) * r2));
    }
    ctx.stroke();

    var trace = function (p, pts, col, wd) {
      if (pts.length < 2) return;
      ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.beginPath();
      ctx.moveTo(X(p, pts[0][0]), Y(p, pts[0][1]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(X(p, pts[i][0]), Y(p, pts[i][1]));
      ctx.stroke();
    };
    trace(L, S.truth, 'rgba(46,125,79,0.75)', 2);

    var robot = function (p, x, y, th, col) {
      ctx.fillStyle = col; ctx.strokeStyle = '#FFF9F0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p, x), Y(p, y), 6.5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#FFCE0A'; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(X(p, x), Y(p, y));
      ctx.lineTo(X(p, x + Math.cos(th) * 0.5), Y(p, y + Math.sin(th) * 0.5));
      ctx.stroke();
    };
    robot(L, S.x, S.y, S.th, '#2E7D4F');

    /* ── right: the map it built ───────────────────────────────────── */
    label(R, 'THE MAP IT BUILT', 'log-odds occupancy · from ranges alone');
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(R.ox, R.oy, pw, ph);
    var d = img.data;
    for (var k = 0, p4 = 0; k < logodds.length; k++, p4 += 4) {
      var v = logodds[k];
      if (v > 0.6) { d[p4] = 244; d[p4 + 1] = 234; d[p4 + 2] = 210; d[p4 + 3] = 255; }
      else if (v < -0.6) { d[p4] = 90; d[p4 + 1] = 96; d[p4 + 2] = 112; d[p4 + 3] = 150; }
      else { d[p4 + 3] = 0; }
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, R.ox, R.oy, pw, ph);
    ctx.imageSmoothingEnabled = true;
    trace(R, S.trail, '#E4442A', 2);
    robot(R, S.ex, S.ey, S.eth, '#E4442A');

    /* the frames, so the two panels read as a pair */
    ctx.strokeStyle = 'rgba(255,249,240,0.22)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(L.ox, L.oy, pw, ph);
    ctx.strokeRect(R.ox, R.oy, pw, ph);
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
