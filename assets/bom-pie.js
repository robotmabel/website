/* ═══════════════════════════════════════════════════════════════════
   MABEL — BOM cost pie. Reads window.MABEL_BOM (bom_data.js): the eight
   core sections become slices; hovering a slice (or its table row) pins
   the centre readout and lists that section's actual components below.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var B = window.MABEL_BOM;
  var host = document.getElementById('bomPie');
  if (!B || !host) return;

  var COLORS = ['#C6301A', '#D9A13F', '#23577E', '#2E7D4F', '#8B5A3C', '#B77E1E', '#93220F', '#151820'];

  /* Two ways to read the same 49 lines: BY MODULE (which subsystem the money
     went into) and BY TYPE (what kind of thing it was), the way the printed
     BOM groups them. Both are derived from the same records, so the totals
     always agree. */
  var TYPE_NAME = {
    actuation: 'Actuators & motion', structure: 'Structure & hardware',
    power: 'Power & wiring', data: 'Compute & data', misc: 'Consumables & misc'
  };
  var TYPE_ORDER = ['actuation', 'structure', 'power', 'data', 'misc'];

  function byModule() {
    return B.core_sections.map(function (s) {
      return { name: s.name, usd: s.usd, share: s.share,
               match: function (l) { return l.section === s.name; } };
    });
  }
  function byType() {
    var sum = {};
    B.core.forEach(function (l) {
      var g = l.fgroup || 'misc';
      sum[g] = (sum[g] || 0) + l.ext_usd;
    });
    return TYPE_ORDER.filter(function (g) { return sum[g]; }).map(function (g) {
      return { name: TYPE_NAME[g] || g, usd: sum[g],
               share: sum[g] / B.core_total * 100,
               match: (function (gg) {
                 return function (l) { return (l.fgroup || 'misc') === gg; };
               })(g) };
    });
  }

  var GROUPS = { module: byModule(), type: byType() };
  var mode = 'module';
  var secs = GROUPS[mode];
  var total = B.core_total;
  var fmt = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };

  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cost breakdown of the $' + Math.round(total) + ' core bill of materials');

  var cx = 100, cy = 100, r = 74, w = 30;
  function arcPath(a0, a1) {
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return 'M' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1;
  }

  var slices = [];
  function buildSlices() {
    slices.forEach(function (p) { p.remove(); });
    slices = [];
    var a = -Math.PI / 2;
    secs.forEach(function (s, i) {
    var sweep = (s.usd / total) * Math.PI * 2;
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', arcPath(a + 0.012, a + sweep - 0.012));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', COLORS[i % COLORS.length]);
    p.setAttribute('stroke-width', w);
    p.style.cursor = 'pointer';
    p.style.transition = 'stroke-width 0.15s, opacity 0.2s';
      svg.appendChild(p);
      slices.push(p);
      p.addEventListener('mouseenter', (function (k) {
        return function () { pick(k); };
      })(i));
      a += sweep;
    });
  }
  host.appendChild(svg);

  var cVal = document.getElementById('bomPieVal');
  var cKey = document.getElementById('bomPieKey');
  var parts = document.getElementById('bomParts');
  var tbody = document.querySelector('#bomRows tbody');
  var rows = [];

  function buildRows() {
    if (!tbody) return;
    tbody.innerHTML = secs.map(function (s, i) {
      return '<tr data-sec="' + s.name.replace(/"/g, '&quot;') + '">' +
        '<td data-l="' + (mode === 'module' ? 'Subsystem' : 'Category') + '">' +
        '<span class="bom-dot" style="background:' + COLORS[i % COLORS.length] + '"></span>' +
        s.name + '</td>' +
        '<td data-l="Share">' + s.share.toFixed(0) + '%</td>' +
        '<td data-l="Cost" style="text-align:right;">' + fmt(s.usd) + '</td></tr>';
    }).join('') +
      '<tr class="best"><td data-l="Total">Core total</td><td></td>' +
      '<td class="hi" data-l="Cost" style="text-align:right;">' + fmt(total) + '</td></tr>';
    var head = document.querySelector('#bomRows thead th');
    if (head) head.textContent = (mode === 'module' ? 'Subsystem' : 'Category');
    rows = Array.prototype.slice.call(tbody.querySelectorAll('[data-sec]'));
    rows.forEach(function (r2, i) {
      r2.addEventListener('mouseenter', function () { pick(i); });
    });
  }

  function reset() {
    slices.forEach(function (p) { p.style.opacity = 1; p.setAttribute('stroke-width', w); });
    rows.forEach(function (r2) { r2.classList.remove('bom-row-hot'); });
    if (cVal) cVal.textContent = fmt(total);
    if (cKey) cKey.textContent = 'core bill · ' + B.core_line_count + ' line items';
    if (parts) parts.innerHTML = '<span class="bom-parts-hint">Hover a slice — or a row — to see what’s inside it.</span>';
  }

  function pick(i) {
    var s = secs[i];
    slices.forEach(function (p, k) {
      p.style.opacity = k === i ? 1 : 0.25;
      p.setAttribute('stroke-width', k === i ? w + 7 : w);
    });
    rows.forEach(function (r2, k) { r2.classList.toggle('bom-row-hot', k === i); });
    if (cVal) cVal.textContent = fmt(s.usd);
    if (cKey) cKey.textContent = s.name + ' · ' + s.share.toFixed(0) + '%';
    if (parts) {
      var lines = B.core.filter(s.match)
        .sort(function (x, y) { return y.ext_usd - x.ext_usd; });
      var top = lines.slice(0, 6).map(function (l) {
        return '<span class="bom-part"><b>' + fmt(l.ext_usd) + '</b> ' + l.item +
          (l.qty > 1 ? ' ×' + l.qty : '') + '</span>';
      }).join('');
      var more = lines.length > 6
        ? '<span class="bom-part dim">+ ' + (lines.length - 6) + ' more in the PDF</span>' : '';
      parts.innerHTML = top + more;
    }
  }

  function render() {
    secs = GROUPS[mode];
    buildSlices();
    buildRows();
    reset();
  }

  var seg = document.getElementById('bomGroupToggle');
  if (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.dataset.group === mode) return;
      mode = b.dataset.group;
      seg.querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      render();
    });
  }

  svg.addEventListener('mouseleave', reset);
  var tbl = document.getElementById('bomRows');
  if (tbl) tbl.addEventListener('mouseleave', reset);
  render();
})();
