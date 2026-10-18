/* Does the wrist orientation survive the trip into the robot's frame?
 *
 * Two hands held in the SAME physical orientation must produce the SAME palm
 * normal on the robot. They are mirror images of each other, so an anatomical
 * frame — finger axis crossed with index→pinky — comes out mirrored, and
 * pairing it to the robot without flipping the left is a 180° error on one
 * hand. The server measured that error at 178.6° and its operator described it
 * as "left wrist flipped 180" (teleop_engine/geometry.py:palm_axes).
 *
 * Every hand here is built with a KNOWN orientation, so the expected answer is
 * arithmetic rather than opinion.
 *
 *     node scripts/frametest.mjs
 */
import { operatorPalmAxesRig, naturalFrame, palmAxes, arkitVecToRig,
         angleDeg, dot3, axesToQuat } from '../assets/retarget-frames.js';
import { wristRotation } from '../assets/bodyteleop-core.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ── a hand, in the ARKit operator frame, wrist at the origin ───────────────
 * ARKit: +X operator right, +Y up, −Z the way they face.
 * Fingers point along `fingers`; the palm faces along `faces`; `side` decides
 * which way round the index and pinky knuckles sit, which is the ONLY thing
 * that differs between a left and a right hand in the same pose. */
function hand(side, fingers = [0, 1, 0], faces = [0, 0, -1]) {
  const f = fingers, n = faces;
  const across = [f[1] * n[2] - f[2] * n[1],       // f × n
                  f[2] * n[0] - f[0] * n[2],
                  f[0] * n[1] - f[1] * n[0]];
  /* On a RIGHT hand the index knuckle sits on the +(f × n) side; on a left
     hand it is the mirror, so the two swap. */
  const s = side === 'left' ? -1 : 1;
  const P = new Array(21).fill(null).map(() => [0, 0, 0]);
  const at = (a, b, c) => [f[0] * a + across[0] * b * s + n[0] * c,
                           f[1] * a + across[1] * b * s + n[1] * c,
                           f[2] * a + across[2] * b * s + n[2] * c];
  P[0] = [0, 0, 0];                    // wrist
  P[5] = at(0.075, 0.039, 0);          // index knuckle
  /* The middle knuckle DEFINES the finger axis (naturalFrame takes
     wrist→middle as f), so in a fixture meant to isolate chirality it has to
     sit ON that axis. Off it by the 14 mm a real hand has, mirroring the hand
     swings the axis ~10° and three assertions about the FINGER direction fail
     for a reason that has nothing to do with the thing under test. */
  P[9] = at(0.082, 0, 0);              // middle knuckle — on the finger axis
  P[13] = at(0.079, -0.013, 0);        // ring
  P[17] = at(0.072, -0.039, 0);        // pinky knuckle
  for (const [k, base] of [[8, 5], [12, 9], [16, 13], [20, 17]]) {
    const b = P[base];
    P[k] = [b[0] + f[0] * 0.07, b[1] + f[1] * 0.07, b[2] + f[2] * 0.07];
  }
  return P;
}

console.log('the map itself');
ok('operator right → robot right (−Z)',
   arkitVecToRig([1, 0, 0]).join() === '0,0,-1', '[1,0,0] → ' + arkitVecToRig([1, 0, 0]));
ok('operator up → robot up (+Y)',
   arkitVecToRig([0, 1, 0]).join() === '0,1,0');
ok('operator forward (−Z) → robot forward (−X)',
   arkitVecToRig([0, 0, -1]).join() === '-1,0,0');

console.log('\nthe anatomical frame is right-handed and orthonormal');
{
  const fr = naturalFrame(...[hand('right')[0], hand('right')[9],
                              hand('right')[5], hand('right')[17]]);
  const [f, s, n] = fr;
  const det = dot3(f, [s[1] * n[2] - s[2] * n[1],
                       s[2] * n[0] - s[0] * n[2],
                       s[0] * n[1] - s[1] * n[0]]);
  ok('det = +1', near(det, 1, 1e-6), `det ${det.toFixed(4)}`);
  ok('axes orthogonal', near(dot3(f, s), 0, 1e-6) && near(dot3(f, n), 0, 1e-6));
}

console.log('\nthe chirality flip — THE bug');
{
  /* both hands held identically: fingers up, palms facing the camera */
  const L = hand('left'), R = hand('right');
  const raw = {
    l: palmAxes(naturalFrame(L[0], L[9], L[5], L[17]), 'right'),   // NO flip
    r: palmAxes(naturalFrame(R[0], R[9], R[5], R[17]), 'right'),
  };
  const bad = angleDeg(raw.l[1], raw.r[1]);
  ok('without the flip the two normals oppose', bad > 170,
     `${bad.toFixed(1)}° apart — the server measured 178.6°`);

  const a = operatorPalmAxesRig(L, 'left'), b = operatorPalmAxesRig(R, 'right');
  const good = angleDeg(a.up, b.up);
  ok('with the flip they agree', good < 1.0, `${good.toFixed(2)}° apart`);
  ok('and the finger axes already agreed', angleDeg(a.fwd, b.fwd) < 1.0);
}

