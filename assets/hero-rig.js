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
    const portrait = camera.aspect < 0.95;      // phone hero: centred, tighter
    const span = h * (portrait ? 0.95 : 1.2);
    const dist = Math.max((h * 0.64) / tanV, (span * 0.62) / tanH);
    const panWorld = portrait ? 0 : 0.46 * tanH * dist;
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
  /* ── ports from the control-center clip library (web_gui motions.js —
     validated on the live sim; same MJCF-zero joint space as this rig).
     Adapter: `grip` keys expand to ORCA finger curls, GUI lift metres are
     scaled onto the rig's ± range, and nav yaw integrates into __spin. */
  const ease01 = (u) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1));
  const seg = (t, t0, t1) => ease01((t - t0) / Math.max(1e-6, t1 - t0));
  const win = (t, t0, t1, r = 0.5) => {
    if (t <= t0 || t >= t1) return 0;
    return Math.min(seg(t, t0, t0 + r), 1 - seg(t, t1 - r, t1));
  };
  const osc = (t, f, t0, t1, r = 0.5) =>
    win(t, t0, t1, r) * Math.sin(2 * Math.PI * f * (t - t0));
  const breath = (t, t0, t1, f = 0.28) =>
    win(t, t0, t1, 0.8) * Math.sin(2 * Math.PI * f * (t - t0));
  const yawInt = (rxFn, t, dt = 0.05) => {           // ∫ 1.5·rx dt  (wire cal)
    let a = 0;
    for (let u = dt / 2; u < t; u += dt) a += 1.5 * rxFn(u) * dt;
    return a;
  };
  const fromGUI = (o) => {                            // adapter, in place
    for (const side of ['left', 'right']) {
      const g = o[`${side}_grip`];
      if (g !== undefined) {
        delete o[`${side}_grip`];
        FINGERS.forEach((f) => {
          o[`${side}_${f}_mcp`] = g * 1.55; o[`${side}_${f}_pip`] = g * 1.35;
        });
        o[`${side}_thumb_mcp`] = g * 0.85;
      }
    }
    if (o.lift_lower !== undefined) o.lift_lower *= 0.5;
    if (o.lift_upper !== undefined) o.lift_upper *= 0.5;
    return o;
  };

  Object.assign(ACTS, {
    /* wave hello, hand up beside the head — GUI `wave` */
    wavehi: {
      dur: 5.0, headOwn: 0.25,
      pose: (t) => {
        const d = 5.0, up = win(t, 0.1, d - 0.1, 1.3);
        const wig = osc(t, 0.95, 1.2, d - 1.0, 0.6), brt = breath(t, 0, d);
        return fromGUI({
          right_arm_1: 2.0 * up, right_arm_2: -0.6 * up, right_arm_3: -0.9 * up,
          right_arm_4: (-1.0 + 0.32 * wig) * up, right_arm_7: 0.4 * wig * up,
          right_grip: 0.06 * up,
          left_arm_1: 1.25 * up + 0.02 * brt, left_arm_4: 0.35 * up,
          torso: -0.06 * up + 0.015 * brt,
        });
      },
    },
    /* BOTH hands over the head, waving side to side — per request */
    overhead: {
      dur: 5.0, headOwn: 0.3,
      pose: (t) => {
        const d = 5.0, up = win(t, 0.1, d - 0.1, 1.2);
        const sway = osc(t, 0.8, 1.1, d - 0.9, 0.7);
        return fromGUI({
          left_arm_1: -2.5 * up, right_arm_1: 2.5 * up,
          left_arm_2: (0.35 + 0.25 * sway) * up, right_arm_2: (-0.35 + 0.25 * sway) * up,
          left_arm_3: -0.5 * up, right_arm_3: 0.5 * up,
          left_arm_4: (0.55 + 0.2 * sway) * up, right_arm_4: (-0.55 + 0.2 * sway) * up,
          left_grip: 0.05 * up, right_grip: 0.05 * up,
          torso: 0.05 * up, lift_lower: 0.06 * up, lift_upper: 0.06 * up,
        });
      },
    },
    /* ballet: pirouette sway — port de bras arms, torso rises, robot
       rotates left and right like a music box */
    ballet: {
      dur: 7.0, headOwn: 0.35,
      pose: (t) => {
        const d = 7.0, up = win(t, 0.15, d - 0.15, 1.2);
        const turn = osc(t, 0.2, 0.6, d - 0.6, 1.4);
        const o = fromGUI({
          left_arm_1: -2.2 * up, right_arm_1: 2.2 * up,     // rounded overhead
          left_arm_2: 0.65 * up, right_arm_2: -0.65 * up,
          left_arm_3: 0.9 * up, right_arm_3: -0.9 * up,     // curve the frame
          left_arm_4: 0.9 * up, right_arm_4: -0.9 * up,
          left_arm_5: -0.4 * up, right_arm_5: 0.4 * up,
          left_grip: 0.15 * up, right_grip: 0.15 * up,
          torso: 0.08 * up, lift_lower: 0.1 * up, lift_upper: 0.1 * up,
        });
        o.__spin = 0.8 * turn;                              // the sway-turn
        return o;
      },
    },
    /* handshake offer — GUI `handshake` */
    shake: {
      dur: 6.0, headOwn: 0.25,
      pose: (t) => {
        const d = 6.0, offer = win(t, 0.1, d - 0.1, 1.1);
        const bob = osc(t, 0.9, 2.0, 4.4, 0.5), brt = breath(t, 0, d);
        return fromGUI({
          right_arm_1: 0.18 * offer + 0.06 * bob, right_arm_2: -0.15 * offer,
          right_arm_3: -0.9 * offer, right_arm_4: 0.25 * offer,
          right_arm_6: 0.12 * offer, right_grip: 0.18 * offer,
          left_arm_1: 1.3 * offer + 0.02 * brt, left_arm_4: 0.3 * offer,
          torso: -0.1 * offer,
        });
      },
    },
    /* fist bump — GUI `fistbump` */
    fistbump: {
      dur: 4.5, headOwn: 0.25,
      pose: (t) => {
        const d = 4.5, arm = win(t, 0.1, d - 0.1, 0.9);
        const wind = win(t, 0.7, 2.0, 0.55), punch = win(t, 1.8, 3.6, 0.55);
        return fromGUI({
          right_arm_1: 0.45 * arm - 0.75 * punch, right_arm_2: -0.1 * arm,
          right_arm_4: -0.35 * wind, right_arm_5: 0.7 * arm,
          right_grip: Math.min(1, 1.15 * seg(t, 0.15, 1.9)) * (1 - seg(t, d - 1.6, d - 0.15)),
          left_arm_1: 1.28 * arm, left_arm_4: 0.32 * arm,
          torso: -0.05 * arm - 0.06 * punch,
        });
      },
    },
    /* heart hands, raised overhead — GUI `heart` */
    heart: {
      dur: 8.0, headOwn: 0.3,
      pose: (t) => {
        const d = 8.0, up = win(t, 0.1, d - 0.1, 1.5);
        const hi = win(t, 3.4, d - 1.0, 1.1), brt = breath(t, 1.6, d - 1.6);
        const sN = up + 0.012 * brt;
        const a1 = -1.9 * sN - 0.1 * hi, a2 = (0.2 + 0.1 * hi) * sN;
        const a3 = 1.4 * sN * (1 - hi), a4 = (1.6 - 0.05 * hi) * sN;
        return fromGUI({
          left_arm_1: a1, right_arm_1: -a1, left_arm_2: a2, right_arm_2: -a2,
          left_arm_3: a3, right_arm_3: -a3, left_arm_4: a4, right_arm_4: -a4,
          left_arm_6: 0.3 * sN, right_arm_6: 0.3 * sN,
          left_grip: 0.25 * up, right_grip: 0.25 * up,
          torso: 0.06 * up,
        });
      },
    },
    /* happy bounce — GUI `happy` */
    happy: {
      dur: 6.0, headOwn: 0.3,
      pose: (t) => {
        const d = 6.0, upW = win(t, 0.1, d - 0.1, 1.25);
        const bounce = osc(t, 1.1, 0.9, d - 0.9, 0.7);
        const lift = 0.13 * upW + 0.11 * upW * Math.max(0, bounce);
        return fromGUI({
          left_arm_1: (-1.75 + 0.16 * bounce) * upW, right_arm_1: (1.75 + 0.19 * bounce) * upW,
          left_arm_2: 0.5 * upW, right_arm_2: -0.44 * upW,
          left_arm_4: (0.35 - 0.22 * bounce) * upW, right_arm_4: (-0.35 - 0.25 * bounce) * upW,
          left_grip: 0.05 * upW, right_grip: 0.05 * upW,
          lift_lower: lift, lift_upper: lift,
          torso: 0.07 * upW + 0.02 * bounce * upW,
        });
      },
    },
    /* sad slump — GUI `sad` (trimmed) */
    sad: {
      dur: 6.0, headOwn: 0.85,
      pose: (t) => {
        const d = 6.0, slump = win(t, 0.15, d - 0.15, 2.0);
        const sigh = breath(t, 1.4, d - 1.4, 0.16);
        const o = fromGUI({
          torso: -0.7 * slump - 0.05 * sigh,
          left_arm_1: 1.1 * slump, right_arm_1: -1.1 * slump,
          left_arm_2: 0.22 * slump, right_arm_2: -0.22 * slump,
          left_arm_4: 0.2 * slump + 0.03 * sigh, right_arm_4: -0.2 * slump - 0.03 * sigh,
          left_arm_6: 0.4 * slump, right_arm_6: 0.4 * slump,
          left_grip: 0.28 * slump, right_grip: 0.28 * slump,
        });
        o.neck_pitch = 0.5 * slump;                       // head hangs (rig can)
        return o;
      },
    },
    /* angry fists shaking overhead — GUI `angry` */
    angry: {
      dur: 5.0, headOwn: 0.4,
      pose: (t) => {
        const d = 5.0, tense = win(t, 0.1, d - 0.1, 1.3);
        const tremor = win(t, 1.2, d - 1.0, 0.4) * Math.sin(2 * Math.PI * 4.0 * t) * 0.045;
        const stomp = win(t, 2.1, 3.3, 0.35);
        const grip = Math.min(1, 1.2 * seg(t, 0.1, 2.0)) * (1 - seg(t, d - 1.7, d - 0.1));
        return fromGUI({
          left_arm_1: (-2.0 - 0.15 * stomp) * tense + tremor,
          right_arm_1: (2.0 + 0.15 * stomp) * tense - tremor,
          left_arm_2: 0.2 * tense, right_arm_2: -0.2 * tense,
          left_arm_3: -0.9 * tense, right_arm_3: 0.9 * tense,
          left_arm_4: 1.5 * tense + 2 * tremor, right_arm_4: -1.5 * tense - 2 * tremor,
          left_grip: grip, right_grip: grip,
          torso: -0.22 * tense - 0.06 * stomp,
          lift_lower: 0.05 * tense, lift_upper: 0.05 * tense,
        });
      },
    },
    /* groove — GUI dance, sway mapped onto the spin group */
    groove: {
      dur: 9.0, headOwn: 0.3,
      pose: (t) => {
        const d = 9.0, on = win(t, 0.1, d - 0.1, 1.0);
        const beat = osc(t, 0.85, 0.6, d - 0.7, 0.7);
        const off = osc(t, 0.85, 0.85, d - 0.7, 0.7);
        const pump = Math.max(0, beat), dip = Math.max(0, -beat);
        const lift = 0.1 * on + 0.1 * on * pump;
        const o = fromGUI({
          left_arm_1: (-0.85 - 0.42 * beat) * on, right_arm_1: (0.85 - 0.42 * off) * on,
          left_arm_2: 0.35 * on, right_arm_2: -0.35 * on,
          left_arm_4: (0.9 + 0.35 * beat) * on, right_arm_4: (-0.9 + 0.35 * off) * on,
          left_arm_5: -0.4 * on, right_arm_5: 0.4 * on,
          left_grip: 0.35 * on, right_grip: 0.35 * on,
          torso: (-0.14 - 0.1 * dip) * on,
          lift_lower: lift, lift_upper: lift,
        });
        o.__spin = 0.25 * osc(t, 0.425, 0.9, d - 1.0, 0.9);   // hip wiggle
        return o;
      },
    },
    /* pirouette — GUI `spin`: figure-skater arms + a full integrated turn */
    spinmove: {
      dur: 8.0, headOwn: 0.5,
      pose: (t) => {
        const d = 8.0, pose = win(t, 0.1, d - 0.1, 1.0), flare = win(t, 1.0, d - 1.0, 1.2);
        const o = fromGUI({
          left_arm_1: -0.55 * pose, right_arm_1: 0.55 * pose,
          left_arm_2: 1.15 * flare, right_arm_2: -1.15 * flare,
          left_arm_4: 0.25 * pose, right_arm_4: -0.25 * pose,
          left_arm_5: -0.6 * flare, right_arm_5: 0.6 * flare,
          left_grip: 0.1 * pose, right_grip: 0.1 * pose,
          torso: 0.05 * pose,
          lift_lower: 0.08 * flare, lift_upper: 0.08 * flare,
        });
        o.__spin = yawInt((u) => 0.78 * win(u, 0.9, d - 0.7, 1.0), t);
        return o;
      },
    },
    /* inspect hands — fingertips meet in front of the face, palms turning */
    inspect: {
      dur: 7.0, headOwn: 0.8,
      pose: (t) => {
        const d = 7.0, raise = win(t, 0.2, d - 0.2, 1.2);
        const turn = osc(t, 0.3, 2.0, 5.4, 0.8), brt = breath(t, 1.5, d - 1.2);
        const o = fromGUI({
          left_arm_1: -1.9 * raise, right_arm_1: 1.9 * raise,
          left_arm_2: 0.2 * raise, right_arm_2: -0.2 * raise,
          left_arm_3: 1.4 * raise, right_arm_3: -1.4 * raise,
          left_arm_4: 1.6 * raise, right_arm_4: -1.6 * raise,
          left_arm_5: 0.3 * turn * raise, right_arm_5: -0.3 * turn * raise,
          left_grip: 0.12 * raise, right_grip: 0.12 * raise,
          torso: -0.25 * raise - 0.02 * brt,
        });
        o.neck_pitch = 0.4 * raise;                     // actually look at them
        return o;
      },
    },
  });

  /* click playlists: repeated pokes cycle, never repeat back-to-back */
  const PLAYLISTS = {
    head: ['sneeze', 'inspect', 'sad', 'happy', 'heart'],
    hands: ['rps', 'peace', 'piano', 'finger', 'clap', 'heart', 'fistbump', 'shake', 'inspect', 'wavehi'],
    arms: ['flexit', 'wavehi', 'overhead', 'angry', 'happy', 'groove', 'clap', 'piano', 'heart'],
    base: ['rev', 'spinmove', 'ballet', 'groove'],
    torso: ['bow', 'ballet', 'groove', 'sad', 'happy'],
    lift: ['bow', 'happy', 'ballet', 'groove'],
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
      const wide = r.width / Math.max(1, r.height) >= 0.95;
      const hx = (r.left + r.width * (wide ? 0.72 : 0.5)) / innerWidth;
      const hy = (r.top + r.height * (wide ? 0.26 : 0.3)) / innerHeight;
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
