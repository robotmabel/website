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
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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

  /* ── the measured table ───────────────────────────────────────────────
     assets/tipover_table.json is produced by
     controller/experiments/exp_tipover_web.py using the paper's own E2
     harness. Each run is an accel pulse at one (speed, lift) with the
     envelope on or off, sampled at 50 Hz. We bilinearly interpolate the
     nearest four runs over (speed, lift) and play the result back, so the
     tilt on screen is measured rather than modelled here. */
  var TABLE = null;
  fetch('assets/tipover_table.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { TABLE = j; note(); })
    .catch(function () { /* fall back to the local integrator */ });

  function nearest(list, v) {
    var lo = list[0], hi = list[list.length - 1];
    for (var i = 0; i < list.length - 1; i++) {
      if (v >= list[i] && v <= list[i + 1]) { lo = list[i]; hi = list[i + 1]; break; }
    }
    if (v <= list[0]) { lo = hi = list[0]; }
    if (v >= list[list.length - 1]) { lo = hi = list[list.length - 1]; }
    var f = (hi === lo) ? 0 : (v - lo) / (hi - lo);
    return [lo, hi, f];
  }

  function sampleAt(safe, speed, lift, t) {
    if (!TABLE) return null;
    var tag = safe ? 'on' : 'off';
    var S = nearest(TABLE.speeds, speed), L = nearest(TABLE.lifts, lift);
    var idx = Math.round((t + 0.25) / TABLE.dt);
    function grab(sp, lf) {
      var r = TABLE.runs[tag + '|' + sp + '|' + lf];
      if (!r || !r.s.length) return null;
      return r.s[Math.max(0, Math.min(r.s.length - 1, idx))];
    }
    var a = grab(S[0], L[0]), b = grab(S[1], L[0]),
        c = grab(S[0], L[1]), d = grab(S[1], L[1]);
    if (!a) return null;
    b = b || a; c = c || a; d = d || b;
    var mix = function (p, q, f) { return p + (q - p) * f; };
    var v0 = mix(a[1], b[1], S[2]), v1 = mix(c[1], d[1], S[2]);
    var p0 = mix(a[2], b[2], S[2]), p1 = mix(c[2], d[2], S[2]);
    var x0 = mix(a[3], b[3], S[2]), x1 = mix(c[3], d[3], S[2]);
    return { v: Math.abs(mix(v0, v1, L[2])),
             tilt: mix(p0, p1, L[2]),
             travel: mix(x0, x1, L[2]) };
  }

  function peakFor(safe, speed, lift) {
    if (!TABLE) return null;
    var tag = safe ? 'on' : 'off';
    var S = nearest(TABLE.speeds, speed), L = nearest(TABLE.lifts, lift);
    var r = TABLE.runs[tag + '|' + S[0] + '|' + L[0]];
    return r ? r.peak_tilt : null;
  }

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
    fx: null, fxT: 0, play: null
  };

  host.innerHTML =
    '<div class="tl-stage">' +
      '<canvas class="tl-canvas"></canvas>' +
      '<canvas class="tl-rig"></canvas>' +
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
        /* THE CEILING IS DRAWN ON THE SLIDER. The slider runs to 2.5 m/s and
           the envelope at lift 0.30 m allows 0.61 — so pushing past that
           point changes nothing on screen and reads as a broken control
           ("past like 1.5 m/s the background stopped moving faster"). It is
           not broken; it is the demonstration. The marker moves with the lift,
           so lowering the lift visibly buys speed and raising it takes it
           away, which is the whole claim this lab makes. */
        '<div class="tl-track">' +
          '<input class="tl-slider" type="range" min="0" max="2.5" step="0.05" ' +
                 'value="0.6" aria-label="Commanded speed">' +
          '<span class="tl-ceil"><i></i><b></b></span>' +
        '</div>' +
      '</div>' +
      '<div class="tl-row">' +
        '<label>Lift height<b class="tl-lift">0.30 m</b></label>' +
        '<input class="tl-slider tl-liftslider" type="range" min="0" max="0.635" step="0.005" ' +
               'value="0.30" aria-label="Lift height">' +
      '</div>' +
      '<div class="tl-row tl-btns">' +
        '<button class="tl-toggle on" type="button">Motion model: <b>ON</b></button>' +
        '<button class="tl-stop" type="button">Slam the brakes</button>' +
        '<button class="tl-reset" type="button">Reset</button>' +
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
      elCeil = host.querySelector('.tl-ceil'),
      sCmd = host.querySelector('.tl-slider'),
      sLift = host.querySelector('.tl-liftslider'),
      bTog = host.querySelector('.tl-toggle'),
      bStop = host.querySelector('.tl-stop'),
      bReset = host.querySelector('.tl-reset');

  function note() {
    var vm = vMax(S.lift), am = aMax(S.lift);
    var pk = peakFor(S.safe, S.cmd, S.lift);
    var measured = (pk == null) ? '' :
      ' Measured on this exact run: peak tilt <b>' + pk.toFixed(2) + '°</b>.';
    elNote.innerHTML = S.safe
      ? 'At this lift the envelope allows <b>' + vm.toFixed(2) + ' m/s</b> and brakes at ' +
        '<b>' + am.toFixed(2) + ' m/s²</b> — a stop takes ' + STOP_TIME_FWD.toFixed(2) + ' s. ' +
        'Raise the lift: the CoM climbs to ' + comHeight(S.lift).toFixed(2) + ' m and both shrink.' + measured
      : 'Envelope off. Nothing trims the command and the brakes are unlimited — ' +
        'past <b>' + tipAngle(S.lift).toFixed(1) + '°</b> of pitch the CoM leaves the front edge ' +
        'and it goes over.' + measured;
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
    S.tipped = false; S.tilt = 0; S.tiltRate = 0; S.play = null;
    note();
  });
  /* Replay the measured pulse for the current settings. */
  function playPulse() {
    if (!TABLE) { S.cmd = 0; sCmd.value = 0; elCmd.textContent = '0.00 m/s'; return; }
    S.play = { t0: performance.now(), speed: S.cmd, lift: S.lift, safe: S.safe };
    popFx(S.safe ? 'SKRRT!' : 'WHOA!', S.safe ? '' : 'bad');
  }

  bStop.addEventListener('click', function () {
    /* A sustained stop, not a 1.2 s pulse: the command itself goes to zero so
       the deceleration is applied for the whole stop and the resulting lean is
       actually observable (a brief pulse released before the body finished
       leaning, which made the envelope-off case look survivable). */
    playPulse();
  });

  bReset.addEventListener('click', function () {
    /* Once it has gone over there is no way back from the controls alone —
       every slider just re-commands a robot lying on its side. */
    S.v = 0; S.tilt = 0; S.tiltRate = 0; S.tipped = false; S.braking = false;
    S.cmd = 0.6; sCmd.value = 0.6; elCmd.textContent = '0.60 m/s';
    S.lift = 0.30; sLift.value = 0.30; elLift.textContent = '0.30 m';
    S.x = 0;
    note();
    popFx('RESET!', '');
  });

  function popFx(word, cls) { S.fx = word; S.fxT = 1; elFx.className = 'tl-fx show ' + (cls || ''); elFx.textContent = word; }

  /* ── the city that scrolls past ─────────────────────────────────────
     One strip of towers, TILED. The strip has to be drawn at every multiple
     of its own length that lands on screen, not just once: without that, the
     far end of the strip walks off the left edge and nothing follows it, so
     the skyline quietly emptied out after about 20 seconds of driving. */
  var STRIP = 3000;
  /* PARALLAX GAIN. The city scrolls at exactly v x PPM px/s, which is honest
     and reads as almost still: at 0.6 m/s that is 90 px/s across a 1000 px
     stage, so moving the slider barely changes the picture. The gain is a
     CAMERA choice, not a physics one — the robot's speed, its tilt and the CoM
     marker are all unaffected — so the background gets a cinematic multiplier
     and the foreground a much larger one, which is what makes a speed change
     land visually. */
  var BG_GAIN = 2.6;
  var FG_GAIN = 7.5;
  var SKY = [];
  (function seedCity() {
    var x = 0;
    while (x < STRIP) {
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

  /* Street furniture close to the lens. It is the layer that sells speed:
     near objects sweep past far faster than the skyline, and at 2.5 m/s these
     become streaks while the towers merely drift. */
  var FG = [];
  (function seedStreet() {
    var x = 0;
    while (x < STRIP) {
      FG.push({ x: x, h: 54 + Math.random() * 40, lamp: Math.random() > 0.55 });
      x += 150 + Math.random() * 120;
    }
  })();

  function drawStreet(W, H, ground) {
    var off = (S.x * FG_GAIN * PPM) % STRIP;
    if (off < 0) off += STRIP;
    var tiles = Math.ceil((W + 300) / STRIP) + 1;
    /* A LIGHTER ink than the towers. Drawn in the same near-black they are,
       this layer vanished into them and the fastest thing on screen was
       invisible — the whole point is that it reads as separate and close. */
    for (var t = 0; t < tiles; t++) {
      var tx = t * STRIP - off;
      FG.forEach(function (o) {
        var x = o.x + tx;
        if (x < -80 || x > W + 80) return;
        ctx.fillStyle = '#3A4152';
        if (o.lamp) {
          var h = o.h + 60;                 // tall enough to cross the skyline
          ctx.fillRect(x, ground - h, 6, h);
          ctx.fillRect(x - 12, ground - h - 7, 30, 8);
          ctx.fillStyle = 'rgba(255,206,10,0.9)';
          ctx.fillRect(x - 8, ground - h - 2, 22, 5);
        } else {
          ctx.fillRect(x, ground - 30, 11, 30);
          ctx.fillRect(x - 4, ground - 36, 19, 7);
          ctx.fillStyle = '#C6301A';        // a hydrant, so it is legible
          ctx.fillRect(x + 2, ground - 26, 7, 20);
        }
      });
    }
  }

  function drawCity(W, H, ground) {
    /* two parallax bands of art-deco setback towers */
    [[0.35, '#2A2E3A', 0.55], [1.0, '#151820', 1]].forEach(function (band, bi) {
      /* Parallax is a straight linear function of distance travelled, and
         S.x integrates the real speed — so the city sweeps past at exactly
         v·PPM px/s on the near band, and proportionally slower on the far
         one. Faster robot, faster background, with nothing fudged. */
      var off = (S.x * band[0] * BG_GAIN * PPM) % STRIP;
      if (off < 0) off += STRIP;            // driving backwards must tile too
      ctx.fillStyle = band[1];
      var tiles = Math.ceil((W + 280) / STRIP) + 1;
      for (var t = 0; t < tiles; t++) {
        var tx = t * STRIP - off;
        SKY.forEach(function (b) {
          var bx = b.x + tx;
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
      }
    });
  }

  /* ── the real robot, rendered over the comic city ────────────────────
     The city, the road and the lettering stay hand-drawn on the 2-D canvas;
     the robot itself is the actual rig (assets/mabel_rig.glb, generated from
     the MJCF), shown in side view facing the direction of travel. Its lift
     column follows the slider and the whole body pitches about the leading
     wheel, which is the edge the tip-over model is about. */
  var PPM = 150;                      // px per metre, shared with the CoM marker
  var rigCv = host.querySelector('.tl-rig');
  var three = null;                   // {renderer, scene, camera, rig, lift, pivot}

  function initRig() {
    var renderer = new THREE.WebGLRenderer({ canvas: rigCv, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8378, 2.2));
    var key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-3, 5, 4); scene.add(key);

    three = { renderer: renderer, scene: scene, camera: camera,
              rig: null, lift: null, pivot: new THREE.Group(), ready: false };
    scene.add(three.pivot);

    var loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load('assets/mabel_rig.glb', function (g) {
      var rig = g.scene;
      /* Side view with the FRONT facing screen-right, the direction it drives.
         Measured from the rig rather than guessed: the two front swerve
         modules (fl/fr_steer_body) sit at x = +0.062 and the back one at
         x = +0.382, so the robot's forward axis is -X in GLB world. A yaw of
         pi maps -X onto +X = screen right. (-pi/2, which this used to be,
         pointed it into the screen — you saw its back.) */
      rig.rotation.y = Math.PI;
      var box = new THREE.Box3().setFromObject(rig);
      rig.position.y -= box.min.y;                 // stand it on the road
      three.pivot.add(rig);
      three.rig = rig;
      fetch('assets/mabel_joints.json').then(function (r) { return r.json(); })
        .then(function (man) {
          /* The lift is a CASCADED two-stage tendon: `lift_lower` (lift_mid)
             and `lift_upper` (lift_top) each carry HALF the commanded height,
             0-0.3175 m of the 0.635 m stroke. Driving one stage by the whole
             command — which this did — both overshot the top (the body flew
             off the column) and could never reach the bottom. The MJCF bakes
             the geometry at ref = 0.15875 (half travel), so each node's
             displacement is (height/2 - ref). */
          three.lift = man.joints
            .filter(function (x) { return /^lift_(lower|upper)$/.test(x.name); })
            .map(function (j) {
              var n = rig.getObjectByName(j.node);
              return n ? { node: n, axis: new THREE.Vector3().fromArray(j.axis),
                           rest: n.position.clone(), ref: j.ref || 0,
                           lo: j.lower, hi: j.upper } : null;
            }).filter(Boolean);
          three.ready = true;
        });
    }, undefined, function (e) { console.error('[tipover-lab] rig failed', e); });
  }

  function drawRobot(cx, ground, tilt, lift) {
    if (!three || !three.ready) return;
    var W = rigCv.clientWidth, H = rigCv.clientHeight;
    /* an orthographic camera scaled so 1 world metre == PPM screen pixels */
    var halfW = W / (2 * PPM), halfH = H / (2 * PPM);
    var c = three.camera;
    c.left = -halfW; c.right = halfW; c.top = halfH; c.bottom = -halfH;
    /* put the robot where the 2-D drawing would have put it */
    var camX = (W / 2 - cx) / PPM;
    var groundY = (H - ground) / PPM;
    c.position.set(camX, halfH - groundY, 6);
    c.lookAt(camX, halfH - groundY, 0);
    c.updateProjectionMatrix();

    /* the lift column follows the command — half the height per stage,
       clamped to the joint's own range so it cannot leave the rails */
    if (three.lift) {
      three.lift.forEach(function (st) {
        var d = Math.max(st.lo, Math.min(st.hi, lift / 2 - st.ref));
        st.node.position.copy(st.rest).addScaledVector(st.axis, d);
      });
    }
    /* pitch about the leading wheel's contact patch */
    three.pivot.position.set(0.18, 0, 0);
    three.pivot.rotation.z = -tilt * Math.PI / 180;
    if (three.rig) three.rig.position.x = -0.18;

    three.renderer.setSize(W, H, false);
    three.renderer.render(three.scene, three.camera);

    /* the centre of mass and its lever stay on the 2-D layer, in ink */
    var comY = -comHeight(lift) * PPM;
    ctx.save();
    ctx.translate(cx, ground);
    ctx.rotate(tilt * Math.PI / 180);
    ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(198,48,26,0.55)';
    ctx.beginPath(); ctx.moveTo(0, comY); ctx.lineTo(0, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(0, comY, 6, 0, 6.284);
    ctx.fillStyle = '#C6301A'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#151820'; ctx.stroke();
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
    if (S.play) {
      var el = (t - S.play.t0) / 1000;
      var smp = sampleAt(S.play.safe, S.play.speed, S.play.lift, el);
      if (smp && el < 2.6) {
        S.v = smp.v; S.tilt = smp.tilt; S.x += smp.v * dt;
      } else {
        S.play = null; S.v = 0; S.cmd = 0;
        sCmd.value = 0; elCmd.textContent = '0.00 m/s';
      }
    } else {
      step(S, dt);
      if (S.justTipped) { S.justTipped = false; popFx('WHOOMP!', 'bad'); }
    }

    /* ── paint ───────────────────────────────────────────────────── */
    ctx.clearRect(0, 0, W, H);
    var sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#F6E9C9'); sky.addColorStop(1, '#EBD9AE');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, ground);
    drawCity(W, H, ground);
    drawStreet(W, H, ground);         // the fast layer, over the towers

    /* road + speed dashes that stream past at the real speed */
    ctx.fillStyle = '#151820'; ctx.fillRect(0, ground, W, H - ground);
    ctx.fillStyle = '#F2C94C';
    /* the dashes carry the speed too, so raise their gain with the scenery —
       at 60 px apart and v x PPM they crawl at walking pace */
    var dashOff = (S.x * FG_GAIN * PPM) % 60;
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
    /* the ceiling marker, in slider coordinates */
    if (elCeil) {
      var frac = Math.max(0, Math.min(1, vm / 2.5));
      elCeil.style.left = (frac * 100) + '%';
      elCeil.hidden = !S.safe;
      elCeil.classList.toggle('hit', trimmed);
      elCeil.querySelector('b').textContent = S.safe
        ? (trimmed ? 'envelope ceiling ' + vm.toFixed(2) + ' — asking for more '
                     + 'changes nothing'
                   : 'ceiling ' + vm.toFixed(2))
        : '';
    }
    if (S.fxT > 0) { S.fxT -= dt; if (S.fxT <= 0) elFx.className = 'tl-fx'; }

    requestAnimationFrame(frame);
  }

  /* Test hooks. `__tipRig` lets scripts/labrig.py MEASURE the two things a
     screenshot cannot settle: which way the robot faces, and whether the lift
     really travels its full 0.635 m stroke. */
  window.__tipLab = S;
  window.__tipRig = function (lift) {
    if (!three || !three.ready || !three.rig) return null;
    if (lift != null) drawRobot(rigCv.clientWidth / 2, rigCv.clientHeight, 0, lift);
    three.rig.updateMatrixWorld(true);
    var w = function (n) {
      var o = three.rig.getObjectByName(n);
      if (!o) return null;
      var v = new THREE.Vector3(); o.getWorldPosition(v);
      return [v.x, v.y, v.z];
    };
    return { front: w('fl_steer_body'), back: w('b_steer_body'),
             head: w('head'), top: w('lift_top'), mid: w('lift_mid'),
             stages: three.lift ? three.lift.length : 0 };
  };
  initRig();
  resize(); note();
  elCmd.textContent = S.cmd.toFixed(2) + ' m/s';
  elLift.textContent = S.lift.toFixed(2) + ' m';
  requestAnimationFrame(function (t) { last = t; frame(t); });
})();
