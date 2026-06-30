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

// ── The two consistent robots the console connects to (mirrors the iOS app's
//    NetworkConfig.seedRobots — same IPs, same relay paths, same passcode) ──────
//   Simulation : open. Wi-Fi LAN IPs · Tailscale 100.68.140.105 · relay /teleop.
//   MABEL Real (thor): GATED. Owner passcode unlocks it, then Wi-Fi 10.20.54.117 ·
//                Tailscale 100.87.253.64 · relay /real/teleop.
const REAL_CODE = '090620';                       // owner passcode (iOS SecureStore.ownerBypassCode)
const SIM_WIFI_HOSTS = ['192.168.1.188', '192.168.1.166', '192.168.123.34', '172.20.10.2'];
const SIM_VPN_IP = '100.68.140.105';
const REAL_WIFI_IP = '10.20.54.117';
const REAL_VPN_IP = '100.87.253.64';

const ACCENT = 0xe9a679, GREEN = 0x3FB56B, RED = 0xb3402e, BONE = 0xefeae3;
// Navigation highlight — a vivid spring-green for the goal beacon + planned path.
// Bright and saturated so it reads clearly over the dark/tan point cloud, and it
// echoes the green goal ball shown on the operator's RViz.
const NAV_HL = 0x2bf0a4, NAV_HL_SOFT = 0x66f7c2;

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
      // ANY message that can only originate from the live bridge/robot proves the
      // path reaches the robot — not just the relay edge. _aliveAt gates the
      // "connected" UI so a token-gated VPS that accepts the socket but can't
      // reach a down robot never reads as connected.
      if (msg.type === 'robot_state') { this.app._aliveAt = performance.now(); this.app.applyRobotState(p); }
      else if (msg.type === 'pong') { this.app._aliveAt = performance.now(); this.rtt = performance.now() - this._pingSent; UI.set('rtt', `${this.rtt.toFixed(0)} ms`); }
      else if (msg.type === 'hello') { this.app._aliveAt = performance.now(); this.app.onHello(p); this.send('list_maps', {}); }
      else if (msg.type === 'map_list') this.app.onMapList(p);
      else if (msg.type === 'nav_result') this.app.onNavResult(p);
    };
    this.ws.onclose = () => { const was = this.connected; this._down(); if (was || this.want) this._retry(); };
    this.ws.onerror = () => {};
    // The socket is open but the robot hasn't proven itself yet: if no hello /
    // robot_state arrives within 4 s, the upstream (real robot behind the relay)
    // is down — drop the socket so it doesn't masquerade as "connected" and the
    // failover/retry can try another path.
    this._helloTimer = setTimeout(() => {
      if (this.connected && !(this.app._aliveAt && performance.now() - this.app._aliveAt < 4000)) {
        try { this.ws && this.ws.close(); } catch (e) {}
      }
    }, 4500);
  }
  _down() {
    clearTimeout(this._helloTimer);
    if (this.connected) this.app.onLink(false);
    this.connected = false; this.rtt = null; this.app._aliveAt = 0;
    clearInterval(this._pingT);
  }
  _retry() { if (this.want) this._retryT = setTimeout(() => this._open(), 2000); }
  send(type, payload) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify({ type, payload })); } catch (e) {}
  }
}

/* ════ MapStream — live SLAM mesh + odom over the DEDICATED map port ═══
   Binary WebSocket to ws://<host>:<mapPort> (default 9092), isolated from the
   teleop link (9090) and cameras (8080) so the multi-MB mesh never competes with
   control/video. Same wire protocol as the iOS app (MapStreamLink.swift):
     MESH (0x01): u8 type, u8 flags(bit0=final chunk), u16 pad, u32 count,
                  count×{ f32 x,y,z (ROS odom, z-up) ; u8 r,g,b,a }
     ODOM (0x02): u8 type, u8 pad×3, f32 x,y,z, f32 qx,qy,qz,qw (ROS x,y,z,w)
   Coords stay in the ROS/MuJoCo z-up frame — the nav view's navWorld group
   applies Q_ZUP, so points/odom drop straight in (no per-axis rebasing here). */
class MapStream {
  constructor(app) {
    this.app = app; this.ws = null; this.want = false; this.url = '';
    this._retryT = null;
    this._pending = { pos: [], col: [] };      // accumulates chunks until 'final'
    this.lastRecv = 0; this.frames = 0; this.lastMeshT = 0; this.meshHz = 0;
  }
  connect(url) {
    if (this.url === url && this.want) return;
    this.url = url; this.want = true;
    clearTimeout(this._retryT);
    if (this.ws) { const o = this.ws; this.ws = null; o.onmessage = o.onclose = o.onerror = null; try { o.close(); } catch (e) {} }
    this._open();
  }
  disconnect() {
    this.want = false; clearTimeout(this._retryT);
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
  }
  _open() {
    if (!this.want || !this.url) return;
    let ws; try { ws = new WebSocket(this.url); } catch (e) { this._retry(); return; }
    ws.binaryType = 'arraybuffer'; this.ws = ws;
    ws.onmessage = (ev) => { if (ev.data instanceof ArrayBuffer) this._decode(ev.data); };
    ws.onclose = () => { if (this.want) this._retry(); };
    ws.onerror = () => {};
  }
  _retry() { if (this.want) this._retryT = setTimeout(() => this._open(), 1500); }

