/* ═══════════════════════════════════════════════════════════════════
   MABEL — browser teleop (teleop-web.html)

   A web sibling of the iOS app, speaking the IDENTICAL wire protocol to
   the same backend (server/sim_teleop_bridge.py, ws://host:9090/teleop):

     uplink (20 Hz)  teleop_frame   {sequence, timestamp, head(4×4),
                                     mode:"Base Driving", navJoystick}
                     joint_command  {joints:{ios_id: rad | grip 0..1}}
                     control_mode   {method, controlType, region, stiffness}
                     external_force {forces:{body:[fx,fy,fz]}}  (Soft drag)
                     reset · ping
     downlink        hello          {server, version}
                     robot_state    {jointPositions, base{x,y,yaw,quat,
                                     steer,drive}, latencyMs, battery}
                     pong · error

   Link behaviour is ported from WebSocketLink.swift: AUTO-CONNECTS on
   load, 20 Hz frame stream, 5 s ping, 3.5 s silence heartbeat, 6 s
   handshake watchdog, and reconnects forever (delay min(3, 0.3·n) s)
   until the operator explicitly disconnects.

   Two synced 3D stages render ONE canonical robot state:
     #twCockpit  the Drive/Arms cockpit (CockpitView.swift): two corner
                 joysticks; in Arms each side gains up/down + grip.
     #twControl  the manipulation console (WholeBodyView.swift) on the
                 three orthogonal axes — Teleop (Guide|Joints), Feel
                 (Hold|Soft), Reach (Arm|Upper|Whole).

   Offline the state is stepped by a local kinematic stand-in; while
   robot_state frames flow, the model is posed ONLY from the server.
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GREEN = 0x3FB56B;          // Theme.Palette.live
const CLAY = 0xC25B2A;           // Theme.Palette.clay / rust

// caps + rates, matched to the iOS app (WebSocketLink / CockpitView)
const MAX_LIN = 1.2;             // m/s     (WebSocketLink.maxLin)
const MAX_ANG = 1.8;             // rad/s   (WebSocketLink.maxAng)
const LIFT_RATE = 0.22;          // m/s     lift command rate (right stick Y)
const LIFT_MAX = 0.635;          // m       total prismatic travel
const ARM_RATE = 1.4;            // rad/s   joystick → joint nudge (CockpitView.armRate)
const MAX_STIFF = 45.0;          // Nm/rad  at stiffness slider = 1 (RobotController.maxStiffness)
const PUSH_K = 60.0;             // N/m     Soft drag → external_force magnitude
const PUSH_MAX = 90.0;           // N       force cap
const TX_HZ = 20;
const PING_S = 5;

// soft-mode base admittance stand-in (mabel/admittance.py, as on the WBC page)
const ADMIT = { M: 4.5, BL: 22.0, FS: 3.0, VSTOP: 0.02, KDRAG: 45.0, BOX: 0.03, RAMP: 0.04 };

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/* ═══ status console + telemetry ═══════════════════════════════════ */
const Log = {
  el: document.getElementById('twLog'),
  max: 300,
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
  constructor(box, { follow = false } = {}) {
    this.box = box;
    this.stage = box.querySelector('.wbc-stage') || box;
    this.canvas = box.querySelector('canvas');
    this.follow = follow;

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
    controls.minDistance = 0.4;
    controls.maxDistance = 8;
    controls.target.set(0, 0.5, 0);
    this.controls = controls;

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
    this.center0 = c.clone();
    this.controls.target.copy(c);
    // cockpit: a chase view from behind the robot (it faces world −X at yaw 0);
    // control console: the familiar three-quarter view.
    const off = this.follow
      ? new THREE.Vector3(this.maxd * 1.5, this.maxd * 0.7, this.maxd * 0.95)
      : new THREE.Vector3(this.maxd * 0.85, this.maxd * 0.5, this.maxd * 1.25);
    this.camera.position.copy(c).add(off);
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

  // pose the rig from canonical state. The base pose (bx, by, yaw) lives in
  // the URDF/MuJoCo world frame (z-up); the GLB root carries the Z-up→Y-up
  // fix, so composing T0 ∘ B maps it exactly: p = p0 + q0·(bx,by,0),
  // q = q0 · Rz(yaw).
  pose(state) {
    for (const name in state.q) this.setJoint(name, state.q[name]);
    const off = new THREE.Vector3(state.bx, state.by, 0).applyQuaternion(this.rootQ0);
    this.root.position.copy(this.rootP0).add(off);
    this.root.quaternion.copy(this.rootQ0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), state.yaw));
    this.root.updateMatrixWorld(true);
  }

  // robot root world position (for the cockpit chase camera)
  rootWorld(state) {
    return new THREE.Vector3(state.bx, state.by, 0).applyQuaternion(this.rootQ0).add(this.center0);
  }

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

  marker(color, radius) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.4 }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.35, radius * 1.6, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    m.add(ring);
    this.scene.add(m);
    return m;
  }

  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
}

