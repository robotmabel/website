/* Webcam retargeting, running entirely in your browser.
 *
 * Point a camera at yourself and MABEL follows — through the SAME retargeter
 * the robot runs when it is teleoperated, not a demo-shaped imitation of it.
 *
 *   MediaPipe Pose + Hands
 *     → BT.computeAnchor      shoulder-centre clutch + anthropometric scale
 *     → BT.synthesizeFrame    the same `teleop_frame` the Vision Pro streams:
 *                             head 4x4, per-hand wrist transform + 21 finger
 *                             joints, elbow transforms
 *                             (assets/bodyteleop-core.js, vendored from the
 *                             Control Studio by scripts/sync_bodyteleop.py)
 *     → DeployedRetargeter    the deployed arm retargeter, ported verbatim
 *                             (assets/deployed-retarget.js): lazy-neck body
 *                             heading, operator shoulders, the GMR arm map,
 *                             the elbow hint with its 0.15 m upper-arm
 *                             standoff, the front-workspace posture atlas,
 *                             Gauss-Newton arm IK with its trust region, the
 *                             capsule self-collision barrier, the hip-pivot
 *                             torso lean, the joint slews and the neck rule —
 *                             with every constant read from the engine into
 *                             assets/data/deployed-retarget.json
 *     → the GLB rig           joint angles written straight in (qpos − ref)
 *
 * The port is checked against the robot's own Python runtime on the same
 * webcam frames: every commanded joint agrees to 1e-7 rad (the generator and
 * the parity check live in the parent repository, beside the engine).
 *
 * What the HUD shows is read off that engine: the wrist TARGET it built (robot
 * frame, metres from the mid-shoulder), the torso it commands, the residual
 * |wrist − target| after its solve, its body-heading estimate, the neck yaw.
 *
 * KINEMATICS ONLY. No physics here — no contact, gravity or tip-over envelope;
 * the fingers are a simple open/closed read of your hand, not the robot's hand
 * retargeter. The arms, torso and neck are the deployed map.
 *
 * Video never leaves the machine: frames go from getUserMedia into the local
 * WASM model and are dropped.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BT from './bodyteleop-core.js';
import { DeployedRetargeter } from './deployed-retarget.js';
import { readGesture, SFX, fingerExtended } from './hand-gestures.js';

document.querySelectorAll('#retargetCam, [data-retarget-cam]').forEach(boot);

/* MediaPipe is fetched at click time, not on page load. */
const MP_VER = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const POSE_TASK = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_TASK = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
/* The engine's data (kinematic tree, posture atlas, constants): ~100 kB
   gzipped, fetched when the camera is switched on — never at page load. */
const ENGINE_DATA = 'assets/data/deployed-retarget.json';

/* Inference is throttled independently of the render loop — running the models
   inside every animation frame is what pinned this at about 1 fps. The engine
   steps once per inferred frame, as the robot steps once per headset frame. */
const INFER_HZ = 30;

const PL = BT.PL;
const SIDES = [['l', 'left', 'Left'], ['r', 'right', 'Right']];

/* The engine works in the MuJoCo world (z up, chassis front −x); the GLB is
   y up with its own centring baked in. The rotation is the Z-up → Y-up relabel
   (x, y, z) → (x, z, −y); the translation is FITTED at load from bodies whose
   positions both sides know, and the fit residual is exposed for the check. */
const MJ2GLB = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];

