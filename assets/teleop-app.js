/* ════════════════════════════════════════════════════════════════════
   teleop-app.js — the MABEL browser operator console.

   Three operator views (Teleop · Body · Navigate) over ONE canonical robot
   state, speaking the same wire protocol as the iPhone and Vision Pro apps
   to the same bridge (ws://host:9090/teleop + http://host:8080 cameras):

     teleop_frame   navJoystick {lx,ly,rx,ry}     (drive / follow-path)
     joint_command  {joints:{id:rad}}             (arm nudges, sliders, IK)
     control_mode   {method,controlType,region,stiffness}
     external_force {forces:{body:[fx,fy,fz]}}    (Soft push)
     reset / ping   ← robot_state {jointPositions, base, latencyMs, battery}

   ── FRAMES (the one seam) ────────────────────────────────────────────
   All robot math runs in the MuJoCo/URDF world frame from the simulation/
   scenes: Z-up, robot front = −X, robot left = −Y. The GLB rig is exported
   raw in that frame, so every rig lives inside a wrapper Group carrying the
   single Z-up→Y-up display rotation Q_ZUP = Rx(−90°). Base pose (x, y, yaw)
   is applied INSIDE the wrapper in MuJoCo coordinates; nothing else ever
   converts frames except toMj()/toThree() at this seam.

   Wire navJoystick signs — MUST match the iOS / Vision Pro apps (NetworkConfig
   TwistSigns for the sim robot = fwd:+1, strafe:-1, yaw:-1). wire.py negates
   (-lx,-ly); _navigate does tvx=ly·MAX, tvy=lx·MAX; swerve_ik: vx>0=+X=back,
   vy>0=+Y=right. Net wire convention the client must emit:
     forward stick ⇒ ly = +fwd      right strafe ⇒ lx = -strafe
     rx = yaw (stick-right ⇒ rx<0 ⇒ CW)        ry = lift rate (up ⇒ +)
   ════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── caps + rates (matched to the iOS app / bridge config) ──────────── */
const MAX_LIN = 1.2;        // m/s
const MAX_ANG = 1.8;        // rad/s
const LIFT_RATE = 0.22;     // m/s
const LIFT_MAX = 0.635;     // m
const MAX_STIFF = 45.0;     // Nm/rad at stiffness slider = 1
const PUSH_K = 60.0, PUSH_MAX = 90.0;   // N/m, N — Soft drag → external_force
const TX_HZ = 60, PING_S = 5;   // 60 Hz uplink: command staleness ~16 ms (was 20 Hz / 50 ms)
const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Per-tab session id — random per page load, so the command monitor can tell
// multiple browser openings (same machine, same browser) apart.
const _SID = Math.random().toString(36).slice(2, 6);

/* ── Known bridge addresses (operator's networks) ─────────────────────
   Wi-Fi auto-discovery probes these in parallel (over http) on top of the
   live candidates, so a fresh network — or a stale bookmark from another
   one — connects without searching forever. All private / CGNAT ranges,
   not routable from the public internet.
     · The TAILSCALE IP is network-independent: it answers on home, lab,
       NYU, and the iPhone hotspot alike (whenever Tailscale is up on both
       ends), so it's listed first as the universal path.
     · LAN IPs are the lowest-latency local path on each specific network.
   Edit freely as networks change; the ts.net name goes in the VPN field. */
const KNOWN_HOSTS = [
  '100.68.140.105',                              // Tailscale IP — works on ANY network
  '192.168.123.34',                              // lab Wi-Fi (192.168.123.0/24)
  '172.20.10.2', '172.20.10.3', '172.20.10.4',   // iPhone hotspot (Mac gets 172.20.10.2–14)
  // home Wi-Fi: add the Mac's LAN IP once captured (`ipconfig getifaddr en0`)
  // NYU Wi-Fi: client isolation usually blocks LAN — rely on the Tailscale IP above
];

// The Mac's Tailscale DNS name — the ONLY host that works from the public https
// site (its TLS cert is issued for this name). Needs the wss proxy published once
// on the Mac: `tailscale serve --bg --https=8443 localhost:9090` (+ :443→8080 for
// cameras), and Tailscale "Serve/HTTPS" enabled in the admin console. Pre-seeded
// into the VPN field so the published site has a remote path with zero typing.
const DEFAULT_VPN = 'jerrys-macbook-pro.taile5c63a.ts.net';

// ── PUBLIC "try it live" endpoint (the reference site's "cloud server") ──────
// The ONLY path that works for an arbitrary visitor on the public https site:
// Wi-Fi is blocked (ws:// to a LAN), and VPN needs them on the tailnet. The
// secure relay (server/relay/README.md) is the universal one — the robot dials
// OUT to a token-gated public VPS, so https://robotmabel.github.io can drive
// with zero typing. Fill these ONCE the relay VPS is up:
//   · DEFAULT_RELAY      — the public hostname (NOT secret), e.g. mabel.duckdns.org
//   · DEFAULT_RELAY_KEY  — the relay APP_TOKEN. ⚠ this lands in the public repo,
//     so use a token scoped to the SIM demo bridge, never the physical robot,
//     and rotate it like a password (setup-vps.sh).
// Leave both '' to keep the public site on the always-live in-browser twin.
const DEFAULT_RELAY = 'mabelrobot.duckdns.org';
const DEFAULT_RELAY_KEY = '69f4ec12c13c627ecf3097f648b42b60649e72b6afc4c6f1';

const ACCENT = 0xe9a679, GREEN = 0x3FB56B, RED = 0xb3402e, BONE = 0xefeae3;

/* MuJoCo Z-up → three.js Y-up. (x,y,z)ᵐʲ ↦ (x,z,−y)ᵗʰʳᵉᵉ */
const Q_ZUP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const Q_ZUP_INV = Q_ZUP.clone().invert();
const toThree = (v) => v.clone().applyQuaternion(Q_ZUP);
const toMj = (v) => v.clone().applyQuaternion(Q_ZUP_INV);
const UP_Y = new THREE.Vector3(0, 1, 0);   // three.js world up (for RAISE up/down)

// localhost-family hosts: the browser treats these as "potentially trustworthy",
// so a plain ws:// to them is allowed even from an https page (mixed-content rules
// exempt them). LAN / Tailscale IPs are NOT exempt → blocked from https.
const _isLocalHost = (h) => /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test((h || '').trim());

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UI = { set(k, v) { $$(`[data-ta="${k}"]`).forEach((el) => { el.textContent = v; }); } };

/* ════ Link — WebSocket to the bridge ════════════════════════════════ */
class Link {
  constructor(app) {
    this.app = app;
    this.ws = null; this.connected = false; this.want = false;
    this.url = ''; this.seq = 0; this.rtt = null;
    this._pingT = null; this._retryT = null; this._pingSent = 0;
  }
  connect(url) {
    this.url = url; this.want = true;
    clearTimeout(this._retryT);
    // Detach + close any in-flight socket so a path failover (Wi-Fi → VPN)
    // can't leave a zombie retrying the old URL.
    if (this.ws) {
      const old = this.ws; this.ws = null;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch (e) {}
    }
    this._open();
  }
  disconnect() {
    this.want = false;
    clearTimeout(this._retryT); clearInterval(this._pingT);
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this._down();
  }
  _open() {
    if (!this.want) return;
    try { this.ws = new WebSocket(this.url); } catch (e) { this._retry(); return; }
    this.ws.onopen = () => {
      this.connected = true;
      this._pingT = setInterval(() => {
        this._pingSent = performance.now();
        this.send('ping', { t: Date.now() / 1000 });
      }, PING_S * 1000);
      this.app.onLink(true);
    };
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const p = msg.payload || {};
      if (msg.type === 'robot_state') this.app.applyRobotState(p);
      else if (msg.type === 'pong') { this.rtt = performance.now() - this._pingSent; UI.set('rtt', `${this.rtt.toFixed(0)} ms`); }
      else if (msg.type === 'hello') this.app.onHello(p);
    };
    this.ws.onclose = () => { const was = this.connected; this._down(); if (was || this.want) this._retry(); };
    this.ws.onerror = () => {};
  }
  _down() {
    if (this.connected) this.app.onLink(false);
    this.connected = false; this.rtt = null;
    clearInterval(this._pingT);
  }
  _retry() { if (this.want) this._retryT = setTimeout(() => this._open(), 2000); }
  send(type, payload) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify({ type, payload })); } catch (e) {}
  }
}

/* ════ Stage — one renderer + scene + (optional) orbit ═══════════════ */
class Stage {
  constructor(el, { orbit = true, ground = true } = {}) {
    this.el = el;
    this.canvas = el.querySelector('canvas') || el.appendChild(document.createElement('canvas'));
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.02, 120);
    this.camera.position.set(1.6, 1.2, 1.9);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 3.5, 2); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2.5, 1.4, -1.6); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe6cf, 0.55); rim.position.set(0, 1.9, -3.2); this.scene.add(rim);

    if (ground) {
      const g = new THREE.Mesh(
        new THREE.CircleGeometry(4.5, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 0.95, metalness: 0 }));
      g.position.y = -0.005; this.scene.add(g);
      const grid = new THREE.GridHelper(9, 36, 0x2a2622, 0x1d1a17);
      grid.material.transparent = true; grid.material.opacity = 0.5; this.scene.add(grid);
    }
    if (orbit) {
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
      this.controls.maxPolarAngle = Math.PI * 0.52;
    }
    const resize = () => {
      const w = el.clientWidth || 2, h = el.clientHeight || 2;
      r.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(el); resize();
  }
  render() { this.controls?.update(); this.renderer.render(this.scene, this.camera); }
}

/* ════ Rig — the MABEL model inside the Z-up→Y-up wrapper ════════════ */
let _gltfPromise = null;
function loadGltf() {
  _gltfPromise = _gltfPromise || new Promise((res, rej) =>
    new GLTFLoader().load('assets/mabel_rig.glb', res, undefined, rej));
  return _gltfPromise;
}

