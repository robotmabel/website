/* ═══════════════════════════════════════════════════════════════════
   MABEL — browser teleop cockpit (teleop-web.html)

   One canonical robot state (60 joints + planar base pose) drives TWO
   synced 3D stages of the articulated rig:

     #twCockpit   the teleop cockpit — iOS-style dual joysticks
                  (NAV: translate / yaw+lift · ARMS: palm XY + Z + grip)
     #twControl   the robot-control panel — FIRM (wrist Cartesian drag,
                  per-joint sliders) and SOFT (gravity comp, compliance)

   Two sources of truth, never both:
     · LOCAL SIM   an in-browser kinematic re-implementation (hinge-CCD
                   IK, swerve integration, lazy lift) steps the state —
                   the same stand-in used by the WBC page.
     · ONLINE      the Connect bar opens the documented WebSocket
                   contract (ws://host:9090/teleop): teleop_frame /
                   joint_command / control_mode / reset go up at 20 Hz,
                   and every incoming robot_state OVERWRITES the canon
                   state — so the model is exactly what the MuJoCo sim
                   says, never a local prediction.

   Everything is narrated into the status console (#twLog).
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const RUST = 0xC25B2A;
const GREEN = 0x3FB56B;

// command caps — mirror config.py / the iOS speed governor
const CAPS = {
  VMAX: 0.8,            // m/s linear
  WMAX: 2.0,            // rad/s yaw
  LIFT_MAX: 0.635,      // m total prismatic travel
  LIFT_RATE: 0.22,      // m/s lift command rate (right-stick Y)
  REACH_FRAC: 0.4,      // arm pad full deflection, fraction of model size
};
// firm ↔ soft tracking laws; the stiffness slider lerps between them
const FIRM = { ikGain: 0.55, ikPasses: 3, qRate: 1.8 };
const SOFT = { ikGain: 0.10, ikPasses: 1, qRate: 0.45 };
// base admittance for COMPLIANCE (mabel/admittance.py, as on the WBC page)
const ADMIT = { M: 4.5, BL: 22.0, FS: 3.0, VSTOP: 0.02, KDRAG: 45.0, BOX: 0.03, RAMP: 0.04 };

const TX_HZ = 20;        // teleop_frame uplink rate when connected
const PING_MS = 2000;    // application-level liveness

/* ═══ status console + telemetry ═══════════════════════════════════ */
const Log = {
  el: document.getElementById('twLog'),
  max: 250,
  line(level, msg) {
    if (!this.el) return;
    const d = new Date();
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    const row = document.createElement('div');
    row.className = `tw-line ${level}`;
    row.innerHTML = `<span class="t">${t}</span><span class="lv">${level.toUpperCase()}</span><span class="m"></span>`;
    row.querySelector('.m').textContent = msg;
    const stick = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 30;
    this.el.appendChild(row);
    while (this.el.children.length > this.max) this.el.removeChild(this.el.firstChild);
    if (stick) this.el.scrollTop = this.el.scrollHeight;
  },
  sys(m) { this.line('sys', m); },
  ok(m) { this.line('ok', m); },
  sim(m) { this.line('sim', m); },
  tx(m) { this.line('tx', m); },
  rx(m) { this.line('rx', m); },
  warn(m) { this.line('warn', m); },
  err(m) { this.line('err', m); },
};
const Tele = {
  set(key, val) {
    document.querySelectorAll(`[data-tw="${key}"]`).forEach((el) => { el.textContent = val; });
  },
};

/* ═══ a 3D stage: scene scaffold + one rig instance ════════════════ */
class Stage {
  constructor(box) {
    this.box = box;
    this.stage = box.querySelector('.wbc-stage') || box;
    this.canvas = box.querySelector('canvas');

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d867b, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(2.5, 3.5, 2); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55); fill.position.set(-2.5, 1.2, -1.5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe6cf, 0.6); rim.position.set(0, 1.8, -3.2); scene.add(rim);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(35, 1.6, 0.01, 200);
    camera.position.set(1.4, 1.1, 1.8);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.7;
    controls.minDistance = 0.4;
    controls.maxDistance = 8;
    controls.target.set(0, 0.5, 0);
    this.controls = controls;

    let idle;
    this.wake = () => { controls.autoRotate = false; clearTimeout(idle); };
    this.sleep = () => { clearTimeout(idle); idle = setTimeout(() => { controls.autoRotate = true; }, 4000); };
    controls.addEventListener('start', this.wake);
    controls.addEventListener('end', this.sleep);

    const resize = () => {
      const w = this.stage.clientWidth, h = this.stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(this.stage);
    document.addEventListener('fullscreenchange', () => setTimeout(resize, 60));
    window.addEventListener('resize', resize);
    resize();
  }

  async load(manifest) {
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().load('assets/mabel_rig.glb', res, undefined, rej));
    const root = gltf.scene;
    this.root = root;
    this.scene.add(root);