function boot(HOST) {
  HOST.innerHTML = `
    <div class="wt-grid">
      <div class="wt-rig">
        <canvas class="wt-3d"></canvas>
        <span class="wt-badge alt">MABEL</span>
        <div class="wt-verdict"><span class="wt-mode">waiting for you</span></div>
        <div class="wt-hint">drag to orbit · scroll to zoom · right-drag to pan</div>
        <button class="wt-view" type="button">Reset view</button>
      </div>
      <div class="wt-side">
        <div class="wt-panel">
          <div class="wt-panel-head">
            <span class="wt-panel-title">Camera tracking</span>
            <span class="wt-state">off</span>
          </div>
          <div class="wt-seg" role="group" aria-label="Camera tracking">
            <button class="wt-btn on" type="button" data-cam="off">Off</button>
            <button class="wt-btn" type="button" data-cam="on">On</button>
          </div>
          <button class="wt-recal" type="button" disabled>Re-centre on me</button>
          <p class="wt-priv">Frames go straight into a model running on this
            machine and are thrown away. Nothing is recorded or uploaded.</p>
          <div class="wt-hud">
            <span><b class="wt-wrist">—</b>wrist R target · fwd left up (m)</span>
            <span><b class="wt-elbow">—</b>your elbow angle</span>
            <span><b class="wt-torso">—</b>torso lean (commanded)</span>
            <span><b class="wt-res">—</b>tracking residual</span>
            <span><b class="wt-psi">—</b>body heading</span>
            <span><b class="wt-chi">—</b>neck yaw</span>
            <span><b class="wt-fps">—</b>fps</span>
          </div>
        </div>
        <div class="wt-cam">
          <video class="wt-video" playsinline muted></video>
          <canvas class="wt-overlay"></canvas>
          <span class="wt-badge">YOU</span>
          <div class="wt-idle"><span class="wt-idle-word">CAMERA OFF</span></div>
        </div>
        <div class="wt-ges">
          <span class="wt-ges-lab">Try a gesture</span>
          <span class="wt-ges-list">1 · 2 · 3 · 4 · 5 · 👍 · 🤘 · 🕷 · ♥ (two hands)</span>
        </div>
      </div>
    </div>
    <p class="wt-note">Runs the robot's deployed retargeter, ported line for line
      (<code>deployed-retarget.js</code>) and checked against the robot's own
      code to 10<sup>−7</sup> rad: GMR arm map, posture atlas, arm IK, the
      self-collision barrier and the torso lean. Kinematics only: contact,
      gravity and the tip-over envelope live in the
      <a href="https://control-sim.mabelrobot.duckdns.org" target="_blank" rel="noopener">Control Studio</a>.</p>`;

  const $ = (s) => HOST.querySelector(s);
  const video = $('.wt-video'), overlay = $('.wt-overlay');
  const octx = overlay.getContext('2d');
  const idle = $('.wt-idle'), seg = $('.wt-seg');
  const elState = $('.wt-state'), elMode = $('.wt-mode');
  const out = { wrist: $('.wt-wrist'), elbow: $('.wt-elbow'), torso: $('.wt-torso'),
                res: $('.wt-res'), psi: $('.wt-psi'), chi: $('.wt-chi'),
                fps: $('.wt-fps') };
  const btnRecal = $('.wt-recal');

  /* ── the rig ──────────────────────────────────────────────────────── */
  const cv = $('.wt-3d');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8378, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-3, 4, 2.4); scene.add(key);

  let controls = null, homeCam = null, homeTarget = null;

  const R = {                       // everything about the loaded rig
    rig: null, joints: {}, chain: { l: [], r: [] }, wrist: {}, palm: {},
    fingers: { l: [], r: [] }, torso: null, neck: {}, shoulder: new THREE.Vector3(),
    dot: {}, axes: {}, ready: false, live: false, fit: null, headNode: null
  };

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load('assets/mabel_rig.glb', (g) => {
    R.rig = g.scene;
    scene.add(R.rig);
    fetch('assets/mabel_joints.json').then((r) => r.json()).then((man) => {
      man.joints.forEach((j) => {
        const n = R.rig.getObjectByName(j.node);
        if (!n) return;
        R.joints[j.name] = { node: n, name: j.name, group: j.group,
                             axis: new THREE.Vector3().fromArray(j.axis),
                             lo: j.lower, hi: j.upper, q: 0,
                             rest: n.quaternion.clone(), ref: j.ref || 0 };
      });
      SIDES.forEach(([s, side]) => {
        R.chain[s] = [1, 2, 3, 4, 5, 6, 7]
          .map((i) => R.joints[`${side}_arm_${i}`]).filter(Boolean);
        R.wrist[s] = R.joints[`${side}_wrist`] || null;
        R.palm[s] = R.rig.getObjectByName(`${side}_palm`) ||
          (R.chain[s].length ? R.chain[s][R.chain[s].length - 1].node : null);
        R.fingers[s] = ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => ({
          f, mcp: R.joints[`${side}_${f}_mcp`], pip: R.joints[`${side}_${f}_pip`]
        })).filter((x) => x.mcp || x.pip);
      });
      R.torso = R.joints.torso || null;
      R.neck = { yaw: R.joints.neck_yaw, pitch: R.joints.neck_pitch,
                 roll: R.joints.neck_roll };
      /* The head's gaze axis, MEASURED from the rig at its rest pose: with
         every neck joint at zero the robot looks along its own forward, which
         the swerve-module positions put at GLB −X. */
      R.headNode = R.rig.getObjectByName('head') ||
                   (R.joints.neck_roll && R.joints.neck_roll.node) || null;
      if (R.headNode) {
        R.rig.updateMatrixWorld(true);
        const inv = R.headNode.getWorldQuaternion(new THREE.Quaternion()).invert();
        R.gazeLocal = new THREE.Vector3(-1, 0, 0).applyQuaternion(inv).normalize();
      }
      const sl = new THREE.Vector3(), sr = new THREE.Vector3();
      if (R.chain.l[0]) R.chain.l[0].node.getWorldPosition(sl);
      if (R.chain.r[0]) R.chain.r[0].node.getWorldPosition(sr);
      R.shoulder.copy(sl).add(sr).multiplyScalar(0.5);

      SIDES.forEach(([s]) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.028, 20, 20),
          new THREE.MeshStandardMaterial({ color: 0x2e7d4f, emissive: 0x2e7d4f,
                                           emissiveIntensity: 0.55 }));
        m.visible = false; scene.add(m); R.dot[s] = m;
        const ax = new THREE.AxesHelper(0.13);
        ax.visible = false; scene.add(ax); R.axes[s] = ax;
      });

      frameCamera();
      R.ready = true;
      window.__wtReady = { joints: Object.keys(R.joints).length,
                           arm: R.chain.l.length + R.chain.r.length,
                           palms: !!(R.palm.l && R.palm.r),
                           torso: !!R.torso, fingers: R.fingers.r.length };
    });
  }, undefined, (err) => console.error('[retarget-cam] rig failed to load', err));

  /* Frame the upper body from the FRONT — the operator is looking at the robot
     the way they would look at someone facing them, so their right hand moves
     the arm on the left of the screen. */
  function frameCamera() {
    const box = new THREE.Box3().setFromObject(R.rig);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    const eye = new THREE.Vector3(-(size.y * 1.15), R.shoulder.y + size.y * 0.06,
                                  size.z * 0.04);
    const look = new THREE.Vector3(mid.x, R.shoulder.y - size.y * 0.02, 0);
    camera.position.copy(eye);
    camera.lookAt(look);
    if (!controls) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.09;
      controls.minDistance = 0.45;
      controls.maxDistance = 6;
      controls.zoomSpeed = 0.75;
      controls.minPolarAngle = 0.25;
      controls.maxPolarAngle = Math.PI * 0.86;
    }
    controls.target.copy(look);
    controls.update();
    homeCam = eye.clone(); homeTarget = look.clone();
  }
  $('.wt-view').addEventListener('click', () => {
    if (!homeCam) return;
    camera.position.copy(homeCam);
    controls.target.copy(homeTarget);
    controls.update();
  });

  const _sq = new THREE.Quaternion();
  function setJoint(j, q) {
    if (!j) return;
    j.q = Math.max(j.lo, Math.min(j.hi, q));
    j.node.quaternion.copy(j.rest).multiply(_sq.setFromAxisAngle(j.axis, j.q));
    /* no updateMatrixWorld(true): the renderer updates the scene once per
       draw, and getWorldPosition walks up only the ancestors it needs */
    j.node.matrixWorldNeedsUpdate = true;
  }
  const clampJ = (j, q) => Math.max(j.lo, Math.min(j.hi, q));

  /* ── the engine ───────────────────────────────────────────────────── */
  let ENG = null, engineP = null;
  function ensureEngine() {
    if (!engineP)
      engineP = fetch(ENGINE_DATA).then((r) => r.json()).then((D) => {
        ENG = new DeployedRetargeter(D);
        /* The neck is commanded within the DEPLOYED windows (pitch 90° up /
           53° down), wider than this rig's MJCF ±45°: show what is commanded. */
        ['yaw', 'pitch', 'roll'].forEach((k, i) => {
          const j = R.neck[k];
          if (j && D.neck_range[i]) { j.lo = D.neck_range[i][0] - j.ref; j.hi = D.neck_range[i][1] - j.ref; }
        });
        return ENG;
      });
    return engineP;
  }

  /* MuJoCo world → GLB world, fitted once on the rig at rest (= the engine's
     home keyframe: arms 0, torso 0, wrists at ref, lift at ref). */
  const mjToGlb = (p) => new THREE.Vector3(
    MJ2GLB[0][0] * p[0] + MJ2GLB[0][1] * p[1] + MJ2GLB[0][2] * p[2],
    MJ2GLB[1][0] * p[0] + MJ2GLB[1][1] * p[1] + MJ2GLB[1][2] * p[2],
    MJ2GLB[2][0] * p[0] + MJ2GLB[2][1] * p[1] + MJ2GLB[2][2] * p[2]);
  function fitFrame() {
    if (R.fit || !ENG || !R.ready) return R.fit;
    const F = ENG.kin.fk(ENG.D.home);
    const names = ['r_shoulder_1', 'l_shoulder_1', 'r_shoulder_3', 'l_shoulder_3',
                   'r_elbow', 'l_elbow', 'r_wrist', 'l_wrist', 'torso'];
    const pairs = [];
    const held = SIDES.map(([s]) => R.chain[s].map((j) => j.q));
    SIDES.forEach(([s]) => R.chain[s].forEach((j) => setJoint(j, 0)));
    R.rig.updateMatrixWorld(true);
    for (const n of names) {
      const node = R.rig.getObjectByName(n), bi = ENG.kin.bix[n];
      if (!node || bi === undefined) continue;
      pairs.push([mjToGlb(F.body[bi].p), node.getWorldPosition(new THREE.Vector3())]);
    }
    SIDES.forEach(([s], k) => R.chain[s].forEach((j, i) => setJoint(j, held[k][i])));
    if (!pairs.length) return null;
    const t = new THREE.Vector3();
    pairs.forEach(([a, b]) => t.add(b.clone().sub(a)));
    t.multiplyScalar(1 / pairs.length);
    let worst = 0;
    pairs.forEach(([a, b]) => { worst = Math.max(worst, a.clone().add(t).distanceTo(b)); });
    R.fit = { t, worstMm: worst * 1000, n: pairs.length };
    return R.fit;
  }
  const toGlb = (p) => mjToGlb(p).add(R.fit ? R.fit.t : new THREE.Vector3());

  /* What the robot is commanded → the rig. The GLB joints are the MJCF's, so
     the angle goes in as-is, less the joint's reference (the frame rule every
     client obeys: render qpos − ref). */
  function applyCommand(r) {
    SIDES.forEach(([s, , S]) => {
      R.chain[s].forEach((j, i) => setJoint(j, r.q[`${S} Arm ${i + 1}`] - j.ref));
      if (R.wrist[s]) setJoint(R.wrist[s], r.q[`${S} Wrist`] - R.wrist[s].ref);
    });
    if (R.torso) setJoint(R.torso, r.q.Torso - R.torso.ref);
    if (R.neck.yaw) setJoint(R.neck.yaw, r.neck.neck_yaw - R.neck.yaw.ref);
    if (R.neck.pitch) setJoint(R.neck.pitch, r.neck.neck_pitch - R.neck.pitch.ref);
    if (R.neck.roll) setJoint(R.neck.roll, r.neck.neck_roll - R.neck.roll.ref);
    last = r;
  }
  let last = null;

  /* the engine's wrist target + palm axes, carried into the rig for the dots */
  function showTargets() {
    if (!ENG || !R.fit) return;
    SIDES.forEach(([s, side]) => {
      const t = ENG.targets && ENG.targets[side], hk = ENG.hk && ENG.hk[side];
      const on = running && !!t;
      if (R.dot[s]) { R.dot[s].visible = on; if (t) R.dot[s].position.copy(toGlb(t)); }
      if (R.axes[s]) {
        R.axes[s].visible = on && !!hk;
        if (t && hk) {
          const f = mjToGlb(hk.fwd).normalize(), n = mjToGlb(hk.up).normalize();
          n.addScaledVector(f, -n.dot(f)).normalize();
          const sd = new THREE.Vector3().crossVectors(n, f);
          R.axes[s].position.copy(toGlb(t));
          R.axes[s].quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, sd, n));
        }
      }
    });
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
    const vr = $('.wt-cam').getBoundingClientRect();
    overlay.width = Math.round(vr.width); overlay.height = Math.round(vr.height);
  }
  addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(HOST);

  /* ── tracking state ───────────────────────────────────────────────── */
  let poser = null, hander = null, running = false, lastT = 0, fps = 0;
  let lastInfer = 0, lastPx = null, lastHandPx = null, seq = 0;
  let calib = null, wantCalib = true;
  let trackers = null;
  const region = new BT.RegionHysteresis();
  let sfxUntil = 0, sfxWord = '', lastGesture = '';
  let elbowDeg = 0, psi0 = null;
  const newTrackers = () => ({ left: new BT.HandShapeTracker('left'),
                               right: new BT.HandShapeTracker('right') });

  /* A fresh engine with the robot where it is now — what the robot's gateway
     does on Engage and on re-centre (it seeds a new engine from the measured
     arms and torso, so nothing jumps). */
  function reengage() {
    if (!ENG) return;
    const seedQ = {};
    SIDES.forEach(([s, , S]) => R.chain[s].forEach((j, i) => { seedQ[`${S} Arm ${i + 1}`] = j.q + j.ref; }));
    if (R.torso) seedQ.Torso = R.torso.q + R.torso.ref;
    ENG.reset();
    Object.assign(ENG.q, seedQ); Object.assign(ENG.ctrl, seedQ);
    ENG.X = ENG.kin.fk(ENG.q);
    wantCalib = true; calib = null; psi0 = null; trackers = newTrackers();
  }

  async function start() {
    elState.textContent = 'loading the model…';
    try { await ensureEngine(); } catch (e) { return fail('Could not load the retargeter data.'); }
    fitFrame();
    let vision;
    try {
      vision = await import(/* webpackIgnore: true */ `${MP_BUNDLE}/vision_bundle.mjs`);
    } catch (e) { return fail('Could not load the pose model (the CDN may be blocked).'); }
    try {
      const files = await vision.FilesetResolver.forVisionTasks(`${MP_BUNDLE}/wasm`);
      poser = await vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE_TASK, delegate: 'GPU' },
        runningMode: 'VIDEO', numPoses: 1 });
      try {
        hander = await vision.HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: HAND_TASK, delegate: 'GPU' },
          runningMode: 'VIDEO', numHands: 2 });
      } catch (e) { hander = null; }
    } catch (e) { return fail('The pose model failed to start on this device.'); }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        { video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) { return fail('Camera permission was declined — nothing to retarget.'); }
    video.srcObject = stream;
    await video.play();
    idle.hidden = true;
    reengage();
    running = true;
    btnRecal.disabled = false;
    resize();
    elState.textContent = hander ? 'tracking you' : 'tracking you (no hand model: arms hold)';
    elState.classList.add('live');
    elMode.textContent = 'hold still a moment';
  }
  function fail(msg) {
    elState.textContent = msg;
    elState.classList.add('bad');
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.cam === 'off'));
    idle.hidden = false;
  }
  function stop() {
    running = false; R.live = false;
    elState.textContent = 'off';
    elState.classList.remove('bad', 'live');
    elMode.textContent = 'waiting for you'; elMode.className = 'wt-mode';
    idle.hidden = false;
    btnRecal.disabled = true;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const st = video.srcObject;
    if (st) st.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    SIDES.forEach(([s]) => { if (R.dot[s]) R.dot[s].visible = false;
                             if (R.axes[s]) R.axes[s].visible = false; });
    Object.values(out).forEach((n) => { n.textContent = '—'; });
  }
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.cam === 'on') start(); else stop();
  });
  btnRecal.addEventListener('click', () => {
    reengage();
    elState.textContent = 'centred on you';
    setTimeout(() => { if (running) elState.textContent = 'tracking you'; }, 1200);
  });

  /* ── one inference → one engine step ─────────────────────────────── */
  function infer(t) {
    const res = poser.detectForVideo(video, t);
    const world = (res.worldLandmarks && res.worldLandmarks[0]) || null;
    const norm = (res.landmarks && res.landmarks[0]) || null;
    if (!world || !norm) { R.live = false; return; }
    const vis = norm.map((p) => (p.visibility == null ? 1 : p.visibility));
    lastPx = norm;

    let hands = { left: null, right: null }, img = null;
    lastHandPx = null;
    if (hander) {
      const hr = hander.detectForVideo(video, t);
      const dets = (hr.landmarks || []).map((lms, i) => ({
        idx: i, wrist: lms[0],
        label: (hr.handednesses && hr.handednesses[i] && hr.handednesses[i][0]
                && hr.handednesses[i][0].categoryName) || '' }));
      const route = BT.routeHands(dets, norm);
      const w = (i) => (i == null ? null : hr.worldLandmarks[i]);
      hands = { left: w(route.left), right: w(route.right) };
      lastHandPx = { left: route.left == null ? null : hr.landmarks[route.left],
                     right: route.right == null ? null : hr.landmarks[route.right] };
      if (route.left != null && route.right != null)
        img = { left: { wrist: hr.landmarks[route.left][0] },
                right: { wrist: hr.landmarks[route.right][0] },
                aspect: video.videoWidth / Math.max(1, video.videoHeight) };
    }
    stepEngine(world, vis, hands, img, t / 1000);
    if (lastHandPx) readGestures(hands, lastHandPx, t);
  }

  /* the shared path: live camera and the test hook both come through here */
  function stepEngine(world, vis, hands, img, ts) {
    if (wantCalib || !calib) {
      const c = BT.computeAnchor(world, vis);
      if (!c) { R.live = false; return null; }
      calib = c; wantCalib = false;
    }
    const frame = BT.synthesizeFrame(
      { t: ts, pose: { world, vis }, hands, img }, calib, seq++,
      { trackers, refine: true, scaleShape: true, fuse: !!img, elbows: true });
    /* No frame = no step: the robot HOLDS, it does not ease anywhere. A
       dropped detection is a gap in the estimate, not an instruction. */
    if (!frame) { R.live = false; return null; }
    R.live = true;
    const r = ENG.step(frame, ts);
    applyCommand(r);
    fingers();
    readBody(world, vis);
    return r;
  }

  /* fingers: an open/closed read of the tracked hand (not the robot's hand
     retargeter, which runs in its own process on the robot) */
  function fingers() {
    SIDES.forEach(([s, side]) => {
      const px = lastHandPx && lastHandPx[side];
      if (!px) return;
      R.fingers[s].forEach((fg) => {
        if (fg.f === 'thumb') return;
        const curl = fingerExtended(px, fg.f) ? 0 : 1;
        if (fg.mcp) setJoint(fg.mcp, fg.mcp.lo + (fg.mcp.hi - fg.mcp.lo) *
                             (fg.mcp.q === 0 ? curl : lerp(norm01(fg.mcp), curl, 0.35)));
        if (fg.pip) setJoint(fg.pip, fg.pip.lo + (fg.pip.hi - fg.pip.lo) * curl);
      });
    });
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const norm01 = (j) => (j.hi - j.lo > 1e-9 ? (j.q - j.lo) / (j.hi - j.lo) : 0);

  /* the operator's own elbow angle, for the HUD, and the engine's state */
  function readBody(w, vis) {
    const e = w[PL.rightElbow], s2 = w[PL.rightShoulder], w2 = w[PL.rightWrist];
    if (e && s2 && w2) {
      const a = [s2.x - e.x, s2.y - e.y, s2.z - e.z];
      const b = [w2.x - e.x, w2.y - e.y, w2.z - e.z];
      const na = Math.hypot(...a), nb = Math.hypot(...b);
      if (na > 1e-6 && nb > 1e-6) {
        const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
        elbowDeg = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
      }
    }
    const parts = BT.trackingParts(vis, { left: 1, right: 1 });
    const reg = region.update(BT.regionForParts(parts), performance.now() / 1000);
    if (!last || !last.engaged) {
      elMode.textContent = 'hold still a moment'; elMode.className = 'wt-mode';
    } else if (ENG.proj && ENG.proj.active) {
      elMode.textContent = 'self-collision barrier on'; elMode.className = 'wt-mode drive';
    } else {
      elMode.textContent = 'following · ' + reg.replace('_', ' '); elMode.className = 'wt-mode look';
    }
  }

  function readGestures(hands, px, t) {
    const g = readGesture(
      { left: hands.left, right: hands.right },
      { left: px.left, right: px.right });
    if (g && g !== lastGesture) { sfxWord = SFX[g] || g.toUpperCase(); sfxUntil = t + 1400; }
    lastGesture = g;
  }

  /* ── the comic overlay ────────────────────────────────────────────── */
  function inked(draw, color, w) {
    octx.lineCap = 'round'; octx.lineJoin = 'round';
    octx.strokeStyle = '#151820'; octx.lineWidth = w + 6; draw();
    octx.strokeStyle = color; octx.lineWidth = w; draw();
  }
  const HB = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],
              [10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],
              [18,19],[19,20],[5,9],[9,13],[13,17]];

  function drawSkeleton(t) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const lm = lastPx;
    if (!lm) return;
    const W = overlay.width, H = overlay.height;
    const P = (i) => [(1 - lm[i].x) * W, lm[i].y * H];

    const bones = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12],
                   [11, 23], [12, 24], [23, 24]];
    inked(() => {
      octx.beginPath();
      bones.forEach(([a, b]) => {
        if (!lm[a] || !lm[b]) return;
        const [x0, y0] = P(a), [x1, y1] = P(b);
        octx.moveTo(x0, y0); octx.lineTo(x1, y1);
      });
      octx.stroke();
    }, '#F0762E', 9);

    if (lm[11] && lm[12] && lm[23] && lm[24]) {
      const sx = (P(11)[0] + P(12)[0]) / 2, sy = (P(11)[1] + P(12)[1]) / 2;
      const hx = (P(23)[0] + P(24)[0]) / 2, hy = (P(23)[1] + P(24)[1]) / 2;
      inked(() => { octx.beginPath(); octx.moveTo(hx, hy); octx.lineTo(sx, sy); octx.stroke(); },
            '#23577E', 7);
    }

    if (lm[PL.nose] && lm[7] && lm[8]) {
      const [nx, ny] = P(PL.nose), [lx] = P(7), [rx] = P(8);
      const r = Math.max(16, Math.abs(rx - lx) * 0.7);
      octx.beginPath(); octx.arc(nx, ny, r, 0, 6.283);
      octx.fillStyle = 'rgba(253,246,226,0.9)'; octx.fill();
      octx.strokeStyle = '#151820'; octx.lineWidth = 5; octx.stroke();
      const gaze = ((lx + rx) / 2 - nx) / Math.max(1, r);
      inked(() => {
        octx.beginPath(); octx.moveTo(nx, ny);
        octx.lineTo(nx - gaze * r * 2.6, ny + r * 0.5); octx.stroke();
      }, '#2E7D4F', 6);
    }

    if (lastHandPx) {
      ['left', 'right'].forEach((side) => {
        const hand = lastHandPx[side];
        if (!hand) return;
        inked(() => {
          octx.beginPath();
          HB.forEach(([a, b]) => {
            if (!hand[a] || !hand[b]) return;
            octx.moveTo((1 - hand[a].x) * W, hand[a].y * H);
            octx.lineTo((1 - hand[b].x) * W, hand[b].y * H);
          });
          octx.stroke();
        }, '#F2C94C', 5);
        [4, 8, 12, 16, 20].forEach((i) => {
          if (!hand[i]) return;
          octx.beginPath();
          octx.arc((1 - hand[i].x) * W, hand[i].y * H, 5, 0, 6.283);
          octx.fillStyle = '#FDF6E2'; octx.fill();
          octx.strokeStyle = '#151820'; octx.lineWidth = 3; octx.stroke();
        });
      });
    }

    [11, 12, 13, 14, 15, 16].forEach((i) => {
      if (!lm[i]) return;
      const [x, y] = P(i);
      octx.beginPath(); octx.arc(x, y, 8, 0, 6.283);
      octx.fillStyle = (i === 15 || i === 16) ? '#2E7D4F' : '#FDF6E2';
      octx.fill(); octx.strokeStyle = '#151820'; octx.lineWidth = 4; octx.stroke();
    });

    if (t < sfxUntil && sfxWord) {
      const k = 1 - (sfxUntil - t) / 1400;
      octx.save();
      octx.translate(W * 0.5, H * 0.22 - k * 20);
      octx.rotate(-0.1 + Math.sin(k * 9) * 0.02);
      octx.font = '700 ' + Math.round(H * 0.15) + 'px Bangers, Impact, sans-serif';
      octx.textAlign = 'center';
      octx.lineWidth = 10; octx.strokeStyle = '#151820'; octx.strokeText(sfxWord, 0, 0);
      octx.fillStyle = '#F2C94C'; octx.fillText(sfxWord, 0, 0);
      octx.restore();
    }
  }

  /* HUD numbers, all read off the engine */
  function hud() {
    if (!ENG || !last) return;
    const D = ENG.D, Rc = D.chassis.R;
    const mid = ['r_arm_mount', 'l_arm_mount'].map((n) => ENG.X.body[ENG.kin.bix[n]].p);
    const t = ENG.targets.right;
    if (t) {
      const v = [0, 1, 2].map((i) => t[i] - 0.5 * (mid[0][i] + mid[1][i]));
      const c = [0, 1, 2].map((j) => Rc[0][j] * v[0] + Rc[1][j] * v[1] + Rc[2][j] * v[2]);
      out.wrist.textContent = `${(-c[0]).toFixed(2)} ${(-c[1]).toFixed(2)} ${c[2].toFixed(2)}`;
    }
    out.elbow.textContent = elbowDeg.toFixed(0) + '°';
    out.torso.textContent = (-last.q.Torso * 180 / Math.PI).toFixed(0) + '°';
    let res = 0, n = 0;
    const palms = ENG.palms();
    for (const side of ['right', 'left']) {
      const tg = ENG.targets[side];
      if (!tg) continue;
      const p = palms[side];
      res += Math.hypot(p[0] - tg[0], p[1] - tg[1], p[2] - tg[2]); n++;
    }
    out.res.textContent = n ? (res / n * 1000).toFixed(0) + ' mm' : '—';
    const h = ENG.heading && ENG.heading.psi_b;
    if (h !== null && h !== undefined) {
      if (psi0 === null) psi0 = h;
      const d = ((h - psi0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      out.psi.textContent = (d * 180 / Math.PI).toFixed(0) + '°';
    }
    out.chi.textContent = (last.neck.neck_yaw * 180 / Math.PI).toFixed(0) + '°';
  }

  /* ── loop ─────────────────────────────────────────────────────────── */
  let _prevT = 0, _paused = false;
  function step(t) {
    requestAnimationFrame(step);
    if (_paused) return;
    _prevT = t;
    if (running && poser && ENG && video.readyState >= 2 && t - lastInfer >= 1000 / INFER_HZ) {
      lastInfer = t;
      try { infer(t); } catch (e) { /* a dropped frame is not worth the loop */ }
      drawSkeleton(t);
    }
    if (R.ready) {
      showTargets();
      if (controls) controls.update();
      renderer.render(scene, camera);
    }
    if (lastT) fps = fps * 0.9 + (1000 / Math.max(1, t - lastT)) * 0.1;
    lastT = t;
    if (running) {
      out.fps.textContent = fps ? fps.toFixed(0) : '—';
      if (R.live) hud();
    }
  }

  /* test hook — scripts/camtest.py drives the retarget path with synthetic
     landmarks so the mapping can be checked without a camera */
  window.__wt = {
    rig: R, BT,
    ready: () => ensureEngine().then(() => { fitFrame(); return R.fit; }),
    pause: function (v) { _paused = v !== false; return _paused; },
    /* step the engine N times on the last frame and report the cost */
    bench: function (n) {
      n = n || 200;
      if (!ENG || !this._last) return null;
      const t0 = performance.now();
      let ts = this._lastT;
      for (let k = 0; k < n; k++) { ts += 1 / INFER_HZ; ENG.step(this._last, ts); }
      return { n: n, ms: (performance.now() - t0) / n };
    },
    targets: function () {
      const g = (side) => (ENG && ENG.targets[side] ? toGlb(ENG.targets[side]).toArray() : null);
      return { l: g('left'), r: g('right'), live: R.live };
    },
    /* the palm axes the arm IK is asked for (the engine's hk), in rig axes */
    palmAxes: function (s) {
      const hk = ENG && ENG.hk[s === 'l' ? 'left' : 'right'];
      if (!hk) return null;
      return { fwd: mjToGlb(hk.fwd).normalize().toArray(), up: mjToGlb(hk.up).normalize().toArray() };
    },
    /* what the loop does when a frame carries no usable landmarks: nothing is
       stepped, so nothing moves */
    lose: function () { R.live = false; },
    /* An operator who stands at REST for `restS` seconds (the engine anchors on
       a steady head, the way a session starts), then holds the probe pose for
       `holdS` — long enough for the joint slews to arrive. */
    feed: function (world, vis, hands, px, rest, opts) {
      if (!ENG) return null;
      opts = opts || {};
      const restS = opts.restS || 1.0, holdS = opts.holdS || 3.0;
      SIDES.forEach(([s]) => R.chain[s].forEach((j) => setJoint(j, 0)));
      if (R.torso) setJoint(R.torso, 0);
      reengage();
      lastHandPx = px || null;
      let ts = 0, r = null;
      const frames = Math.round((restS + holdS) * INFER_HZ);
      /* the move from rest to the probe takes 0.5 s, as a body does: a head
         that teleports > 0.35 m in one frame is the engine's "tracking origin
         jumped" signal, and it re-anchors there (correctly) */
      const moveS = 0.5;
      const mix = (a, b, u) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * u,
        y: p.y + (b[i].y - p.y) * u, z: p.z + (b[i].z - p.z) * u, visibility: b[i].visibility }));
      for (let k = 0; k < frames; k++) {
        const tk = k / INFER_HZ;
        let w = world, v = vis, h = hands || {};
        if (rest && tk < restS) { w = rest.world; v = rest.vis; h = rest.hands || {}; }
        else if (rest && tk < restS + moveS) {
          const u = (tk - restS) / moveS, e = 0.5 - 0.5 * Math.cos(Math.PI * u);
          w = mix(rest.world, world, e);
        }
        r = stepEngine(w, v, h, null, ts) || r;
        ts += 1 / INFER_HZ;
      }
      R.live = false;
      if (!r) return null;
      this._last = BT.synthesizeFrame({ t: ts, pose: { world, vis }, hands: hands || {} },
                                      calib, seq++, { trackers, refine: true, scaleShape: true, elbows: true });
      this._lastT = ts;
      R.rig.updateMatrixWorld(true);
      const palms = ENG.palms();
      const g = (s, side) => {
        const tg = ENG.targets[side];
        const v = R.palm[s].getWorldPosition(new THREE.Vector3());
        const p = palms[side];
        return { target: tg ? toGlb(tg).toArray() : null, palm: v.toArray(),
                 err: tg ? Math.hypot(p[0] - tg[0], p[1] - tg[1], p[2] - tg[2]) : null };
      };
      let gaze = null;
      if (R.headNode && R.gazeLocal)
        gaze = R.gazeLocal.clone()
          .applyQuaternion(R.headNode.getWorldQuaternion(new THREE.Quaternion()))
          .normalize().toArray();
      return { l: g('l', 'left'), r: g('r', 'right'),
               torsoDeg: -r.q.Torso * 180 / Math.PI, elbowDeg,
               torsoQ: R.torso ? R.torso.q : null, gaze,
               barrier: ENG.proj ? ENG.proj.active : 0, fit: R.fit,
               neck: { yaw: R.neck.yaw ? R.neck.yaw.q : null,
                       pitch: R.neck.pitch ? R.neck.pitch.q : null,
                       roll: R.neck.roll ? R.neck.roll.q : null } };
    }
  };

  resize();
  requestAnimationFrame(step);
}