class Rig {
  /** stage: Stage · manifest: mabel_joints.json · scale: display scale */
  async load(stage, manifest, { scale = 1 } = {}) {
    const gltf = await loadGltf();
    this.root = gltf.scene.clone(true);          // per-stage instance

    this.world = new THREE.Group();
    this.world.scale.setScalar(scale);
    this.world.add(this.root);
    stage.scene.add(this.world);

    // THE frame seam: the exporter bakes the MuJoCo Z-up → glTF Y-up
    // conversion into the `base_link` node (rotation == Rx(−90°) == Q_ZUP).
    // Base pose (bx, by, yaw) is MuJoCo-frame, so it composes ON TOP of that
    // baked transform: p = p0 + q0·(bx,by,0), q = q0·Rz(yaw).
    this.base = this.root.getObjectByName('base_link') || this.root;
    this.baseP0 = this.base.position.clone();
    this.baseQ0 = this.base.quaternion.clone();

    this.joints = {};
    for (const j of manifest.joints) {
      const node = this.root.getObjectByName(j.node);
      if (!node) continue;
      this.joints[j.name] = {
        ...j, _n: node,
        _p0: node.position.clone(), _q0: node.quaternion.clone(),
        _ax: new THREE.Vector3(...j.axis).normalize(),
      };
    }
    this.ee = {
      l: this.root.getObjectByName('left_palm'),
      r: this.root.getObjectByName('right_palm'),
    };
    const bb = new THREE.Box3().setFromObject(this.world);
    this.maxd = Math.max(...bb.getSize(new THREE.Vector3()).toArray()) || 1;
    this.center0 = bb.getCenter(new THREE.Vector3());
    return this;
  }

  setJoint(name, val) {
    const j = this.joints[name]; if (!j) return;
    if (j.type === 'prismatic') {
      j._n.position.copy(j._p0).add(j._ax.clone().applyQuaternion(j._q0).multiplyScalar(val));
      j._n.quaternion.copy(j._q0);
    } else {
      j._n.quaternion.copy(j._q0).multiply(new THREE.Quaternion().setFromAxisAngle(j._ax, val));
      j._n.position.copy(j._p0);
    }
  }

  /** Pose from canonical state — base pose in PURE MuJoCo coordinates,
      composed through base_link's baked Z-up→Y-up transform.
      `pinned` renders in the robot's odom frame (iOS RealRobotView style):
      heading and joints still apply, but the world translation is dropped,
      so the model stays centered in view no matter where the base drives. */
  pose(state, { pinned = false } = {}) {
    for (const n in state.q) this.setJoint(n, state.q[n]);
    const off = pinned
      ? new THREE.Vector3()
      : new THREE.Vector3(state.bx, state.by, 0).applyQuaternion(this.baseQ0);
    this.base.position.copy(this.baseP0).add(off);
    this.base.quaternion.copy(this.baseQ0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), state.yaw));
    this.world.updateMatrixWorld(true);
  }

  /** Robot base in three world space (camera chase / nav marker). */
  rootThree() {
    return this.base.getWorldPosition(new THREE.Vector3());
  }

  marker(color, radius) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 22, 16),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.35, metalness: 0.05,
        emissive: color, emissiveIntensity: 0.25, transparent: true, opacity: 0.92,
      }));
    this.world.parent.add(m);
    return m;
  }
}

/* ════ Sim — canonical state + local kinematic mirror ════════════════ */
class Sim {
  constructor(manifest) {
    this.state = { q: {}, bx: 0, by: 0, yaw: 0 };
    this.jmap = {};
    for (const j of manifest.joints) {
      this.jmap[j.name] = j;
      this.state.q[j.name] = (j.lower != null && j.upper != null) ? clamp(0, j.lower, j.upper) : 0;
    }
    this.homeQ = { ...this.state.q };
    this.jointTarget = { ...this.state.q };
    this.manifest = manifest;
    this.lift = 0; this.wheelSpin = 0;
    this.grip = { left: 0, right: 0 };
    this.chains = {
      l: [1, 2, 3, 4, 5, 6, 7].map((i) => `left_arm_${i}`),
      r: [1, 2, 3, 4, 5, 6, 7].map((i) => `right_arm_${i}`),
    };
    this.remote = false;          // robot_state stream live → local stepping off
  }
  clampJ(name, v) {
    const j = this.jmap[name];
    return j && j.lower != null ? clamp(v, j.lower, j.upper) : v;
  }
  setQ(name, v) { if (name in this.state.q) this.state.q[name] = this.clampJ(name, v); }
  setLift(v) {
    this.lift = clamp(v, 0, LIFT_MAX);
    this.setQ('lift_lower', this.lift / 2); this.setQ('lift_upper', this.lift / 2);
    this.jointTarget.lift_lower = this.state.q.lift_lower; this.jointTarget.lift_upper = this.state.q.lift_upper;
  }
  applyGrips() {
    for (const side of ['left', 'right']) {
      for (const name in this.state.q) {
        if (!name.startsWith(side) || !/(mcp|pip|dip)$/.test(name)) continue;
        const j = this.jmap[name];
        if (j) this.state.q[name] = j.upper * this.grip[side];
      }
    }
  }

  /** Base kinematics in the MuJoCo frame: front = −X, left = −Y, Z-up. */
  stepBase(nav, dt) {
    this.state.yaw += nav.w * dt;
    const fx = -Math.cos(this.state.yaw), fy = -Math.sin(this.state.yaw);   // front
    const rx = -Math.sin(this.state.yaw), ry = Math.cos(this.state.yaw);    // right
    this.state.bx += (nav.f * fx + nav.s * rx) * dt;
    this.state.by += (nav.f * fy + nav.s * ry) * dt;
    const sp = Math.hypot(nav.f, nav.s);
    if (sp > 1e-3 || Math.abs(nav.w) > 1e-3) {
      this.wheelSpin += Math.max(sp, Math.abs(nav.w) * 0.3) * dt * 12;
      const steer = sp > 1e-3 ? Math.atan2(nav.s, -nav.f) : 0;
      for (const n of ['fl_steer', 'fr_steer', 'b_steer']) this.setQ(n, steer);
      for (const n of ['fl_drive', 'fr_drive', 'b_drive']) this.setQ(n, this.wheelSpin);
    }
    if (Math.abs(nav.liftRate) > 1e-3) this.setLift(this.lift + nav.liftRate * LIFT_RATE * dt);
  }

  /** Slew every joint toward its target (the local impedance stand-in). */
  slew(dt, skip) {
    for (const name in this.jointTarget) {
      if (skip && skip.includes(name)) continue;
      const cur = this.state.q[name]; if (cur == null) continue;
      const tgt = this.clampJ(name, this.jointTarget[name]);
      if (cur === tgt) continue;
      const rate = (/(mcp|pip|dip)$/.test(name) ? 5.0 : 2.4) * dt;
      const d = tgt - cur;
      this.setQ(name, Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate);
    }
  }

  /** Hinge-constrained CCD on a rig (goal in three world space). */
  ik(rig, side, goal, gain, passes) {
    const ee = rig.ee[side]; if (!ee) return;
    const piv = new THREE.Vector3(), eeW = new THREE.Vector3();
    const axW = new THREE.Vector3(), pq = new THREE.Quaternion();
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), cr = new THREE.Vector3();
    for (let p = 0; p < passes; p++) {
      for (let i = this.chains[side].length - 1; i >= 0; i--) {
        const name = this.chains[side][i];
        const j = rig.joints[name]; if (!j) continue;
        j._n.getWorldPosition(piv);
        ee.getWorldPosition(eeW);
        j._n.parent.getWorldQuaternion(pq);
        axW.copy(j._ax).applyQuaternion(j._q0).applyQuaternion(pq).normalize();
        v1.subVectors(eeW, piv); v1.addScaledVector(axW, -v1.dot(axW));
        v2.subVectors(goal, piv); v2.addScaledVector(axW, -v2.dot(axW));
        if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) continue;
        v1.normalize(); v2.normalize();
        const ang = Math.atan2(cr.crossVectors(v1, v2).dot(axW), v1.dot(v2)) * gain;
        this.setQ(name, this.state.q[name] + ang);
        rig.setJoint(name, this.state.q[name]);
        j._n.updateWorldMatrix(false, true);
      }
    }
  }

  resetHome() {
    for (const n in this.homeQ) this.state.q[n] = this.homeQ[n];
    this.jointTarget = { ...this.homeQ };
    this.state.bx = this.state.by = this.state.yaw = 0;
    this.lift = 0; this.wheelSpin = 0;
    this.grip = { left: 0, right: 0 };
  }
}

/* ════ virtual joystick ══════════════════════════════════════════════ */
class Joy {
  constructor(el, onMove) {
    this.el = el; this.knob = el.querySelector('.knob');
    this.x = 0; this.y = 0;
    let pid = null;
    const set = (ev) => {
      const r = el.getBoundingClientRect();
      const dx = (ev.clientX - r.left - r.width / 2) / (r.width / 2);
      const dy = (ev.clientY - r.top - r.height / 2) / (r.height / 2);
      const m = Math.hypot(dx, dy), s = m > 1 ? 1 / m : 1;
      this.x = dx * s; this.y = dy * s;
      this.knob.style.transform =
        `translate(calc(-50% + ${this.x * r.width * 0.28}px), calc(-50% + ${this.y * r.height * 0.28}px))`;
      onMove(this.x, this.y);
    };
    const end = () => {
      pid = null; this.x = this.y = 0;
      el.classList.remove('live');
      this.knob.style.transform = 'translate(-50%,-50%)';
      onMove(0, 0);
    };
    el.addEventListener('pointerdown', (ev) => {
      pid = ev.pointerId; el.setPointerCapture(pid); el.classList.add('live'); set(ev);
    });
    el.addEventListener('pointermove', (ev) => { if (pid === ev.pointerId) set(ev); });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}

/* ════ the App ═══════════════════════════════════════════════════════ */
class App {
  constructor(manifest) {
    this.manifest = manifest;
    this.sim = new Sim(manifest);
    this.link = new Link(this);
    this.shell = $('#taApp');
    this.estop = false;
    this.view = 'teleop';

    // operator command state
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
    this.cockpitMode = 'drive';                 // teleop view: drive | arms
    this.armJoy = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    this.armRaise = { left: 0, right: 0 };      // RAISE buttons: +1 up / -1 down (world)
    this.armTgt = {};                           // l/r palm targets (three world) for Cartesian arm drive
    this.feel = 'impedance';                    // body view: impedance | compliance
    this.stiffness = 0.7;
    this.wireJoints = {}; this.jointsDirty = false;
    this.drag = null;                           // body-view active drag side
    this._lastSpec = '';
    this.driving = true; this.clientCount = 1;  // arbitration state from robot_state
    this.path = 'local'; this._planT = null;    // multi-path connect: local | vpn | relay
    this._discSeq = 0;                          // Wi-Fi discovery supersede counter

    this._buildDock();
    this._txAcc = 0; this._last = performance.now();
  }

