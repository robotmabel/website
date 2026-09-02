/* Reading a hand shape, in comic-book terms.
 *
 * Pure functions over MediaPipe's 21 hand landmarks so they can be tested in
 * node against synthetic hands (scripts/gesturetest.mjs) rather than by waving
 * at a laptop and hoping.
 *
 * Two coordinate sources, and they are not interchangeable:
 *   `pts`  the hand's own 21 landmarks. Only RELATIVE geometry is read from
 *          these, so they work whether you pass world or image coordinates.
 *   `img`  the same landmarks in normalized IMAGE coordinates, where +y is
 *          DOWN. Used only where a gesture is defined by which way it points
 *          in the picture — a thumb is "up" or "down" relative to the frame,
 *          not relative to the palm.
 *
 * Every finger test is scale-free: distances are divided by the palm width
 * (index knuckle → pinky knuckle), so a hand near the camera and a hand across
 * the room read the same.
 */

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { thumb: 3, index: 6, middle: 10, ring: 14, pinky: 18 };
const MCP = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 };
export const FINGERS = ['index', 'middle', 'ring', 'pinky'];

const v = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z || 0]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = len(a); return n < 1e-9 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n]; };

/* Palm width — the scale every other measurement is divided by. */
export function palmWidth(pts) {
  return len(sub(v(pts[5]), v(pts[17]))) || 1e-6;
}

/* A finger is extended when it is both LONG (tip far from knuckle relative to
 * the length of its own bones) and STRAIGHT (its two segments point the same
 * way). Length alone calls a sideways-splayed curl extended; straightness
 * alone calls a bent-but-rigid finger extended. Both together do not. */
export function fingerExtended(pts, name) {
  const t = v(pts[TIP[name]]), p = v(pts[PIP[name]]), m = v(pts[MCP[name]]);
  const w = v(pts[0]);
  const seg = len(sub(p, m)) + len(sub(t, p));
  if (seg < 1e-9) return false;
  const reach = len(sub(t, m)) / seg;                 // 1.0 = perfectly straight
  const straight = dot(unit(sub(t, p)), unit(sub(p, m)));
  const outward = len(sub(t, w)) > len(sub(p, w));    // tip is beyond the knuckle
  return reach > 0.82 && straight > 0.55 && outward;
}

/* The thumb does not fold like the others — it ABDUCTS. It counts as extended
 * when its tip has swung clear of the index knuckle by a good fraction of the
 * palm, and its own two segments are not curled. */
export function thumbExtended(pts) {
  const w = palmWidth(pts);
  const tip = v(pts[4]), ip = v(pts[3]), mcp = v(pts[2]);
  const idxMcp = v(pts[5]), pinkyMcp = v(pts[17]);
  const clear = len(sub(tip, idxMcp)) / w;
  const straight = dot(unit(sub(tip, ip)), unit(sub(ip, mcp)));
  /* a curled thumb tucks TOWARD the pinky side; an extended one moves away */
  const away = len(sub(tip, pinkyMcp)) > len(sub(idxMcp, pinkyMcp)) * 0.72;
  return clear > 0.62 && straight > 0.2 && away;
}

export function fingerState(pts) {
  const s = { thumb: thumbExtended(pts) };
  FINGERS.forEach((f) => { s[f] = fingerExtended(pts, f); });
  s.count = FINGERS.filter((f) => s[f]).length + (s.thumb ? 1 : 0);
  return s;
}

/* Which way the thumb points IN THE PICTURE. img is normalized image space, so
 * +y is down — a raised thumb has a NEGATIVE dy. */
function thumbAim(img) {
  if (!img) return 0;
  const tip = v(img[4]), mcp = v(img[2]);
  const dy = tip[1] - mcp[1];
  const dx = tip[0] - mcp[0];
  const n = Math.hypot(dx, dy) || 1e-6;
  return -dy / n;                 // +1 straight up, −1 straight down
}

/* One hand → a gesture id, or ''. Order matters: the specific shapes are
 * tested before the finger COUNTS, because a thumbs-up is also "one finger". */
