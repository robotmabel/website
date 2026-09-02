/* Webcam retargeting, running entirely in your browser.
 *
 * Point a camera at yourself and MABEL's arms follow. This is the same idea
 * the Control Studio runs against the real robot, cut down to what a web page
 * can honestly do:
 *
 *   MediaPipe Pose  →  shoulder-centre anchor + anthropometric scale
 *                   →  wrist targets in the robot's frame
 *                   →  damped CCD inverse kinematics on the real GLB rig
 *
 * KINEMATICS ONLY. There is no MuJoCo here, so there is no contact, no
 * gravity, no whole-body QP and no tip-over envelope — the robot on the right
 * is solving where its arms must be, not what torques get them there. The
 * torso-frame recovery is the real one: the operator's body yaw is fit from
 * the shoulder line, and chi decides whether a turn is gaze or intent.
 *
 * Video never leaves the machine: frames go straight from getUserMedia into
 * the local WASM model and are dropped.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* Mount on every [data-retarget-cam] (and the original #retargetCam), so the
   demo can appear on more than one page section. */
document.querySelectorAll('#retargetCam, [data-retarget-cam]').forEach(boot);

/* MediaPipe is fetched at click time, not on page load — nobody pays for it
   unless they actually start the camera. */
const MP_VER = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const POSE_TASK = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;

/* MediaPipe pose landmark indices we use */
const L = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14,
            lWrist: 15, rWrist: 16, lHip: 23, rHip: 24 };

const SHOULDER_W = 0.38;      // metres, the robot's own shoulder separation