    const bb = new THREE.Box3().setFromObject(root);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    this.maxd = Math.max(sz.x, sz.y, sz.z) || 1;
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(this.maxd * 0.85, this.maxd * 0.5, this.maxd * 1.25));
    this.camera.near = this.maxd / 100; this.camera.far = this.maxd * 60;
    this.camera.updateProjectionMatrix();
    this.controls.update();

    root.updateMatrixWorld(true);
    this.rootP0 = root.position.clone();
    this.rootQ0 = root.quaternion.clone();

    this.joints = {};
    for (const j of manifest.joints) {
      const node = root.getObjectByName(j.node);
      if (!node) continue;
      this.joints[j.name] = {
        ...j, _n: node,
        _p0: node.position.clone(), _q0: node.quaternion.clone(),
        _ax: new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize(),
      };
    }
    this.ee = {
      l: root.getObjectByName('left_palm') || this.joints.left_arm_7?._n,
      r: root.getObjectByName('right_palm') || this.joints.right_arm_7?._n,
    };
    this.stage.classList.add('loaded');
  }

  setJoint(name, val) {
    const j = this.joints[name]; if (!j) return;
    const n = j._n;
    if (j.type === 'prismatic') {
      n.position.copy(j._p0).add(j._ax.clone().applyQuaternion(j._q0).multiplyScalar(val));
      n.quaternion.copy(j._q0);
    } else {
      n.quaternion.copy(j._q0).multiply(new THREE.Quaternion().setFromAxisAngle(j._ax, val));
      n.position.copy(j._p0);
    }
  }

  // pose the whole rig from canonical state (q map + base offset/yaw)
  pose(state) {
    for (const name in state.q) this.setJoint(name, state.q[name]);
    this.root.position.copy(this.rootP0).add(state.baseOffset);
    this.root.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.baseYaw))
      .multiply(this.rootQ0);
    this.root.updateMatrixWorld(true);
  }

  // pointer → world point on the camera-facing plane through `anchor`
  planePoint(ev, anchor) {
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

  pick(ev, objects) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(objects, false);
    return hits.length ? hits[0].object : null;
  }

  marker(color, radius, ring) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.45 }),
    );
    if (ring) {
      const rg = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.35, radius * 1.6, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      m.add(rg);
    }
    this.scene.add(m);
    return m;
  }

  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
}

/* ═══ virtual joystick pad ═════════════════════════════════════════ */
function makePad(el, { spring = true } = {}, onChange) {
  const knob = el.querySelector('.wbc-knob');
  const state = { x: 0, y: 0 };
  const paint = () => {
    knob.style.left = `${(state.x * 0.5 + 0.5) * 100}%`;
    knob.style.top = `${(-state.y * 0.5 + 0.5) * 100}%`;
  };
  const emit = () => { paint(); onChange(state.x, state.y); };
  const fromEvent = (ev) => {
    const r = el.getBoundingClientRect();
    state.x = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1));
    state.y = Math.max(-1, Math.min(1, -(((ev.clientY - r.top) / r.height) * 2 - 1)));
    emit();
  };
  let active = false;
  el.addEventListener('pointerdown', (e) => { active = true; el.setPointerCapture(e.pointerId); fromEvent(e); });
  el.addEventListener('pointermove', (e) => { if (active) fromEvent(e); });
  const stop = () => {
    if (!active) return;
    active = false;
    if (spring) { state.x = 0; state.y = 0; emit(); }
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  return {
    set(x, y) { state.x = x; state.y = y; paint(); },
    zero() { state.x = 0; state.y = 0; emit(); },
  };
}

/* ═══ WebSocket link — the documented two-port contract ════════════ */
class Link {
  constructor(app) {
    this.app = app;
    this.ws = null;
    this.live = false;        // true once robot_state frames are flowing
    this.seq = 0;
    this.rtt = null;
    this.txCount = 0; this.rxCount = 0;
    this.lastStateLog = 0;
    this._pingTimer = null;
  }

  normalize(raw) {
    let u = (raw || '').trim();
    if (!u) u = 'ws://localhost:9090/teleop';
    if (!/^wss?:\/\//.test(u)) u = 'ws://' + u;
    const m = u.match(/^(wss?:\/\/)([^/:]+)(:\d+)?(\/.*)?$/);
    if (m) u = m[1] + m[2] + (m[3] || ':9090') + (m[4] || '/teleop');
    return u;
  }

  connect(raw) {
    const url = this.normalize(raw);
    if (location.protocol === 'https:' && url.startsWith('ws://')
        && !/^ws:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
      Log.warn('This page is https — browsers only allow plain ws:// to localhost. Use wss:// or open the site over http for LAN robots.');
    }
    Log.sys(`Connecting to ${url} …`);
    this.app.setPill('connecting', 'CONNECTING');
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { Log.err(`WebSocket refused: ${e.message}`); this.app.setPill('err', 'ERROR'); return; }
    this.ws = ws;

    ws.onopen = () => {
      Log.ok(`Link up — ${url}`);
      Log.sys('Handshake: announcing client + control mode; uplink teleop_frame @ 20 Hz.');
      this.app.setPill('online', 'ONLINE');
      this.send('hello', { client: 'mabel-web', version: '1.0' });
      this.app.sendControlMode();
      this._pingTimer = setInterval(() => this.send('ping', { t: performance.now() }), PING_MS);
      this.app.onLink(true);
    };
    ws.onmessage = (ev) => this._onMessage(ev);
    ws.onerror = () => { Log.err('WebSocket error (see browser console). Is the bridge running? python -m mabel.server --sim'); };
    ws.onclose = (ev) => {
      clearInterval(this._pingTimer);
      const was = this.live;
      this.live = false;
      this.ws = null;
      this.rtt = null;
      this.app.setPill('local', 'LOCAL SIM');
      Log.warn(`Link closed (code ${ev.code}). ${was ? 'Server state stream stopped — ' : ''}falling back to the in-browser sim.`);
      this.app.onLink(false);
    };
  }

  disconnect() {
    if (this.ws) { Log.sys('Disconnecting…'); this.ws.close(1000); }
  }

  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  send(type, payload) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type, payload }));
    this.txCount++;
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); }
    catch (e) { Log.err('Non-JSON message from server dropped.'); return; }
    const p = msg.payload || {};
    this.rxCount++;
    switch (msg.type) {
      case 'hello':
        Log.rx(`hello — server "${p.name || 'mabel'}" v${p.version || '?'}`);
        break;
      case 'robot_state': {
        if (!this.live) {
          this.live = true;
          Log.ok('robot_state stream started — the 3D model now mirrors the SERVER simulation exactly (local sim paused).');
        }
        this.app.applyRobotState(p);
        const now = performance.now();
        if (now - this.lastStateLog > 1000) {           // summarize the stream, don't spam
          this.lastStateLog = now;
          const nq = p.joints ? Object.keys(p.joints).length : 0;
          const b = p.base ? ` base(${(+p.base.x).toFixed(2)}, ${(+p.base.y).toFixed(2)}, ${(+p.base.yaw).toFixed(2)} rad)` : '';
          Log.rx(`robot_state · ${nq} joints${b}${p.battery != null ? ` · batt ${p.battery}%` : ''}${p.mode ? ` · ${p.mode}` : ''}`);
        }
        break;
      }
      case 'pong':
        if (p.t != null) { this.rtt = performance.now() - p.t; }
        break;
      case 'error':
        Log.err(`server: ${p.message || JSON.stringify(p)}`);
        break;
      default:
        Log.warn(`Unknown message type "${msg.type}" ignored.`);
    }
  }
}

