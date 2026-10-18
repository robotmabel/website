/* The robot's deployed arm retargeter, in the browser.
 *
 * On the robot the teleop gateway steps the Retarget Lab's variant "ours" on
 * every headset frame — web_gui/retarget_lab/server/worker.py
 * KinematicRetargeter("ours") at the lab's deploy preset (config.py: upper-body
 * scope, the deployed robot's joint slews and torso range, the gateway's own
 * neck rule) — and commands the arms + torso it produces. Under that sits the
 * TeleopEngine (controller/mabel/teleop_engine/). This file is a line-for-line
 * port of the parts of that chain that decide where the joints go:
 *
 *   engine.py      _payload, _retarget, _map_wrist_targets, _solve_side,
 *                  _body_map_M                     (frame handling, GMR arm map,
 *                                                   elbow hint + 0.15 m standoff)
 *   geometry.py    ShoulderEstimator, operator_frame, palm_axes, synth_elbow,
 *                  clamp_in_front / clamp_torso_standoff / clamp_shoulder_standoff
 *   arm.py         ArmRetargeter.solve: posture-atlas reference, projected
 *                  damped Gauss-Newton with the active-set pass, the trust
 *                  region on the RESULT, _table_steer, _basin_escape
 *   workspace_table.py  WorkspaceTable.lookup (seam-aware blend, feasibility)
 *   wholebody.py   TorsoController + the "angle" lean law (hip pivot)
 *   collision.py   ArmCollisionProjector: capsule barrier rows at the command
 *                  AND the measured pose, the velocity QP (solved exactly; its
 *                  answer is a unique projection), the 4 rad/s command slew
 *   ../whole_body_controller/collision_avoidance/capsule_guard.py  the capsules
 *   ../whole_body_retargeting/heading.py           LazyHeadHeading (body yaw)
 *   ../whole_body_retargeting/workspace_assist.py  WorkspaceAssist (anchor debt)
 *   web_gui/retarget_lab/server/worker.py   _servo_ideal at the deployed slews,
 *                  _deploy_out (torso clamp, gateway neck through its slew)
 *
 * Every number it uses — the kinematic tree at the home keyframe, the palm
 * frames, the reach samples, the two posture tables, the capsules and the
 * hyperparameters exactly as the lab configures "ours" — is read from the live
 * engine into assets/data/deployed-retarget.json by a generator in the parent
 * repository (web_gui/retarget_lab/tools/export_webcam_retarget.py). None is
 * typed here. Its parity check (tools/webcam_parity.mjs) runs this file and the
 * robot's own Python runtime on the same webcam frames and compares every
 * commanded joint: they agree to 1e-7 rad.
 *
 * Not ported, on purpose: the fingers (solved by a separate hand retargeter on
 * the robot), the base and lift (the deployed default holds both: upper-body
 * scope, the lift mirrored from the robot), the clutch (off in the lab), and
 * the robot-side stages after the engine (the per-joint error ceiling against
 * the MEASURED angle, the hardware layer's slews and torque caps): there is no
 * measured robot in a browser.
 *
 * Pure math, no DOM, no three.js: node imports it for the parity check.
 */

// ── tiny linear algebra (3-vectors as arrays, 3x3 as row arrays) ────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const mv = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
                      M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
                      M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
const mtv = (M, v) => [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
                       M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
                       M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]];
function mm(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}
const tr = (A) => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]],
                   [A[0][2], A[1][2], A[2][2]]];
const col = (A, j) => [A[0][j], A[1][j], A[2][j]];
const fromCols = (a, b, c) => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const TAU = 2 * Math.PI;
const pymod = (a, n) => a - n * Math.floor(a / n);            // Python's %
const wrap = (a) => pymod(a + Math.PI, TAU) - Math.PI;
function quatMat(q) {                                         // MuJoCo (w, x, y, z)
  const [w, x, y, z] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
          [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
          [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
}
function axisAngle(ax, th) {                                  // Rodrigues, unit axis
  const n = norm(ax), k = [ax[0] / n, ax[1] / n, ax[2] / n];
  const c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [[c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s],
          [k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s],
          [k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v]];
}
const mat4 = (m) => [[m[0], m[1], m[2], m[3]], [m[4], m[5], m[6], m[7]],
                     [m[8], m[9], m[10], m[11]], [m[12], m[13], m[14], m[15]]];
function mul4(A, B) {
  const C = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j] + A[i][3] * B[3][j];
  return C;
}
const pos4 = (T) => [T[0][3], T[1][3], T[2][3]];
const rot4 = (T) => [[T[0][0], T[0][1], T[0][2]], [T[1][0], T[1][1], T[1][2]],
                     [T[2][0], T[2][1], T[2][2]]];

/* Solve A x = b, A n×n (array of rows), partial pivoting — what
   numpy.linalg.solve does (LAPACK gesv). */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    const d = M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const SIDES = ['right', 'left'];
const CAP = { right: 'Right', left: 'Left' };
const ABBR = { right: 'r', left: 'l' };
/* engine._NAMES_21 / mabel/sources/wire.py _NAMES_21 */
const NAMES_21 = [
  'wrist',
  'thumb_knuckle', 'thumb_intermediate_base', 'thumb_intermediate_tip', 'thumb_tip',
  'index_knuckle', 'index_intermediate_base', 'index_intermediate_tip', 'index_tip',
  'middle_knuckle', 'middle_intermediate_base', 'middle_intermediate_tip', 'middle_tip',
  'ring_knuckle', 'ring_intermediate_base', 'ring_intermediate_tip', 'ring_tip',
  'little_knuckle', 'little_intermediate_base', 'little_intermediate_tip', 'little_tip',
];

// ── the robot: forward kinematics of the exported tree ───────────────────────
class Kin {
  constructor(D) {
    this.root = { p: D.root.pos, R: D.root.R };
    this.bodies = D.bodies.map((b) => ({
      name: b.name, parent: b.parent, pos: b.pos, R0: quatMat(b.quat),
      joint: b.joint ? { ...b.joint } : null }));
    this.bix = {};
    this.bodies.forEach((b, i) => { this.bix[b.name] = i; });
    this.jbody = {};                                // joint name -> body index
    this.bodies.forEach((b, i) => { if (b.joint) this.jbody[b.joint.name] = i; });
    // joints on the path root -> body (ancestor-or-self), for the Jacobians
    this.path = this.bodies.map((b, i) => {
      const js = [];
      for (let k = i; k >= 0; k = this.bodies[k].parent)
        if (this.bodies[k].joint) js.push(this.bodies[k].joint.name);
      return js;
    });
  }
  /* mj_kinematics restricted to the tree: body frame from its parent, then the
     hinge rotates it about the joint anchor by (q − qpos0). */
  fk(q) {
    const out = new Array(this.bodies.length);
    const anchor = {}, axis = {};
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const P = b.parent < 0 ? this.root : out[b.parent];
      let p = add(P.p, mv(P.R, b.pos));
      let R = mm(P.R, b.R0);
      if (b.joint) {
        const j = b.joint;
        const xa = add(mv(R, j.pos), p);
        anchor[j.name] = xa;
        axis[j.name] = mv(R, j.axis);
        const v = q[j.name] !== undefined ? q[j.name] : j.qpos0;
        R = mm(R, axisAngle(j.axis, v - j.qpos0));
        p = sub(xa, mv(R, j.pos));
      }
      out[i] = { p, R };
    }
    return { body: out, anchor, axis };
  }
}

// ── operator heading: the lazy-neck model (heading.py) ───────────────────────
class LazyHeadHeading {
  constructor(hp) {
    this.slack = hp.HEADING_SLACK; this.tau = hp.HEADING_TAU;
    this.still = hp.HEADING_STILL_RATE; this.rateTau = hp.HEADING_RATE_TAU;
    this.A = hp.AVP_TO_ROBOT;
    this.psi_b = null; this._psi_h = null; this._rate = 0;
  }
  head(H) {
    const R = rot4(H);
    const f = mv(R, [0, 0, -1]);
    const n = Math.hypot(f[0], f[2]);
    if (n < 1e-3) return null;
    const r = mv(this.A, [-f[2] / n, 0, f[0] / n]);
    return Math.atan2(r[0], -r[1]);
  }
  calibrate(H) {
    const h = this.head(H);
    if (h !== null) { this.psi_b = h; this._psi_h = h; this._rate = 0; }
  }
  update(H, dt) {
    const h = H ? this.head(H) : null;
    if (h === null) return this.psi_b;
    if (this.psi_b === null) { this.psi_b = h; this._psi_h = h; return this.psi_b; }
    dt = Math.max(1e-4, dt);
    const rate = Math.abs(wrap(h - this._psi_h)) / dt;
    this._rate += (1 - Math.exp(-dt / this.rateTau)) * (rate - this._rate);
    this._psi_h = h;
    let e = wrap(h - this.psi_b);
    if (Math.abs(e) > this.slack) {
      this.psi_b = wrap(this.psi_b + Math.sign(e) * (Math.abs(e) - this.slack));
      e = Math.sign(e) * this.slack;
    }
    if (this._rate < this.still)
      this.psi_b = wrap(this.psi_b + (1 - Math.exp(-dt / this.tau)) * e);
    return this.psi_b;
  }
}

