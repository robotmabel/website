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
 * Click a path and it lights the whole route, so "how does a Vision Pro pinch
 * become torque?" has a visible answer instead of a paragraph.
 */
(function () {
  'use strict';
  var host = document.getElementById('stackMap');
  if (!host) return;

  /* id, label, sub, column, row, kind */
  var NODES = [
    ['vp',      'Vision Pro',        'ARKit · 27 joints/hand',   0, 0, 'in'],
    ['ios',     'iPhone app',        'joysticks · task space',   0, 1, 'in'],
    ['web',     'Browser console',   'zero install',             0, 2, 'in'],
    ['policy',  'Learned policy',    'ACT · diffusion · π₀',     0, 3, 'in'],
    ['nav',     'Nav2 goal',         'a pose on the map',        0, 4, 'in'],

    ['server',  'server/',           'wire protocol · arbitration', 1, 1, 'net'],
    ['relay',   'Secure relay',      'rathole + Caddy', 1, 3, 'net'],

    ['retarget','Retargeter',        'operator → robot frame', 2, 0, 'ctl'],
    ['wbc',     'Whole-body QP',     '200 Hz · collision guard',  2, 1, 'ctl'],
    ['motion',  'Motion model',      'tip-over envelope', 2, 2, 'ctl'],
    ['torque',  'Torque layer',      '500 Hz · gravity FF', 2, 3, 'ctl'],

    ['hal',     'hardware_bridge',   'sole hardware owner',   3, 1, 'hal'],
    ['percep',  'Perception',        'cameras · lidar · depth',   3, 3, 'sen'],

    ['ros',     'ROS 2',             'a client, not a layer', 4, 0, 'ros'],
    ['slam',    'SLAM',              'slam_toolbox · cuVSLAM',    4, 1, 'ros'],
    ['loc',     'Localization',      'EKF · wheel + visual',      4, 2, 'ros'],

    ['fw',      'Firmware',          'Teensy · Pico · CAN', 5, 1, 'fw'],
    ['robot',   'The robot',         '59 actuators',              5, 2, 'bot'],
  ];

  /* from, to, which paths use it */
  var EDGES = [
    ['vp', 'server'], ['ios', 'server'], ['web', 'server'],
    ['policy', 'server'], ['nav', 'server'],
    ['relay', 'server'],
    ['server', 'retarget'], ['server', 'wbc'],
    ['retarget', 'wbc'], ['wbc', 'motion'], ['motion', 'torque'],
    ['torque', 'hal'],
    ['hal', 'fw'], ['fw', 'robot'],
    ['robot', 'fw'], ['fw', 'hal'],
    ['hal', 'percep'], ['percep', 'ros'], ['hal', 'ros'],
    ['ros', 'slam'], ['ros', 'loc'], ['slam', 'server'], ['loc', 'wbc'],
    ['hal', 'server'],
  ];

  /* the routes you can light up */
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
    ['navp', 'Nav goal → wheels', '#2E7D4F',
     ['nav', 'server', 'wbc', 'motion', 'torque', 'hal', 'fw', 'robot'],
     'Nav2 plans, but it never publishes a twist at the base. The goal goes ' +
     'through the same gate everything else does.'],
    ['state', 'State → your screen', '#D9A13F',
     ['robot', 'fw', 'hal', 'server', 'vp'],
     'Joints, odometry and the map come back up the same spine. 59 actuators ' +
     'at 42 Hz on the wire.'],
    ['video', 'Video → your screen', '#8B5A3C',
     ['robot', 'percep', 'hal', 'vp'],
     'Video does NOT go through the gateway. Putting a 26 Hz camera stream ' +
     'through the process that arbitrates commands is how a control loop ' +
     'starts stuttering when somebody opens a viewer.'],
    ['map', 'Sensors → a map', '#7A3E8F',
     ['robot', 'percep', 'hal', 'ros', 'slam', 'server'],
     'ROS earns its place here: it is where SLAM and Nav2 live. It is a client ' +
     'of the HAL, never an owner of a device.'],
  ];

  var COLS = ['Command sources', 'Network', 'controller/', 'The bridge',
              'ROS 2 · perception', 'Hardware'];

  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var W = 1240, H = 580, CW = W / COLS.length, NW = 176, NH = 56;
  function pos(n) {
    var col = n[3], row = n[4];
    var inCol = NODES.filter(function (m) { return m[3] === col; });
    var i = inCol.indexOf(n);
    var top = 76, bot = H - 40;
    var y = top + (bot - top) * (i + 0.5) / inCol.length;
    return { x: col * CW + CW / 2, y: y };
  }
  var P = {};
  NODES.forEach(function (n) { P[n[0]] = pos(n); });

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
  EDGES.forEach(function (e) {
    svg.push('<path class="sm-edge" data-a="' + e[0] + '" data-b="' + e[1] +
             '" d="' + edgePath(e[0], e[1]) + '"/>');
  });
  NODES.forEach(function (n) {
    var p = P[n[0]];
    svg.push('<g class="sm-node k-' + n[5] + '" data-id="' + n[0] + '" ' +
      'transform="translate(' + (p.x - NW / 2) + ',' + (p.y - NH / 2) + ')">' +
      '<rect width="' + NW + '" height="' + NH + '" rx="9"/>' +
      '<text class="sm-lab" x="' + NW / 2 + '" y="22">' + esc(n[1]) + '</text>' +
      '<text class="sm-sub" x="' + NW / 2 + '" y="39">' + esc(n[2]) + '</text>' +
      '</g>');
  });
  svg.push('</svg>');

  host.innerHTML =
    '<div class="sm-head">' +
      '<span class="sm-kicker">The stack · click a path</span>' +
      '<h3 class="sm-title">Where does a command actually go?</h3>' +
    '</div>' +
    '<div class="sm-paths">' +
      PATHS.map(function (p) {
        return '<button type="button" class="sm-chip" data-p="' + p[0] +
               '" style="--c:' + p[2] + '">' + esc(p[1]) + '</button>';
      }).join('') +
      '<button type="button" class="sm-chip sm-clear">show everything</button>' +
    '</div>' +
    '<p class="sm-say">Pick a route and the whole path lights up. Two rules ' +
      'shape this graph: <b>hardware_bridge is the only thing that touches a ' +
      'motor</b>, and <b>controller/ is the only gate on anything that moves ' +
      'the robot</b> — so ROS 2 is a client here, not a layer underneath.</p>' +
    '<div class="sm-stage">' + svg.join('') + '</div>' +
    '<p class="sm-note"></p>';

  var stage = host.querySelector('.sm-stage');
  var note = host.querySelector('.sm-note');

  function show(id) {
    var p = PATHS.filter(function (x) { return x[0] === id; })[0];
    stage.classList.toggle('lit', !!p);
    var on = p ? p[3] : [];
    stage.querySelectorAll('.sm-node').forEach(function (n) {
      n.classList.toggle('on', on.indexOf(n.dataset.id) >= 0);
    });
    stage.querySelectorAll('.sm-edge').forEach(function (e) {
      var i = on.indexOf(e.dataset.a), j = on.indexOf(e.dataset.b);
      var used = p && i >= 0 && j === i + 1;
      e.classList.toggle('on', !!used);
      if (used) e.style.stroke = p[2]; else e.style.stroke = '';
    });
    host.querySelectorAll('.sm-chip').forEach(function (c) {
      c.classList.toggle('on', p && c.dataset.p === id);
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
  show(PATHS[0][0]);

  window.__stackMap = {
    paths: PATHS, nodes: NODES, show: show,
    lit: function () {
      return [].slice.call(stage.querySelectorAll('.sm-node.on'))
               .map(function (n) { return n.dataset.id; });
    },
    litEdges: function () {
      return stage.querySelectorAll('.sm-edge.on').length;
    }
  };
})();
