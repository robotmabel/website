/* Webcam retargeting, running entirely in your browser.
 *
 * Point a camera at yourself and MABEL follows. This is not a demo-shaped
 * imitation of the Control Studio — it runs the studio's OWN retargeter:
 * assets/bodyteleop-core.js is vendored verbatim from
 * web_gui/simulation_control_center/web/js/bodyteleop.js (see
 * scripts/sync_bodyteleop.py), so the estimate you see here is the estimate the
 * robot would act on.
 *
 *   MediaPipe Pose + Hands
 *     → BT.computeAnchor      shoulder-centre clutch + anthropometric scale
 *     → BT.synthesizeFrame    the same `teleop_frame` the Vision Pro streams:
 *                             head 4x4, per-hand ABSOLUTE wrist transform with
 *                             orientation, 21 finger joints, elbow transforms
 *     → AVP_TO_ROBOT          operator frame → robot frame, gain
 *                             RETARGET_SCALE = [1.3, 1.3, 1.4] (config.py)
 *     → prioritised CCD       elbow first, then wrist position, then wrist
 *                             orientation on the real GLB rig
 *
 * What is tracked, and shown as numbers rather than claimed:
 *   ABSOLUTE wrist position   metres in the robot's frame, not a delta
 *   wrist ORIENTATION         the measured palm frame, clutched at start
 *   ELBOW                     the operator's own elbow drives the arm's swivel
 *   TORSO                     lean forward and the robot's torso pitches
 *   residual                  |palm − target| after the solve, in mm: the
 *                             closed-loop error, so you can see it converge
 *
 * KINEMATICS ONLY. No MuJoCo here, so no contact, no gravity, no whole-body QP
 * and no tip-over envelope — this solves where the arms must be, not the
 * torques that get them there.
 *
 * Video never leaves the machine: frames go from getUserMedia into the local
 * WASM model and are dropped.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BT from './bodyteleop-core.js';
import { readGesture, SFX, fingerExtended, palmWidth } from './hand-gestures.js';

document.querySelectorAll('#retargetCam, [data-retarget-cam]').forEach(boot);

/* MediaPipe is fetched at click time, not on page load. */
const MP_VER = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const POSE_TASK = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_TASK = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/* Inference is throttled independently of the render loop — running the models
   inside every animation frame is what pinned this at about 1 fps. */
const INFER_HZ = 30;

/* Per-axis Cartesian gain, robot frame [forward, left, up]. Copied from
   controller/mabel/config.py RETARGET_SCALE: the operator works in a small
   comfortable box and the gain covers MABEL's larger reach. */
const SCALE = [1.3, 1.3, 1.4];

/* -1 mirrors the head so it matches the mirrored webcam preview; +1 gives the
   body-true mapping a robot standing opposite you would have. See the note at
   the gaze block. */
const MIRROR_GAZE = -1;

const PL = BT.PL;

/* ARKit operator frame → the GLB's world axes.
 *
 * Measured from the rig, not assumed: the two front swerve modules sit at
 * x = +0.062 and the back one at x = +0.382, so the robot's forward is −X and
 * up is +Y. With right = forward × up = −Z:
 *     operator forward (−Z_arkit) → −X      so  glb.x =  a.z
 *     operator up      (+Y_arkit) → +Y      so  glb.y =  a.y
 *     operator right   (+X_arkit) → −Z      so  glb.z = −a.x
 * det = +1, a proper rotation, so hand chirality survives the map. */
function arkitToRig(ax, ay, az, out) { return out.set(az, ay, -ax); }

/* The same map as a matrix, for rotating ORIENTATIONS rather than points.
 * A rotation does not transform like a point: R_rig = M · R_arkit · Mᵀ. Doing
 * it by permuting Euler angles instead — which is what the first version did —
 * is only correct for rotations about a single axis, and it is why the head
 * arrived rolled onto its side. */
const M_AR = new THREE.Matrix4().set(0, 0, 1, 0,
                                     0, 1, 0, 0,
                                     -1, 0, 0, 0,
                                     0, 0, 0, 1);