// ── operator shoulders + arm length (geometry.ShoulderEstimator) ─────────────
class ShoulderEstimator {
  constructor(hp) { this.hp = hp; this.reset(); }
  reset() {
    this.stature = null; this._sh = {}; this._L = { right: null, left: null };
    this._buf = { right: [], left: [] }; this._axes = null; this._hf = null;
  }
  axes(H, by) {
    const up = [0, 1, 0];
    let right;
    if (by !== null && by !== undefined) {
      right = mtv(this.hp.AVP_TO_ROBOT, [Math.sin(by), -Math.cos(by), 0]);
    } else {
      const R = rot4(H);
      let fwd = scl(col(R, 2), -1);
      fwd = sub(fwd, scl(up, dot(fwd, up)));
      let n = norm(fwd);
      if (n < 1e-6) { fwd = scl(col(R, 1), -1); fwd = sub(fwd, scl(up, dot(fwd, up))); n = norm(fwd); }
      fwd = scl(fwd, 1 / (n + 1e-9));
      right = cross(fwd, up);
      right = scl(right, 1 / (norm(right) + 1e-9));
    }
    return [right, up, cross(up, right)];
  }
  update(H, by, wrists) {
    const hp = this.hp, raw = pos4(H);
    let hpos;
    if (hp.ARM_HEAD_ANCHOR_LP >= 1) hpos = raw;
    else {
      this._hf = this._hf === null ? raw.slice()
        : add(this._hf, scl(sub(raw, this._hf), hp.ARM_HEAD_ANCHOR_LP));
      hpos = this._hf;
    }
    const h = clamp(hpos[1] / hp.ANTHRO_EYE_HEIGHT_RATIO, hp.SHOULDER_H_MIN, hp.SHOULDER_H_MAX);
    this.stature = this.stature === null ? h : Math.max(this.stature, h);
    const [right, up, fwd] = this.axes(H, by);
    this._axes = [right, up, fwd];
    const halfw = 0.5 * hp.ANTHRO_BIACROMIAL * this.stature;
    const drop = hp.ANTHRO_ACROMION_BELOW_EYE * this.stature;
    this._sh.right = sub(add(hpos, scl(right, halfw)), scl(up, drop));
    this._sh.left = sub(sub(hpos, scl(right, halfw)), scl(up, drop));
    for (const side of SIDES) {
      const w = wrists[side];
      if (!w) continue;
      const d = norm(sub(w, this._sh[side]));
      if (!(hp.SHOULDER_L_MIN * 0.5 < d && d < hp.SHOULDER_L_MAX * 1.5)) continue;
      const buf = this._buf[side];
      buf.push(d);
      if (buf.length > hp.SHOULDER_MED_N) buf.shift();
      if (buf.length === hp.SHOULDER_MED_N) {
        const s = buf.slice().sort((a, b) => a - b);
        const med = clamp(s[(s.length - 1) >> 1], hp.SHOULDER_L_MIN, hp.SHOULDER_L_MAX);
        const cur = this._L[side];
        this._L[side] = cur === null ? med : Math.max(cur, med);
      }
    }
  }
  ready(side) { return side in this._sh; }
  root() {
    const r = this._sh.right, l = this._sh.left;
    return r && l ? scl(add(r, l), 0.5) : null;
  }
  armLength(side) {
    const hp = this.hp, h = this.stature !== null ? this.stature : 1.75;
    const prior = clamp(hp.ANTHRO_ARM_RATIO * h, hp.SHOULDER_L_MIN, hp.SHOULDER_L_MAX);
    return this._L[side] !== null ? Math.max(prior, this._L[side]) : prior;
  }
}

