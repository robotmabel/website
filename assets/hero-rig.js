/* ═══════════════════════════════════════════════════════════════════
   MABEL — hero rig: the robot on the cover.
   · Head tracks the cursor; idle breath, sway, finger ripple; a little
     gesture show (wave → reach → flex) runs between rests.
   · CLICK the robot and the poked region answers:
       head  → wind-up sneeze + quick recovering head-shake
       hands → rock · paper · scissors on the raised right hand
       arms  → double-bicep flex
       base  → swerve rev: modules scan, wheels spin
       torso/lift → a stage bow
   · Comic-book grade: lifted warm materials + bright key so the robot
     matches the printed page instead of a CAD viewport.
   All joint values are DELTAS from the assembled pose (GLB baked at
   qpos == ref), same convention as robot-viewer.js.

   Debug hooks (headless verification):
     ?rig_look=x,y            freeze the gaze target
     ?rig_pose=<show pose>    freeze a show pose (wave/reach/flex/rest)
     ?rig_act=<act>&rig_pt=s  freeze a poke act at local time s
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const box = document.getElementById('heroRig');
const canvas = document.getElementById('heroRigCanvas');
if (box && canvas) init();

/* shared comic-book material lift: brighten the charcoal CAD greys toward
   the real robot's warm white while keeping true blacks and the orange
   hand shells readable. Exported pattern reused by the other viewers. */
export function comicize(root) {
  const seen = new Set();
  root.traverse((n) => {
    if (!n.isMesh || !n.material) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    mats.forEach((m) => {
      if (!m.color || seen.has(m.uuid)) return;
      seen.add(m.uuid);
      const hsl = { h: 0, s: 0, l: 0 };
      m.color.getHSL(hsl);
      const l2 = Math.min(0.93, 0.30 + hsl.l * 1.55);
      const s2 = hsl.s > 0.05 ? Math.min(1, hsl.s * 1.15) : hsl.s;
      m.color.setHSL(hsl.h, s2, l2);
      if ('roughness' in m) m.roughness = Math.max(0.55, m.roughness ?? 0.8);
      if ('metalness' in m) m.metalness = Math.min(0.25, m.metalness ?? 0);
    });
  });
}

export function comicLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff6e4, 0xa89a82, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-2.5, 3.2, 1.6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe9c9, 0.85); fill.position.set(2, 1.4, 1.2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd9a13f, 0.8); rim.position.set(1.2, 2.2, -3); scene.add(rim);
}

