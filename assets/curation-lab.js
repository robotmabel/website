/* A cut-down data-curation studio, running in the page.
 *
 * The real one is at studio.mabelrobot.duckdns.org and this is not a mock of
 * it — the three episodes are recorded by
 * simulation/mabel_mujoco/scripts/tools/render_curation_clips.py the way the
 * collector records (one shared 15 Hz clock, index-aligned, `action/ctrl` as
 * ABSOLUTE joint targets), with real faults in the data. The detector below is
 * the same set of tests learning/data_curation/server/quality.py runs, ported
 * to JS, so what it finds is a result rather than an annotation.
 *
 * What you can do here:
 *   scrub          drag the playhead, or the ruler
 *   B / ⌘B         blade the clip under the playhead
 *   drag a clip    reorder the edit
 *   drag an edge   trim in or out
 *   ⌫ / Del        ripple-delete the selected clip
 *   L              label the selected clip
 *   + from the bin append another take
 *
 * Editing is NON-DESTRUCTIVE, exactly as in the studio: the timeline is an EDL
 * — an ordered list of (episode, start, end) segments — and nothing here ever
 * rewrites an episode.
 */
(function () {
  'use strict';
  var host = document.getElementById('curationLab');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ── the detector ───────────────────────────────────────────────────────
     Ported from learning/data_curation/server/quality.py. Thresholds are that
     file's: a frozen run is 6 frames, a timing gap is 1.8x the median dt, a
     held fraction over 0.45 is a low rate. */
  var MIN_FROZEN = 6, GAP_MULT = 1.8, HELD_FRAC = 0.45;

  function diffMag(rows) {
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var s = 0;
      for (var j = 0; j < rows[i].length; j++) s += Math.abs(rows[i][j] - rows[i - 1][j]);
      out.push(s);
    }
    return out;
  }

  function analyse(ep) {
    var defects = [];
    var n = ep.frames;
    var dPos = diffMag(ep.pos), dCtrl = diffMag(ep.ctrl);

    /* FROZEN WHILE COMMANDED. A still joint is not a fault; a joint that stops
       moving while the command keeps changing is. That distinction is the
       whole point of the test — without it every stationary moment is a bug. */
    var run = 0;
    for (var i = 0; i < dPos.length; i++) {
      var stuck = dPos[i] < 1e-6 && dCtrl[i] > 1e-4;
      if (stuck) { run++; }
      else {
        if (run >= MIN_FROZEN)
          defects.push({ type: 'frozen', start: i - run, end: i, sev: 0.8,
            label: 'joints frozen while still commanded, ' + run + ' frames' });
        run = 0;
      }
    }
    if (run >= MIN_FROZEN)
      defects.push({ type: 'frozen', start: dPos.length - run, end: dPos.length,
        sev: 0.8, label: 'joints frozen while still commanded, ' + run + ' frames' });

    /* TIMING GAPS and RATE. The index is dense by construction, so a dropped
       frame only ever shows up in the WALL clock. */
    if (ep.wall && ep.wall.length > 4) {
      var dt = [];
      for (var k = 1; k < ep.wall.length; k++) dt.push(ep.wall[k] - ep.wall[k - 1]);
      var sorted = dt.slice().sort(function (a, b) { return a - b; });
      var med = sorted[Math.floor(sorted.length / 2)];
      dt.forEach(function (v, idx) {
        if (v > med * GAP_MULT) {
          var missed = Math.round(v / med) - 1;
          defects.push({ type: 'gap', start: idx, end: idx + 1, sev: 0.6,
            label: 'timing gap — ' + (v * 1000).toFixed(0) + ' ms, about ' +
                   missed + ' frame' + (missed === 1 ? '' : 's') + ' never arrived' });
        }
      });
      /* a rate CHANGE: compare the two halves rather than the whole */
      var h = Math.floor(dt.length / 2);
      var m1 = median(dt.slice(0, h)), m2 = median(dt.slice(h));
      if (m1 > 0 && m2 / m1 > 1.4)
        defects.push({ type: 'rate', start: h, end: n - 1, sev: 0.45,
          label: 'loop rate fell from ' + (1 / m1).toFixed(1) + ' Hz to ' +
                 (1 / m2).toFixed(1) + ' Hz halfway through' });
    }

    /* HELD STREAM: a channel that barely changes at all */
    var changed = dCtrl.filter(function (v) { return v > 1e-8; }).length;
    var heldFrac = 1 - changed / Math.max(1, dCtrl.length);
    if (heldFrac > HELD_FRAC && changed > 3)
      defects.push({ type: 'low_rate', start: 0, end: n - 1, sev: 0.4,
        label: 'action/ctrl held for ' + (heldFrac * 100).toFixed(0) + '% of frames' });

    /* the studio's score: 1 − mean per-frame severity */
    var sev = new Float64Array(n);
    defects.forEach(function (d) {
      for (var i = Math.max(0, d.start); i < Math.min(n, d.end + 1); i++)
        sev[i] = Math.max(sev[i], d.sev);
    });
    var mean = 0;
    for (var q = 0; q < n; q++) mean += sev[q];
    return { defects: defects, sev: sev,
             score: Math.round((1 - mean / n) * 1000) / 1000,
             fracBad: Math.round(Array.prototype.filter.call(
               sev, function (v) { return v > 0; }).length / n * 1000) / 1000 };
  }
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }

  /* ── state ─────────────────────────────────────────────────────────────── */
  var eps = {};              // id -> full episode record
  var report = {};           // id -> analysis
  var edl = [];              // [{ep, in, out, label, id}]
  var sel = null, playhead = 0, uid = 0;

  var el = {};

  fetch('assets/curation/index.json')
    .then(function (r) { return r.json(); })
    .then(function (idx) {
      return Promise.all(idx.episodes.map(function (e) {
        return fetch('assets/curation/' + e.id + '.json')
          .then(function (r) { return r.json(); })
          .then(function (full) { eps[e.id] = full; report[e.id] = analyse(full); });
      })).then(function () { return idx; });
    })
    .then(boot)
    .catch(function (e) {
      host.innerHTML = '<p class="cl-err">Could not load the sample episodes.</p>';
      console.error('[curation-lab]', e);
    });

  function boot(idx) {
    host.innerHTML =
      '<div class="cl-top">' +
        '<div class="cl-view">' +
          '<video class="cl-video" muted playsinline preload="auto"></video>' +
          '<div class="cl-hud"><span class="cl-frame">frame 0</span>' +
            '<span class="cl-clipname">—</span></div>' +
          '<div class="cl-flag" hidden></div>' +
        '</div>' +
        '<aside class="cl-side">' +
          '<div class="cl-panel">' +
            '<h4>Quality</h4>' +
            '<div class="cl-score"><b class="cl-scorev">—</b><span>episode score</span></div>' +
            '<ul class="cl-defects"></ul>' +
          '</div>' +
          '<div class="cl-panel">' +
            '<h4>Takes</h4>' +
            '<ul class="cl-bin"></ul>' +
          '</div>' +
        '</aside>' +
      '</div>' +
      '<div class="cl-bar">' +
        '<button class="cl-btn cl-play" type="button">▶ Play</button>' +
        '<button class="cl-btn" data-act="blade">Blade <kbd>B</kbd></button>' +
        '<button class="cl-btn" data-act="del">Ripple delete <kbd>⌫</kbd></button>' +
        '<button class="cl-btn" data-act="label">Label <kbd>L</kbd></button>' +
        '<button class="cl-btn" data-act="scan">Re-scan</button>' +
        '<button class="cl-btn" data-act="reset">Reset edit</button>' +
        '<span class="cl-len"></span>' +
      '</div>' +
      '<div class="cl-timeline">' +
        '<div class="cl-ruler"></div>' +
        '<div class="cl-track"></div>' +
        '<div class="cl-defrow"></div>' +
        '<div class="cl-head"></div>' +
      '</div>' +
      '<p class="cl-note">Non-destructive, like the studio: the timeline is an ' +
        'EDL — an ordered list of (episode, in, out) — and nothing here ever ' +
        'rewrites an episode. <b>Work in progress:</b> the real ' +
        '<a href="https://studio.mabelrobot.duckdns.org/" target="_blank" ' +
        'rel="noopener">Data Curation studio</a> has the 3-D view, all seven ' +
        'camera feeds and LeRobot export; both it and the Trainer Studio are ' +
        'still being polished.</p>';

    ['video', 'frame', 'clipname', 'flag', 'defects', 'bin', 'track', 'ruler',
     'defrow', 'head', 'scorev', 'len'].forEach(function (k) {
      el[k] = host.querySelector('.cl-' + k);
    });
    el.play = host.querySelector('.cl-play');
    el.timeline = host.querySelector('.cl-timeline');

    el.bin.innerHTML = idx.episodes.map(function (e) {
      var r = report[e.id];
      return '<li><button type="button" data-add="' + e.id + '">' +
        '<b>' + esc(e.task) + '</b>' +
        '<span>' + e.frames + ' frames · ' +
        '<i class="' + (r.score > 0.95 ? 'ok' : 'bad') + '">score ' +
        r.score.toFixed(2) + '</i></span></button></li>';
    }).join('');

    reset();
    wire();
  }

  function reset() {
    edl = Object.keys(eps).map(function (id) {
      return { uid: ++uid, ep: id, in: 0, out: eps[id].frames - 1,
               label: eps[id].task };
    });
    sel = edl[0] ? edl[0].uid : null;
    playhead = 0;
    render();
  }

  var total = function () {
    return edl.reduce(function (a, c) { return a + (c.out - c.in + 1); }, 0);
  };
  function clipAt(f) {
    var acc = 0;
    for (var i = 0; i < edl.length; i++) {
      var len = edl[i].out - edl[i].in + 1;
      if (f < acc + len) return { c: edl[i], i: i, local: f - acc, at: acc };
      acc += len;
    }
    return null;
  }

  function render() {
    var T = Math.max(1, total());
    el.len.textContent = edl.length + ' clip' + (edl.length === 1 ? '' : 's') +
      ' · ' + T + ' frames · ' + (T / 15).toFixed(1) + ' s';

    var acc = 0;
    el.track.innerHTML = edl.map(function (c) {
      var len = c.out - c.in + 1;
      var left = acc / T * 100, w = len / T * 100;
      acc += len;
      var r = report[c.ep];
      return '<div class="cl-clip' + (c.uid === sel ? ' on' : '') + '" ' +
        'data-uid="' + c.uid + '" draggable="true" ' +
        'style="left:' + left + '%;width:' + w + '%">' +
        '<span class="cl-grip in" data-edge="in"></span>' +
        '<span class="cl-lab">' + esc(c.label) + '</span>' +
        '<span class="cl-meta">' + c.in + '–' + c.out +
          ' · ' + r.score.toFixed(2) + '</span>' +
        '<span class="cl-grip out" data-edge="out"></span></div>';
    }).join('');

    /* defect lanes, mapped through the edit so a trimmed-out fault disappears */
    acc = 0;
    var marks = [];
    edl.forEach(function (c) {
      var len = c.out - c.in + 1;
      report[c.ep].defects.forEach(function (d) {
        var s = Math.max(d.start, c.in), e = Math.min(d.end, c.out);
        if (e < s) return;
        marks.push('<span class="cl-def d-' + d.type + '" ' +
          'style="left:' + ((acc + s - c.in) / Math.max(1, total()) * 100) +
          '%;width:' + (Math.max(1, e - s + 1) / Math.max(1, total()) * 100) + '%" ' +
          'title="' + esc(d.label) + '"></span>');
      });
      acc += len;
    });
    el.defrow.innerHTML = marks.join('') ||
      '<span class="cl-clean">no defects in the current edit</span>';

    el.ruler.innerHTML = (function () {
      var out = [];
      for (var s = 0; s <= T / 15; s += 2)
        out.push('<span style="left:' + (s * 15 / T * 100) + '%">' + s + 's</span>');
      return out.join('');
    })();

    var s = clipAt(playhead);
    if (s) {
      el.clipname.textContent = s.c.label;
      var r = report[s.c.ep];
      el.scorev.textContent = r.score.toFixed(2);
      el.scorev.className = 'cl-scorev ' + (r.score > 0.95 ? 'ok' : 'bad');
      el.defects.innerHTML = r.defects.length
        ? r.defects.map(function (d) {
            return '<li class="d-' + d.type + '"><b>' + d.type.replace('_', ' ') +
                   '</b>' + esc(d.label) + '<i>frames ' + d.start + '–' + d.end +
                   '</i></li>'; }).join('')
        : '<li class="clean">clean — nothing flagged</li>';
      var hit = r.defects.filter(function (d) {
        return s.local + s.c.in >= d.start && s.local + s.c.in <= d.end; });
      el.flag.hidden = !hit.length;
      if (hit.length) el.flag.textContent = hit[0].label;
      var v = el.video;
      var src = 'assets/curation/' + eps[s.c.ep].clip;
      if (!v.src || v.src.indexOf(eps[s.c.ep].clip) < 0) v.src = src;
      var want = (s.c.in + s.local) / 15;
      if (Math.abs(v.currentTime - want) > 0.09 && v.readyState >= 1)
        try { v.currentTime = want; } catch (e) { /* still seeking */ }
    }
    el.frame.textContent = 'frame ' + playhead + ' / ' + T;
    el.head.style.left = (playhead / T * 100) + '%';
  }

  function wire() {
    var T = function () { return Math.max(1, total()); };

    /* scrubbing */
    var scrubbing = false;
    function scrubTo(clientX) {
      var r = el.timeline.getBoundingClientRect();
      var f = Math.round((clientX - r.left) / r.width * T());
      playhead = Math.max(0, Math.min(T() - 1, f));
      var s = clipAt(playhead);
      if (s) sel = s.c.uid;
      render();
    }
    el.timeline.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.cl-grip') || e.target.closest('.cl-clip')) return;
      scrubbing = true; scrubTo(e.clientX);
      el.timeline.setPointerCapture(e.pointerId);
    });
    el.timeline.addEventListener('pointermove', function (e) {
      if (scrubbing) scrubTo(e.clientX);
    });
    addEventListener('pointerup', function () { scrubbing = false; });

    /* trimming: drag a clip's edge */
    var trim = null;
    el.track.addEventListener('pointerdown', function (e) {
      var g = e.target.closest('.cl-grip');
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      var uidv = +g.closest('.cl-clip').dataset.uid;
      trim = { c: edl.filter(function (x) { return x.uid === uidv; })[0],
               edge: g.dataset.edge, x0: e.clientX };
      trim.v0 = trim.c[trim.edge];
      el.track.setPointerCapture(e.pointerId);
    });
    el.track.addEventListener('pointermove', function (e) {
      if (!trim) return;
      var r = el.timeline.getBoundingClientRect();
      var d = Math.round((e.clientX - trim.x0) / r.width * T());
      var c = trim.c, n = eps[c.ep].frames;
      if (trim.edge === 'in') c.in = Math.max(0, Math.min(c.out - 4, trim.v0 + d));
      else c.out = Math.min(n - 1, Math.max(c.in + 4, trim.v0 + d));
      render();
    });
    addEventListener('pointerup', function () { trim = null; });

    /* reordering: HTML5 drag on the clip body */
    var dragUid = null;
    el.track.addEventListener('dragstart', function (e) {
      var c = e.target.closest('.cl-clip');
      if (!c) return;
      dragUid = +c.dataset.uid;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragUid)); } catch (x) {}
    });
    el.track.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.track.addEventListener('drop', function (e) {
      e.preventDefault();
      if (dragUid == null) return;
      var r = el.timeline.getBoundingClientRect();
      var f = Math.round((e.clientX - r.left) / r.width * T());
      var at = clipAt(Math.max(0, Math.min(T() - 1, f)));
      var from = edl.findIndex(function (x) { return x.uid === dragUid; });
      var to = at ? at.i : edl.length - 1;
      if (from >= 0 && to >= 0 && from !== to) {
        var moved = edl.splice(from, 1)[0];
        edl.splice(to, 0, moved);
      }
      dragUid = null; render();
    });

    /* the bin */
    el.bin.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]');
      if (!b) return;
      var id = b.dataset.add;
      edl.push({ uid: ++uid, ep: id, in: 0, out: eps[id].frames - 1,
                 label: eps[id].task });
      sel = uid; render();
    });

    /* the toolbar + keys */
    function act(what) {
      var s = clipAt(playhead);
      if (what === 'blade' && s && s.local > 2 && s.local < (s.c.out - s.c.in) - 2) {
        var right = { uid: ++uid, ep: s.c.ep, in: s.c.in + s.local,
                      out: s.c.out, label: s.c.label };
        s.c.out = s.c.in + s.local - 1;
        edl.splice(s.i + 1, 0, right);
        sel = right.uid;
      } else if (what === 'del') {
        var i = edl.findIndex(function (x) { return x.uid === sel; });
        if (i >= 0 && edl.length > 1) {
          edl.splice(i, 1);
          playhead = Math.min(playhead, Math.max(0, total() - 1));
        }
      } else if (what === 'label') {
        var c = edl.filter(function (x) { return x.uid === sel; })[0];
        if (c) {
          var v = prompt('Label this clip', c.label);
          if (v != null) c.label = v.slice(0, 60);
        }
      } else if (what === 'scan') {
        Object.keys(eps).forEach(function (k) { report[k] = analyse(eps[k]); });
      } else if (what === 'reset') {
        reset(); return;
      }
      render();
    }
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b) act(b.dataset.act);
    });

    /* playback moves the playhead, not just the video */
    var playing = false, raf = null, last = 0;
    function tick(t) {
      if (!playing) return;
      if (t - last > 1000 / 15) {
        last = t;
        playhead = (playhead + 1) % Math.max(1, total());
        render();
      }
      raf = requestAnimationFrame(tick);
    }
    el.play.addEventListener('click', function () {
      playing = !playing;
      el.play.textContent = playing ? '❚❚ Pause' : '▶ Play';
      if (playing) { last = 0; raf = requestAnimationFrame(tick); }
      else if (raf) cancelAnimationFrame(raf);
    });

    addEventListener('keydown', function (e) {
      if (!host.getBoundingClientRect().height) return;
      var r = host.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;      // not on screen
      if (/input|textarea/i.test((e.target.tagName || ''))) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); act('blade'); }
      else if (k === 'l') { e.preventDefault(); act('label'); }
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault(); act('del');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); playhead = Math.min(total() - 1, playhead + 1); render();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); playhead = Math.max(0, playhead - 1); render();
      }
    });

    window.__curationLab = {
      edl: function () { return edl; }, report: report, act: act,
      analyse: analyse, eps: eps,
      seek: function (f) { playhead = f; render(); },
      total: total
    };
  }
})();