// ── geometry.py helpers ──────────────────────────────────────────────────────
function naturalFrame(w, fp, ip, pp) {
  let f = sub(fp, w);
  const nf = norm(f);
  if (nf < 1e-9) return null;
  f = scl(f, 1 / nf);
  let n = cross(f, sub(pp, ip));
  const nn = norm(n);
  if (nn < 1e-9) return null;
  n = scl(n, 1 / nn);
  return fromCols(f, cross(n, f), n);
}
function operatorFrame(joints, mats) {
  if (joints) {
    const P = (k) => (joints[k] ? pos4(joints[k]) : null);
    const w = P('wrist'), mid = P('middle_metacarpal'), idx = P('index_metacarpal'),
      pk = P('little_metacarpal');
    if (w && mid && idx && pk) return naturalFrame(w, mid, idx, pk);
  }
  if (mats && mats.length >= 18)
    return naturalFrame(pos4(mats[0]), pos4(mats[9]), pos4(mats[5]), pos4(mats[17]));
  return null;
}
function synthElbow(sh, wr, L, phi, side, axes, hp, upperFrac = 0.56) {
  let d = sub(wr, sh);
  let dist = norm(d);
  if (dist < 1e-6) return null;
  const upper = upperFrac * L, fore = (1 - upperFrac) * L;
  dist = Math.min(dist, upper + fore - 1e-9);
  const dhat = scl(d, 1 / (norm(d) + 1e-12));
  const cosA = clamp((upper * upper + dist * dist - fore * fore) / (2 * upper * dist), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const down = [0, -1, 0];
  let r0 = sub(down, scl(dhat, dot(down, dhat)));
  let n = norm(r0);
  if (n < 1e-6) { r0 = sub([0, 0, 1], scl(dhat, dhat[2])); n = norm(r0); }
  r0 = scl(r0, 1 / (n + 1e-12));
  const t0 = cross(dhat, r0);
  const at = (p) => add(add(sh, scl(dhat, upper * cosA)),
    scl(add(scl(r0, Math.cos(p)), scl(t0, Math.sin(p))), upper * sinA));
  let e = at(phi);
  if (axes && sinA > 1e-6) {
    const rb = axes[0], s = side === 'right' ? 1 : -1, latMin = -hp.SWIVEL_LAT_MIN * upper;
    if (s * dot(sub(e, sh), rb) < latMin) {
      const P = s * upper * sinA * dot(r0, rb), Q = s * upper * sinA * dot(t0, rb);
      const Rr = s * upper * cosA * dot(dhat, rb), amp = Math.hypot(P, Q);
      if (amp < 1e-9 || latMin - Rr > amp) e = at(phi + s * Math.PI);
      else {
        const base = Math.atan2(Q, P);
        const dphi = Math.acos(clamp((latMin - Rr) / amp, -1, 1));
        const c = [base + dphi, base - dphi];
        const dd = (x) => Math.abs(pymod(x - phi + Math.PI, TAU) - Math.PI);
        e = at(dd(c[1]) < dd(c[0]) ? c[1] : c[0]);
      }
    }
  }
  return e;
}
function clampTorsoStandoff(p, axisXY, rMin, sideDir) {
  p = p.slice();
  const v = [p[0] - axisXY[0], p[1] - axisXY[1]];
  const d = Math.hypot(v[0], v[1]);
  if (d >= rMin) return p;
  let u;
  if (d < 0.02) {
    const n = Math.hypot(sideDir[0], sideDir[1]);
    u = n > 1e-9 ? [sideDir[0] / n, sideDir[1] / n] : [0, 1];
  } else u = [v[0] / d, v[1] / d];
  p[0] = axisXY[0] + u[0] * rMin; p[1] = axisXY[1] + u[1] * rMin;
  return p;
}
function clampShoulderStandoff(p, sh, rMin) {
  const v = sub(p, sh), d = norm(v);
  if (d >= rMin || d < 1e-6) return p;
  return add(sh, scl(v, rMin / d));
}

// ── workspace_table.WorkspaceTable.lookup ────────────────────────────────────
class PostureTable {
  constructor(T, side) {
    this.x = T.x; this.y = T.y; this.z = T.z; this.rolls = T.rolls; this.shape = T.shape;
    this.q = Float64Array.from(T.q); this.feas = Float64Array.from(T.feas);
    this.tol = T.seam_tol; this.side = side; this.nq = T.shape[4];
  }
  inside(p, tol) {
    const lo = [this.x[0], this.y[0], this.z[0]];
    const hi = [this.x[this.x.length - 1], this.y[this.y.length - 1], this.z[this.z.length - 1]];
    for (let i = 0; i < 3; i++) if (!(p[i] >= lo[i] - tol && p[i] <= hi[i] + tol)) return false;
    return true;
  }
  locate(p) {
    return [this.x, this.y, this.z].map((ax, i) => {
      if (ax.length === 1) return 0;
      const t = (p[i] - ax[0]) / (ax[ax.length - 1] - ax[0]) * (ax.length - 1);
      return clamp(t, 0, ax.length - 1);
    });
  }
  rollOf(Rs) {
    const f = col(Rs, 0), n = col(Rs, 2);
    // palm_target(f, 0, side)[:, 2]: gravity-down normal orthogonalised on f
    const fu = scl(f, 1 / (norm(f) + 1e-12)), up = [0, 0, 1];
    let n0 = add(scl(up, -1), scl(fu, dot(up, fu)));
    if (norm(n0) < 1e-6) n0 = sub([1, 0, 0], scl(fu, fu[0]));
    n0 = scl(n0, 1 / (norm(n0) + 1e-12));
    const b = cross(f, n0), inward = this.side === 'left' ? -1 : 1;
    return Math.atan2(inward * dot(n, b), dot(n, n0));
  }
  idx(i, j, k, r) {
    const [, ny, nz, nr] = this.shape;
    return ((i * ny + j) * nz + k) * nr + r;
  }
  cells(p, Rs) {
    const t = this.locate(p), nr = this.rolls.length;
    const rf = pymod(this.rollOf(Rs), TAU) / TAU * nr;
    const r0 = pymod(Math.floor(rf), nr), wr = rf - Math.floor(rf);
    const idx0 = [0, 1, 2].map((a) => clamp(Math.floor(t[a]), 0, Math.max(this.shape[a] - 2, 0)));
    const f = [0, 1, 2].map((a) => clamp(t[a] - idx0[a], 0, 1));
    const out = [];
    for (const [r, wrr] of [[r0, 1 - wr], [(r0 + 1) % nr, wr]]) {
      if (wrr <= 0) continue;
      for (const di of [0, 1]) for (const dj of [0, 1]) for (const dk of [0, 1]) {
        const w = wrr * ((di ? f[0] : 1 - f[0]) * (dj ? f[1] : 1 - f[1]) * (dk ? f[2] : 1 - f[2]));
        if (w <= 1e-9) continue;
        out.push([this.idx(Math.min(idx0[0] + di, this.shape[0] - 1),
                           Math.min(idx0[1] + dj, this.shape[1] - 1),
                           Math.min(idx0[2] + dk, this.shape[2] - 1), r), w]);
      }
    }
    return out;
  }
  qAt(c) { return Array.from(this.q.subarray(c * this.nq, (c + 1) * this.nq)); }
  lookup(p, Rs) {
    const cells = this.cells(p, Rs), nq = this.nq;
    let q;
    if (!cells.length) q = this.qAt(0);
    else {
      let a = cells[0];
      for (const c of cells) if (c[1] > a[1]) a = c;
      const q0 = this.qAt(a[0]), acc = new Array(nq).fill(0);
      let ws = 0;
      for (const [c, w] of cells) {
        const qc = this.qAt(c);
        let mx = 0;
        for (let k = 0; k < nq; k++) mx = Math.max(mx, Math.abs(qc[k] - q0[k]));
        if (mx > this.tol) continue;
        for (let k = 0; k < nq; k++) acc[k] += w * qc[k];
        ws += w;
      }
      q = ws > 1e-9 ? acc.map((v) => v / ws) : q0;
    }
    let fa = 0, fw = 0;
    for (const [c, w] of cells) { fa += w * this.feas[c]; fw += w; }
    return [q, fw > 1e-9 ? fa / fw : 1];
  }
}

class DirectionalReach {
  constructor(R) { this.dirs = R.dirs; this.reach = R.reach; this.scalar = R.scalar; }
  at(u, k = 3) {
    if (!this.reach.length) return this.scalar;
    const n = norm(u);
    if (n < 1e-9) return this.scalar;
    const un = scl(u, 1 / n);
    const c = this.dirs.map((d) => dot(d, un));
    const order = c.map((v, i) => i).sort((a, b) => c[b] - c[a]).slice(0, Math.min(k, c.length));
    let ws = 0, acc = 0;
    for (const i of order) { const w = Math.max(c[i], 0) ** 4; ws += w; acc += w * this.reach[i]; }
    if (ws < 1e-9) return this.reach[order[0]];
    return acc / ws;
  }
}

// ── arm.py ArmRetargeter ─────────────────────────────────────────────────────
class ArmIK {
  constructor(kin, D, side) {
    const S = D.sides[side], hp = D.hp;
    this.kin = kin; this.hp = hp; this.side = side;
    this.joints = [1, 2, 3, 4, 5, 6, 7].map((i) => `${CAP[side]} Arm ${i}`)
      .concat([`${CAP[side]} Wrist`]);
    this.lo = S.lo.slice(); this.hi = S.hi.slice(); this.q_nom = S.q_nom.slice();
    this.reg_w = S.reg_w.slice(); this.R_rob = S.R_rob;
    this.w_orient_max = S.w_orient_max; this.w_orient_min = S.w_orient_min;
    this.w_orient = this.w_orient_max; this.w_orient_fwd = S.w_orient_fwd;
    this.w_elbow = S.w_elbow; this.trust_rate_distal = S.trust_rate_distal;
    this.table = S.table ? new PostureTable(S.table, side) : null;
    const a = ABBR[side];
    this.b_elbow = kin.bix[`${a}_elbow`]; this.b_mount = kin.bix[`${a}_arm_mount`];
    this.b_palm = kin.bix[`${side}_palm`];
    this.wristJ = `${CAP[side]} Wrist`; this.arm1 = `${CAP[side]} Arm 1`;
    this.reset();
  }
  reset() {
    this.last_q = this.q_nom.slice(); this._warm = false; this._stuck = 0;
    this._prev_contact = null; this._last_dt = null; this._steer_q = null;
    this.q_ref = this.q_nom.slice(); this._tab_q = null; this._tab_feas = 1;
    this.base = null;
  }
  sync(qData) { this.base = { ...qData }; }
  fk(q) {
    const m = { ...this.base };
    for (let i = 0; i < this.joints.length; i++) m[this.joints[i]] = q[i];
    return this.kin.fk(m);
  }
  kps(q) {
    const F = this.fk(q);
    const Rp = mm(F.body[this.b_palm].R, this.R_rob);
    return { F, elbow: F.body[this.b_elbow].p, contact: F.anchor[this.wristJ],
             sh: F.body[this.b_mount].p, fwd: col(Rp, 0), up: col(Rp, 2), Rp };
  }
  regFor(hk) {
    const sw = hk.swivel;
    if (sw === null || sw === undefined || this.reg_w.length < 3) return this.reg_w;
    const reg = this.reg_w.slice();
    reg[2] *= Math.max(this.hp.ARM_REG_ELBOW_RELAX, 1 - Math.abs(sw));
    return reg;
  }
  wElbow(hk) {
    const boost = 1 + this.hp.ARM_ELBOW_SWIVEL_BOOST * Math.abs(hk.swivel || 0);
    return this.w_elbow * boost * (hk.elbow_w_scale !== undefined ? hk.elbow_w_scale : 1);
  }
  cost(q, hk, qPrev) {
    const k = this.kps(q), hp = this.hp;
    const dc = sub(k.contact, hk.contact);
    let loss = hp.ARM_W_WRIST * dot(dc, dc);
    if (hk.elbow) {
      let ed = sub(k.elbow, k.sh), hed = sub(hk.elbow, k.sh);
      ed = scl(ed, 1 / (norm(ed) + 1e-9)); hed = scl(hed, 1 / (norm(hed) + 1e-9));
      loss += this.wElbow(hk) * (1 - dot(ed, hed));
    }
    loss += this.w_orient_fwd * (1 - dot(k.fwd, hk.fwd));
    loss += this.w_orient * (1 - dot(k.up, hk.up));
    const reg = this.regFor(hk);
    for (let i = 0; i < q.length; i++) {
      const s = q[i] - qPrev[i], r = q[i] - this.q_ref[i];
      loss += hp.ARM_W_SMOOTH * s * s + reg[i] * r * r;
    }
    return loss;
  }
  taskCost(q, hk) {
    const k = this.kps(q), dc = sub(k.contact, hk.contact);
    return this.hp.ARM_W_WRIST * dot(dc, dc) + this.w_orient_fwd * (1 - dot(k.fwd, hk.fwd))
      + this.w_orient * (1 - dot(k.up, hk.up));
  }
  /* stacked weighted residuals + analytic Jacobian (arm._residuals) */
  residuals(q, hk, qPrev) {
    const k = this.kps(q), F = k.F, n = q.length, hp = this.hp;
    const r = [], J = [];
    const jac = (point, body) => {                   // mj_jac, translational, opt dofs
      const on = new Set(this.kin.path[body]);
      return this.joints.map((jn) => (on.has(jn)
        ? cross(F.axis[jn], sub(point, F.anchor[jn])) : [0, 0, 0]));
    };
    const jacr = (body) => {
      const on = new Set(this.kin.path[body]);
      return this.joints.map((jn) => (on.has(jn) ? F.axis[jn] : [0, 0, 0]));
    };
    const pushRows = (res, cols, w) => {             // cols: n columns of 3-vectors
      for (let a = 0; a < 3; a++) {
        r.push(w * res[a]);
        J.push(cols.map((c) => w * c[a]));
      }
    };
    const wbody = this.kin.jbody[this.wristJ];
    let sw = Math.sqrt(hp.ARM_W_WRIST);
    pushRows(sub(k.contact, hk.contact), jac(k.contact, wbody), sw);
    if (hk.elbow) {
      const dv = sub(k.elbow, k.sh), dist = norm(dv);
      if (dist > 1e-9) {
        const ed = scl(dv, 1 / dist);
        let hed = sub(hk.elbow, k.sh);
        hed = scl(hed, 1 / (norm(hed) + 1e-9));
        const Je = jac(k.elbow, this.b_elbow).map((c) =>
          scl(sub(c, scl(ed, dot(ed, c))), 1 / dist));          // (I − ê êᵀ)/dist · J
        sw = Math.sqrt(this.wElbow(hk) / 2);
        pushRows(sub(ed, hed), Je, sw);
      }
    }
    const Jr = jacr(this.b_palm);
    for (const [axis, key, w] of [[k.fwd, 'fwd', this.w_orient_fwd], [k.up, 'up', this.w_orient]]) {
      sw = Math.sqrt(w / 2);
      pushRows(sub(axis, hk[key]), Jr.map((c) => cross(c, axis)), sw);
    }
    const sws = Math.sqrt(hp.ARM_W_SMOOTH);
    for (let i = 0; i < n; i++) {
      r.push(sws * (q[i] - qPrev[i]));
      const row = new Array(n).fill(0); row[i] = sws; J.push(row);
    }
    const reg = this.regFor(hk);
    for (let i = 0; i < n; i++) {
      const s = Math.sqrt(reg[i]);
      r.push(s * (q[i] - this.q_ref[i]));
      const row = new Array(n).fill(0); row[i] = s; J.push(row);
    }
    return [r, J];
  }
  solveGN(hk, qPrev, lo, hi, iters) {
    if (iters === undefined) iters = this.hp.ARM_GN_ITERS;
    let q = qPrev.map((v, i) => clamp(v, lo[i], hi[i]));
    const n = q.length, lam = this.hp.ARM_GN_DAMPING;
    for (let it = 0; it < iters; it++) {
      const [r, J] = this.residuals(q, hk, qPrev);
      const H = [], g = new Array(n).fill(0);
      for (let a = 0; a < n; a++) {
        H.push(new Array(n).fill(0));
        for (let b = 0; b < n; b++) {
          let s = 0;
          for (let k = 0; k < r.length; k++) s += J[k][a] * J[k][b];
          H[a][b] = s + (a === b ? lam : 0);
        }
        let s = 0;
        for (let k = 0; k < r.length; k++) s += J[k][a] * r[k];
        g[a] = s;
      }
      const dq = solve(H, g.map((v) => -v));
      const qn = q.map((v, i) => clamp(v + dq[i], lo[i], hi[i]));
      const isAct = (v, i) => v <= lo[i] + 1e-12 || v >= hi[i] - 1e-12;
      let act = qn.map(isAct);
      for (let pass = 0; pass < 3; pass++) {
        const na = act.filter(Boolean).length;
        if (na === 0 || na === n) break;
        const F = [], Aa = [];
        act.forEach((a, i) => (a ? Aa : F).push(i));
        const dqa = Aa.map((i) => qn[i] - q[i]);
        const rhs = F.map((i) => {
          let s = g[i];
          Aa.forEach((j, t) => { s += H[i][j] * dqa[t]; });
          return -s;
        });
        const dqf = solve(F.map((i) => F.map((j) => H[i][j])), rhs);
        F.forEach((i, t) => { qn[i] = clamp(q[i] + dqf[t], lo[i], hi[i]); });
        const an = qn.map(isAct);
        if (an.every((v, i) => v === act[i])) break;
        act = an;
      }
      let step = 0;
      for (let i = 0; i < n; i++) step = Math.max(step, Math.abs(qn[i] - q[i]));
      q = qn;
      if (step < 1e-5) break;
    }
    return q;
  }
  trustStep(dt) {
    const hp = this.hp, n = this.lo.length;
    if (hp.ARM_TRUST_STEP <= 0) return new Array(n).fill(0);
    if (dt === null || dt === undefined || !(dt > 0)) return new Array(n).fill(hp.ARM_TRUST_STEP);
    return this.lo.map((_, i) => Math.min(
      (i >= hp.ARM_TRUST_DISTAL_FROM ? this.trust_rate_distal : hp.ARM_TRUST_RATE) * dt,
      hp.ARM_TRUST_MAX));
  }
  tableLookup(hk) {
    if (!this.table) return null;
    const F = this.kin.fk(this.base);
    const Rc = this.chassisR, Rm = F.body[this.b_mount].R, p0 = F.anchor[this.arm1];
    const Rf = mm(mm([[-1, 0, 0], [0, -1, 0], [0, 0, 1]], tr(Rc)), Rm);
    const toS = (v) => mv(Rf, mtv(Rm, v));
    const ps = toS(sub(hk.contact, p0));
    if (!this.table.inside(ps, 0.02)) return null;
    const fwd = toS(hk.fwd), nrm = toS(hk.up);
    const sa = cross(nrm, fwd), n = norm(sa);
    if (n < 1e-6) return null;
    const [q, feas] = this.table.lookup(ps, fromCols(fwd, scl(sa, 1 / n), nrm));
    this.w_orient = this.w_orient_min + (this.w_orient_max - this.w_orient_min) * feas;
    this._tab_feas = feas;
    return q.map((v, i) => clamp(v, this.lo[i], this.hi[i]));
  }
  tableSteer(q, hk) {
    if (this._tab_q === null || this._steer_q !== null) return q;
    const cWarm = this.taskCost(q, hk);
    if (this.taskCost(this._tab_q, hk) >= cWarm) return q;
    const qt = this.hp.ARM_TABLE_REFINE > 0
      ? this.solveGN(hk, this._tab_q, this.lo, this.hi, this.hp.ARM_TABLE_REFINE) : this._tab_q;
    let mx = 0;
    for (let i = 0; i < q.length; i++) mx = Math.max(mx, Math.abs(qt[i] - q[i]));
    if (this.taskCost(qt, hk) < this.hp.ARM_TABLE_MARGIN * cWarm && mx > 0.05) {
      this._steer_q = qt;
      const s = this.trustStep(this._last_dt);
      return this.last_q.map((v, i) => clamp(v + clamp(qt[i] - v, -s[i], s[i]), this.lo[i], this.hi[i]));
    }
    return q;
  }
  basinEscape(q, hk) {
    const hp = this.hp;
    if (hp.ARM_ESCAPE_ERR <= 0) return q;
    const tgt = hk.contact;
    if (this._prev_contact === null || norm(sub(tgt, this._prev_contact)) > 0.010) {
      this._prev_contact = tgt.slice(); this._stuck = 0; this._steer_q = null;
      return q;
    }
    this._stuck += 1;
    if (this._steer_q !== null) {
      const s = this.trustStep(this._last_dt);
      const qn = this.last_q.map((v, i) =>
        clamp(v + clamp(this._steer_q[i] - v, -s[i], s[i]), this.lo[i], this.hi[i]));
      let mx = 0;
      for (let i = 0; i < qn.length; i++) mx = Math.max(mx, Math.abs(qn[i] - this._steer_q[i]));
      if (mx < 1e-3) this._steer_q = null;
      return qn;
    }
    if (this._stuck < hp.ARM_ESCAPE_FRAMES || this._stuck % hp.ARM_ESCAPE_FRAMES) return q;
    const qBent = this.q_nom.slice();
    if (qBent.length > 3) {
      const lo4 = this.lo[3], hi4 = this.hi[3];
      qBent[3] = 0.6 * (Math.abs(lo4) > Math.abs(hi4) ? lo4 : hi4);
    }
    const cands = [this.q_nom, qBent].map((s) => this.solveGN(hk, s, this.lo, this.hi, 25));
    let qCold = cands[0], cBest = this.cost(cands[0], hk, cands[0]);
    const c1 = this.cost(cands[1], hk, cands[1]);
    if (c1 < cBest) { qCold = cands[1]; cBest = c1; }
    const cWarm = this.cost(q, hk, q);
    let mx = 0;
    for (let i = 0; i < q.length; i++) mx = Math.max(mx, Math.abs(qCold[i] - q[i]));
    if (cBest < 0.98 * cWarm - 1e-4 && mx > 0.05) this._steer_q = qCold;
    return q;
  }
  solveArm(hk, dt) {
    this.w_orient = this.w_orient_max;
    this._tab_q = this.tableLookup(hk);
    this.q_ref = this._tab_q === null ? this.q_nom.slice()
      : this.q_nom.map((v, i) => v + this.hp.ARM_TABLE_REG * (this._tab_q[i] - v));
    let q = this.solveGN(hk, this.last_q, this.lo, this.hi);
    this._last_dt = dt;
    const s = this.trustStep(dt);
    if (s.some((v) => v > 0) && this._warm)
      q = q.map((v, i) => clamp(v, this.last_q[i] - s[i], this.last_q[i] + s[i]));
    q = this.tableSteer(q, hk);
    q = this.basinEscape(q, hk);
    this.last_q = q; this._warm = true;
    return q;                                         // 7 arm joints + ORCA wrist
  }
}

// ── the deployed gateway's neck rule (head vs the first steady head) ─────────
class GatewayNeck {
  constructor(N) { this.N = N; this.reset(); }
  reset() { this.R0 = null; this.t_first = null; this.t_last = null; }
  apply(head, now) {
    const N = this.N;
    if (!head || (head.trackingState || 'normal') !== 'normal') {
      if (this.t_last !== null && now - this.t_last > N.lost_s) this.reset();
      return null;
    }
    const m = head.transform && head.transform.matrix;
    if (!m || m.length !== 16) return null;
    const R = rot4(mat4(m));
    if (this.t_last !== null && now - this.t_last > N.lost_s) this.reset();
    this.t_last = now;
    if (this.t_first === null) this.t_first = now;
    if (this.R0 === null) {
      if (now - this.t_first < N.anchor_hold) return null;
      this.R0 = R;
    }
    const A = N.AVP_TO_ROBOT, dR = mm(mm(A, mm(R, tr(this.R0))), tr(A));
    const yaw = Math.atan2(dR[1][0], dR[0][0]);
    const pitch = -Math.asin(clamp(dR[2][0], -1, 1));
    const roll = Math.atan2(dR[2][1], dR[2][2]);
    return { neck_yaw: N.gain * N.signs[0] * yaw, neck_pitch: N.gain * N.signs[1] * pitch,
             neck_roll: N.gain * N.signs[2] * roll };
  }
}

// ── the self-collision projector (collision.py + capsule_guard.py) ───────────
/* Closest points between segments p1q1 and p2q2 (capsule_guard._seg_seg,
   Ericson RTCD 5.1.9). */
function segSeg(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), eps = 1e-12;
  let s, t;
  if (a <= eps && e <= eps) return [p1, p2];
  if (a <= eps) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e <= eps) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > eps ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  return [add(p1, scl(d1, s)), add(p2, scl(d2, t))];
}