console.log('\nwristRotation is not a substitute (it takes no chirality)');
{
  const L = hand('left'), R = hand('right');
  const wl = wristRotation(L), wr = wristRotation(R);
  /* wristRotation returns columns [side, fwd, z]; its z is the mirrored normal */
  const d = angleDeg(wl[2], wr[2]);
  ok('its normals oppose between hands', d > 170,
     `${d.toFixed(1)}° apart — this is what the page was using`);
}

console.log('\nthe frame maps as M·R, not M·R·Mᵀ');
{
  const R = hand('right');
  const fr = naturalFrame(R[0], R[9], R[5], R[17]);
  const M = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
  const mul = (A, B) => A.map((r, i) => B[0].map((_, j) =>
    r.reduce((s, v, k) => s + v * B[k][j], 0)));
  const cols = [[fr[0][0], fr[1][0], fr[2][0]],   // as a row-major matrix
                [fr[0][1], fr[1][1], fr[2][1]],
                [fr[0][2], fr[1][2], fr[2][2]]];
  const MR = mul(M, cols);
  const Mt = M[0].map((_, j) => M.map((r) => r[j]));
  const MRMt = mul(MR, Mt);
  const colOf = (m, j) => [m[0][j], m[1][j], m[2][j]];
  const want = arkitVecToRig(fr[2]);              // the normal, mapped as a vector
  ok('column 2 of M·R is the mapped normal',
     angleDeg(colOf(MR, 2), want) < 1e-3);
  const wrongBy = angleDeg(colOf(MRMt, 2), want);
  ok('M·R·Mᵀ is a different frame', wrongBy > 5,
     `off by ${wrongBy.toFixed(1)}° — the page was using this`);
}

console.log('\na real rotation of the hand rotates the robot target the same way');
{
  /* roll the hand 90° about its own finger axis: palm was facing the camera
     (−Z), it should end up facing the operator's right (+X) */
  const flat = hand('right', [0, 1, 0], [0, 0, -1]);
  const rolled = hand('right', [0, 1, 0], [1, 0, 0]);
  const a = operatorPalmAxesRig(flat, 'right');
  const b = operatorPalmAxesRig(rolled, 'right');
  const turned = angleDeg(a.up, b.up);
  ok('a 90° roll is a 90° roll', near(turned, 90, 1.5), `${turned.toFixed(1)}°`);
  ok('the finger axis did not move', angleDeg(a.fwd, b.fwd) < 1.0);
  /* and the palm now faces the robot's right, which is −Z */
  ok('palm ends up facing the robot right (−Z)',
     angleDeg(b.up, [0, 0, -1]) < 1.0,
     '[' + b.up.map((v) => v.toFixed(2)).join(' ') + ']');
}

console.log('\npointing the fingers forward');
{
  /* fingers toward the camera (−Z in ARKit) = the robot's forward (−X) */
  const h = hand('right', [0, 0, -1], [0, 1, 0]);
  const a = operatorPalmAxesRig(h, 'right');
  ok('fingers → robot forward (−X)', angleDeg(a.fwd, [-1, 0, 0]) < 1.0,
     '[' + a.fwd.map((v) => v.toFixed(2)).join(' ') + ']');
  ok('palm up → robot up (+Y)', angleDeg(a.up, [0, 1, 0]) < 1.0);
}

console.log('\naxesToQuat round-trips');
{
  const h = hand('left', [0, 1, 0], [0, 0, -1]);
  const a = operatorPalmAxesRig(h, 'left');
  const q = axesToQuat(a.fwd, a.up);
  ok('a unit quaternion comes back',
     q && near(Math.hypot(...q), 1, 1e-6), q ? Math.hypot(...q).toFixed(6) : 'null');
  /* rotate local +Y by q and it must be the finger axis again */
  const rot = (qq, v) => {
    const [x, y, z, w] = qq;
    const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * t[0] + (y * t[2] - z * t[1]),
            v[1] + w * t[1] + (z * t[0] - x * t[2]),
            v[2] + w * t[2] + (x * t[1] - y * t[0])];
  };
  ok('local +X → the finger axis', angleDeg(rot(q, [1, 0, 0]), a.fwd) < 0.01);
  ok('local +Z → the palm normal', angleDeg(rot(q, [0, 0, 1]), a.up) < 0.01);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log('RESULT:', fail === 0 ? 'PASS' : 'FAIL');
process.exit(fail === 0 ? 0 : 1);
