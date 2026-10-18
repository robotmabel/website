/* ═══════════════════════════════════════════════════════════════════
   MABEL — anatomy explorer. A ghosted, x-ray robot that keeps living
   (breath, sway, finger ripple, curious head) while the selected module
   renders solid. Mesh→module assignment walks each mesh's ancestors to
   the nearest named subsystem node. Joint values are deltas from the
   assembled pose, as everywhere else on the site.
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const box = document.getElementById('anat3d');
const canvas = document.getElementById('anatCanvas');
if (box && canvas) init();

function init() {
  /* module roots, nearest-ancestor priority (checked in this order) */
  const MODULES = [
    { key: 'hands', roots: ['l_hand_mount', 'r_hand_mount'] },
    { key: 'arms',  roots: ['l_shoulder_1', 'r_shoulder_1'] },
    { key: 'head',  roots: ['neck_1'] },
    { key: 'torso', roots: ['torso'] },
    { key: 'lift',  roots: ['lift_mid', 'lift_upper', 'lift_lower'] },
    { key: 'base',  roots: [] },        // fallback
  ];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1.4, 0.05, 80);
  scene.add(new THREE.HemisphereLight(0xfff6e4, 0xa89a82, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-2.5, 3.2, 1.8); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe9c9, 0.5); fill.position.set(2, 1.5, 1); scene.add(fill);

  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0x151820, transparent: true, opacity: 0.12,
    roughness: 0.9, metalness: 0, depthWrite: false,
  });

  let root = null, controls = null;
  const J = {};
  const meshModule = new Map();   // mesh -> module key
  const origMat = new Map();      // mesh -> original material
  let active = 'all';

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

    /* name → module resolution */
    const rootOf = {};
    for (const m of MODULES) for (const r of m.roots) rootOf[r] = m.key;
    root.traverse((n) => {
      if (!n.isMesh) return;
      let p = n, mod = 'base';
      while (p) {
        if (rootOf[p.name]) { mod = rootOf[p.name]; break; }
        p = p.parent;
      }
      meshModule.set(n, mod);
      origMat.set(n, n.material);
    });

    fetch('assets/mabel_joints.json').then((r) => r.json()).then((data) => {
      for (const j of data.joints) {
        const node = root.getObjectByName(j.node);
        if (!node) continue;
        J[j.name] = { n: node, type: j.type, p0: node.position.clone(), q0: node.quaternion.clone(),
          ax: new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize(), lo: j.lower, hi: j.upper };
      }
    }).catch(() => {}).finally(() => {
      buildModuleBoxes();
      const full = moduleBox.all;
      const h = full.getSize(new THREE.Vector3()).y || 1;
      controls = new OrbitControls(camera, renderer.domElement);
      controls.addEventListener('start', () => { userTouched = true; });
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = h * 0.45; controls.maxDistance = h * 6;
      focus('all', true);
      box.classList.add('loaded');
      apply();
      const want = new URLSearchParams(location.search).get('mod');
      if (want && moduleBox[want]) {
        const btn = document.querySelector('.anat-rail [data-module="' + want + '"]');
        if (btn) btn.click();
      }
    });
  }, undefined, () => {
    const l = box.querySelector('.ph-label');
    if (l) l.textContent = 'Rig failed to load — try a hard refresh';
  });

  /* per-module world-space bounds (assembled pose) */
  const moduleBox = {};
  function buildModuleBoxes() {
    root.updateWorldMatrix(true, true);
    moduleBox.all = new THREE.Box3().setFromObject(root);
    meshModule.forEach((mod, mesh) => {
      const b = new THREE.Box3().setFromObject(mesh);
      if (!moduleBox[mod]) moduleBox[mod] = b.clone();
      else moduleBox[mod].union(b);
    });
  }

  /* fly the camera so the module is the orbit centre, framed so the whole
     robot still fits.
     FIT THE BOX, NOT ITS BOUNDING SPHERE. MABEL is tall and thin — about
     1.5 m high, 1.0 m across, 0.6 m deep — so the sphere radius
     (|size|/2 ≈ 0.95 m) is a third larger than the half-height that actually
     limits the view (0.75 m), and fitting to it pushed the camera back far
     enough to leave the robot a small figure in the middle of its own canvas.
     Constrain each screen axis by the extent that really reaches it: the
     half-height vertically, and the XZ diagonal horizontally (the silhouette
     width sweeps between w and d as you orbit in yaw, bounded by the
     diagonal), then stand back far enough to satisfy both. */
  let tween = null;
  function fitBox(size) {
    const vf = (camera.fov / 2) * Math.PI / 180;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    const halfH = size.y / 2;
    /* the silhouette half-width sweeps between x/2 and z/2 as you orbit in
       yaw; the XZ diagonal bounds it, and bounds the half-DEPTH too */
    const halfW = Math.hypot(size.x, size.z) / 2;
    /* + halfW because the distance is measured to the box's CENTRE while the
       near face sits half a depth closer and is magnified accordingly.
       Without it the fit frames the centre plane exactly and the near face
       overflows: measured, the rig projected to 1.27x the frame height —
       clipped top and bottom — from a formula that looked correct. */
    return (Math.max(halfH / Math.tan(vf), halfW / Math.tan(hf)) + halfW) * 1.10;
  }
  function focus(key, instant) {
    const mb = moduleBox[key] || moduleBox.all;
    const full = moduleBox.all;
    const target = mb.getCenter(new THREE.Vector3());
    if (key === 'all' && moduleBox.base) {
      /* orbit about the base's true axis, half-way up the body — the raw
         bounds centre drifts with antennas and arm pose */
      const bc = moduleBox.base.getCenter(new THREE.Vector3());
      target.x = bc.x; target.z = bc.z;
    }
    const fullD = fitBox(full.getSize(new THREE.Vector3()));
    const modD = fitBox(mb.getSize(new THREE.Vector3()));
    /* zoom toward the part, but never so far in that the body is lost */
    const dist = key === 'all' ? fullD : Math.max(modD * 1.35, fullD * 0.72);
    /* keep the current viewing direction (or the canonical front on boot) */
    let dir;
    if (instant || !controls) {
      dir = new THREE.Vector3(-1, 0.12, 0.45).normalize();
    } else {
      dir = camera.position.clone().sub(controls.target).normalize();
      if (!dir.lengthSq()) dir = new THREE.Vector3(-1, 0.12, 0.45).normalize();
    }
    const pos = target.clone().add(dir.multiplyScalar(dist));
    if (instant) {
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    tween = {
      p0: camera.position.clone(), p1: pos,
      t0: controls.target.clone(), t1: target,
      start: performance.now(), dur: 900,
    };
    controls.enabled = false;
  }
  const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

  function apply() {
    meshModule.forEach((mod, mesh) => {
      mesh.material = (active === 'all' || mod === active) ? origMat.get(mesh) : ghostMat;
    });
  }

  /* rail wiring */
  document.querySelectorAll('.anat-rail [data-module]').forEach((btn) => {
    btn.addEventListener('click', () => {
      active = btn.dataset.module;
      document.querySelectorAll('.anat-rail [data-module]').forEach((b) =>
        b.classList.toggle('on', b === btn));
      document.querySelectorAll('.anat-copy [data-copy]').forEach((c) =>
        c.hidden = c.dataset.copy !== active);
      if (root) { apply(); focus(active, false); }
    });
  });

  let userTouched = false;
  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (root && controls && !userTouched && !tween) focus(active, true);
  }
  addEventListener('resize', resize, { passive: true });
  resize();

  const setJ = (name, val) => {
    const j = J[name]; if (!j) return;
    val = Math.min(j.hi, Math.max(j.lo, val));
    if (j.type === 'prismatic') {
      j.n.position.copy(j.p0).add(j.ax.clone().applyQuaternion(j.q0).multiplyScalar(val));
      j.n.quaternion.copy(j.q0);
    } else {
      j.n.quaternion.copy(j.q0).multiply(new THREE.Quaternion().setFromAxisAngle(j.ax, val));
      j.n.position.copy(j.p0);
    }
  };

  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (!root) return;
    const t = (performance.now() - t0) / 1000;
    const breathe = Math.sin(t * 0.55) * 0.006;
    setJ('lift_lower', breathe); setJ('lift_upper', breathe);
    setJ('torso', Math.sin(t * 0.17) * 0.02);
    setJ('neck_yaw', Math.sin(t * 0.31) * 0.45 + Math.sin(t * 0.13) * 0.2);
    setJ('neck_pitch', Math.sin(t * 0.21 + 1.3) * 0.15);
    setJ('left_arm_1', Math.sin(t * 0.42) * 0.06);
    setJ('right_arm_1', Math.sin(t * 0.42 + 2.4) * 0.06);
    setJ('left_arm_4', 0.08 + Math.sin(t * 0.36 + 1.1) * 0.06);
    setJ('right_arm_4', -0.08 - Math.sin(t * 0.36) * 0.06);
    setJ('left_wrist', Math.sin(t * 0.44 + 0.4) * 0.09);
    setJ('right_wrist', Math.sin(t * 0.44 + 2.1) * 0.09);
    for (const side of ['left', 'right']) {
      const ph = side === 'left' ? 0 : 1.4;
      ['index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
        const curl = 0.22 + 0.2 * Math.sin(t * 1.1 + ph + i * 0.7);
        setJ(`${side}_${f}_mcp`, curl); setJ(`${side}_${f}_pip`, curl * 0.85);
      });
      setJ(`${side}_thumb_mcp`, 0.1 + 0.08 * Math.sin(t * 0.9 + ph));
    }
    if (tween) {
      const u = Math.min(1, (performance.now() - tween.start) / tween.dur);
      const e = easeInOut(u);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      camera.lookAt(controls.target);
      if (u >= 1) {
        tween = null;
        controls.enabled = true;
        controls.update();
      }
    } else if (controls) controls.update();
    renderer.render(scene, camera);
  });

  /* A HOOK FOR MEASUREMENT. How much of its canvas the rig fills is a
     question about the live camera, and a screenshot cannot answer it —
     the same picture looks "about right" whether the robot fills 60% of
     the frame or 85%. scripts/anatfill.py projects these bounds. */
  window.__anat = { scene, camera, THREE, moduleBox,
                    get root() { return root; },
                    get controls() { return controls; } };
}