/* min ½|x − x0|²  s.t.  A x ≤ b — what solve_qp asks quadprog for here
   (H = I + 1e-9·I, a uniform metric, so the answer is the Euclidean
   projection of x0/(1 + 1e-9) onto the polytope; it is UNIQUE, so any exact
   method lands on quadprog's point). Goldfarb–Idnani dual active set, the
   algorithm quadprog implements, with the active normals re-factored by
   Gram–Schmidt at each change (n = 16: cheap). Returns null if infeasible. */
function projectPolytope(x0, A, b) {
  const n = x0.length, m = A.length;
  const N = A.map((a) => a.map((v) => -v)), bb = b.map((v) => -v);     // n_i·x ≥ b'_i
  let x = x0.slice(), act = [], u = [];
  const dotn = (a, c) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * c[i]; return s; };
  function factor() {                          // Q1 (q columns), R (q×q upper)
    const Q = [], R = act.map(() => new Array(act.length).fill(0));
    act.forEach((k, j) => {
      let v = N[k].slice();
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < Q.length; i++) {
          const c = dotn(Q[i], v);
          R[i][j] += c;
          for (let t = 0; t < n; t++) v[t] -= c * Q[i][t];
        }
      const nv = Math.sqrt(dotn(v, v));
      R[j][j] = nv;
      Q.push(v.map((t) => t / (nv || 1)));
    });
    return { Q, R };
  }
  for (let outer = 0; outer < 4 * (m + n) + 20; outer++) {
    let p = -1, sp = -1e-12;
    for (let i = 0; i < m; i++) {
      if (act.includes(i)) continue;
      const s = dotn(N[i], x) - bb[i];
      if (s < sp) { sp = s; p = i; }
    }
    if (p < 0) return x;
    let up = [...u, 0];
    for (let inner = 0; inner < 4 * (m + n) + 20; inner++) {
      const { Q, R } = factor(), q = act.length, np = N[p];
      const d1 = Q.map((c) => dotn(c, np));
      const z = np.slice();
      for (let i = 0; i < q; i++) for (let t = 0; t < n; t++) z[t] -= d1[i] * Q[i][t];
      const r = new Array(q).fill(0);
      for (let i = q - 1; i >= 0; i--) {
        let s = d1[i];
        for (let k = i + 1; k < q; k++) s -= R[i][k] * r[k];
        r[i] = s / R[i][i];
      }
      let t1 = Infinity, kk = -1;
      for (let j = 0; j < q; j++) if (r[j] > 1e-14 && up[j] / r[j] < t1) { t1 = up[j] / r[j]; kk = j; }
      const zn = dotn(z, np);
      const t2 = dotn(z, z) > 1e-20 && zn > 1e-20 ? -(dotn(np, x) - bb[p]) / zn : Infinity;
      const t = Math.min(t1, t2);
      if (t === Infinity) return null;                         // infeasible
      if (t2 === Infinity) {                                   // pure dual step
        for (let j = 0; j < q; j++) up[j] -= t * r[j];
        up[q] += t;
        act.splice(kk, 1); up.splice(kk, 1);
        continue;
      }
      for (let i = 0; i < n; i++) x[i] += t * z[i];
      for (let j = 0; j < q; j++) up[j] -= t * r[j];
      up[q] += t;
      if (t === t2) { act.push(p); u = up; break; }
      act.splice(kk, 1); up.splice(kk, 1);
    }
  }
  return x;
}

