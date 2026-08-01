/* ═══════════════════════════════════════════════════════════════════
   MABEL — articulated 3D viewer
   THREE.js + hierarchical GLB (node per link) + joint manifest from URDF.
   Drag/zoom (OrbitControls), idle auto-rotate, full-screen, and grouped
   joint sliders (Hands / Arms / Body / Base) whose ranges come straight
   from mabel_full.urdf.
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const box = document.getElementById('robot3d');
const canvas = document.getElementById('robotCanvas');
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
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.85;
  controls.minDistance = 0.4;
  controls.maxDistance = 8;
  controls.target.set(0, 0.5, 0);

  // idle → resume auto-rotate
  let idle;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idle); });
  controls.addEventListener('end', () => { clearTimeout(idle); idle = setTimeout(() => { controls.autoRotate = true; }, 3500); });

  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(box);
  document.addEventListener('fullscreenchange', () => setTimeout(resize, 60));
  window.addEventListener('resize', resize);
  resize();

  let root = null;
  const joints = [];
  new GLTFLoader().load('assets/mabel_rig.glb', (gltf) => {
    root = gltf.scene;
    scene.add(root);
    const bb = new THREE.Box3().setFromObject(root);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    const maxd = Math.max(sz.x, sz.y, sz.z) || 1;
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(maxd * 0.85, maxd * 0.5, maxd * 1.25));
    camera.near = maxd / 100; camera.far = maxd * 60; camera.updateProjectionMatrix();
    controls.update();
    box.classList.add('loaded');
    loadJoints();
  }, undefined, (err) => { console.error('MABEL rig failed to load', err); });

  function setJoint(j, val) {
    const n = j._n;
    if (j.type === 'prismatic') {
      n.position.copy(j._p0).add(j._ax.clone().applyQuaternion(j._q0).multiplyScalar(val));
      n.quaternion.copy(j._q0);
    } else {
      n.quaternion.copy(j._q0).multiply(new THREE.Quaternion().setFromAxisAngle(j._ax, val));
      n.position.copy(j._p0);
    }
  }

  async function loadJoints() {
    let data;
    try { data = await fetch('assets/mabel_joints.json').then((r) => r.json()); }
    catch (e) { return; }
    for (const j of data.joints) {
      const node = root.getObjectByName(j.node);
      if (!node) continue;
      j._n = node;
      j._p0 = node.position.clone();
      j._q0 = node.quaternion.clone();
      j._ax = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize();
      joints.push(j);
    }
    buildUI();
  }

  function buildUI() {
    const tabsEl = document.getElementById('jpTabs');
    const listEl = document.getElementById('jpList');
    const panel = document.getElementById('jointPanel');
    if (!tabsEl || !listEl || !panel) return;
    panel.classList.add('ready');

    const groups = [
      ['hands', 'Hands'], ['arms', 'Arms'], ['body', 'Body'], ['base', 'Base'],
    ];
    const rows = {};   // group -> [{j, slider, valEl}]
    const fmt = (j, v) => j.type === 'prismatic'
      ? (v * 100).toFixed(1) + ' cm'
      : (v * 180 / Math.PI).toFixed(0) + '°';

    groups.forEach(([g, label], gi) => {
      const btn = document.createElement('button');
      btn.className = 'jp-tab' + (gi === 0 ? ' on' : '');
      btn.textContent = label;
      btn.dataset.g = g;
      tabsEl.appendChild(btn);

      const pane = document.createElement('div');
      pane.className = 'jp-pane' + (gi === 0 ? ' on' : '');
      pane.dataset.g = g;
      rows[g] = [];

      joints.filter((j) => j.group === g).forEach((j) => {
        const lo = (j.lower != null) ? j.lower : -Math.PI;
        const hi = (j.upper != null) ? j.upper : Math.PI;
        const def = Math.min(hi, Math.max(lo, 0));
        const row = document.createElement('div');
        row.className = 'jp-row';
        const top = document.createElement('div');
        top.className = 'jp-row-top';
        const nm = document.createElement('span'); nm.className = 'jp-name'; nm.textContent = pretty(j.name);
        const vl = document.createElement('span'); vl.className = 'jp-val'; vl.textContent = fmt(j, def);
        top.appendChild(nm); top.appendChild(vl);
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = lo; sl.max = hi; sl.step = (hi - lo) / 240; sl.value = def;
        sl.className = 'jp-slider';
        sl.addEventListener('input', () => { const v = parseFloat(sl.value); setJoint(j, v); vl.textContent = fmt(j, v); });
        row.appendChild(top); row.appendChild(sl);
        pane.appendChild(row);
        rows[g].push({ j, sl, vl, def });
        setJoint(j, def);
      });

      listEl.appendChild(pane);
    });

    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.jp-tab'); if (!b) return;
      tabsEl.querySelectorAll('.jp-tab').forEach((x) => x.classList.toggle('on', x === b));
      listEl.querySelectorAll('.jp-pane').forEach((p) => p.classList.toggle('on', p.dataset.g === b.dataset.g));
    });

    const reset = document.getElementById('jpReset');
    if (reset) reset.addEventListener('click', () => {
      Object.values(rows).flat().forEach(({ j, sl, vl, def }) => {
        sl.value = def; setJoint(j, def); vl.textContent = fmt(j, def);
      });
    });

    const toggle = document.getElementById('jpToggle');
    if (toggle) toggle.addEventListener('click', () => panel.classList.toggle('collapsed'));
  }

  function pretty(name) {
    return name.replace(/_/g, ' ').replace(/\bl\b/, 'left').replace(/\br\b/, 'right');
  }

  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}
