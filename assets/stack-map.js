/* The stack, as a map rather than a ladder — and the paths that run through it.
 *
 * The diagram this replaces was a linear stack with ROS 2 sitting between the
 * controller and the firmware, which is not how MABEL is wired. Two rules from
 * the repo's own architecture table (root CLAUDE.md) decide the whole layout:
 *
 *   1. hardware_bridge is the SOLE HARDWARE OWNER. ROS is a thin DDS client
 *      and must never open a device. It is a consumer of state and a producer
 *      of nav goals — a peer of the apps, not a layer under them.
 *   2. controller/ is the SOLE GATE on anything that moves the robot. Every
 *      command source — headset, phone, browser, gamepad, Nav2, a policy —
 *      is a client of ONE wire contract and never publishes to a command
 *      topic directly.
 *
 * And one that is invisible until you look for it: VIDEO DOES NOT GO THROUGH
 * THE SERVER. It leaves the HAL for the devices directly, because putting a
 * 26 Hz camera stream through the same process that arbitrates commands is how
 * you get a control loop that stutters when someone opens a viewer.
 *
 * SIM AND REAL SHARE THE SPINE. That is the third thing this diagram exists to
 * show, and it is the whole reason the simulator is worth anything: every node
 * from a command source down through controller/ is the SAME CODE either way.
 * The split is one node wide — hardware_bridge owns motors, simulation_bridge
 * owns a MuJoCo plant — and everything above it cannot tell which is beneath.
 * A policy that drives the sim drives the robot without a line changed.
 */