class CollisionProjector {
  constructor(kin, SC) {
    this.kin = kin; this.SC = SC;
    this.caps = {};
    for (const [k, c] of Object.entries(SC.caps))
      this.caps[k] = { name: k, body: kin.bix[c.body], p0: c.p0, p1: c.p1, r: c.radius };
    this.pairs = SC.pairs.map(([a, b]) => [this.caps[a], this.caps[b]]);
    this.joints = SC.joints; this.lo = SC.lo; this.hi = SC.hi;
    this.lag = new Set(SC.lag_capsules);
    this.q_cmd = null; this.active = 0; this.fallbacks = 0;
  }
  margin(a, b) {
    const m = this.SC.pair_margin[`${a.name}|${b.name}`];
    return m === undefined ? this.SC.d_safe : m;
  }
  /* capsule_guard.SelfCollisionGuard.rows over this projector's 16 joints */
  rows(F, pad) {
    const SC = this.SC, G = [], h = [];
    const world = (c) => {
      const B = F.body[c.body];
      return [add(B.p, mv(B.R, c.p0)), add(B.p, mv(B.R, c.p1))];
    };
    const jac = (pt, body) => {
      const on = new Set(this.kin.path[body]);
      return this.joints.map((j) => (on.has(j) ? cross(F.axis[j], sub(pt, F.anchor[j])) : [0, 0, 0]));
    };
    for (const [ca, cb] of this.pairs) {
      const [a0, a1] = world(ca), [b0, b1] = world(cb);
      const [wa, wb] = segSeg(a0, a1, b0, b1);
      const sep = sub(wa, wb), L = norm(sep), d = L - ca.r - cb.r;
      if (d >= SC.d_inf) continue;
      const nn = L > 1e-9 ? scl(sep, 1 / L) : [0, 0, 1];
      const Ja = jac(wa, ca.body), Jb = jac(wb, cb.body);
      G.push(Ja.map((c, i) => -dot(nn, sub(c, Jb[i]))));
      const m = this.margin(ca, cb);
      const lag = !this.lag.size || this.lag.has(ca.name) || this.lag.has(cb.name);
      const slack = d - m - (m >= SC.d_safe && lag ? pad : 0);
      let cap = SC.alpha * slack;
      if (slack > 0) cap = Math.min(cap, Math.sqrt(2 * SC.stop_decel * slack));   // braking=True
      h.push(cap);
    }
    return [G, h];
  }
  /* ArmCollisionProjector.project: qDes {joint: rad} for the 16 joints */
  project(qDes, qData, Xdata, frameDt) {
    const SC = this.SC, J = this.joints, n = J.length;
    const dt = Math.max(frameDt, 1e-3), dtStep = Math.min(dt, 1 / 30);
    const des = J.map((j) => qDes[j]);
    if (!this.q_cmd) this.q_cmd = J.map((j) => qData[j]);
    const sc = { ...qData };
    J.forEach((j, i) => { sc[j] = this.q_cmd[i]; });
    const [Gc, hc] = this.rows(this.kin.fk(sc), 0);           // at the COMMAND pose
    const [Gm, hm] = this.rows(Xdata, SC.lag_pad);             // at the MEASURED pose
    const G = Gc.concat(Gm), h = hc.concat(hm);
    const stepMax = SC.vmax * dtStep;
    this.active = G.length;
    if (!G.length) {
      let mx = 0;
      for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(des[i] - this.q_cmd[i]));
      this.q_cmd = mx <= stepMax ? des.slice()
        : this.q_cmd.map((v, i) => v + clamp(des[i] - v, -stepMax, stepMax));
    } else {
      const qdDes = des.map((v, i) => (v - this.q_cmd[i]) / dt);
      const hiV = this.q_cmd.map((v, i) => Math.min((this.hi[i] - v) / dt, SC.vmax * dtStep / dt));
      const loV = this.q_cmd.map((v, i) => Math.max((this.lo[i] - v) / dt, -SC.vmax * dtStep / dt));
      const A = G.slice(), b = h.slice();
      for (let i = 0; i < n; i++) {
        const e = new Array(n).fill(0); e[i] = 1; A.push(e); b.push(hiV[i]);
      }
      for (let i = 0; i < n; i++) {
        const e = new Array(n).fill(0); e[i] = -1; A.push(e); b.push(-loV[i]);
      }
      const c = 1 + 1e-9;
      let qd = projectPolytope(qdDes.map((v) => v / c), A, b);
      if (!qd) {                       // quadprog refuses → (osqp →) the clamped optimum
        this.fallbacks++;
        qd = qdDes.map((v, i) => clamp(v / c, loV[i], hiV[i]));
      }
      if (!qd.every(Number.isFinite)) qd = new Array(n).fill(0);
      this.q_cmd = this.q_cmd.map((v, i) => v + qd[i] * dt);
    }
    const out = {};
    J.forEach((j, i) => { out[j] = this.q_cmd[i]; });
    return out;
  }
}