function boot(HOST) {
  HOST.innerHTML = `
    <div class="rc-grid">
      <div class="rc-rig">
        <canvas class="rc-3d"></canvas>
        <span class="rc-badge alt">MABEL</span>
        <div class="rc-verdict"><span class="rc-mode">waiting for you</span></div>
      </div>
      <div class="rc-side">
        <div class="rc-panel">
          <div class="rc-panel-head">
            <span class="rc-panel-title">Camera tracking</span>
            <span class="rc-state">off</span>
          </div>
          <div class="rc-seg" role="group" aria-label="Camera tracking">
            <button class="rc-btn on" type="button" data-cam="off">Off</button>
            <button class="rc-btn" type="button" data-cam="on">On</button>
          </div>
          <p class="rc-priv">Frames go straight into a model running on this
            machine and are thrown away. Nothing is recorded or uploaded.</p>
          <div class="rc-hud">
            <span><b class="rc-psi">—</b>body heading</span>
            <span><b class="rc-chi">—</b>gaze / drive</span>
            <span><b class="rc-fps">—</b>fps</span>
          </div>
        </div>
        <div class="rc-cam">
          <video class="rc-video" playsinline muted></video>
          <canvas class="rc-overlay"></canvas>
          <span class="rc-badge">YOU</span>
          <div class="rc-idle"><span class="rc-idle-word">CAMERA OFF</span></div>
        </div>
      </div>
    </div>
    <p class="rc-note">Kinematics only — this page solves where the arms must be,
      not the torques that get them there. Contact, gravity, the whole-body QP and
      the tip-over envelope all live in the
      <a href="https://control-sim.mabelrobot.duckdns.org" target="_blank" rel="noopener">Control Studio</a>.</p>`;

  const video = HOST.querySelector('.rc-video');
  const overlay = HOST.querySelector('.rc-overlay');
  const octx = overlay.getContext('2d');
  const idle = HOST.querySelector('.rc-idle');
  const seg = HOST.querySelector('.rc-seg');
  const elState = HOST.querySelector('.rc-state');
  const elPsi = HOST.querySelector('.rc-psi');
  const elChi = HOST.querySelector('.rc-chi');
  const elFps = HOST.querySelector('.rc-fps');
  const elMode = HOST.querySelector('.rc-mode');

  /* ── the rig ──────────────────────────────────────────────────────── */
  const cv = HOST.querySelector('.rc-3d');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8378, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2.4, 4, 3); scene.add(key);

  let rig = null, chains = { l: [], r: [] }, ee = { l: null, r: null },
      home = { l: new THREE.Vector3(), r: new THREE.Vector3() },
      target = { l: new THREE.Vector3(), r: new THREE.Vector3() },
      dot = {}, ready = false;

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);      // the rig is meshopt-compressed
  loader.load('assets/mabel_rig.glb', (g) => {
    rig = g.scene;
    scene.add(rig);
    fetch('assets/mabel_joints.json').then((r) => r.json()).then((man) => {
      const joints = {};
      man.joints.forEach((j) => {
        const n = rig.getObjectByName(j.node);
        if (n) joints[j.name] = { node: n, axis: new THREE.Vector3().fromArray(j.axis),
                                  lo: j.lower, hi: j.upper, q: 0, rest: n.quaternion.clone() };
      });
      ['l', 'r'].forEach((s) => {
        const side = s === 'l' ? 'left' : 'right';
        chains[s] = [1, 2, 3, 4, 5, 6, 7]
          .map((i) => joints[`${side}_arm_${i}`]).filter(Boolean);
        ee[s] = rig.getObjectByName(`${side}_palm`) ||
                (chains[s].length ? chains[s][chains[s].length - 1].node : null);
      });
      /* frame the robot's upper body, which is what the demo is about */
      const box = new THREE.Box3().setFromObject(rig);
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      camera.position.set(0, mid.y + size.y * 0.22, size.z * 0.5 + size.y * 0.95);
      camera.lookAt(0, mid.y + size.y * 0.2, 0);
      ['l', 'r'].forEach((s) => {
        if (!ee[s]) return;
        ee[s].getWorldPosition(home[s]);
        target[s].copy(home[s]);
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(size.y * 0.014, 20, 20),
          new THREE.MeshStandardMaterial({ color: 0x2e7d4f, emissive: 0x2e7d4f,
                                           emissiveIntensity: 0.5 }));
        scene.add(m); dot[s] = m;
      });
      ready = true;
      window.__rcReady = { joints: chains.l.length + chains.r.length, ee: !!(ee.l && ee.r) };
    });
  }, undefined, (err) => {
    console.error('[retarget-cam] rig failed to load', err);
  });

  /* one damped CCD sweep per frame — enough to track a moving hand smoothly
     without the snap an exact solve would give */
  const _p = new THREE.Vector3(), _e = new THREE.Vector3(), _axis = new THREE.Vector3();
  function ik(side, goal, gain = 0.5, passes = 2) {
    const chain = chains[side], tip = ee[side];
    if (!tip || !chain.length) return;
    for (let it = 0; it < passes; it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const j = chain[i];
        j.node.getWorldPosition(_p);
        tip.getWorldPosition(_e);
        const toTip = _e.clone().sub(_p), toGoal = goal.clone().sub(_p);
        if (toTip.lengthSq() < 1e-8 || toGoal.lengthSq() < 1e-8) continue;
        toTip.normalize(); toGoal.normalize();
        const worldAxis = _axis.copy(j.axis)
          .applyQuaternion(j.node.getWorldQuaternion(new THREE.Quaternion())).normalize();
        /* project both directions onto the plane the joint can actually turn in */
        const a = toTip.clone().projectOnPlane(worldAxis);
        const b = toGoal.clone().projectOnPlane(worldAxis);
        if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) continue;
        a.normalize(); b.normalize();
        let ang = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
        if (a.clone().cross(b).dot(worldAxis) < 0) ang = -ang;
        j.q = Math.max(j.lo, Math.min(j.hi, j.q + ang * gain));
        j.node.quaternion.copy(j.rest)
          .multiply(new THREE.Quaternion().setFromAxisAngle(j.axis, j.q));
        j.node.updateMatrixWorld(true);
      }
    }
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
    const vr = HOST.querySelector('.rc-cam').getBoundingClientRect();
    overlay.width = Math.round(vr.width); overlay.height = Math.round(vr.height);
  }
  addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(HOST);

  /* ── pose → robot ─────────────────────────────────────────────────── */
  let landmarker = null, running = false, lastT = 0, fps = 0;
  let psi = 0, chi = 0, psi0 = null;

  async function start() {
    elState.textContent = 'loading the model…';
    let vision;
    try {
      vision = await import(/* webpackIgnore: true */ `${MP_BUNDLE}/vision_bundle.mjs`);
    } catch (e) {
      fail('Could not load the pose model (the CDN may be blocked here).');
      return;
    }
    try {
      const files = await vision.FilesetResolver.forVisionTasks(`${MP_BUNDLE}/wasm`);
      landmarker = await vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE_TASK, delegate: 'GPU' },
        runningMode: 'VIDEO', numPoses: 1
      });
    } catch (e) {
      fail('The pose model failed to start on this device.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        { video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) {
      fail('Camera permission was declined — nothing to retarget.');
      return;
    }
    video.srcObject = stream;
    await video.play();
    idle.hidden = true;
    running = true;
    resize();
    elState.textContent = 'on';
    elMode.textContent = 'tracking';
  }
  function fail(msg) {
    elState.textContent = msg;
    elState.classList.add('bad');
    seg.querySelectorAll('button').forEach(function (x) {
      x.classList.toggle('on', x.dataset.cam === 'off');
    });
    idle.hidden = false;
  }
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    if (b.dataset.cam === 'on') start(); else stop();
  });

  function stop() {
    running = false;
    elState.textContent = 'off';
    elMode.textContent = 'waiting for you';
    elMode.className = 'rc-mode';
    idle.hidden = false;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    var st = video.srcObject;
    if (st) st.getTracks().forEach(function (t) { t.stop(); });
    video.srcObject = null;
    /* hands ease back to the rest pose rather than freezing mid-reach */
    for (var s of ['l', 'r']) if (ee[s]) target[s].copy(home[s]);
  }

  function drawSkeleton(lm, w, h) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!lm) return;
    const P = (i) => [(1 - lm[i].x) * overlay.width, lm[i].y * overlay.height];
    const bones = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24]];
    octx.strokeStyle = '#F0762E'; octx.lineWidth = 4; octx.lineCap = 'round';
    bones.forEach(([a, b]) => {
      if (!lm[a] || !lm[b]) return;
      const [x0, y0] = P(a), [x1, y1] = P(b);
      octx.beginPath(); octx.moveTo(x0, y0); octx.lineTo(x1, y1); octx.stroke();
    });
    [11, 12, 13, 14, 15, 16].forEach((i) => {
      if (!lm[i]) return;
      const [x, y] = P(i);
      octx.beginPath(); octx.arc(x, y, 6, 0, 6.283);
      octx.fillStyle = (i === 15 || i === 16) ? '#2E7D4F' : '#FDF6E2';
      octx.fill(); octx.strokeStyle = '#151820'; octx.lineWidth = 2.5; octx.stroke();
      octx.strokeStyle = '#F0762E'; octx.lineWidth = 4;
    });
  }

  function step(t) {
    requestAnimationFrame(step);
    if (ready) {
      if (running && landmarker && video.readyState >= 2) {
        const res = landmarker.detectForVideo(video, t);
        const world = res.worldLandmarks && res.worldLandmarks[0];
        const px = res.landmarks && res.landmarks[0];
        drawSkeleton(px, video.videoWidth, video.videoHeight);
        if (world) mapPose(world);
      }
      ['l', 'r'].forEach((s) => {
        if (!ee[s]) return;
        ik(s, target[s], 0.45, 2);
        if (dot[s]) dot[s].position.copy(target[s]);
      });
      renderer.render(scene, camera);
    }
    if (lastT) fps = fps * 0.9 + (1000 / Math.max(1, t - lastT)) * 0.1;
    lastT = t;
    elFps.textContent = fps ? fps.toFixed(0) : '—';
    requestAnimationFrame;
  }

  function mapPose(w) {
    const ls = w[L.lShoulder], rs = w[L.rShoulder];
    if (!ls || !rs) return;
    /* anchor at the shoulder centre and scale by the operator's own build,
       so a tall and a short person drive the robot the same way */
    const anchor = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const span = Math.hypot(ls.x - rs.x, ls.y - rs.y, ls.z - rs.z) || 0.38;
    const k = SHOULDER_W / span;

    /* the torso frame, fit from the shoulder line — the same quantity the
       paper recovers analytically from head + wrists */
    const yaw = Math.atan2(rs.z - ls.z, rs.x - ls.x);
    if (psi0 === null) psi0 = yaw;
    psi = yaw - psi0;

    /* chi: how much of that yaw is body rotation rather than a glance. Both
       wrists swinging with the shoulders is intent; a still torso is gaze. */
    const lw = w[L.lWrist], rw = w[L.rWrist];
    const swing = (lw && rw)
      ? Math.min(1, Math.abs((lw.z - rw.z) / Math.max(0.08, Math.abs(lw.x - rw.x))))
      : 0;
    chi = Math.max(0, Math.min(1, Math.abs(psi) / 0.5 * (1 - swing * 0.6)));

    elPsi.textContent = (psi * 180 / Math.PI).toFixed(0) + '°';
    elChi.textContent = chi.toFixed(2);
    elMode.textContent = chi > 0.5 ? 'intent → base would turn' : 'gaze → neck only';
    elMode.className = 'rc-mode ' + (chi > 0.5 ? 'drive' : 'look');

    /* mirror image: your right hand drives the robot's right hand as you see it */
    ['l', 'r'].forEach((s) => {
      const p = w[s === 'l' ? L.lWrist : L.rWrist];
      if (!p || !ee[s]) return;
      const dx = (p.x - anchor.x) * k, dy = (p.y - anchor.y) * k, dz = (p.z - anchor.z) * k;
      /* MediaPipe: +x right, +y DOWN, +z toward camera. Robot: +y up, and the
         model faces -Z, so depth flips sign. */
      target[s].set(home[s].x - dx, home[s].y - dy, home[s].z - dz);
    });
  }

  resize();
  requestAnimationFrame(step);
}
