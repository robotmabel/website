/* The numbers, front and centre.
 *
 * The marketing cut of the paper's Table I — the ten figures that mean
 * something to someone deciding whether to build one, as tiles rather than a
 * spec sheet. The full table is one click away for the people who want the
 * loop rates and the camera layout, so nothing is hidden, only ranked.
 *
 * Every value is the paper's, and every one of them says where it came from:
 * a spec sheet whose numbers you cannot trace is a brochure.
 */
(function () {
  'use strict';
  var host = document.getElementById('specGrid');
  if (!host) return;

  /* value, unit, label, the line under it, and the file it comes from */
  var HERO = [
    ['56', '', 'functional DOF', '59 actuators — the hands account for 34 of them',
     'simulation/mabel_mujoco/models/mabel_full.xml'],
    ['17', '× 2', 'DOF per hand', 'Tendon-routed ORCA hands. Most platforms ship a 1-DOF jaw',
     'BOM §4'],
    ['2.23', 'm', 'vertical reach', 'Floor socket to top shelf, over the 0.635 m lift stroke',
     'papers/iros2026 · Table I'],
    ['5.4', 'kg', 'payload per arm', 'Static actuator-torque limit at full extension',
     'Table I'],
    ['9,670', '$', 'bill of materials', 'As built, at the recommended tier. No machine shop',
     'BOM/README.md'],
    ['82', 'ms', 'glass to glass', 'Camera photon to operator pixel over a LAN',
     'experiments/glass_to_glass'],
    ['61.8', 'kg', 'mass', 'On a 0.49 × 0.49 m footprint, fully untethered at 24 V',
     'mabel_full.xml'],
    ['MIT', '', 'licence', 'Hardware, firmware, control, simulation — all of it',
     'LICENSE'],
  ];

  /* the rest of Table I, for the people who came for the loop rates */
  var FULL = [
    ['Functional DOF', '56'], ['Actuators', '59'],
    ['Lift stroke', '0 – 0.635 m'], ['Height', '1.16 – 1.80 m'],
    ['Vertical reach', '0 – 2.23 m'], ['Horizontal reach', '0.87 m from the shoulder'],
    ['Payload per arm', '5.4 kg'], ['Mass', '61.8 kg'],
    ['Footprint', '0.49 × 0.49 m — support polygon 0.34 × 0.35 m'],
    ['Head', 'Stereo RGB on a 3-DOF neck'],
    ['Wrist / chest', '2 × RGB-D, 1 × RGB'],
    ['Base', '2 × RGB-D, 2-D lidar'],
    ['Compute', 'NVIDIA Jetson — Orin Nano to AGX Thor by tier'],
    ['Power', '24 V, 2 packs, untethered'],
    ['Loop rates', '42 / 200 / 500 Hz — retargeting, QP, torque'],
    ['Video latency', '49 / 82 / 362 ms — same host, LAN, public relay'],
    ['Bill of materials', '$9,670 recommended · $8,722 essential'],
    ['Licence', 'MIT'],
  ];

  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  host.innerHTML =
    '<div class="sg-grid">' +
      HERO.map(function (h) {
        return '<div class="sg-tile" title="' + esc(h[4]) + '">' +
          '<b>' + (h[1] === '$' ? '<i>$</i>' : '') + esc(h[0]) +
            (h[1] && h[1] !== '$' ? '<i>' + esc(h[1]) + '</i>' : '') + '</b>' +
          '<span class="sg-lab">' + esc(h[2]) + '</span>' +
          '<span class="sg-sub">' + esc(h[3]) + '</span>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<button class="sg-more" type="button" aria-expanded="false">' +
      'Every number →</button>' +
    '<div class="sg-full" hidden><table class="sg-table"><tbody>' +
      FULL.map(function (r) {
        return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
      }).join('') +
    '</tbody></table>' +
    '<p class="sg-src">Derived from the canonical MuJoCo model, the bill of ' +
      'materials, and the measured latency runs — the same sources the paper ' +
      'uses. Reach figures are to the fingertip; payload is the static ' +
      'actuator-torque limit, not a sustained rating.</p></div>';

  var btn = host.querySelector('.sg-more');
  var full = host.querySelector('.sg-full');
  btn.addEventListener('click', function () {
    var open = full.hidden;
    full.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Fewer numbers ←' : 'Every number →';
  });

  window.__specGrid = { hero: HERO.length, full: FULL.length,
                        open: function () { return !full.hidden; } };
})();