// ── wire.py operator_pose_from_teleop_frame + engine._payload ────────────────
function handWorld(hand) {
  if (!hand || !hand.isTracked) return null;
  const am = hand.anchorTransform && (hand.anchorTransform.matrix || hand.anchorTransform);
  if (!am || am.length < 16) return null;
  const anchor = mat4(am), local = {};
  for (const jp of hand.joints || []) {
    const lm = jp.localTransform && (jp.localTransform.matrix || jp.localTransform);
    if (lm && lm.length >= 16) local[jp.joint] = mat4(lm);
  }
  if (!local.wrist) return null;
  const world = {};
  for (const k of Object.keys(local)) world[k] = mul4(anchor, local[k]);
  const wrist = world.wrist;
  const mats = NAMES_21.map((n) => world[n] || wrist);
  return { mats, joints: world, forearm: world.forearm_arm || null };
}

// ── the engine ───────────────────────────────────────────────────────────────
export class DeployedRetargeter {
  constructor(D) {
    this.D = D; this.hp = D.hp; this.kin = new Kin(D);
    this.chassis = { p: D.chassis.pos, R: D.chassis.R };
    this.arm = {};
    for (const s of SIDES) { this.arm[s] = new ArmIK(this.kin, D, s); this.arm[s].chassisR = this.chassis.R; }
    this.reach = { right: D.sides.right.reach, left: D.sides.left.reach };
    this.reachDir = D.hp.ARM_REACH_DIRECTIONAL
      ? { right: new DirectionalReach(D.sides.right.reach_dir),
          left: new DirectionalReach(D.sides.left.reach_dir) } : null;
    this.slewKey = {};
    for (const s of SIDES) for (let i = 1; i <= 7; i++) this.slewKey[`${CAP[s]} Arm ${i}`] = ['arm', i - 1];
    this.slewKey.Torso = ['torso', null];
    for (const j of ['Neck Yaw', 'Neck Pitch', 'Neck Roll']) this.slewKey[j] = ['neck', null];
    this.limits = {};
    for (const b of D.bodies) if (b.joint) this.limits[b.joint.name] = b.joint;
    this.reset();
  }

  /* the lab's reset (pool.reset) on Engage: a fresh engine, the robot at the
     home keyframe */
  reset() {
    const D = this.D;
    this.q = { ...D.home };                       // data.qpos (torso, arms, wrists)
    this.ctrl = { ...D.home };                    // data.ctrl, servo targets = pose
    this.X = this.kin.fk(this.q);                 // data.xpos after the last step
    for (const s of SIDES) this.arm[s].reset();
    this.shoulder = new ShoulderEstimator(this.hp);
    this.heading = null; this._face_forward = false;
    this._world_ref = null; this._head_prev = null; this._stable_since = null;
    this._frame_dt = 1 / 60; this._prev_t = null; this._calibrated = false;
    this._ws_offset = [0, 0, 0]; this._ws = [0, 0]; this._ws_base_prev = null;
    this._elbow_ema = {}; this._swivel = {}; this._frame_M = this.hp.AVP_TO_ROBOT;
    this._frame_dh = null;
    this.proj = D.selfcol ? new CollisionProjector(this.kin, D.selfcol) : null;
    this._neck_ref = null; this._head0 = null;
    // wbc: torso controller + base tracker anchor (head offset only)
    this._base_anchored = false; this._trk_head0 = null; this._byaw0 = null;
    this.neckRule = new GatewayNeck(D.deploy.neck); this._neck_out = [0, 0, 0];
    this.targets = {}; this.hk = {}; this.n = 0;
  }

  recalibrate(face) {
    this._world_ref = null; this._head0 = null; this._neck_ref = null;
    this._base_anchored = false;
    if (face) this._face_forward = true;
  }

  _pose(frame) {
    const h = frame.head;
    let head = null;
    if (h && typeof h === 'object' && (h.trackingState || 'normal') === 'normal') {
      const m = h.transform && (h.transform.matrix || h.transform);
      if (m && m.length >= 16) head = mat4(m);
    }
    const p = { head_mat: head };
    for (const side of SIDES) {
      const hw = handWorld(frame[side + 'Hand']);
      p[side + '_hand_mats'] = hw ? hw.mats : null;
      p[side + '_joints'] = hw ? hw.joints : null;
      const e = frame[side + 'Elbow'];
      const em = e && (e.matrix || e);
      p[side + '_elbow'] = em && em.length >= 16 ? mat4(em) : (hw ? hw.forearm : null);
    }
    p.head_height = head ? head[1][3] : null;
    // HEADING_MODE "head": the lazy-neck body yaw (engine._payload)
    if (!this.heading) this.heading = new LazyHeadHeading(this.hp);
    if (head && (this._face_forward || this.heading.psi_b === null)) {
      this.heading.calibrate(head); this._face_forward = false;
    }
    p.body_yaw = this.heading.update(head, this._frame_dt || 1 / 60);
    if (!this.hp.ARM_TRACK_ELBOW) { p.right_elbow = null; p.left_elbow = null; }
    return p;
  }

  _bodyMap() {
    const hp = this.hp;
    if (!hp.ARM_BODY_FRAME_MAP || !this.shoulder._axes) return hp.AVP_TO_ROBOT;
    const [r, u, f] = this.shoulder._axes;
    const Bop = fromCols(r, u, f);
    const W = mm(this.chassis.R, hp.R_BASE_ALIGN);
    const Rr = fromCols(scl(col(W, 1), -1), col(W, 2), col(W, 0));
    return mm(Rr, tr(Bop));
  }

  _shoulderR(side) { return this.X.body[this.kin.bix[`${ABBR[side]}_arm_mount`]].p; }

