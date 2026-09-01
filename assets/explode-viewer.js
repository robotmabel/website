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
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// subsystem → { node to offset, world-space explode direction·distance(m), label, blurb }
const PARTS = [
  { key: 'head',  node: 'neck_1',           off: [0, 0.52, 0], label: 'Active head',
    blurb: 'Pan / tilt / roll neck carrying a stereo RGB-D camera — active perception that aims the gaze where the task is.' },
  { key: 'torso', node: 'torso',            off: [0, 0.22, 0],     label: 'Torso & screen',
    blurb: 'Tilting torso with a 13″ touchscreen chest. Leans MABEL in to look and doubles the workspace with the lift.' },
  { key: 'lift',  node: 'lift_mid',         off: [0, 0.16, 0],     label: 'Lift column',
    blurb: 'Cascaded standing-desk lift — ~0.64 m of vertical travel for floor-to-counter reach.' },
  { key: 'larm',  node: 'l_shoulder_1',     off: [0, 0.10, 0.55], label: 'Left arm · 7-DOF',
    blurb: 'Backdriveable 7-DOF arm derived from OpenArm, with an eye-in-hand wrist camera.' },
  { key: 'rarm',  node: 'r_shoulder_1',     off: [0, 0.10, -0.55],  label: 'Right arm · 7-DOF',
    blurb: 'Twin of the left arm — tuned for bimanual coordination across the body midline.' },
  { key: 'lhand', node: 'l_hand_mount',     off: [0, 0.02, 0.95], label: 'Left ORCA hand',
    blurb: '16 finger DOF + an active wrist roll, tendon-driven. Pinch, grasp, knock — no end-effector swaps.' },
  { key: 'rhand', node: 'r_hand_mount',     off: [0, 0.02, -0.95],  label: 'Right ORCA hand',
    blurb: 'Second 17-DOF ORCA hand with soft, tactile-ready fingertip pads.' },
  { key: 'fl',    node: 'fl_swerve_housing', off: [0, -0.16, 0.30], label: 'Swerve module',
    blurb: 'One of three independent swerve modules — true holonomic motion: strafe, spin in place, hold a heading.' },
  { key: 'fr',    node: 'fr_swerve_housing', off: [0, -0.16, -0.30],  label: 'Swerve base · ×3',
    blurb: 'Three-module holonomic base with 2D LiDAR underneath for SLAM. < $10k of the whole platform.' },
  { key: 'b',     node: 'b_swerve_housing',  off: [-0.34, -0.16, 0],      label: 'Rear module + LiDAR',
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
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1.6, 0.01, 200);
  camera.position.set(1.4, 1.1, 1.8);
  let baseDist = 2;   // assembled camera distance; the loop dollies out as parts explode

  scene.add(new THREE.HemisphereLight(0xfff6e4, 0xa89a82, 1.5));
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
  ((l) => (l.setMeshoptDecoder(MeshoptDecoder), l))(new GLTFLoader()).load('assets/mabel_rig.glb', (gltf) => {
    root = gltf.scene;
  /* comic-book material lift (matches hero-rig) */
  (function comicize(rt) {
    const seen = new Set();
    rt.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => {
        if (!m.color || seen.has(m.uuid)) return;
        seen.add(m.uuid);
        const hsl = { h: 0, s: 0, l: 0 };
        m.color.getHSL(hsl);
        m.color.setHSL(hsl.h, hsl.s > 0.05 ? Math.min(1, hsl.s * 1.15) : hsl.s,
          Math.min(0.93, 0.30 + hsl.l * 1.55));
        if ('roughness' in m) m.roughness = Math.max(0.55, m.roughness ?? 0.8);
        if ('metalness' in m) m.metalness = Math.min(0.25, m.metalness ?? 0);
      });
    });
  })(root);

    scene.add(root);
    const bb = new THREE.Box3().setFromObject(root);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    const maxd = Math.max(sz.x, sz.y, sz.z) || 1;
    controls.target.copy(c);
    // start on the robot's face: front is -X (verified) → a front 3/4 view
    camera.position.copy(c).add(new THREE.Vector3(-maxd * 1.3, maxd * 0.45, maxd * 0.6));
    camera.near = maxd / 100; camera.far = maxd * 60; camera.updateProjectionMatrix();
    baseDist = camera.position.distanceTo(c);   // assembled framing; loop dollies out as it explodes
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

  const _dir = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    controls.update();
    const ef = smooth(factor);
    applyExplode(ef);
    // dolly the camera out as the model explodes so every part stays in frame
    _dir.copy(camera.position).sub(controls.target);
    if (_dir.lengthSq() > 1e-6) {
      camera.position.copy(controls.target).addScaledVector(_dir.normalize(), baseDist * (1 + ef * 1.05));
    }
    renderer.render(scene, camera);
    placeLabels(ef);
  });
}