/* ═══ round virtual joystick (the iOS Joystick component) ══════════ */
function makeJoystick(el, onChange) {
  const knob = el.querySelector('.ck-knob');
  const v = { x: 0, y: 0 };
  const paint = () => {
    knob.style.left = `${(v.x * 0.36 + 0.5) * 100}%`;
    knob.style.top = `${(-v.y * 0.36 + 0.5) * 100}%`;
  };
  const emit = () => { paint(); onChange(v.x, v.y); };
  const fromEvent = (ev) => {
    const r = el.getBoundingClientRect();
    let x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    let y = -(((ev.clientY - r.top) / r.height) * 2 - 1);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    v.x = x; v.y = y;
    emit();
  };
  let active = false;
  el.addEventListener('pointerdown', (e) => { active = true; el.setPointerCapture(e.pointerId); el.classList.add('live'); fromEvent(e); });
  el.addEventListener('pointermove', (e) => { if (active) fromEvent(e); });
  const stop = () => {
    if (!active) return;
    active = false;
    el.classList.remove('live');
    v.x = 0; v.y = 0;                  // spring back — velocity command
    emit();
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  paint();
  return { zero() { v.x = 0; v.y = 0; emit(); } };
}

/* hold-to-repeat chevron button (CockpitView.holdButton) */
function makeHold(el, set) {
  const down = (e) => { e.preventDefault(); el.classList.add('live'); set(parseFloat(el.dataset.dir)); };
  const up = () => { el.classList.remove('live'); set(0); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}

/* vertical grip trigger (CockpitView.gripTrigger) */
function makeGrip(el, onChange) {
  const fill = el.querySelector('.ck-grip-fill');
  const out = el.querySelector('.ck-grip-val');
  const paint = (g) => {
    fill.style.height = `${Math.max(10, g * 100)}%`;
    out.textContent = `${Math.round(g * 100)}%`;
  };
  const fromEvent = (ev) => {
    const r = el.querySelector('.ck-grip-track').getBoundingClientRect();
    const g = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height));
    paint(g); onChange(g);
  };
  let active = false;
  el.addEventListener('pointerdown', (e) => { active = true; el.setPointerCapture(e.pointerId); fromEvent(e); });
  el.addEventListener('pointermove', (e) => { if (active) fromEvent(e); });
  const stop = () => { active = false; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  paint(0);
  return { set(g) { paint(g); } };
}

/* ═══ WebSocket link — ported from WebSocketLink.swift ═════════════ */
class Link {
  constructor(app) {
    this.app = app;
    this.ws = null;
    this.wantConnection = false;   // false only after explicit disconnect
    this.connected = false;
    this.live = false;             // robot_state frames flowing
    this.attempts = 0;
    this.seq = 0;
    this.rtt = null;
    this.lastRecv = 0;
    this.serverName = null;
    this._timers = [];
    this._pingSent = 0;
    this._lastStateLog = 0;
    this._retry = null;
  }

  normalize(raw) {
    let u = (raw || '').trim();
    if (!u) u = 'ws://localhost:9090/teleop';
    if (!/^wss?:\/\//.test(u)) u = 'ws://' + u;
    const m = u.match(/^(wss?:\/\/)([^/:]+)(:\d+)?(\/.*)?$/);
    if (m) u = m[1] + m[2] + (m[3] || ':9090') + (m[4] || '/teleop');
    return u;
  }

  /** Operator (or page load) asks for a link; retried forever until disconnect(). */
  connect(raw) {
    this.url = this.normalize(raw);
    try { localStorage.setItem('mabel-ws-url', this.url); } catch (e) { /* private mode */ }
    if (location.protocol === 'https:' && this.url.startsWith('ws://')
        && !/^ws:\/\/(localhost|127\.0\.0\.1)/.test(this.url)) {
      Log.warn('https page → browsers only allow ws:// to localhost. For a LAN robot use wss:// or open the site over http.');
    }
    this.wantConnection = true;
    this.attempts = 0;
    this._open();
  }

  disconnect() {
    this.wantConnection = false;
    clearTimeout(this._retry);
    this._teardown();
    this.connected = false; this.live = false; this.rtt = null;
    this.app.setPill('local', 'LOCAL SIM');
    Log.sys('Disconnected — staying on the in-browser sim until you reconnect.');
    this.app.onLink(false);
  }

  _open() {
    if (!this.wantConnection) return;
    this._teardown();
    this.app.setPill('connecting', 'CONNECTING');
    if (this.attempts < 3 || this.attempts % 10 === 0) {
      Log.sys(`Connecting to ${this.url} … (attempt ${this.attempts + 1})`);
    }
    let ws;
    try { ws = new WebSocket(this.url); }
    catch (e) { Log.err(`WebSocket refused: ${e.message}`); this._dropped(); return; }
    this.ws = ws;

    // handshake watchdog (6 s, like the app)
    this._timers.push(setTimeout(() => {
      if (!this.connected) { Log.warn('Handshake watchdog (6 s) — retrying.'); this._dropped(); }
    }, 6000));

    ws.onopen = () => {
      this.connected = true;
      this.attempts = 0;
      this.lastRecv = performance.now();
      this.app.setPill('online', 'ONLINE');
      Log.ok(`Link up — ${this.url}`);
      this.send('hello', { client: 'mabel-web', version: '1' });
      this.app.sendControlSpec();          // announce the active control mode
      // 20 Hz frame stream + 5 s ping + 1.5 s heartbeat (3.5 s silence = dead)
      this._timers.push(setInterval(() => this.app.pushFrame(), 1000 / TX_HZ));
      this._timers.push(setInterval(() => {
        this._pingSent = performance.now();
        this.send('ping', { t: Date.now() / 1000 });
      }, PING_S * 1000));
      this._timers.push(setInterval(() => {
        if (performance.now() - this.lastRecv > 3500) {
          Log.warn('No data for >3.5 s — link is dead, reconnecting.');
          this._dropped();
        }
      }, 1500));
      this.app.onLink(true);
    };
    ws.onmessage = (ev) => this._onMessage(ev);
    ws.onclose = () => this._dropped();
    ws.onerror = () => { /* onclose follows; logged there */ };
  }

  _teardown() {
    this._timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    this._timers = [];
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try { this.ws.close(1000); } catch (e) { /* already closed */ }
      this.ws = null;
    }
  }

  _dropped() {
    const wasLive = this.live;
    this._teardown();
    this.connected = false; this.live = false; this.rtt = null;
    if (!this.wantConnection) return;
    this.attempts += 1;
    const delay = Math.min(3, 0.3 * this.attempts);
    if (wasLive) {
      Log.warn(`Link lost — local sim takes over; reconnecting in ${delay.toFixed(1)} s (the bridge keeps being retried until you press Disconnect).`);
      this.app.onLink(false);
    } else if (this.attempts <= 3 || this.attempts % 10 === 0) {
      Log.sys(`No bridge at ${this.url} yet — retrying (attempt ${this.attempts}). Local sim stays live meanwhile.`);
    }
    this.app.setPill('connecting', `RETRY ${this.attempts}`);
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._open(), delay * 1000);
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify({ type, payload })); } catch (e) { /* heartbeat will catch it */ }
  }

  _onMessage(ev) {
    this.lastRecv = performance.now();
    let msg;
    try { msg = JSON.parse(ev.data); }
    catch (e) { return; }
    const p = msg.payload || {};
    switch (msg.type) {
      case 'hello':
        this.serverName = p.server || p.name || 'mabel';
        Tele.set('server', `${this.serverName} v${p.version ?? '?'}`);
        Log.rx(`hello — server "${this.serverName}" v${p.version ?? '?'}${this.serverName === 'mabel_sim_bridge' ? ' (MuJoCo sim)' : ''}`);
        break;
      case 'robot_state': {
        if (!this.live) {
          this.live = true;
          this.app.setPill('online', 'ONLINE');
          Log.ok('robot_state stream up — the 3D model now mirrors the SERVER simulation (local stepping paused).');
        }
        this.app.applyRobotState(p);
        const now = performance.now();
        if (now - this._lastStateLog > 2000) {
          this._lastStateLog = now;
          const nq = p.jointPositions ? Object.keys(p.jointPositions).length : 0;
          const b = p.base ? ` · base (${(+p.base.x || 0).toFixed(2)}, ${(+p.base.y || 0).toFixed(2)}) m, yaw ${((+p.base.yaw || 0) * 180 / Math.PI).toFixed(0)}°` : '';
          Log.rx(`robot_state · ${nq} joints${b} · bridge lat ${(+p.latencyMs || 0).toFixed(0)} ms`);
        }
        break;
      }
      case 'pong':
        if (this._pingSent) this.rtt = performance.now() - this._pingSent;
        break;
      case 'error':
        Log.err(`server: ${p.message || JSON.stringify(p)}`);
        break;
      default:
        break;   // forward-compatible: ignore unknown types quietly
    }
  }
}

