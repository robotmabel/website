/* The tip-over lab — set a speed, raise the lift, watch it stop.
 *
 * Not an animation: the numbers below are the SAME constants the robot runs
 * (controller/mabel/motion_model/tip_over.py), and the widget integrates the
 * same law. Turn the envelope off and the robot really does go over.
 *
 *   com_height(z) = COM_Z0 + COM_DZDLIFT · z
 *   a_max(z)      = g · ℓ_fwd / (SF · com_height(z))        [tip-safe decel]
 *   v_max(z)      = clamp(a_max(z) · STOP_TIME, V_FLOOR, V_CEIL)
 *
 * With the envelope ON the commanded speed is trimmed to v_max and braking is
 * capped at a_max, so the body barely leans. With it OFF the stop is a hard
 * one and the tilt runs past the tipping angle — which is the whole point.
 */
(function () {
  'use strict';
  var host = document.getElementById('tipLab');
  if (!host) return;

  /* ── constants, straight from tip_over.py ─────────────────────────── */
  var G = 9.81,
      COM_Z0 = 0.369, COM_DZDLIFT = 0.451,
      LEVER_FWD = 0.078,          // m, CoM → front edge
      SF_FWD = 2.0,               // forward safety factor
      STOP_TIME_FWD = 0.80,       // s
      V_FLOOR = 0.15, V_CEIL = 0.8,
      LIFT_MAX = 0.635;

  function comHeight(z) { return COM_Z0 + COM_DZDLIFT * z; }
  function aMax(z) { return G * LEVER_FWD / (SF_FWD * comHeight(z)); }
  function vMax(z) { return Math.min(Math.max(aMax(z) * STOP_TIME_FWD, V_FLOOR), V_CEIL); }
  /* the angle at which the CoM passes over the front edge */
  function tipAngle(z) { return Math.atan2(LEVER_FWD, comHeight(z)) * 180 / Math.PI; }

  /* ── state ────────────────────────────────────────────────────────── */
  var S = {
    cmd: 0.6,        // commanded speed (m/s)
    lift: 0.30,      // lift height (m)
    safe: true,
    v: 0,            // actual speed
    tilt: 0,         // body tilt (deg, + = pitching forward)
    tiltRate: 0,
    x: 0,            // world scroll
    braking: false,
    tipped: false,
    fx: null, fxT: 0
  };

  host.innerHTML =
    '<div class="tl-stage">' +
      '<canvas class="tl-canvas"></canvas>' +
      '<div class="tl-hud">' +
        '<span class="tl-read"><b class="tl-v">0.00</b> m/s</span>' +
        '<span class="tl-read"><b class="tl-tilt">0.0</b>° tilt</span>' +
        '<span class="tl-read tl-cap"></span>' +
      '</div>' +
      '<span class="tl-fx" aria-hidden="true"></span>' +
    '</div>' +
    '<div class="tl-panel">' +
      '<div class="tl-row">' +
        '<label>Commanded speed<b class="tl-cmd">0.60 m/s</b></label>' +
        '<input class="tl-slider" type="range" min="0" max="1.4" step="0.02" value="0.6" ' +
               'aria-label="Commanded speed">' +
      '</div>' +
      '<div class="tl-row">' +
        '<label>Lift height<b class="tl-lift">0.30 m</b></label>' +
        '<input class="tl-slider tl-liftslider" type="range" min="0" max="0.635" step="0.005" ' +
               'value="0.30" aria-label="Lift height">' +
      '</div>' +
      '<div class="tl-row tl-btns">' +
        '<button class="tl-toggle on" type="button">Motion model: <b>ON</b></button>' +
        '<button class="tl-stop" type="button">Slam the brakes</button>' +
      '</div>' +
      '<p class="tl-note"></p>' +
    '</div>';

  var cv = host.querySelector('.tl-canvas'),
      ctx = cv.getContext('2d'),
      elV = host.querySelector('.tl-v'),
      elTilt = host.querySelector('.tl-tilt'),
      elCap = host.querySelector('.tl-cap'),
      elCmd = host.querySelector('.tl-cmd'),
      elLift = host.querySelector('.tl-lift'),
      elNote = host.querySelector('.tl-note'),
      elFx = host.querySelector('.tl-fx'),
      sCmd = host.querySelector('.tl-slider'),
      sLift = host.querySelector('.tl-liftslider'),
      bTog = host.querySelector('.tl-toggle'),
      bStop = host.querySelector('.tl-stop');

  function note() {
    var vm = vMax(S.lift), am = aMax(S.lift);
    elNote.innerHTML = S.safe
      ? 'At this lift the envelope allows <b>' + vm.toFixed(2) + ' m/s</b> and brakes at ' +
        '<b>' + am.toFixed(2) + ' m/s²</b> — a stop takes ' + STOP_TIME_FWD.toFixed(2) + ' s. ' +
        'Raise the lift: the CoM climbs to ' + comHeight(S.lift).toFixed(2) + ' m and both shrink.'
      : 'Envelope off. Nothing trims the command and the brakes are unlimited — ' +
        'past <b>' + tipAngle(S.lift).toFixed(1) + '°</b> of pitch the CoM leaves the front edge ' +
        'and it goes over.';
  }

  sCmd.addEventListener('input', function () {
    S.cmd = parseFloat(sCmd.value);
    elCmd.textContent = S.cmd.toFixed(2) + ' m/s';
    if (S.tipped) { S.tipped = false; S.tilt = 0; S.tiltRate = 0; }
  });
  sLift.addEventListener('input', function () {
    S.lift = parseFloat(sLift.value);
    elLift.textContent = S.lift.toFixed(2) + ' m';
    S.tipped = false; note();
  });
  bTog.addEventListener('click', function () {
    S.safe = !S.safe;
    bTog.classList.toggle('on', S.safe);
    bTog.innerHTML = 'Motion model: <b>' + (S.safe ? 'ON' : 'OFF') + '</b>';
    S.tipped = false; S.tilt = 0; S.tiltRate = 0;
    note();
  });
  bStop.addEventListener('click', function () {
    /* A sustained stop, not a 1.2 s pulse: the command itself goes to zero so
       the deceleration is applied for the whole stop and the resulting lean is
       actually observable (a brief pulse released before the body finished
       leaning, which made the envelope-off case look survivable). */
    S.cmd = 0; sCmd.value = 0; elCmd.textContent = '0.00 m/s';
    S.braking = false;
    popFx(S.safe ? 'SKRRT!' : 'WHOA!', S.safe ? '' : 'bad');
  });

  function popFx(word, cls) { S.fx = word; S.fxT = 1; elFx.className = 'tl-fx show ' + (cls || ''); elFx.textContent = word; }

  /* ── the city that scrolls past ───────────────────────────────────── */
  var SKY = [];
  (function seedCity() {
    var x = 0;
    while (x < 3000) {
      var w = 46 + Math.random() * 66, h = 70 + Math.random() * 190;
      SKY.push({ x: x, w: w, h: h, step: Math.random() > 0.55 });
      x += w + 12 + Math.random() * 26;
    }
  })();

  function resize() {
    var r = host.querySelector('.tl-stage').getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  function drawCity(W, H, ground) {
    /* two parallax bands of art-deco setback towers */
    [[0.35, '#2A2E3A', 0.55], [1.0, '#151820', 1]].forEach(function (band, bi) {
      var off = (S.x * band[0] * 120) % 3000;
      ctx.fillStyle = band[1];
      SKY.forEach(function (b) {
        var bx = b.x - off;
        if (bx < -140 || bx > W + 140) return;
        var scale = bi === 0 ? 0.7 : 1;
        var h = b.h * scale, w = b.w * scale;
        ctx.fillRect(bx, ground - h, w, h);
        if (b.step) {                       // the deco setback
          ctx.fillRect(bx + w * 0.18, ground - h - h * 0.16, w * 0.64, h * 0.16);
          ctx.fillRect(bx + w * 0.42, ground - h - h * 0.28, w * 0.16, h * 0.13);
        }
        if (bi === 1) {                     // lit windows
          ctx.fillStyle = 'rgba(242,201,76,0.5)';
          for (var wy = ground - h + 12; wy < ground - 14; wy += 17) {
            for (var wx = bx + 7; wx < bx + w - 9; wx += 14) {
              if (((wx + wy) | 0) % 3) ctx.fillRect(wx, wy, 5, 8);
            }
          }
          ctx.fillStyle = band[1];
        }
      });
    });
  }

  /* ── the robot, as an 80s-arcade sprite ──────────────────────────────
     Proportions come from the URDF, not from imagination: a 0.49 m base on
     three swerve wheels (two visible from the side), a narrow cascaded lift
     column, a boxy torso, and the head's two big camera eyes between a pair
     of antennas. Drawn as chunky pixels so it reads as a game sprite while
     still being recognisably MABEL. */
  var PAL = {
    W: '#EFE8D8',   // printed shell
    S: '#C9C2B0',   // structural grey
    D: '#151820',   // ink
    C: '#8E8778',   // column
    O: '#F0762E',   // accent
    L: '#23577E',   // lens
    K: '#0B0E15'    // tyre
  };
  var HEAD = [
    '..D..........D..',
    '..D..........D..',
    '..O..........O..',
    '...DDDDDDDDDD...',
    '..DWWWWWWWWWWD..',
    '.DWWLLWWWWLLWWD.',
    '.DWLLLWWWWLLLWD.',
    '.DWWLLWWWWLLWWD.',
    '..DWWWWWWWWWWD..',
    '...DDDDDDDDDD...'
  ];
  var TORSO = [
    '....DDDDDD....',
    '..DDWWWWWWDD..',
    '.DWWWWWWWWWWD.',
    'DWWWWWWWWWWWWD',
    'DWWWWWWWWWWWWD',
    'DWWWWWWWWWWWWD',
    'DWWWWWWWWWWWWD',
    '.DWWWWWWWWWWD.',
    '..DDDDDDDDDD..'
  ];
  var BASE = [
    '..DDDDDDDDDDDDDDDD..',
    '.DSSSSSSSSSSSSSSSSD.',
    'DSSSSSSSSSSSSSSSSSSD',
    'DSSSSSSSSSSSSSSSSSSD',
    'DSSSSSSSSSSSSSSSSSSD',
    '.DDDDDDDDDDDDDDDDDD.',
    '.KKK..........KKK...',
    'KKKKK........KKKKK..',
    'KKOKK........KKOKK..',
    'KKKKK........KKKKK..',
    '.KKK..........KKK...'
  ];

  function sprite(map, cx, baseY, s) {
    var w = map[0].length;
    for (var r = 0; r < map.length; r++) {
      var row = map[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = PAL[ch] || PAL.D;
        ctx.fillRect(Math.round(cx - (w / 2) * s + c * s),
                     Math.round(baseY - (map.length - r) * s), s + 0.6, s + 0.6);
      }
    }
  }

  function drawRobot(cx, ground, tilt, lift) {
    var s = Math.max(3, Math.round(Math.min(cv.clientWidth, cv.clientHeight) / 60));
    var col = tilt * Math.PI / 180;
    ctx.save();
    ctx.translate(cx, ground);
    ctx.rotate(col);                       /* pitch about the wheel contact */
    ctx.imageSmoothingEnabled = false;

    var baseTop = -BASE.length * s;
    sprite(BASE, 0, 0, s);

    /* the cascaded column: taller with the lift command */
    var colPx = Math.round((10 + lift * 150) / s) * s;
    ctx.fillStyle = PAL.D;
    ctx.fillRect(Math.round(-2.5 * s), baseTop - colPx, 5 * s, colPx);
    ctx.fillStyle = PAL.C;
    ctx.fillRect(Math.round(-1.5 * s), baseTop - colPx + s, 3 * s, colPx - s);
    for (var y = baseTop - colPx + 3 * s; y < baseTop - s; y += 4 * s) {
      ctx.fillStyle = PAL.D;
      ctx.fillRect(Math.round(-1.5 * s), Math.round(y), 3 * s, s);
    }

    var torsoBase = baseTop - colPx;
    sprite(TORSO, 0, torsoBase, s);
    var headBase = torsoBase - TORSO.length * s - s;

    /* arms hang from the shoulders and swing with the pitch */
    ctx.fillStyle = PAL.D;
    var sh = torsoBase - (TORSO.length - 2) * s;
    [-1, 1].forEach(function (side) {
      var ax = side * 7 * s, sway = Math.round(tilt * 0.25 / s) * s;
      ctx.fillRect(Math.round(ax - s), Math.round(sh), 2 * s, 4 * s);
      ctx.fillRect(Math.round(ax - s + sway), Math.round(sh + 4 * s), 2 * s, 4 * s);
      ctx.fillStyle = PAL.W;
      ctx.fillRect(Math.round(ax - s + sway), Math.round(sh + 8 * s), 2 * s, 2 * s);
      ctx.fillStyle = PAL.D;
    });

    sprite(HEAD, 0, headBase, s);

    /* the CoM and its lever — what the model is actually about */
    var comY = -(comHeight(lift) * 150);
    ctx.fillStyle = '#C6301A';
    ctx.fillRect(Math.round(-s), Math.round(comY - s), 2 * s, 2 * s);
    ctx.strokeStyle = 'rgba(198,48,26,0.5)'; ctx.lineWidth = 2;
    ctx.setLineDash([s, s]);
    ctx.beginPath(); ctx.moveTo(0, comY); ctx.lineTo(0, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ── the integrator, as a pure step so it can be tested without frames ──
     Called once per animation frame in the page; called in a tight loop by
     scripts/labtest.mjs to check the envelope actually prevents the tip. */
  function step(S, dt) {
    var target = S.braking ? 0 : S.cmd;
    var vm = vMax(S.lift), am = aMax(S.lift);
    if (S.safe) target = Math.min(target, vm);          // nu_b^safe = s . nu_b
    var accelCap = S.safe ? am : 6.0;                   // envelope off => brutal
    var want = (target - S.v) / dt;                     // the acceleration asked for
    var a = Math.max(-accelCap, Math.min(accelCap, want));
    S.v += a * dt;
    if (Math.abs(S.v) < 1e-4) S.v = 0;

    if (!S.tipped) {
      /* quasi-static pitch for this acceleration, scaled by how tall the CoM is */
      var lean = -Math.atan2(a, G) * 180 / Math.PI * (comHeight(S.lift) / 0.4);
      S.tiltRate += (lean - S.tilt) * 26 * dt - S.tiltRate * 6.5 * dt;
      S.tilt += S.tiltRate * dt;
      if (S.tilt > tipAngle(S.lift)) { S.tipped = true; S.justTipped = true; }
    } else {
      S.tiltRate += 240 * dt;                           // free fall about the edge
      S.tilt = Math.min(90, S.tilt + S.tiltRate * dt);
      S.v *= 0.9;
    }
    S.x += S.v * dt;
    return S;
  }
  if (typeof window !== 'undefined') { window.__tipStep = step; }

  var last = 0;
  function frame(t) {
    var dt = Math.min((t - last) / 1000, 0.05); last = t;
    var W = cv.clientWidth, H = cv.clientHeight, ground = H - 46;
    step(S, dt);
    if (S.justTipped) { S.justTipped = false; popFx('WHOOMP!', 'bad'); }

    /* ── paint ───────────────────────────────────────────────────── */
    ctx.clearRect(0, 0, W, H);
    var sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#F6E9C9'); sky.addColorStop(1, '#EBD9AE');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, ground);
    drawCity(W, H, ground);

    /* road + speed dashes that stream past at the real speed */
    ctx.fillStyle = '#151820'; ctx.fillRect(0, ground, W, H - ground);
    ctx.fillStyle = '#F2C94C';
    var dashOff = (S.x * 120) % 60;
    for (var dx = -dashOff; dx < W; dx += 60) ctx.fillRect(dx, ground + 20, 32, 4);

    /* motion streaks behind the robot, length ∝ speed */
    var cx = W * 0.42;
    if (S.v > 0.05) {
      ctx.strokeStyle = 'rgba(240,118,46,0.75)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (var i = 0; i < 5; i++) {
        var len = 20 + S.v * 90 + i * 6;
        var yy = ground - 40 - i * 22;
        ctx.beginPath(); ctx.moveTo(cx - 70 - len, yy); ctx.lineTo(cx - 70, yy); ctx.stroke();
      }
    }
    drawRobot(cx, ground, S.tilt, S.lift);

    /* readouts — vm is local to step(), so recompute it for the display
       (referencing it here threw a ReferenceError that killed the rAF loop
       after the very first frame, which is why nothing ever moved) */
    var vm = vMax(S.lift);
    elV.textContent = S.v.toFixed(2);
    elTilt.textContent = S.tilt.toFixed(1);
    var trimmed = S.safe && S.cmd > vm;
    elCap.innerHTML = S.safe
      ? (trimmed ? '<i class="tl-trim">trimmed to ' + vm.toFixed(2) + '</i>'
                 : 'within envelope')
      : '<i class="tl-off">no envelope</i>';
    if (S.fxT > 0) { S.fxT -= dt; if (S.fxT <= 0) elFx.className = 'tl-fx'; }

    requestAnimationFrame(frame);
  }

  window.__tipLab = S;   /* test hook */
  resize(); note();
  elCmd.textContent = S.cmd.toFixed(2) + ' m/s';
  elLift.textContent = S.lift.toFixed(2) + ' m';
  requestAnimationFrame(function (t) { last = t; frame(t); });
})();
