/* Reach — drive MABEL from anywhere on Earth.
 *
 * Pick an operator city; the robot stays in New York. The globe spins the
 * pair into view, draws the great-circle the packets take, and adds up the
 * budget honestly:
 *
 *   round trip = 2 · (great-circle distance / c_fibre)   [c_fibre ≈ 2/3 c]
 *              + relay hops
 *   glass-to-glass = round trip + the measured on-robot pipeline
 *
 * The on-robot numbers are the paper's measured ones (49 ms on the host,
 * 82 ms on a LAN, 362 ms through the public relay); everything added on top
 * is physics plus a stated per-hop allowance, not a guess about the internet
 * being kind.
 */
(function () {
  'use strict';
  var host = document.getElementById('reachGlobe');
  if (!host) return;

  var C_FIBRE = 199861.639;   // km/s — light in fibre, 2/3 c
  var HOP_MS = 12;            // per relay hop, stated not measured
  var PIPELINE = { host: 49, lan: 82, relay: 362 };

  /* lat, lon, label */
  var ROBOT = { name: 'New York', lat: 40.71, lon: -74.01, tag: 'MABEL' };
  var CITIES = [
    { name: 'Shanghai',  lat: 31.23,  lon: 121.47, hops: 4 },
    { name: 'London',    lat: 51.51,  lon: -0.13,  hops: 2 },
    { name: 'Tokyo',     lat: 35.68,  lon: 139.69, hops: 3 },
    { name: 'Toronto',   lat: 43.65,  lon: -79.38, hops: 1 },
    { name: 'São Paulo', lat: -23.55, lon: -46.63, hops: 3 },
    { name: 'Sydney',    lat: -33.87, lon: 151.21, hops: 4 },
    { name: 'Nairobi',   lat: -1.29,  lon: 36.82,  hops: 3 },
    { name: 'Bengaluru', lat: 12.97,  lon: 77.59,  hops: 4 }
  ];

  function toRad(d) { return d * Math.PI / 180; }
  function greatCircleKm(a, b) {
    var p1 = toRad(a.lat), p2 = toRad(b.lat);
    var dp = toRad(b.lat - a.lat), dl = toRad(b.lon - a.lon);
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  var S = { idx: 0, spin: 0, target: 0, t0: performance.now(),
            tilt: 12,            // degrees, camera latitude
            auto: true,          // idle rotation
            drag: null };        // {x, y, spin, tilt} while the pointer is down

  host.innerHTML =
    '<div class="rg-stage"><canvas class="rg-canvas"></canvas>' +
      '<span class="rg-fx" aria-hidden="true"></span>' + '<span class="rg-hint">Drag to spin</span></div>' +
    '<div class="rg-panel">' +
      '<span class="rg-eyebrow">Operator</span>' +
      '<div class="rg-cities"></div>' +
      '<div class="rg-budget"></div>' +
      '<p class="rg-note"></p>' +
    '</div>';

  var cv = host.querySelector('.rg-canvas'), ctx = cv.getContext('2d');
  var elCities = host.querySelector('.rg-cities');
  var elBudget = host.querySelector('.rg-budget');
  var elNote = host.querySelector('.rg-note');
  var elFx = host.querySelector('.rg-fx');

  CITIES.forEach(function (c, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = c.name;
    b.className = i === 0 ? 'on' : '';
    b.addEventListener('click', function () {
      S.idx = i;
      elCities.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      S.auto = false;
      S.target = -c.lon;
      setTimeout(function () { if (!S.drag) S.auto = true; }, 4000);
      update();
      elFx.textContent = 'PING!'; elFx.className = 'rg-fx show';
      setTimeout(function () { elFx.className = 'rg-fx'; }, 900);
    });
    elCities.appendChild(b);
  });

  function budget(c) {
    var km = greatCircleKm(ROBOT, c);
    var oneWay = km / C_FIBRE * 1000;             // ms
    var rtt = 2 * oneWay + c.hops * HOP_MS;
    return { km: km, oneWay: oneWay, rtt: rtt, glass: rtt + PIPELINE.relay };
  }

  function update() {
    var c = CITIES[S.idx], b = budget(c);
    elBudget.innerHTML =
      '<div><b>' + Math.round(b.km).toLocaleString() + '</b><span>km great circle</span></div>' +
      '<div><b>' + b.rtt.toFixed(0) + ' ms</b><span>network round trip</span></div>' +
      '<div><b>' + PIPELINE.relay + ' ms</b><span>on-robot pipeline</span></div>' +
      '<div class="hi"><b>' + b.glass.toFixed(0) + ' ms</b><span>glass to glass</span></div>';
    elNote.innerHTML =
      'Light in fibre covers ' + Math.round(b.km).toLocaleString() + ' km in ' +
      b.oneWay.toFixed(0) + ' ms each way; ' + c.hops + ' relay hops add ' +
      (c.hops * HOP_MS) + ' ms. The rest is the measured pipeline — the same ' +
      '<b>' + PIPELINE.relay + ' ms</b> the paper reports through the public relay ' +
      '(<b>' + PIPELINE.host + ' ms</b> on the robot\'s own host, <b>' + PIPELINE.lan +
      ' ms</b> on a LAN). One wire protocol, so the operator changes and nothing else does.';
  }

  function resize() {
    var r = host.querySelector('.rg-stage').getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  /* The stage grows after fonts and layout settle, and a one-shot resize left
     the canvas at its old size — so the globe drew centred on a box that no
     longer existed and sat up in the corner. */
  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(host.querySelector('.rg-stage'));
  }

  /* orthographic projection of a lat/lon onto the visible hemisphere */
  function project(lat, lon, spin, cx, cy, R) {
    var p = toRad(lat), l = toRad(lon + spin), t = toRad(S.tilt);
    var x = Math.cos(p) * Math.sin(l);
    var y = Math.sin(p);
    var z = Math.cos(p) * Math.cos(l);
    /* tilt the camera about the equator so the reader can look over the pole */
    var y2 = y * Math.cos(t) - z * Math.sin(t);
    var z2 = y * Math.sin(t) + z * Math.cos(t);
    return { x: cx + x * R, y: cy - y2 * R, z: z2 };
  }


  /* Coarse continent outlines, [lat, lon] pairs. Deliberately low-resolution
     — this is a comic-book globe at ~300 px, not a map. Enough that the
     viewer can find New York and Shanghai at a glance. */
  var LAND = [
    /* North America */
    [[71,-156],[70,-141],[69,-131],[68,-110],[67,-95],[64,-78],[60,-64],[52,-56],
     [47,-53],[45,-60],[42,-70],[38,-75],[33,-79],[26,-80],[25,-97],[20,-97],
     [16,-95],[15,-88],[9,-79],[8,-77],[13,-87],[19,-105],[23,-110],[30,-115],
     [34,-120],[40,-124],[48,-125],[55,-131],[59,-140],[60,-148],[57,-158],
     [59,-162],[65,-167],[68,-166],[71,-156]],
    /* South America */
    [[12,-72],[11,-63],[6,-58],[0,-50],[-5,-35],[-13,-38],[-23,-41],[-30,-50],
     [-35,-54],[-40,-62],[-47,-66],[-53,-68],[-55,-67],[-50,-74],[-42,-73],
     [-33,-71],[-23,-70],[-18,-70],[-12,-77],[-5,-81],[0,-80],[6,-77],[12,-72]],
    /* Africa + Europe (one landmass at this resolution) */
    [[37,-6],[35,-2],[33,10],[37,11],[33,22],[31,32],[30,34],[36,36],[41,29],
     [41,41],[43,40],[45,37],[46,31],[45,29],[44,28],[42,26],[41,23],[40,20],
     [42,19],[45,14],[44,12],[41,16],[38,16],[40,18],[38,21],[36,23],[40,26],
     [41,29],[45,30],[48,30],[52,30],[55,28],[59,28],[60,25],[63,21],[66,24],
     [69,21],[71,26],[68,15],[64,11],[59,5],[57,8],[54,9],[53,4],[51,2],[49,0],
     [48,-4],[43,-2],[43,-9],[39,-9],[37,-8],[36,-6],[37,-6]],
    [[37,10],[33,11],[32,15],[31,25],[22,37],[15,40],[12,43],[11,51],[2,46],
     [-5,39],[-15,40],[-26,33],[-34,26],[-34,18],[-29,17],[-23,14],[-17,12],
     [-9,13],[-1,9],[4,9],[4,3],[6,-2],[5,-8],[10,-16],[15,-17],[21,-17],
     [28,-13],[31,-9],[35,-6],[37,-2],[37,10]],
    /* Asia */
    [[45,37],[48,40],[52,52],[55,60],[58,68],[62,72],[66,70],[69,73],[72,80],
     [73,90],[72,100],[71,110],[73,120],[71,130],[69,140],[66,170],[62,179],
     [60,163],[54,160],[52,157],[46,143],[43,135],[39,128],[35,126],[31,122],
     [24,118],[21,110],[17,108],[10,105],[8,100],[13,98],[16,95],[21,90],
     [22,88],[20,85],[16,81],[8,78],[15,73],[21,70],[24,67],[25,60],[27,57],
     [25,52],[29,48],[30,48],[37,49],[40,50],[42,48],[45,37]],
    /* Australia */
    [[-11,131],[-12,137],[-15,141],[-11,143],[-16,146],[-21,149],[-27,153],
     [-34,151],[-38,146],[-38,141],[-35,137],[-32,134],[-34,124],[-35,118],
     [-32,116],[-26,113],[-22,114],[-18,122],[-14,127],[-11,131]],
    /* Greenland */
    [[83,-32],[80,-20],[76,-20],[70,-22],[66,-34],[60,-43],[65,-52],[70,-54],
     [76,-60],[80,-60],[82,-45],[83,-32]]
  ];

  function drawLand(cx, cy, R, spin) {
    ctx.fillStyle = '#C9BE9A';
    ctx.strokeStyle = 'rgba(21,24,32,0.55)';
    ctx.lineWidth = 1.5;
    LAND.forEach(function (poly) {
      var run = [];
      poly.forEach(function (pt) {
        var p = project(pt[0], pt[1], spin, cx, cy, R);
        if (p.z < 0) { flush(); return; }
        run.push(p);
      });
      flush();
      function flush() {
        if (run.length > 2) {
          ctx.beginPath();
          ctx.moveTo(run[0].x, run[0].y);
          for (var i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        run = [];
      }
    });
  }

  function drawGraticule(cx, cy, R, spin) {
    ctx.strokeStyle = 'rgba(21,24,32,0.16)'; ctx.lineWidth = 1;
    for (var lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath(); var started = false;
      for (var lon = -180; lon <= 180; lon += 4) {
        var p = project(lat, lon, spin, cx, cy, R);
        if (p.z < 0) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    for (var lon2 = -180; lon2 < 180; lon2 += 30) {
      ctx.beginPath(); var st = false;
      for (var la = -90; la <= 90; la += 4) {
        var q = project(la, lon2, spin, cx, cy, R);
        if (q.z < 0) { st = false; continue; }
        if (!st) { ctx.moveTo(q.x, q.y); st = true; } else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
  }

  function marker(p, color, label, R) {
    if (p.z < 0) return;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.284);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#151820'; ctx.stroke();
    ctx.font = '700 12px "Space Mono", monospace';
    ctx.fillStyle = '#151820';
    var w = ctx.measureText(label).width;
    var lx = p.x + 12, ly = p.y - 10;
    ctx.fillStyle = '#FDF6E2'; ctx.strokeStyle = '#151820'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(lx - 5, ly - 13, w + 10, 19, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#151820'; ctx.fillText(label, lx, ly);
  }

  var last = 0;
  function frame(t) {
    var dt = Math.min((t - last) / 1000, 0.05); last = t;
    var W = cv.clientWidth, H = cv.clientHeight;
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.465;
    if (S.drag) {
      /* the reader is turning it */
    } else if (Math.abs(S.target - S.spin) > 0.4) {
      S.spin += (S.target - S.spin) * Math.min(1, dt * 2.6);   // fly to a city
    } else if (S.auto) {
      S.spin += 5.5 * dt;                                      // idle rotation
      S.target = S.spin;
    }

    ctx.clearRect(0, 0, W, H);
    /* the globe */
    var g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#DCE7EC'); g.addColorStop(1, '#A8C4D2');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.284);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#151820'; ctx.stroke();
    drawLand(cx, cy, R, S.spin);
    drawGraticule(cx, cy, R, S.spin);

    /* the link */
    var c = CITIES[S.idx];
    var pts = [];
    for (var i = 0; i <= 64; i++) {
      var f = i / 64;
      /* spherical interpolation along the great circle */
      var a = { lat: ROBOT.lat, lon: ROBOT.lon }, b = { lat: c.lat, lon: c.lon };
      var p1 = toRad(a.lat), l1 = toRad(a.lon), p2 = toRad(b.lat), l2 = toRad(b.lon);
      var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((p1 - p2) / 2), 2) +
              Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l1 - l2) / 2), 2)));
      var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
      var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
      var z = A * Math.sin(p1) + B * Math.sin(p2);
      pts.push(project(Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI,
                       Math.atan2(y, x) * 180 / Math.PI, S.spin, cx, cy, R));
    }
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#C6301A'; ctx.setLineDash([7, 6]);
    ctx.beginPath(); var on = false;
    pts.forEach(function (p) {
      if (p.z < -0.02) { on = false; return; }
      if (!on) { ctx.moveTo(p.x, p.y); on = true; } else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke(); ctx.setLineDash([]);

    /* the packet, running the route on a loop */
    var b2 = budget(c);
    var period = Math.max(0.9, b2.glass / 260);
    var f2 = ((t - S.t0) / 1000 % period) / period;
    var pk = pts[Math.floor(f2 * (pts.length - 1))];
    if (pk && pk.z >= -0.02) {
      ctx.beginPath(); ctx.arc(pk.x, pk.y, 5.5, 0, 6.284);
      ctx.fillStyle = '#F2C94C'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#151820'; ctx.stroke();
    }

    marker(project(ROBOT.lat, ROBOT.lon, S.spin, cx, cy, R), '#F0762E', 'MABEL · NYC', R);
    marker(project(c.lat, c.lon, S.spin, cx, cy, R), '#23577E', 'YOU · ' + c.name, R);

    requestAnimationFrame(frame);
  }

  /* expose the budget maths for testing without frames */
  window.__reachBudget = function (name) {
    var c = CITIES.filter(function (x) { return x.name === name; })[0];
    return c ? budget(c) : null;
  };

  /* ── drag to rotate ─────────────────────────────────────────────────── */
  cv.style.cursor = 'grab';
  cv.addEventListener('pointerdown', function (e) {
    S.drag = { x: e.clientX, y: e.clientY, spin: S.spin, tilt: S.tilt };
    S.auto = false;
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', function (e) {
    if (!S.drag) return;
    S.spin = S.drag.spin + (e.clientX - S.drag.x) * 0.42;
    /* drag down → look down on the globe (tilt follows the pointer, it was
       inverted before) */
    S.tilt = Math.max(-70, Math.min(70, S.drag.tilt + (e.clientY - S.drag.y) * 0.3));
    S.target = S.spin;
  });
  function endDrag() {
    if (!S.drag) return;
    S.drag = null;
    cv.style.cursor = 'grab';
    /* resume the idle rotation after a beat, so the globe never looks dead */
    setTimeout(function () { if (!S.drag) S.auto = true; }, 2500);
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', endDrag);

  resize(); update();
  requestAnimationFrame(function (t) { last = t; S.t0 = t; frame(t); });
})();