  _decode(buf) {
    const dv = new DataView(buf), type = dv.getUint8(0);
    if (type === 0x01) this._mesh(dv, buf);          // map mesh / point cloud
    else if (type === 0x02) this._odom(dv);          // robot pose (fast)
    else if (type === 0x03) this._path(dv, buf);     // Nav2 planned route
    else if (type === 0x04) this._grid(dv, buf);     // 2D occupancy map
    else if (type === 0x05) this._cloud(dv, buf);    // live sensor cloud (overlay)
  }
  _path(dv, buf) {
    const count = dv.getUint32(4, true);
    if (count < 0 || buf.byteLength < 8 + count * 12) return;
    const pts = new Float32Array(count * 3);
    let o = 8;
    for (let i = 0; i < count; i++) { pts[i*3]=dv.getFloat32(o,true); pts[i*3+1]=dv.getFloat32(o+4,true); pts[i*3+2]=dv.getFloat32(o+8,true); o+=12; }
    this.app.onPath(pts);
  }
  _grid(dv, buf) {
    const w = dv.getUint32(4, true), h = dv.getUint32(8, true);
    const res = dv.getFloat32(12, true);
    const ox = dv.getFloat32(16, true), oy = dv.getFloat32(20, true), oz = dv.getFloat32(24, true);
    if (w <= 0 || h <= 0 || buf.byteLength < 32 + w * h) return;
    this.app.onGrid({ w, h, res, ox, oy, oz, cells: new Uint8Array(buf.slice(32, 32 + w * h)) });
  }
  _cloud(dv, buf) {
    // Same 16-byte vertex layout as the mesh, chunked (bit0 = final). Accumulated
    // separately from the map mesh so the live overlay REPLACES each snapshot.
    const isFinal = (dv.getUint8(1) & 0x01) !== 0;
    const count = dv.getUint32(4, true);
    if (count < 0 || buf.byteLength < 8 + count * 16) return;
    const u8 = new Uint8Array(buf);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let o = 8;
    for (let i = 0; i < count; i++) {
      pos[i*3]=dv.getFloat32(o,true); pos[i*3+1]=dv.getFloat32(o+4,true); pos[i*3+2]=dv.getFloat32(o+8,true);
      col[i*3]=u8[o+12]/255; col[i*3+1]=u8[o+13]/255; col[i*3+2]=u8[o+14]/255; o+=16;
    }
    if (!this._pendCloud) this._pendCloud = { pos: [], col: [] };
    this._pendCloud.pos.push(pos); this._pendCloud.col.push(col);
    if (!isFinal) return;
    const total = this._pendCloud.pos.reduce((s, a) => s + a.length, 0);
    const P = new Float32Array(total), C = new Float32Array(total); let off = 0;
    for (let i = 0; i < this._pendCloud.pos.length; i++) { P.set(this._pendCloud.pos[i], off); C.set(this._pendCloud.col[i], off); off += this._pendCloud.pos[i].length; }
    this._pendCloud = { pos: [], col: [] };
    this.app.onLiveCloud(P, C);
  }
  _mesh(dv, buf) {
    const isFinal = (dv.getUint8(1) & 0x01) !== 0;
    const count = dv.getUint32(4, true);
    if (count < 0 || buf.byteLength < 8 + count * 16) return;
    const u8 = new Uint8Array(buf);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let o = 8;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = dv.getFloat32(o, true);
      pos[i * 3 + 1] = dv.getFloat32(o + 4, true);
      pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
      col[i * 3] = u8[o + 12] / 255; col[i * 3 + 1] = u8[o + 13] / 255; col[i * 3 + 2] = u8[o + 14] / 255;
      o += 16;
    }
    this._pending.pos.push(pos); this._pending.col.push(col);
    if (!isFinal) return;
    // concat the snapshot's chunks
    const total = this._pending.pos.reduce((s, a) => s + a.length, 0);
    const P = new Float32Array(total), Cc = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < this._pending.pos.length; i++) { P.set(this._pending.pos[i], off); Cc.set(this._pending.col[i], off); off += this._pending.pos[i].length; }
    this._pending = { pos: [], col: [] };
    const now = performance.now();
    if (this.lastMeshT) this.meshHz = 1000 / Math.max(1, now - this.lastMeshT);
    this.lastMeshT = now; this.lastRecv = now; this.frames++;
    this.app.onMesh(P, Cc);
  }
  _odom(dv) {
    const x = dv.getFloat32(4, true), y = dv.getFloat32(8, true), z = dv.getFloat32(12, true);
    const qx = dv.getFloat32(16, true), qy = dv.getFloat32(20, true), qz = dv.getFloat32(24, true), qw = dv.getFloat32(28, true);
    const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    this.lastRecv = performance.now();
    this.app.onOdom(x, y, z, yaw);
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

  /** Three orientation rings around a marker ball — the wrist SE(3) gizmo from
      the iOS / Vision Pro apps. Roll (blue), Pitch (orange), Yaw (red); each
      torus carries its local rotation axis in userData so a drag spins it.
      Children of the ball, so they ride its position and inherit its rotation. */
  orientationRings(ball, radius) {
    const rings = [];
    const mk = (color, axis, rx, ry) => {
      // a bold, glowing planetary-ring gizmo: a solid-feeling unlit torus with a
      // wider additive HALO behind it. Opacity/scale animated in App._render.
      const grp = new THREE.Group();
      const tube = new THREE.Mesh(
        new THREE.TorusGeometry(radius, radius * 0.075, 20, 96),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(radius, radius * 0.17, 16, 80),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      grp.add(halo, tube);
      grp.rotation.set(rx, ry, 0);
      grp.userData.ringAxis = axis;   // local spin axis (perpendicular to the torus plane)
      grp.userData.tube = tube; grp.userData.halo = halo;
      grp.userData.baseColor = new THREE.Color(color);
      tube.renderOrder = 5; halo.renderOrder = 4;
      ball.add(grp);
      rings.push(grp);
      return grp;
    };
    mk(0xE7913A, new THREE.Vector3(0, 0, 1), 0, 0);            // PITCH — XY plane, spins about Z
    mk(0x4F9DFF, new THREE.Vector3(0, 1, 0), Math.PI / 2, 0);  // ROLL  — XZ plane, spins about Y
    mk(0xE0503D, new THREE.Vector3(1, 0, 0), 0, Math.PI / 2);  // YAW   — YZ plane, spins about X
    return rings;
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
    this.mapStream = new MapStream(this);        // live SLAM mesh + odom (port 9092)
    this.helloMapPort = 9092;                    // learned from hello.mapPort
    this.liveOdom = null;                        // {x,y,yaw} from SLAM, when in live mode
    this.shell = $('#taApp');
    this.estop = false;
    this.view = 'teleop';

    // operator command state
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
    this.cockpitMode = 'drive';                 // teleop view: drive | arms
    this.flying = false;                         // Pilot: joysticks gated behind Start Teleop
    this.armJoy = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    this.armRaise = { left: 0, right: 0 };      // RAISE buttons: +1 up / -1 down (world)
    this.armTgt = {};                           // l/r palm targets (three world) for Cartesian arm drive
    this.feel = 'impedance';                    // Manipulation: impedance (Stiff) | compliance (Soft)
    this.manipRegion = 'arm';                    // Stiff control area: arm | upper_body | whole_body
    this.manipSpace = 'task';                    // Stiff: task (wrist IK / ball) | joint (per-joint)
    this.wristQ = { l: null, r: null };          // commanded wrist orientation (set in _buildBody)
    this.ringDrag = null;                        // active orientation-ring drag {side, axis, cx, cy, last}
    this.stiffness = 0.7;
    this.wireJoints = {}; this.jointsDirty = false;
    this.drag = null;                           // body-view active drag side
    this._lastSpec = '';
    this.driving = true; this.clientCount = 1;  // arbitration state from robot_state
    this._aliveAt = 0;                          // last hello/robot_state/pong → link truly reaches the robot
    this.path = 'local'; this._planT = null;    // multi-path connect: local | vpn | relay
    this._discSeq = 0;                          // Wi-Fi discovery supersede counter

    this._buildDock();
    this._txAcc = 0; this._last = performance.now();
  }

  async start() {
    // Build the three views WITHOUT blocking on the 27 MB rig GLB. Each view shows
    // its scene/room immediately and the articulated robot streams in when the GLB
    // arrives (or fails gracefully) — a slow/stuck GLB no longer freezes the whole
    // app on the loading overlays. _render guards the rigs until they exist.
    this._buildTeleop().catch((e) => console.warn('teleop build:', e));
    this._buildBody().catch((e) => console.warn('body build:', e));
    this._buildNav().catch((e) => console.warn('nav build:', e));
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
    // Only stream the live map while the Navigate view is open AND the live room
    // is selected — saves bandwidth (and keeps it off the wire) otherwise.
    if (name === 'nav' && this.room && this.room.live) this._connectMap();
    else if (name !== 'nav') this.mapStream.disconnect();
    this._announceSpec();
    this._syncCams();
  }

  /* ── Pilot: Start/Stop teleop gates the joysticks ────────────────── */
  _setFlying(on) {
    this.flying = !!on;
    $('[data-view="teleop"]', this.shell)?.classList.toggle('flying', this.flying);
    const btn = $('#taStartTeleop');
    if (btn) {
      const play = $('.ic-play', btn), stop = $('.ic-stop', btn), lab = $('.lab', btn);
      if (play) play.style.display = this.flying ? 'none' : '';
      if (stop) stop.style.display = this.flying ? '' : 'none';
      if (lab) lab.textContent = this.flying ? 'Stop Teleop' : 'Start Teleop';
      btn.classList.toggle('on', this.flying);
    }
    if (!this.flying) {                    // stopped → drop the base + arm command at once
      this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
      this.armJoy = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
      this.armRaise = { left: 0, right: 0 };
    }
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
    // Start / Stop teleop — gates the Pilot joysticks (the iOS play/stop button).
    $('#taStartTeleop')?.addEventListener('click', () => this._setFlying(!this.flying));
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
  _realUnlocked() { try { return localStorage.getItem('mabel-real-unlock') === REAL_CODE; } catch (e) { return false; } }
  /** Validate + persist the owner passcode that unlocks the real robot. */
  _unlockReal(code) {
    if (String(code).trim() !== REAL_CODE) return false;
    try { localStorage.setItem('mabel-real-unlock', REAL_CODE); localStorage.setItem('mabel-real-code', REAL_CODE); } catch (e) {}
    return true;
  }
  /** The two consistent robots + every connection method, like the iOS app.
      Each route becomes a connectable target via _routeToTarget. */
  _robots() {
    const sim = {
      id: 'sim', label: 'Simulation', kind: 'sim', badge: 'SIM',
      routes: [
        { id: 'sim-auto',  method: 'auto',  label: 'Auto-discover', detail: 'find it on this network' },
        { id: 'sim-wifi',  method: 'wifi',  label: 'Wi-Fi',  detail: SIM_WIFI_HOSTS[0], hosts: SIM_WIFI_HOSTS },
        { id: 'sim-vpn',   method: 'vpn',   label: 'VPN',    detail: `${SIM_VPN_IP} · Tailscale`, host: SIM_VPN_IP, dns: DEFAULT_VPN },
        { id: 'sim-relay', method: 'relay', label: 'Relay',  detail: `${DEFAULT_RELAY} · /teleop`, host: DEFAULT_RELAY, key: DEFAULT_RELAY_KEY, relayPath: '/teleop' },
      ],
    };
    let rc = ''; try { rc = localStorage.getItem('mabel-real-code') || ''; } catch (e) {}
    const real = {
      id: 'real', label: 'MABEL Real (thor)', kind: 'real', badge: 'REAL', locked: !this._realUnlocked(),
      routes: [
        { id: 'real-wifi',  method: 'wifi',  label: 'Wi-Fi',  detail: REAL_WIFI_IP, hosts: [REAL_WIFI_IP] },
        { id: 'real-vpn',   method: 'vpn',   label: 'VPN',    detail: `${REAL_VPN_IP} · Tailscale`, host: REAL_VPN_IP },
        { id: 'real-relay', method: 'relay', label: 'Relay',  detail: `${DEFAULT_RELAY} · /real`, host: DEFAULT_RELAY, key: rc || REAL_CODE, relayPath: '/real/teleop', real: true },
      ],
    };
    return DEFAULT_RELAY ? [sim, real] : [sim];
  }
  /** Robot + route → a target object _selectTarget understands. */
  _routeToTarget(robot, route) {
    const base = { id: route.id, label: `${robot.label} · ${route.label}`, robotId: robot.id, method: route.method };
    if (route.method === 'auto')  return { ...base, kind: 'auto' };
    if (route.method === 'relay') return { ...base, kind: 'relay', host: route.host, key: route.key, relayPath: route.relayPath, real: !!route.real };
    // wifi / vpn → a LAN/Tailscale ws path. On https a raw IP fails TLS, so prefer
    // the ts.net DNS name there (its cert names the host, not the IP).
    let host = route.hosts ? route.hosts[0] : route.host;
    if (route.method === 'vpn' && route.dns && location.protocol === 'https:') host = route.dns;
    return { ...base, kind: 'lan', host, real: robot.kind === 'real' };
  }
  _allTargets() {
    const out = [];
    for (const robot of this._robots()) for (const route of robot.routes) out.push(this._routeToTarget(robot, route));
    out.push(...this._userHosts().map((h) => ({ id: h.id, label: h.label, kind: 'lan', host: h.host, user: true })));
    return out;
  }
  _findTarget(id) { return this._allTargets().find((t) => t.id === id); }
  /** Default target: the last one used, else the relay sim on the public site
      or auto-discovery on a LAN / the bridge-served console. */
  connectAuto() {
    let id = null; try { id = localStorage.getItem('mabel-target'); } catch (e) {}
    let t = (id && this._findTarget(id)) || null;
    if (!t) {
      const pub = location.protocol === 'https:' && !_isLocalHost(location.hostname);
      t = this._findTarget(pub ? 'sim-relay' : 'sim-auto') || this._findTarget('sim-auto');
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
  /** Best route for a one-tap connect: the secure relay on the public site
      (the only path that works there), else auto-discovery / the LAN host. */
  _defaultRouteFor(robot) {
    const pub = location.protocol === 'https:' && !_isLocalHost(location.hostname);
    return pub
      ? (robot.routes.find((r) => r.method === 'relay') || robot.routes[0])
      : (robot.routes.find((r) => r.method === 'auto')
        || robot.routes.find((r) => r.method === 'wifi') || robot.routes[0]);
  }
  /** A clean iOS-style list: one row per robot (tap = connect, auto-routed), the
      live connection method shown on the connected row, a worded access-code
      button for the Real robot, plus Add host / Forget for custom LAN hosts. */
  _buildHostMenu() {
    const menu = $('#taHostMenu'); if (!menu) return;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const robots = this._robots();
    const unlocked = this._realUnlocked();
    const cur = this._curTarget?.robotId;
    const alive = this.link.connected && this._aliveAt && (performance.now() - this._aliveAt < 6000);
    const METHOD = { wifi: 'Wi-Fi', vpn: 'VPN', relay: 'Relay', auto: 'Wi-Fi' };
    // show the ACTUAL connection method + host on the connected row
    const sub = (robot) => {
      if (cur === robot.id) {
        const m = METHOD[this._curTarget?.method] || 'LAN';
        const h = this._curTarget?.host || (this._curTarget?.method === 'auto' ? 'auto-discover' : '');
        if (alive) return `connected · ${m}${h ? ' · ' + esc(h) : ''}`;
        if (this.link.connected) return `${m} open · robot not responding`;
        if (this.link.want) return `connecting · ${m}…`;
      }
      return (robot.kind === 'real' && !unlocked) ? 'locked' : 'tap to connect';
    };
    const dotCls = (id) => (cur === id && alive) ? ' on' : (cur === id && this.link.want) ? ' wait' : '';
    const row = (robot) => `<button class="hm-row" data-robot="${esc(robot.id)}" type="button">
        <span class="hm-dot${dotCls(robot.id)}"></span>
        <span class="hm-main"><span class="hm-label">${esc(robot.label)}</span><span class="hm-sub">${sub(robot)}</span></span>
        <span class="hm-badge ${robot.kind}">${esc(robot.badge)}</span>
        ${robot.kind === 'real' ? `<span class="hm-codebtn${unlocked ? ' on' : ''}" data-keybtn role="button" title="${unlocked ? 'Revise access code' : 'Enter access code'}">${unlocked ? 'Code ✓' : 'Access code'}</span>` : ''}
      </button>`;
    const savedRow = (h) => `<button class="hm-row" data-tid="${esc(h.id)}" type="button">
        <span class="hm-dot${dotCls(h.id)}"></span>
        <span class="hm-main"><span class="hm-label">${esc(h.label)}</span><span class="hm-sub">${esc(h.host)}</span></span>
        <span class="hm-codebtn" data-del="${esc(h.id)}" role="button" title="Forget host">Forget</span></button>`;
    const saved = this._userHosts();
    menu.innerHTML =
      `<div class="hm-head">Robots</div>` +
      robots.map(row).join('') +
      (this._showRealPass ? `<form class="hm-pass" data-passform autocomplete="off">
          <input class="hm-passin" type="password" inputmode="numeric" maxlength="12" placeholder="${unlocked ? 'New access code' : 'Access code'}" aria-label="Real robot access code" />
          <button type="submit" class="hm-passbtn">${unlocked ? 'Update' : 'Unlock'}</button>
          <span class="hm-passerr" data-passerr hidden>Wrong code</span></form>` : '') +
      (saved.length ? `<div class="hm-head">Saved hosts</div>` + saved.map(savedRow).join('') : '') +
      (this._showAddHost
        ? `<form class="hm-add" data-addform autocomplete="off"><input class="hm-name" placeholder="Name" aria-label="Host name" /><input class="hm-ip" placeholder="192.168.1.x" aria-label="Host IP" /><button type="submit" class="hm-addbtn">Add</button></form>`
        : `<button class="hm-row hm-addrow" data-addhost type="button"><span class="hm-plus">＋</span><span class="hm-main"><span class="hm-label">Add host…</span><span class="hm-sub">a LAN IP / hostname</span></span></button>`) +
      (this.link.want ? `<button class="hm-row hm-disc" data-disc type="button"><span class="hm-dot"></span><span class="hm-main"><span class="hm-label">Disconnect</span></span></button>` : '');

    // tap a robot → connect via its best route. The Real "Access code" button opens
    // the code field (to enter it, or revise it later — even while connected).
    $$('.hm-row[data-robot]', menu).forEach((b) => b.addEventListener('click', (e) => {
      if (e.target.closest('[data-keybtn]')) { e.stopPropagation(); this._showRealPass = !this._showRealPass; this._buildHostMenu(); return; }
      const robot = robots.find((r) => r.id === b.dataset.robot);
      if (robot.kind === 'real' && !this._realUnlocked()) { this._showRealPass = true; this._buildHostMenu(); return; }
      this._selectTarget(this._routeToTarget(robot, this._defaultRouteFor(robot)));
      this._closeHostMenu();
    }));
    // saved host: tap to connect; "Forget" to remove
    $$('.hm-row[data-tid]', menu).forEach((b) => b.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) { e.stopPropagation();
        this._saveUserHosts(this._userHosts().filter((h) => h.id !== e.target.dataset.del)); this._buildHostMenu(); return; }
      this._selectTarget(this._findTarget(b.dataset.tid)); this._closeHostMenu();
    }));
    $('[data-addhost]', menu)?.addEventListener('click', () => { this._showAddHost = true; this._buildHostMenu(); });
    $('[data-addform]', menu)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const ip = $('.hm-ip', menu).value.trim(); if (!ip) return;
      const name = $('.hm-name', menu).value.trim();
      const id = 'h' + Date.now().toString(36);
      const list = this._userHosts(); list.push({ id, label: name || ip, host: ip });
      this._saveUserHosts(list); this._showAddHost = false;
      this._selectTarget(this._findTarget(id)); this._closeHostMenu();
    });
    $('[data-passform]', menu)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('.hm-passin', menu);
      if (this._unlockReal(inp.value)) {
        this._showRealPass = false; this._buildHostMenu();
        if (this._curTarget?.robotId === 'real') this._selectTarget(this._findTarget(this._curTarget.id));
      } else { const err = $('[data-passerr]', menu); if (err) err.hidden = false; if (inp) { inp.value = ''; inp.focus(); } }
    });
    if (this._showRealPass) setTimeout(() => $('.hm-passin', menu)?.focus(), 0);
    $('[data-disc]', menu)?.addEventListener('click', () => { this._disconnect(); this._curTarget = null; this._buildHostMenu(); this._paintLink(); });
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
    // "connected" requires a real robot handshake, not just an open socket — the
    // relay edge can accept the WS while the robot behind it is down (see Link).
    const alive = this.link.connected && this._aliveAt && (performance.now() - this._aliveAt < 6000);
    if (issue) {
      pill.classList.add('wait');
      label.textContent = issue.label;
      pill.title = issue.title;
    } else if (alive) {
      pill.classList.add('link');
      field?.classList.add('live');
      label.textContent = this.driving === false
        ? `${pathName} · OBSERVING${this.clientCount > 1 ? ` (${this.clientCount})` : ''}`
        : `${pathName} · DRIVING`;
      pill.title = this.driving === false
        ? 'Another client (iOS / Vision Pro) is driving — move a stick or drag the model to take over.'
        : 'You are the active driver.';
    } else if (this.link.connected && this.link.want) {
      // socket open to the relay/host, but the robot hasn't answered yet
      pill.classList.add('wait'); field?.classList.add('trying');
      label.textContent = `${pathName} · NO ROBOT`;
      pill.title = 'The path is open but the robot isn’t responding — it may be powered off, '
        + 'or the bridge isn’t running behind the relay. Nothing is being driven.';
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
      btn.classList.toggle('live', !!alive);
      btn.classList.toggle('wait', this.link.want && !alive);
    }
    const tl = $('#taTryLive');
    if (tl) tl.textContent = alive ? 'Connected'
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
  onHello(p) {
    if (p && p.name) UI.set('rtt', '0 ms');
    if (p && p.mapPort) this.helloMapPort = +p.mapPort;
    // If the live map is the active room, (re)connect now that we know the host/port.
    if (this.room && this.room.live) this._connectMap();
  }

  /* Live-map URL on the DEDICATED port — only over a direct ws:// teleop link
     (a LAN / localhost host). A relay/https (wss://) link does not expose the map
     port, so live map is unavailable there and we return null. */
  _mapUrl() {
    const url = this.link.url || '';
    // Relay / secure (wss): the live map rides the SAME tunnel as teleop — swap the
    // trailing /teleop path for /map, keeping ?key=. This is how the DEPLOYED https
    // site streams the map (the VPS Caddy forwards /map* to the bridge :9090, which
    // serves the /map path). Handles /teleop and /real/teleop.
    if (url.startsWith('wss://')) return url.replace(/\/teleop(?=$|\?)/, '/map');
    // Direct LAN/localhost (ws): use the dedicated, isolated map port.
    const m = url.match(/^ws:\/\/([^/:]+)(?::\d+)?/);
    if (!m) return null;
    return `ws://${m[1]}:${this.helloMapPort || 9092}`;
  }
  _connectMap() {
    const url = this._mapUrl();
    if (url) this.mapStream.connect(url);
  }

  /* Live mesh snapshot → swap the nav point cloud (kept in the z-up navWorld). */
  onMesh(pos, col) {
    if (!this.navWorld) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (this.liveCloud) { this.navWorld.remove(this.liveCloud); this.liveCloud.geometry.dispose(); }
    this.liveCloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.02, vertexColors: true, sizeAttenuation: true }));
    this.navWorld.add(this.liveCloud);
    if (this.cloud) this.cloud.visible = false;   // real mesh arrived → drop the demo fallback
    UI.set('navpts', `${Math.round(pos.length / 3 / 1000)}k pts · live`);
  }
  /* Live SLAM odom → the robot's base pose in the mesh (odom) frame. */
  onOdom(x, y, z, yaw) { this.liveOdom = { x, y, yaw }; }

  /* Nav2 planned route (0x03) → the path polyline (z-up navWorld). */
  onPath(pts) {
    if (!this.navWorld || !this.pathLine) return;
    this._setPath(pts);                          // pts: flat [x,y,z,...] in the MuJoCo frame
  }

  /* Build the glowing path ribbon from a flat [x,y,z,...] array (MuJoCo frame).
     A smoothed CatmullRom tube + a wider glow tube; lifted a touch off the floor
     so it sits clearly on top of the cloud/grid. <2 points hides it. */
  _setPath(flat) {
    if (!this.pathLine) return;
    const n = Math.floor(flat.length / 3);
    if (n < 2) { this._clearPath(); return; }
    const pts = [];
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(flat[i * 3], flat[i * 3 + 1], (flat[i * 3 + 2] || 0) + 0.04);
      if (!pts.length || v.distanceToSquared(pts[pts.length - 1]) > 1e-5) pts.push(v);  // drop dupes
    }
    if (pts.length < 2) { this._clearPath(); return; }
    const curve = new THREE.CatmullRomCurve3(pts);
    const seg = Math.min(260, Math.max(16, pts.length * 6));
    this._pathCore.geometry.dispose();
    this._pathCore.geometry = new THREE.TubeGeometry(curve, seg, 0.038, 9, false);
    this._pathGlow.geometry.dispose();
    this._pathGlow.geometry = new THREE.TubeGeometry(curve, seg, 0.10, 9, false);
    this.pathLine.visible = true;
  }
  _clearPath() {
    if (!this.pathLine) return;
    this._pathCore.geometry.dispose(); this._pathCore.geometry = new THREE.BufferGeometry();
    this._pathGlow.geometry.dispose(); this._pathGlow.geometry = new THREE.BufferGeometry();
    this.pathLine.visible = false;
  }

  /* Pulse the goal beacon's halo (expand + fade on a loop) and bob its beam tip so
     the goal draws the eye. Cheap: only runs while the beacon is visible. */
  _animateGoal(dt) {
    if (!this.goalRing || !this.goalRing.visible || !this._goalPulse) return;
    this._navTime = (this._navTime || 0) + dt;
    const t = (this._navTime % 1.5) / 1.5;            // 1.5 s loop
    const s = 1 + t * 1.2;                             // halo expands outward (stays inside the dial)
    this._goalPulse.scale.set(s, s, 1);
    this._goalPulse.material.opacity = 0.55 * (1 - t); // …and fades as it grows
  }

  /* Point the goal heading arrow + dial knob at `yaw` (MuJoCo/odom frame). The
     arrow group and knob live under goalRing, so they ride with the goal position. */
  _setGoalYaw(yaw) {
    this.goalYaw = yaw;
    if (this.goalArrow) this.goalArrow.rotation.z = yaw;
    if (this._goalKnob) this._goalKnob.position.set(
      this._headingR * Math.cos(yaw), this._headingR * Math.sin(yaw), 0.05);
  }

  /* Live sensor cloud (0x05) → a SEPARATE overlay, replaced each snapshot, drawn
     on TOP of the loaded/known map (mesh 0x01). Brighter + larger than the map. */
  onLiveCloud(pos, col) {
    if (!this.navWorld) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (this.overlayCloud) { this.navWorld.remove(this.overlayCloud); this.overlayCloud.geometry.dispose(); }
    this.overlayCloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, sizeAttenuation: true }));
    this.navWorld.add(this.overlayCloud);
  }

  /* 2D occupancy map (0x04) → a flat textured plane on the floor (RViz "Map").
     cells: 0=free … 100=occupied, 255=unknown. Origin (ox,oy) is the bottom-left
     corner in the odom frame; the live cloud + robot sit on top. */
  onGrid(g) {
    if (!this.navWorld) return;
    const { w, h, res, ox, oy, oz, cells } = g;
    const tex = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = cells[i];
      if (c === 255) { tex[i*4+3] = 0; }                                                 // unknown → clear
      else if (c >= 65) { tex[i*4]=44; tex[i*4+1]=40; tex[i*4+2]=36; tex[i*4+3]=240; }    // obstacle → dark
      else { tex[i*4]=158; tex[i*4+1]=150; tex[i*4+2]=140; tex[i*4+3]=110; }              // free → translucent
    }
    const dt = new THREE.DataTexture(tex, w, h, THREE.RGBAFormat);
    dt.needsUpdate = true; dt.flipY = false; dt.magFilter = THREE.NearestFilter; dt.minFilter = THREE.NearestFilter;
    if (this.gridPlane) {
      this.navWorld.remove(this.gridPlane);
      this.gridPlane.geometry.dispose(); this.gridPlane.material.map.dispose(); this.gridPlane.material.dispose();
    }
    const mat = new THREE.MeshBasicMaterial({ map: dt, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    this.gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(w * res, h * res), mat);
    this.gridPlane.position.set(ox + w * res / 2, oy + h * res / 2, (oz || 0) + 0.003);
    this.navWorld.add(this.gridPlane);
  }

  /* Saved-room list from the server (MAP_LIST) → rebuild the .ta-rooms picker with
     a "Live SLAM" entry + one per saved map. Clicking sends LOAD_MAP; the server
     streams that room's 2D map (+ 3D mesh if saved) and the live cloud overlays. */
  onMapList(p) {
    const picker = document.querySelector('.ta-view[data-view="nav"] .ta-rooms');
    if (!picker) return;
    const maps = (p && p.maps) || [], loaded = p && p.loaded;
    picker.innerHTML = '';
    const mk = (label, sub, name, on) => {
      const b = document.createElement('button');
      b.className = 'ta-room' + (on ? ' on' : '');
      b.innerHTML = `${label}<span class="sub">${sub}</span>`;
      b.addEventListener('click', () => {
        picker.querySelectorAll('.ta-room').forEach((x) => x.classList.toggle('on', x === b));
        this.link.send('load_map', { name });
        UI.set('navroom', name === 'live' ? 'Live SLAM' : label);
      });
      picker.appendChild(b);
    };
    mk('Live SLAM', 'building now', 'live', !loaded);
    maps.forEach((m) => mk(m.name,
      (m.has_mesh ? '3D + 2D map' : '2D map') + (m.has_reloc ? ' · reloc' : ''),
      m.name, loaded === m.name));
  }

  /* Nav2 goal outcome (NAV_RESULT). On an unreachable/aborted goal, tell the user
     to pick another point (clear the goal ring + flag it on the HUD). */
  onNavResult(p) {
    const st = p && p.status, f = $('#taFollow');
    this.following = false;
    const resetBtn = () => { if (f) { f.textContent = 'Go'; f.classList.add('primary'); } };
    if (st === 'unreachable' || st === 'aborted') {
      UI.set('navdist', st === 'unreachable' ? 'NOT REACHABLE — pick another' : 'goal aborted');
      if (this.goalRing) this.goalRing.visible = false;
      if (this.pathLine) this.pathLine.visible = false;
      this.goal = null;
      if (f) f.disabled = true;
      resetBtn();
      const hud = document.querySelector('.ta-view[data-view="nav"] .ta-navhud');
      if (hud) { hud.classList.add('ta-warn'); setTimeout(() => hud.classList.remove('ta-warn'), 3500); }
    } else if (st === 'reached') {
      UI.set('navdist', 'arrived');
      if (f) f.disabled = true;
      resetBtn();
    }
  }

  /* ── TELEOP view (video + joysticks + mini model) ───────────────── */
  async _buildTeleop() {
    const v = $('[data-view="teleop"]', this.shell);
    // Orbit-enabled so the operator can drag to rotate the robot in the state view
    // (zoom/pan off so it never hijacks page scroll or drifts the robot off-frame).
    this.miniStage = new Stage($('.ta-mini .ta-stage', v), { orbit: true, ground: true });
    if (this.miniStage.controls) { this.miniStage.controls.enableZoom = false; this.miniStage.controls.enablePan = false; }
    this.miniRig = await new Rig().load(this.miniStage, this.manifest);
    $('.ta-mini .ta-stage', v).classList.add('loaded');
    if (this.miniRig) {
      // start from the chase angle (behind/above), then it's the operator's to rotate
      const c = this.miniRig.center0, d = this.miniRig.maxd;
      this.miniStage.controls.target.copy(c);
      this.miniStage.camera.position.set(c.x + d * 0.9, c.y + d * 0.5, c.z + d * 1.25);
      this.miniStage.controls.update();
    }

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
      // The tile to flag "NOT CONNECTED" on if THIS camera's stream 404s / errors
      // (e.g. a wrist cam that isn't wired): the wrist PIP, or the main video area.
      const tile = img.closest('.ta-pip') || img.closest('.ta-video');
      if (img.dataset.src !== want) {
        img.dataset.src = want;
        if (want) {
          // A served camera streams JPEG (onload); an unwired one 404s (onerror)
          // -> show a per-camera "NOT CONNECTED" overlay so a dead tile is obvious
          // rather than just blank. Cleared again the moment a frame arrives.
          img.onerror = () => { if (tile) tile.classList.add('ta-camoff'); };
          img.onload  = () => { if (tile) tile.classList.remove('ta-camoff'); };
          if (tile) tile.classList.remove('ta-camoff');   // optimistic; onerror re-flags
          img.src = want; img.style.display = '';
        } else {
          img.onerror = img.onload = null;
          img.removeAttribute('src'); img.style.display = 'none';
          if (tile) tile.classList.remove('ta-camoff');
        }
      }
    };
    set('#taCamMain', 'main'); set('#taCamL', 'wrist_left'); set('#taCamR', 'wrist_right');
    $('#taNoVid').style.display = on ? 'none' : '';
    // H.264/WebCodecs overlay (LAN only): HIGH-RES, low-latency. Renders to a <canvas>
    // over each MJPEG <img>; the img stays as the automatic fallback (relay, or a
    // browser without WebCodecs, or if the H.264 WS stalls).
    this._syncH264(host, on, remote);
  }

  /* ── H.264/WebCodecs camera overlay (browser-native low-latency) ──────────
   * The bridge serves hardware-NVENC H.264 access units on a WebSocket at
   * ws://<host>:8080/camera/<name>/h264 (one binary message = one Annex-B access
   * unit). H264Stream (assets/h264-video.js) decodes them with WebCodecs straight
   * to a <canvas> — no MSE jitter buffer, so glass-to-glass is decode + one frame,
   * and inter-frame H.264 lets us run 720p at ~3-4 Mbps instead of MJPEG's ~40.
   * Browsers cannot read the raw UDP H.264 the iOS/VP apps use, so WS is the
   * browser transport. We keep the MJPEG <img> underneath as the fallback. */
  _syncH264(host, on, remote) {
    if (!window.H264Stream || !window.H264Stream.supported) return;   // older browser → MJPEG
    this._h264 = this._h264 || {};
    const cams = [['#taCanvasMain', 'main'], ['#taCanvasL', 'wrist_left'], ['#taCanvasR', 'wrist_right']];
    const useH264 = on && !remote;            // LAN/ws only; the wss relay has no WS video edge
    for (const [sel, path] of cams) {
      const canvas = $(sel); if (!canvas) continue;
      const st = this._h264[path];
      if (useH264 && !st) {
        const s = new H264Stream({
          wsUrl: `ws://${host}:8080/camera/${path}/h264`,
          canvas,
          onLive: live => { canvas.style.display = live ? '' : 'none'; }
        });
        s.start();
        this._h264[path] = s;
      } else if (!useH264 && st) {
        st.stop(); canvas.style.display = 'none'; delete this._h264[path];
      }
    }
    // Watchdog: hide a canvas whose H.264 has gone stale, revealing the MJPEG <img>.
    if (useH264 && !this._h264Watch) {
      this._h264Watch = setInterval(() => {
        for (const [sel, path] of cams) {
          const st = this._h264 && this._h264[path]; const c = $(sel);
          if (st && c) c.style.display = st.isFresh(2500) ? '' : 'none';
        }
      }, 1000);
    } else if (!useH264 && this._h264Watch) {
      clearInterval(this._h264Watch); this._h264Watch = null;
    }
  }

  /* ── MANIPULATION view (Stiff = impedance position control · Soft =
        whole-body compliance, viewer read-only) ──────────────────────── */
  async _buildBody() {
    const v = $('[data-view="body"]', this.shell);
    this.bodyStage = new Stage($('.ta-stage', v), { orbit: true, ground: true });
    // Load the robot but NEVER stay stuck on "LOADING MABEL": clear the overlay
    // whether the GLB loads or fails, and guard the rig-dependent setup.
    let rig = null;
    try { rig = await new Rig().load(this.bodyStage, this.manifest); }
    catch (e) { console.warn('body rig load failed:', e); }
    this.bodyRig = rig;
    $('.ta-stage', v).classList.add('loaded');
    if (rig) {
      const c = rig.center0;
      this.bodyStage.controls.target.copy(c);
      this.bodyStage.camera.position.set(c.x + rig.maxd * 0.95, c.y + rig.maxd * 0.55, c.z + rig.maxd * 1.25);
      // palm handles + wrist-orientation gizmos (the iOS green ball + 3 rings)
      this.balls = {}; this.rings = {};
      this.targets = { l: new THREE.Vector3(), r: new THREE.Vector3() };
      this.wristQ = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
      for (const s of ['l', 'r']) {
        this.balls[s] = rig.marker(GREEN, rig.maxd * 0.032);   // bigger, easier to grab
        this.balls[s].userData.kind = 'ball'; this.balls[s].userData.side = s;
        this.rings[s] = rig.orientationRings(this.balls[s], rig.maxd * 0.078);  // bold Saturn/Jupiter-style ring
        this.rings[s].forEach((r) => { r.userData.side = s; });
        rig.ee[s]?.getWorldPosition(this.targets[s]);
      }
    }

    // Stiff / Soft (control law)
    $$('[data-feel] button', v).forEach((b) => b.addEventListener('click', () => {
      $$('[data-feel] button', v).forEach((x) => x.classList.toggle('on', x === b));
      this.feel = b.dataset.val; this._applyManipMode(); this._announceSpec();
    }));
    // Control area (Stiff): Arms · Upper · Whole body → control_mode.region
    $$('[data-region] button', v).forEach((b) => b.addEventListener('click', () => {
      $$('[data-region] button', v).forEach((x) => x.classList.toggle('on', x === b));
      this.manipRegion = b.dataset.rv; this._announceSpec();
    }));
    // Task space (wrist IK / ball) ↔ Joint space (per-joint) → control_mode.method
    $$('[data-space] button', v).forEach((b) => b.addEventListener('click', () => {
      $$('[data-space] button', v).forEach((x) => x.classList.toggle('on', x === b));
      this.manipSpace = b.dataset.sv; this._applyManipMode(); this._announceSpec();
    }));

    // stiffness of the position spring
    const sl = $('[data-stiff]', v), out = $('[data-stiff-out]', v);
    sl.addEventListener('input', () => {
      this.stiffness = +sl.value;
      out.textContent = `${(this.stiffness * MAX_STIFF).toFixed(0)} Nm/rad`;
      this._announceSpec(true);
    });

    // hand (grip) control — task space; open/close each hand
    $$('[data-grip]', v).forEach((sl2) => {
      const side = sl2.dataset.grip;
      sl2.addEventListener('input', () => {
        const val = clamp(+sl2.value, 0, 1);
        this.sim.grip[side] = val;
        this.setWire(`${side}_grip`, +val.toFixed(3));
      });
    });

    // joint-space sliders (Body / Arms / Hands) — arms & hands split L | R columns
    const groups = ['body', 'arms', 'hands'];
    const tabs = $('[data-jtabs]', v), list = $('[data-jlist]', v);
    const jrow = (j, full) => {
      const row = document.createElement('div');
      row.className = 'ta-jrow';
      const label = full ? j.name : j.name.replace(/^(left|right)_/, '');
      row.innerHTML = `<div class="row"><span class="k">${label}</span><span class="v" data-out>0.00</span></div>
        <input type="range" min="${j.lower}" max="${j.upper}" step="0.005" value="${this.sim.state.q[j.name] || 0}">`;
      const inp = $('input', row), o = $('[data-out]', row);
      o.textContent = (+inp.value).toFixed(2);
      inp.addEventListener('input', () => {
        const val = +inp.value;
        o.textContent = val.toFixed(2);
        this.sim.jointTarget[j.name] = val;
        this.setWire(j.name, val);
      });
      return row;
    };
    const renderGroup = (g) => {
      $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.g === g));
      list.innerHTML = '';
      const joints = this.manifest.joints.filter((j) => j.group === g && j.lower != null);
      if (g === 'body') {                                  // single column
        list.classList.remove('two-col');
        joints.forEach((j) => list.appendChild(jrow(j, true)));
      } else {                                             // LEFT | RIGHT columns
        list.classList.add('two-col');
        const L = document.createElement('div'); L.className = 'ta-jcol';
        const R = document.createElement('div'); R.className = 'ta-jcol';
        L.innerHTML = '<div class="ta-jcol-hd">LEFT</div>';
        R.innerHTML = '<div class="ta-jcol-hd">RIGHT</div>';
        joints.forEach((j) => (j.name.startsWith('left') ? L : R).appendChild(jrow(j, false)));
        list.appendChild(L); list.appendChild(R);
      }
    };
    for (const g of groups) {
      const b = document.createElement('button');
      b.dataset.g = g; b.textContent = g[0].toUpperCase() + g.slice(1);
      b.addEventListener('click', () => renderGroup(g));
      tabs.appendChild(b);
    }
    renderGroup('arms');

    // viewport buttons — re-center / fit (the 3D view is the operator's to orbit)
    $$('[data-viewbtns="body"] .ta-vbtn', v).forEach((b) =>
      b.addEventListener('click', () => this._fitView(this.bodyStage, this.bodyRig, b.dataset.vb)));

    this._applyManipMode();          // initial visibility: Stiff · Task · Arms

    // ── 3D stage interaction ── ball = drag arm IK; rings = twist the wrist.
    // The viewer is INTERACTIVE only in Stiff + Task space; in Soft or Joint
    // space it is a read-only mirror (orbit only — you pose the real robot).
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    const planeN = new THREE.Vector3(); const plane = new THREE.Plane();
    const canvas = this.bodyStage.canvas;
    const pick = (ev) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.bodyStage.camera);
      return ray;
    };
    const interactive = () => this.feel === 'impedance' && this.manipSpace === 'task' && this.balls;
    canvas.addEventListener('pointerdown', (ev) => {
      if (this.estop || !interactive()) return;     // soft / joint / no-rig → orbit only
      const r = pick(ev);
      // rings sit on the ball surface — test them first, then the ball core
      const ringHits = r.intersectObjects(this.rings.l.concat(this.rings.r), true);   // recursive: tube/halo → group
      if (ringHits.length) {
        const grp = ringHits[0].object.parent, side = grp.userData.side;             // mesh → its ring group
        const sp = this._project(this.balls[side].position);
        this.ringDrag = { side, axis: grp.userData.ringAxis.clone(), mesh: grp,
          last: Math.atan2(ev.clientY - sp.y, ev.clientX - sp.x) };
        this.bodyStage.controls.enabled = false; canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(ev.pointerId); ev.preventDefault(); return;
      }
      const hits = r.intersectObjects([this.balls.l, this.balls.r], false);
      if (!hits.length) return;
      this.drag = hits[0].object.userData.side;
      this.bodyStage.controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
      this.bodyStage.camera.getWorldDirection(planeN);
      plane.setFromNormalAndCoplanarPoint(planeN, this.balls[this.drag].position);
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (this.ringDrag) {                          // spin a ring → wrist orientation
        const side = this.ringDrag.side;
        const sp = this._project(this.balls[side].position);
        const a = Math.atan2(ev.clientY - sp.y, ev.clientX - sp.x);
        let d = a - this.ringDrag.last; this.ringDrag.last = a;
        if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
        this.wristQ[side].multiply(new THREE.Quaternion().setFromAxisAngle(this.ringDrag.axis, d));
        this._streamWrist(side);
        return;
      }
      if (this.drag) {
        const p = new THREE.Vector3();
        if (pick(ev).ray.intersectPlane(plane, p)) this.targets[this.drag].copy(p);
        return;
      }
      // idle hover → highlight the ring/ball under the cursor + invite a drag
      if (interactive()) {
        const ringHit = pick(ev).intersectObjects(this.rings.l.concat(this.rings.r), true)[0];
        if (ringHit) { this._hoverRing = ringHit.object.parent; canvas.style.cursor = 'grab'; }
        else {
          const ballHit = pick(ev).intersectObjects([this.balls.l, this.balls.r], false)[0];
          this._hoverRing = null; canvas.style.cursor = ballHit ? 'grab' : '';
        }
      } else if (this._hoverRing || canvas.style.cursor) { this._hoverRing = null; canvas.style.cursor = ''; }
    });
    const drop = () => {
      this.ringDrag = null;
      if (this.drag) { this.bodyRig?.ee[this.drag]?.getWorldPosition(this.targets[this.drag]); this.drag = null; }
      this.bodyStage.controls.enabled = true; canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', drop);
    canvas.addEventListener('pointercancel', drop);
  }

  /** Screen-space pixel position of a world point (for ring-spin geometry). */
  _project(vec) {
    const r = this.bodyStage.canvas.getBoundingClientRect();
    const p = vec.clone().project(this.bodyStage.camera);
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }

  /** The gizmo commands a full wrist SE(3) orientation (shown by the 3 rings).
      The kinematic twin has one real wrist DOF, so the pitch component drives the
      actual left_wrist/right_wrist joint over the existing joint_command wire;
      the full orientation reaches a real robot's SE(3) wrist tracker via the rings. */
  _streamWrist(side) {
    const jn = side === 'l' ? 'left_wrist' : 'right_wrist';
    const j = this.sim.jmap[jn]; if (!j) return;
    const e = new THREE.Euler().setFromQuaternion(this.wristQ[side], 'XYZ');
    const val = clamp(e.z, j.lower, j.upper);
    this.sim.state.q[jn] = val; this.sim.jointTarget[jn] = val;
    this.setWire(jn, val);
  }

  /** Re-center / fit the camera on a rig (the viewport buttons). */
  _fitView(stage, rig, mode) {
    if (!stage || !rig || !stage.controls) return;
    const c = rig.center0, d = rig.maxd;
    stage.controls.target.copy(c);
    const k = mode === 'fit' ? 1.45 : 1.05;       // fit pulls back a touch more
    stage.camera.position.set(c.x + d * 0.9 * k, c.y + d * 0.5 * k, c.z + d * 1.2 * k);
    stage.controls.update();
  }

  /** Navigate camera: re-center · fit the room · follow the robot (toggle). */
  _fitNav(mode) {
    if (!this.navStage?.controls) return;
    const ctl = this.navStage.controls, cam = this.navStage.camera;
    if (mode === 'followcam') {
      this._navFollow = !this._navFollow;
      $$('[data-viewbtns="nav"] [data-vb="followcam"]', this.shell).forEach((b) => b.classList.toggle('on', this._navFollow));
      this._navPrev = null;
      if (this._navFollow && this.navRig) {       // snap the orbit onto the robot now (keep zoom/angle)
        const r = this.navRig.rootThree();
        const dx = r.x - ctl.target.x, dy = r.y - ctl.target.y, dz = r.z - ctl.target.z;
        ctl.target.set(r.x, r.y, r.z);
        cam.position.set(cam.position.x + dx, cam.position.y + dy, cam.position.z + dz);
        ctl.update();
      }
      return;
    }
    this._navFollow = false;
    $$('[data-viewbtns="nav"] [data-vb="followcam"]', this.shell).forEach((b) => b.classList.remove('on'));
    ctl.target.set(0, 0, 0);
    if (mode === 'fit') cam.position.set(8, 9, 9);
    else cam.position.set(5.5, 6.5, 6.5);          // re-center → default overview
    ctl.update();
  }

  /** Show/hide the Stiff vs Soft control sets + the gizmo, and set the hint.
      Region (Arms/Upper/Whole) shows ONLY in Task space or Soft. */
  _applyManipMode() {
    const v = $('[data-view="body"]', this.shell); if (!v) return;
    const stiff = this.feel === 'impedance', task = this.manipSpace === 'task';
    const show = (sel, on) => { const el = $(sel, v); if (el) el.style.display = on ? '' : 'none'; };
    show('[data-spacepanel]', stiff);                       // Task/Joint toggle: Stiff only
    show('[data-regionpanel]', (stiff && task) || !stiff);  // region: Task space OR Soft
    show('[data-taskonly]', stiff && task);                 // stiffness + grips
    show('[data-jointonly]', stiff && !task);               // joint sliders
    show('[data-softnote]', !stiff);                        // view-only note
    const hint = $('#taManipHint');
    if (hint) hint.innerHTML = !stiff
      ? 'View only — pose MABEL by hand on the real robot, or push it in the sim.'
      : task ? 'Drag the green ball to pose the arm; spin a glowing ring to set the wrist.'
             : 'Set each joint; pick the body group.';
  }

  /* ── NAVIGATE view (point-cloud room + goals + follow) ──────────── */
  async _buildNav() {
    const v = $('[data-view="nav"]', this.shell);
    this.navStage = new Stage($('.ta-stage', v), { orbit: true, ground: false });
    this.navStage.camera.position.set(5.5, 6.5, 6.5);
    this.navStage.camera.far = 300;
    this.navStage.camera.updateProjectionMatrix();

    // The robot's HOME MAP: the live SLAM reconstruction (real nvblox mesh + the
    // SLAM /odom estimate), streamed over the dedicated map port. This is the only
    // nav map now — the procedural demo rooms + the in-browser dummy odom were
    // removed so Navigate always shows the robot's real, live map of its world.
    this.rooms = [
      { name: 'Home Map', sub: 'live SLAM (+ demo fallback)', size: [8, 3.2, 6], seed: 7, kind: 'studio', live: true },
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
    // GOAL BEACON — a layered marker that's unmistakable on the cloud: a filled
    // core disc, a crisp white ring, an animated pulse halo, and a vertical beam
    // with a glowing tip so it's obvious even in a tilted 3D view. `goalRing` stays
    // the handle the rest of the code toggles via `.visible` / `.position`.
    const flatMat = (color, opacity) => new THREE.MeshBasicMaterial(
      { color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
    this.goalRing = new THREE.Group();
    const goalDisc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 48), flatMat(NAV_HL, 0.85));
    goalDisc.position.z = 0.015;
    const goalRingEdge = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.215, 56), flatMat(0xffffff, 0.95));
    goalRingEdge.position.z = 0.017;
    this._goalPulse = new THREE.Mesh(new THREE.RingGeometry(0.215, 0.30, 56), flatMat(NAV_HL_SOFT, 0.55));
    this._goalPulse.position.z = 0.013;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.62, 16),
      new THREE.MeshBasicMaterial({ color: NAV_HL, transparent: true, opacity: 0.30, depthWrite: false }));
    beam.rotation.x = Math.PI / 2; beam.position.z = 0.31;     // cylinder Y-axis → navWorld up (+z)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 14),
      new THREE.MeshBasicMaterial({ color: NAV_HL_SOFT, transparent: true, opacity: 0.95, depthWrite: false }));
    tip.position.z = 0.64;

    // HEADING CONTROL — a circular dial + draggable knob that sets the goal's final
    // orientation, with an arrow showing the heading. Drag the knob around the
    // circle → the arrow (and the ROS goal yaw, and the RViz goal arrow) rotate.
    this.goalYaw = 0;
    this._headingR = 0.46;                                    // dial radius
    this.goalArrow = new THREE.Group();                       // rotated by yaw; points +x
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.06), flatMat(NAV_HL_SOFT, 0.98));
    shaft.position.set(0.17, 0, 0.02);                         // from center outward along +x
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.085, 3), flatMat(NAV_HL_SOFT, 0.98));
    head.rotation.z = -Math.PI / 2; head.position.set(0.37, 0, 0.02);  // triangle → arrowhead
    this.goalArrow.add(shaft, head);
    this._goalDial = new THREE.Mesh(new THREE.RingGeometry(this._headingR - 0.02, this._headingR + 0.02, 72),
      flatMat(NAV_HL, 0.45));
    this._goalDial.position.z = 0.011;
    this._goalKnob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98, depthWrite: false }));
    this._goalKnob.position.set(this._headingR, 0, 0.05);
    // Wide INVISIBLE hit ring (opacity 0 but still raycast-able) so the dial is easy
    // to grab — on touch especially — without having to land exactly on the knob.
    const goalHit = new THREE.Mesh(new THREE.RingGeometry(this._headingR - 0.16, this._headingR + 0.16, 48),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    goalHit.position.z = 0.04;

    this.goalRing.add(this._goalPulse, goalDisc, goalRingEdge, beam, tip,
                      this.goalArrow, this._goalDial, this._goalKnob, goalHit);
    this.goalRing.renderOrder = 5; this.goalRing.visible = false;
    this.navWorld.add(this.goalRing);
    this._headingHits = [this._goalKnob, this._goalDial, goalHit]; // raycast targets to grab the dial

    // GENERATED PATH — a glowing ribbon (a tube reads far better than a 1px line):
    // a solid bright core tube wrapped in a soft translucent glow tube. `pathLine`
    // is a Group; _setPath / _clearPath rebuild the tube geometries.
    this.pathLine = new THREE.Group();
    this._pathGlow = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: NAV_HL, transparent: true, opacity: 0.20, depthWrite: false }));
    this._pathCore = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: NAV_HL_SOFT, transparent: true, opacity: 0.98, depthWrite: false }));
    this.pathLine.add(this._pathGlow, this._pathCore);
    this.pathLine.renderOrder = 4; this.pathLine.visible = false;
    this.navWorld.add(this.pathLine);
    this.goal = null; this.path = []; this.following = false;

    // Tap the floor to place a goal; DRAG the dial knob around the goal to set its
    // final heading (the arrow + the ROS goal yaw + the RViz goal arrow all turn).
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let downAt = null;
    const canvas = this.navStage.canvas;
    const setRay = (ev) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.navStage.camera);
    };
    const floorMj = () => {                                  // ray → MuJoCo (x,y) on the z=0 floor
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
      return toMj(p);
    };
    const endHeading = () => {
      if (!this._headingDrag) return false;
      this._headingDrag = false;
      if (this.navStage.controls) this.navStage.controls.enabled = true;
      if (this.room && this.room.live && this.goal)        // commit the final yaw to ROS/RViz
        this.link.send('nav_goal_preview', { x: this.goal.x, y: this.goal.y, yaw: this.goalYaw });
      return true;
    };
    canvas.addEventListener('pointerdown', (ev) => {
      downAt = [ev.clientX, ev.clientY];
      this._headingDrag = false;
      // Grab the heading dial when a goal is shown and the knob/ring is under the pointer.
      if (this.goalRing && this.goalRing.visible && this._headingHits) {
        setRay(ev);
        if (ray.intersectObjects(this._headingHits, false).length) {
          this._headingDrag = true;
          if (this.navStage.controls) this.navStage.controls.enabled = false;  // suspend orbit while turning
          ev.preventDefault();
        }
      }
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this._headingDrag || !this.goal) return;
      setRay(ev);
      const mj = floorMj(); if (!mj) return;
      const yaw = Math.atan2(mj.y - this.goal.y, mj.x - this.goal.x);
      this._setGoalYaw(yaw);
      const now = performance.now();                          // live-sync to RViz, throttled
      if (this.room && this.room.live && now - (this._lastYawSend || 0) > 100) {
        this._lastYawSend = now;
        this.link.send('nav_goal_preview', { x: this.goal.x, y: this.goal.y, yaw });
      }
    });
    canvas.addEventListener('pointerup', (ev) => {
      if (endHeading()) return;                              // was turning the dial, not placing a goal
      if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 6) return;  // it was an orbit
      setRay(ev);
      const mj = floorMj(); if (!mj) return;
      if (this.room && (Math.abs(mj.x) > this.room.size[0] / 2 || Math.abs(mj.y) > this.room.size[2] / 2)) return;
      // ALWAYS plan A* locally + draw the trajectory on the floor (works on the
      // dummy / fallback map too, even with no live SLAM). When a real robot is
      // actually streaming, also mirror the goal to the server's RViz preview.
      this.setGoal(mj.x, mj.y);
      if (this._liveNav()) this.link.send('nav_goal_preview', { x: this.goal.x, y: this.goal.y, yaw: this.goalYaw });
    });
    canvas.addEventListener('pointercancel', endHeading);

    // Go button. A real robot streaming on the live map → ROS Nav2 drives it (Stop
    // cancels). Otherwise the in-browser pure-pursuit follower drives the twin along
    // the drawn A* path — so Go always moves the robot on the web.
    $('#taFollow').addEventListener('click', () => {
      const f = $('#taFollow');
      if (!this.goal) return;
      this.following = !this.following;
      if (this._liveNav()) {                                  // live robot → Nav2 drive / stop
        if (this.following) this.sendNavGoal(this.goal.x, this.goal.y);
        else { this.link.send('nav_cancel', {}); UI.set('navdist', 'stopped'); }
      } else if (!this.following) {                            // local follower → stop
        this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
      }
      f.textContent = this.following ? 'Stop' : 'Go';
      f.classList.toggle('primary', !this.following);
    });
    $('#taClearGoal').addEventListener('click', () => {
      if (this._liveNav()) this.clearNavGoal();
      else this.clearGoal();
    });

    // viewport buttons — re-center · fit · follow robot (camera modes)
    $$('[data-viewbtns="nav"] .ta-vbtn', v).forEach((b) =>
      b.addEventListener('click', () => this._fitNav(b.dataset.vb)));

    this._loadRoom(this.rooms[0]);
    $('.ta-stage', v).classList.add('loaded');     // room is up → clear "BUILDING ROOM"
    // The articulated robot streams in after — the room already shows without it,
    // and a slow/stuck rig GLB no longer blocks the Navigate view.
    new Rig().load(this.navStage, this.manifest).then((r) => { this.navRig = r; })
      .catch((e) => console.warn('nav rig load failed:', e));
  }

  /* procedural SLAM-style cloud — same synthesized stand-ins as the iOS
     SLAMRoom library, plus an occupancy grid for the A* planner. */
  _loadRoom(room) {
    this.room = room;
    this.clearGoal();
    // Drop any previous clouds, then ALWAYS rebuild the procedural cloud for the
    // selected room: it's the map for the demo rooms, and a FALLBACK shown until
    // the real SLAM mesh streams in for the live Home Map — so Navigate is never
    // empty (the dummy pointcloud room shows even with no robot / no server).
    if (this.liveCloud) { this.navWorld.remove(this.liveCloud); this.liveCloud.geometry.dispose(); this.liveCloud = null; }
    if (this.cloud) { this.navWorld.remove(this.cloud); this.cloud.geometry.dispose(); this.cloud = null; }
    if (room.live) { this.liveOdom = null; this._connectMap(); }   // also stream the real mesh + odom
    else { this.mapStream.disconnect(); }
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
    this._setPath(flat);
    UI.set('navdist', `${len.toFixed(1)} m`);
    $('#taFollow').disabled = false;
  }
  clearGoal() {
    this.goal = null; this.path = []; this.following = false;
    if (this.goalRing) this.goalRing.visible = false;
    this._clearPath();
    UI.set('navdist', '—');
    const f = $('#taFollow'); if (f) { f.disabled = true; f.textContent = 'Go'; f.classList.add('primary'); }
    this.nav = { f: 0, s: 0, w: 0, liftRate: 0 };
  }

  /* Live map: STAGE a goal — drop the ring and arm "Follow path" WITHOUT driving,
     so the operator can confirm the spot (and see it mirrored on the server's RViz
     /goal_pose) before committing. The actual drive happens on the Follow press. */
  stageNavGoal(x, y) {
    if (this.following) this.link.send('nav_cancel', {});   // re-targeting mid-drive → stop first
    this.goal = { x, y }; this.following = false;
    // Mirror the staged goal to the server's RViz (/goal_pose_preview, orange) so the
    // operator can confirm the goal communicated — and the server pre-checks the spot
    // and replies NAV_RESULT unreachable if it's off-map. This does NOT drive.
    this.link.send('nav_goal_preview', { x, y, yaw: this.goalYaw });
    if (this.goalRing) { this.goalRing.position.set(x, y, 0.012); this.goalRing.visible = true; }
    this._setGoalYaw(this.goalYaw);                          // keep arrow/knob aligned at the new spot
    if (this.pathLine) { this.pathLine.visible = false; }
    UI.set('navdist', 'drag dial to aim · Follow to drive');
    const f = $('#taFollow');
    if (f) { f.disabled = false; f.textContent = 'Go'; f.classList.add('primary'); }
  }

  /* Live map: hand the goal to ROS Nav2 (NavFn A* global plan + MPPI controller)
     — NOT a local browser planner/follower. The bridge forwards it to /goal_pose
     (also shown in the server RViz) and feeds Nav2's /mabel_cmd to the base;
     nudging a drive stick takes over. */
  sendNavGoal(x, y) {
    this.link.send('nav_goal', { x, y, yaw: this.goalYaw });
    if (this.goalRing) { this.goalRing.position.set(x, y, 0.012); this.goalRing.visible = true; }
    UI.set('navdist', 'Nav2 driving…');
  }
  clearNavGoal() {
    this.link.send('nav_cancel', {});
    this.goal = null; this.following = false;
    if (this.goalRing) this.goalRing.visible = false;
    if (this.pathLine) this.pathLine.visible = false;
    UI.set('navdist', '—');
    const f = $('#taFollow');
    if (f) { f.disabled = true; f.textContent = 'Go'; f.classList.add('primary'); }
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

  /** True only when a REAL robot is actually streaming state on the live map —
      then Nav2 drives server-side. Otherwise (no live stream / dummy map) the
      in-browser A* + pure-pursuit owns navigation. */
  _liveNav() { return !!(this.room && this.room.live && this.sim.remote); }

  /** Pure pursuit along the path — streams the SAME navJoystick the sticks do. */
  _followStep(dt) {
    if (this.sim.remote) return;               // a live robot is streaming → Nav2 drives it server-side
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
      $('#taFollow').textContent = 'Go'; $('#taFollow').classList.add('primary');
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
      // Soft = whole-body compliance (viewer read-only — pose the real robot).
      // Stiff = a position controller: task space (palm SE(3) → arm IK, the green
      // ball) or joint space (per-joint targets), over the chosen control area.
      spec = this.feel === 'compliance'
        ? { method: 'wrist', controlType: 'compliance', region: 'whole_body', stiffness: 0 }
        : { method: this.manipSpace === 'joint' ? 'joint' : 'wrist',
            controlType: 'impedance', region: this.manipRegion, stiffness: this.stiffness * MAX_STIFF };
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
    if (this.wristQ) for (const s of ['l', 'r']) this.wristQ[s]?.identity();
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
    if (this.view === 'nav') { this._followStep(dt); this._animateGoal(dt); }

    // Arm Cartesian drive runs regardless of the link: the joysticks always move
    // the arms (locally on the twin, and over the wire when connected).
    if (this.view === 'teleop' && this.cockpitMode === 'arms' && this.flying && !this.estop) this._armCartesian(dt);

    if (!this.sim.remote && !this.estop) {
      // local kinematic mirror (identical command semantics to the bridge)
      this.sim.stepBase(this.nav, dt);
      // Stiff + Task space: dragging the green ball solves arm IK toward the
      // target and streams the chain. (Soft & Joint space don't drag — the ball
      // is locked / not shown; the viewer is read-only or driven by sliders.)
      if (this.drag && this.view === 'body' && this.feel === 'impedance') {
        this.sim.ik(this.bodyRig, this.drag, this.targets[this.drag], 0.3 + 0.4 * this.stiffness, 2);
        for (const c of this.sim.chains[this.drag]) {
          this.sim.jointTarget[c] = this.sim.state.q[c];
          this.setWire(c, this.sim.state.q[c]);
        }
      }
      this.sim.slew(dt, this.drag && this.feel === 'impedance' ? this.sim.chains[this.drag] : null);
      this.sim.applyGrips();
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
      // Pinned (odom-frame): the robot stays centred so the operator can orbit it
      // freely — heading, lift, arms and joints still animate from the live state.
      if (this.miniRig) this.miniRig.pose(this.sim.state, { pinned: true });
      if (this.miniStage) this.miniStage.render();
      if (uiTick) UI.set('speed', `${Math.hypot(this.nav.f, this.nav.s).toFixed(2)} m/s`);
    } else if (this.view === 'body') {
      // odom-pinned: the Body twin stays centered even while the base drives
      if (this.bodyRig && this.balls) {
        this.bodyRig.pose(this.sim.state, { pinned: true });
        // green ball + wrist rings: shown only when interactive (Stiff + Task)
        const showGizmo = this.feel === 'impedance' && this.manipSpace === 'task';
        const pulse = 0.4 + 0.18 * Math.sin(now / 470);            // idle "alive" glow
        const activeMesh = this.ringDrag?.mesh || this._hoverRing || null;
        const ee = new THREE.Vector3();
        for (const s of ['l', 'r']) {
          if (this.drag === s) this.balls[s].position.copy(this.targets[s]);
          else if (this.bodyRig.ee[s]) { this.bodyRig.ee[s].getWorldPosition(ee); this.balls[s].position.copy(ee); this.targets[s].copy(ee); }
          if (this.wristQ[s]) this.balls[s].quaternion.copy(this.wristQ[s]);   // gizmo shows commanded wrist orientation
          this.balls[s].visible = showGizmo;
          if (this.balls[s].material) this.balls[s].material.emissiveIntensity = 0.34 + 0.22 * (0.5 + 0.5 * Math.sin(now / 470));
          if (this.rings[s]) this.rings[s].forEach((r) => {                    // hover/drag → bright + larger; else gentle pulse
            const active = r === activeMesh;
            const tube = r.userData.tube, halo = r.userData.halo;
            if (tube) tube.material.opacity = active ? 1.0 : pulse + 0.12;
            if (halo) halo.material.opacity = active ? 0.4 : 0.12 + 0.06 * Math.sin(now / 470);
            r.scale.setScalar(active ? 1.16 : 1);
          });
        }
      }
      if (this.bodyStage) this.bodyStage.render();
    } else if (this.view === 'nav') {
      // The robot sits at the SLAM /odom estimate in the mesh frame — never the
      // in-browser dummy pose. Until the first odom arrives it rests at the map
      // origin (0,0,0), so no fake pose is ever shown.
      if (this.room && this.room.live) {
        const o = this.liveOdom || { x: 0, y: 0, yaw: 0 };
        this.sim.state.bx = o.x; this.sim.state.by = o.y; this.sim.state.yaw = o.yaw;
      }
      if (this.navRig) this.navRig.pose(this.sim.state);
      // follow-robot camera: pan target + camera with the robot, keep the orbit
      if (this._navFollow && this.navRig && this.navStage?.controls) {
        const r = this.navRig.rootThree();
        if (this._navPrev) {
          const dx = r.x - this._navPrev.x, dy = r.y - this._navPrev.y, dz = r.z - this._navPrev.z;
          this.navStage.controls.target.x += dx; this.navStage.controls.target.y += dy; this.navStage.controls.target.z += dz;
          this.navStage.camera.position.x += dx; this.navStage.camera.position.y += dy; this.navStage.camera.position.z += dz;
        }
        this._navPrev = { x: r.x, y: r.y, z: r.z };
      }
      if (this.navStage) this.navStage.render();
      if (uiTick) {
        UI.set('navpose', `x ${this.sim.state.bx.toFixed(1)} · y ${this.sim.state.by.toFixed(1)} m`);
        // live-map status — clearly flag when no live SLAM map is arriving (the
        // operator can still pick a saved map below and navigate it in-browser).
        if (this.room && this.room.live)
          UI.set('navpts', this.mapStream.lastRecv
            ? `${this.liveCloud ? Math.round(this.liveCloud.geometry.attributes.position.count / 1000) : 0}k pts · live`
            : (this._mapUrl() ? 'connecting to live map…' : 'live map not received · pick a saved map'));
        else UI.set('navpts', 'saved map · A* + pure-pursuit');
      }
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