const M_AR_T = M_AR.clone().transpose();
function rotArkitToRig(m4, out) {
  return out.copy(M_AR).multiply(m4).multiply(M_AR_T);
}

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
            <span><b class="wt-wrist">—</b>wrist R · x y z (m)</span>
            <span><b class="wt-elbow">—</b>elbow angle</span>
            <span><b class="wt-torso">—</b>torso lean</span>
            <span><b class="wt-res">—</b>tracking residual</span>
            <span><b class="wt-psi">—</b>body heading</span>
            <span><b class="wt-chi">—</b>gaze / drive</span>
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
    <p class="wt-note">Runs the Control Studio's own retargeter
      (<code>bodyteleop.js</code>, vendored) — absolute wrist pose with
      orientation, elbow and torso. Kinematics only: contact, gravity, the
      whole-body QP and the tip-over envelope live in the
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
    rig: null, joints: {}, chain: { l: [], r: [] }, palm: {}, elbow: {},
    fingers: { l: [], r: [] }, torso: null, neck: {}, shoulder: new THREE.Vector3(),
    target: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    elbowT: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    homePalm: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    wantQ: { l: null, r: null },    // commanded wrist orientation (world)
    offQ: { l: null, r: null },     // orientation clutch, captured at start
    dot: {}, axes: {}, ready: false, live: false
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
                             rest: n.quaternion.clone(),
                             restP: n.position.clone(), ref: j.ref || 0 };
      });
      ['l', 'r'].forEach((s) => {
        const side = s === 'l' ? 'left' : 'right';
        R.chain[s] = [1, 2, 3, 4, 5, 6, 7]
          .map((i) => R.joints[`${side}_arm_${i}`]).filter(Boolean);
        R.palm[s] = R.rig.getObjectByName(`${side}_palm`) ||
          (R.chain[s].length ? R.chain[s][R.chain[s].length - 1].node : null);
        /* arm_4 is the elbow on a 7-DOF arm: 1-3 shoulder, 4 elbow, 5-7 wrist */
        R.elbow[s] = R.joints[`${side}_arm_4`] ? R.joints[`${side}_arm_4`].node : null;
        R.fingers[s] = ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => ({
          f, mcp: R.joints[`${side}_${f}_mcp`], pip: R.joints[`${side}_${f}_pip`]
        })).filter((x) => x.mcp || x.pip);
      });
      R.torso = R.joints.torso || null;
      R.neck = { yaw: R.joints.neck_yaw, pitch: R.joints.neck_pitch,
                 roll: R.joints.neck_roll };
      /* The head's gaze axis, MEASURED from the rig at its rest pose rather
         than assumed: with every neck joint at zero the robot looks along its
         own forward, which the swerve-module positions put at GLB −X. Whatever
         local vector maps to that is the gaze axis, whichever way the head mesh
         happens to be oriented in the file. */
      R.headNode = R.rig.getObjectByName('head') ||
                   (R.joints.neck_roll && R.joints.neck_roll.node) || null;
      if (R.headNode) {
        R.headNode.updateMatrixWorld(true);
        const wq = R.headNode.getWorldQuaternion(new THREE.Quaternion());
        const inv = wq.clone().invert();
        R.gazeLocal = new THREE.Vector3(-1, 0, 0).applyQuaternion(inv).normalize();
        R.upLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(inv).normalize();
      }
      R.gazeGoal = new THREE.Vector3(-1, 0, 0);

      /* the robot's own shoulder centre — where the operator's shoulder
         centre is pinned, so wrist targets arrive as ABSOLUTE positions */
      const sl = new THREE.Vector3(), sr = new THREE.Vector3();
      if (R.chain.l[0]) R.chain.l[0].node.getWorldPosition(sl);
      if (R.chain.r[0]) R.chain.r[0].node.getWorldPosition(sr);
      R.shoulder.copy(sl).add(sr).multiplyScalar(0.5);

      ['l', 'r'].forEach((s) => {
        if (!R.palm[s]) return;
        R.palm[s].getWorldPosition(R.homePalm[s]);
        R.target[s].copy(R.homePalm[s]);
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
     the way they would look at a mirror, so their right hand moves the arm on
     the left of the screen. */
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
      /* let the operator go a little under and over, but not through the floor */
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

  /* ── inverse kinematics ───────────────────────────────────────────────
     Prioritised, one damped sweep per frame:
       1. the ELBOW, on the three shoulder joints only, at a low gain — this
          is what makes the arm carry the operator's own elbow instead of
          picking whatever redundant posture the wrist solve happens to reach;
       2. the WRIST POSITION, on the whole chain, at the main gain;
       3. the WRIST ORIENTATION, on the last three joints, by projecting the
          orientation error onto each joint's own axis.
     Solving them in that order lets the wrist override the elbow when the two
     disagree, which is the right precedence: the hand is the task. */
  const _p = new THREE.Vector3(), _e = new THREE.Vector3(), _wq = new THREE.Quaternion();

  /* Scratch objects, allocated once. Every one of these used to be a `new`
     inside the sweep, which at 7 joints x 2 passes x 2 arms x 60 fps is a few
     thousand quaternions a second for the collector to clean up. */
  const _sq = new THREE.Quaternion(), _jq = new THREE.Quaternion();
  const _ax = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const _toTip = new THREE.Vector3(), _toGoal = new THREE.Vector3();

  function setJoint(j, q) {
    j.q = Math.max(j.lo, Math.min(j.hi, q));
    j.node.quaternion.copy(j.rest)
      .multiply(_sq.setFromAxisAngle(j.axis, j.q));
    /* NO updateMatrixWorld(true) here.
       That was the whole reason the rig lagged while the target markers stayed
       perfectly smooth: force-updating from a SHOULDER walks the entire arm,
       the wrist, all 17 hand joints and every mesh under them — about 25 nodes
       — and the sweep does it ~40 times a frame. Nothing needs it, because
       getWorldPosition/getWorldQuaternion call updateWorldMatrix(true, false),
       which walks UP the ~10 ancestors of the node being read. O(depth) once
       per read instead of O(subtree) per write. The renderer updates the whole
       scene once at draw time anyway. */
    j.node.matrixWorldNeedsUpdate = true;
  }

  function ikPosition(chain, tip, goal, gain, passes) {
    if (!tip || !chain.length) return;
    for (let it = 0; it < passes; it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const j = chain[i];
        j.node.getWorldPosition(_p);
        tip.getWorldPosition(_e);
        _toTip.copy(_e).sub(_p);
        _toGoal.copy(goal).sub(_p);
        if (_toTip.lengthSq() < 1e-8 || _toGoal.lengthSq() < 1e-8) continue;
        _toTip.normalize(); _toGoal.normalize();
        j.node.getWorldQuaternion(_jq);
        _ax.copy(j.axis).applyQuaternion(_jq).normalize();
        _a.copy(_toTip).projectOnPlane(_ax);
        _b.copy(_toGoal).projectOnPlane(_ax);
        if (_a.lengthSq() < 1e-8 || _b.lengthSq() < 1e-8) continue;
        _a.normalize(); _b.normalize();
        let ang = Math.acos(Math.max(-1, Math.min(1, _a.dot(_b))));
        if (_a.cross(_b).dot(_ax) < 0) ang = -ang;
        setJoint(j, j.q + ang * gain);
      }
    }
  }

  /* Point a node's own axis at a world direction, using the same damped sweep.
     The neck needs this rather than an Euler assignment: all three neck joints
     carry a LOCAL axis of [0,0,1], but they are nested with body rotations
     between them, so each one's z points somewhere different in the world.
     Writing yaw/pitch/roll straight into them is what put the head on its side.
     Aiming the gaze instead cannot get that wrong — it only ever asks each
     joint for the part of the correction it is able to make. */
  const _g0 = new THREE.Vector3(), _g1 = new THREE.Vector3();
  function ikDirection(chain, node, localDir, goalDir, gain, passes) {
    if (!node || !goalDir) return;
    for (let it = 0; it < passes; it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const j = chain[i];
        if (!j) continue;
        node.getWorldQuaternion(_jq);
        _g0.copy(localDir).applyQuaternion(_jq).normalize();
        _g1.copy(goalDir).normalize();
        j.node.getWorldQuaternion(_jq);
        const worldAxis = _ax.copy(j.axis).applyQuaternion(_jq).normalize();
        const a = _a.copy(_g0).projectOnPlane(worldAxis);
        const b = _b.copy(_g1).projectOnPlane(worldAxis);
        /* AUTHORITY. A joint whose axis nearly parallels the gaze cannot turn
           the gaze at all, but the projection of two nearly-parallel vectors
           onto its plane is a pair of tiny, noisy stubs whose ANGLE can be
           anything — and the sweep then applies that meaningless angle at full
           gain. That is how a squarely-facing operator ended up with the neck
           rolled to its 45° stop. Only act on the part each joint owns. */
        const auth = Math.min(a.length(), b.length());
        if (auth < 0.25) continue;
        a.normalize(); b.normalize();
        let ang = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
        if (a.cross(b).dot(worldAxis) < 0) ang = -ang;
        setJoint(j, j.q + ang * gain * auth);
      }
    }
  }

  /* The neck is re-solved from its rest pose every frame rather than nudged
     from wherever it was left. It is a 3-joint chain aiming a single
     direction, so it is redundant, and an incremental sweep on a redundant
     chain wanders — it accumulates roll that nothing ever takes back out. */
  function aimGaze(goal) {
    if (!R.headNode || !R.gazeLocal) return;
    const chain = [R.neck.yaw, R.neck.pitch, R.neck.roll].filter(Boolean);
    chain.forEach((j) => setJoint(j, 0));
    ikDirection(chain, R.headNode, R.gazeLocal, goal, 0.85, 6);
  }

  const _cq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
  function ikOrientation(chain, tip, goalQ, gain, passes) {
    if (!tip || !goalQ || chain.length < 3) return;
    const wrist = chain.slice(-3);
    for (let it = 0; it < passes; it++) {
      for (let i = wrist.length - 1; i >= 0; i--) {
        const j = wrist[i];
        tip.getWorldQuaternion(_cq);
        _dq.copy(goalQ).multiply(_cq.invert());           // world error rotation
        let w = Math.max(-1, Math.min(1, _dq.w));
        const ang = 2 * Math.acos(w);
        const s = Math.sqrt(Math.max(1e-12, 1 - w * w));
        if (!(ang > 1e-4)) continue;
        const errAxis = _a.set(_dq.x / s, _dq.y / s, _dq.z / s);
        j.node.getWorldQuaternion(_jq);
        const worldAxis = _ax.copy(j.axis).applyQuaternion(_jq).normalize();
        /* only the part of the error this joint can actually undo */
        const d = errAxis.dot(worldAxis) * (ang > Math.PI ? ang - 2 * Math.PI : ang);
        setJoint(j, j.q + d * gain);
      }
    }
  }

  function relax(side, k) {
    R.chain[side].forEach((j) => setJoint(j, j.q * (1 - k)));
    R.fingers[side].forEach((f) => {
      if (f.mcp) setJoint(f.mcp, f.mcp.q * (1 - k));
      if (f.pip) setJoint(f.pip, f.pip.q * (1 - k));
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
  const trackers = { left: new BT.HandShapeTracker(), right: new BT.HandShapeTracker() };
  const region = new BT.RegionHysteresis();
  let sfxUntil = 0, sfxWord = '', lastGesture = '';
  let psi = 0, chi = 0, psi0 = null, elbowDeg = 0, torsoDeg = 0, resMm = 0;

  async function start() {
    elState.textContent = 'loading the model…';
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
      } catch (e) { hander = null; }     // pose alone still drives the arms
    } catch (e) { return fail('The pose model failed to start on this device.'); }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        { video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) { return fail('Camera permission was declined — nothing to retarget.'); }
    video.srcObject = stream;
    await video.play();
    idle.hidden = true;
    running = true; wantCalib = true;
    R.offQ.l = R.offQ.r = null;
    btnRecal.disabled = false;
    resize();
    elState.textContent = 'tracking you';
    elState.classList.add('live');
    elMode.textContent = 'tracking';
    ['l', 'r'].forEach((s) => { if (R.dot[s]) R.dot[s].visible = true;
                                if (R.axes[s]) R.axes[s].visible = true; });
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
    ['l', 'r'].forEach((s) => {
      R.target[s].copy(R.homePalm[s]);
      R.wantQ[s] = null;
      if (R.dot[s]) R.dot[s].visible = false;
      if (R.axes[s]) R.axes[s].visible = false;
    });
    Object.values(out).forEach((n) => { n.textContent = '—'; });
  }
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.cam === 'on') start(); else stop();
  });
  btnRecal.addEventListener('click', () => {
    wantCalib = true; R.offQ.l = R.offQ.r = null;
    elState.textContent = 'centred on you';
    setTimeout(() => { if (running) elState.textContent = 'on'; }, 1200);
  });

  /* ── one inference, through the studio's retargeter ────────────────── */
  function infer(t) {
    const res = poser.detectForVideo(video, t);
    const world = (res.worldLandmarks && res.worldLandmarks[0]) || null;
    const norm = (res.landmarks && res.landmarks[0]) || null;
    if (!world || !norm) { R.live = false; return; }
    const vis = norm.map((p) => (p.visibility == null ? 1 : p.visibility));
    lastPx = norm;

    /* clutch: capture the shoulder-centre anchor and anthropometric scale */
    if (wantCalib || !calib) {
      const c = BT.computeAnchor(world, vis);
      if (!c) return;
      calib = c; wantCalib = false; psi0 = null;
    }

    /* hands, routed by nearest pose wrist rather than the mirror-prone label */
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

    const frame = BT.synthesizeFrame(
      { t: t / 1000, pose: { world, vis }, hands, img }, calib, seq++,
      { trackers, refine: true, scaleShape: true, fuse: !!img, elbows: true });
    if (!frame) { R.live = false; return; }
    R.live = true;

    applyFrame(frame, world, vis);
    readBody(world, vis);
    if (lastHandPx) readGestures(hands, lastHandPx, t);
  }

  /* translation out of a row-major 4x4 as the wire carries it */
  const mTrans = (m) => [m[3], m[7], m[11]];
  /* the rotation part of that same row-major matrix. THREE.Matrix4.set() takes
     its arguments in ROW order, so the wire's layout goes straight in. */
  function mRot(m, into) {
    return into.set(m[0], m[1], m[2], 0,
                    m[4], m[5], m[6], 0,
                    m[8], m[9], m[10], 0,
                    0, 0, 0, 1);
  }

  const _tmp = new THREE.Vector3(), _q1 = new THREE.Quaternion();
  const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  const _tgt = new THREE.Vector3(), _up = new THREE.Vector3();

  /* Landmark noise is a few millimetres frame to frame, and a 1.3x gain puts
     it straight onto the wrist. A deadband plus a light lag removes the shake
     without adding lag you can feel: below 4 mm nothing moves at all, and
     above it the target chases at 45% per sample. */
  function smoothTo(cur, want) {
    const d = _tmp.copy(want).sub(cur);
    const n = d.length();
    if (n < 0.004) return;
    cur.addScaledVector(d, n > 0.25 ? 1.0 : 0.45);
  }

  /* ARKit world point (metres, shoulder-anchored, +1.35 m standing height)
     → the rig's world, scaled per axis in the ROBOT frame the gain is
     defined in, then rotated into GLB axes. */
  function toRig(p, outV) {
    const dx = p[0], dy = p[1] - BT.ANCHOR_HEIGHT_M, dz = p[2];
    const fwd = -dz * SCALE[0], left = -dx * SCALE[1], up = dy * SCALE[2];
    /* forward = −X, left = +Z, up = +Y */
    return outV.set(-fwd, up, left).add(R.shoulder);
  }

  function applyFrame(f, world, vis) {
    ['l', 'r'].forEach((s) => {
      const hand = s === 'l' ? f.leftHand : f.rightHand;
      const elb = s === 'l' ? f.leftElbow : f.rightElbow;
      const wi = s === 'l' ? PL.leftWrist : PL.rightWrist;
      const ei = s === 'l' ? PL.leftElbow : PL.rightElbow;
      const seen = vis && vis[wi] != null ? vis[wi] : 1;

      /* The hand model gives the WRIST POSE; the pose model gives the wrist
         POSITION. `synthesizeFrame` only emits a HandPose when it has both, so
         with the hand model unavailable (or your hands out of frame) it hands
         back nulls — and the arms froze. The pose wrist alone is still a real
         absolute target, through BT's own clutch, so fall back to it and lose
         only the orientation. */
      if (!hand || !hand.isTracked) {
        /* HOLD, do not relax. A dropped detection is a gap in the estimate,
           not an instruction to move — easing back toward the rest pose on
           every lost frame is what made the arms twitch whenever a hand left
           the frame for an instant. Freeze on the last good target instead. */
        if (!world || !world[wi] || seen < BT.VIS_T) return;
        toRig(BT.worldPoint(world[wi], calib.anchor, calib.scale), _tgt);
        smoothTo(R.target[s], _tgt);
        if (world[ei] && (vis[ei] == null || vis[ei] >= BT.VIS_T)) {
          toRig(BT.worldPoint(world[ei], calib.anchor, calib.scale), _tgt);
          smoothTo(R.elbowT[s], _tgt);
        } else R.elbowT[s].set(NaN, NaN, NaN);
        R.wantQ[s] = null;
        return;
      }

      toRig(mTrans(hand.anchorTransform.matrix), _tgt);
      smoothTo(R.target[s], _tgt);
      if (elb) { toRig(mTrans(elb.matrix), _tgt); smoothTo(R.elbowT[s], _tgt); }
      else R.elbowT[s].set(NaN, NaN, NaN);

      /* the measured palm frame, rotated into the rig's axes. The FIRST
         tracked frame captures the offset between it and the robot's own
         wrist, so the hand does not snap when tracking starts — the same
         clutch a headset session uses. */
      const wj = hand.joints && hand.joints[0];
      if (wj && wj.localTransform) {
        const qr = new THREE.Quaternion().setFromRotationMatrix(
          rotArkitToRig(mRot(wj.localTransform.matrix, _m1), _m2));
        if (!R.offQ[s] && R.palm[s]) {
          const cur = R.palm[s].getWorldQuaternion(new THREE.Quaternion());
          R.offQ[s] = qr.clone().invert().premultiply(cur);   // cur = qr * off
        }
        R.wantQ[s] = R.offQ[s] ? qr.clone().multiply(R.offQ[s]) : qr;
      }
    });

    /* THE GAZE. BT's head frame puts the operator's look direction on −Z
       (AVP_GAZE_LOCAL), so the goal is the third column of the head rotation,
       negated, carried into the rig's axes. The neck is then AIMED at it — see
       ikDirection for why writing yaw/pitch/roll into the joints instead is
       wrong for this particular chain. */
    if (f.head && f.head.trackingState === 'normal' && R.gazeLocal) {
      /* Map the gaze VECTOR, not a column of the conjugated matrix. Those are
         different things and the difference is a 90° error: M·R·Mᵀ is the right
         rotation in rig coordinates, but its columns are the images of the
         RIG's basis vectors, so its third column is not the operator's −Z. The
         gaze is a direction, so it maps with M alone. */
      const m = f.head.transform.matrix;
      /* MIRROR. The webcam preview beside this is mirrored, the way a bathroom
         mirror is, so turning your head to your own left moves your image to
         the left of that frame. A robot facing you and copying your body
         turns the OTHER way on screen — physically right, and it reads as
         backwards next to the preview. The lateral component is flipped so
         the two views agree; MIRROR_GAZE = 1 restores the body-true mapping. */
      arkitToRig(-m[2] * MIRROR_GAZE, -m[6], -m[10], R.gazeGoal).normalize();
      aimGaze(R.gazeGoal);

      /* ROLL is left over once the gaze is aimed: pointing a direction says
         nothing about rotation ABOUT that direction, and ikDirection
         deliberately skips a joint whose axis parallels the gaze because it
         has no authority over it. So take the operator's head-up vector, drop
         the part along the gaze, and measure the signed angle to the robot's
         own up. That is the tilt of your ear toward your shoulder. */
      if (R.neck.roll && R.headNode) {
        arkitToRig(m[1] * MIRROR_GAZE, m[5], m[9], _up).normalize();
        setJoint(R.neck.roll, 0);
        R.headNode.getWorldQuaternion(_q1);
        const have = _tmp.copy(R.upLocal).applyQuaternion(_q1).normalize();
        const g = R.gazeGoal;
        const a = have.projectOnPlane(g).normalize();
        const b = _up.projectOnPlane(g).normalize();
        if (a.lengthSq() > 0.04 && b.lengthSq() > 0.04) {
          let roll = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
          if (a.clone().cross(b).dot(g) < 0) roll = -roll;
          setJoint(R.neck.roll, clampJ(R.neck.roll, roll));
        }
      }
    }

    /* fingers, from the tracked hand shape */
    ['l', 'r'].forEach((s) => {
      const px = lastHandPx && lastHandPx[s === 'l' ? 'left' : 'right'];
      if (!px) return;
      R.fingers[s].forEach((fg) => {
        if (fg.f === 'thumb') return;              // the thumb needs its own map
        const open = fingerExtended(px, fg.f);
        const curl = open ? 0 : 1;
        if (fg.mcp) setJoint(fg.mcp, fg.mcp.lo + (fg.mcp.hi - fg.mcp.lo) *
                             (fg.mcp.q === 0 ? curl : lerp(norm01(fg.mcp), curl, 0.35)));
        if (fg.pip) setJoint(fg.pip, fg.pip.lo + (fg.pip.hi - fg.pip.lo) * curl);
      });
    });
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const norm01 = (j) => (j.hi - j.lo > 1e-9 ? (j.q - j.lo) / (j.hi - j.lo) : 0);
  const clampJ = (j, q) => Math.max(j.lo, Math.min(j.hi, q));

  /* ── body: heading, gaze-vs-drive, and the torso lean ───────────────── */
  function readBody(w, vis) {
    const ls = w[PL.leftShoulder], rs = w[PL.rightShoulder];
    const lh = w[PL.leftHip], rh = w[PL.rightHip];
    if (!ls || !rs) return;

    const yaw = Math.atan2(rs.z - ls.z, rs.x - ls.x);
    if (psi0 === null) psi0 = yaw;
    psi = yaw - psi0;
    const lw = w[PL.leftWrist], rw = w[PL.rightWrist];
    const swing = (lw && rw)
      ? Math.min(1, Math.abs((lw.z - rw.z) / Math.max(0.08, Math.abs(lw.x - rw.x)))) : 0;
    chi = Math.max(0, Math.min(1, Math.abs(psi) / 0.5 * (1 - swing * 0.6)));

    /* TORSO. MediaPipe world is +y DOWN and +z away from the camera, so the
       spine vector hip→shoulder has height −(sy−hy) and a forward component
       −(sz−hz): lean toward the camera and that goes positive. The joint's
       own range is asymmetric (−60°…+15°), which is the giveaway that
       negative is forward — a torso bends much further forward than back. */
    if (lh && rh && R.torso) {
      const sy = (ls.y + rs.y) / 2, sz = (ls.z + rs.z) / 2;
      const hy = (lh.y + rh.y) / 2, hz = (lh.z + rh.z) / 2;
      const up = -(sy - hy), fwd = -(sz - hz);
      const lean = Math.atan2(fwd, Math.max(0.05, up));
      torsoDeg = lean * 180 / Math.PI;
      setJoint(R.torso, clampJ(R.torso, -lean * 1.25));
    }

    /* the elbow angle the operator is actually holding — reported, and the
       thing the elbow priority in the solver is tracking */
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
    elMode.textContent = chi > 0.5 ? 'intent → base would turn'
                                   : 'gaze → neck only · ' + reg.replace('_', ' ');
    elMode.className = 'wt-mode ' + (chi > 0.5 ? 'drive' : 'look');
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

    /* the spine, drawn separately because it is what moves the torso */
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

  /* ── loop ─────────────────────────────────────────────────────────── */
  function step(t) {
    requestAnimationFrame(step);
    if (running && poser && video.readyState >= 2 && t - lastInfer >= 1000 / INFER_HZ) {
      lastInfer = t;
      try { infer(t); } catch (e) { /* a dropped frame is not worth the loop */ }
      drawSkeleton(t);
    }
    if (R.ready) {
      let res = 0, n = 0;
      ['l', 'r'].forEach((s) => {
        if (!R.palm[s]) return;
        if (R.live) {
          if (Number.isFinite(R.elbowT[s].x) && R.elbow[s])
            ikPosition(R.chain[s].slice(0, 3), R.elbow[s], R.elbowT[s], 0.18, 1);
          ikPosition(R.chain[s], R.palm[s], R.target[s], 0.45, 2);
          ikOrientation(R.chain[s], R.palm[s], R.wantQ[s], 0.35, 1);
          R.palm[s].getWorldPosition(_tmp);
          res += _tmp.distanceTo(R.target[s]); n++;
        }
        if (R.dot[s]) R.dot[s].position.copy(R.target[s]);
        if (R.axes[s]) {
          R.axes[s].position.copy(R.target[s]);
          if (R.wantQ[s]) R.axes[s].quaternion.copy(R.wantQ[s]);
        }
      });
      if (n) resMm = resMm * 0.8 + (res / n) * 1000 * 0.2;
      if (controls) controls.update();
      renderer.render(scene, camera);
    }
    if (lastT) fps = fps * 0.9 + (1000 / Math.max(1, t - lastT)) * 0.1;
    lastT = t;
    if (running) {
      out.fps.textContent = fps ? fps.toFixed(0) : '—';
      const p = R.target.r.clone().sub(R.shoulder);
      out.wrist.textContent = R.live
        ? `${(-p.x).toFixed(2)} ${p.z.toFixed(2)} ${p.y.toFixed(2)}` : '—';
      out.elbow.textContent = R.live ? elbowDeg.toFixed(0) + '°' : '—';
      out.torso.textContent = R.live ? torsoDeg.toFixed(0) + '°' : '—';
      out.res.textContent = R.live ? resMm.toFixed(0) + ' mm' : '—';
      out.psi.textContent = R.live ? (psi * 180 / Math.PI).toFixed(0) + '°' : '—';
      out.chi.textContent = R.live ? chi.toFixed(2) : '—';
    }
  }

  /* test hook — scripts/camtest.py drives the retarget path with recorded
     landmarks so the mapping can be checked without a camera */
  window.__wt = {
    rig: R, applyFrame, toRig, arkitToRig, BT,
    /* solve the arms N times and report the cost, so "it feels slow" can be
       answered with a number */
    bench: function (n) {
      n = n || 200;
      const t0 = performance.now();
      for (let k = 0; k < n; k++) {
        ['l', 'r'].forEach((s) => {
          if (!R.palm[s]) return;
          if (Number.isFinite(R.elbowT[s].x) && R.elbow[s])
            ikPosition(R.chain[s].slice(0, 3), R.elbow[s], R.elbowT[s], 0.18, 1);
          ikPosition(R.chain[s], R.palm[s], R.target[s], 0.45, 2);
          ikOrientation(R.chain[s], R.palm[s], R.wantQ[s], 0.35, 1);
        });
      }
      return { n: n, ms: (performance.now() - t0) / n };
    },
    targets: function () {
      return { l: R.target.l.toArray(), r: R.target.r.toArray(),
               live: R.live };
    },
    lose: function () {
      /* what the loop does when a frame carries no usable landmarks */
      const w = new Array(33).fill(null);
      const f = { head: { trackingState: 'notAvailable' },
                  leftHand: null, rightHand: null };
      applyFrame(f, w, new Array(33).fill(0));
    },
    feed: function (world, vis, hands, px) {
      calib = BT.computeAnchor(world, vis);
      if (!calib) return null;
      /* every probe starts from the rest pose, so a test measures the mapping
         and not the order the probes happened to run in */
      ['l', 'r'].forEach((s) => R.chain[s].forEach((j) => setJoint(j, 0)));
      if (R.torso) setJoint(R.torso, 0);
      const f = BT.synthesizeFrame({ t: 0, pose: { world, vis }, hands: hands || {} },
                                   calib, 0, { refine: true, scaleShape: true, elbows: true });
      if (!f) return null;
      lastHandPx = px || null;
      R.live = true;
      applyFrame(f, world, vis);
      readBody(world, vis);
      ['l', 'r'].forEach((s) => {
        if (!R.palm[s]) return;
        ikPosition(R.chain[s], R.palm[s], R.target[s], 0.6, 24);
      });
      const g = (s) => {
        const v = new THREE.Vector3();
        R.palm[s].getWorldPosition(v);
        return { target: R.target[s].toArray(), palm: v.toArray(),
                 err: v.distanceTo(R.target[s]) };
      };
      let gaze = null;
      if (R.headNode && R.gazeLocal) {
        R.headNode.updateMatrixWorld(true);
        gaze = R.gazeLocal.clone()
          .applyQuaternion(R.headNode.getWorldQuaternion(new THREE.Quaternion()))
          .normalize().toArray();
      }
      return { l: g('l'), r: g('r'), torsoDeg, elbowDeg,
               torsoQ: R.torso ? R.torso.q : null,
               gaze, gazeGoal: R.gazeGoal ? R.gazeGoal.toArray() : null,
               neck: { yaw: R.neck.yaw ? R.neck.yaw.q : null,
                       pitch: R.neck.pitch ? R.neck.pitch.q : null,
                       roll: R.neck.roll ? R.neck.roll.q : null } };
    }
  };

  resize();
  requestAnimationFrame(step);
}
