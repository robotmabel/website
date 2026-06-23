/* ═══════════════════════════════════════════════════════════════════
   MABEL — navigation SLAM visualizations (2-D canvas, no deps)

   Three things, all grounded in the real mabel_slam stack:
   1. #slamCanvas  — a switchable, animated top-down "map forming" view of the
      TWO SLAM backends MABEL actually ships:
        • lidar  → slam_toolbox: a 360° scan sweeps an L-shaped room, builds a
                   5 cm occupancy grid, drops a pose-graph node every 0.2 m, and
                   snaps a loop closure when the trajectory returns.
        • visual → cuVSLAM + nvblox: a stereo frustum tracks features and
                   integrates an nvblox voxel mesh along the surfaces it sees.
   2. #driftCanvas — the measured localization OUTPUT: ground truth vs raw swerve
      wheel odometry (drifts ~3×, ATE 0.67 m) vs fused cuVSLAM (1.10× scale,
      ATE 0.21 m, 3.4° heading). Numbers from controller/experiments + ekf.yaml.

   Respects prefers-reduced-motion (renders a settled final frame, no loop) and
   pauses when scrolled off-screen.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // palette (mirrors mabel.css)
  var C = {
    rust: '#c25b2a', bone: '#f4f1ea', ink: '#161412',
    ash: 'rgba(242,238,230,0.42)', grid: 'rgba(242,238,230,0.05)',
    wall: 'rgba(242,238,230,0.92)', scan: '#e08a4f',
    feat: '#7fd1c4', green: '#43c463', blue: '#6aa6ff'
  };

  // ── canvas DPR setup, returns {ctx,w,h} kept fresh on resize ──
  function fit(canvas) {
    var ctx = canvas.getContext('2d');
    var st = { ctx: ctx, w: 0, h: 0 };
    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      st.w = r.width; st.h = r.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    return st;
  }

  // run an rAF loop that auto-pauses off-screen / reduced-motion
  function loop(canvas, step) {
    var live = true, raf = 0;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (e) {
        live = e[0].isIntersecting;
        if (live && !REDUCE && !raf) tick(performance.now());
      }, { threshold: 0.05 }).observe(canvas);
    }
    var last = 0;
    function tick(t) {
      raf = 0;
      var dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016; last = t;
      step(dt);
      if (live && !REDUCE) raf = requestAnimationFrame(tick);
    }
    if (REDUCE) { for (var i = 0; i < 240; i++) step(0.016); step(0); }  // settle, draw once
    else raf = requestAnimationFrame(tick);
  }

  // ── geometry: segment intersection for ray casting ──
  function rayHit(ox, oy, dx, dy, segs) {
    var best = Infinity, hx = 0, hy = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], x3 = s[0], y3 = s[1], x4 = s[2], y4 = s[3];
      var den = dx * (y3 - y4) - dy * (x3 - x4);
      if (Math.abs(den) < 1e-9) continue;
      var t = ((x3 - ox) * (y3 - y4) - (y3 - oy) * (x3 - x4)) / den;
      var u = ((x3 - ox) * dy - (y3 - oy) * dx) / den;
      if (t > 0.001 && u >= 0 && u <= 1 && t < best) { best = t; hx = ox + dx * t; hy = oy + dy * t; }
    }
    return best < Infinity ? [hx, hy, best] : null;
  }

  function poly(pts) { // closed polygon → segment list
    var s = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s.push([a[0], a[1], b[0], b[1]]);
    }
    return s;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // path position + heading at param p∈[0,1) along a closed waypoint loop
  function onPath(path, p) {
    var n = path.length, f = p * n, i = Math.floor(f), t = f - i;
    var a = path[i % n], b = path[(i + 1) % n];
    return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t),
             h: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }

  /* ═══════════ 1. DUAL-SLAM "map forming" canvas ═══════════ */
  function initSlam() {
    var canvas = document.getElementById('slamCanvas');
    if (!canvas) return;
    var st = fit(canvas);

    // L-shaped room (normalized 0..1) + a pillar obstacle
    var outer = [[0.08, 0.14], [0.93, 0.14], [0.93, 0.60], [0.60, 0.60], [0.60, 0.90], [0.08, 0.90]];
    var pillar = [[0.30, 0.36], [0.45, 0.36], [0.45, 0.52], [0.30, 0.52]];
    var segs = poly(outer).concat(poly(pillar));
    var path = [[0.20, 0.24], [0.82, 0.24], [0.82, 0.50], [0.52, 0.52], [0.50, 0.80], [0.20, 0.80]];

    var mode = 'lidar';
    var p = 0;                 // progress along loop
    var nodes = [];            // pose-graph nodes (lidar)
    var walls = [];            // discovered wall points (lidar map)
    var feats = [];            // tracked features (visual)
    var voxels = [];           // nvblox voxels (visual)
    var lastNode = null, closed = 0, sweep = 0;

    var outEls = {
      a: canvas.parentNode.querySelector('[data-slam="a"]'),
      b: canvas.parentNode.querySelector('[data-slam="b"]')
    };

    function reset() { p = 0; nodes = []; walls = []; feats = []; voxels = []; lastNode = null; closed = 0; }

    function map(x, y, w, h) { // normalized → screen, with padding
      var pad = 14, sx = w - pad * 2, sy = h - pad * 2;
      return [pad + x * sx, pad + y * sy];
    }

    var tagEl = canvas.parentNode.querySelector('.slam-tag');
    function applyMode(m) {
      mode = m; reset();
      document.querySelectorAll('[data-slam-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-slam-mode') === m); });
      document.querySelectorAll('.slam-pane').forEach(function (pane) { pane.classList.toggle('on', pane.getAttribute('data-pane') === m); });
      if (tagEl) tagEl.textContent = m === 'lidar' ? 'slam_toolbox · 2D occupancy' : 'cuVSLAM + nvblox · 3D';
    }
    document.querySelectorAll('[data-slam-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { applyMode(btn.getAttribute('data-slam-mode')); });
    });
    applyMode('lidar');

    loop(canvas, function (dt) {
      var ctx = st.ctx, w = st.w, h = st.h;
      if (!w) return;
      p = (p + dt * 0.07);
      if (p >= 1) { p -= 1; closed = 1.0; nodes = []; walls = []; feats = []; voxels = []; lastNode = null; }
      sweep += dt * 3.0;
      closed = Math.max(0, closed - dt * 0.6);

      var pose = onPath(path, p);
      var rs = map(pose.x, pose.y, w, h);

      // accumulate
      var RAYS = mode === 'lidar' ? 96 : 30;
      var span = mode === 'lidar' ? Math.PI * 2 : 1.05; // visual: ~60° frustum
      for (var i = 0; i < RAYS; i++) {
        var a = mode === 'lidar' ? (i / RAYS) * Math.PI * 2 : pose.h - span / 2 + (i / (RAYS - 1)) * span;
        var hit = rayHit(pose.x, pose.y, Math.cos(a), Math.sin(a), segs);
        if (!hit) continue;
        if (mode === 'lidar') {
          if (Math.random() < 0.5) walls.push([hit[0], hit[1]]);
        } else {
          if (Math.random() < 0.30) feats.push([hit[0], hit[1], hit[2]]);
          if (Math.random() < 0.55) voxels.push([hit[0], hit[1], hit[2]]);
        }
      }
      if (walls.length > 1400) walls.splice(0, walls.length - 1400);
      if (feats.length > 520) feats.splice(0, feats.length - 520);
      if (voxels.length > 1600) voxels.splice(0, voxels.length - 1600);

      // pose-graph node every ~0.2 m of travel (lidar)
      if (mode === 'lidar') {
        if (!lastNode || Math.hypot(pose.x - lastNode[0], pose.y - lastNode[1]) > 0.09) {
          nodes.push([pose.x, pose.y]); lastNode = [pose.x, pose.y];
        }
      }

      // ── draw ──
      ctx.clearRect(0, 0, w, h);
      // faint grid
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 22) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 22) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

      if (mode === 'lidar') {
        // occupancy walls
        ctx.fillStyle = C.wall;
        for (var k = 0; k < walls.length; k++) { var m = map(walls[k][0], walls[k][1], w, h); ctx.fillRect(m[0] - 1.1, m[1] - 1.1, 2.2, 2.2); }
        // pose-graph
        ctx.strokeStyle = 'rgba(194,91,42,0.55)'; ctx.lineWidth = 1.4; ctx.beginPath();
        for (var n = 0; n < nodes.length; n++) { var nm = map(nodes[n][0], nodes[n][1], w, h); if (n === 0) ctx.moveTo(nm[0], nm[1]); else ctx.lineTo(nm[0], nm[1]); }
        ctx.stroke();
        ctx.fillStyle = C.rust;
        for (var n2 = 0; n2 < nodes.length; n2++) { var nm2 = map(nodes[n2][0], nodes[n2][1], w, h); ctx.beginPath(); ctx.arc(nm2[0], nm2[1], 2.4, 0, 6.28); ctx.fill(); }
        // live scan (rotating wedge)
        for (var r = 0; r < 96; r++) {
          var sa = (r / 96) * Math.PI * 2;
          var wedge = ((sa - sweep) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if (wedge > 0.9) continue;
          var hh = rayHit(pose.x, pose.y, Math.cos(sa), Math.sin(sa), segs); if (!hh) continue;
          var mp = map(hh[0], hh[1], w, h);
          ctx.strokeStyle = 'rgba(224,138,79,' + (0.5 - wedge * 0.5).toFixed(2) + ')'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(rs[0], rs[1]); ctx.lineTo(mp[0], mp[1]); ctx.stroke();
          ctx.fillStyle = C.scan; ctx.fillRect(mp[0] - 1.4, mp[1] - 1.4, 2.8, 2.8);
        }
        // loop-closure flash
        if (closed > 0 && nodes.length > 4) {
          var s0 = map(nodes[0][0], nodes[0][1], w, h), s1 = map(nodes[nodes.length - 1][0], nodes[nodes.length - 1][1], w, h);
          ctx.strokeStyle = 'rgba(67,196,99,' + closed.toFixed(2) + ')'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke(); ctx.setLineDash([]);
        }
        if (outEls.a) outEls.a.textContent = walls.length + ' cells';
        if (outEls.b) outEls.b.textContent = nodes.length + ' nodes';
      } else {
        // nvblox voxels, colored by depth
        for (var v = 0; v < voxels.length; v++) {
          var vm = map(voxels[v][0], voxels[v][1], w, h), d = Math.min(voxels[v][2] / 0.7, 1);
          ctx.fillStyle = 'hsla(' + (200 - d * 150) + ',70%,60%,0.85)';
          ctx.fillRect(vm[0] - 2, vm[1] - 2, 4, 4);
        }
        // tracked features
        ctx.fillStyle = C.feat;
        for (var f = 0; f < feats.length; f++) { var fm = map(feats[f][0], feats[f][1], w, h); ctx.fillRect(fm[0] - 0.8, fm[1] - 0.8, 1.6, 1.6); }
        // frustum
        var fl = pose.h - span / 2, fr = pose.h + span / 2;
        var pL = rayHit(pose.x, pose.y, Math.cos(fl), Math.sin(fl), segs) || [pose.x + Math.cos(fl) * 0.4, pose.y + Math.sin(fl) * 0.4];
        var pR = rayHit(pose.x, pose.y, Math.cos(fr), Math.sin(fr), segs) || [pose.x + Math.cos(fr) * 0.4, pose.y + Math.sin(fr) * 0.4];
        var mL = map(pL[0], pL[1], w, h), mR = map(pR[0], pR[1], w, h);
        ctx.fillStyle = 'rgba(127,209,196,0.08)'; ctx.beginPath(); ctx.moveTo(rs[0], rs[1]); ctx.lineTo(mL[0], mL[1]); ctx.lineTo(mR[0], mR[1]); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(127,209,196,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        if (outEls.a) outEls.a.textContent = feats.length + ' features';
        if (outEls.b) outEls.b.textContent = voxels.length + ' voxels';
      }

      // robot
      ctx.fillStyle = C.bone; ctx.beginPath(); ctx.arc(rs[0], rs[1], 5, 0, 6.28); ctx.fill();
      ctx.fillStyle = C.rust; ctx.beginPath(); ctx.arc(rs[0], rs[1], 2.4, 0, 6.28); ctx.fill();
      ctx.strokeStyle = C.bone; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(rs[0], rs[1]); ctx.lineTo(rs[0] + Math.cos(pose.h) * 11, rs[1] + Math.sin(pose.h) * 11); ctx.stroke();
    });
  }

  /* ═══════════ 2. localization DRIFT canvas (the measured output) ═══════════ */
  function initDrift() {
    var canvas = document.getElementById('driftCanvas');
    if (!canvas) return;
    var st = fit(canvas);
    var p = 0;
    var root = canvas.closest('.drift-wrap') || document;
    var out = {};
    ['ate_w', 'ate_v', 'scale_w', 'scale_v', 'head'].forEach(function (k) { out[k] = root.querySelector('[data-loc="' + k + '"]'); });

    // ground-truth loop = rounded rect (param 0..1)
    function gt(t) {
      var cx = 0.5, cy = 0.5, rx = 0.32, ry = 0.26;
      var a = t * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    }
    // wheel odometry: accumulating scale (→3×) + heading drift (schematic; numbers at right are measured)
    function wheel(t) {
      var g = gt(t), cx = 0.5, cy = 0.5;
      var sc = 1 + t * 0.55, th = t * 0.5;           // grows outward + rotates
      var dx = (g[0] - cx) * sc, dy = (g[1] - cy) * sc;
      return [cx + dx * Math.cos(th) - dy * Math.sin(th), cy + dx * Math.sin(th) + dy * Math.cos(th)];
    }
    // cuVSLAM: tracks GT tightly (1.10× scale, small wobble)
    function vis(t) {
      var g = gt(t), cx = 0.5, cy = 0.5;
      return [cx + (g[0] - cx) * 1.04 + Math.sin(t * 38) * 0.004, cy + (g[1] - cy) * 1.04 + Math.cos(t * 33) * 0.004];
    }

    function map(pt, w, h) { var pad = 16; return [pad + pt[0] * (w - pad * 2), pad + pt[1] * (h - pad * 2)]; }
    function trace(ctx, fn, w, h, col, dash, prog) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.setLineDash(dash);
      ctx.beginPath();
      for (var t = 0; t <= prog; t += 0.004) { var m = map(fn(t), w, h); if (t === 0) ctx.moveTo(m[0], m[1]); else ctx.lineTo(m[0], m[1]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    function dot(ctx, pt, w, h, col) { var m = map(pt, w, h); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(m[0], m[1], 4, 0, 6.28); ctx.fill(); }

    loop(canvas, function (dt) {
      var ctx = st.ctx, w = st.w, h = st.h; if (!w) return;
      p += dt * 0.11; if (p >= 1.18) p = 0;
      var prog = Math.min(p, 1);
      ctx.clearRect(0, 0, w, h);
      // grid
      ctx.strokeStyle = 'rgba(22,20,18,0.05)'; ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 26) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (var gy = 0; gy < h; gy += 26) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

      trace(ctx, wheel, w, h, 'rgba(194,91,42,0.85)', [], prog);             // wheels (rust)
      trace(ctx, vis, w, h, 'rgba(46,148,87,0.95)', [], prog);               // cuVSLAM (green)
      trace(ctx, gt, w, h, 'rgba(22,20,18,0.40)', [5, 5], 1);                // ground truth (dashed, full)
      if (prog < 1) { dot(ctx, wheel(prog), w, h, C.rust); dot(ctx, vis(prog), w, h, '#2e9457'); dot(ctx, gt(prog), w, h, 'rgba(22,20,18,0.55)'); }

      // count-up readouts → settle on measured values
      var e = prog;
      if (out.ate_w) out.ate_w.textContent = (0.67 * e).toFixed(2) + ' m';
      if (out.ate_v) out.ate_v.textContent = (0.21 * e).toFixed(2) + ' m';
      if (out.scale_w) out.scale_w.textContent = (1 + 2.0 * e).toFixed(1) + '×';
      if (out.scale_v) out.scale_v.textContent = (1 + 0.10 * e).toFixed(2) + '×';
      if (out.head) out.head.textContent = (3.4 * e).toFixed(1) + '°';
    });
  }

  function boot() { initSlam(); initDrift(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