  _mapTargets(p) {
    const hp = this.hp, raw = {};
    for (const side of SIDES) {
      const hm = p[side + '_hand_mats'];
      if (hm) raw[side] = pos4(hm[hp.ARM_TRACK_WRIST ? 0 : 12]);
    }
    const out = {};
    const M = this._bodyMap();
    this._frame_M = M;
    this._frame_dh = raw.right && raw.left ? norm(sub(raw.right, raw.left)) : null;
    const rootH = this.shoulder.root();
    let rootR = rootH ? scl(add(this._shoulderR('right'), this._shoulderR('left')), 0.5) : null;
    if (rootR && hp.ARM_WS_ASSIST !== undefined) rootR = add(rootR, this._ws_offset);
    for (const side of Object.keys(raw)) {
      const w = raw[side];
      if (!this.shoulder.ready(side)) continue;
      const sH = this.shoulder._sh[side], rv = sub(w, sH), d = norm(rv);
      if (d < 1e-6) continue;
      const Lh = Math.max(this.shoulder.armLength(side), 1e-6);
      const rho = Math.min(d / Lh, hp.ARM_EXT_RHO_MAX);
      const s = clamp((rho - hp.ARM_GMR_EXT_GATE) / Math.max(1 - hp.ARM_GMR_EXT_GATE, 1e-6), 0, 1);
      const lam = s * s * (3 - 2 * s);
      const od = 1 + (hp.ARM_EXT_OVERDRIVE - 1) * lam;
      const sR = this._shoulderR(side);
      if (rootH) {
        const sigma = this.reach[side] / Lh;
        const tRaw = add(rootR, scl(mv(M, sub(w, rootH)), sigma));
        const dv = sub(tRaw, sR), dn = norm(dv);
        if (dn < 1e-6) continue;
        const Lr = this.reachDir ? this.reachDir[side].at(scl(dv, 1 / dn)) : this.reach[side];
        const mag = (1 - lam) * dn + lam * (rho * Lr * od);
        out[side] = add(sR, scl(dv, mag / dn));
      } else {
        const u = mv(M, scl(rv, 1 / d));
        const Lr = this.reachDir ? this.reachDir[side].at(u) : this.reach[side];
        out[side] = add(sR, scl(u, rho * Lr * od));
      }
    }
    if (hp.ARM_BIMANUAL_BLEND && out.right && out.left) {
      const dH = sub(raw.right, raw.left), dist = norm(dH);
      if (dist < hp.ARM_BIMANUAL_NEAR) {
        let w = 1 - (dist - hp.ARM_BIMANUAL_FULL) / Math.max(hp.ARM_BIMANUAL_NEAR - hp.ARM_BIMANUAL_FULL, 1e-6);
        w = clamp(w, 0, 1); w = w * w * (3 - 2 * w);
        const mid = scl(add(out.right, out.left), 0.5), dR = mv(M, dH);
        out.right = add(scl(out.right, 1 - w), scl(add(mid, scl(dR, 0.5)), w));
        out.left = add(scl(out.left, 1 - w), scl(sub(mid, scl(dR, 0.5)), w));
      }
      const floor = Math.min(hp.ARM_HAND_CLEAR, dist);
      const sep = sub(out.right, out.left), dr = norm(sep);
      if (dr < floor) {
        const axis = dr > 1e-6 ? scl(sep, 1 / dr) : mv(M, scl(dH, 1 / dist));
        const mid = scl(add(out.right, out.left), 0.5);
        out.right = add(mid, scl(axis, 0.5 * floor));
        out.left = sub(mid, scl(axis, 0.5 * floor));
      }
    }
    const o = this.chassis.p, Rc = this.chassis.R;
    for (const side of Object.keys(out)) {
      const loc = mtv(Rc, sub(out[side], o));            // clamp_in_front
      if (loc[0] > hp.ARM_WRIST_FRONT) { loc[0] = hp.ARM_WRIST_FRONT; out[side] = add(o, mv(Rc, loc)); }
      const sh = this._shoulderR(side), shO = this._shoulderR(side === 'left' ? 'right' : 'left');
      if (hp.ARM_MIN_TORSO_RADIUS > 0) {
        const axis = scl(add(sh, shO), 0.5);
        out[side] = clampTorsoStandoff(out[side], axis, hp.ARM_MIN_TORSO_RADIUS, sub(sh, shO));
      }
      if (hp.ARM_MIN_SHOULDER_RADIUS > 0) out[side] = clampShoulderStandoff(out[side], sh, hp.ARM_MIN_SHOULDER_RADIUS);
    }
    if (hp.ARM_WS_ASSIST && Object.keys(out).length) this._ws_offset = this._wsUpdate(out);
    return out;
  }

  /* workspace_assist.WorkspaceAssist.update (the base never moves here) */
  _wsUpdate(targets) {
    const hp = this.hp, Rc = this.chassis.R, dt = this._frame_dt || 1 / 60;
    const radii = [], lat = [];
    for (const side of Object.keys(targets)) {
      const v = sub(targets[side], this._shoulderR(side));
      radii.push(norm(v)); lat.push(mtv(Rc, v)[1]);
    }
    const d = [0, 0];
    if (radii.length) {
      const near = hp.ARM_WS_NEAR - Math.min(...radii), far = Math.max(...radii) - hp.ARM_WS_FAR;
      if (near > hp.ARM_WS_DEADBAND) d[0] = -near;
      else if (far > hp.ARM_WS_DEADBAND) d[0] = far;
      const ml = lat.reduce((a, b) => a + b, 0) / lat.length;
      if (Math.abs(ml) > hp.ARM_WS_LATERAL + hp.ARM_WS_DEADBAND) d[1] = -(ml - Math.sign(ml) * hp.ARM_WS_LATERAL);
    }
    const step = hp.ARM_WS_RATE * dt;
    let del = [d[0] - this._ws[0], d[1] - this._ws[1]];
    let n = Math.hypot(del[0], del[1]);
    if (n > step) del = [del[0] * step / n, del[1] * step / n];
    this._ws = [this._ws[0] + del[0], this._ws[1] + del[1]];
    n = Math.hypot(this._ws[0], this._ws[1]);
    if (n > hp.ARM_WS_MAX_OFFSET) this._ws = [this._ws[0] * hp.ARM_WS_MAX_OFFSET / n, this._ws[1] * hp.ARM_WS_MAX_OFFSET / n];
    return mv(Rc, [this._ws[0], this._ws[1], 0]);
  }

  _solveSide(side, p, contact) {
    const hp = this.hp, hm = p[side + '_hand_mats'];
    if (!hm) return null;
    const Rop = operatorFrame(p[side + '_joints'], hm);
    if (!Rop || !contact) return null;
    const M = this._frame_M;
    const Rpc = mm(M, Rop);
    let elbow = null, wScale = 1;
    const e = p[side + '_elbow'];
    if (e) {
      const ePos = pos4(e);
      if (this.shoulder.ready(side)) {
        const wH = pos4(hm[0]), dvec = sub(ePos, wH), nd = norm(dvec);
        if (nd > 1e-6) {
          const Lop = this.shoulder.armLength(side);
          const eRec = add(wH, scl(dvec, (1 - 0.56) * Lop / nd));
          let ema = this._elbow_ema[side];
          ema = ema ? add(ema, scl(sub(eRec, ema), hp.ARM_ELBOW_TRACK_EMA)) : eRec.slice();
          this._elbow_ema[side] = ema;
          const sH = this.shoulder._sh[side];
          elbow = add(this._shoulderR(side), mv(M, sub(ema, sH)));
          const uu = sub(ema, sH), uf = sub(wH, ema), nu = norm(uu), nf = norm(uf);
          if (nu > 1e-6 && nf > 1e-6) {
            const bend = Math.acos(clamp(dot(scl(uu, 1 / nu), scl(uf, 1 / nf)), -1, 1));
            wScale = clamp(bend / hp.ARM_ELBOW_BEND_REF, hp.ARM_ELBOW_W_MIN, 1);
          }
        }
      }
    } else if (hp.ARM_SYNTH_ELBOW && this.shoulder.ready(side)
               && (this._frame_dh === null || this._frame_dh > hp.ARM_BIMANUAL_NEAR)) {
      const wH = pos4(hm[0]), sH = this.shoulder._sh[side];
      let phi = this._swivel[side] || 0;
      phi += 0.10 * (0 - phi);                       // ARM_SWIVEL_PALM_GAIN = 0
      this._swivel[side] = phi;
      const eS = synthElbow(sH, wH, this.shoulder.armLength(side), phi, side, this.shoulder._axes, hp);
      if (eS) elbow = add(this._shoulderR(side), mv(M, sub(eS, sH)));
    }
    if (elbow && hp.ARM_ELBOW_ABDUCT > 0) {       // the 0.15 m upper-arm standoff
      const sMe = this._shoulderR(side), sOt = this._shoulderR(side === 'right' ? 'left' : 'right');
      const o = sub(sMe, sOt); o[2] = 0;
      const no = norm(o);
      if (no > 1e-6) elbow = add(elbow, scl(o, hp.ARM_ELBOW_ABDUCT / no));
    }
    const fwd = col(Rpc, 0);
    let up = col(Rpc, 2);
    if (side === 'left') up = scl(up, -1);         // palm_axes: left normal -> palmar
    const sw = (!e && elbow) ? (this._swivel[side] !== undefined ? this._swivel[side] : null) : null;
    const hk = { contact, elbow, fwd, up, swivel: sw, elbow_w_scale: wScale };
    this.hk[side] = hk;
    const a = this.arm[side];
    a.sync(this.q);
    return a.solveArm(hk, this._frame_dt);
  }