(function () {
  'use strict';
  var host = document.getElementById('stackMap');
  if (!host) return;

  /* id, label, sub, column, row, kind, world, the tooltip body */
  var NODES = [
    ['vp', 'Vision Pro', 'ARKit · 27 joints/hand', 0, 0, 'in', 'both',
     'The headset streams head and both hands at 90 Hz. It is a client of the ' +
     'wire protocol like everything else here — it has no privileged path.'],
    ['ios', 'iPhone app', 'joysticks · task space', 0, 1, 'in', 'both',
     'Thumbsticks for the base, a task-space pad for the arms. Same wire, ' +
     'same gate, one-handed.'],
    ['web', 'Browser console', 'zero install', 0, 2, 'in', 'both',
     'The Control Center. Nothing to install and nothing privileged: it opens ' +
     'the same WebSocket the apps do.'],
    ['policy', 'Learned policy', 'ACT · diffusion · π₀', 0, 3, 'in', 'both',
     'A trained policy is a command SOURCE, not a special mode. It publishes ' +
     'the same messages a human does, and the envelope trims it the same way.'],
    ['nav', 'Nav2 goal', 'a pose on the map', 0, 4, 'in', 'both',
     'Nav2 plans a path and emits a goal. It never publishes a twist at the ' +
     'base — that would be a second gate, and there is only one.'],

    ['server', 'server/', 'wire protocol · arbitration', 1, 1, 'net', 'both',
     'The gateway. It owns the wire format, decides who is driving when two ' +
     'clients disagree, and fans state back out. It never imports mabel_hw.'],
    ['relay', 'Secure relay', 'rathole + Caddy', 1, 3, 'net', 'both',
     'A VPS with a public name, so you can drive the robot from outside its ' +
     'LAN without opening a port on it.'],

    ['retarget', 'Retargeter', 'operator → robot frame', 2, 0, 'ctl', 'both',
     'Human wrists are not MABEL wrists. An SE(3) cost puts the operator’s ' +
     'hand pose on a shorter, differently jointed arm, elbow included.'],
    ['wbc', 'Whole-body QP', '200 Hz · collision guard', 2, 1, 'ctl', 'both',
     'One quadratic program for arms, torso, lift and base together, with ' +
     'self-collision as a constraint rather than an afterthought.'],
    ['motion', 'Motion model', 'tip-over envelope', 2, 2, 'ctl', 'both',
     'The robot is tall and its base is small. This trims any command that ' +
     'would put the ZMP outside the support polygon — before it is sent.'],
    ['torque', 'Torque layer', '500 Hz · gravity FF', 2, 3, 'ctl', 'both',
     'Gravity and friction feed-forward on top of PD. Worth 251 mm → 24 mm of ' +
     'path error; the hardware page plots it.'],

    ['hal', 'hardware_bridge', 'sole hardware owner', 3, 0, 'hal', 'real',
     'THE ONLY THING IN THE REPO THAT OPENS A DEVICE. CAN to the actuators, ' +
     'serial to the neck and hands, USB to the cameras. Everything else asks it.'],
    ['simbridge', 'simulation_bridge', 'the plant, swapped', 3, 2, 'sim', 'sim',
     'The same contract as the HAL, backed by MuJoCo instead of motors. This ' +
     'node is the ENTIRE difference between driving the sim and driving the robot.'],
    ['percep', 'Perception', 'cameras · lidar · depth', 3, 4, 'sen', 'both',
     'Seven camera feeds, a 2-D lidar and depth. In sim the same topics come ' +
     'out of rendered sensors, so everything downstream is none the wiser.'],

    ['ros', 'ROS 2', 'a client, not a layer', 4, 0, 'ros', 'both',
     'ROS lives here because SLAM and Nav2 live here. It subscribes to the ' +
     'bridge’s topics; it does not sit under them and it owns no device.'],
    ['slam', 'SLAM', 'slam_toolbox · cuVSLAM', 4, 1, 'ros', 'both',
     'Builds and serves the map. Runs identically against simulated scans.'],
    ['loc', 'Localization', 'EKF · wheel + visual', 4, 2, 'ros', 'both',
     'Wheel odometry fused with visual odometry, so the QP always knows where ' +
     'the base actually is.'],

    ['fw', 'Firmware', 'Teensy · Pico · CAN', 5, 0, 'fw', 'real',
     'The microcontrollers. CAN at 1 Mbit to the DAMIAO actuators, TTL to the ' +
     '32 finger servos, and the swerve steering loop.'],
    ['robot', 'The robot', '59 actuators', 5, 1, 'bot', 'real',
     '56 functional degrees of freedom, 59 motors, and the only thing on this ' +
     'diagram that can hurt someone.'],
    ['mujoco', 'MuJoCo', 'the same 59 joints', 5, 3, 'simbot', 'sim',
     'The canonical MJCF — the model every other representation on this site ' +
     'is generated from. Forty scenes, scripted traffic, rendered sensors.'],
  ];

  var EDGES = [
    ['vp', 'server'], ['ios', 'server'], ['web', 'server'],
    ['policy', 'server'], ['nav', 'server'],
    ['relay', 'server'],
    ['server', 'retarget'], ['server', 'wbc'],
    ['retarget', 'wbc'], ['wbc', 'motion'], ['motion', 'torque'],
    ['torque', 'hal'], ['torque', 'simbridge'],
    ['hal', 'fw'], ['fw', 'robot'],
    /* The sensors are ON the robot, and VIDEO LEAVES THE HAL FOR THE DEVICES
       DIRECTLY — that is the invariant this diagram exists to show, and until
       now the "Video → your screen" route lit four nodes and NOT ONE EDGE,
       because neither of these links was drawn. A route with no line is not a
       route. */
    ['robot', 'percep'],
    ['hal', 'vp'], ['hal', 'ios'], ['hal', 'web'],
    ['simbridge', 'mujoco'],
    ['hal', 'percep'], ['simbridge', 'percep'],
    ['percep', 'ros'], ['hal', 'ros'], ['simbridge', 'ros'],
    ['ros', 'slam'], ['ros', 'loc'], ['slam', 'server'], ['loc', 'wbc'],
    ['hal', 'server'], ['simbridge', 'server'],
  ];

  /* the routes you can light up; every command source names one */
  var PATHS = [
    ['teleop', 'Vision Pro → torque', '#E4442A',
     ['vp', 'server', 'retarget', 'wbc', 'motion', 'torque', 'hal', 'fw', 'robot'],
     'A pinch becomes a wrist pose, the retargeter puts it on MABEL’s skeleton, ' +
     'the QP solves the whole body, the motion model trims what would tip it, and ' +
     'the HAL is the only thing that touches a motor.'],
    ['auto', 'Policy → torque', '#23577E',
     ['policy', 'server', 'wbc', 'motion', 'torque', 'hal', 'fw', 'robot'],
     'A policy is a command SOURCE like any other. It does not get its own path ' +
     'to the hardware, and it does not get to skip the envelope.'],
    ['phone', 'iPhone → torque', '#C6301A',
     ['ios', 'server', 'wbc', 'motion', 'torque', 'hal', 'fw', 'robot'],
     'Thumbsticks for the base, a task-space pad for the arms. No retargeter ' +
     'in this one — you are commanding the robot\u2019s frame directly — but ' +
     'the same gate and the same envelope.'],
    ['console', 'Browser → torque', '#2F6F8F',
     ['web', 'server', 'wbc', 'motion', 'torque', 'hal', 'fw', 'robot'],
     'Nothing to install. The Control Center opens the same WebSocket the ' +
     'apps do and gets exactly the same privileges: none.'],
    ['navp', 'Nav goal → wheels', '#2E7D4F',
     ['nav', 'server', 'wbc', 'motion', 'torque', 'hal', 'fw', 'robot'],
     'Nav2 plans, but it never publishes a twist at the base. The goal goes ' +
     'through the same gate everything else does.'],
    ['sim', 'The same command → sim', '#7A3E8F',
     ['vp', 'server', 'retarget', 'wbc', 'motion', 'torque', 'simbridge', 'mujoco'],
     'Compare this route with the first one: identical until the last two nodes. ' +
     'Everything above simulation_bridge is the same code, so a policy trained ' +
     'in MuJoCo drives the robot without a line changed.'],
    ['state', 'State → your screen', '#D9A13F',
     ['robot', 'fw', 'hal', 'server', 'vp'],
     'Joints, odometry and the map come back up the same spine. 59 actuators ' +
     'at 42 Hz on the wire.'],
    ['video', 'Video → your screen', '#8B5A3C',
     ['robot', 'percep', 'hal', 'vp'],
     'Video does NOT go through the gateway. Putting a 26 Hz camera stream ' +
     'through the process that arbitrates commands is how a control loop ' +
     'starts stuttering when somebody opens a viewer.'],
    ['map', 'Sensors → a map', '#2F6F8F',
     ['robot', 'percep', 'hal', 'ros', 'slam', 'server'],
     'ROS earns its place here: it is where SLAM and Nav2 live. It is a client ' +
     'of the HAL, never an owner of a device.'],
  ];

  /* Clicking a node prefers the route that STARTS there — you point at the
     thing you are holding and ask where it goes — then any route through it.
     Nodes on no route at all (the relay, SLAM, localization) are not dead:
     they light their own neighbourhood instead, so every block does
     something when clicked. */
  function pathFor(id) {
    for (var i = 0; i < PATHS.length; i++) {
      if (PATHS[i][3][0] === id) return PATHS[i][0];
    }
    for (var j = 0; j < PATHS.length; j++) {
      if (PATHS[j][3].indexOf(id) >= 0) return PATHS[j][0];
    }
    return null;
  }

  var COLS = ['Command sources', 'Network', 'controller/', 'The bridge',
              'ROS 2 · perception', 'Plant'];

  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var W = 1240, H = 640, CW = W / COLS.length, NW = 176, NH = 56;
  function pos(n) {
    var col = n[3];
    var inCol = NODES.filter(function (m) { return m[3] === col; });
    var i = inCol.indexOf(n);
    var top = 92, bot = H - 44;
    return { x: col * CW + CW / 2,
             y: top + (bot - top) * (i + 0.5) / inCol.length };
  }
  var P = {};
  NODES.forEach(function (n) { P[n[0]] = pos(n); });
  var BY_ID = {};
  NODES.forEach(function (n) { BY_ID[n[0]] = n; });

  function edgePath(a, b) {
    var p = P[a], q = P[b];
    if (!p || !q) return '';
    var x1 = p.x + (q.x > p.x ? NW / 2 : (q.x < p.x ? -NW / 2 : 0));
    var x2 = q.x + (q.x > p.x ? -NW / 2 : (q.x < p.x ? NW / 2 : 0));
    if (Math.abs(q.x - p.x) < 1) {           // same column: bow out to the side
      var s = NW / 2 + 22;
      return 'M' + (p.x + s * 0.2) + ' ' + p.y + ' C' + (p.x + s) + ' ' + p.y +
             ',' + (q.x + s) + ' ' + q.y + ',' + (q.x + s * 0.2) + ' ' + q.y;
    }
    var mx = (x1 + x2) / 2;
    return 'M' + x1 + ' ' + p.y + ' C' + mx + ' ' + p.y + ',' +
           mx + ' ' + q.y + ',' + x2 + ' ' + q.y;
  }

  var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="sm-svg" ' +
             'role="img" aria-label="MABEL\'s software stack as a graph">'];
  COLS.forEach(function (c, i) {
    svg.push('<text class="sm-col" x="' + (i * CW + CW / 2) + '" y="34">' +
             esc(c.toUpperCase()) + '</text>');
  });
  /* The sim/real split is a PLACE on the map, so draw it as one. A shaded band
     over the right three columns was the first attempt and it lied: ROS, SLAM,
     localization and perception all sit there and are shared. The honest mark
     is a single line at the one seam that exists — between controller/ and the
     bridge — with the per-node REAL/SIM tags carrying the rest. */
  var SEAM = 3 * CW;
  svg.push('<path class="sm-seam" d="M' + SEAM + ' 52 V' + (H - 8) + '"/>');
  svg.push('<text class="sm-seamlab sm-seam-l" x="' + (SEAM - 14) + '" y="72">' +
           'ONE CODEBASE ↑ SHARED BY SIM AND REAL</text>');
  svg.push('<text class="sm-seamlab" x="' + (SEAM + 14) + '" y="72">' +
           'THE PLANT SWAPS HERE →</text>');
  EDGES.forEach(function (e) {
    svg.push('<path class="sm-edge" data-a="' + e[0] + '" data-b="' + e[1] +
             '" d="' + edgePath(e[0], e[1]) + '"/>');
  });
  NODES.forEach(function (n) {
    var p = P[n[0]];
    svg.push('<g class="sm-node k-' + n[5] + ' w-' + n[6] + '" data-id="' + n[0] +
      '" tabindex="0" role="button" aria-label="' + esc(n[1]) + '" ' +
      'transform="translate(' + (p.x - NW / 2) + ',' + (p.y - NH / 2) + ')">' +
      '<rect width="' + NW + '" height="' + NH + '" rx="9"/>' +
      '<text class="sm-lab" x="' + NW / 2 + '" y="22">' + esc(n[1]) + '</text>' +
      '<text class="sm-sub" x="' + NW / 2 + '" y="39">' + esc(n[2]) + '</text>' +
      (n[6] !== 'both'
        ? '<text class="sm-only" x="' + (NW - 8) + '" y="' + (NH - 6) + '">' +
          (n[6] === 'sim' ? 'SIM' : 'REAL') + '</text>'
        : '') +
      '</g>');
  });
  svg.push('</svg>');

  host.innerHTML =
    '<div class="sm-head">' +
      '<span class="sm-kicker">The stack · click anything</span>' +
      '<h3 class="sm-title">Where does a command actually go?</h3>' +
    '</div>' +
    '<div class="sm-paths">' +
      PATHS.map(function (p) {
        return '<button type="button" class="sm-chip" data-p="' + p[0] +
               '" style="--c:' + p[2] + '">' + esc(p[1]) + '</button>';
      }).join('') +
      '<button type="button" class="sm-chip sm-clear">show everything</button>' +
    '</div>' +
    '<p class="sm-say">Pick a route — or click any block — and the whole path ' +
      'lights up. Two rules shape this graph: <b>hardware_bridge is the only ' +
      'thing that touches a motor</b>, and <b>controller/ is the only gate on ' +
      'anything that moves the robot</b> — so ROS 2 is a client here, not a ' +
      'layer underneath. <b>Everything left of the dashed seam is shared by ' +
      'sim and real</b> — the plant is the only thing that swaps.</p>' +
    '<div class="sm-stage">' + svg.join('') +
      '<div class="sm-tip" hidden></div>' +
    '</div>' +
    '<div class="sm-key">' +
      '<span class="sm-k w-both"><i></i>shared — same code either way</span>' +
      '<span class="sm-k w-real"><i></i>real robot only</span>' +
      '<span class="sm-k w-sim"><i></i>simulation only</span>' +
    '</div>' +
    '<p class="sm-note"></p>';

  var stage = host.querySelector('.sm-stage');
  var note = host.querySelector('.sm-note');
  var tip = host.querySelector('.sm-tip');

  /* A node on no named route lights its own NEIGHBOURHOOD — itself and
     everything it connects to. Localization, SLAM and the secure relay are
     real parts of this system that no single command path passes through, and
     a block that does nothing when clicked reads as broken rather than as
     "not on a route". */
  function focus(id) {
    var n = BY_ID[id];
    if (!n) return;
    var near = {};
    near[id] = 1;
    EDGES.forEach(function (e) {
      if (e[0] === id) near[e[1]] = 1;
      if (e[1] === id) near[e[0]] = 1;
    });
    stage.classList.add('lit');
    stage.querySelectorAll('.sm-node').forEach(function (x) {
      x.classList.toggle('on', !!near[x.dataset.id]);
    });
    stage.querySelectorAll('.sm-edge').forEach(function (e) {
      var used = e.dataset.a === id || e.dataset.b === id;
      e.classList.toggle('on', used);
      e.style.stroke = used ? '#7A3E8F' : '';
    });
    host.querySelectorAll('.sm-chip').forEach(function (c) {
      c.classList.remove('on');
    });
    var names = Object.keys(near).filter(function (k) { return k !== id; })
      .map(function (k) { return BY_ID[k][1]; });
    note.innerHTML = '<b style="color:#7A3E8F">' + esc(n[1]) + '</b>' +
      esc(n[7]) + ' Connects to ' + esc(names.join(', ')) + '.';
    note.hidden = false;
    current = null;
  }

  var current = null;

  function show(id) {
    var p = PATHS.filter(function (x) { return x[0] === id; })[0];
    current = p ? id : null;
    stage.classList.toggle('lit', !!p);
    var on = p ? p[3] : [];
    stage.querySelectorAll('.sm-node').forEach(function (n) {
      n.classList.toggle('on', on.indexOf(n.dataset.id) >= 0);
    });
    /* An edge lights when its two ends are adjacent on the route IN EITHER
       ORDER. The graph draws ONE line per connection, so a return path —
       state coming back up the spine, video coming out of the HAL — travels
       along lines that were drawn in the outbound direction. Matching only
       a→b left "State → your screen" with its last hop unlit and "Video →
       your screen" with no line at all. */
    stage.querySelectorAll('.sm-edge').forEach(function (e) {
      var used = false;
      for (var k = 0; p && k < on.length - 1; k++) {
        if ((on[k] === e.dataset.a && on[k + 1] === e.dataset.b) ||
            (on[k] === e.dataset.b && on[k + 1] === e.dataset.a)) {
          used = true; break;
        }
      }
      e.classList.toggle('on', used);
      e.style.stroke = used ? p[2] : '';
    });
    host.querySelectorAll('.sm-chip').forEach(function (c) {
      c.classList.toggle('on', !!p && c.dataset.p === id);
    });
    note.innerHTML = p ? '<b style="color:' + p[2] + '">' + esc(p[1]) + '</b>' +
                         esc(p[4]) : '';
    note.hidden = !p;
  }

  host.querySelector('.sm-paths').addEventListener('click', function (e) {
    var b = e.target.closest('.sm-chip');
    if (!b) return;
    show(b.classList.contains('sm-clear') ? null : b.dataset.p);
  });

  /* Every block is a control. Clicking a command source is the obvious gesture
     — you point at the thing you are holding and ask where it goes — so it
     lights that source's route rather than doing nothing. */
  stage.addEventListener('click', function (e) {
    var g = e.target.closest('.sm-node');
    if (!g) return;
    var p = pathFor(g.dataset.id);
    if (p) show(p); else focus(g.dataset.id);
  });
  stage.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var g = e.target.closest('.sm-node');
    if (!g) return;
    e.preventDefault();
    var p = pathFor(g.dataset.id);
    if (p) show(p); else focus(g.dataset.id);
  });

  var WORLD = { both: ['Shared', 'The same code drives the robot and the sim.'],
                real: ['Real robot only', 'No counterpart in simulation.'],
                sim: ['Simulation only', 'Stands in for the hardware below it.'] };

  function tipFor(g) {
    var n = BY_ID[g.dataset.id];
    if (!n) return;
    var w = WORLD[n[6]];
    var routes = PATHS.filter(function (p) { return p[3].indexOf(n[0]) >= 0; });
    tip.innerHTML =
      '<b>' + esc(n[1]) + '</b><span class="sm-tip-sub">' + esc(n[2]) + '</span>' +
      '<p>' + esc(n[7]) + '</p>' +
      '<span class="sm-tip-w w-' + n[6] + '"><i></i>' + esc(w[0]) + ' — ' +
        esc(w[1]) + '</span>' +
      (routes.length
        ? '<span class="sm-tip-r">on ' + routes.length + ' route' +
          (routes.length > 1 ? 's' : '') + ': ' +
          routes.map(function (p) { return esc(p[1]); }).join(' · ') + '</span>'
        : '');
    tip.hidden = false;
    var sb = stage.getBoundingClientRect(), b = g.getBoundingClientRect();
    var left = b.left - sb.left + b.width / 2 - tip.offsetWidth / 2;
    tip.style.left = Math.max(8, Math.min(sb.width - tip.offsetWidth - 8, left)) + 'px';
    var above = b.top - sb.top - tip.offsetHeight - 12;
    tip.style.top = (above > 8 ? above : b.bottom - sb.top + 12) + 'px';
  }

  stage.addEventListener('pointerover', function (e) {
    var g = e.target.closest('.sm-node');
    if (g) tipFor(g); else tip.hidden = true;
  });
  stage.addEventListener('focusin', function (e) {
    var g = e.target.closest('.sm-node');
    if (g) tipFor(g);
  });
  stage.addEventListener('pointerleave', function () { tip.hidden = true; });
  stage.addEventListener('focusout', function () { tip.hidden = true; });

  show(PATHS[0][0]);

  window.__stackMap = {
    paths: PATHS, nodes: NODES, edges: EDGES, show: show, pathFor: pathFor,
    focus: focus,
    hover: function (id) {
      var g = stage.querySelector('.sm-node[data-id="' + id + '"]');
      if (g) tipFor(g);
      return !tip.hidden && tip.textContent.length;
    },
    clickNode: function (id) {
      var g = stage.querySelector('.sm-node[data-id="' + id + '"]');
      if (!g) return null;
      g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    },
    lit: function () {
      return [].slice.call(stage.querySelectorAll('.sm-node.on'))
               .map(function (n) { return n.dataset.id; });
    },
    litEdges: function () { return stage.querySelectorAll('.sm-edge.on').length; },
    worlds: function () {
      var w = {};
      NODES.forEach(function (n) { w[n[6]] = (w[n[6]] || 0) + 1; });
      return w;
    }
  };
})();