  async start() {
    await Promise.all([this._buildTeleop(), this._buildBody(), this._buildNav()]);
    this.switchView('teleop');
    this._autoConnect();
    const loop = (t) => {
      // Substep so motion stays wall-clock-correct even when rAF throttles
      // (background tab / headless); each substep ≤ 20 ms keeps the local mirror
      // and the 60 Hz uplink snappy (smaller cap = lower perceived control lag).
      let elapsed = Math.min(0.25, (t - this._last) / 1000); this._last = t;
      while (elapsed > 1e-4) {
        const dt = Math.min(0.02, elapsed); elapsed -= dt;
        this._tick(dt);
      }
      this._render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ── view switching (dock tabs) ─────────────────────────────────── */
  switchView(name) {
    this.view = name;
    $$('.ta-view', this.shell).forEach((el) => el.classList.toggle('on', el.dataset.view === name));
    $$('[data-tabs] button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
    this._announceSpec();
    this._syncCams();
  }

  /* ── the dock ───────────────────────────────────────────────────── */
  _buildDock() {
    $$('[data-tabs] button').forEach((b) =>
      b.addEventListener('click', () => this.switchView(b.dataset.go)));
    // Connect is now a host PICKER: click to choose / switch a target (the sim,
    // this computer, or a LAN robot you added) and connect to it.
    $('#taConnect').addEventListener('click', (e) => { e.stopPropagation(); this._toggleHostMenu(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#taHostPick')) this._closeHostMenu(); });
    // The visitor CTA (no-video panel) connects the default target.
    $('#taTryLive')?.addEventListener('click', () => {
      if (!this.link.want) this.connectAuto(); else { this._disconnect(); this._curTarget = null; }
      this._paintLink();
    });
    $('#taReset').addEventListener('click', () => this.resetAll());
    $('#taFs').addEventListener('click', () => {
      // Prefer the native Fullscreen API (desktop, iPad). iPhone Safari has NO
      // Fullscreen API at all, so fall back to a CSS "immersive" mode that fills
      // the viewport — the floating dock rides along either way.
      const sec = $('#taSection');
      const reqFs = sec && (sec.requestFullscreen || sec.webkitRequestFullscreen);
      const inFs = document.fullscreenElement || document.webkitFullscreenElement;
      if (inFs) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      } else if (reqFs && !document.documentElement.classList.contains('ta-immersive')) {
        reqFs.call(sec);
      } else {
        document.documentElement.classList.toggle('ta-immersive');
        // nudge the renderers to re-fit the new viewport size
        window.dispatchEvent(new Event('resize'));
      }
    });
    $('#taEstop').addEventListener('click', () => {
      this.estop = !this.estop;
      this.shell.classList.toggle('estopped', this.estop);
      $('#taEstop').classList.toggle('latched', this.estop);
      $('#taEstop').textContent = this.estop ? 'RELEASE' : 'E-STOP';
      if (this.estop) {
        this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
        this.drag = null;
        // one final all-zero frame so the bridge robot stops dead
        this.link.send('teleop_frame', {
          sequence: ++this.link.seq, timestamp: Date.now() / 1000,
          head: { transform: { matrix: IDENTITY16 }, trackingState: 'normal' },
          mode: 'Base Driving', navJoystick: { lx: 0, ly: 0, rx: 0, ry: 0 },
        });
        this.link.send('control_mode',
          { method: 'navigation', controlType: 'impedance', region: 'whole_body', stiffness: this.stiffness * MAX_STIFF });
      } else this._announceSpec(true);
    });
  }
  /* ── three-path connect: Wi-Fi → VPN → secure relay, cycling every 5 s ─
     Same story as the Vision Pro / iPhone apps (RobotController.connectAuto):
       · WI-FI  — the Mac's LAN IP, lowest latency on the same network.
       · VPN    — its Tailscale IP / ts.net name, reachable from any network
                  on the same tailnet (one-time install, no public exposure).
       · RELAY  — the secure internet relay (relay/README.md): a token-gated
                  wss endpoint on a public VPS that the robot dials OUT to,
                  so ANYONE can drive from ANYWHERE with just a host + token,
                  the control loop never facing the public internet.
     The console rotates through whichever paths are configured until one
     answers, so it links up wherever the Mac is reachable. */
  _hosts() {
    return {
      local: $('#taHostLocal').value.trim(),
      vpn: $('#taHostVpn').value.trim(),
      relay: $('#taHostRelay')?.value.trim() || '',
    };
  }
  _relayKey() { return $('#taRelayKey')?.value.trim() || ''; }
  /** Path → bridge URL.
      · WI-FI / VPN: a bare host/IP gets the standard :9090/teleop; from an
        https page the browser refuses plain ws://, so a bare host upgrades to
        the TLS proxy the Mac publishes with `tailscale serve --bg --https=8443
        localhost:9090` (enter the Mac's ts.net name — the cert is issued for
        it, not raw IPs). A full ws(s):// URL passes through unchanged.
      · RELAY: always wss to the public VPS on :443 (Caddy), with the access
        token in the `?key=` query that gates every request — `wss://<relay>/
        teleop?key=<APP_TOKEN>`. */
  _urlFor(path) {
    const host = (this._hosts()[path] || '').trim();
    if (!host) return null;
    // `client=web` names this device exactly (Website); `sid` is a per-tab id so
    // the command monitor can tell multiple browser openings apart. Appended
    // after any existing query (e.g. the relay's ?key=…), never overwriting it.
    const tag = (u) => u + (u.includes('?') ? '&' : '?') + `client=web&sid=${_SID}`;
    if (/^wss?:\/\//.test(host)) return tag(host);     // full URL passthrough
    if (path === 'relay') {
      const h = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const key = this._relayKey();
      // The sim demo uses /teleop; the real robot uses /real/teleop (set per
      // target). Caddy passes /real/* straight to the bridge, which enforces the
      // secret access code carried here in ?key=.
      const rp = (this._curTarget && this._curTarget.relayPath) || '/teleop';
      return tag(`wss://${h}${rp}${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    }
    // localhost / 127.0.0.1 are "potentially trustworthy" origins, so the
    // browser allows a PLAIN ws:// to them even from an https page (the GitHub
    // Pages copy). Everything else on https must go over the TLS proxy (wss).
    if (_isLocalHost(host)) return tag(`ws://${host}:9090/teleop`);
    return tag(location.protocol === 'https:'
      ? `wss://${host}:8443/teleop`
      : `ws://${host}:9090/teleop`);
  }
  /** Discovery can always probe localhost (ws:// to it is allowed even from
      https); on http it can also probe LAN / Tailscale hosts. So it's never
      fully off — only the candidate SET narrows on https (see _discoverLocal). */
  _canDiscover() { return true; }
  /** Configured paths, in failover order. On the bridge-served http console the
      LAN is the fast path, so Wi-Fi → VPN → relay. On the PUBLIC https site a
      visitor can't reach a LAN bridge (ws:// blocked) or a tailnet (VPN), so
      the relay is the only universal path — lead with it: relay → VPN → Wi-Fi.
      On http the Wi-Fi leg is always present even empty — discovery fills it. */
  _pathOrder() {
    const h = this._hosts();
    const publicHttps = location.protocol === 'https:' && !_isLocalHost(location.hostname);
    const order = publicHttps ? ['relay', 'vpn', 'local'] : ['local', 'vpn', 'relay'];
    return order.filter((p) =>
      p === 'local' ? (h.local || this._canDiscover()) : h[p]);
  }
  /* ── Host picker: a dropdown of named targets you connect to ──────────
     SECURITY MODEL. The "Local network" targets — Auto-discover, This
     computer, and any robot you add — are plain ws:// to a LAN / Tailscale
     address: reachable ONLY from the same network, and the browser blocks
     them outright from the public https page — so on the LAN the real robot is
     reachable but the internet can't touch it directly. Over the RELAY there are
     two public targets: the open "Sim demo" (public token), and "MABEL Real
     (thor)", which is gated by the robot's SECRET access code (the bridge
     enforces it for every remote client) AND the local arm gate — so a stranger
     with the relay URL still can't drive it. On the same Wi-Fi the bridge trusts
     you without a code; remote requires the code. */
  _userHosts() {
    try { return JSON.parse(localStorage.getItem('mabel-hosts') || '[]'); } catch (e) { return []; }
  }
  _saveUserHosts(list) { try { localStorage.setItem('mabel-hosts', JSON.stringify(list)); } catch (e) {} }
  _targets() {
    const lan = [
      { id: 'auto',  label: 'Auto-discover', sub: 'a robot on this network', kind: 'auto' },
      { id: 'local', label: 'This computer', sub: 'localhost', kind: 'lan', host: 'localhost' },
      ...this._userHosts().map((h) => ({ id: h.id, label: h.label, sub: h.host, kind: 'lan', host: h.host, user: true })),
    ];
    const pub = [];
    if (DEFAULT_RELAY) {
      pub.push({ id: 'demo', label: 'Sim demo', sub: 'public cloud · sim only', kind: 'relay', host: DEFAULT_RELAY, key: DEFAULT_RELAY_KEY, relayPath: '/teleop' });
      // The REAL robot over the relay: gated by the SECRET access code (NOT the
      // public demo token), which the bridge requires for every remote client.
      // The code is never baked in — the operator types it once (stored locally).
      // On the LAN the bridge trusts you without a code, so use a LAN host there.
      let rc = ''; try { rc = localStorage.getItem('mabel-real-code') || ''; } catch (e) {}
      pub.push({ id: 'real', label: 'MABEL Real (thor)', sub: 'secure relay · access code', kind: 'relay', host: DEFAULT_RELAY, key: rc, relayPath: '/real/teleop', real: true });
    }
    return { lan, pub };
  }
  _findTarget(id) { const { lan, pub } = this._targets(); return [...lan, ...pub].find((t) => t.id === id); }
  /** Default target: the last one used, else the relay sim on the public site
      or auto-discovery on a LAN / the bridge-served console. */
  connectAuto() {
    let id = null; try { id = localStorage.getItem('mabel-target'); } catch (e) {}
    let t = (id && this._findTarget(id)) || null;
    if (!t) {
      const pub = location.protocol === 'https:' && !_isLocalHost(location.hostname);
      t = this._findTarget(pub ? 'demo' : 'auto') || this._findTarget('auto');
    }
    this._selectTarget(t);
  }
  /** Connect to ONE chosen target (no path-cycling — the operator picks). */
  _selectTarget(t) {
    if (!t) return;
    this._curTarget = t;
    try { localStorage.setItem('mabel-target', t.id); } catch (e) {}
    clearInterval(this._planT); this._planT = null;
    this._lanConsoleUrl = null;
    this.link.want = true;
    if (t.kind === 'auto') {
      this.path = 'local';
      this.link.connect(this._urlFor('local') || 'ws://localhost:9090/teleop');
      this._discoverLocal();                                  // race the LAN for a bridge
      this._planT = setInterval(() => { if (!this.link.connected && this.link.want) this._discoverLocal(); }, 5000);
    } else if (t.kind === 'relay') {
      if ($('#taHostRelay')) $('#taHostRelay').value = t.host;
      if ($('#taRelayKey')) $('#taRelayKey').value = t.key || '';
      this.path = 'relay';
      // Real robot over the relay carries the SECRET access code (not the public
      // token); persist whatever the operator typed so they enter it once.
      if (t.real) { try { localStorage.setItem('mabel-real-code', this._relayKey()); } catch (e) {} }
      this.link.connect(this._urlFor('relay'));
    } else {                                                  // a specific LAN / robot host
      // A page served over HTTPS (the public github.io copy) cannot open ws://
      // to a LAN/Tailscale robot — browsers block it (mixed content + Private
      // Network Access). The robot's OWN bridge serves this same console over
      // http on :8080, where the LAN link works. Don't navigate there
      // automatically (it may be unreachable and would strand the page) — show
      // it as a link the operator opens in a new tab. localhost is exempt from
      // the block and still connects in place.
      if (location.protocol === 'https:' && !_isLocalHost(t.host)) {
        this._curTarget = t; this.link.want = false; this.sim.remote = false;
        this._lanConsoleUrl = `http://${t.host}:8080/console`;
        this._showLanConsoleHint(t.host);
        this._closeHostMenu(); this._paintLink();
        return;
      }
      this._lanConsoleUrl = null;
      $('#taHostLocal').value = t.host; this._lastGoodLocal = t.host;
      this.path = 'local';
      this.link.connect(this._urlFor('local'));
    }
    this._closeHostMenu();
    this._paintLink();
  }
  /** Real robot picked from the https page: ws:// to a LAN host is blocked here,
      so surface the robot's own http console as a clickable link (new tab) plus
      the network caveat. Non-destructive — never navigates this tab. */
  _showLanConsoleHint(host) {
    this.switchView('teleop');
    const url = `http://${host}:8080/console`;
    const msg = $('#taNoVidMsg');
    if (msg) {
      msg.innerHTML = `<b style="color:#e9a679;">Real robots open over http, on their own network</b>`
        + `This secure page can’t reach a robot at <code>${host}</code> — browsers block a LAN socket from https. `
        + `Open the robot’s own console instead (new tab): `
        + `<a href="${url}" target="_blank" rel="noopener" style="color:#e9a679;text-decoration:underline;">${url} ↗</a><br>`
        + `<span style="color:#6d6660;">You must be on the robot’s network for that to load — same Wi-Fi as the robot, or its Tailscale IP — and its bridge must be running.</span>`;
    }
  }
  _toggleHostMenu() {
    const m = $('#taHostMenu'); if (!m) return;
    if (m.hasAttribute('hidden')) { this._buildHostMenu(); m.removeAttribute('hidden'); $('#taConnect')?.setAttribute('aria-expanded', 'true'); }
    else this._closeHostMenu();
  }
  _closeHostMenu() { const m = $('#taHostMenu'); if (m) { m.setAttribute('hidden', ''); $('#taConnect')?.setAttribute('aria-expanded', 'false'); } }
  _buildHostMenu() {
    const menu = $('#taHostMenu'); if (!menu) return;
    const { lan, pub } = this._targets();
    const cur = this._curTarget?.id;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const row = (t) => `<button class="hm-row${t.id === cur ? ' on' : ''}" data-tid="${esc(t.id)}" type="button">
        <span class="hm-dot"></span>
        <span class="hm-main"><span class="hm-label">${esc(t.label)}</span><span class="hm-sub">${esc(t.sub)}</span></span>
        ${t.user ? `<span class="hm-del" data-del="${esc(t.id)}" title="Remove" role="button">×</span>` : ''}</button>`;
    menu.innerHTML =
      `<div class="hm-head">Local network<span>secure · LAN only</span></div>` +
      lan.map(row).join('') +
      `<form class="hm-add" data-addform autocomplete="off"><input class="hm-name" placeholder="Name" aria-label="Robot name" /><input class="hm-ip" placeholder="192.168.1.x" aria-label="Robot LAN IP" /><button type="submit" class="hm-addbtn" title="Add robot">＋</button></form>` +
      (pub.length ? `<div class="hm-head">Public<span>simulation only</span></div>` + pub.map(row).join('') : '') +
      (this.link.want ? `<button class="hm-row hm-disc" data-disc type="button"><span class="hm-dot"></span><span class="hm-main"><span class="hm-label">Disconnect</span></span></button>` : '');
    $$('.hm-row[data-tid]', menu).forEach((b) => b.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      this._selectTarget(this._findTarget(b.dataset.tid));
    }));
    $$('[data-del]', menu).forEach((d) => d.addEventListener('click', (e) => {
      e.stopPropagation();
      this._saveUserHosts(this._userHosts().filter((h) => h.id !== d.dataset.del));
      this._buildHostMenu();
    }));
    $('[data-disc]', menu)?.addEventListener('click', () => { this._disconnect(); this._curTarget = null; this._buildHostMenu(); this._paintLink(); });
    $('[data-addform]', menu)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const ip = $('.hm-ip', menu).value.trim(); if (!ip) return;
      const name = $('.hm-name', menu).value.trim();
      const id = 'h' + Date.now().toString(36);
      const list = this._userHosts(); list.push({ id, label: name || ip, host: ip });
      this._saveUserHosts(list);
      this._selectTarget(this._findTarget(id));               // connect to the new robot now
    });
  }
  /** Open a throwaway WebSocket to a candidate; resolve true iff the bridge
      accepts the upgrade on /teleop (the analog of Bonjour's "open a TCP
      connection — the one that answers is the server"). */
  _probe(url, timeoutMs = 3500) {
    return new Promise((resolve) => {
      let ws, done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        try { if (ws) { ws.onopen = ws.onerror = ws.onclose = null; ws.close(); } } catch (e) {}
        resolve(ok);
      };
      try { ws = new WebSocket(url); } catch (e) { return resolve(false); }
      ws.onopen = () => finish(true);
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false);
      setTimeout(() => finish(false), timeoutMs);
    });
  }
  /** Race a candidate set; resolve the FIRST host that answers (not the first
      to settle), else null after the timeout. */
  _raceProbe(cands, timeoutMs = 4500) {
    return new Promise((resolve) => {
      let pending = cands.length, done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      if (!pending) return finish(null);
      const t = setTimeout(() => finish(null), timeoutMs);
      cands.forEach((c) => this._probe(c.url).then((ok) => {
        if (ok) { clearTimeout(t); finish(c); }
        else if (--pending === 0) { clearTimeout(t); finish(null); }
      }));
    });
  }
  async _discoverLocal() {
    const seq = ++this._discSeq;
    const https = location.protocol === 'https:';
    const seen = new Set(), cands = [];
    const add = (host) => {
      host = (host || '').trim().replace(/^wss?:\/\//, '').replace(/[:/].*$/, '');
      if (!host || seen.has(host)) return;
      // From an https page only localhost is reachable over ws:// — the browser
      // blocks ws:// to LAN / Tailscale IPs (mixed content). Probing them would
      // just fail, so skip them and keep the localhost path (which DOES work,
      // e.g. the bridge running on the same Mac as the browser).
      if (https && !_isLocalHost(host)) return;
      seen.add(host); cands.push({ host, url: `ws://${host}:9090/teleop` });
    };
    add(this._lastGoodLocal);                                   // remembered winner first
    add($('#taHostLocal').value);                               // typed hint, if any
    if (location.hostname && location.hostname !== 'localhost') add(location.hostname);  // served from the bridge
    add('localhost'); add('127.0.0.1');
    KNOWN_HOSTS.forEach(add);                                   // the operator's known networks
    if (!cands.length) return;
    const win = await this._raceProbe(cands);
    if (!win || seq !== this._discSeq || !this.link.want) return;   // superseded / disconnected
    this._lastGoodLocal = win.host;
    try { localStorage.setItem('mabel-host-local', win.host); } catch (e) {}
    if ($('#taHostLocal')) $('#taHostLocal').value = win.host;
    // Promote the winning path (it wins on latency) unless we're already live on it.
    const want = `ws://${win.host}:9090/teleop`;
    if (this.path !== 'local' || this.link.url !== want || !this.link.connected) {
      this.path = 'local';
      this.link.connect(want);
      this._paintLink();
    }
  }
  _failover() {
    if (this.link.connected || !this.link.want) return;
    // Re-probe the LAN every cycle so a mid-session Wi-Fi change (or a stale
    // stored host from another network) auto-heals — the browser analog of the
    // Vision Pro app re-running Bonjour on a network change.
    if (this._canDiscover()) this._discoverLocal();
    const order = this._pathOrder();
    if (order.length < 2) return;                      // nothing else to try
    const i = order.indexOf(this.path);
    this.path = order[(i + 1) % order.length];         // advance the rotation
    this.link.connect(this._urlFor(this.path));
    this._paintLink();
  }
  _disconnect() {
    clearInterval(this._planT); this._planT = null;
    this.link.disconnect();
  }
  _paintLink() {
    const pill = $('#taPill'), btn = $('#taConnect');
    const label = pill.querySelector('span:last-child');   // NOT the status dot
    const pathName = { local: 'LAN', vpn: 'VPN', relay: 'CLOUD' }[this.path] || 'LAN';
    pill.classList.remove('link', 'wait');
    $$('.ta-host').forEach((el) => el.classList.remove('live', 'trying'));
    const fieldId = { local: '#taHostLocal', vpn: '#taHostVpn', relay: '#taHostRelay' }[this.path];
    const field = $(fieldId)?.closest('.ta-host');
    const issue = this._httpsIssue();
    if (issue) {
      pill.classList.add('wait');
      label.textContent = issue.label;
      pill.title = issue.title;
    } else if (this.link.connected) {
      pill.classList.add('link');
      field?.classList.add('live');
      label.textContent = this.driving === false
        ? `${pathName} · OBSERVING${this.clientCount > 1 ? ` (${this.clientCount})` : ''}`
        : `${pathName} · DRIVING`;
      pill.title = this.driving === false
        ? 'Another client (iOS / Vision Pro) is driving — move a stick or drag the model to take over.'
        : 'You are the active driver.';
    } else if (this.link.want) {
      pill.classList.add('wait'); field?.classList.add('trying');
      label.textContent = `TRYING ${pathName}`;
      pill.title = this._pathOrder().length > 1
        ? 'Cycling the configured paths every 5 s — Wi-Fi, then VPN, then the secure relay — until one answers.'
        : 'Trying to reach the bridge; it keeps retrying until you press Disconnect.';
    } else if (this._lanConsoleUrl) {
      pill.classList.add('wait');
      label.textContent = 'OPEN OVER HTTP';
      pill.title = `Real robots can't be reached from this https page — open ${this._lanConsoleUrl} on the robot's network.`;
    } else { label.textContent = 'OFFLINE'; pill.title = ''; }
    // The host-picker button shows the chosen target + a status tint.
    const hpLbl = $('#taConnect .hp-lbl');
    if (hpLbl) hpLbl.textContent = this._curTarget?.label || 'Connect';
    if (btn) {
      btn.classList.toggle('live', this.link.connected);
      btn.classList.toggle('wait', this.link.want && !this.link.connected);
    }
    const tl = $('#taTryLive');
    if (tl) tl.textContent = this.link.connected ? 'Connected'
      : this.link.want ? 'Connecting…' : '▶  Try it live';
  }
  /** What's wrong with the chosen path, and how to fix it — null when fine.
      Covers the relay's missing-token case, plus the two https-page hazards:
      ws:// is mixed content, and wss:// to a raw IP fails TLS (the Tailscale
      cert names the ts.net host, not an IP). */
  _httpsIssue() {
    // The relay gates every request with a key (?key=). For the REAL robot that
    // is the SECRET access code (the bridge enforces it for remote clients); for
    // the sim demo it's the public APP_TOKEN. On the LAN no code is needed.
    if (this.path === 'relay' && this._hosts().relay && !this._relayKey()) {
      const real = this._curTarget && this._curTarget.real;
      return real ? {
        label: 'REAL ROBOT NEEDS THE ACCESS CODE',
        title: 'Driving the real robot over the internet requires its secret access code. '
          + 'Type it in the key field. (On the same Wi-Fi as the robot you don’t need it — '
          + 'add the robot’s LAN IP as a Wi-Fi host instead.)',
      } : {
        label: 'RELAY NEEDS A KEY',
        title: 'The secure internet relay gates every request with an access token (?key=). '
          + 'Paste the APP_TOKEN your relay setup printed — see relay/README.md.',
      };
    }
    if (location.protocol !== 'https:') return null;
    const url = this.link.url || this._urlFor(this.path) || '';
    if (url.startsWith('ws://') && !/^(ws:\/\/)(localhost|127\.0\.0\.1)/.test(url)) {
      return {
        label: 'HTTPS BLOCKS ws://',
        title: 'A page served over https cannot open an insecure WebSocket. Enter a bare host '
          + '(auto-upgrades to wss) or open the console from your bridge: http://<bridge-host>:8080/console',
      };
    }
    // The relay's wss host is a real DNS name with a Let's Encrypt cert, so a
    // leading digit there is fine — only flag raw-IP wss on the LAN/VPN paths.
    if (this.path !== 'relay' && /^wss:\/\/(\d|\[|localhost)/.test(url)) {
      return {
        label: 'WSS NEEDS ts.net NAME',
        title: 'TLS certificates are issued for the Mac\'s Tailscale DNS name, not raw IPs. '
          + 'Enter the name `tailscale status` shows (e.g. my-mac.tailxxxx.ts.net) and publish the '
          + 'proxy on the Mac once: tailscale serve --bg --https=8443 localhost:9090',
      };
    }
    return null;
  }
  _autoConnect() {
    let local = null, vpn = null, relay = null, key = null, legacy = null;
    try {
      local = localStorage.getItem('mabel-host-local');
      vpn = localStorage.getItem('mabel-host-vpn');
      relay = localStorage.getItem('mabel-host-relay');
      key = localStorage.getItem('mabel-relay-key');
      legacy = localStorage.getItem('mabel-ws-url');   // pre-multi-path versions
    } catch (e) {}
    if (local == null && legacy) {
      try { local = new URL(legacy.replace(/^ws/, 'http')).hostname; } catch (e) {}
    }
    // Remember the last Wi-Fi host that answered, so discovery probes it first
    // (instant reconnect on the same network). The field is left to whatever's
    // stored — empty is fine; discovery auto-fills it the moment a bridge
    // answers, so the operator never has to type a LAN IP.
    this._lastGoodLocal = local || '';
    $('#taHostLocal').value = local || '';
    $('#taHostVpn').value = vpn || DEFAULT_VPN;   // documented remote path, pre-filled
    // Relay host + token come pre-baked on the public build (DEFAULT_RELAY*),
    // so a visitor lands on a one-click "try it live" path with nothing to type.
    if ($('#taHostRelay')) $('#taHostRelay').value = relay || DEFAULT_RELAY;
    if ($('#taRelayKey')) $('#taRelayKey').value = key || DEFAULT_RELAY_KEY;
    this.connectAuto();
    // On the public https site the browser BLOCKS ws:// to any local robot
    // (Private Network Access), so a same-machine bridge is unreachable from
    // here — steer the operator to the bridge-served http console, which works.
    if (location.protocol === 'https:') this._warnHttps();
  }
  _warnHttps() {
    setTimeout(() => {
      if (this.link.connected) return;              // a wss path (relay/VPN) got through — fine
      if (this._lanConsoleUrl) return;              // a LAN-robot hint is showing — leave it
      const msg = $('#taNoVidMsg');
      if (!msg) return;
      // The button + heading stay; only the explainer changes. A visitor on
      // the public site is ALREADY driving the in-browser twin — lead with that.
      msg.innerHTML = this._hosts().relay
        ? 'The hosted sim looks offline right now — but you’re already driving the '
          + 'in-browser model below. It’ll pick up the live sim automatically when it’s back.'
        : 'You’re driving the in-browser model. A secure web page can’t reach a robot on your '
          + 'own network, so to drive a <b>real</b> bridge open the console it serves — '
          + '<b>http://&lt;your-mac&gt;:8080/console</b> — or fill the <b>VPN</b> / <b>RELAY</b> field in the dock.';
    }, 6000);
  }
  onLink(up) {
    if (!up) { this.driving = true; this.clientCount = 1; }
    // Remember a Wi-Fi host that just went live (auto-heal on return).
    if (up && this.path === 'local') {
      try {
        const host = new URL(this.link.url.replace(/^ws/, 'http')).hostname;
        if (host) { this._lastGoodLocal = host; localStorage.setItem('mabel-host-local', host); }
        if ($('#taHostLocal') && !$('#taHostLocal').value.trim()) $('#taHostLocal').value = host;
      } catch (e) {}
    }
    this._paintLink(); this._syncCams();
    if (!up) {
      this.sim.remote = false;
      UI.set('lat', '—'); UI.set('batt', '—'); UI.set('rtt', '—');
      for (const k in this.sim.state.q) this.sim.jointTarget[k] = this.sim.state.q[k];
    }
  }
  onHello(p) { if (p && p.name) UI.set('rtt', '0 ms'); }

  /* ── TELEOP view (video + joysticks + mini model) ───────────────── */
  async _buildTeleop() {
    const v = $('[data-view="teleop"]', this.shell);
    this.miniStage = new Stage($('.ta-mini .ta-stage', v), { orbit: false, ground: true });
    this.miniRig = await new Rig().load(this.miniStage, this.manifest);
    $('.ta-mini .ta-stage', v).classList.add('loaded');

    // segments
    $$('[data-ck] button', v).forEach((b) => b.addEventListener('click', () => {
      $$('[data-ck] button', v).forEach((x) => x.classList.toggle('on', x === b));
      this.cockpitMode = b.dataset.mode;
      this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
      $$('[data-show]', v).forEach((el) => { el.style.display = el.dataset.show === this.cockpitMode ? '' : 'none'; });
      if (this.cockpitMode === 'arms') {
        for (const c of [...this.sim.chains.l, ...this.sim.chains.r]) this.sim.jointTarget[c] = this.sim.state.q[c];
        this.armTgt = {};                       // re-sync palm targets to the live pose
      }
      this._announceSpec();
    }));

    // drive joysticks — stick up = robot forward, right stick x = turn right
    new Joy($('[data-joy="navL"]', v), (x, y) => { this.nav.s = x * MAX_LIN; this.nav.f = -y * MAX_LIN; });
    new Joy($('[data-joy="navR"]', v), (x, y) => { this.nav.w = -x * MAX_ANG; this.nav.liftRate = -y; });
    // arm joysticks (CockpitView signs: x → arm_3 swing, y → arm_2 raise)
    new Joy($('[data-joy="armL"]', v), (x, y) => { this.armJoy.left = { x, y }; });
    new Joy($('[data-joy="armR"]', v), (x, y) => { this.armJoy.right = { x, y }; });

    // RAISE up/down — hold to move the palm target straight up/down (world Z);
    // the Cartesian arm driver (_armCartesian) integrates it, IK does the rest.
    $$('.ta-nudge button', v).forEach((b) => {
      const side = b.dataset.side, dir = +b.dataset.dir;
      const press = () => { this.armRaise[side] = dir; b.classList.add('on'); };
      const release = () => { this.armRaise[side] = 0; b.classList.remove('on'); };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('pointerleave', release);
    });
    $$('.ta-grip', v).forEach((g) => {
      const side = g.dataset.side, track = $('.track', g), fill = $('.fill', g), out = $('.val', g);
      const set = (ev) => {
        const r = track.getBoundingClientRect();
        const val = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
        this.sim.grip[side] = val;
        fill.style.height = `${val * 100}%`; out.textContent = `${Math.round(val * 100)}%`;
        this.setWire(`${side}_grip`, +val.toFixed(3));
      };
      let pid = null;
      track.addEventListener('pointerdown', (ev) => { pid = ev.pointerId; track.setPointerCapture(pid); set(ev); });
      track.addEventListener('pointermove', (ev) => { if (pid === ev.pointerId) set(ev); });
      const end = () => { pid = null; };
      track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
    });
  }

  _syncCams() {
    // MJPEG streams come from the bridge host, port 8080 — attach only while
    // connected (and only in the teleop view) so we never leak bandwidth.
    // Over a wss path the cameras ride https on :443 instead: the Tailscale
    // proxy (tailscale serve --bg --https=443 localhost:8080) or, on the
    // secure relay, the same token-gated Caddy edge — so the `?key=` from the
    // teleop URL is carried straight onto each /camera request.
    const on = this.link.connected && this.view === 'teleop';
    let host = 'localhost', key = '';
    try {
      const u = new URL(this.link.url.replace(/^ws/, 'http'));
      host = u.hostname || 'localhost';
      key = u.searchParams.get('key') || '';
    } catch (e) {}
    const remote = this.link.url.startsWith('wss');
    const base = remote
      ? `https://${host}/camera`
      : `http://${host}:8080/camera`;
    const set = (sel, path) => {
      const img = $(sel); if (!img) return;
      const params = [];
      if (key) params.push(`key=${encodeURIComponent(key)}`);
      // Relay path (wss → Caddy/MJPEG over TCP across the internet): ask the
      // server to shrink the frame per-client so the big head feed doesn't stall
      // and queue. Head downscales + drops quality; wrists just drop quality.
      // LAN (ws) leaves the stream full-res.
      if (remote) params.push(path === 'main' ? 'q=50&scale=0.5' : 'q=50');
      const qs = params.length ? `?${params.join('&')}` : '';
      const want = on ? `${base}/${path}/stream.mjpg${qs}` : '';
      if (img.dataset.src !== want) {
        img.dataset.src = want;
        if (want) { img.src = want; img.style.display = ''; }
        else { img.removeAttribute('src'); img.style.display = 'none'; }
      }
    };
    set('#taCamMain', 'main'); set('#taCamL', 'wrist_left'); set('#taCamR', 'wrist_right');
    $('#taNoVid').style.display = on ? 'none' : '';
  }

  /* ── BODY view (Hold = impedance · Soft = compliance) ───────────── */
  async _buildBody() {
    const v = $('[data-view="body"]', this.shell);
    this.bodyStage = new Stage($('.ta-stage', v), { orbit: true, ground: true });
    this.bodyRig = await new Rig().load(this.bodyStage, this.manifest);
    $('.ta-stage', v).classList.add('loaded');
    const c = this.bodyRig.center0;
    this.bodyStage.controls.target.copy(c);
    this.bodyStage.camera.position.set(c.x + this.bodyRig.maxd * 0.95, c.y + this.bodyRig.maxd * 0.55, c.z + this.bodyRig.maxd * 1.25);

    // palm handles
    this.balls = {};
    this.targets = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    for (const s of ['l', 'r']) {
      this.balls[s] = this.bodyRig.marker(GREEN, this.bodyRig.maxd * 0.024);
      this.balls[s].userData.side = s;
      this.bodyRig.ee[s]?.getWorldPosition(this.targets[s]);
    }

    // feel segmented control
    $$('[data-feel] button', v).forEach((b) => b.addEventListener('click', () => {
      $$('[data-feel] button', v).forEach((x) => x.classList.toggle('on', x === b));
      this.feel = b.dataset.val;
      $('.ta-side', v).style.display = this.feel === 'impedance' ? '' : 'none';
      $('#taHintHold').style.display = this.feel === 'impedance' ? '' : 'none';
      $('#taHintSoft').style.display = this.feel === 'compliance' ? '' : 'none';
      this._announceSpec();
    }));

    // stiffness
    const sl = $('[data-stiff]', v), out = $('[data-stiff-out]', v);
    sl.addEventListener('input', () => {
      this.stiffness = +sl.value;
      out.textContent = `${(this.stiffness * MAX_STIFF).toFixed(0)} Nm/rad`;
      this._announceSpec(true);
    });

    // joints drawer
    const groups = ['body', 'arms', 'hands'];
    const tabs = $('[data-jtabs]', v), list = $('[data-jlist]', v);
    const renderGroup = (g) => {
      $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.g === g));
      list.innerHTML = '';
      const joints = this.manifest.joints.filter((j) => j.group === g && j.lower != null);
      for (const j of joints) {
        const row = document.createElement('div');
        row.className = 'ta-jrow';
        row.innerHTML = `<div class="row"><span class="k">${j.name}</span><span class="v" data-out>0.00</span></div>
          <input type="range" min="${j.lower}" max="${j.upper}" step="0.005" value="${this.sim.state.q[j.name] || 0}">`;
        const inp = $('input', row), o = $('[data-out]', row);
        o.textContent = (+inp.value).toFixed(2);
        inp.addEventListener('input', () => {
          const val = +inp.value;
          o.textContent = val.toFixed(2);
          this.sim.jointTarget[j.name] = val;
          this.setWire(j.name, val);
        });
        list.appendChild(row);
      }
    };
    for (const g of groups) {
      const b = document.createElement('button');
      b.dataset.g = g; b.textContent = g[0].toUpperCase() + g.slice(1);
      b.addEventListener('click', () => renderGroup(g));
      tabs.appendChild(b);
    }
    renderGroup('arms');

    // Joint sliders collapse behind a header, closed by default on EVERY viewport
    // so the Body view is just the robot model + Hold/Soft + a tiny corner card.
    const jpanel = $('.ta-joints', v), jhd = $('[data-jcollapse]', v);
    if (jhd && jpanel) {
      jpanel.classList.add('collapsed');
      jhd.addEventListener('click', () => jpanel.classList.toggle('collapsed'));
    }

    // drag the palm handles
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    const planeN = new THREE.Vector3(); const plane = new THREE.Plane();
    const canvas = this.bodyStage.canvas;
    const pick = (ev) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.bodyStage.camera);
      return ray;
    };
    canvas.addEventListener('pointerdown', (ev) => {
      if (this.estop) return;
      const hits = pick(ev).intersectObjects([this.balls.l, this.balls.r]);
      if (!hits.length) return;
      this.drag = hits[0].object.userData.side;
      this.bodyStage.controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
      // drag plane ⟂ camera through the ball
      this.bodyStage.camera.getWorldDirection(planeN);
      plane.setFromNormalAndCoplanarPoint(planeN, this.balls[this.drag].position);
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const p = new THREE.Vector3();
      if (pick(ev).ray.intersectPlane(plane, p)) this.targets[this.drag].copy(p);
    });
    const drop = () => {
      if (!this.drag) return;
      if (this.feel === 'compliance') {
        this.link.send('external_force', { forces: {} });   // clear the push
        this.bodyRig.ee[this.drag]?.getWorldPosition(this.targets[this.drag]);
      }
      this.drag = null;
      this.bodyStage.controls.enabled = true;
    };
    canvas.addEventListener('pointerup', drop);
    canvas.addEventListener('pointercancel', drop);
  }