  _project(sol) {
    const des = {};
    for (const s of SIDES) {
      const js = this.arm[s].joints;
      for (let i = 0; i < 8; i++) des[js[i]] = sol[s] ? sol[s][i] : this.q[js[i]];
    }
    return this.proj.project(des, this.q, this.X, this._frame_dt);
  }

  /* the engine's OWN neck (engine._retarget): head on the latched torso datum,
     plus the torso's deviation on the pitch (gaze compensation). It is not what
     the robot commands — its neck is the gateway rule, below — but the head
     capsule of the self-collision guard rides it. */
  _engineNeck(H) {
    if (!H) return;
    const EN = this.D.engine_neck, A = this.hp.AVP_TO_ROBOT;
    if (this._neck_ref === null && this.shoulder._axes) {
      const [r, u, f] = this.shoulder._axes;
      this._neck_ref = fromCols(r, u, scl(f, -1));
    }
    let ref = this._neck_ref;
    if (EN.datum_live && this.shoulder._axes) {
      const [r, u, f] = this.shoulder._axes; ref = fromCols(r, u, scl(f, -1));
    }
    if (!ref && this._head0) ref = rot4(this._head0);
    if (!ref) return;
    const dR = mm(mm(A, mm(rot4(H), tr(ref))), tr(A));
    const na = [Math.atan2(dR[1][0], dR[0][0]), -Math.asin(clamp(dR[2][0], -1, 1)),
                Math.atan2(dR[2][1], dR[2][2])].map((v, i) => EN.gain * EN.signs[i] * v);
    na[1] += this.q.Torso - EN.torso_rest;
    ['Neck Yaw', 'Neck Pitch', 'Neck Roll'].forEach((j, i) => {
      this.ctrl[j] = clamp(na[i], this.D.neck_range[i][0], this.D.neck_range[i][1]);
    });
  }

  /* wholebody.WholeBodyController.update_targets, torso half, local scope */
  _torso(headPos, bodyYaw) {
    const hp = this.hp;
    if (!headPos || !(hp.BASE_FOLLOW || hp.TORSO_FOLLOW)) return;
    if (!this._base_anchored) {
      this._trk_head0 = headPos.slice();
      this._byaw0 = bodyYaw !== null && bodyYaw !== undefined ? bodyYaw : null;
      this._base_anchored = true;
    }
    let d = mv(hp.AVP_TO_ROBOT, sub(headPos, this._trk_head0));
    if (hp.BASE_TRANSLATION_MODE === 'body' && bodyYaw !== null && bodyYaw !== undefined) {
      if (this._byaw0 === null) this._byaw0 = bodyYaw;
      const a = wrap(bodyYaw - Math.PI), c = Math.cos(a), s = Math.sin(a);
      d = [c * d[0] + s * d[1], -s * d[0] + c * d[1], d[2]];
    }
    const fwd = -d[0];
    const L = hp.TORSO_LEAN_PIVOT;
    const drop = this._trk_head0[1] - headPos[1];
    const thDrop = Math.acos(clamp(1 - Math.max(drop, 0) / L, -1, 1));
    const dLean = fwd;                                 // LOCAL: all forward offset is lean
    const thFwd = Math.atan2(dLean, Math.max(L - Math.max(drop, 0), 0.2 * L));
    const thCap = Math.asin(clamp(Math.max(dLean, 0) / hp.TORSO_LEAN_PIVOT_MIN, 0, 1));
    const theta = Math.max(thFwd, Math.min(thDrop, thCap));
    this.lean = theta;
    if (hp.TORSO_FOLLOW) {
      const t0 = this.D.torso.qpos0, [lo, hi] = this.D.torso.range;
      const sd = Math.sign(theta) * Math.max(0, Math.abs(theta) - hp.TORSO_LEAN_DEADBAND);
      let tNew = clamp(t0 - hp.TORSO_LEAN_GAIN * sd, lo, hi);
      const cur = this.ctrl.Torso, step = hp.TORSO_FOLLOW_SPEED * this._frame_dt;
      tNew = cur + clamp(tNew - cur, -step, step);
      this.ctrl.Torso = tNew;
    }
  }

  /* One headset frame at clock `now` [s] (KinematicRetargeter.step). Returns
     what the robot is commanded: {q: {joint: rad}, neck: {...}} + diagnostics. */
  step(frame, now) {
    const hp = this.hp;
    const p = this._pose(frame);
    if (!this._calibrated && p.head_mat) { this.recalibrate(true); this._calibrated = true; }
    const dt = this._prev_t !== null ? now - this._prev_t : 1 / 60;
    this._frame_dt = clamp(dt, 1e-3, 0.1);
    this.targets = {}; this.hk = {};

    // ── engine._retarget ──
    const H = p.head_mat;
    let headPos = H ? pos4(H) : null;
    if (headPos) {
      if (this._head_prev && norm(sub(headPos, this._head_prev)) > hp.HEAD_JUMP_M) {
        this.recalibrate(true); this._stable_since = null;
      }
      this._head_prev = headPos.slice();
      if (this._stable_since === null) this._stable_since = now;
    }
    const stable = headPos && this._stable_since !== null && now - this._stable_since >= hp.HEAD_ANCHOR_HOLD;
    if (H && this._head0 === null && stable) this._head0 = H;
    if (this._world_ref === null && headPos) {
      if (stable) this._world_ref = headPos.slice();
      else headPos = null;
    }
    if (this._world_ref !== null) {
      if (headPos) {
        const wr = {};
        for (const s of SIDES) { const hm = p[s + '_hand_mats']; wr[s] = hm ? pos4(hm[0]) : null; }
        this.shoulder.update(H, p.body_yaw, wr);
      }
      const contacts = this._mapTargets(p);
      this.targets = contacts;
      const sol = {};
      for (const s of SIDES) {
        const r = this._solveSide(s, p, contacts[s] || null);
        if (r) sol[s] = r;
      }
      if (Object.keys(sol).length) {
        const cmd = hp.SELF_COLLISION && this.proj ? this._project(sol) : null;
        for (const s of Object.keys(sol)) {
          const js = this.arm[s].joints;
          for (let i = 0; i < 8; i++) this.ctrl[js[i]] = cmd ? cmd[js[i]] : sol[s][i];
        }
        if (cmd) for (const s of SIDES) {             // the wrist rides the projection too
          const wj = `${CAP[s]} Wrist`;
          if (sol[s]) this.ctrl[wj] = cmd[wj];
        }
      }
    }
    this._engineNeck(H);
    this._torso(headPos, p.body_yaw);

    // ── worker._servo_ideal at the deployed slews ──
    const sl = this.D.deploy.slews;
    for (const j of Object.keys(this.ctrl)) {
      const L = this.limits[j];
      let v = this.ctrl[j];
      if (L && L.limited) v = clamp(v, L.range[0], L.range[1]);
      const key = this.slewKey[j];
      if (key) {
        const vmax = key[0] === 'arm' ? sl.arm[key[1]] : sl[key[0]];
        const st = vmax * this._frame_dt, dq = v - this.q[j];
        if (Math.abs(dq) > st) v = this.q[j] + (dq > 0 ? st : -st);
      }
      this.q[j] = v;
    }
    this.X = this.kin.fk(this.q);

    // ── worker._deploy_out: what the robot is commanded ──
    const q = { ...this.q };
    const [tlo, thi] = this.D.deploy.torso_cmd_range;
    q.Torso = clamp(q.Torso, tlo, thi);
    const tgt = this.neckRule.apply(frame.head, now);
    const keys = ['neck_yaw', 'neck_pitch', 'neck_roll'], nst = sl.neck * this._frame_dt;
    keys.forEach((k, i) => {
      if (tgt) {
        const v = clamp(tgt[k], this.D.neck_range[i][0], this.D.neck_range[i][1]);
        this._neck_out[i] += clamp(v - this._neck_out[i], -nst, nst);
      }
    });
    this._prev_t = now;
    this.n++;
    return { q, neck: { neck_yaw: this._neck_out[0], neck_pitch: this._neck_out[1],
                        neck_roll: this._neck_out[2] },
             engaged: this._world_ref !== null, targets: this.targets };
  }

  /* where the palms are now (MuJoCo world), for the residual readout */
  palms() {
    const out = {};
    for (const s of SIDES) out[s] = this.X.anchor[`${CAP[s]} Wrist`];
    return out;
  }
}

export { Kin };
