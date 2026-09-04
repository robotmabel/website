/* Seven ways to put an operator's hand on a robot, compared.
 *
 * The numbers are the paper's — assets/data/retarget-compare.json is exported
 * straight from controller/experiments/retargeting_ablation/results/map.json,
 * the same JSON papers/ral2026/Tables/12_experiments_retargettable.tex is
 * generated from. What the page adds is the PER-EPISODE rows, so you can pick a
 * subset of tasks and watch the table re-decide.
 *
 * It reproduces the paper's two statistics rather than approximating them:
 *
 *   AGGREGATE  the MEDIAN across episodes, not the mean. On ordinary seated
 *              tabletop motion every competent map is fine; what separates them
 *              is the minority of episodes where the operator works tucked in
 *              against their own body. `infeasible_pct` is the one exception
 *              and is meaned, because its median is zero for every map —
 *              including the ones that fail half the time — which erases the
 *              axis entirely.
 *
 *   RANKING    two cells closer than the pooled across-episode standard error
 *              are NOT distinguishable by this experiment and are not ranked
 *              against each other. Without that rule the grasp row prints a
 *              bold winner chosen by noise: every arm map runs the same finger
 *              solver and they land within 0.008 of one another against a
 *              standard deviation of 0.34.
 */
(function () {
  'use strict';
  var host = document.getElementById('retargetCompare');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var pretty = function (t) {
    return t.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  };

  fetch('assets/data/retarget-compare.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="rc2-err">Could not load the comparison.</p>';
      console.error('[retarget-compare]', e);
    });

  function median(v) {
    if (!v.length) return NaN;
    var s = v.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function mean(v) {
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : NaN;
  }
  function stderr(v) {
    if (v.length < 2) return 0;
    var m = mean(v);
    var s = Math.sqrt(v.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0)
                      / (v.length - 1));
    return s / Math.sqrt(v.length);
  }

  function build(D) {
    var picked = {};                     // task -> true; empty means all
    var MEANED = D.agg_mean_keys || [];

    var html =
      '<div class="rc2-head">' +
        '<div><span class="rc2-kicker">Retargeting · seven maps, one bench</span>' +
          '<h3 class="rc2-title">Whose hand ends up where?</h3></div>' +
        '<p class="rc2-lede">' + esc(D.protocol) + ' Motion: ' +
          esc(D.motion) + '.</p>' +
      '</div>' +
      '<div class="rc2-filters">' +
        '<button type="button" class="rc2-chip on" data-task="">All ' +
          D.tasks.length + ' tasks <i>' + D.episodes + ' episodes</i></button>' +
        D.tasks.map(function (t) {
          var n = D.rows.ours.filter(function (r) { return r.task === t; }).length;
          return '<button type="button" class="rc2-chip" data-task="' + esc(t) +
                 '">' + esc(pretty(t)) + ' <i>' + n + '</i></button>';
        }).join('') +
      '</div>' +
      '<div class="rc2-scroll"><table class="rc2-table"><thead><tr>' +
        '<th class="rc2-axis-h">Axis</th>' +
        D.methods.map(function (m) {
          return '<th class="rc2-m' + (m.id === 'ours' ? ' ours' : '') +
            '" data-m="' + m.id + '"><b>' + esc(m.name) + '</b>' +
            (m.cites ? '<i>' + esc(m.cites) + '</i>' : '') +
            (m.reimpl ? '<em>our implementation</em>' : '') + '</th>';
        }).join('') +
      '</tr></thead><tbody></tbody></table></div>' +
      '<div class="rc2-note" hidden></div>' +
      '<p class="rc2-src">Median across episodes (mean for <i>Infeasible</i>, whose ' +
        'median is 0 for every map). <b>Cells within one standard error of the ' +
        'best are not ranked against each other</b> — the experiment cannot tell ' +
        'them apart. Source: <code>' + esc(D.source) + '</code>.</p>';
    host.innerHTML = html;

    var tbody = host.querySelector('tbody');
    var note = host.querySelector('.rc2-note');

    function rowsFor(m) {
      var all = D.rows[m] || [];
      var keys = Object.keys(picked);
      return keys.length ? all.filter(function (r) { return picked[r.task]; }) : all;
    }

    function render() {
      var mids = D.methods.map(function (m) { return m.id; });
      tbody.innerHTML = D.axes.map(function (ax) {
        var vals = mids.map(function (m) {
          var v = rowsFor(m).map(function (r) { return r[ax.key]; })
                            .filter(function (x) { return isFinite(x); });
          return MEANED.indexOf(ax.key) >= 0 ? mean(v) : median(v);
        });
        /* the experiment's own resolution on this axis, pooled over methods */
        var res = median(mids.map(function (m) {
          return stderr(rowsFor(m).map(function (r) { return r[ax.key]; })
                                  .filter(function (x) { return isFinite(x); }));
        }).filter(function (x) { return isFinite(x); })) || 0;

        var rank = [];
        if (ax.higher !== null && ax.higher !== undefined) {
          var fin = vals.filter(isFinite);
          var best = ax.higher ? Math.max.apply(null, fin) : Math.min.apply(null, fin);
          rank = vals.map(function (v) {
            if (!isFinite(v)) return '';
            return Math.abs(v - best) <= res ? 'best' : '';
          });
        }
        /* the paper's own decimals, carried in the data — a table that rounds
           differently from the one it reproduces disagrees with it */
        var dp = ax.dp == null ? 1 : ax.dp;
        return '<tr data-axis="' + ax.key + '">' +
          '<th class="rc2-axis"><b>' + esc(ax.label) + '</b>' +
            '<i>' + esc(ax.unit) + (ax.higher === true ? ' · higher wins'
              : ax.higher === false ? ' · lower wins' : ' · not a ranking') +
            '</i></th>' +
          vals.map(function (v, i) {
            /* data-label carries the column header into the cell so the
               phone layout can transpose the table in CSS — a stacked table
               otherwise loses which method each number belongs to */
            return '<td class="rc2-v ' + (rank[i] || '') +
              (mids[i] === 'ours' ? ' ours' : '') + '" data-label="' +
              esc(D.methods[i].name) + '">' +
              (isFinite(v) ? v.toFixed(dp) : '—') + '</td>';
          }).join('') + '</tr>';
      }).join('');
    }

    host.querySelector('.rc2-filters').addEventListener('click', function (e) {
      var b = e.target.closest('.rc2-chip');
      if (!b) return;
      var t = b.dataset.task;
      if (!t) { picked = {}; }
      else if (picked[t]) { delete picked[t]; }
      else { picked[t] = true; }
      var any = Object.keys(picked).length;
      host.querySelectorAll('.rc2-chip').forEach(function (c) {
        c.classList.toggle('on', c.dataset.task ? !!picked[c.dataset.task] : !any);
      });
      render();
    });

    /* what an axis means, and what a method is — on the element itself */
    function explain(title, body) {
      note.innerHTML = '<b>' + esc(title) + '</b>' + esc(body);
      note.hidden = false;
    }
    host.addEventListener('pointerover', function (e) {
      var a = e.target.closest('[data-axis]');
      if (a) {
        var ax = D.axes.filter(function (x) { return x.key === a.dataset.axis; })[0];
        if (ax) return explain(ax.label, ax.why);
      }
      var m = e.target.closest('[data-m]');
      if (m) {
        var md = D.methods.filter(function (x) { return x.id === m.dataset.m; })[0];
        if (md) return explain(md.name + (md.cites ? ' — ' + md.cites : ''), md.why);
      }
    });
    host.addEventListener('pointerleave', function () { note.hidden = true; });

    render();
    window.__retargetCompare = {
      data: D, picked: function () { return picked; }, render: render,
      cells: function () {
        return [].slice.call(host.querySelectorAll('tbody tr')).map(function (tr) {
          return { axis: tr.dataset.axis,
                   vals: [].slice.call(tr.querySelectorAll('.rc2-v'))
                            .map(function (td) { return td.textContent; }),
                   best: [].slice.call(tr.querySelectorAll('.rc2-v'))
                            .map(function (td) { return td.classList.contains('best'); }) };
        });
      }
    };
  }
})();