/* ═══ the app ══════════════════════════════════════════════════════ */
class App {
  constructor(manifest, cockpit, control) {
    this.manifest = manifest;
    this.cockpit = cockpit;      // primary stage — IK runs on this rig
    this.control = control;

    // canonical robot state — the ONLY thing the rigs are posed from
    this.state = { q: {}, baseOffset: new THREE.Vector3(), baseYaw: 0 };
    for (const j of manifest.joints) {
      this.state.q[j.name] = (j.lower != null && j.upper != null)
        ? Math.min(j.upper, Math.max(j.lower, 0)) : 0;
    }
    this.homeQ = { ...this.state.q };

    // commands
    this.nav = { vx: 0, vy: 0, w: 0, vlift: 0 };
    this.lift = 0;
    this.wheel = 0;
    this.grip = { l: 0, r: 0 };
    this.armOff = { l: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 } };
    this.jointTarget = { ...this.homeQ };
    this.stiffness = 0.85;          // firm-mode slider, lerps SOFT→FIRM

    this.teleopMode = 'nav';        // cockpit: 'nav' | 'arm'
    this.ctlMode = 'wrist';         // control: 'wrist' | 'joints' | 'gravity' | 'compliance'
    this.armDriver = 'ik';          // 'ik' | 'joints' — who owns the arm joints
    this.targetSource = 'pad';      // 'pad' | 'drag' — who owns the palm targets
    this.hand = 'l';
    this.drag = null;               // active drag side on the control stage
    this.adm = { vx: 0, vy: 0 };    // compliance base admittance velocity

    this.link = new Link(this);
    this._txAcc = 0;
    this._teleAcc = 0;

    this.chains = {
      l: ['left_arm_1', 'left_arm_2', 'left_arm_3', 'left_arm_4', 'left_arm_5', 'left_arm_6', 'left_arm_7'],
      r: ['right_arm_1', 'right_arm_2', 'right_arm_3', 'right_arm_4', 'right_arm_5', 'right_arm_6', 'right_arm_7'],
    };

    // rest pose bookkeeping (world palm positions at home)
    this.cockpit.pose(this.state);
    this.rest = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    for (const s of ['l', 'r']) this.cockpit.ee[s]?.getWorldPosition(this.rest[s]);
    this.restCentroid = new THREE.Vector3().addVectors(this.rest.l, this.rest.r).multiplyScalar(0.5);
    this.targets = { l: this.rest.l.clone(), r: this.rest.r.clone() };

    // markers: green palm targets on both stages, rust grab handles on control
    this.dots = {
      cockpit: { l: cockpit.marker(GREEN, cockpit.maxd * 0.024, true), r: cockpit.marker(GREEN, cockpit.maxd * 0.024, true) },
      control: { l: control.marker(GREEN, control.maxd * 0.024, true), r: control.marker(GREEN, control.maxd * 0.024, true) },
    };
    this.handles = { l: control.marker(RUST, control.maxd * 0.028), r: control.marker(RUST, control.maxd * 0.028) };
    this.handles.l.userData.side = 'l'; this.handles.r.userData.side = 'r';

    this._wireCockpit();
    this._wireControl();
    this._wireConnect();
    this._wireGrab();
    this._applyModeVisibility();

