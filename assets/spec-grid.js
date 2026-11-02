/* The numbers, front and centre.
 *
 * The marketing cut of the active RA-L paper — eight figures that mean
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

  /* value, unit, label, provenance (shown in the expanded specification) */
  var HERO = [
    ['56', '', 'functional DOF', 'RA-L · MABEL specifications'],
    ['17', '× 2', 'DOF per hand', 'RA-L · Mechatronic design'],
    ['2.23', 'm', 'vertical reach', 'RA-L · Abstract and workspace'],
    ['≈3.5', 'kg', 'model load limit / arm', 'RA-L · MABEL specifications'],
    ['8,056', '$', 'parts subtotal', 'RA-L · Raspberry Pi 5 configuration'],
    ['150', 'ms', 'LAN glass to glass', 'RA-L · Teleoperation latency'],
    ['61.8', 'kg', 'mass', 'RA-L · MABEL specifications'],
    ['0.635', 'm', 'lift stroke', 'RA-L · Mechatronic design'],
  ];

  /* the rest of Table I, for the people who came for the loop rates */
  var FULL = [
    ['Functional DOF', '56'], ['Actuators', '59'],
    ['Lift stroke', '0 – 0.635 m'], ['Height', '1.16 – 1.80 m'],
    ['Vertical reach', '0 – 2.23 m'], ['Horizontal reach', '0.87 m from the shoulder'],
    ['Model load limit per arm', '≈3.5 kg (static torque bound)'], ['Mass', '61.8 kg'],
    ['Footprint', '0.49 × 0.49 m — support polygon 0.34 × 0.35 m'],
    ['Head', 'Stereo RGB on a 3-DOF neck'],
    ['Head and hand pose stream', '60 Hz'],
    ['Battery life', '≈4 hours'],
    ['Video latency (mean ± s.d.)', '137 ± 5 ms hotspot · 150 ± 0.2 ms LAN · 161 ± 16 ms Tailscale'],
    ['Public relay latency', '≈260 ms (partly derived)'],
    ['Parts subtotal', '$8,056 · Raspberry Pi 5, excluding optional sensors'],
  ];

  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  host.innerHTML =
    '<div class="sg-grid">' +
      HERO.map(function (h) {
        return '<div class="sg-tile" title="' + esc(h[3]) + '">' +
          '<b>' + (h[1] === '$' ? '<i>$</i>' : '') + esc(h[0]) +
            (h[1] && h[1] !== '$' ? '<i>' + esc(h[1]) + '</i>' : '') + '</b>' +
          '<span class="sg-lab">' + esc(h[2]) + '</span>' +
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
    '<p class="sg-src">Values follow the active RA-L paper’s specification ' +
      'table, mechatronic design, workspace and latency results. Reach is to ' +
      'the fingertip. The approximate 3.5 kg model load limit is a static ' +
      'torque bound, not a tested payload rating. The $8,056 parts subtotal ' +
      'uses a Raspberry Pi 5 and excludes optional sensors.</p></div>';

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
