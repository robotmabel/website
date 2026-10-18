/* The operator's palm frame, in the robot's coordinates.
 *
 * Split out of retarget-cam.js so it can be tested in node against hands whose
 * orientation is known by construction (scripts/frametest.mjs), because the two
 * bugs this file exists to fix are both invisible in a still screenshot and
 * obvious the moment you measure an angle.
 *
 * ── 1. CHIRALITY ────────────────────────────────────────────────────────────
 * A palm frame built from anatomy — finger axis crossed with index→pinky — is
 * chirality-MIRRORED: its normal comes out palmar on the right hand and DORSAL
 * on the left, because the two hands are mirror images and the cross product
 * flips with them. The robot's palm normal is flexion-anchored (the direction
 * the fingers curl) and is palmar on BOTH sides. Pairing them without flipping
 * the left is a 180° error on one hand.
 *
 * This is not a guess. controller/mabel/teleop_engine/geometry.py:palm_axes
 * carries the measurement: "with the flip the palms mirror physically; WITHOUT
 * it the left palm solves PHYSICALLY INVERTED (palm-normal mirror error
 * 178.6 deg; operator: 'left wrist flipped 180')". It also records that
 * joint-space |q| symmetry cannot detect the defect, which is why it has to be
 * checked as an angle between normals.
 *
 * bodyteleop's own `wristRotation` does NOT take a chirality argument — it is
 * used to stamp the wire's wrist joint, and the SERVER applies the flip when it
 * pairs the frame to the robot. Using it here as if it were an anatomically
 * normalised palm frame is what flipped the hand.
 *
 * ── 2. A FRAME IS NOT AN OPERATOR ───────────────────────────────────────────
 * R's columns are the palm's axes expressed in ARKit, i.e. R maps palm-body
 * coordinates to ARKit. To get palm-body → rig the answer is M·R: each column
 * is a vector and maps with M alone. M·R·Mᵀ is the change of basis for an
 * OPERATOR acting on ARKit vectors, and applying it here also permutes the
 * hand's own body axes — which is meaningless, and wrong by a further rotation.
 */

/* ARKit operator frame → the GLB's world axes. Measured from the rig: the two
 * front swerve modules sit at x = +0.062 and the back one at x = +0.382, so
 * forward is −X and up is +Y; with right = forward × up = −Z,
 *     operator right (+X_a) → −Z      operator up (+Y_a) → +Y
 *     operator back  (+Z_a) → +X
 * det = +1, so chirality survives the map. */
export const M_ARKIT_TO_RIG = [[0, 0, 1],
                               [0, 1, 0],
                               [-1, 0, 0]];

export const arkitVecToRig = (v) => [v[2], v[1], -v[0]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                         a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n < 1e-9 ? null : [a[0] / n, a[1] / n, a[2] / n]; };
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* The server's _natural_frame, same construction and same column order:
 * columns [f, s, n] = finger axis, side, palm normal. Returned as an array of
 * the three column vectors. */
export function naturalFrame(wrist, fwdPt, indexPt, pinkyPt) {
  const f = unit(sub(fwdPt, wrist));
  if (!f) return null;
  const sRaw = sub(pinkyPt, indexPt);
  const n = unit(cross(f, sRaw));
  if (!n) return null;
  return [f, cross(n, f), n];
}

/* The server's palm_axes: (fwd, up) with the LEFT normal flipped to palmar. */
export function palmAxes(frame, side) {
  const up = frame[2];
  return [frame[0], side === 'left' ? [-up[0], -up[1], -up[2]] : up];
}

/* shape: the 21 hand landmarks in the ARKit operator frame, wrist-relative —
 * exactly what bodyteleop puts in each joint's localTransform translation.
 * Returns { fwd, up } in RIG coordinates, anatomically normalised. */
export function operatorPalmAxesRig(shape, side) {
  if (!shape || shape.length < 18) return null;
  const fr = naturalFrame(shape[0], shape[9], shape[5], shape[17]);
  if (!fr) return null;
  const ax = palmAxes(fr, side);
  return { fwd: arkitVecToRig(ax[0]), up: arkitVecToRig(ax[1]) };
}

/* Two orthonormal axes → a quaternion, so the solver can be handed one target
 * orientation instead of two loose vectors. Column order is naturalFrame's:
 * local +X is the finger axis, +Y the side, +Z the palm normal. Keeping one
 * order across the module and the page is what stops W_FWD being applied to
 * the normal and W_UP to the fingers. */
export function axesToQuat(fwd, up) {
  const x = unit(fwd);
  if (!x) return null;
  let z = [up[0] - x[0] * dot3(up, x), up[1] - x[1] * dot3(up, x),
           up[2] - x[2] * dot3(up, x)];
  z = unit(z);
  if (!z) return null;
  const y = cross(z, x);
  /* rotation matrix with columns [x, y, z] → quaternion (x, y, z, w) */
  const m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s,
         (m[1][0] - m[0][1]) / s, 0.25 * s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s,
         (m[2][1] - m[1][2]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s,
         (m[0][2] - m[2][0]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s,
         (m[1][0] - m[0][1]) / s];
  }
  return q;
}

/* The angle between two unit vectors, in degrees — the units every claim in
 * this file is stated in. */
export function angleDeg(a, b) {
  const d = Math.max(-1, Math.min(1, dot3(unit(a) || [0, 0, 0], unit(b) || [0, 0, 0])));
  return Math.acos(d) * 180 / Math.PI;
}