    Log.sys('Local sim ready — 60 joints, swerve base, dual 7-DOF arms. Drive it, or Connect to a live MuJoCo bridge.');
    Tele.set('battery', '— (local)');
    this._raf();
  }

  /* ── helpers ─────────────────────────────────────────────────────── */
  gains() {
    const t = this.stiffness;
    return {
      ikGain: SOFT.ikGain + (FIRM.ikGain - SOFT.ikGain) * t,
      ikPasses: Math.round(SOFT.ikPasses + (FIRM.ikPasses - SOFT.ikPasses) * t),
      qRate: SOFT.qRate + (FIRM.qRate - SOFT.qRate) * t,
    };
  }

  setQ(name, val) {
    const j = this.cockpit.joints[name]; if (!j) return;
    if (j.lower != null) val = Math.max(j.lower, Math.min(j.upper, val));
    this.state.q[name] = val;
    this.cockpit.setJoint(name, val);
  }

  setLift(v) {
    this.lift = Math.max(0, Math.min(CAPS.LIFT_MAX, v));
    this.setQ('lift_lower', this.lift / 2);
    this.setQ('lift_upper', this.lift / 2);
  }

  // hinge-constrained CCD on the primary rig (same solver as the WBC page)
  ik(side, goal, gain, passes) {
    const ee = this.cockpit.ee[side]; if (!ee) return;
    const piv = new THREE.Vector3(), eeW = new THREE.Vector3();
    const axW = new THREE.Vector3(), pq = new THREE.Quaternion();
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), cr = new THREE.Vector3();
    for (let p = 0; p < passes; p++) {
      for (let i = this.chains[side].length - 1; i >= 0; i--) {
        const name = this.chains[side][i];
        const j = this.cockpit.joints[name]; if (!j) continue;
        const n = j._n;
        n.getWorldPosition(piv);
        ee.getWorldPosition(eeW);
        n.parent.getWorldQuaternion(pq);
        axW.copy(j._ax).applyQuaternion(j._q0).applyQuaternion(pq).normalize();
        v1.subVectors(eeW, piv); v1.addScaledVector(axW, -v1.dot(axW));
        v2.subVectors(goal, piv); v2.addScaledVector(axW, -v2.dot(axW));
        if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) continue;
        v1.normalize(); v2.normalize();
        const ang = Math.atan2(cr.crossVectors(v1, v2).dot(axW), v1.dot(v2)) * gain;
        this.setQ(name, this.state.q[name] + ang);
        n.updateWorldMatrix(false, true);
      }
    }
  }

  // sync palm targets to wherever the palms currently are (no-jump handoff)
  syncTargetsToEE() {
    this.cockpit.pose(this.state);
    for (const s of ['l', 'r']) this.cockpit.ee[s]?.getWorldPosition(this.targets[s]);
  }

  /* ── cockpit (section 1) ─────────────────────────────────────────── */
  _wireCockpit() {
    const root = document.getElementById('twCockpit');

    root.querySelector('[data-tw-seg]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-tw-seg] button').forEach((x) => x.classList.toggle('on', x === b));
      this.teleopMode = b.dataset.mode;
      if (this.teleopMode === 'arm') {
        if (this.armDriver !== 'ik') { this.armDriver = 'ik'; this.syncTargetsToEE(); }
        this.targetSource = 'pad';
        this._syncPadsFromTargets();
        Log.sim('Cockpit → ARMS: left pad = palm X/Y, slider = palm Z. The selected palm tracks the green target.');
      } else {
        Log.sim('Cockpit → NAV: left stick translates the swerve base, right stick = yaw + lift.');
      }
      this.sendControlMode();
      this._applyModeVisibility();
    });

    // NAV pads (spring back to zero = velocity commands, like the iOS cockpit)
    this.padL = makePad(root.querySelector('[data-tw-pad="navL"]'), { spring: true }, (x, y) => {
      this.nav.vx = y * CAPS.VMAX;
      this.nav.vy = -x * CAPS.VMAX;
      this.cockpit.wake(); this.cockpit.sleep();
    });
    this.padR = makePad(root.querySelector('[data-tw-pad="navR"]'), { spring: true }, (x, y) => {
      this.nav.w = -x * CAPS.WMAX;
      this.nav.vlift = y * CAPS.LIFT_RATE;
      this.cockpit.wake(); this.cockpit.sleep();
    });

    // ARM pad (positional, stays where you leave it) + Z + grip
    this.padA = makePad(root.querySelector('[data-tw-pad="arm"]'), { spring: false }, (x, y) => {
      this.targetSource = 'pad';
      this.armOff[this.hand].x = x;
      this.armOff[this.hand].y = y;
      this.cockpit.wake(); this.cockpit.sleep();
    });
    const zsl = root.querySelector('[data-tw-slider="armZ"]');
    zsl.addEventListener('input', () => {
      this.targetSource = 'pad';
      this.armOff[this.hand].z = parseFloat(zsl.value);
      root.querySelector('[data-tw-out="armZ"]').textContent = `${(parseFloat(zsl.value) * 100).toFixed(0)} cm`;
    });
    this._zsl = zsl;
    const gsl = root.querySelector('[data-tw-slider="grip"]');
    gsl.addEventListener('input', () => {
      this.grip[this.hand] = parseFloat(gsl.value);
      root.querySelector('[data-tw-out="grip"]').textContent = `${Math.round(parseFloat(gsl.value) * 100)} %`;
    });
    this._gsl = gsl;

    root.querySelector('[data-tw-hand]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-tw-hand] button').forEach((x) => x.classList.toggle('on', x === b));
      this.hand = b.dataset.handSide;
      const o = this.armOff[this.hand];
      this.padA.set(o.x, o.y);
      zsl.value = o.z;
      gsl.value = this.grip[this.hand];
      root.querySelector('[data-tw-out="armZ"]').textContent = `${(o.z * 100).toFixed(0)} cm`;
      root.querySelector('[data-tw-out="grip"]').textContent = `${Math.round(this.grip[this.hand] * 100)} %`;
      Log.sim(`Commanding ${this.hand === 'l' ? 'LEFT' : 'RIGHT'} palm.`);
    });

    document.getElementById('twStop').addEventListener('click', () => {
      this.nav = { vx: 0, vy: 0, w: 0, vlift: 0 };
      this.padL.zero(); this.padR.zero();
      if (this.link.connected) this._sendTeleopFrame();   // push the zeros immediately
      Log.warn('STOP — all base velocities zeroed.');
    });
  }

  _syncPadsFromTargets() {
    // express current targets as pad offsets along the camera-aligned basis
    const { flat, right } = this._armBasis();
    const reach = this.cockpit.maxd * CAPS.REACH_FRAC;
    for (const s of ['l', 'r']) {
      const d = new THREE.Vector3().subVectors(this.targets[s], this._armHome(s));
      this.armOff[s].x = Math.max(-1, Math.min(1, d.dot(right) / reach));
      this.armOff[s].y = Math.max(-1, Math.min(1, d.dot(flat) / reach));
      this.armOff[s].z = Math.max(-0.3, Math.min(0.4, d.y));
    }
    const o = this.armOff[this.hand];
    this.padA.set(o.x, o.y);
    this._zsl.value = o.z;
  }

  _armBasis() {
    const camDir = this.cockpit.camera.getWorldDirection(new THREE.Vector3());
    const flat = new THREE.Vector3(camDir.x, 0, camDir.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), flat).normalize();
    return { flat, right };
  }

  _armHome(s) {
    // the palm rest pose rides along with the base
    return this.rest[s].clone().add(this.state.baseOffset);
  }

  /* ── robot control (section 2) ───────────────────────────────────── */
  _wireControl() {
    const root = document.getElementById('twControl');

    root.querySelector('[data-tw-ctlseg]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-tw-ctlseg] button').forEach((x) => x.classList.toggle('on', x === b));
      this.ctlMode = b.dataset.mode;
      if (this.ctlMode === 'joints') {
        this.armDriver = 'joints';
        this.jointTarget = { ...this.state.q };           // start from where it is
        this._syncJointSliders();
        Log.sim('Control → JOINT CONTROL (firm): sliders command joint targets; the sim slews to them rate-limited.');
      } else {
        if (this.armDriver !== 'ik') { this.armDriver = 'ik'; this.syncTargetsToEE(); }
        this.targetSource = 'drag';
        const blurb = {
          wrist: 'WRIST CONTROL (firm): drag a rust palm handle — the arm tracks the Cartesian target stiffly.',
          gravity: 'GRAVITY COMP (soft): the arms are weightless and back-drivable — they stay wherever you leave them.',
          compliance: 'COMPLIANCE (soft): push past the comfort box and the base admits the wrench, glides, and coasts to rest.',
        }[this.ctlMode];
        Log.sim(`Control → ${blurb}`);
      }
      this.sendControlMode();
      this._applyModeVisibility();
    });

    const ssl = root.querySelector('[data-tw-slider="stiff"]');
    ssl.addEventListener('input', () => {
      this.stiffness = parseFloat(ssl.value);
      root.querySelector('[data-tw-out="stiff"]').textContent = `${Math.round(this.stiffness * 100)} %`;
    });

    document.getElementById('twHome').addEventListener('click', () => this.resetAll(true));

    this._buildJointSliders(root);
  }

  _buildJointSliders(root) {
    const tabs = root.querySelector('[data-tw-jtabs]');
    const list = root.querySelector('[data-tw-jlist]');
    const groups = [['arms', 'Arms'], ['body', 'Body'], ['hands', 'Hands'], ['base', 'Base']];
    this._jrows = [];
    const fmt = (j, v) => j.type === 'prismatic' ? `${(v * 100).toFixed(1)} cm` : `${(v * 180 / Math.PI).toFixed(0)}°`;

    groups.forEach(([g, label], gi) => {
      const btn = document.createElement('button');
      btn.className = 'jp-tab' + (gi === 0 ? ' on' : '');
      btn.textContent = label; btn.dataset.g = g;
      tabs.appendChild(btn);
      const pane = document.createElement('div');
      pane.className = 'jp-pane' + (gi === 0 ? ' on' : '');
      pane.dataset.g = g;

      this.manifest.joints.filter((j) => j.group === g).forEach((j) => {
        const lo = j.lower ?? -Math.PI, hi = j.upper ?? Math.PI;
        const row = document.createElement('div');
        row.className = 'jp-row';
        row.innerHTML = `<div class="jp-row-top"><span class="jp-name"></span><span class="jp-val"></span></div>`;
        row.querySelector('.jp-name').textContent = j.name.replace(/_/g, ' ');
        const vl = row.querySelector('.jp-val');
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = lo; sl.max = hi; sl.step = (hi - lo) / 240;
        sl.value = this.homeQ[j.name]; sl.className = 'jp-slider';
        vl.textContent = fmt(j, parseFloat(sl.value));
        sl.addEventListener('input', () => {
          const v = parseFloat(sl.value);
          this.jointTarget[j.name] = v;
          vl.textContent = fmt(j, v);
          if (this.armDriver !== 'joints') { this.armDriver = 'joints'; this.jointTarget = { ...this.state.q, [j.name]: v }; }
          this._queueJointCommand(j.name, v);
        });
        row.appendChild(sl);
        pane.appendChild(row);
        this._jrows.push({ j, sl, vl, fmt });
      });
      list.appendChild(pane);
    });

    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.jp-tab'); if (!b) return;
      tabs.querySelectorAll('.jp-tab').forEach((x) => x.classList.toggle('on', x === b));
      list.querySelectorAll('.jp-pane').forEach((p) => p.classList.toggle('on', p.dataset.g === b.dataset.g));
    });
  }

  _syncJointSliders() {
    for (const { j, sl, vl, fmt } of this._jrows) {
      sl.value = this.state.q[j.name] ?? 0;
      vl.textContent = fmt(j, parseFloat(sl.value));
    }
  }

  // batch slider moves into one joint_command per 100 ms
  _queueJointCommand(name, val) {
    if (!this.link.connected) return;
    this._jcQueue = this._jcQueue || {};
    this._jcQueue[name] = val;
    if (this._jcTimer) return;
    this._jcTimer = setTimeout(() => {
      const q = this._jcQueue; this._jcQueue = null; this._jcTimer = null;
      this.link.send('joint_command', { joints: q });
      Log.tx(`joint_command · ${Object.keys(q).length} joint(s)`);
    }, 100);
  }

  /* ── grab handles on the control stage ───────────────────────────── */
  _wireGrab() {
    const st = this.control;
    st.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (this.ctlMode === 'joints') return;
      const hit = st.pick(ev, [this.handles.l, this.handles.r]);
      if (!hit) return;
      this.drag = hit.userData.side;
      this.targetSource = 'drag';
      if (this.armDriver !== 'ik') { this.armDriver = 'ik'; this.syncTargetsToEE(); }
      st.controls.enabled = false;
      st.wake();
      st.stage.classList.add('grabbing');
      ev.stopPropagation();
    }, true);
    window.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const pt = st.planePoint(ev, this.targets[this.drag]);
      if (pt) this.targets[this.drag].copy(pt);
    });
    const up = () => {
      if (!this.drag) return;
      this.drag = null;
      st.controls.enabled = true;
      st.sleep();
      st.stage.classList.remove('grabbing');
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ── connect bar ─────────────────────────────────────────────────── */
  _wireConnect() {
    const btn = document.getElementById('twConnect');
    const url = document.getElementById('twUrl');
    btn.addEventListener('click', () => {
      if (this.link.connected) this.link.disconnect();
      else this.link.connect(url.value);
    });
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    document.getElementById('twLogClear')?.addEventListener('click', () => {
      Log.el.innerHTML = ''; Log.sys('Log cleared.');
    });
    document.getElementById('twReset')?.addEventListener('click', () => this.resetAll(true));
  }

  setPill(state, label) {
    const pill = document.getElementById('twPill');
    pill.className = `tw-pill ${state}`;
    pill.textContent = label;
    document.getElementById('twConnect').textContent = (state === 'online' || state === 'connecting') ? 'Disconnect' : 'Connect';
    Tele.set('link', label);
  }

  onLink(up) {
    if (!up) {
      Tele.set('battery', '— (local)');
      // re-seed local commands from wherever the server left the robot
      this.syncTargetsToEE();
      this.jointTarget = { ...this.state.q };
    }
  }

  sendControlMode() {
    if (!this.link.connected) return;
    const mode = this.teleopMode === 'nav' ? 'navigation'
      : { wrist: 'wrist', joints: 'joints', gravity: 'gravity_comp', compliance: 'compliance' }[this.ctlMode];
    this.link.send('control_mode', { mode, stiffness: this.stiffness });
    Log.tx(`control_mode · ${mode}`);
  }

  resetAll(announce) {
    for (const name in this.homeQ) this.setQ(name, this.homeQ[name]);
    this.state.baseOffset.set(0, 0, 0);
    this.state.baseYaw = 0;
    this.lift = 0; this.wheel = 0;
    this.nav = { vx: 0, vy: 0, w: 0, vlift: 0 };
    this.adm = { vx: 0, vy: 0 };
    this.grip = { l: 0, r: 0 };
    this.armOff = { l: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 } };
    this.jointTarget = { ...this.homeQ };
    this.padL.zero(); this.padR.zero(); this.padA.set(0, 0);
    this._zsl.value = 0; this._gsl.value = 0;
    this.cockpit.pose(this.state);
    for (const s of ['l', 'r']) {
      this.targets[s].copy(this.rest[s]);
      this.cockpit.ee[s]?.getWorldPosition(this.rest[s]);
    }
    this._syncJointSliders();
    if (this.link.connected) { this.link.send('reset', {}); Log.tx('reset — server sim re-homed.'); }
    if (announce) Log.sim('Reset to home pose.');
  }

  /* ── incoming robot_state → canonical state ──────────────────────── */
  applyRobotState(p) {
    if (p.joints) {
      for (const name in p.joints) {
        if (name in this.state.q) this.state.q[name] = +p.joints[name];
      }
    }
    if (p.base) {
      // base given in the robot's own frame: x fwd, y left, yaw ccw
      const x = +p.base.x || 0, y = +p.base.y || 0;
      this.state.baseOffset.set(y, 0, x);
      this.state.baseYaw = +p.base.yaw || 0;
    }
    if (p.lift != null) this.lift = +p.lift;
    if (p.battery != null) Tele.set('battery', `${p.battery} %`);
    if (p.mode) Tele.set('srvmode', p.mode);
  }

  /* ── local sim step (only when not live) ─────────────────────────── */
  stepLocal(dt) {
    // swerve base from nav velocities (robot frame → world plane)
    this.state.baseYaw += this.nav.w * dt;
    const c = Math.cos(this.state.baseYaw), s = Math.sin(this.state.baseYaw);
    const fwd = new THREE.Vector3(s, 0, c);
    const left = new THREE.Vector3(c, 0, -s);
    this.state.baseOffset.addScaledVector(fwd, this.nav.vx * dt);
    this.state.baseOffset.addScaledVector(left, this.nav.vy * dt);
    const speed = Math.hypot(this.nav.vx, this.nav.vy);
    if (speed > 1e-3 || Math.abs(this.nav.w) > 1e-3) {
      this.wheel += Math.max(speed, Math.abs(this.nav.w) * 0.3) * dt * 12;
      const steer = (speed > 1e-3) ? Math.atan2(this.nav.vy, this.nav.vx) : 0;
      for (const n of ['fl_steer', 'fr_steer', 'b_steer']) this.setQ(n, steer);
      for (const n of ['fl_drive', 'fr_drive', 'b_drive']) this.setQ(n, this.wheel);
      // hands ride along with the body — keep targets attached to the base
      const dx = fwd.clone().multiplyScalar(this.nav.vx * dt).addScaledVector(left, this.nav.vy * dt);
      for (const s2 of ['l', 'r']) this.targets[s2].add(dx);
    }
    if (Math.abs(this.nav.vlift) > 1e-4) this.setLift(this.lift + this.nav.vlift * dt);

    // palm targets from the cockpit pads (when the pads own them)
    if (this.targetSource === 'pad' && this.teleopMode === 'arm') {
      const { flat, right } = this._armBasis();
      const reach = this.cockpit.maxd * CAPS.REACH_FRAC;
      for (const s2 of ['l', 'r']) {
        const o = this.armOff[s2];
        this.targets[s2].copy(this._armHome(s2))
          .addScaledVector(flat, o.y * reach)
          .addScaledVector(right, o.x * reach)
          .add(new THREE.Vector3(0, o.z, 0));
      }
    }

    // compliance: the drag wrench drives the base as a virtual mass-damper
    if (this.ctlMode === 'compliance') this._baseAdmittance(dt);

    // arms
    if (this.armDriver === 'ik') {
      const soft = (this.ctlMode === 'gravity' || this.ctlMode === 'compliance');
      const g = soft ? { ikGain: 0.5, ikPasses: 2 } : this.gains();
      for (const s2 of ['l', 'r']) this.ik(s2, this.targets[s2], g.ikGain, g.ikPasses);
    } else {
      const rate = this.gains().qRate * dt;
      for (const name in this.jointTarget) {
        const cur = this.state.q[name], tgt = this.jointTarget[name];
        if (cur === tgt) continue;
        const d = tgt - cur;
        this.setQ(name, Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate);
      }
    }

    // grip: curl the finger flexion joints toward grip × upper limit
    for (const s2 of ['l', 'r']) {
      const side = s2 === 'l' ? 'left' : 'right';
      const gv = this.grip[s2];
      for (const name in this.state.q) {
        if (!name.startsWith(side) || !/(mcp|pip|dip)$/.test(name)) continue;
        const j = this.cockpit.joints[name]; if (!j) continue;
        const home = Math.min(j.upper, Math.max(j.lower, 0));
        const tgt = home + gv * (j.upper - home);
        const cur = this.state.q[name];
        const rate = 4.0 * dt;
        const d = tgt - cur;
        this.setQ(name, Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate);
      }
    }
  }

  _baseAdmittance(dt) {
    const prev = this.state.baseOffset.clone();
    const c = Math.cos(this.state.baseYaw), s = Math.sin(this.state.baseYaw);
    const fwd = new THREE.Vector3(s, 0, c);
    const left = new THREE.Vector3(c, 0, -s);
    let fx = 0, fy = 0;
    if (this.drag) {
      const centroid = new THREE.Vector3().addVectors(this.targets.l, this.targets.r).multiplyScalar(0.5);
      const neutral = this.restCentroid.clone().add(this.state.baseOffset);
      const e = new THREE.Vector3().subVectors(centroid, neutral); e.y = 0;
      const eF = e.dot(fwd), eL = e.dot(left);
      const gate = Math.min(1, Math.max(0, (Math.hypot(eF, eL) - ADMIT.BOX) / ADMIT.RAMP));
      fx = ADMIT.KDRAG * eF * gate; fy = ADMIT.KDRAG * eL * gate;
      if (Math.abs(fx) <= ADMIT.FS) fx = 0;
      if (Math.abs(fy) <= ADMIT.FS) fy = 0;
    }
    this.adm.vx += (fx - ADMIT.BL * this.adm.vx) / ADMIT.M * dt;
    this.adm.vy += (fy - ADMIT.BL * this.adm.vy) / ADMIT.M * dt;
    if (fx === 0 && Math.abs(this.adm.vx) < ADMIT.VSTOP) this.adm.vx = 0;
    if (fy === 0 && Math.abs(this.adm.vy) < ADMIT.VSTOP) this.adm.vy = 0;
    this.state.baseOffset.addScaledVector(fwd, this.adm.vx * dt);
    this.state.baseOffset.addScaledVector(left, this.adm.vy * dt);
    const delta = new THREE.Vector3().subVectors(this.state.baseOffset, prev);
    if (delta.lengthSq() > 0) for (const s2 of ['l', 'r']) if (this.drag !== s2) this.targets[s2].add(delta);
  }

  /* ── uplink ──────────────────────────────────────────────────────── */
  _sendTeleopFrame() {
    const toLocal = (v) => {
      const p = this.cockpit.root.worldToLocal(v.clone());
      return [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
    };
    this.link.send('teleop_frame', {
      sequence: this.link.seq++,
      timestamp: Date.now() / 1000,
      mode: this.teleopMode === 'nav' ? 'Base Driving' : 'Arms & Hands',
      navJoystick: {
        lx: +( -this.nav.vy / CAPS.VMAX).toFixed(3),
        ly: +(this.nav.vx / CAPS.VMAX).toFixed(3),
        rx: +(-this.nav.w / CAPS.WMAX).toFixed(3),
        ry: +(this.nav.vlift / CAPS.LIFT_RATE).toFixed(3),
      },
      palmTargets: { l: toLocal(this.targets.l), r: toLocal(this.targets.r) },
      grip: { l: +this.grip.l.toFixed(3), r: +this.grip.r.toFixed(3) },
    });
  }

  /* ── visibility per mode ─────────────────────────────────────────── */
  _applyModeVisibility() {
    document.querySelectorAll('[data-tw-group]').forEach((el) => {
      el.style.display = el.dataset.twGroup.split(' ').includes(this.teleopMode) ? '' : 'none';
    });
    document.querySelectorAll('[data-tw-ctlgroup]').forEach((el) => {
      el.style.display = el.dataset.twCtlgroup.split(' ').includes(this.ctlMode) ? '' : 'none';
    });
    const showTargets = (this.armDriver === 'ik') && (this.teleopMode === 'arm'
      || this.ctlMode === 'wrist' || this.ctlMode === 'gravity' || this.ctlMode === 'compliance');
    for (const s of ['l', 'r']) {
      this.dots.cockpit[s].visible = this.teleopMode === 'arm';
      this.dots.control[s].visible = showTargets && this.ctlMode !== 'joints';
      this.handles[s].visible = this.ctlMode !== 'joints';
    }
  }

  /* ── main loop ───────────────────────────────────────────────────── */
  _raf() {
    let last = performance.now();
    const ee = new THREE.Vector3();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;

      if (!this.link.live) this.stepLocal(dt);

      this.cockpit.pose(this.state);
      this.control.pose(this.state);

      // markers: green = commanded targets, rust handles glued to the palms
      for (const s of ['l', 'r']) {
        this.dots.cockpit[s].position.copy(this.targets[s]);
        this.dots.control[s].position.copy(this.targets[s]);
        const on = (s === this.hand);
        this.dots.cockpit[s].material.emissiveIntensity = on ? 0.6 : 0.25;
        if (this.control.ee[s]) {
          this.control.ee[s].getWorldPosition(ee);
          this.handles[s].position.copy(ee);
        }
      }

      this.cockpit.render();
      this.control.render();

      // uplink at TX_HZ while connected
      if (this.link.connected) {
        this._txAcc += dt;
        if (this._txAcc >= 1 / TX_HZ) { this._txAcc = 0; this._sendTeleopFrame(); }
      }

      // telemetry strip at ~5 Hz
      this._teleAcc += dt;
      if (this._teleAcc > 0.2) {
        this._teleAcc = 0;
        const o = this.state.baseOffset;
        Tele.set('pose', `x ${o.z.toFixed(2)} m · y ${o.x.toFixed(2)} m · yaw ${(this.state.baseYaw * 180 / Math.PI).toFixed(0)}°`);
        Tele.set('lift', `${(this.lift * 100).toFixed(1)} cm`);
        Tele.set('mode', this.teleopMode === 'nav' ? 'NAV' : `ARMS · ${this.hand === 'l' ? 'L' : 'R'} palm`);
        Tele.set('ctl', { wrist: 'Wrist (firm)', joints: 'Joints (firm)', gravity: 'Gravity comp (soft)', compliance: 'Compliance (soft)' }[this.ctlMode]);
        Tele.set('rtt', this.link.rtt != null ? `${this.link.rtt.toFixed(0)} ms` : '—');
        Tele.set('rate', this.link.live ? `${TX_HZ} Hz up · server state down` : '60 Hz local');
        Tele.set('src', this.link.live ? 'SERVER (MuJoCo)' : 'BROWSER (kinematic)');
      }

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

/* ═══ boot ═════════════════════════════════════════════════════════ */
(async () => {
  const cockpitBox = document.getElementById('twCockpit');
  const controlBox = document.getElementById('twControl');
  if (!cockpitBox || !controlBox) return;
  try {
    const manifest = await fetch('assets/mabel_joints.json').then((r) => r.json());
    const cockpit = new Stage(cockpitBox);
    const control = new Stage(controlBox);
    await Promise.all([cockpit.load(manifest), control.load(manifest)]);
    new App(manifest, cockpit, control);
  } catch (e) {
    console.error('teleop-web boot failed', e);
    Log.err(`Boot failed: ${e.message || e}`);
  }
})();
