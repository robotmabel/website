/* The landscape MABEL is built into — 21 platforms, filterable.
 *
 * assets/data/platforms.json is the paper's own survey
 * (papers/ral2026/Tables/02_related_comparison.tex, July 2026), including the
 * rows the printed figure abridges away and the single-arm open platforms the
 * paper discusses in prose.
 *
 * The headline claim is CHECKED, not asserted: the verdict line counts the rows
 * that survive the current filter, so if a platform ever appears that is open,
 * hand-dexterous, neck-articulated and under $10k, the page says so by itself
 * rather than continuing to claim otherwise.
 */
(function () {
  'use strict';
  var host = document.getElementById('platformTable');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var money = function (c) { return c == null ? 'n.d.' : '$' + c + 'k'; };

  /* each filter is a predicate, so adding one is a line rather than a branch */
  var FILTERS = [
    ['open', 'Open source', function (r) { return r.open; }],
    ['closed', 'Commercial', function (r) { return !r.open; }],
    ['bimanual', 'Two arms', function (r) { return r.n_arms >= 2; }],
    ['single', 'One arm', function (r) { return r.n_arms < 2; }],
    ['holo', 'Holonomic', function (r) { return r.holo === true; }],
    ['mobile', 'Mobile base', function (r) { return r.mobile; }],
    ['hands', 'Real hand', function (r) { return r.hand > 1; }],
    ['neck', 'Actuated neck', function (r) { return r.neck >= 1; }],
    ['cheap', 'Under $10k', function (r) { return r.cost != null && r.cost < 10; }],
  ];

  fetch('assets/data/platforms.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="pt-err">Could not load the survey.</p>';
      console.error('[platform-table]', e);
    });

  function build(D) {
    var on = {};
    var sortKey = 'cost', sortDir = 1;

    host.innerHTML =
      '<div class="pt-head">' +
        '<span class="pt-kicker">The landscape · surveyed ' + esc(D.surveyed) + '</span>' +
        '<h3 class="pt-title">Who else does this?</h3>' +
      '</div>' +
      '<div class="pt-filters">' +
        FILTERS.map(function (f) {
          return '<button type="button" class="pt-chip" data-f="' + f[0] + '">' +
                 esc(f[1]) + '</button>';
        }).join('') +
        '<button type="button" class="pt-clear">clear</button>' +
      '</div>' +
      '<p class="pt-verdict"></p>' +
      '<div class="pt-scroll"><table class="pt-table"><thead><tr>' +
        [['name', 'Platform'], ['base', 'Base'], ['arms', 'Arms'],
         ['hand', 'Hand DOF'], ['neck', 'Neck'], ['lift', 'Lift / torso'],
         ['cost', 'Cost'], ['open', 'Open']].map(function (c) {
          return '<th data-sort="' + c[0] + '">' + esc(c[1]) + '</th>';
        }).join('') +
      '</tr></thead><tbody></tbody></table></div>' +
      '<p class="pt-src">' + esc(D.cost_note) + '. Source: <code>' +
        esc(D.source) + '</code>.</p>';

    var tbody = host.querySelector('tbody');
    var verdict = host.querySelector('.pt-verdict');

    function active() {
      return FILTERS.filter(function (f) { return on[f[0]]; });
    }
    function keep(r) {
      return active().every(function (f) { return f[2](r); });
    }

    function render() {
      var rows = D.platforms.filter(keep);
      rows.sort(function (a, b) {
        var x = a[sortKey], y = b[sortKey];
        if (sortKey === 'cost') { x = x == null ? 1e9 : x; y = y == null ? 1e9 : y; }
        if (typeof x === 'string') return sortDir * x.localeCompare(y);
        return sortDir * ((x === true ? 1 : x === false ? 0 : x) -
                          (y === true ? 1 : y === false ? 0 : y));
      });
      /* ours always sits last so the eye lands on it after the field */
      rows.sort(function (a, b) { return (a.ours ? 1 : 0) - (b.ours ? 1 : 0); });

      tbody.innerHTML = rows.map(function (r) {
        return '<tr class="' + (r.ours ? 'ours' : '') + '">' +
          '<td class="pt-name"><b>' + esc(r.name) + '</b>' +
            '<i>' + r.year + ' · ' + esc(r.focus) + '</i>' +
            (r.note ? '<em>' + esc(r.note) + '</em>' : '') + '</td>' +
          '<td>' + esc(r.base) +
            (r.holo === true ? ' <span class="pt-y">holo</span>' : '') + '</td>' +
          '<td class="pt-n">' + esc(r.arms) + '</td>' +
          '<td class="pt-n' + (r.hand > 1 ? ' hi' : '') + '">' + r.hand + '</td>' +
          '<td class="pt-n' + (r.neck >= 1 ? ' hi' : '') + '">' + r.neck + '</td>' +
          '<td>' + esc(r.lift) + '</td>' +
          '<td class="pt-n' + (r.cost != null && r.cost < 10 ? ' hi' : '') + '">' +
            money(r.cost) + '</td>' +
          '<td>' + (r.open ? '<span class="pt-open">open</span>'
                           : '<span class="pt-closed">closed</span>') + '</td>' +
        '</tr>';
      }).join('');

      var others = rows.filter(function (r) { return !r.ours; }).length;
      var names = active().map(function (f) { return f[1].toLowerCase(); });
      verdict.innerHTML = names.length
        ? '<b>' + others + '</b> of ' + (D.platforms.length - 1) +
          ' other platforms are ' + names.join(' + ') +
          (others === 0 ? ' — <b>only MABEL</b>.' : '.')
        : '<b>' + (D.platforms.length - 1) + '</b> other platforms surveyed. ' +
          'Try <b>Open source + Real hand + Actuated neck + Under $10k</b>.';
    }

    host.querySelector('.pt-filters').addEventListener('click', function (e) {
      if (e.target.closest('.pt-clear')) { on = {}; }
      else {
        var b = e.target.closest('.pt-chip');
        if (!b) return;
        on[b.dataset.f] = !on[b.dataset.f];
      }
      host.querySelectorAll('.pt-chip').forEach(function (c) {
        c.classList.toggle('on', !!on[c.dataset.f]);
      });
      render();
    });
    host.querySelector('thead').addEventListener('click', function (e) {
      var th = e.target.closest('[data-sort]');
      if (!th) return;
      if (sortKey === th.dataset.sort) sortDir = -sortDir;
      else { sortKey = th.dataset.sort; sortDir = 1; }
      host.querySelectorAll('th').forEach(function (h) {
        h.classList.toggle('sorted', h === th);
        h.dataset.dir = h === th ? (sortDir > 0 ? 'up' : 'down') : '';
      });
      render();
    });

    render();
    window.__platformTable = {
      data: D, on: function () { return on; }, render: render,
      shown: function () {
        return [].slice.call(tbody.querySelectorAll('tr')).length;
      },
      verdict: function () { return verdict.textContent; },
      setFilters: function (list) {
        on = {};
        list.forEach(function (k) { on[k] = true; });
        host.querySelectorAll('.pt-chip').forEach(function (c) {
          c.classList.toggle('on', !!on[c.dataset.f]);
        });
        render();
      }
    };
  }
})();