function init() {
  const Q = new URLSearchParams(location.search);
  const dbgLook = Q.get('rig_look') ? Q.get('rig_look').split(',').map(Number) : null;
  const dbgPose = Q.get('rig_pose');
  const dbgAct = Q.get('rig_act');
  const dbgPt = parseFloat(Q.get('rig_pt') || '1');

  /* GLB world: robot faces −X, +Y up, robot-left = +Z; camera on −X. */
  const YAW_SIGN = 1, PITCH_SIGN = 1;
  const YAW_MAX = 0.95, PITCH_MAX = 0.5;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 80);
  comicLights(scene);

  let root = null, spin = null;
  const J = {};
  const meshModule = new Map();
  const MODULE_ROOTS = [
    ['hands', ['l_hand_mount', 'r_hand_mount']],
    ['arms', ['l_shoulder_1', 'r_shoulder_1']],
    ['head', ['neck_1']],
    ['torso', ['torso']],
    ['lift', ['lift_mid', 'lift_upper', 'lift_lower']],
  ];

  ((l) => (l.setMeshoptDecoder(MeshoptDecoder), l))(new GLTFLoader())
    .load('assets/mabel_rig.glb', (gltf) => {
      root = gltf.scene;
      comicize(root);
      spin = new THREE.Group();
      spin.add(root);
      scene.add(spin);
      const rootOf = {};
      for (const [k, roots] of MODULE_ROOTS) for (const r of roots) rootOf[r] = k;
      root.traverse((n) => {
        if (!n.isMesh) return;
        let p = n, mod = 'base';
        while (p) { if (rootOf[p.name]) { mod = rootOf[p.name]; break; } p = p.parent; }
        meshModule.set(n, mod);
      });
      fetch('assets/mabel_joints.json').then((r) => r.json()).then((data) => {
        for (const j of data.joints) {
          const node = root.getObjectByName(j.node);
          if (!node) continue;
          J[j.name] = {
            n: node, type: j.type, p0: node.position.clone(), q0: node.quaternion.clone(),
            ax: new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize(),
            lo: j.lower, hi: j.upper,
          };
        }
      }).catch(() => {}).finally(() => {
        frame();
        box.classList.add('on');
        if (dbgAct && ACTS[dbgAct]) act = { name: dbgAct, t0: -1 };
      });
    }, undefined, () => { /* the hero works fine without the rig */ });

  function frame() {
    const bb = new THREE.Box3().setFromObject(root);
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    const h = sz.y || 1;
    const tanV = Math.tan((camera.fov / 2) * Math.PI / 180);
    const tanH = tanV * camera.aspect;
    const span = h * 1.2;
    const dist = Math.max((h * 0.64) / tanV, (span * 0.62) / tanH);
    const panWorld = 0.46 * tanH * dist;
    camera.position.set(c.x - dist, c.y + h * 0.10, c.z - panWorld + dist * 0.10);
    camera.lookAt(c.x, c.y, c.z - panWorld);
    camera.near = h / 50; camera.far = dist * 20;
    camera.updateProjectionMatrix();
  }

  const setJ = (name, val) => {
    const j = J[name]; if (!j) return;
    if (j.type === 'prismatic') {
      j.n.position.copy(j.p0).add(j.ax.clone().applyQuaternion(j.q0).multiplyScalar(val));
      j.n.quaternion.copy(j.q0);
    } else {
      j.n.quaternion.copy(j.q0).multiply(new THREE.Quaternion().setFromAxisAngle(j.ax, val));
      j.n.position.copy(j.p0);
    }
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  const FINGERS = ['index', 'middle', 'ring', 'pinky'];
  const curlAll = (o, side, v) => {
    FINGERS.forEach((f) => { o[`${side}_${f}_mcp`] = v; o[`${side}_${f}_pip`] = v * 0.9; });
    o[`${side}_thumb_mcp`] = v * 0.55;
  };
  const handShape = (o, side, shape) => {
    if (shape === 'rock') {
      curlAll(o, side, 1.55);
      o[`${side}_thumb_pip`] = 1.2;
    } else if (shape === 'paper') {
      FINGERS.forEach((f) => { o[`${side}_${f}_mcp`] = -0.15; o[`${side}_${f}_pip`] = -0.1; });
      o[`${side}_index_abd`] = -0.3; o[`${side}_pinky_abd`] = 0.3;
      o[`${side}_thumb_mcp`] = -0.2;
    } else if (shape === 'scissors') {
      o[`${side}_index_mcp`] = -0.1; o[`${side}_index_pip`] = -0.05;
      o[`${side}_middle_mcp`] = -0.1; o[`${side}_middle_pip`] = -0.05;
      o[`${side}_index_abd`] = -0.45; o[`${side}_middle_abd`] = 0.25;
      o[`${side}_ring_mcp`] = 1.55; o[`${side}_ring_pip`] = 1.4;
      o[`${side}_pinky_mcp`] = 1.6; o[`${side}_pinky_pip`] = 1.4;
      o[`${side}_thumb_mcp`] = 0.8; o[`${side}_thumb_pip`] = 1.2;
    }
  };

  /* ── the idle show ── */
  const POSES = {
    rest: () => ({}),
    wave: (t) => {
      const o = {};
      o.right_arm_2 = -1.15; o.right_arm_4 = -1.1;
      o.right_arm_6 = Math.sin(t * 6.0) * 0.45;
      o.right_wrist = Math.sin(t * 6.0) * 0.25;
      FINGERS.forEach((f) => { o[`right_${f}_abd`] = 0.25; });
      o.left_arm_2 = 0.12; o.left_arm_4 = 0.25;
      o.neck_roll = Math.sin(t * 3.0) * 0.06;
      return o;
    },
    reach: (t) => {
      const o = {};
      const pinch = 0.55 + 0.5 * Math.sin(t * 2.2);
      o.left_arm_1 = -0.85; o.right_arm_1 = 0.85;
      o.left_arm_4 = 0.75; o.right_arm_4 = -0.75;
      o.left_arm_6 = -0.25; o.right_arm_6 = 0.25;
      curlAll(o, 'left', pinch); curlAll(o, 'right', pinch);
      o.torso = -0.12;
      return o;
    },
    flex: (t) => {
      const o = {};
      o.left_arm_2 = 0.95; o.right_arm_2 = -0.95;
      o.left_arm_4 = 1.25; o.right_arm_4 = -1.25;
      o.left_arm_6 = Math.sin(t * 2.6) * 0.12;
      o.right_arm_6 = -Math.sin(t * 2.6) * 0.12;
      curlAll(o, 'left', 1.25); curlAll(o, 'right', 1.25);
      const bob = Math.abs(Math.sin(t * 2.6)) * 0.012;
      o.lift_lower = bob; o.lift_upper = bob;
      return o;
    },
  };
  const SHOW = [
    ['rest', 4.5], ['wave', 4.0], ['rest', 3.0],
    ['reach', 5.0], ['rest', 3.0], ['flex', 4.0],
  ];
  const SHOW_LEN = SHOW.reduce((s, x) => s + x[1], 0);
  const FADE = 0.8;

  function poseAt(t) {
    if (dbgPose && POSES[dbgPose]) return { a: dbgPose, b: dbgPose, mix: 1, ta: t, tb: t };
    let u = t % SHOW_LEN, i = 0;
    while (u > SHOW[i][1]) { u -= SHOW[i][1]; i = (i + 1) % SHOW.length; }
    const cur = SHOW[i][0], nxt = SHOW[(i + 1) % SHOW.length][0];
    const remain = SHOW[i][1] - u;
    const mix = remain < FADE ? smooth(1 - remain / FADE) : 0;
    return { a: cur, b: nxt, mix, ta: u, tb: 0 };
  }

  /* ── POKE ACTS — click a region, it answers ── */
  const ACTS = {
    sneeze: {
      dur: 3.2, headOwn: 1,
      pose: (t) => {
        const o = {};
        if (t < 1.0) {                        // wind-up: two little inhales
          const wu = smooth(t / 1.0);
          o.neck_pitch = -0.45 * wu + Math.sin(t * 9) * 0.05 * wu;
          o.neck_roll = 0.08 * wu;
          o.torso = 0.06 * wu;
        } else if (t < 1.18) {                // the CHOO — fast snap down
          const s = (t - 1.0) / 0.18;
          o.neck_pitch = lerp(-0.45, 0.62, smooth(s));
          o.torso = lerp(0.06, -0.16, s);
          const dip = 0.014 * smooth(s);
          o.lift_lower = -dip; o.lift_upper = -dip;
        } else if (t < 2.4) {                 // recovering shake, decays fast
          const u = t - 1.18;
          const decay = Math.exp(-2.6 * u);
          o.neck_pitch = 0.62 * Math.exp(-4 * u);
          o.neck_yaw = Math.sin(u * 26) * 0.34 * decay;
          o.neck_roll = Math.sin(u * 21 + 1) * 0.18 * decay;
          o.torso = -0.16 * Math.exp(-3 * u);
        } else {                              // sheepish "who saw that?"
          const u = (t - 2.4) / 0.8;
          o.neck_yaw = Math.sin(u * Math.PI * 2) * 0.35 * (1 - u);
          o.neck_pitch = -0.06 * (1 - u);
        }
        return o;
      },
    },
    rps: {
      dur: 4.6, headOwn: 0.35,
      pose: (t) => {
        const o = {};
        const up = smooth(t / 0.7) * smooth((4.6 - t) / 0.6);
        o.right_arm_2 = -0.9 * up;            // out…
        o.right_arm_4 = -1.35 * up;           // …elbow folded…
        o.right_arm_6 = 0.9 * up;             // …bend plane turned so the
        o.right_wrist = 0.25 * up;            // raised hand reads on camera
        o.neck_yaw = -0.3 * up;               // robot watches its own hand
        o.neck_pitch = 0.06 * up;
        const pump = (c) => Math.exp(-14 * Math.abs(t - c)) * 0.28;
        o.right_arm_4 += (pump(1.0) + pump(1.95) + pump(2.9)) * up;
        if (t < 2.0) handShape(o, 'right', 'rock');
        else if (t < 2.95) handShape(o, 'right', 'paper');
        else handShape(o, 'right', 'scissors');
        curlAll(o, 'left', 1.3 * up);
        return o;
      },
    },
    flexit: { dur: 3.6, headOwn: 0.2, pose: (t) => POSES.flex(t) },
    rev: {
      dur: 3.4, headOwn: 0.3,
      pose: (t) => {
        const o = {};
        const on = smooth(t / 0.5) * smooth((3.4 - t) / 0.5);
        const scan = Math.sin(t * 3.2) * 1.1 * on;
        o.fl_steer = scan; o.fr_steer = -scan; o.b_steer = scan * 0.7;
        const spin = wrap(t * t * 9);         // wheels accelerate
        o.fl_drive = spin; o.fr_drive = spin; o.b_drive = spin;
        const shiver = Math.sin(t * 40) * 0.004 * on;
        o.lift_lower = shiver; o.lift_upper = shiver;
        o.torso = -0.05 * on + Math.sin(t * 40) * 0.006 * on;
        o.neck_pitch = 0.12 * on;             // looks down at its wheels
        return o;
      },
    },
    bow: {
      dur: 3.0, headOwn: 0.9,
      pose: (t) => {
        const o = {};
        const down = smooth(t / 0.8) * smooth((3.0 - t) / 0.7);
        o.torso = -0.55 * down;
        o.neck_pitch = 0.35 * down;
        o.left_arm_1 = 0.5 * down; o.right_arm_1 = -0.5 * down;
        o.left_arm_2 = 0.25 * down; o.right_arm_2 = -0.25 * down;
        o.left_arm_4 = 0.3 * down; o.right_arm_4 = -0.3 * down;
        const dip = 0.02 * down;
        o.lift_lower = -dip; o.lift_upper = -dip;
        if (t > 2.3) o.neck_roll = Math.sin((t - 2.3) * 9) * 0.1;   // flourish
        return o;
      },
    },
    /* peace sign — V up by the head, palm out, proud little head tilt */
    peace: {
      dur: 3.0, headOwn: 0.5,
      pose: (t) => {
        const o = {};
        const up = smooth(t / 0.6) * smooth((3.0 - t) / 0.6);
        o.right_arm_2 = -0.9 * up; o.right_arm_4 = -1.35 * up;
        o.right_arm_6 = 0.9 * up; o.right_wrist = 0.25 * up;
        o.right_index_mcp = -0.1; o.right_index_pip = -0.05;
        o.right_middle_mcp = -0.1; o.right_middle_pip = -0.05;
        o.right_index_abd = -0.55; o.right_middle_abd = 0.35;
        o.right_ring_mcp = 1.55; o.right_ring_pip = 1.4;
        o.right_pinky_mcp = 1.6; o.right_pinky_pip = 1.4;
        o.right_thumb_mcp = 0.9; o.right_thumb_pip = 1.2;
        o.neck_roll = -0.14 * up;                       // cheeky tilt
        o.neck_yaw = -0.2 * up;
        return o;
      },
    },
    /* air piano — both hands out front, fingers rippling fast */
    piano: {
      dur: 4.2, headOwn: 0.6,
      pose: (t) => {
        const o = {};
        const up = smooth(t / 0.6) * smooth((4.2 - t) / 0.6);
        o.left_arm_1 = -0.75 * up; o.right_arm_1 = 0.75 * up;
        o.left_arm_4 = (0.9 + Math.sin(t * 5) * 0.05) * up;
        o.right_arm_4 = (-0.9 + Math.sin(t * 5 + 1) * 0.05) * up;
        o.left_wrist = Math.sin(t * 5) * 0.12 * up;
        o.right_wrist = Math.sin(t * 5 + 1.5) * 0.12 * up;
        for (const side of ['left', 'right']) {
          const ph = side === 'left' ? 0 : 2.1;
          FINGERS.forEach((f, i) => {
            const key = 0.45 + 0.45 * Math.sin(t * 9 + ph + i * 1.25);
            o[`${side}_${f}_mcp`] = key * up; o[`${side}_${f}_pip`] = key * 0.6 * up;
          });
          o[`${side}_thumb_mcp`] = (0.2 + 0.2 * Math.sin(t * 9 + ph + 5)) * up;
        }
        o.neck_pitch = 0.28 * up;                       // watching the keys
        o.neck_yaw = Math.sin(t * 2.2) * 0.18 * up;     // following the runs
        o.torso = -0.08 * up;
        return o;
      },
    },
    /* the New York salute — right hand up, middle finger only */
    finger: {
      dur: 2.6, headOwn: 0.45,
      pose: (t) => {
        const o = {};
        const up = smooth(t / 0.55) * smooth((2.6 - t) / 0.55);
        o.right_arm_2 = -0.9 * up; o.right_arm_4 = -1.35 * up;
        o.right_arm_6 = 0.9 * up; o.right_wrist = 0.25 * up;
        o.right_middle_mcp = -0.12; o.right_middle_pip = -0.06;
        o.right_index_mcp = 1.6; o.right_index_pip = 1.45;
        o.right_ring_mcp = 1.6; o.right_ring_pip = 1.45;
        o.right_pinky_mcp = 1.65; o.right_pinky_pip = 1.45;
        o.right_thumb_mcp = 1.0; o.right_thumb_pip = 1.2;
        o.neck_roll = 0.12 * up;                        // deadpan tilt
        return o;
      },
    },
    /* hello — the classic wave, as a clickable act */
    hello: { dur: 3.2, headOwn: 0.2, pose: (t) => POSES.wave(t) },
    /* clapping — hands meet at the midline, flat palms */
    clap: {
      dur: 3.2, headOwn: 0.3,
      pose: (t) => {
        const o = {};
        const up = smooth(t / 0.5) * smooth((3.2 - t) / 0.5);
        const beat = Math.max(0, Math.sin(t * 7.5));    // clap rhythm
        o.left_arm_1 = -0.7 * up; o.right_arm_1 = 0.7 * up;
        o.left_arm_4 = 1.05 * up; o.right_arm_4 = -1.05 * up;
        o.left_arm_2 = (0.35 - 0.3 * beat) * up;
        o.right_arm_2 = (-0.35 + 0.3 * beat) * up;
        o.left_arm_6 = -0.5 * up; o.right_arm_6 = 0.5 * up;
        handShape(o, 'left', 'paper'); handShape(o, 'right', 'paper');
        o.neck_pitch = 0.12 * up;
        o.torso = (-0.06 - 0.02 * beat) * up;
        return o;
      },
    },
  };
  /* base rev v2: the robot does a full turn in place, waving both hands,
     wheels spinning under it. __spin drives the whole-model yaw. */
  ACTS.rev = {
    dur: 4.0, headOwn: 0.4,
    pose: (t) => {
      const o = {};
      const on = smooth(t / 0.5) * smooth((4.0 - t) / 0.5);
      o.__spin = Math.PI * 2 * smooth(clamp((t - 0.3) / 3.3, 0, 1));
      const spinWheel = wrap(t * 11);
      o.fl_drive = spinWheel; o.fr_drive = spinWheel; o.b_drive = spinWheel;
      o.fl_steer = 1.2 * on; o.fr_steer = -1.2 * on; o.b_steer = 0.8 * on;
      /* both hands up, waving at everyone as it turns */
      o.left_arm_2 = 1.05 * on; o.right_arm_2 = -1.05 * on;
      o.left_arm_4 = 1.1 * on; o.right_arm_4 = -1.1 * on;
      o.left_arm_6 = Math.sin(t * 6) * 0.4 * on;
      o.right_arm_6 = -Math.sin(t * 6) * 0.4 * on;
      FINGERS.forEach((f) => { o[`left_${f}_abd`] = 0.25 * on; o[`right_${f}_abd`] = 0.25 * on; });
      o.neck_roll = Math.sin(t * 3) * 0.08 * on;
      return o;
    },
  };
  /* click playlists: repeated pokes cycle, never repeat back-to-back */
  const PLAYLISTS = {
    head: ['sneeze'],
    hands: ['rps', 'peace', 'piano', 'finger', 'clap', 'hello'],
    arms: ['flexit', 'clap', 'hello', 'piano', 'peace'],
    base: ['rev'],
    torso: ['bow'],
    lift: ['bow'],
  };
  const playIx = {};

  let act = null;   // {name, t0}; t0 === -1 → frozen debug act at dbgPt
  /* smooth interrupt: when a new act starts, blend from the exact pose on
     screen — no jumps, even mid-animation. */
  let applied = {};           // last values actually set, incl. __spin
  let trans = null;           // {from, t0}
  const TRANS_DUR = 0.45;
  function startAct(name) {
    trans = { from: Object.assign({}, applied), t0: performance.now() };
    act = { name, t0: performance.now() };
  }

  /* ── pointer: gaze + poke ── */
  let px = 0.5, py = 0.42, lastMove = -1e9;
  addEventListener('pointermove', (e) => {
    px = e.clientX / innerWidth; py = e.clientY / innerHeight;
    lastMove = performance.now();
    hoverCheck(e);
  }, { passive: true });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let lastRay = 0;
  function moduleAt(e) {
    if (!root) return null;
    const r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(root, true)[0];
    return hit ? (meshModule.get(hit.object) || 'base') : null;
  }
  function hoverCheck(e) {
    const now = performance.now();
    if (now - lastRay < 90) return;
    lastRay = now;
    document.documentElement.style.cursor = moduleAt(e) ? 'pointer' : '';
  }
  addEventListener('click', (e) => {
    const mod = moduleAt(e);
    if (!mod) return;
    const list = PLAYLISTS[mod];
    if (!list) return;
    playIx[mod] = ((playIx[mod] ?? -1) + 1) % list.length;
    startAct(list[playIx[mod]]);
  });

  let yaw = 0, pitch = 0;

  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (root) frame();
  }
  addEventListener('resize', resize, { passive: true });
  resize();

  let visible = true;
  new IntersectionObserver((es) => { es.forEach((e) => { visible = e.isIntersecting; }); })
    .observe(box);

  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (!root || !visible) return;
    const t = (performance.now() - t0) / 1000;
    const idleFor = (performance.now() - lastMove) / 1000;

    /* base layer: the idle show */
    const { a, b, mix, ta, tb } = poseAt(t);
    const pa = POSES[a](ta), pb = POSES[b](tb);
    const target = {};
    for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      target[k] = lerp(pa[k] || 0, pb[k] || 0, mix);
    }
    const restness = 1 - Math.max(mix && b !== 'rest' ? mix : 0, a !== 'rest' ? 1 - mix : 0);
    const ov = {};
    const breathe = Math.sin(t * 0.55) * 0.006;
    ov.lift_lower = breathe; ov.lift_upper = breathe;
    ov.torso = Math.sin(t * 0.17) * 0.02;
    ov.left_arm_1 = Math.sin(t * 0.42) * 0.05;
    ov.right_arm_1 = Math.sin(t * 0.42 + 2.4) * 0.05;
    ov.left_arm_4 = 0.14 + Math.sin(t * 0.36 + 1.1) * 0.07;
    ov.right_arm_4 = -0.14 - Math.sin(t * 0.36) * 0.07;
    ov.left_wrist = Math.sin(t * 0.44 + 0.4) * 0.08;
    ov.right_wrist = Math.sin(t * 0.44 + 2.1) * 0.08;
    for (const side of ['left', 'right']) {
      const ph = side === 'left' ? 0 : 1.4;
      FINGERS.forEach((f, i) => {
        const curl = 0.2 + 0.18 * Math.sin(t * 1.1 + ph + i * 0.7);
        ov[`${side}_${f}_mcp`] = curl; ov[`${side}_${f}_pip`] = curl * 0.85;
      });
      ov[`${side}_thumb_mcp`] = 0.08 + 0.07 * Math.sin(t * 0.9 + ph);
    }
    for (const k of Object.keys(ov)) target[k] = (target[k] || 0) + ov[k] * restness;

    /* act layer: the poked region answers */
    let headOwn = 0;
    if (act) {
      const A = ACTS[act.name];
      const u = act.t0 === -1 ? dbgPt : (performance.now() - act.t0) / 1000;
      if (u > A.dur && act.t0 !== -1) {
        act = null;
      } else {
        const actMix = act.t0 === -1 ? 1
          : smooth(u / 0.35) * smooth((A.dur - u) / 0.45);
        headOwn = A.headOwn * actMix;
        const ap = A.pose(clamp(u, 0, A.dur));
        for (const k of new Set([...Object.keys(target), ...Object.keys(ap)])) {
          target[k] = lerp(target[k] || 0, ap[k] || 0, actMix);
        }
      }
    }

    /* head: cursor gaze, ceded to the act as needed */
    let tx, ty;
    if (dbgLook) { tx = dbgLook[0]; ty = dbgLook[1]; }
    else if (idleFor < 4) {
      const r = box.getBoundingClientRect();
      const hx = (r.left + r.width * 0.72) / innerWidth;
      const hy = (r.top + r.height * 0.26) / innerHeight;
      tx = clamp((px - hx) * 2.6, -1, 1);
      ty = clamp((py - hy) * 3.0, -1, 1);
    } else {
      tx = Math.sin(t * 0.31) * 0.5 + Math.sin(t * 0.13) * 0.25;
      ty = Math.sin(t * 0.21 + 1.3) * 0.3;
    }
    yaw = lerp(yaw, YAW_SIGN * tx * YAW_MAX, dbgLook ? 1 : 0.085);
    pitch = lerp(pitch, PITCH_SIGN * ty * PITCH_MAX, dbgLook ? 1 : 0.085);
    const cede = 1 - headOwn;
    target.neck_yaw = (target.neck_yaw || 0) + yaw * cede;
    target.neck_pitch = (target.neck_pitch || 0) + (pitch + Math.sin(t * 0.9) * 0.012) * cede;
    target.neck_roll = (target.neck_roll || 0) + Math.sin(t * 0.23) * 0.03 * cede;

    /* smooth-interrupt blend from the pose that was on screen */
    if (trans) {
      const k = smooth((performance.now() - trans.t0) / 1000 / TRANS_DUR);
      if (k >= 1) trans = null;
      else {
        for (const key of new Set([...Object.keys(trans.from), ...Object.keys(target)])) {
          target[key] = lerp(trans.from[key] || 0, target[key] || 0, k);
        }
      }
    }
    for (const [k, v] of Object.entries(target)) {
      if (k === '__spin') continue;
      const j = J[k]; if (!j) continue;
      const cv = clamp(v, j.lo, j.hi);
      setJ(k, cv);
      applied[k] = cv;
    }
    if (spin) {
      spin.rotation.y = target.__spin || 0;
      applied.__spin = spin.rotation.y;
    }
    renderer.render(scene, camera);
  });
}
