/* ═══════════════════════════════════════════════════════════════════
   MABEL — scroll-driven EXPLODED VIEW
   The articulated rig GLB, pulled apart by subsystem as you scroll. Each
   subsystem translates along a world-space direction (converted into its
   parent's local frame each frame so it stays correct while the model spins),
   and a tracking callout label is projected onto the screen. Drag to orbit;
   click a callout to read about that subsystem.
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// subsystem → { node to offset, world-space explode direction·distance(m), label, blurb }
const PARTS = [
  { key: 'head',  node: 'neck_1',           off: [0, 0.58, -0.04], label: 'Active head',
    blurb: 'Pan / tilt / roll neck carrying a stereo RGB-D camera — active perception that aims the gaze where the task is.' },
  { key: 'torso', node: 'torso',            off: [0, 0.30, 0],     label: 'Torso & screen',
    blurb: 'Tilting torso with a 13″ touchscreen chest. Leans MABEL in to look and doubles the workspace with the lift.' },
  { key: 'lift',  node: 'lift_mid',         off: [0, 0.16, 0],     label: 'Lift column',
    blurb: 'Cascaded standing-desk lift — ~0.64 m of vertical travel for floor-to-counter reach.' },
  { key: 'larm',  node: 'l_shoulder_1',     off: [-0.46, 0.06, 0.04], label: 'Left arm · 7-DOF',
    blurb: 'Backdriveable 7-DOF arm derived from OpenArm, with an eye-in-hand wrist camera.' },
  { key: 'rarm',  node: 'r_shoulder_1',     off: [0.46, 0.06, 0.04],  label: 'Right arm · 7-DOF',
    blurb: 'Twin of the left arm — tuned for bimanual coordination across the body midline.' },
  { key: 'lhand', node: 'l_hand_mount',     off: [-0.30, -0.04, 0.12], label: 'Left ORCA hand',
    blurb: '16 finger DOF + an active wrist roll, tendon-driven. Pinch, grasp, knock — no end-effector swaps.' },
  { key: 'rhand', node: 'r_hand_mount',     off: [0.30, -0.04, 0.12],  label: 'Right ORCA hand',
    blurb: 'Second 17-DOF ORCA hand with soft, tactile-ready fingertip pads.' },
  { key: 'fl',    node: 'fl_swerve_housing', off: [-0.20, -0.14, -0.14], label: 'Swerve module',
    blurb: 'One of three independent swerve modules — true holonomic motion: strafe, spin in place, hold a heading.' },
  { key: 'fr',    node: 'fr_swerve_housing', off: [0.20, -0.14, -0.14],  label: 'Swerve base · ×3',
    blurb: 'Three-module holonomic base with 2D LiDAR underneath for SLAM. < $10k of the whole platform.' },
  { key: 'b',     node: 'b_swerve_housing',  off: [0, -0.14, 0.24],      label: 'Rear module + LiDAR',
    blurb: 'Rear swerve module; the chassis carries the LiDAR and power distribution PCB.' },
];

const box = document.getElementById('explode3d');
const canvas = document.getElementById('explodeCanvas');
if (box && canvas) init();

function init() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1.6, 0.01, 200);
  camera.position.set(1.4, 1.1, 1.8);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d867b, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(2.5, 3.5, 2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55); fill.position.set(-2.5, 1.2, -1.5); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe6cf, 0.6); rim.position.set(0, 1.8, -3.2); scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;        // let the wheel scroll the page
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.minDistance = 0.5;
  controls.maxDistance = 8;
  controls.target.set(0, 0.55, 0);

  let idle;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idle); });
  controls.addEventListener('end', () => { clearTimeout(idle); idle = setTimeout(() => { controls.autoRotate = true; }, 4000); });

  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(box);
  window.addEventListener('resize', resize);
  resize();

  // ── tracking callout labels ──────────────────────────────────────
  const layer = document.getElementById('explodeLabels');
  const labels = {};
  if (layer) {
    for (const p of PARTS) {
      const el = document.createElement('button');
      el.className = 'xp-label';
      el.type = 'button';
      el.innerHTML = `<span class="xp-dot"></span><span class="xp-txt">${p.label}</span>`;
      el.addEventListener('click', () => selectPart(p.key));
      layer.appendChild(el);
      labels[p.key] = el;
    }
  }

  function selectPart(k) {
    const p = PARTS.find((x) => x.key === k); if (!p) return;
    const t = document.getElementById('explodeTitle');
    const d = document.getElementById('explodeBlurb');
    if (t) t.textContent = p.label;
    if (d) d.textContent = p.blurb;
    Object.entries(labels).forEach(([kk, el]) => el.classList.toggle('on', kk === k));
  }

  let root = null;
  new GLTFLoader().load('assets/mabel_rig.glb', (gltf) => {
    root = gltf.scene;
    scene.add(root);
    const bb = new THREE.Box3().setFromObject(root);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    const maxd = Math.max(sz.x, sz.y, sz.z) || 1;
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(maxd * 0.9, maxd * 0.5, maxd * 1.3));
    camera.near = maxd / 100; camera.far = maxd * 60; camera.updateProjectionMatrix();
    controls.update();

    for (const p of PARTS) {
      const n = root.getObjectByName(p.node);
      if (!n) continue;
      p._n = n; p._p0 = n.position.clone();
      p._dir = new THREE.Vector3(p.off[0], p.off[1], p.off[2]);
    }
    box.classList.add('loaded');
  }, undefined, (err) => console.error('explode rig failed', err));

  // ── scroll → explode factor ──────────────────────────────────────
  let factor = 0;
  const scroller = document.getElementById('explodeScroll');
  function onScroll() {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const len = scroller.offsetHeight - window.innerHeight;
    const p = len > 0 ? (-rect.top) / len : 0;
    factor = Math.min(1, Math.max(0, p));
    const pct = document.getElementById('explodePct');
    if (pct) pct.textContent = Math.round(factor * 100) + '%';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  const smooth = (x) => x * x * (3 - 2 * x);   // smoothstep ease

  const pq = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  function applyExplode(f) {
    if (!root) return;
    for (const p of PARTS) {
      if (!p._n) continue;
      p._n.parent.getWorldQuaternion(pq).invert();
      tmp.copy(p._dir).applyQuaternion(pq).multiplyScalar(f);
      p._n.position.copy(p._p0).add(tmp);
    }
    root.updateMatrixWorld(true);
  }

  function placeLabels(f) {
    const w = box.clientWidth, h = box.clientHeight;
    const vis = f > 0.04;
    for (const p of PARTS) {
      const el = labels[p.key]; if (!el || !p._n) continue;
      if (!vis) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; continue; }
      p._n.getWorldPosition(ndc); ndc.project(camera);
      const x = (ndc.x * 0.5 + 0.5) * w;
      const y = (-ndc.y * 0.5 + 0.5) * h;
      const onScreen = ndc.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
      el.style.opacity = onScreen ? String(Math.min(1, (f - 0.04) / 0.12)) : '0';
      el.style.pointerEvents = onScreen ? 'auto' : 'none';
      el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    }
  }

  renderer.setAnimationLoop(() => {
    controls.update();
    applyExplode(smooth(factor));
    renderer.render(scene, camera);
    placeLabels(smooth(factor));
  });
}