  /* ── NAVIGATE view (point-cloud room + goals + follow) ──────────── */
  async _buildNav() {
    const v = $('[data-view="nav"]', this.shell);
    this.navStage = new Stage($('.ta-stage', v), { orbit: true, ground: false });
    this.navStage.camera.position.set(5.5, 6.5, 6.5);
    this.navStage.camera.far = 300;
    this.navStage.camera.updateProjectionMatrix();
    this.navRig = await new Rig().load(this.navStage, this.manifest);
    $('.ta-stage', v).classList.add('loaded');

    // same library the iOS app ships (SLAMRoom.swift)
    this.rooms = [
      { name: 'Studio Floor A', sub: '48 m² · 2h ago', size: [8, 3.2, 6], seed: 7, kind: 'studio' },
      { name: 'Set — Living Room', sub: '26 m² · yesterday', size: [6, 2.8, 4.4], seed: 21, kind: 'livingRoom' },
      { name: 'Prop Workshop', sub: '34 m² · 3d ago', size: [7, 3.0, 5], seed: 42, kind: 'workshop' },
      { name: 'Stage Corridor', sub: '18 m² · last week', size: [9, 2.6, 2], seed: 99, kind: 'corridor' },
    ];
    const picker = $('.ta-rooms', v);
    this.rooms.forEach((room, i) => {
      const b = document.createElement('button');
      b.className = 'ta-room' + (i === 0 ? ' on' : '');
      b.innerHTML = `${room.name}<span class="sub">${room.sub}</span>`;
      b.addEventListener('click', () => {
        $$('.ta-room', picker).forEach((x) => x.classList.toggle('on', x === b));
        this._loadRoom(room);
      });
      picker.appendChild(b);
    });

    // goal + path visuals (all in the MuJoCo-frame group)
    this.navWorld = new THREE.Group(); this.navWorld.quaternion.copy(Q_ZUP);
    this.navStage.scene.add(this.navWorld);
    this.goalRing = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.23, 40),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    this.goalRing.position.z = 0.012; this.goalRing.visible = false;
    this.navWorld.add(this.goalRing);
    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85 }));
    this.navWorld.add(this.pathLine);
    this.goal = null; this.path = []; this.following = false;

    // tap to place a goal (raycast onto the MuJoCo z=0 floor plane)
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let downAt = null;
    const canvas = this.navStage.canvas;
    canvas.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
    canvas.addEventListener('pointerup', (ev) => {
      if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 6) return;  // it was an orbit
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.navStage.camera);
      // floor plane: three-world plane with normal = up
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return;
      const mj = toMj(p);                                    // → MuJoCo frame
      if (Math.abs(mj.x) > this.room.size[0] / 2 || Math.abs(mj.y) > this.room.size[2] / 2) return;
      this.setGoal(mj.x, mj.y);
    });

    $('#taFollow').addEventListener('click', () => {
      if (!this.goal) return;
      this.following = !this.following;
      $('#taFollow').textContent = this.following ? 'Stop' : 'Follow path';
      $('#taFollow').classList.toggle('primary', !this.following);
      if (!this.following) this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
    });
    $('#taClearGoal').addEventListener('click', () => this.clearGoal());

    this._loadRoom(this.rooms[0]);
  }

  /* procedural SLAM-style cloud — same synthesized stand-ins as the iOS
     SLAMRoom library, plus an occupancy grid for the A* planner. */
  _loadRoom(room) {
    this.room = room;
    this.clearGoal();
    if (this.cloud) { this.navWorld.remove(this.cloud); this.cloud.geometry.dispose(); }
    const rnd = mulberry32(room.seed);
    const [W, H, D] = room.size;            // extent x · height · extent y (MuJoCo)
    const pts = [], cols = [];
    const col = new THREE.Color();
    const push = (x, y, z, c, jitter = 0.012) => {
      pts.push(x + (rnd() - 0.5) * jitter, y + (rnd() - 0.5) * jitter, z + (rnd() - 0.5) * jitter);
      col.set(c).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
      cols.push(col.r, col.g, col.b);
    };
    // floor
    const fN = Math.floor(W * D * 1600);
    for (let i = 0; i < fN; i++) push((rnd() - 0.5) * W, (rnd() - 0.5) * D, 0.004, 0x35302b, 0.006);
    // walls (sparser, with a door gap on +x)
    const wN = Math.floor((W + D) * 2 * H * 320);
    for (let i = 0; i < wN; i++) {
      const side = Math.floor(rnd() * 4);
      const z = rnd() * H;
      if (side === 0) { const y = (rnd() - 0.5) * D; if (Math.abs(y) < 0.55 && z < 2.1) continue; push(W / 2, y, z, 0x2b2724); }
      else if (side === 1) push(-W / 2, (rnd() - 0.5) * D, z, 0x2b2724);
      else if (side === 2) push((rnd() - 0.5) * W, D / 2, z, 0x282522);
      else push((rnd() - 0.5) * W, -D / 2, z, 0x282522);
    }
    // furniture archetypes per kind → boxes (also the planner's obstacles)
    const boxes = [];
    const addBox = (cx, cy, w, d, h, c) => {
      boxes.push({ cx, cy, w, d });
      const n = Math.floor(w * d * h * 2600);
      for (let i = 0; i < n; i++) {
        const f = Math.floor(rnd() * 5);   // 4 sides + top
        if (f === 0) push(cx + (rnd() - 0.5) * w, cy + (rnd() - 0.5) * d, h, c);
        else if (f === 1) push(cx + w / 2, cy + (rnd() - 0.5) * d, rnd() * h, c);
        else if (f === 2) push(cx - w / 2, cy + (rnd() - 0.5) * d, rnd() * h, c);
        else if (f === 3) push(cx + (rnd() - 0.5) * w, cy + d / 2, rnd() * h, c);
        else push(cx + (rnd() - 0.5) * w, cy - d / 2, rnd() * h, c);
      }
    };
    const K = room.kind;
    if (K === 'studio') {
      addBox(-W * 0.3, -D * 0.28, 1.6, 0.8, 0.75, 0x4a4138);
      addBox(W * 0.28, D * 0.22, 0.9, 0.9, 1.1, 0x3d3833);
      addBox(-W * 0.05, D * 0.33, 0.5, 0.5, 1.7, 0x46403a);
    } else if (K === 'livingRoom') {
      addBox(-W * 0.22, -D * 0.2, 2.0, 0.9, 0.7, 0x59462f);
      addBox(-W * 0.22, D * 0.12, 1.1, 0.6, 0.42, 0x4a4138);
      addBox(W * 0.32, -D * 0.05, 0.45, 1.6, 1.5, 0x3d3833);
    } else if (K === 'workshop') {
      addBox(-W * 0.3, 0, 0.8, 2.2, 0.95, 0x474039);
      addBox(W * 0.3, -D * 0.25, 1.7, 0.7, 0.95, 0x474039);
      addBox(W * 0.25, D * 0.3, 0.6, 0.6, 1.8, 0x3a3530);
    } else {
      addBox(-W * 0.32, -D * 0.18, 0.6, 0.6, 0.6, 0x46403a);
      addBox(W * 0.18, D * 0.16, 0.7, 0.5, 0.5, 0x46403a);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.016, vertexColors: true, sizeAttenuation: true }));
    this.navWorld.add(this.cloud);
    UI.set('navroom', room.name);
    UI.set('navpts', `${Math.round(pts.length / 3 / 1000)}k pts`);

    // occupancy grid (0.1 m cells, obstacles inflated by the robot radius)
    const res = 0.1, infl = 0.38;
    const gw = Math.ceil(W / res), gh = Math.ceil(D / res);
    const occ = new Uint8Array(gw * gh);
    for (const b of boxes) {
      const x0 = Math.max(0, Math.floor((b.cx - b.w / 2 - infl + W / 2) / res));
      const x1 = Math.min(gw - 1, Math.ceil((b.cx + b.w / 2 + infl + W / 2) / res));
      const y0 = Math.max(0, Math.floor((b.cy - b.d / 2 - infl + D / 2) / res));
      const y1 = Math.min(gh - 1, Math.ceil((b.cy + b.d / 2 + infl + D / 2) / res));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) occ[y * gw + x] = 1;
    }
    this.grid = { occ, gw, gh, res, W, D };
    // keep the robot's local pose inside the room
    this.sim.state.bx = clamp(this.sim.state.bx, -W / 2 + 0.5, W / 2 - 0.5);
    this.sim.state.by = clamp(this.sim.state.by, -D / 2 + 0.5, D / 2 - 0.5);
  }

  setGoal(x, y) {
    const path = this._plan([this.sim.state.bx, this.sim.state.by], [x, y]);
    if (!path) { UI.set('navdist', 'unreachable'); return; }
    const end = path[path.length - 1];                 // snapped if inside an obstacle
    this.goal = { x: end[0], y: end[1] }; this.path = path; this._wpIdx = 0;
    this.goalRing.position.set(end[0], end[1], 0.012); this.goalRing.visible = true;
    const flat = [];
    let len = 0;
    for (let i = 0; i < path.length; i++) {
      flat.push(path[i][0], path[i][1], 0.02);
      if (i) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    UI.set('navdist', `${len.toFixed(1)} m`);
    $('#taFollow').disabled = false;
  }
  clearGoal() {
    this.goal = null; this.path = []; this.following = false;
    if (this.goalRing) this.goalRing.visible = false;
    if (this.pathLine) { this.pathLine.geometry.dispose(); this.pathLine.geometry = new THREE.BufferGeometry(); }
    UI.set('navdist', '—');
    const f = $('#taFollow'); if (f) { f.disabled = true; f.textContent = 'Follow path'; f.classList.add('primary'); }
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
  }

  /** Nearest free cell to (cx, cy) — BFS ring search; null if the map is full. */
  _nearestFree(cx, cy) {
    const { occ, gw, gh } = this.grid;
    if (!occ[cy * gw + cx]) return [cx, cy];
    for (let r = 1; r < Math.max(gw, gh); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < gw && y < gh && !occ[y * gw + x]) return [x, y];
      }
    }
    return null;
  }

  /** A* on the occupancy grid + line-of-sight string-pulling. Start/goal
      inside an obstacle's inflation zone snap to the nearest free cell. */
  _plan(from, to) {
    const { occ, gw, gh, res, W, D } = this.grid;
    const cell = (p) => [clamp(Math.floor((p[0] + W / 2) / res), 0, gw - 1), clamp(Math.floor((p[1] + D / 2) / res), 0, gh - 1)];
    const s0 = this._nearestFree(...cell(from)), g0 = this._nearestFree(...cell(to));
    if (!s0 || !g0) return null;
    const [sx, sy] = s0, [gx, gy] = g0;
    const open = [[0, sx, sy]], came = new Map(), g = new Map();
    const key = (x, y) => y * gw + x;
    g.set(key(sx, sy), 0);
    const h = (x, y) => Math.hypot(x - gx, y - gy);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [, x, y] = open.shift();
      if (x === gx && y === gy) { found = true; break; }
      for (const [dx, dy, c] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || occ[key(nx, ny)]) continue;
        const ng = g.get(key(x, y)) + c;
        if (ng < (g.get(key(nx, ny)) ?? Infinity)) {
          g.set(key(nx, ny), ng); came.set(key(nx, ny), key(x, y));
          open.push([ng + h(nx, ny), nx, ny]);
        }
      }
      if (open.length > 14000) return null;     // safety valve
    }
    if (!found) return null;
    let k = key(gx, gy); const cells = [[gx, gy]];
    while (came.has(k)) { k = came.get(k); cells.unshift([k % gw, Math.floor(k / gw)]); }
    const world = cells.map(([x, y]) => [(x + 0.5) * res - W / 2, (y + 0.5) * res - D / 2]);
    // restore the exact endpoints only where they weren't snapped out of an obstacle
    const free = (p) => { const [cx, cy] = cell(p); return !occ[cy * gw + cx]; };
    if (free(from)) world[0] = [...from];
    if (free(to)) world[world.length - 1] = [...to];
    // string-pull: drop waypoints with clear line of sight
    const los = (a, b) => {
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (res * 0.5));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const [cx, cy] = cell([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        if (occ[cy * gw + cx]) return false;
      }
      return true;
    };
    const out = [world[0]];
    let i = 0;
    while (i < world.length - 1) {
      let j = world.length - 1;
      while (j > i + 1 && !los(world[i], world[j])) j--;
      out.push(world[j]); i = j;
    }
    return out;
  }

  /** Pure pursuit along the path — streams the SAME navJoystick the sticks do. */
  _followStep(dt) {
    if (!this.following || !this.path.length || this.estop) return;
    const { bx, by, yaw } = this.sim.state;
    // advance monotonically along the path (never re-target a passed waypoint)
    const look = 0.45;
    while (this._wpIdx < this.path.length - 1
           && Math.hypot(this.path[this._wpIdx][0] - bx, this.path[this._wpIdx][1] - by) < look) this._wpIdx++;
    const target = this.path[this._wpIdx];
    const dGoal = Math.hypot(this.goal.x - bx, this.goal.y - by);
    if (dGoal < 0.14) {
      this.following = false; this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
      $('#taFollow').textContent = 'Follow path'; $('#taFollow').classList.add('primary');
      UI.set('navdist', 'arrived');
      return;
    }
    // robot front faces −X ⇒ heading of the front = yaw + π
    const want = Math.atan2(target[1] - by, target[0] - bx);
    const err = wrapPi(want - (yaw + Math.PI));
    // A goal almost exactly behind flips err's sign every frame (±π) and the
    // turn stalls — commit to one direction until the error leaves the cusp.
    if (Math.abs(err) > 2.9) this._turnDir = this._turnDir || Math.sign(err) || 1;
    else this._turnDir = 0;
    this.nav.w = this._turnDir ? this._turnDir * MAX_ANG : clamp(2.2 * err, -MAX_ANG, MAX_ANG);
    const fwd = Math.abs(err) < 1.2 ? clamp(1.6 * dGoal, 0.12, 0.6) * Math.max(0, Math.cos(err)) : 0;
    this.nav.f = fwd; this.nav.s = 0;
    UI.set('navdist', `${dGoal.toFixed(1)} m`);
  }

  /* ── wire helpers ───────────────────────────────────────────────── */
  setWire(name, v) {
    if (this.estop) return;
    this.wireJoints[name] = typeof v === 'number' ? +v.toFixed(4) : v;
    this.jointsDirty = true;
  }
  _announceSpec(force) {
    let spec;
    if (this.view === 'teleop') {
      spec = this.cockpitMode === 'drive'
        ? { method: 'navigation', controlType: 'impedance', region: 'whole_body', stiffness: this.stiffness * MAX_STIFF }
        : { method: 'wrist', controlType: 'impedance', region: 'arm', stiffness: this.stiffness * MAX_STIFF };
    } else if (this.view === 'body') {
      // Soft is deliberately toggle-free: one whole-body compliance law, all
      // the complexity server-side (the same spec WholeBodyView pins).
      spec = this.feel === 'compliance'
        ? { method: 'wrist', controlType: 'compliance', region: 'whole_body', stiffness: 0 }
        : { method: 'wrist', controlType: 'impedance', region: 'arm', stiffness: this.stiffness * MAX_STIFF };
    } else if (this.view === 'nav') {
      spec = { method: 'navigation', controlType: 'impedance', region: 'whole_body', stiffness: this.stiffness * MAX_STIFF };
    } else return;
    const sig = JSON.stringify(spec);
    if (!force && sig === this._lastSpec) return;
    this._lastSpec = sig;
    this.link.send('control_mode', spec);
  }

  pushFrame() {
    if (this.estop) return;
    this.link.seq += 1;
    // Base linear wire signs — set to match the ROBOT's OBSERVED motion (verified
    // on the live setup, which is the source of truth over the bridge-code comments):
    //   forward stick (nav.f>0) ⇒ ly = +fwd      left strafe (nav.s<0) ⇒ lx = -strafe
    // i.e. lx = -nav.s, ly = +nav.f. Yaw (rx) and lift (ry) are unchanged.
    this.link.send('teleop_frame', {
      sequence: this.link.seq,
      timestamp: Date.now() / 1000,
      head: { transform: { matrix: IDENTITY16 }, trackingState: 'normal' },
      mode: 'Base Driving',
      navJoystick: {
        lx: +(-this.nav.s / MAX_LIN).toFixed(3),
        ly: +(this.nav.f / MAX_LIN).toFixed(3),
        rx: +(this.nav.w / MAX_ANG).toFixed(3),
        ry: +this.nav.liftRate.toFixed(3),
      },
    });
    if (this.jointsDirty) {
      this.jointsDirty = false;
      this.link.send('joint_command', { joints: this.wireJoints });
    }
  }

  resetAll() {
    this.sim.resetHome();
    this.wireJoints = {}; this.jointsDirty = false;
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
    if (this.goalRing) this.clearGoal();
    if (this.bodyRig && this.targets) {
      this.bodyRig.pose(this.sim.state, { pinned: true });
      for (const s of ['l', 'r']) this.bodyRig.ee[s]?.getWorldPosition(this.targets[s]);
    }
    this.link.send('reset', {});
  }

  /* ── incoming robot_state ───────────────────────────────────────── */
  applyRobotState(p) {
    this.sim.remote = true;
    if (p.jointPositions) {
      for (const n in p.jointPositions) if (n in this.sim.state.q) this.sim.state.q[n] = +p.jointPositions[n];
      this.sim.lift = (this.sim.state.q.lift_lower || 0) + (this.sim.state.q.lift_upper || 0);
    }
    if (p.base) {
      this.sim.state.bx = +p.base.x || 0;
      this.sim.state.by = +p.base.y || 0;
      this.sim.state.yaw = +p.base.yaw || 0;
      if (Array.isArray(p.base.steer)) ['fl_steer', 'fr_steer', 'b_steer'].forEach((n, i) => { this.sim.state.q[n] = +p.base.steer[i]; });
      if (Array.isArray(p.base.drive)) ['fl_drive', 'fr_drive', 'b_drive'].forEach((n, i) => {
        this.sim.state.q[n] = (this.sim.state.q[n] || 0) + (+p.base.drive[i]) * 0.05;
      });
    }
    if (p.latencyMs != null) UI.set('lat', `${(+p.latencyMs).toFixed(0)} ms`);
    if (p.battery) {
      const pc = +p.battery.percentage;
      UI.set('batt', `${(pc <= 1.5 ? pc * 100 : pc).toFixed(0)}%`);
    }
    if (p.driver) {                       // arbitration: am I the active driver?
      const was = this.driving;
      this.driving = !!p.driver.you;
      this.clientCount = +p.driver.clients || 1;
      if (was !== this.driving) this._paintLink();
    }
    this.sim.applyGrips();
  }

  /** Robot-local horizontal axes expressed in three.js world space (from the
      base node's world orientation, projected to the ground plane). `lat` is the
      robot's left/right axis, `fwd` its fore/aft axis — so joystick motion maps
      to the ROBOT's frame regardless of how the chase camera or base is turned. */
  _robotAxes(rig) {
    const q = rig.base.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q); fwd.y = 0;
    const lat = new THREE.Vector3(0, 1, 0).applyQuaternion(q); lat.y = 0;
    fwd.lengthSq() > 1e-6 ? fwd.normalize() : fwd.set(0, 0, 1);
    lat.lengthSq() > 1e-6 ? lat.normalize() : lat.set(1, 0, 0);
    return { fwd, lat };
  }

  /** Teleop Arms: drive each palm in the ROBOT's local frame from its joystick
      (horizontal → lateral, vertical → fore/aft) plus the RAISE buttons (world
      up/down), via IK. Runs whether connected or local — the resolved joint
      targets stream as joint_command so the real robot moves too. */
  _armCartesian(dt) {
    const RATE = 0.42;                       // m/s at full joystick deflection
    this.miniRig.pose(this.sim.state);       // FK current before IK
    const { fwd, lat } = this._robotAxes(this.miniRig);
    const ee = new THREE.Vector3();
    for (const side of ['left', 'right']) {
      const s = side === 'left' ? 'l' : 'r';
      if (!this.miniRig.ee[s]) continue;
      this.miniRig.ee[s].getWorldPosition(ee);
      if (!this.armTgt[s]) this.armTgt[s] = ee.clone();
      const joy = this.armJoy[side];
      const rz = this.armRaise[side] || 0;
      const moving = Math.abs(joy.x) > 0.06 || Math.abs(joy.y) > 0.06 || rz !== 0;
      if (!moving) { this.armTgt[s].copy(ee); continue; }  // idle → track the live palm, no drift
      this.armTgt[s]
        .addScaledVector(lat, -joy.x * RATE * dt)   // stick right → palm to the robot's right
        .addScaledVector(fwd, -joy.y * RATE * dt)   // stick up    → palm forward (away from body)
        .addScaledVector(UP_Y, rz * RATE * dt);     // RAISE       → straight up/down
      // When connected, the display follows robot_state — so snapshot the live
      // arm pose, run IK only to DERIVE the joint targets to stream, then restore
      // it so the model doesn't jitter ahead of the real robot.
      const saved = this.sim.remote ? this.sim.chains[s].map((c) => this.sim.state.q[c]) : null;
      this.sim.ik(this.miniRig, s, this.armTgt[s], 0.5, 3);
      for (const c of this.sim.chains[s]) {
        this.sim.jointTarget[c] = this.sim.state.q[c];
        this.setWire(c, this.sim.state.q[c]);       // stream as joint_command (works connected)
      }
      if (saved) this.sim.chains[s].forEach((c, i) => { this.sim.state.q[c] = saved[i]; });
    }
  }

  /* ── per-frame tick ─────────────────────────────────────────────── */
  _tick(dt) {
    if (this.view === 'nav') this._followStep(dt);

    // Arm Cartesian drive runs regardless of the link: the joysticks always move
    // the arms (locally on the twin, and over the wire when connected).
    if (this.view === 'teleop' && this.cockpitMode === 'arms' && !this.estop) this._armCartesian(dt);

    if (!this.sim.remote && !this.estop) {
      // local kinematic mirror (identical command semantics to the bridge)
      this.sim.stepBase(this.nav, dt);
      if (this.drag && this.view === 'body') {
        if (this.feel === 'impedance') {
          this.sim.ik(this.bodyRig, this.drag, this.targets[this.drag], 0.3 + 0.4 * this.stiffness, 2);
          for (const c of this.sim.chains[this.drag]) {
            this.sim.jointTarget[c] = this.sim.state.q[c];
            this.setWire(c, this.sim.state.q[c]);
          }
        } else {
          // SOFT: locally yield toward the pull; on the wire it is a pure
          // world-frame push (converted three → MuJoCo at the seam).
          this.sim.ik(this.bodyRig, this.drag, this.targets[this.drag], 0.12, 1);
        }
      }
      this.sim.slew(dt, this.drag && this.feel === 'impedance' ? this.sim.chains[this.drag] : null);
      this.sim.applyGrips();
    }

    // SOFT push streams while dragging (connected: real external_force)
    if (this.drag && this.feel === 'compliance' && this.view === 'body' && !this.estop) {
      const ee = new THREE.Vector3();
      this.bodyRig.ee[this.drag].getWorldPosition(ee);
      const f = toMj(new THREE.Vector3().subVectors(this.targets[this.drag], ee))
        .multiplyScalar(PUSH_K).clampLength(0, PUSH_MAX);
      this.link.send('external_force', {
        forces: { [`${this.drag}_hand_mount`]: [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)] },
      });
    }

    // 20 Hz uplink
    this._txAcc += dt;
    if (this._txAcc >= 1 / TX_HZ) { this._txAcc = 0; if (this.link.connected) pushSafe(this); }
  }

  /* ── once per displayed frame ───────────────────────────────────── */
  _render() {
    // throttled telemetry (10 Hz — DOM writes are not free)
    const now = performance.now();
    const uiTick = !this._uiAt || now - this._uiAt > 100;
    if (uiTick) this._uiAt = now;

    if (this.view === 'teleop') {
      this.miniRig.pose(this.sim.state);
      const root = this.miniRig.rootThree(this.sim.state);
      // chase from behind the robot's front (−X side ⇒ camera at +X in MuJoCo)
      const back = toThree(new THREE.Vector3(
        Math.cos(this.sim.state.yaw) * 2.2, Math.sin(this.sim.state.yaw) * 2.2, 1.5));
      this.miniStage.camera.position.copy(root).add(back);
      this.miniStage.camera.lookAt(root.x, root.y + 0.75, root.z);
      this.miniStage.render();
      if (uiTick) UI.set('speed', `${Math.hypot(this.nav.f, this.nav.s).toFixed(2)} m/s`);
    } else if (this.view === 'body') {
      // odom-pinned: the Body twin stays centered even while the base drives
      this.bodyRig.pose(this.sim.state, { pinned: true });
      const ee = new THREE.Vector3();
      for (const s of ['l', 'r']) {
        if (this.drag === s) this.balls[s].position.copy(this.targets[s]);
        else if (this.bodyRig.ee[s]) { this.bodyRig.ee[s].getWorldPosition(ee); this.balls[s].position.copy(ee); this.targets[s].copy(ee); }
        this.balls[s].visible = true;
      }
      this.bodyStage.render();
    } else if (this.view === 'nav') {
      this.navRig.pose(this.sim.state);
      this.navStage.render();
      if (uiTick) UI.set('navpose', `x ${this.sim.state.bx.toFixed(1)} · y ${this.sim.state.by.toFixed(1)} m`);
    }
  }
}

function pushSafe(app) { try { app.pushFrame(); } catch (e) { /* never kill the raf */ } }

/* ════ boot ══════════════════════════════════════════════════════════ */
(async () => {
  try {
    const manifest = await fetch('assets/mabel_joints.json').then((r) => r.json());
    const app = new App(manifest);
    window.__ta = app;          // exposed for the smoke-test harness
    await app.start();
  } catch (e) {
    console.error('teleop console failed to start', e);
    const l = $('#taApp .ta-loading'); if (l) l.textContent = 'FAILED TO LOAD — see console';
  }
})();