export function readHand(pts, img) {
  if (!pts || pts.length < 21) return '';
  const s = fingerState(pts);
  const only = (...names) =>
    ['thumb'].concat(FINGERS).every((f) => s[f] === names.includes(f));

  if (only('thumb')) {
    const aim = thumbAim(img);
    if (aim > 0.45) return 'thumbs_up';
    if (aim < -0.45) return 'thumbs_down';
  }
  if (only('middle')) return 'middle_finger';
  if (only('thumb', 'index', 'pinky')) return 'spiderman';   // the ILY / web-shooter
  if (only('index', 'pinky')) return 'horns';
  if (only('thumb', 'pinky')) return 'call_me';
  if (s.count === 0) return 'fist';

  if (only('index')) return 'one';
  if (only('index', 'middle')) return 'two';
  if (only('index', 'middle', 'ring')) return 'three';
  if (only('index', 'middle', 'ring', 'pinky')) return 'four';
  if (s.count === 5) return 'five';
  /* a count that does not match a named shape still reads as a number */
  if (s.count >= 1 && s.count <= 5)
    return ['one', 'two', 'three', 'four', 'five'][s.count - 1];
  return '';
}

/* Two hands making a heart: the hands stay APART while their thumb tips meet
 * at the bottom and their index tips meet at the top, with the index pair
 * sitting above the thumb pair in the picture.
 *
 * The separation test is the one that matters. Without it two hands overlapping
 * anywhere in frame trivially pass "the tips are close" — every fingertip pair
 * is at distance zero — so an open palm in front of another read as a heart. A
 * heart is a shape made BETWEEN two hands, so the wrists must be a palm apart
 * and the fingertips must be closer to each other than the wrists are. */
export function readHeart(left, right, imgL, imgR) {
  if (!left || !right || left.length < 21 || right.length < 21) return false;
  if (!imgL || !imgR) return false;
  const w = (palmWidth(imgL) + palmWidth(imgR)) / 2;
  if (!(w > 1e-6)) return false;
  const d = (a, b) => len(sub(v(a), v(b))) / w;
  const wrists = d(imgL[0], imgR[0]);
  if (!(wrists > 0.9)) return false;                  // the hands are apart
  const thumbs = d(imgL[4], imgR[4]);
  const index = d(imgL[8], imgR[8]);
  if (!(thumbs < 0.8 && index < 0.8)) return false;   // but the tips meet
  if (!(index < wrists * 0.6 && thumbs < wrists * 0.7)) return false;
  const idxY = (v(imgL[8])[1] + v(imgR[8])[1]) / 2;
  const thbY = (v(imgL[4])[1] + v(imgR[4])[1]) / 2;
  return thbY - idxY > 0.25 * w;      // index tips are higher up the frame
}

/* Gesture id → the words the overlay shouts. */
export const SFX = {
  one: '1!', two: '2!', three: '3!', four: '4!', five: 'HIGH FIVE!',
  thumbs_up: 'NICE!', thumbs_down: 'BOO~', middle_finger: 'RUDE!',
  spiderman: 'THWIP!', horns: 'ROCK ON!', call_me: 'CALL ME~',
  fist: 'FIST BUMP!', heart: '♥ LOVE!', both_up: 'HANDS UP!',
  wave: 'WAVE~~', clap: 'CLAP!'
};

/* The whole read for one frame. `hands` is {left, right} of 21-landmark arrays
 * (any coordinate source) and `img` the matching normalized image ones. */
export function readGesture(hands, img) {
  const h = hands || {}, m = img || {};
  if (readHeart(h.left, h.right, m.left, m.right)) return 'heart';
  const gl = readHand(h.left, m.left);
  const gr = readHand(h.right, m.right);
  if (gl && gl === gr && gl === 'five') return 'both_up';
  /* prefer the more specific of the two hands */
  const rank = (g) => (g === '' ? 0 : (['one', 'two', 'three', 'four', 'five']
    .includes(g) ? 1 : 2));
  return rank(gr) >= rank(gl) ? gr : gl;
}
