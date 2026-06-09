/* ═══════════════════════════════════════════════════════════════════
   MABEL — Whole-Body-Control interactive viewers
   THREE.js + the articulated rig GLB (one node per joint) driven two ways:

     data-wbc-viewer="compliance"
        Grab a hand and drag it. The arm complies (constrained CCD IK
        follows the grab). Toggle GRAVITY-COMP (stays where you leave it)
        vs COMPLIANCE (a virtual spring pulls it home when you release).

     data-wbc-viewer="operate"
        No pushing — you command the controller. A 3-way toggle:
          NAV    velocity / angular-velocity / lift sliders drive the base
          ARM    a virtual joystick + Z slider move a GREEN wrist target;
                 the left arm tracks it with IK (base + lift held)
          WHOLE  same green target, but a lazy base follows and the lift
                 engages to keep the hand reachable

   Shared kinematics: forward kinematics from the GLB hierarchy + a
   hinge-constrained Cyclic-Coordinate-Descent solver on each 7-DOF arm.
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const RUST = 0xC25B2A;
const GREEN = 0x3FB56B;

class WbcViewer {
  constructor(box) {
    this.box = box;
    this.kind = box.dataset.wbcViewer;            // 'compliance' | 'operate'
    this.canvas = box.querySelector('canvas');
    if (!this.canvas) return;

    this.ready = false;
    this.joints = {};                              // name -> joint record
    this.q = {};                                   // name -> current value
    this.armChains = { l: [], r: [] };             // shoulder..wrist joint names
    this.targets = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.rest = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.active = { l: false, r: false };          // is this hand IK-driven?

    this._initScene();
    this._loadRig();
    this._raf();
  }

  /* ── three.js scaffold ───────────────────────────────────────────── */
  _initScene() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(35, 1.6, 0.01, 200);
    camera.position.set(1.4, 1.1, 1.8);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d867b, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(2.5, 3.5, 2); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55); fill.position.set(-2.5, 1.2, -1.5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe6cf, 0.6); rim.position.set(0, 1.8, -3.2); scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.7;
    controls.minDistance = 0.5;
    controls.maxDistance = 8;
    controls.target.set(0, 0.6, 0);
    this.controls = controls;

    let idle;
    const wake = () => { controls.autoRotate = false; clearTimeout(idle); };
    const sleep = () => { clearTimeout(idle); idle = setTimeout(() => { controls.autoRotate = true; }, 4000); };
    controls.addEventListener('start', wake);
    controls.addEventListener('end', sleep);
    this._wake = wake; this._sleep = sleep;

    const resize = () => {
      const w = this.box.clientWidth, h = this.box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(this.box);
    document.addEventListener('fullscreenchange', () => setTimeout(resize, 60));
    window.addEventListener('resize', resize);
    resize();
  }

  _loadRig() {
    new GLTFLoader().load('assets/mabel_rig.glb', (gltf) => {
      const root = gltf.scene;
      this.root = root;
      this.scene.add(root);

      const bb = new THREE.Box3().setFromObject(root);
      const c = bb.getCenter(new THREE.Vector3());
      const sz = bb.getSize(new THREE.Vector3());
      const maxd = Math.max(sz.x, sz.y, sz.z) || 1;
      this.maxd = maxd;
      this.controls.target.copy(c);
      this.camera.position.copy(c).add(new THREE.Vector3(maxd * 0.8, maxd * 0.42, maxd * 1.25));
      this.camera.near = maxd / 100; this.camera.far = maxd * 60; this.camera.updateProjectionMatrix();
      this.controls.update();

      // remember the root's spawn transform so NAV can drive it cleanly
      root.updateMatrixWorld(true);
      this._rootP0 = root.position.clone();
      this._rootQ0 = root.quaternion.clone();
      this.baseOffset = new THREE.Vector3();
      this.baseYaw = 0;

      this.box.classList.add('loaded');
      this._loadJoints();
    }, undefined, (err) => console.error('MABEL rig failed to load', err));
  }

  async _loadJoints() {
    let data;
    try { data = await fetch('assets/mabel_joints.json').then((r) => r.json()); }
    catch (e) { return; }

    for (const j of data.joints) {
      const node = this.root.getObjectByName(j.node);
      if (!node) continue;
      j._n = node;
      j._p0 = node.position.clone();
      j._q0 = node.quaternion.clone();
      j._ax = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize();
      this.joints[j.name] = j;
      this.q[j.name] = (j.lower != null && j.upper != null)
        ? Math.min(j.upper, Math.max(j.lower, 0)) : 0;
      this._set(j.name, this.q[j.name]);
    }
    this.armChains.l = ['left_arm_1','left_arm_2','left_arm_3','left_arm_4','left_arm_5','left_arm_6','left_arm_7']
      .filter((n) => this.joints[n]);
    this.armChains.r = ['right_arm_1','right_arm_2','right_arm_3','right_arm_4','right_arm_5','right_arm_6','right_arm_7']
      .filter((n) => this.joints[n]);
    // End-effector = the PALM body the real controller tracks (mabel/wbc.py
    // commands left_palm / right_palm), not the hand_mount link.
    this.eeNode = {
      l: this.root.getObjectByName('left_palm') || this.joints['left_arm_7']?._n,
      r: this.root.getObjectByName('right_palm') || this.joints['right_arm_7']?._n,
    };

    this.root.updateMatrixWorld(true);
    for (const s of ['l', 'r']) {
      if (this.eeNode[s]) {
        this.eeNode[s].getWorldPosition(this.rest[s]);
        this.targets[s].copy(this.rest[s]);
      }
    }

    if (this.kind === 'compliance') this._initCompliance();
    else this._initOperate();
    this.ready = true;
  }

  /* ── joint setter (revolute + prismatic) ─────────────────────────── */
  _set(name, val) {
    const j = this.joints[name]; if (!j) return;
    this.q[name] = val;
    const n = j._n;
    if (j.type === 'prismatic') {
      n.position.copy(j._p0).add(j._ax.clone().applyQuaternion(j._q0).multiplyScalar(val));
      n.quaternion.copy(j._q0);
    } else {
      n.quaternion.copy(j._q0).multiply(new THREE.Quaternion().setFromAxisAngle(j._ax, val));
      n.position.copy(j._p0);
    }
  }

  /* ── hinge-constrained CCD: drive arm `side` so its EE reaches `goal` ─ */
  _ik(side, goal, gain = 0.5, passes = 2) {
    const chain = this.armChains[side];
    const ee = this.eeNode[side];
    if (!ee || !chain.length) return;
    const piv = new THREE.Vector3(), eeW = new THREE.Vector3();
    const axW = new THREE.Vector3(), pq = new THREE.Quaternion();
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), cr = new THREE.Vector3();

    for (let p = 0; p < passes; p++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const j = this.joints[chain[i]];
        const n = j._n;
        n.getWorldPosition(piv);
        ee.getWorldPosition(eeW);
        // hinge axis in world = parentWorldQuat * q0 * localAxis
        n.parent.getWorldQuaternion(pq);
        axW.copy(j._ax).applyQuaternion(j._q0).applyQuaternion(pq).normalize();

        v1.subVectors(eeW, piv); v1.addScaledVector(axW, -v1.dot(axW));
        v2.subVectors(goal, piv); v2.addScaledVector(axW, -v2.dot(axW));
        if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) continue;
        v1.normalize(); v2.normalize();
        const ang = Math.atan2(cr.crossVectors(v1, v2).dot(axW), v1.dot(v2)) * gain;
        let nv = this.q[chain[i]] + ang;
        if (j.lower != null) nv = Math.max(j.lower, Math.min(j.upper, nv));
        this._set(chain[i], nv);
        n.updateWorldMatrix(false, true);
      }
    }
  }

  // relax an arm toward its zero pose (used when a hand isn't being driven)
  _relax(side, k = 0.04) {
    for (const name of this.armChains[side]) {
      const j = this.joints[name];
      const home = (j.lower != null) ? Math.min(j.upper, Math.max(j.lower, 0)) : 0;
      this._set(name, this.q[name] + (home - this.q[name]) * k);
    }
  }

  /* ── pointer → world point on the screen-facing plane through `anchor` ─ */
  _planePoint(ev, anchor) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  /* ═══ COMPLIANCE viewer ═══════════════════════════════════════════ */
  _initCompliance() {
    // draggable handle at each hand
    this.handles = {};
    for (const s of ['l', 'r']) {
      if (!this.eeNode[s]) continue;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(this.maxd * 0.028, 24, 24),
        new THREE.MeshStandardMaterial({ color: RUST, emissive: RUST, emissiveIntensity: 0.35, roughness: 0.45 }),
      );
      m.userData.side = s;
      this.scene.add(m);
      this.handles[s] = m;
    }
    // external-force arrow (shown while dragging)
    this.forceArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.0001, RUST, 0.05, 0.03);
    this.forceArrow.visible = false;
    this.scene.add(this.forceArrow);

    this.mode = 'gravity';                 // 'gravity' | 'compliance'
    this.drag = null;                      // active side while dragging
    this._wireComplianceUI();
    this._wireGrab();
  }

  _wireComplianceUI() {
    const seg = this.box.querySelector('[data-wbc-segments]');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.mode = b.dataset.mode;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this._setStatus(b.dataset.mode === 'gravity'
        ? 'Back-drivable — the hand holds wherever you leave it.'
        : 'Spring-loaded — release and it returns to its rest pose.');
    });
  }

  _wireGrab() {
    const dom = this.renderer.domElement;
    // capture phase so we can veto OrbitControls before it rotates
    dom.addEventListener('pointerdown', (ev) => {
      const r = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects(Object.values(this.handles), false);
      if (!hits.length) return;
      const s = hits[0].object.userData.side;
      this.drag = s;
      this.active[s] = true;
      this.controls.enabled = false;
      this._wake();
      this.box.classList.add('grabbing');
      ev.stopPropagation();
    }, true);

    const move = (ev) => {
      if (!this.drag) return;
      const s = this.drag;
      const pt = this._planePoint(ev, this.targets[s]);
      if (pt) this.targets[s].copy(pt);
    };
    const up = () => {
      if (!this.drag) return;
      this.drag = null;
      this.controls.enabled = true;
      this._sleep();
      this.box.classList.remove('grabbing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _stepCompliance() {
    for (const s of ['l', 'r']) {
      if (!this.eeNode[s]) continue;
      // compliance mode: when not being dragged, a virtual spring pulls home
      if (this.mode === 'compliance' && this.drag !== s && this.active[s]) {
        this.targets[s].lerp(this.rest[s], 0.06);
        if (this.targets[s].distanceTo(this.rest[s]) < this.maxd * 0.004) this.active[s] = false;
      }
      if (this.active[s]) this._ik(s, this.targets[s], 0.55, 2);
      // keep the handle glued to the (possibly lagging) hand
      const ee = new THREE.Vector3(); this.eeNode[s].getWorldPosition(ee);
      this.handles[s].position.copy(ee);
    }
    // force arrow from rest -> current grabbed hand
    if (this.drag) {
      const ee = new THREE.Vector3(); this.eeNode[this.drag].getWorldPosition(ee);
      const d = new THREE.Vector3().subVectors(ee, this.rest[this.drag]);
      const len = d.length();
      if (len > 1e-3) {
        this.forceArrow.position.copy(this.rest[this.drag]);
        this.forceArrow.setDirection(d.clone().normalize());
        this.forceArrow.setLength(len, Math.min(0.06, len * 0.4), Math.min(0.035, len * 0.25));
        this.forceArrow.visible = true;
      }
    } else {
      this.forceArrow.visible = false;
    }
  }

  /* ═══ OPERATE viewer ══════════════════════════════════════════════ */
  _initOperate() {
    this.opMode = 'nav';                   // 'nav' | 'arm' | 'whole'
    this.hand = 'l';                       // which palm the joystick edits
    this.nav = { vx: 0, vy: 0, w: 0, lift: 0 };
    this.wheel = 0;                        // accumulated drive-wheel spin
    this.pad = { x: 0, y: 0 };             // joystick, [-1,1]
    // per-hand Cartesian offset of the palm target from its home, metres
    this.armOff = { l: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 } };

    // green PALM tracking point — one per hand (the real controller tracks both)
    this.gTarget = { l: new THREE.Vector3().copy(this.rest.l), r: new THREE.Vector3().copy(this.rest.r) };
    this.gHome = { l: new THREE.Vector3().copy(this.rest.l), r: new THREE.Vector3().copy(this.rest.r) };
    this.greenDot = {};
    for (const s of ['l', 'r']) {
      const g = new THREE.Mesh(
        new THREE.SphereGeometry(this.maxd * 0.024, 24, 24),
        new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 0.55, roughness: 0.4 }),
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(this.maxd * 0.032, this.maxd * 0.038, 32),
        new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      g.add(ring);
      g.position.copy(this.gHome[s]);
      this.scene.add(g);
      this.greenDot[s] = g;
    }

    this._wireOperateUI();
    this._applyOpMode();
  }

  // dim the inactive hand's marker so it's clear which one the joystick drives
  _emphasizeHand() {
    for (const s of ['l', 'r']) {
      const on = (s === this.hand);
      const d = this.greenDot[s];
      d.material.emissiveIntensity = on ? 0.6 : 0.25;
      d.scale.setScalar(on ? 1 : 0.78);
      d.children[0].material.opacity = on ? 0.55 : 0.22;
    }
  }

  _wireOperateUI() {
    const panel = this.box;
    const reach = this.maxd * 0.4;

    // 3-way mode toggle
    const seg = panel.querySelector('[data-wbc-segments]');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.opMode = b.dataset.mode;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this._applyOpMode();
    });

    // per-hand selector (which palm the joystick edits)
    const handSeg = panel.querySelector('[data-wbc-hand]');
    const syncPadToHand = () => {
      const o = this.armOff[this.hand];
      this.pad.x = o.x; this.pad.y = -o.y;
      const knob = panel.querySelector('.wbc-knob');
      if (knob) { knob.style.left = `${(o.x * 0.5 + 0.5) * 100}%`; knob.style.top = `${(-o.y * 0.5 + 0.5) * 100}%`; }
      const zsl = panel.querySelector('[data-wbc-slider="armZ"]');
      if (zsl) { zsl.value = o.z; zsl.dispatchEvent(new Event('input')); }
      const ox = panel.querySelector('[data-wbc-out="padx"]');
      const oy = panel.querySelector('[data-wbc-out="pady"]');
      if (ox) ox.textContent = (o.x >= 0 ? '+' : '') + (o.x * reach).toFixed(2) + ' m';
      if (oy) oy.textContent = (o.y >= 0 ? '+' : '') + (o.y * reach).toFixed(2) + ' m';
    };
    if (handSeg) handSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.hand = b.dataset.handSide;
      handSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this._emphasizeHand();
      syncPadToHand();
    });

    // sliders (nav velocities + lift, arm Z) — Z edits the ACTIVE hand
    panel.querySelectorAll('[data-wbc-slider]').forEach((sl) => {
      const key = sl.dataset.wbcSlider;
      const out = panel.querySelector(`[data-wbc-out="${key}"]`);
      const fmt = () => {
        const v = parseFloat(sl.value);
        if (key === 'lift') return (v * 100).toFixed(0) + ' cm';
        if (key === 'armZ') return (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + ' cm';
        if (key === 'w') return v.toFixed(1) + ' rad/s';
        return v.toFixed(2) + ' m/s';
      };
      const apply = () => {
        const v = parseFloat(sl.value);
        if (key === 'armZ') this.armOff[this.hand].z = v; else this.nav[key] = v;
        if (out) out.textContent = fmt();
      };
      sl.addEventListener('input', apply);
      apply();
    });

    // virtual joystick pad — edits the ACTIVE hand's X/Y offset
    const pad = panel.querySelector('[data-wbc-pad]');
    if (pad) {
      const knob = pad.querySelector('.wbc-knob');
      const R = () => pad.getBoundingClientRect();
      const setFromEvent = (ev) => {
        const r = R();
        let x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        let y = ((ev.clientY - r.top) / r.height) * 2 - 1;
        x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
        this.pad.x = x; this.pad.y = y;
        this.armOff[this.hand].x = x;
        this.armOff[this.hand].y = -y;
        knob.style.left = `${(x * 0.5 + 0.5) * 100}%`;
        knob.style.top = `${(y * 0.5 + 0.5) * 100}%`;
        const ox = panel.querySelector('[data-wbc-out="padx"]');
        const oy = panel.querySelector('[data-wbc-out="pady"]');
        if (ox) ox.textContent = (x >= 0 ? '+' : '') + (x * reach).toFixed(2) + ' m';
        if (oy) oy.textContent = (-y >= 0 ? '+' : '') + (-y * reach).toFixed(2) + ' m';
      };
      let dragging = false;
      pad.addEventListener('pointerdown', (e) => { dragging = true; pad.setPointerCapture(e.pointerId); setFromEvent(e); });
      pad.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
      const stop = () => { dragging = false; };
      pad.addEventListener('pointerup', stop);
      pad.addEventListener('pointercancel', stop);
    }

    // reset
    const reset = panel.querySelector('[data-wbc-reset]');
    if (reset) reset.addEventListener('click', () => {
      this.armOff = { l: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 } };
      panel.querySelectorAll('[data-wbc-slider]').forEach((sl) => {
        sl.value = sl.dataset.def || 0; sl.dispatchEvent(new Event('input'));
      });
      this.pad.x = this.pad.y = 0;
      const knob = panel.querySelector('.wbc-knob');
      if (knob) { knob.style.left = '50%'; knob.style.top = '50%'; }
      panel.querySelectorAll('[data-wbc-out="padx"],[data-wbc-out="pady"]').forEach((o) => o.textContent = '+0.00 m');
      this.baseOffset.set(0, 0, 0); this.baseYaw = 0;
    });

    this._emphasizeHand();
  }

  _applyOpMode() {
    // show only the controls relevant to the active mode
    this.box.querySelectorAll('[data-wbc-group]').forEach((el) => {
      const groups = el.dataset.wbcGroup.split(' ');
      el.style.display = groups.includes(this.opMode) ? '' : 'none';
    });
    const showGreen = (this.opMode !== 'nav');
    this.greenDot.l.visible = showGreen;
    this.greenDot.r.visible = showGreen;
  }

  _stepOperate(dt) {
    if (this.opMode === 'nav') {
      // integrate the swerve base pose in the world ground plane
      this.baseYaw += this.nav.w * dt;
      const c = Math.cos(this.baseYaw), s = Math.sin(this.baseYaw);
      // vx = forward (heading), vy = lateral; map into world XZ
      const fwd = new THREE.Vector3(s, 0, c);
      const left = new THREE.Vector3(c, 0, -s);
      this.baseOffset.addScaledVector(fwd, this.nav.vx * dt);
      this.baseOffset.addScaledVector(left, this.nav.vy * dt);

      // spin + steer the wheels for a sense of motion
      const speed = Math.hypot(this.nav.vx, this.nav.vy);
      this.wheel += speed * dt * 12;
      const steer = (speed > 1e-3) ? Math.atan2(this.nav.vy, this.nav.vx) : 0;
      for (const n of ['fl_steer', 'fr_steer', 'b_steer']) if (this.joints[n]) this._set(n, steer);
      for (const n of ['fl_drive', 'fr_drive', 'b_drive']) if (this.joints[n]) this._set(n, this.wheel);

      this._applyBase();
      this._setLift(this.nav.lift);
      // keep arms in their held rest pose
      this._relax('l', 0.08); this._relax('r', 0.08);
      this.gTarget.l.copy(this.gHome.l); this.gTarget.r.copy(this.gHome.r);
      return;
    }

    // ARM / WHOLE: each palm target = its home + per-hand offset, mapped onto
    // the camera-aligned ground plane so the joystick feels natural. Both arms
    // track their own palm target (bimanual), mirroring mabel/wbc.py.
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const flat = new THREE.Vector3(camDir.x, 0, camDir.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), flat).normalize();
    const reach = this.maxd * 0.4;
    for (const s of ['l', 'r']) {
      const o = this.armOff[s];
      this.gTarget[s].copy(this.gHome[s])
        .addScaledVector(flat, o.y * reach)      // joystick up = away from camera
        .addScaledVector(right, o.x * reach)
        .add(new THREE.Vector3(0, o.z, 0));
    }

    if (this.opMode === 'whole') {
      // lazy base: follow the hand centroid if it drifts past a comfort radius
      const cen = new THREE.Vector3().addVectors(this.gTarget.l, this.gTarget.r).multiplyScalar(0.5);
      const baseC = this._rootP0.clone().add(this.baseOffset);
      const flatErr = new THREE.Vector3(cen.x - baseC.x, 0, cen.z - baseC.z);
      const comfort = this.maxd * 0.3;
      if (flatErr.length() > comfort) {
        const push = flatErr.clone().setLength(flatErr.length() - comfort);
        this.baseOffset.addScaledVector(push.normalize(), Math.min(0.6, flatErr.length()) * dt * 1.2);
      }
      // lift engages toward the mean target height
      const dz = 0.5 * ((this.gTarget.l.y - this.gHome.l.y) + (this.gTarget.r.y - this.gHome.r.y));
      this.nav.lift = Math.max(0, Math.min(0.635, 0.3 + dz));
      this._setLift(this.nav.lift);
      this._applyBase();
    }

    for (const s of ['l', 'r']) {
      this.active[s] = true;
      this._ik(s, this.gTarget[s], 0.5, 3);
      this.greenDot[s].position.copy(this.gTarget[s]);
    }
  }

  _setLift(v) {
    // split the commanded travel across the two cascaded prismatic stages
    if (this.joints['lift_lower']) this._set('lift_lower', Math.min(this.joints['lift_lower'].upper, v / 2));
    if (this.joints['lift_upper']) this._set('lift_upper', Math.min(this.joints['lift_upper'].upper, v / 2));
  }

  _applyBase() {
    this.root.position.copy(this._rootP0).add(this.baseOffset);
    this.root.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.baseYaw))
      .multiply(this._rootQ0);
    this.root.updateMatrixWorld(true);
  }

  _setStatus(txt) {
    const el = this.box.querySelector('[data-wbc-status]');
    if (el) el.textContent = txt;
  }

  /* ── render loop ─────────────────────────────────────────────────── */
  _raf() {
    let last = performance.now();
    this.renderer.setAnimationLoop((t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (this.ready) {
        if (this.kind === 'compliance') this._stepCompliance();
        else this._stepOperate(dt);
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
}

document.querySelectorAll('[data-wbc-viewer]').forEach((box) => new WbcViewer(box));