/* ═══ the app ══════════════════════════════════════════════════════ */
class App {
  constructor(manifest, cockpit, control) {
    this.manifest = manifest;
    this.cockpit = cockpit;          // primary rig — IK + world queries run here
    this.control = control;

    // canonical robot state: joint map + base pose in the URDF world frame
    this.state = { q: {}, bx: 0, by: 0, yaw: 0 };
    for (const j of manifest.joints) {
      this.state.q[j.name] = (j.lower != null && j.upper != null)
        ? Math.min(j.upper, Math.max(j.lower, 0)) : 0;
    }
    this.homeQ = { ...this.state.q };

    // ── operator command state (mirrors RobotController) ──
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };   // fwd m/s, strafe-right m/s, yaw-rate ccw, lift m/s
    this.lift = 0;
    this.wheelSpin = 0;
    this.grip = { left: 0, right: 0 };
    this.armJoy = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    this.armPitch = { left: 0, right: 0 };
    this.jointTarget = { ...this.homeQ };           // local impedance set-points
    this.wireJoints = {};                            // accumulated joint_command dict
    this.jointsDirty = false;

    // the three orthogonal control axes (WholeBodyView)
    this.cockpitMode = 'drive';                      // 'drive' | 'arms'
    this.feel = 'impedance';                         // Hold | Soft
    this.method = 'wrist';                           // Guide | Joints (Hold only)
    this.region = 'arm';                             // arm | upper_body | whole_body
    this.stiffness = 0.7;                            // slider 0..1 → ×45 Nm/rad on the wire

    this.drag = null;                                // active Guide/Soft drag side
    this.adm = { vx: 0, vy: 0 };                     // soft-mode base admittance

    this.chains = {
      l: ['left_arm_1', 'left_arm_2', 'left_arm_3', 'left_arm_4', 'left_arm_5', 'left_arm_6', 'left_arm_7'],
      r: ['right_arm_1', 'right_arm_2', 'right_arm_3', 'right_arm_4', 'right_arm_5', 'right_arm_6', 'right_arm_7'],
    };

