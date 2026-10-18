/* Live comic halftone over the Home · shop · street grid (index.html #home).
 *
 * Every cell with a data-tone gets a <canvas> drawn from its own photo, GIF or
 * clip, re-sampled each frame, so the dots move with the footage. Dots sit on a
 * staggered (45°) screen, their radius set by how dark the picture is there, and
 * a slow diagonal wave swells and shrinks them so the grid reads like a printed
 * page that is breathing. The pointer is a lens: dots under it shrink to
 * nothing, and holding over a cell wipes the whole tile back to the photo.
 * A tap on a phone does the same. #htToggle turns the effect off for the page
 * (remembered per visitor); prefers-reduced-motion draws it once, still.
 */
(function () {
  var grid = document.getElementById('rgGrid');
  if (!grid) return;
  var toggle = document.getElementById('htToggle');
  var css = getComputedStyle(document.documentElement);
  function tok(n, d) { var v = css.getPropertyValue(n).trim(); return v || d; }
  var INK = tok('--ink', '#151820');
  var TONES = {
    red:    { bg: tok('--hi', '#E4442A'),     dot: INK },
    yellow: { bg: tok('--yellow', '#F2C94C'), dot: INK },
    blue:   { bg: tok('--blue', '#23577E'),   dot: INK },
    green:  { bg: tok('--green', '#2E7D4F'),  dot: INK },
    paper:  { bg: tok('--panel', '#FDF6E2'),  dot: tok('--blue', '#23577E') }
  };
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sample = document.createElement('canvas');
  var sctx = sample.getContext('2d', { willReadFrequently: true });
  var cells = [];
  var on = true;
  try { on = localStorage.getItem('mabel-halftone') !== 'off'; } catch (e) {}

  [].forEach.call(grid.querySelectorAll('.rg-cell[data-tone]'), function (fig) {
    var tone = TONES[fig.getAttribute('data-tone')];
    if (!tone) return;
    var cv = document.createElement('canvas');
    cv.className = 'rg-ht';
    cv.setAttribute('aria-hidden', 'true');
    var tag = fig.querySelector('.rg-tag');
    fig.insertBefore(cv, tag || null);
    var c = { fig: fig, cv: cv, ctx: cv.getContext('2d'), tone: tone, w: 0, h: 0, dpr: 1,
              visible: false, px: -1e4, py: -1e4, lens: 0, lensTo: 0, drawn: false };
    cells.push(c);
    fig.addEventListener('pointermove', function (e) {
      var r = fig.getBoundingClientRect(); c.px = e.clientX - r.left; c.py = e.clientY - r.top;
      if (e.pointerType === 'mouse') c.lensTo = 1;
    });
    fig.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') c.lensTo = 0; });
    fig.addEventListener('click', function (e) {
      if (e.pointerType === 'mouse') return;
      var r = fig.getBoundingClientRect(); c.px = e.clientX - r.left; c.py = e.clientY - r.top;
      c.lensTo = c.lensTo ? 0 : 1;
    });
  });
  if (!cells.length) return;

  function media(fig) {
    var v = fig.querySelector('video');
    if (v && v.readyState >= 2 && v.videoWidth) return { el: v, w: v.videoWidth, h: v.videoHeight };
    var im = fig.querySelector('img:not(.rg-ht)');
    if (im && im.complete && im.naturalWidth) return { el: im, w: im.naturalWidth, h: im.naturalHeight };
    if (v && v.poster) return null;
    return null;
  }

  function size(c) {
    var r = c.fig.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width), h = Math.round(r.height);
    if (w === c.w && h === c.h && dpr === c.dpr) return;
    c.w = w; c.h = h; c.dpr = dpr;
    c.cv.width = Math.max(1, w * dpr); c.cv.height = Math.max(1, h * dpr);
    c.drawn = false;
  }

  function draw(c, t) {
    var m = media(c.fig);
    if (!m || !c.w) return;
    var w = c.w, h = c.h, ctx = c.ctx;
    // dot pitch: ~1/52 of the cell, never finer than 5 px or coarser than 11 px
    var pitch = Math.max(5, Math.min(11, w / 52));
    var cols = Math.ceil(w / pitch) + 2, rows = Math.ceil(h / (pitch * 0.5)) + 2;
    // cover-fit crop, the same one object-fit: cover shows underneath
    var s = Math.max(w / m.w, h / m.h), sw = w / s, sh = h / s;
    sample.width = cols; sample.height = rows;
    try {
      sctx.drawImage(m.el, (m.w - sw) / 2, (m.h - sh) / 2, sw, sh, 0, 0, cols, rows);
      var d = sctx.getImageData(0, 0, cols, rows).data;
    } catch (e) { return; }
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    // the lens grows from the pointer until it covers the whole tile
    var reach = Math.hypot(w, h) * 1.1;
    var lensR = 70 + c.lens * reach;
    // at full size neighbouring dots just merge, so the deepest darks print solid, comic-style
    var half = pitch * 0.5, maxR = pitch * 0.42;
    // auto-levels: stretch this frame's 4th..96th luminance percentiles to the full
    // range, so a night shot reads as well as a sunlit one (most footage here is dark)
    var n = cols * rows, lum = new Float32Array(n);
    for (var q = 0; q < n; q++) lum[q] = (0.2126 * d[q * 4] + 0.7152 * d[q * 4 + 1] + 0.0722 * d[q * 4 + 2]) / 255;
    var srt = Array.prototype.slice.call(lum).sort(function (a, b) { return a - b; });
    var lo = srt[Math.floor(n * 0.04)], hi = srt[Math.floor(n * 0.96)], span = Math.max(0.08, hi - lo);
    // a dark frame (night, a dim kitchen) flips: ink paper, tone-coloured dots sized by
    // LIGHT, so the white robot is the shape you see. Decided once per cell (no flicker).
    if (c.inv == null) c.inv = srt[Math.floor(n * 0.5)] < 0.4;
    var inv = c.inv;
    ctx.fillStyle = inv ? INK : c.tone.bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = inv ? c.tone.bg : c.tone.dot;
    for (var j = 0; j < rows; j++) {
      var y = (j - 1) * half, off = (j & 1) ? half : 0;
      for (var i = 0; i < cols; i++) {
        var x = (i - 1) * pitch + off;
        var L = Math.min(1, Math.max(0, (lum[j * cols + i] - lo) / span));
        L = (L - 0.12) / 0.76; L = L < 0 ? 0 : L > 1 ? 1 : L; L = L * L * (3 - 2 * L);   // S-curve: punchier mids
        // ink only where the picture is darker than mid-grey-ish; the tone carries the rest
        var dark = inv ? L : 1 - L;
        if (dark < 0.03) continue;
        // a slow diagonal swell so the dots breathe in bands across the tile
        var wave = still ? 1 : 0.78 + 0.34 * Math.sin(t * 1.6 - (x + y) * 0.022);
        var r = maxR * Math.sqrt(dark) * wave;   // dot AREA ~ ink coverage
        if (c.lens > 0.001 || c.px > -1e3) {
          var dist = Math.hypot(x - c.px, y - c.py);
          if (dist < lensR) r *= Math.max(0, (dist - lensR + 70) / 70);
        }
        if (r < 0.35) continue;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      }
    }
    // the lens cuts through to the photo: clear a soft-edged disc around the pointer
    if (c.lens > 0.001 && c.px > -1e3) {
      var g = ctx.createRadialGradient(c.px, c.py, Math.max(0, lensR - 70), c.px, c.py, lensR);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    c.drawn = true;
  }

  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      for (var i = 0; i < cells.length; i++) if (cells[i].fig === e.target) cells[i].visible = e.isIntersecting;
    });
    kick();
  }, { rootMargin: '120px' });
  cells.forEach(function (c) { io.observe(c.fig); });

  var raf = 0, last = 0;
  function frame(now) {
    raf = 0;
    if (!on) return;
    var t = now / 1000, busy = false;
    if (now - last >= 40 || still) {   // ~25 fps is plenty for print dots
      last = now;
      cells.forEach(function (c) {
        if (!c.visible) return;
        size(c);
        c.lens += (c.lensTo - c.lens) * 0.18;
        if (Math.abs(c.lensTo - c.lens) < 0.002) c.lens = c.lensTo;
        if (c.lens === 0 && c.lensTo === 0) { c.px = -1e4; c.py = -1e4; }
        if (still && c.drawn && c.lens === c.lensTo) return;
        draw(c, t);
      });
    }
    cells.forEach(function (c) { if (c.visible && (!still || c.lens !== c.lensTo || !c.drawn)) busy = true; });
    if (busy) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && on) raf = requestAnimationFrame(frame); }

  function apply() {
    grid.classList.toggle('ht-off', !on);
    if (toggle) toggle.checked = on;
    cells.forEach(function (c) { c.drawn = false; });
    kick();
  }
  if (toggle) toggle.addEventListener('change', function () {
    on = toggle.checked;
    try { localStorage.setItem('mabel-halftone', on ? 'on' : 'off'); } catch (e) {}
    apply();
  });
  // a cell's picture can arrive late (lazy GIF swap, clip start): redraw when it does
  grid.addEventListener('load', function () { cells.forEach(function (c) { c.drawn = false; }); kick(); }, true);
  grid.addEventListener('loadeddata', function () { kick(); }, true);
  window.addEventListener('resize', function () { cells.forEach(function (c) { c.w = 0; }); kick(); });
  apply();
})();
