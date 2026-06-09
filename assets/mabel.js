/* ═══════════════════════════════════════════════════════════════════
   MABEL — shared interactions
   Nav state, mobile menu, scroll progress, reveals, counters, tabs,
   bibtex copy, pointer-glow, scroll-linked parallax, media reveal.
   Defensive: every block guards for missing elements, so a page can
   include only the markup it needs.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ── Scroll progress bar ── */
  var prog = document.getElementById('progress');

  /* ── Nav scrolled state ── */
  var nav = document.getElementById('nav');

  /* ── Mobile menu ── */
  var hbg = document.getElementById('hbg');
  var mob = document.getElementById('mob');
  if (hbg && mob) {
    var open = false;
    var setMenu = function (v) { open = v; mob.style.transform = v ? 'translateY(0)' : ''; };
    hbg.addEventListener('click', function () { setMenu(!open); });
    document.addEventListener('click', function (e) {
      if (open && !mob.contains(e.target) && !hbg.contains(e.target)) setMenu(false);
    });
    mob.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  }

  /* ── Fade-up reveal ── */
  var fades = document.querySelectorAll('.fade-up');
  if (fades.length) {
    var fobs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); fobs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    fades.forEach(function (el) { fobs.observe(el); });
  }

  /* ── Media scale-in reveal ── */
  var medias = document.querySelectorAll('.reveal-media');
  if (medias.length) {
    var mobs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); mobs.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    medias.forEach(function (el) { mobs.observe(el); });
  }

  /* ── Number counters ── */
  var counters = document.querySelectorAll('.counter');
  if (counters.length) {
    var cobs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var raw = el.dataset.target || '0';
        var isFloat = raw.indexOf('.') !== -1;
        var target = parseFloat(raw);
        if (reduceMotion) { el.textContent = isFloat ? target.toFixed(1) : target; cobs.unobserve(el); return; }
        var dur = 1300, start = performance.now();
        var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
        var tick = function (now) {
          var t = Math.min(1, (now - start) / dur);
          var v = target * ease(t);
          el.textContent = isFloat ? v.toFixed(1) : Math.round(v);
          if (t < 1) requestAnimationFrame(tick); else el.textContent = isFloat ? target.toFixed(1) : target;
        };
        requestAnimationFrame(tick);
        cobs.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { cobs.observe(el); });
  }

  /* ── Tabs (independent groups via [data-tabs]) ── */
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.tab;
      var group = btn.closest('[data-tabs]') || document;
      group.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('on'); });
      group.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('on'); });
      btn.classList.add('on');
      var panel = group.querySelector('#' + target) || document.getElementById(target);
      if (panel) panel.classList.add('on');
    });
  });

  /* ── BibTeX copy ── */
  window.copyBib = function (btn) {
    var pre = document.getElementById('bib-text');
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = orig; }, 1800);
    }).catch(function () {});
  };

  /* ── Smooth anchor scroll with nav offset ── */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id.length > 1) {
        var t = document.querySelector(id);
        if (t) {
          e.preventDefault();
          var top = t.getBoundingClientRect().top + window.scrollY - 76;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }
      }
    });
  });

  /* ── 3D viewer fullscreen toggle ── */
  document.querySelectorAll('[data-viewer-fullscreen]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var box = btn.closest('.viewer-3d');
      if (!box) return;
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (box.requestFullscreen) {
        box.requestFullscreen();
      } else if (box.webkitRequestFullscreen) {
        box.webkitRequestFullscreen();
      }
    });
  });

  /* ── Pointer-follow glow inside hero ── */
  var hero = document.querySelector('.hero-home, .page-hero');
  if (hero && canHover && !reduceMotion) {
    var glow = document.createElement('div');
    glow.className = 'hero-glow';
    hero.appendChild(glow);
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      glow.style.left = (e.clientX - r.left) + 'px';
      glow.style.top = (e.clientY - r.top) + 'px';
      glow.classList.add('show');
    });
    hero.addEventListener('pointerleave', function () { glow.classList.remove('show'); });
  }

  /* ── Single rAF scroll loop: progress + nav + parallax ── */
  var heroInner = document.querySelector('.hero-home-inner');
  var coordRow = document.querySelector('.hero-coord-row');
  var parallaxEls = Array.prototype.slice.call(document.querySelectorAll('[data-speed]'));
  var ticking = false;

  function frame() {
    var y = window.scrollY;
    var vh = window.innerHeight;

    if (prog) {
      var h = document.documentElement.scrollHeight - vh;
      prog.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
    }
    if (nav) nav.classList.toggle('scrolled', y > 12);

    if (!reduceMotion) {
      // hero depth: content drifts up + fades as you leave the first screen
      if (heroInner && y < vh) {
        heroInner.style.transform = 'translateY(' + (y * 0.14).toFixed(1) + 'px)';
        heroInner.style.opacity = String(Math.max(0, 1 - (y / vh) * 1.15));
      }
      if (coordRow && y < vh) {
        coordRow.style.opacity = String(Math.max(0, 1 - (y / vh) * 2.2));
      }
      // generic parallax
      var cy = vh / 2;
      for (var i = 0; i < parallaxEls.length; i++) {
        var el = parallaxEls[i];
        var r = el.getBoundingClientRect();
        var off = (r.top + r.height / 2) - cy;
        var sp = parseFloat(el.dataset.speed) || 0;
        el.style.transform = 'translateY(' + (-off * sp).toFixed(1) + 'px)';
      }
    }
    ticking = false;
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  frame();
})();