    this.cockpit.pose(this.state);
    this.rest = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    for (const s of ['l', 'r']) this.cockpit.ee[s]?.getWorldPosition(this.rest[s]);
    this.restCentroid = new THREE.Vector3().addVectors(this.rest.l, this.rest.r).multiplyScalar(0.5);
    this.targets = { l: this.rest.l.clone(), r: this.rest.r.clone() };

    // green guide balls on the control stage (RealRobotView's gravityComp balls)
    this.balls = { l: control.marker(GREEN, control.maxd * 0.026), r: control.marker(GREEN, control.maxd * 0.026) };
    this.balls.l.userData.side = 'l'; this.balls.r.userData.side = 'r';

    this.link = new Link(this);
    this._teleAcc = 0;

    this._wireCockpit();
    this._wireControl();
    this._wireConnect();
    this._wireGrab();
    this._applyVisibility();

    Log.sys('Browser teleop ready — same wire protocol as the iPhone & Vision Pro apps (ws://host:9090/teleop).');
    Log.sim('Local kinematic sim live: 60 joints, swerve base, dual 7-DOF arms.');
    this._autoConnect();
    this._raf();
  }

  /* ── auto-connect (the app's launch behaviour) ───────────────────── */
  _autoConnect() {
    let saved = null;
    try { saved = localStorage.getItem('mabel-ws-url'); } catch (e) { /* private mode */ }
    const url = saved || 'ws://localhost:9090/teleop';
    const input = document.getElementById('twUrl');
    if (input) input.value = url;
    Log.sys(`Auto-connect: looking for a MABEL bridge at ${url} — start one with server/start_teleop.sh.`);
    this.link.connect(url);
  }

  /* ── small helpers ───────────────────────────────────────────────── */
  setQ(name, val) {
    const j = this.cockpit.joints[name]; if (!j) return;
    if (j.lower != null) val = Math.max(j.lower, Math.min(j.upper, val));
    this.state.q[name] = val;
    this.cockpit.setJoint(name, val);
  }

  clampJ(name, val) {
    const j = this.cockpit.joints[name];
    if (!j || j.lower == null) return val;
    return Math.max(j.lower, Math.min(j.upper, val));
  }

  setLift(v) {
    this.lift = Math.max(0, Math.min(LIFT_MAX, v));
    this.setQ('lift_lower', this.lift / 2);
    this.setQ('lift_upper', this.lift / 2);
  }

  // nudge a local joint target AND queue it on the wire (CockpitView.nudge)
  nudge(name, delta) {
    if (Math.abs(delta) < 1e-6) return;
    const v = this.clampJ(name, (this.jointTarget[name] ?? this.state.q[name] ?? 0) + delta);
    this.jointTarget[name] = v;
    this.wireJoints[name] = +v.toFixed(4);
    this.jointsDirty = true;
  }

  setWire(name, v) {
    this.wireJoints[name] = typeof v === 'number' ? +v.toFixed(4) : v;
    this.jointsDirty = true;
  }

  // hinge-constrained CCD on the primary rig (the WBC page's solver)
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

  // world (three) → URDF/MuJoCo world vector, for external_force
  toUrdf(v) {
    return v.clone().applyQuaternion(this.cockpit.rootQ0.clone().invert());
  }

  /* ── cockpit (Drive | Arms) ──────────────────────────────────────── */
  _wireCockpit() {
    const root = document.getElementById('twCockpit');

    root.querySelector('[data-ck-seg]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-ck-seg] button').forEach((x) => x.classList.toggle('on', x === b));
      this.cockpitMode = b.dataset.mode;
      this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
      if (this.cockpitMode === 'arms') {
        // seed the joint targets from wherever the arms are (no jump)
        for (const c of [...this.chains.l, ...this.chains.r]) this.jointTarget[c] = this.state.q[c];
        Log.sim('Cockpit → ARMS: per-wrist joysticks nudge the arm joints (1.4 rad/s), triggers set grip.');
      } else {
        Log.sim('Cockpit → DRIVE: left stick translates the swerve base, right stick is yaw + lift.');
      }
      this.sendControlSpec('cockpit');  // arms = wrist·impedance·arm, drive = navigation (like the app)
      this._applyVisibility();
    });

    // drive sticks (outer corners, spring-loaded velocity commands)
    makeJoystick(root.querySelector('[data-ck-joy="navL"]'), (x, y) => {
      this.nav.f = y * MAX_LIN;
      this.nav.s = x * MAX_LIN;
    });
    makeJoystick(root.querySelector('[data-ck-joy="navR"]'), (x, y) => {
      this.nav.w = -x * MAX_ANG;
      this.nav.liftRate = y;
    });

    // arm clusters: wrist joystick + up/down hold + grip trigger, per side
    for (const side of ['left', 'right']) {
      makeJoystick(root.querySelector(`[data-ck-joy="${side}"]`), (x, y) => {
        this.armJoy[side].x = x; this.armJoy[side].y = y;
      });
      root.querySelectorAll(`[data-ck-hold="${side}"]`).forEach((el) =>
        makeHold(el, (d) => { this.armPitch[side] = d; }));
      this.grips = this.grips || {};
      this.grips[side] = makeGrip(root.querySelector(`[data-ck-grip="${side}"]`), (g) => {
        this.grip[side] = g;
        this._applyGripLocal(side, g);
        this.setWire(`${side}_grip`, +g.toFixed(3));   // the bridge's apply_grasp input
      });
    }

    document.getElementById('twStop').addEventListener('click', () => {
      this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
      this.armJoy = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
      if (this.link.connected) this.pushFrame();     // push the zeros now
      Log.warn('STOP — base + lift velocities zeroed.');
    });
  }

  // 0 = extended, 1 = fist: curl the flexion joints (RobotController.setGrip)
  _applyGripLocal(side, g) {
    for (const name in this.state.q) {
      if (!name.startsWith(side) || !/(mcp|pip|dip)$/.test(name)) continue;
      const j = this.cockpit.joints[name]; if (!j) continue;
      this.jointTarget[name] = j.upper * g;
    }
  }

  /* ── manipulation console (Guide/Joints × Hold/Soft × Reach) ─────── */
  _wireControl() {
    const root = document.getElementById('twControl');

    // Feel — Hold | Soft (the prominent toggle floating over the viewer)
    root.querySelector('[data-rc-feel]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-rc-feel] button').forEach((x) => x.classList.toggle('on', x === b));
      this.feel = b.dataset.feel;
      if (this.feel === 'compliance') {
        Log.sim('Feel → SOFT (compliance): the arms are force-driven — drag a green ball to push; nothing springs back.');
      } else {
        // the Hold↔Soft handoff: targets continue from the *actual* pose
        for (const c of [...this.chains.l, ...this.chains.r]) this.jointTarget[c] = this.state.q[c];
        Log.sim('Feel → HOLD (impedance): the robot tracks commanded targets with a spring.');
      }
      this.sendControlSpec('console');
      this._applyVisibility();
    });

    // Teleop — Guide | Joints
    root.querySelector('[data-rc-method]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-rc-method] button').forEach((x) => x.classList.toggle('on', x === b));
      this.method = b.dataset.method;
      if (this.method === 'joint') {
        for (const k in this.state.q) this.jointTarget[k] = this.state.q[k];
        this._syncJointSliders();
        Log.sim('Teleop → JOINTS: sliders command targets; the robot slews to them.');
      } else {
        Log.sim('Teleop → GUIDE: drag a green palm ball — the arm follows it (IK here, WBC impedance on the bridge).');
      }
      this.sendControlSpec('console');
      this._applyVisibility();
    });

    // Reach — Arm | Upper | Whole
    root.querySelector('[data-rc-region]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      root.querySelectorAll('[data-rc-region] button').forEach((x) => x.classList.toggle('on', x === b));
      this.region = b.dataset.region;
      Log.sim(`Reach → ${{ arm: 'ARM (base + lift held)', upper_body: 'UPPER BODY (torso joins in)', whole_body: 'WHOLE BODY (the base glides along)' }[this.region]}.`);
      this.sendControlSpec('console');
    });

    const ssl = root.querySelector('[data-rc-stiff]');
    ssl.addEventListener('input', () => {
      this.stiffness = parseFloat(ssl.value);
      root.querySelector('[data-rc-stiff-out]').textContent = `${(this.stiffness * MAX_STIFF).toFixed(0)} Nm/rad`;
      clearTimeout(this._stiffT);
      this._stiffT = setTimeout(() => this.sendControlSpec('console'), 150);
    });

    document.getElementById('twHome').addEventListener('click', () => this.resetAll(true));
    this._buildJointSliders(root);
  }

  _buildJointSliders(root) {
    const tabs = root.querySelector('[data-rc-jtabs]');
    const list = root.querySelector('[data-rc-jlist]');
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
          this.setWire(j.name, v);
          vl.textContent = fmt(j, v);
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

  /* ── green-ball drag on the control stage ────────────────────────── */
  _wireGrab() {
    const st = this.control;
    st.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (!this._ballsVisible()) return;
      const hit = st.pick(ev, [this.balls.l, this.balls.r]);
      if (!hit) return;
      this.drag = hit.userData.side;
      this.cockpit.ee[this.drag]?.getWorldPosition(this.targets[this.drag]);
      st.controls.enabled = false;
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
      const side = this.drag;
      this.drag = null;
      st.controls.enabled = true;
      st.stage.classList.remove('grabbing');
      if (this.feel === 'compliance') {
        this.link.send('external_force', { forces: {} });   // release the push
      } else {
        // Hold: the dragged pose IS the new impedance target
        for (const c of this.chains[side]) { this.jointTarget[c] = this.state.q[c]; this.setWire(c, this.state.q[c]); }
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _ballsVisible() {
    return this.feel === 'compliance' || this.method === 'wrist';
  }

  /* ── connect bar ─────────────────────────────────────────────────── */
  _wireConnect() {
    const btn = document.getElementById('twConnect');
    const url = document.getElementById('twUrl');
    btn.addEventListener('click', () => {
      if (this.link.wantConnection) this.link.disconnect();
      else this.link.connect(url.value);
    });
    url.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (this.link.wantConnection) this.link.disconnect(); this.link.connect(url.value); }
    });
    document.getElementById('twLogClear')?.addEventListener('click', () => {
      Log.el.innerHTML = ''; Log.sys('Log cleared.');
    });
    document.getElementById('twReset')?.addEventListener('click', () => this.resetAll(true));
  }

  setPill(state, label) {
    document.querySelectorAll('.tw-pill').forEach((pill) => {
      pill.className = `tw-pill ${state}`;
      pill.textContent = label;
    });
    const btn = document.getElementById('twConnect');
    if (btn) btn.textContent = this.link?.wantConnection ? 'Disconnect' : 'Connect';
    Tele.set('link', label);
  }

  onLink(up) {
    if (!up) {
      Tele.set('battery', '— (local)');
      Tele.set('server', '—');
      // local commands continue from wherever the server left the robot
      for (const k in this.state.q) this.jointTarget[k] = this.state.q[k];
    }
  }

  /* ── uplink (matches WebSocketLink.pushFrame byte-for-byte) ──────── */
  pushFrame() {
    this.link.seq += 1;
    this.link.send('teleop_frame', {
      sequence: this.link.seq,
      timestamp: Date.now() / 1000,
      head: { transform: { matrix: IDENTITY16 }, trackingState: 'normal' },
      mode: 'Base Driving',
      navJoystick: {
        lx: +(this.nav.s / MAX_LIN).toFixed(3),
        ly: +(-this.nav.f / MAX_LIN).toFixed(3),
        rx: +(this.nav.w / MAX_ANG).toFixed(3),
        ry: +this.nav.liftRate.toFixed(3),
      },
    });
    if (this.jointsDirty) {
      this.jointsDirty = false;
      this.link.send('joint_command', { joints: this.wireJoints });
    }
  }

  sendControlSpec(source) {
    // One bridge, one active spec — the LAST surface touched wins (the bridge
    // itself follows the active driver the same way). The cockpit announces
    // navigation (Drive) or wrist·impedance·arm (Arms), exactly like the app;
    // the console announces its three axes, with Soft pinning method to wrist
    // just to engage the compliance law (WholeBodyView.applySpec does the same).
    if (source === 'cockpit' || (!source && this._lastSpecSrc !== 'console')) {
      this._lastSpecSrc = 'cockpit';
      this._spec = this.cockpitMode === 'drive'
        ? { method: 'navigation', controlType: 'impedance', region: 'whole_body', stiffness: this.stiffness * MAX_STIFF }
        : { method: 'wrist', controlType: 'impedance', region: 'arm', stiffness: this.stiffness * MAX_STIFF };
    } else {
      this._lastSpecSrc = 'console';
      const method = this.feel === 'compliance' ? 'wrist' : (this.method === 'joint' ? 'joint' : 'wrist');
      this._spec = { method, controlType: this.feel, region: this.region, stiffness: this.stiffness * MAX_STIFF };
    }
    if (this.link.connected) {
      this.link.send('control_mode', this._spec);
      Log.tx(`control_mode · ${this._spec.method} · ${this._spec.controlType} · ${this._spec.region} · K=${this._spec.stiffness.toFixed(0)}`);
    }
  }

  resetAll(announce) {
    for (const name in this.homeQ) this.setQ(name, this.homeQ[name]);
    this.state.bx = this.state.by = this.state.yaw = 0;
    this.lift = 0; this.wheelSpin = 0;
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
    this.adm = { vx: 0, vy: 0 };
    this.grip = { left: 0, right: 0 };
    this.grips?.left?.set(0); this.grips?.right?.set(0);
    this.armJoy = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    this.jointTarget = { ...this.homeQ };
    this.wireJoints = {}; this.jointsDirty = false;
    this.cockpit.pose(this.state);
    for (const s of ['l', 'r']) this.cockpit.ee[s]?.getWorldPosition(this.targets[s]);
    this._syncJointSliders();
    if (this.link.connected) { this.link.send('reset', {}); Log.tx('reset — bridge homes the sim.'); }
    if (announce) Log.sim('Robot reset to home.');
  }

  /* ── incoming robot_state → canonical state ──────────────────────── */
  applyRobotState(p, dt = 0.05) {
    if (p.jointPositions) {
      for (const name in p.jointPositions) {
        if (name in this.state.q) this.state.q[name] = +p.jointPositions[name];
      }
      this.lift = (this.state.q.lift_lower || 0) + (this.state.q.lift_upper || 0);
    }
    if (p.base) {
      this.state.bx = +p.base.x || 0;
      this.state.by = +p.base.y || 0;
      this.state.yaw = +p.base.yaw || 0;
      const steer = p.base.steer, drive = p.base.drive;
      if (Array.isArray(steer) && steer.length === 3) {
        ['fl_steer', 'fr_steer', 'b_steer'].forEach((n, i) => { this.state.q[n] = +steer[i]; });
      }
      if (Array.isArray(drive) && drive.length === 3) {
        // drive comes back as wheel VELOCITY — integrate for the spin animation
        ['fl_drive', 'fr_drive', 'b_drive'].forEach((n, i) => {
          this.state.q[n] = (this.state.q[n] || 0) + (+drive[i]) * dt;
        });
      }
    }
    if (p.battery) {
      const pc = +p.battery.percentage;
      Tele.set('battery', `${(pc <= 1.5 ? pc * 100 : pc).toFixed(0)} % · ${(+p.battery.voltage || 0).toFixed(1)} V`);
    }
    if (p.latencyMs != null) Tele.set('lat', `${(+p.latencyMs).toFixed(0)} ms`);
    // fingers/grips aren't in the telemetry set — keep the local grip pose so
    // the hands don't snap open; everything telemetered above is server truth.
    for (const side of ['left', 'right']) this._applyGripLocalToState(side);
  }

  _applyGripLocalToState(side) {
    for (const name in this.state.q) {
      if (!name.startsWith(side) || !/(mcp|pip|dip)$/.test(name)) continue;
      const j = this.cockpit.joints[name]; if (!j) continue;
      this.state.q[name] = j.upper * this.grip[side];
    }
  }

  /* ── local sim step (runs only while no robot_state stream) ──────── */
  stepLocal(dt) {
    const g = { ikGain: 0.25 + 0.45 * this.stiffness, qRate: 1.0 + 2.2 * this.stiffness };

    // 1) swerve base. The chassis drives toward −X of its body frame (the
    //    bridge's "forward is −vx"), so at yaw the world-frame axes are:
    const fwd = { x: -Math.cos(this.state.yaw), y: -Math.sin(this.state.yaw) };
    const right = { x: -Math.sin(this.state.yaw), y: Math.cos(this.state.yaw) };
    this.state.yaw += this.nav.w * dt;
    this.state.bx += (this.nav.f * fwd.x + this.nav.s * right.x) * dt;
    this.state.by += (this.nav.f * fwd.y + this.nav.s * right.y) * dt;
    const speed = Math.hypot(this.nav.f, this.nav.s);
    if (speed > 1e-3 || Math.abs(this.nav.w) > 1e-3) {
      this.wheelSpin += Math.max(speed, Math.abs(this.nav.w) * 0.3) * dt * 12;
      const steer = (speed > 1e-3) ? Math.atan2(this.nav.s, this.nav.f) : 0;
      for (const n of ['fl_steer', 'fr_steer', 'b_steer']) this.setQ(n, steer);
      for (const n of ['fl_drive', 'fr_drive', 'b_drive']) this.setQ(n, this.wheelSpin);
    }
    if (Math.abs(this.nav.liftRate) > 1e-3) this.setLift(this.lift + this.nav.liftRate * LIFT_RATE * dt);

    // 2) cockpit ARMS joysticks → joint nudges (CockpitView.onTick, same signs)
    if (this.cockpitMode === 'arms') {
      for (const side of ['left', 'right']) {
        const joy = this.armJoy[side], m = side === 'left' ? -1 : 1;
        const dySwift = -joy.y;                       // SwiftUI y grows downward
        this.nudge(`${side}_arm_3`, joy.x * m * ARM_RATE * dt);
        this.nudge(`${side}_arm_2`, -dySwift * m * ARM_RATE * dt);
        this.nudge(`${side}_arm_1`, -this.armPitch[side] * ARM_RATE * dt);
      }
    }

    // 3) manipulation console
    if (this.drag) {
      if (this.feel === 'compliance') {
        // SOFT: the drag is a world-frame push (external_force on the bridge);
        // locally the back-drivable arm yields toward the pull.
        const side = this.drag;
        const ee = new THREE.Vector3();
        this.cockpit.ee[side].getWorldPosition(ee);
        const pull = new THREE.Vector3().subVectors(this.targets[side], ee);
        this.ik(side, this.targets[side], 0.18, 1);
        const fUrdf = this.toUrdf(pull).multiplyScalar(PUSH_K).clampLength(0, PUSH_MAX);
        this.link.send('external_force', {
          forces: { [`${side === 'l' ? 'l' : 'r'}_hand_mount`]: [+fUrdf.x.toFixed(2), +fUrdf.y.toFixed(2), +fUrdf.z.toFixed(2)] },
        });
        if (this.region === 'whole_body') this._baseAdmittance(dt);
        if (this.region !== 'arm') this._lazyTorso(dt);
      } else if (this.method === 'wrist') {
        // HOLD · GUIDE: stiff IK toward the ball; stream the realised joint
        // targets so the bridge's WBC impedance tracks the same pose.
        this.ik(this.drag, this.targets[this.drag], g.ikGain, 2);
        for (const c of this.chains[this.drag]) { this.jointTarget[c] = this.state.q[c]; this.setWire(c, this.state.q[c]); }
        if (this.region === 'whole_body') this._lazyBase(dt);
        if (this.region !== 'arm') this._lazyTorso(dt);
      }
    }

    // 4) impedance: slew every local joint toward its target, rate-limited
    const skipIk = this.drag && this.feel !== 'compliance';
    for (const name in this.jointTarget) {
      if (skipIk && this.chains[this.drag].includes(name)) continue;
      const cur = this.state.q[name], tgt = this.clampJ(name, this.jointTarget[name]);
      if (cur === tgt || cur == null) continue;
      const rate = (/(mcp|pip|dip)$/.test(name) ? 5.0 : g.qRate) * dt;
      const d = tgt - cur;
      this.setQ(name, Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate);
    }
  }

  // soft whole-body: the push drives the base as a virtual mass-damper
  _baseAdmittance(dt) {
    const side = this.drag;
    const ee = new THREE.Vector3();
    this.cockpit.ee[side].getWorldPosition(ee);
    const pullU = this.toUrdf(new THREE.Vector3().subVectors(this.targets[side], ee));
    let fx = ADMIT.KDRAG * 3 * pullU.x, fy = ADMIT.KDRAG * 3 * pullU.y;
    if (Math.abs(fx) <= ADMIT.FS) fx = 0;
    if (Math.abs(fy) <= ADMIT.FS) fy = 0;
    this.adm.vx += (fx - ADMIT.BL * this.adm.vx) / ADMIT.M * dt;
    this.adm.vy += (fy - ADMIT.BL * this.adm.vy) / ADMIT.M * dt;
    if (fx === 0 && Math.abs(this.adm.vx) < ADMIT.VSTOP) this.adm.vx = 0;
    if (fy === 0 && Math.abs(this.adm.vy) < ADMIT.VSTOP) this.adm.vy = 0;
    this.state.bx += this.adm.vx * dt;
    this.state.by += this.adm.vy * dt;
  }

  // hold whole-body: the base creeps after the dragged ball (lazy follower)
  _lazyBase(dt) {
    const side = this.drag;
    const home = this.rest[side].clone();
    const offW = new THREE.Vector3(this.state.bx, this.state.by, 0).applyQuaternion(this.cockpit.rootQ0);
    home.add(offW);
    const e = this.toUrdf(new THREE.Vector3().subVectors(this.targets[side], home));
    const HALF = 0.18, KP = 1.5;
    if (Math.abs(e.x) > HALF) this.state.bx += KP * (e.x - Math.sign(e.x) * HALF) * dt;
    if (Math.abs(e.y) > HALF) this.state.by += KP * (e.y - Math.sign(e.y) * HALF) * dt;
  }

  // upper-body reach: the torso takes a lazy share of the lateral error
  _lazyTorso(dt) {
    const tj = this.cockpit.joints.torso; if (!tj || !this.drag) return;
    const ee = new THREE.Vector3();
    this.cockpit.ee[this.drag].getWorldPosition(ee);
    const e = this.toUrdf(new THREE.Vector3().subVectors(this.targets[this.drag], ee));
    const want = this.clampJ('torso', this.state.q.torso + e.y * 0.4);
    this.setQ('torso', this.state.q.torso + (want - this.state.q.torso) * Math.min(1, dt * 1.2));
    this.jointTarget.torso = this.state.q.torso;
  }

  /* ── per-mode visibility ─────────────────────────────────────────── */
  _applyVisibility() {
    document.querySelectorAll('[data-ck-show]').forEach((el) => {
      el.style.display = el.dataset.ckShow === this.cockpitMode ? '' : 'none';
    });
    const hold = this.feel === 'impedance';
    document.querySelectorAll('[data-rc-show]').forEach((el) => {
      const k = el.dataset.rcShow;
      const show = (k === 'hold' && hold)
        || (k === 'soft' && !hold)
        || (k === 'guide' && hold && this.method === 'wrist')
        || (k === 'joints' && hold && this.method === 'joint');
      el.style.display = show ? '' : 'none';
    });
    const balls = this._ballsVisible();
    this.balls.l.visible = balls;
    this.balls.r.visible = balls;
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

      // cockpit chase camera: target rides with the robot
      const want = this.cockpit.rootWorld(this.state);
      want.y = this.cockpit.controls.target.y;
      const dx = want.x - this.cockpit.controls.target.x;
      const dz = want.z - this.cockpit.controls.target.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-5) {
        this.cockpit.controls.target.x += dx; this.cockpit.controls.target.z += dz;
        this.cockpit.camera.position.x += dx; this.cockpit.camera.position.z += dz;
      }

      // guide balls glue to the palms unless actively dragged
      for (const s of ['l', 'r']) {
        if (this.drag === s) this.balls[s].position.copy(this.targets[s]);
        else if (this.control.ee[s]) { this.control.ee[s].getWorldPosition(ee); this.balls[s].position.copy(ee); }
      }

      this.cockpit.render();
      this.control.render();

      this._teleAcc += dt;
      if (this._teleAcc > 0.25) {
        this._teleAcc = 0;
        Tele.set('pose', `x ${this.state.bx.toFixed(2)} · y ${this.state.by.toFixed(2)} m · ${(this.state.yaw * 180 / Math.PI).toFixed(0)}°`);
        Tele.set('lift', `${(this.lift * 100).toFixed(1)} cm`);
        Tele.set('speed', `${Math.hypot(this.nav.f, this.nav.s).toFixed(2)} m/s`);
        Tele.set('mode', this.cockpitMode === 'drive' ? 'DRIVE' : 'ARMS');
        Tele.set('ctl', `${this.feel === 'impedance' ? 'Hold' : 'Soft'} · ${this.method === 'joint' && this.feel === 'impedance' ? 'Joints' : 'Guide'} · ${{ arm: 'Arm', upper_body: 'Upper', whole_body: 'Whole' }[this.region]}`);
        Tele.set('rtt', this.link.rtt != null ? `${this.link.rtt.toFixed(0)} ms` : '—');
        Tele.set('src', this.link.live ? 'SERVER (MuJoCo)' : 'BROWSER (kinematic)');
        Tele.set('rate', this.link.connected ? `${TX_HZ} Hz up · 20 Hz state down` : '60 Hz local');
        if (!this.link.live) Tele.set('lat', '—');
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
    const cockpit = new Stage(cockpitBox, { follow: true });
    const control = new Stage(controlBox);
    await Promise.all([cockpit.load(manifest), control.load(manifest)]);
    new App(manifest, cockpit, control);
  } catch (e) {
    console.error('teleop-web boot failed', e);
    Log.err(`Boot failed: ${e.message || e}`);
  }
})();
