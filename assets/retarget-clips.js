/* Seven maps, one human motion, side by side.
 *
 * The table above this says direct copy misses by 59 % of reach and GMR by
 * 12.5 %. Both numbers are right and neither is a picture. These are the SAME
 * episodes those rows were scored on, replayed once per method and rendered
 * from that run — so what you watch and what the table says are the same
 * simulation, not two of them.
 *
 * Every tile plays the same operator motion at the same instant. That is the
 * whole design: the clips are only worth anything IN SYNC, because the
 * comparison is "at this moment in the reach, where did each map put the
 * hand?" A grid of independently looping videos would look busy and say
 * nothing, so one clock drives all of them and a drift of more than a quarter
 * second is corrected.
 *
 * Data: assets/retarget/index.json, written by
 * controller/experiments/retargeting_ablation/render_compare.py.
 */
(function () {
  'use strict';
  var host = document.getElementById('retargetClips');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* which number to badge each tile with, and which way is better */
  var AXES = [
    ['placement_pct', 'placement', '% reach', 1, false],
    ['orientation_deg', 'orientation', '°', 1, false],
    ['posture_deg', 'elbow swivel', '°', 0, false],
    ['coverage_pct', 'workspace', '%', 0, true],
    ['infeasible_pct', 'infeasible', '% frames', 1, false],
  ];

  fetch('assets/retarget/index.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="rk-err">The comparison clips have not been ' +
        'rendered yet. Run <code>controller/experiments/retargeting_ablation/' +
        'render_compare.py</code>.</p>';
      console.error('[retarget-clips]', e);
    });

  function build(D) {
    if (!D.tasks || !D.tasks.length) throw new Error('no tasks');
    var task = D.tasks[0].id;
    var axis = 'placement_pct';
    var methods = D.methods;

    host.innerHTML =
      '<div class="rk-head">' +
        '<span class="rk-kick">Watch it · EgoDex, replayed</span>' +
        '<h3 class="rk-title">The same reach, seven ways.</h3>' +
        '<p class="rk-say">Every tile is the same operator, the same frame, ' +
          'the same instant — only the map differs. ' + esc(D.note) + '</p>' +
      '</div>' +
      '<div class="rk-bar">' +
        '<div class="rk-tasks">' +
          D.tasks.map(function (t) {
            return '<button type="button" class="rk-chip" data-t="' +
              esc(t.id) + '">' + esc(t.label) + '</button>';
          }).join('') +
        '</div>' +
        '<label class="rk-axis">rank by' +
          '<select class="rk-sel">' +
            AXES.map(function (a) {
              return '<option value="' + a[0] + '">' + esc(a[1]) + '</option>';
            }).join('') +
          '</select>' +
        '</label>' +
      '</div>' +
      '<div class="rk-grid"></div>' +
      '<p class="rk-src">Motion: ' + esc(D.dataset) + '. Rendered by <code>' +
        esc(D.generated_by) + '</code>. Green sphere: where the operator put ' +
        'the wrist. Orange: where the robot got it. The gap between them is ' +
        'the placement error the table reports.</p>';

    var grid = host.querySelector('.rk-grid');
    var vids = [];

    function render() {
      var T = D.tasks.filter(function (t) { return t.id === task; })[0];
      var ax = AXES.filter(function (a) { return a[0] === axis; })[0];
      var order = methods.filter(function (m) { return T.cells[m.id]; })
        .slice().sort(function (a, b) {
          var x = T.cells[a.id][axis], y = T.cells[b.id][axis];
          return ax[4] ? y - x : x - y;             // best first, either way
        });

      grid.innerHTML = order.map(function (m, i) {
        var c = T.cells[m.id];
        return '<figure class="rk-tile' + (m.id === 'ours' ? ' ours' : '') +
          '" data-m="' + esc(m.id) + '">' +
          '<div class="rk-vwrap">' +
            '<video muted loop playsinline preload="metadata" ' +
              'poster="assets/retarget/' + esc(c.poster) + '" ' +
              'src="assets/retarget/' + esc(c.clip) + '"></video>' +
            '<span class="rk-rank">' + (i + 1) + '</span>' +
          '</div>' +
          '<figcaption>' +
            '<b>' + esc(m.label) + '</b>' +
            '<span class="rk-num">' + c[axis].toFixed(ax[3]) +
              '<i>' + esc(ax[2]) + '</i></span>' +
            '<em>' + esc(m.why) + '</em>' +
          '</figcaption>' +
        '</figure>';
      }).join('');

      vids = [].slice.call(grid.querySelectorAll('video'));
      sync();
      host.querySelectorAll('[data-t]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.t === task);
      });
    }

    /* ONE CLOCK. Tile 0 is the reference; the rest are pulled back to it
       whenever they drift more than a quarter second. Without this the tiles
       start together and separate within a few loops — different file sizes
       decode at different rates — and a side-by-side comparison of frames
       that are no longer the same frame is worse than no comparison. */
    var ref = null;
    function sync() {
      ref = vids[0] || null;
      vids.forEach(function (v) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked */ });
      });
    }
    function keepSync() {
      if (ref && vids.length > 1 && !ref.paused) {
        var t = ref.currentTime;
        for (var i = 1; i < vids.length; i++) {
          if (Math.abs(vids[i].currentTime - t) > 0.25 &&
              vids[i].readyState >= 1) {
            try { vids[i].currentTime = t; } catch (e) { /* seeking */ }
          }
        }
      }
      requestAnimationFrame(keepSync);
    }

    host.querySelector('.rk-tasks').addEventListener('click', function (e) {
      var b = e.target.closest('[data-t]');
      if (!b) return;
      task = b.dataset.t;
      render();
    });
    host.querySelector('.rk-sel').addEventListener('change', function (e) {
      axis = e.target.value;
      render();
    });

    /* don't decode seven videos for a section nobody has scrolled to */
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        vids.forEach(function (v) {
          if (en.isIntersecting) {
            var p = v.play(); if (p && p.catch) p.catch(function () {});
          } else { v.pause(); }
        });
      });
    }, { threshold: 0.12 });
    io.observe(host);

    render();
    requestAnimationFrame(keepSync);

    window.__retargetClips = {
      data: D, task: function () { return task; },
      setTask: function (t) { task = t; render(); },
      setAxis: function (a) { axis = a; render(); },
      tiles: function () {
        return [].slice.call(grid.querySelectorAll('.rk-tile'))
                 .map(function (f) { return f.dataset.m; });
      },
      spread: function () {              // worst drift between tiles, seconds
        if (vids.length < 2) return 0;
        var ts = vids.map(function (v) { return v.currentTime; });
        return Math.max.apply(null, ts) - Math.min.apply(null, ts);
      },
      ready: function () {
        return vids.filter(function (v) { return v.readyState >= 1; }).length;
      }
    };
  }
})();
