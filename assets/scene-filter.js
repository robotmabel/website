/* The scene gallery, built from the scene registry rather than typed out.
 *
 * assets/sim/scenes/index.json is written by
 * simulation/mabel_mujoco/scripts/tools/render_scene_grid.py, which reads the
 * simulator's own scenes.json for titles and categories and marks a scene
 * DYNAMIC when it actually ships a .dynamics.json full of actors. So the count,
 * the categories and the moving/still label all come from the simulator, and
 * none of them can quietly disagree with it.
 *
 * Two filters, because they answer different questions: what KIND of place is
 * this, and does anything in it MOVE.
 */
(function () {
  'use strict';
  var host = document.getElementById('sceneGrid');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  fetch('assets/sim/scenes/index.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="sg-err">Could not load the scene list.</p>';
      console.error('[scene-grid]', e);
    });

  function build(data) {
    /* "bare" and the like are rigs, not places to work in */
    var scenes = data.scenes.filter(function (s) {
      return s.has_clip && s.category !== 'Other';
    });
    var cats = [];
    scenes.forEach(function (s) {
      if (cats.indexOf(s.category) < 0) cats.push(s.category);
    });
    cats.sort();
    var nDyn = scenes.filter(function (s) { return s.dynamic; }).length;

    var html =
      '<div class="scene-bar">' +
        '<span class="scene-count">' + scenes.length + ' scenes released</span>' +
        '<div class="scene-filters" data-axis="motion">' +
          '<button type="button" class="on" data-mv="">Everything</button>' +
          '<button type="button" data-mv="1">Moving <i>' + nDyn + '</i></button>' +
          '<button type="button" data-mv="0">Still <i>' +
            (scenes.length - nDyn) + '</i></button>' +
        '</div>' +
      '</div>' +
      '<div class="scene-filters cats" data-axis="cat">' +
        '<button type="button" class="on" data-sg="">All</button>' +
        cats.map(function (c) {
          var n = scenes.filter(function (s) { return s.category === c; }).length;
          return '<button type="button" data-sg="' + esc(c) + '">' +
                 esc(c.replace(/ & .*/, '')) + ' <i>' + n + '</i></button>';
        }).join('') +
      '</div>' +
      '<div class="scene-grid">';

    scenes.forEach(function (s) {
      html +=
        '<figure class="scene-cell' + (s.dynamic ? ' moving' : '') + '" ' +
          'data-group="' + esc(s.category) + '" data-mv="' + (s.dynamic ? 1 : 0) + '">' +
          '<video data-lazyvid="assets/sim/scenes/' + esc(s.clip) + '" ' +
            'data-lo="assets/sim/scenes/' + esc(s.clip_lo) + '" ' +
            'poster="assets/sim/scenes/' + esc(s.poster) + '" ' +
            'autoplay muted loop playsinline preload="none" ' +
            'aria-label="' + esc(s.title) + ' — the camera orbits while the ' +
            'physics runs"></video>' +
          (s.dynamic ? '<span class="sg-live" title="' + s.actors +
            ' scripted actors">● ' + s.actors + ' moving</span>' : '') +
          '<figcaption><b>' + esc(s.title) + '</b>' +
            '<span>' + esc(s.category) + '</span></figcaption>' +
          (s.description ? '<p class="sg-desc">' + esc(s.description) + '</p>' : '') +
        '</figure>';
    });
    html += '</div>';
    host.innerHTML = html;

    var grid = host.querySelector('.scene-grid');
    var want = { cat: '', mv: '' };
    function apply() {
      var shown = 0;
      grid.querySelectorAll('.scene-cell').forEach(function (c) {
        var ok = (!want.cat || c.dataset.group === want.cat) &&
                 (!want.mv || c.dataset.mv === want.mv);
        c.hidden = !ok;
        if (ok) shown++;
      });
      host.querySelector('.scene-count').textContent =
        shown + (shown === scenes.length ? ' scenes released' : ' of ' +
                 scenes.length + ' scenes');
    }
    host.querySelectorAll('.scene-filters').forEach(function (bar) {
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        bar.querySelectorAll('button').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        if (bar.dataset.axis === 'cat') want.cat = b.dataset.sg || '';
        else want.mv = b.dataset.mv || '';
        apply();
      });
    });

    /* hand the freshly-built videos to the page's lazy-video loader */
    if (window.__lazyVid) window.__lazyVid(grid);
    window.__sceneGrid = { scenes: scenes, want: want, apply: apply };
  }
})();
