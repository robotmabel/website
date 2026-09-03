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
  var edl = [];              // [{ep, in, out, label, lane, uid}]
  var notes = [];            // [{uid, at, len, text, lang}]
  var sel = null, playhead = 0, uid = 0;
  var zoom = 1;              // px per frame multiplier; 1 = the whole edit fits
  var PPF = 6;               // pixels per frame at zoom 1x on a 1000 px view

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

  /* playback state lives here, not inside wire(): render() has to know
     whether it should be seeking or letting the media clock run. */
  var playing = false, lastShown = null;

  function boot(idx) {
    host.innerHTML =
      '<div class="cl-top">' +
        '<div class="cl-view">' +
          /* ONE <video> PER EPISODE, not one element whose src we swap.
             Assigning .src resets the media element: it drops back to
             readyState 0, paints BLACK, and ignores any currentTime set
             before metadata arrives. Since the playhead crosses a clip
             boundary mid-playback, that is exactly when the swap happens —
             the viewer went black the moment the timeline reached the second
             take and stayed black. Three 640x480 clips preload happily; the
             visible one is the only difference. */
          idx.episodes.map(function (e, i) {
            return '<video class="cl-video" data-ep="' + esc(e.id) + '" muted ' +
                   'playsinline preload="auto" src="assets/curation/' +
                   esc(e.clip) + '"' + (i ? ' hidden' : '') + '></video>';
          }).join('') +
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
        '<button class="cl-btn" data-act="del">Delete <kbd>⌫</kbd></button>' +
        '<button class="cl-btn" data-act="label">Label <kbd>L</kbd></button>' +
        '<button class="cl-btn" data-act="note">Caption <kbd>C</kbd></button>' +
        '<button class="cl-btn" data-act="scan">Re-scan</button>' +
        '<button class="cl-btn" data-act="reset">Reset</button>' +
        '<span class="cl-zoom">' +
          '<button class="cl-btn sq" data-act="zoomout" ' +
            'title="Zoom out" aria-label="Zoom out">&#8211;</button>' +
          '<b class="cl-zv">1×</b>' +
          '<button class="cl-btn sq" data-act="zoomin" ' +
            'title="Zoom in" aria-label="Zoom in">+</button>' +
          '<button class="cl-btn sq wide" data-act="zoomfit" ' +
            'title="Fit the whole edit">fit</button>' +
        '</span>' +
        '<span class="cl-len"></span>' +
      '</div>' +
      '<div class="cl-tlwrap">' +
        '<div class="cl-lanes">' +
          '<span class="cl-lane-lab">v1</span>' +
          '<span class="cl-lane-lab">v2</span>' +
          '<span class="cl-lane-lab">flags</span>' +
          '<span class="cl-lane-lab">notes</span>' +
        '</div>' +
        '<div class="cl-scroll">' +
          '<div class="cl-timeline">' +
            '<div class="cl-ruler"></div>' +
            '<div class="cl-track" data-lane="0"></div>' +
            '<div class="cl-track alt" data-lane="1"></div>' +
            '<div class="cl-defrow"></div>' +
            '<div class="cl-notes"></div>' +
            '<div class="cl-head"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="cl-note">Non-destructive, like the studio: the timeline is an ' +
        'EDL — an ordered list of (episode, in, out) — and nothing here ever ' +
        'rewrites an episode. <b>Work in progress:</b> the real ' +
        '<a href="https://studio.mabelrobot.duckdns.org/" target="_blank" ' +
        'rel="noopener">Data Curation studio</a> has the 3-D view, all seven ' +
        'camera feeds and LeRobot export; both it and the Trainer Studio are ' +
        'still being polished.</p>';

    ['frame', 'clipname', 'flag', 'defects', 'bin', 'ruler',
     'defrow', 'notes', 'head', 'scorev', 'len', 'zv', 'scroll'].forEach(function (k) {
      el[k] = host.querySelector('.cl-' + k);
    });
    el.videos = [].slice.call(host.querySelectorAll('.cl-video'));
    el.play = host.querySelector('.cl-play');
    el.timeline = host.querySelector('.cl-timeline');
    el.tracks = [].slice.call(host.querySelectorAll('.cl-track'));

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
               label: eps[id].task, lane: 0 };
    });
    notes = [];
    sel = edl[0] ? edl[0].uid : null;
    playhead = 0; zoom = 1;
    render();
  }

  /* Frames map to pixels through ONE function, so the ruler, the clips, the
     defect lane, the notes and the playhead cannot disagree about where a
     frame is — which is what happens the moment two of them compute percentages
     of different widths. */
  function pxPerFrame() {
    var w = el.scroll ? el.scroll.clientWidth : 900;
    return Math.max(0.4, (w / Math.max(1, total())) * zoom);
  }
  function fx(f) { return f * pxPerFrame(); }

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
    var W = fx(T);
    el.timeline.style.width = Math.max(W, el.scroll.clientWidth) + 'px';
    el.len.textContent = edl.length + ' clip' + (edl.length === 1 ? '' : 's') +
      ' · ' + T + ' frames · ' + (T / 15).toFixed(1) + ' s';
    el.zv.textContent = zoom < 1 ? zoom.toFixed(2) + '×' : zoom.toFixed(1) + '×';

    var acc = 0;
    var lanes = ['', ''];
    edl.forEach(function (c) {
      var len = c.out - c.in + 1;
      var r = report[c.ep];
      lanes[c.lane || 0] +=
        '<div class="cl-clip' + (c.uid === sel ? ' on' : '') + '" ' +
        'data-uid="' + c.uid + '" draggable="true" ' +
        'style="left:' + fx(acc) + 'px;width:' + fx(len) + 'px">' +
        '<span class="cl-grip in" data-edge="in"></span>' +
        '<span class="cl-lab">' + esc(c.label) + '</span>' +
        '<span class="cl-meta">' + c.in + '–' + c.out +
          ' · ' + r.score.toFixed(2) + '</span>' +
        '<span class="cl-grip out" data-edge="out"></span></div>';
      acc += len;
    });
    el.tracks.forEach(function (t, i) { t.innerHTML = lanes[i] || ''; });

    /* defect lanes, mapped through the edit so a trimmed-out fault disappears */
    acc = 0;
    var marks = [];
    edl.forEach(function (c) {
      var len = c.out - c.in + 1;
      report[c.ep].defects.forEach(function (d) {
        var s = Math.max(d.start, c.in), e = Math.min(d.end, c.out);
        if (e < s) return;
        marks.push('<span class="cl-def d-' + d.type + '" ' +
          'style="left:' + fx(acc + s - c.in) +
          'px;width:' + Math.max(3, fx(e - s + 1)) + 'px" ' +
          'title="' + esc(d.label) + '"></span>');
      });
      acc += len;
    });
    el.defrow.innerHTML = marks.join('') ||
      '<span class="cl-clean">no defects in the current edit</span>';

    el.notes.innerHTML = notes.map(function (nt) {
      return '<span class="cl-note-chip" data-note="' + nt.uid + '" ' +
        'style="left:' + fx(nt.at) + 'px;width:' + Math.max(46, fx(nt.len)) + 'px">' +
        '<i>' + esc(nt.lang) + '</i>' + esc(nt.text) + '</span>';
    }).join('') || '<span class="cl-clean">no captions yet — press C</span>';

    el.ruler.innerHTML = (function () {
      var out = [];
      /* a tick every 1, 2, 5 or 10 s, whichever keeps them ~70 px apart */
      var per = [1, 2, 5, 10, 20, 30].filter(function (v) {
        return fx(v * 15) > 62; })[0] || 60;
      for (var s = 0; s <= T / 15 + per; s += per)
        out.push('<span style="left:' + fx(s * 15) + 'px">' + s + 's</span>');
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
      /* show the episode's own element; never re-point a src */
      /* keyed by episode ID, not by index — clip.ep is an id string
         ('ep01'), and `i === s.c.ep` is a number-vs-string comparison that is
         false for every element, so every video hid and the panel went black */
      var v = null;
      el.videos.forEach(function (x) {
        var mine = x.dataset.ep === s.c.ep;
        if (x.hidden === mine) x.hidden = !mine;
        if (mine) v = x;
      });
      if (v) {
        var want = (s.c.in + s.local) / 15;
        /* PLAY, DON'T SEEK, WHILE PLAYING.
           The playhead advances one frame every 1/15 s and render() runs each
           time, so seeking here meant FIFTEEN SEEKS A SECOND. Every one of
           them dropped the element to HAVE_METADATA and the viewer stayed
           black for the whole take. During playback the media clock is the
           right clock: let it run and only correct it when it has genuinely
           drifted (or when the clip under the playhead changed). Scrubbing
           still seeks, which is what scrubbing is. */
        var tol = playing && v === lastShown ? 0.35 : 0.09;
        lastShown = v;
        if (playing && v.paused) { try { v.play(); } catch (e) { /* blocked */ } }
        if (!playing && !v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > tol && v.readyState >= 1)
          try { v.currentTime = want; } catch (e) { /* still seeking */ }
      }
    }
    el.frame.textContent = 'frame ' + playhead + ' / ' + T;
    el.head.style.left = fx(playhead) + 'px';
    /* keep the playhead in view when the timeline is wider than the window */
    var hx = fx(playhead), vw = el.scroll.clientWidth, sl = el.scroll.scrollLeft;
    if (hx < sl + 40) el.scroll.scrollLeft = Math.max(0, hx - 40);
    else if (hx > sl + vw - 40) el.scroll.scrollLeft = hx - vw + 40;
  }

  function wire() {
    var T = function () { return Math.max(1, total()); };
    /* one screen-x -> frame conversion, shared by scrubbing, trimming and drop */
    function frameAt(clientX) {
      var r = el.timeline.getBoundingClientRect();
      return Math.round((clientX - r.left) / pxPerFrame());
    }

    /* scrubbing */
    var scrubbing = false;
    function scrubTo(clientX) {
      playhead = Math.max(0, Math.min(T() - 1, frameAt(clientX)));
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
    el.tracks.forEach(function (tr) {
      tr.addEventListener('pointerdown', function (e) {
        var g = e.target.closest('.cl-grip');
        if (!g) return;
        e.preventDefault(); e.stopPropagation();
        var uidv = +g.closest('.cl-clip').dataset.uid;
        trim = { c: edl.filter(function (x) { return x.uid === uidv; })[0],
                 edge: g.dataset.edge, x0: e.clientX };
        trim.v0 = trim.c[trim.edge];
        tr.setPointerCapture(e.pointerId);
      });
      tr.addEventListener('pointermove', function (e) {
        if (!trim) return;
        var d = Math.round((e.clientX - trim.x0) / pxPerFrame());
        var c = trim.c, n = eps[c.ep].frames;
        if (trim.edge === 'in') c.in = Math.max(0, Math.min(c.out - 4, trim.v0 + d));
        else c.out = Math.min(n - 1, Math.max(c.in + 4, trim.v0 + d));
        render();
      });
    });
    addEventListener('pointerup', function () { trim = null; });

    /* reordering: HTML5 drag on the clip body */
    var dragUid = null;
    el.tracks.forEach(function (tr) {
      tr.addEventListener('dragstart', function (e) {
        var c = e.target.closest('.cl-clip');
        if (!c) return;
        dragUid = +c.dataset.uid;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(dragUid)); } catch (x) {}
      });
      tr.addEventListener('dragover', function (e) { e.preventDefault(); });
      tr.addEventListener('drop', function (e) {
        e.preventDefault();
        if (dragUid == null) return;
        var at = clipAt(Math.max(0, Math.min(T() - 1, frameAt(e.clientX))));
        var from = edl.findIndex(function (x) { return x.uid === dragUid; });
        var to = at ? at.i : edl.length - 1;
        var lane = +tr.dataset.lane || 0;
        if (from >= 0) {
          edl[from].lane = lane;                 // dropping on v2 STACKS it
          if (to >= 0 && from !== to) {
            var moved = edl.splice(from, 1)[0];
            edl.splice(to, 0, moved);
          }
        }
        dragUid = null; render();
      });
    });

    /* click a caption to delete it — the only way to get rid of one */
    el.notes.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-note]');
      if (!chip) return;
      var id = +chip.dataset.note;
      notes = notes.filter(function (n) { return n.uid !== id; });
      render();
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

    /* A dialog in the site's own hand, because window.prompt() is a grey
       system sheet with a blue OK button in the middle of a comic. It also
       cannot carry a second field, and a caption needs its language. */
    var LANGS = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'pt'];
    function ask(title, value, lang, done) {
      var d = document.createElement('div');
      d.className = 'cl-ask';
      d.innerHTML =
        '<form class="cl-ask-in">' +
          '<h5>' + esc(title) + '</h5>' +
          (lang === null ? '' :
            '<div class="cl-ask-langs">' + LANGS.map(function (L) {
              return '<button type="button" class="cl-lang' +
                (L === lang ? ' on' : '') + '" data-l="' + L + '">' + L +
                '</button>'; }).join('') + '</div>') +
          '<input class="cl-ask-text" maxlength="80" value="' +
            esc(value || '') + '" />' +
          '<div class="cl-ask-row">' +
            '<button type="button" class="cl-btn" data-x="1">Cancel</button>' +
            '<button type="submit" class="cl-btn cl-ok">Save it</button>' +
          '</div>' +
        '</form>';
      document.body.appendChild(d);
      var input = d.querySelector('.cl-ask-text');
      var picked = lang;
      input.focus(); input.select();
      d.addEventListener('click', function (e) {
        var L = e.target.closest('.cl-lang');
        if (L) {
          picked = L.dataset.l;
          d.querySelectorAll('.cl-lang').forEach(function (b) {
            b.classList.toggle('on', b === L); });
          return;
        }
        if (e.target === d || e.target.closest('[data-x]')) close();
      });
      d.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        close();
        if (v) done(v, picked);
      });
      function esckey(e) { if (e.key === 'Escape') close(); }
      addEventListener('keydown', esckey);
      function close() { removeEventListener('keydown', esckey); d.remove(); }
    }

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
        /* fall back to the clip under the playhead: after a delete the stored
           selection can point at a uid that no longer exists, and then the
           button silently did nothing */
        var c = edl.filter(function (x) { return x.uid === sel; })[0] ||
                (s && s.c) || edl[0];
        if (c) ask('Label this clip', c.label, null, function (v) {
          c.label = v.slice(0, 60); render();
        });
        return;
      } else if (what === 'note') {
        /* a CAPTION at the playhead: a language tag plus the line itself.
           The studio calls these annotations; a curated dataset carries them
           alongside the episode so a language-conditioned policy has something
           to condition on. */
        var here = clipAt(playhead);
        ask('Caption at ' + (playhead / 15).toFixed(1) + ' s',
            here ? here.c.label : '', 'en', function (v, lang) {
          notes.push({ uid: ++uid, at: playhead,
                       len: Math.min(45, Math.max(15, total() - playhead)),
                       text: v.slice(0, 80), lang: lang || 'en' });
          render();
        });
        return;
      } else if (what === 'zoomin') {
        zoom = Math.min(24, zoom * 1.6);
      } else if (what === 'zoomout') {
        zoom = Math.max(0.5, zoom / 1.6);
      } else if (what === 'zoomfit') {
        zoom = 1; el.scroll.scrollLeft = 0;
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
    var raf = null, last = 0;
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
      if (document.querySelector('.cl-ask')) return;   // a dialog is open
      if (k === 'b') { e.preventDefault(); act('blade'); }
      else if (k === 'l') { e.preventDefault(); act('label'); }
      else if (k === 'c') { e.preventDefault(); act('note'); }
      else if (k === '=' || k === '+') { e.preventDefault(); act('zoomin'); }
      else if (k === '-') { e.preventDefault(); act('zoomout'); }
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
      notes: function () { return notes; },
      zoom: function () { return zoom; },
      addNote: function (at, text, lang) {
        notes.push({ uid: ++uid, at: at, len: 30, text: text, lang: lang || 'en' });
        render();
      },
      analyse: analyse, eps: eps,
      seek: function (f) { playhead = f; render(); },
      total: total
    };
  }
})();
