/* Does the gesture reader actually read the gestures?
 *
 * Synthetic hands, built from the MediaPipe topology: a wrist, four knuckles
 * across the palm, a thumb off the index side, and each finger either straight
 * out from its knuckle (extended) or curled back toward the palm (folded).
 * That is enough geometry for every test the reader performs, and it means a
 * regression shows up here instead of in front of a webcam.
 *
 *     node scripts/gesturetest.mjs
 */
import { readHand, readGesture, readHeart, fingerState }
  from '../assets/hand-gestures.js';

/* image space: +x right, +y DOWN, palm facing the camera, fingers pointing up */
const KNUCK = { index: [0.00, -0.10], middle: [0.035, -0.105],
                ring: [0.07, -0.10], pinky: [0.105, -0.085] };
const ORDER = ['index', 'middle', 'ring', 'pinky'];

function hand({ ext = [], thumb = false, thumbDown = false, at = [0.5, 0.6],
                scale = 1 } = {}) {
  const P = new Array(21);
  const put = (i, x, y) => { P[i] = { x: at[0] + x * scale, y: at[1] + y * scale, z: 0 }; };
  put(0, 0, 0);                                        // wrist
  ORDER.forEach((f, k) => {
    const [kx, ky] = KNUCK[f];
    const mcp = 5 + k * 4;
    put(mcp, kx, ky);
    if (ext.includes(f)) {
      /* straight: three equal segments carrying on past the knuckle */
      for (let s = 1; s <= 3; s++) put(mcp + s, kx + kx * 0.06 * s, ky + ky * 0.62 * s);
    } else {
      /* curled: the tip comes back down toward the palm, and the last
         segment reverses direction so `straight` fails too */
      put(mcp + 1, kx, ky * 1.45);
      put(mcp + 2, kx, ky * 1.15);
      put(mcp + 3, kx, ky * 0.62);
    }
  });
  const s = thumbDown ? -1 : 1;
  if (thumb) {                       // swung out to the index side and clear
    put(2, -0.055, -0.045 * s);
    put(3, -0.105, -0.085 * s);
    put(4, -0.150, -0.125 * s);
  } else {                           // tucked across the palm
    put(2, -0.030, -0.045);
    put(3, 0.005, -0.070);
    put(4, 0.040, -0.080);
  }
  return P;
}

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${name.padEnd(22)} → ${got}`); }
  else { fail++; console.log(`  FAIL ${name.padEnd(22)} → ${got}  (want ${want})`); }
}

console.log('one hand');
is('index only', readHand(hand({ ext: ['index'] }), hand({ ext: ['index'] })), 'one');
is('index+middle', readHand(hand({ ext: ['index', 'middle'] }),
                            hand({ ext: ['index', 'middle'] })), 'two');
is('three fingers', readHand(hand({ ext: ['index', 'middle', 'ring'] }),
                             hand({ ext: ['index', 'middle', 'ring'] })), 'three');
is('four fingers', readHand(hand({ ext: ORDER }), hand({ ext: ORDER })), 'four');
is('open palm', readHand(hand({ ext: ORDER, thumb: true }),
                         hand({ ext: ORDER, thumb: true })), 'five');
is('fist', readHand(hand({}), hand({})), 'fist');
is('thumbs up', readHand(hand({ thumb: true }), hand({ thumb: true })), 'thumbs_up');
is('thumbs down', readHand(hand({ thumb: true, thumbDown: true }),
                           hand({ thumb: true, thumbDown: true })), 'thumbs_down');
is('middle finger', readHand(hand({ ext: ['middle'] }), hand({ ext: ['middle'] })),
   'middle_finger');
is('spiderman / ILY', readHand(hand({ ext: ['index', 'pinky'], thumb: true }),
                               hand({ ext: ['index', 'pinky'], thumb: true })),
   'spiderman');
is('horns', readHand(hand({ ext: ['index', 'pinky'] }),
                     hand({ ext: ['index', 'pinky'] })), 'horns');

console.log('\nscale invariance');
const small = hand({ ext: ['index', 'middle'], at: [0.2, 0.3], scale: 0.35 });
is('peace, far away', readHand(small, small), 'two');

console.log('\ntwo hands');
/* A heart, built explicitly rather than by mirroring a generic hand: the two
   wrists sit apart at the bottom, the index tips meet high in the middle and
   the thumb tips meet lower in the middle. s = +1 puts the hand on the left of
   the frame reaching right, s = −1 the other way. */
function heartHand(s) {
  const P = new Array(21);
  const put = (i, x, y) => { P[i] = { x: 0.5 + s * x, y, z: 0 }; };
  put(0, 0.16, 0.78);                                  // wrist, low and out
  [[5, 0.13, 0.70], [9, 0.15, 0.71], [13, 0.17, 0.72], [17, 0.19, 0.73]]
    .forEach(([i, x, y]) => put(i, x, y));             // knuckles across the palm
  /* the index curls up and inward to meet its partner at the top */
  put(6, 0.10, 0.64); put(7, 0.06, 0.60); put(8, 0.01, 0.58);
  /* middle, ring and pinky fold away */
  [[9, 10], [13, 14], [17, 18]].forEach(([m, p], k) => {
    const bx = 0.15 + k * 0.02, by = 0.71 + k * 0.01;
    put(p, bx, by + 0.05); put(p + 1, bx, by + 0.03); put(p + 2, bx, by - 0.01);
  });
  /* the thumb reaches in below the index to meet its partner */
  put(2, 0.11, 0.74); put(3, 0.06, 0.71); put(4, 0.01, 0.685);
  return P;
}
const hl = heartHand(1), hr = heartHand(-1);
is('heart', readHeart(hl, hr, hl, hr) ? 'heart' : 'no', 'heart');
is('heart via readGesture',
   readGesture({ left: hl, right: hr }, { left: hl, right: hr }), 'heart');

const five = hand({ ext: ORDER, thumb: true });
is('both hands open', readGesture({ left: five, right: five },
                                  { left: five, right: five }), 'both_up');
/* two hands clasped low is NOT a heart: the index tips are not above the
   thumb tips */
const clasp = hand({ ext: ORDER, thumb: true });
is('clasped, not a heart', readHeart(clasp, clasp, clasp, clasp) ? 'heart' : 'no', 'no');

console.log(`\n${pass} passed, ${fail} failed`);
console.log('RESULT:', fail === 0 ? 'PASS' : 'FAIL');
process.exit(fail === 0 ? 0 : 1);
