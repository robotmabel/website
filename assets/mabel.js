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

  /* ── Dropdown nav groups (click to toggle; hover handled in CSS) ── */
  document.querySelectorAll('.nav-grp-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // clicking the group label jumps to the section's first page
      if (btn.dataset.href) { window.location.href = btn.dataset.href; return; }
      var g = btn.closest('.nav-group');
      var isOpen = g.classList.contains('open');
      document.querySelectorAll('.nav-group').forEach(function (x) { x.classList.remove('open'); });
      if (!isOpen) g.classList.add('open');
    });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.nav-group.open').forEach(function (x) { x.classList.remove('open'); });
  });

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
  /* generic: copy the <pre> that sits next to the button */
  window.copyCode = function (btn) {
    var pre = btn.parentElement && btn.parentElement.querySelector('pre');
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = orig; }, 1800);
    }).catch(function () {});
  };

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

  /* ── Animated wordmark: trigger staggered letter entrance ── */
  var heroTitle = document.querySelector('.hero-title');
  if (heroTitle) {
    var chs = heroTitle.querySelectorAll('.ch');
    if (chs.length && !reduceMotion) {
      chs.forEach(function (c, i) { c.style.transitionDelay = (0.15 + i * 0.07) + 's'; });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { heroTitle.classList.add('in'); });
      });
      // Clear the entrance stagger once it's done so hover stays snappy.
      setTimeout(function () { chs.forEach(function (c) { c.style.transitionDelay = ''; }); }, 1600);
    } else {
      heroTitle.classList.add('in');
    }
  }

  /* ── Rotating hero subtitle: per-letter assemble/disassemble ── */
  var rot = document.querySelector('.hero-sub .rot');
  if (rot) {
    var phrases = [
      'A robot that does the work.',
      'Two hands, one body, no tether.',
      'Built open. Made to be rebuilt.',
      'Fifty-one joints, one mind.',
      'Dexterity you can 3D-print.',
      'The work, done — onboard.'
    ];
    var pi = 0;
    var STAG_IN = 0.028, STAG_OUT = 0.016;

    var build = function (text) {
      rot.textContent = '';
      var words = text.split(' ');
      var idx = 0;
      words.forEach(function (word, wi) {
        var w = document.createElement('span');
        w.className = 'rw';
        for (var c = 0; c < word.length; c++) {
          var l = document.createElement('span');
          l.className = 'rl hid-in';
          l.textContent = word[c];
          l.style.transitionDelay = (idx * STAG_IN) + 's';
          w.appendChild(l);
          idx++;
        }
        rot.appendChild(w);
        if (wi < words.length - 1) rot.appendChild(document.createTextNode(' '));
      });
      // commit hidden state, then release so letters rise in, left → right
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          rot.querySelectorAll('.rl').forEach(function (l) { l.classList.remove('hid-in'); });
        });
      });
    };

    var swap = function () {
      if (document.hidden) return;
      var letters = rot.querySelectorAll('.rl');
      letters.forEach(function (l, i) {
        l.style.transitionDelay = (i * STAG_OUT) + 's';
        l.classList.add('hid-out');
      });
      var outMs = Math.min(letters.length * STAG_OUT * 1000 + 480, 640);
      setTimeout(function () {
        pi = (pi + 1) % phrases.length;
        build(phrases[pi]);
      }, outMs);
    };

    build(phrases[0]);          // assemble the first line on load
    setInterval(swap, 4400);
  }

  /* ── ROS graph: hover/tap a node → glass popup near the card ── */
  var rgWrap = document.getElementById('rosGraph');
  if (rgWrap) {
    var pop = document.createElement('div');
    pop.className = 'rg-pop';
    pop.innerHTML = '<div class="rg-pop-t"></div><div class="rg-pop-d"></div>';
    rgWrap.appendChild(pop);
    var popT = pop.querySelector('.rg-pop-t');
    var popD = pop.querySelector('.rg-pop-d');
    var rgNodes = rgWrap.querySelectorAll('.rg-node');
    var rgActive = null;

    var showPop = function (g) {
      popT.textContent = g.getAttribute('data-title') || '';
      popD.textContent = g.getAttribute('data-desc') || '';
      pop.style.setProperty('--rg-accent', g.getAttribute('data-accent') || '#C25B2A');
      pop.classList.add('on');
      var cr = rgWrap.getBoundingClientRect();
      var br = g.getBoundingClientRect();
      var cx = (br.left - cr.left) + br.width / 2;
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = Math.max(8, Math.min(cx - pw / 2, cr.width - pw - 8));
      var top = (br.top - cr.top) - ph - 12;          // above the node
      if (top < 6) top = (br.bottom - cr.top) + 12;   // flip below if no room
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    };
    var hidePop = function () { pop.classList.remove('on'); rgActive = null; };

    rgNodes.forEach(function (g) {
      g.addEventListener('mouseenter', function () { rgActive = g; showPop(g); });
      g.addEventListener('mouseleave', function () { if (canHover) hidePop(); });
      g.addEventListener('click', function (e) {
        e.stopPropagation();
        if (rgActive === g) { hidePop(); } else { rgActive = g; showPop(g); }
      });
    });
    document.addEventListener('click', function () { if (rgActive) hidePop(); });
    window.addEventListener('resize', function () { if (rgActive) showPop(rgActive); });
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
    if (nav) {
      // Stable centered pill: only firm up the glass when scrolled (no collapse).
      nav.classList.toggle('scrolled', y > 12);
    }

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

/* ── Lazy looping clips: video[data-lazyvid] ──────────────────────────
   Two-tier progressive loading: the tiny -lo rendition (~100-300 KB)
   starts playing the moment a clip nears the viewport; the full-quality
   file streams in the background (one at a time, so nothing contends)
   and is swapped in at the same timestamp. Off-screen clips pause. */
(function () {
  'use strict';
  var vids = Array.prototype.slice.call(document.querySelectorAll('video[data-lazyvid]'));

  /* background high-res fetch queue — strictly one at a time */
  var hiQueue = [], hiBusy = false;
  function pumpHi() {
    if (hiBusy) return;
    var v = hiQueue.shift();
    if (!v || v.dataset.hiDone) { if (v) pumpHi(); return; }
    hiBusy = true;
    fetch(v.dataset.lazyvid)
      .then(function (r) { return r.ok ? r.blob() : Promise.reject(); })
      .then(function (blob) {
        v.dataset.hiDone = '1';
        var url = URL.createObjectURL(blob);
        var t = v.currentTime, playing = !v.paused;
        /* Swap into a HIDDEN sibling and only reveal it once it is decoding at
           the same timestamp. Assigning v.src directly blanked the element for
           a frame or two, and anything drawn over the clip — a speech balloon,
           a burst — flickered with it. */
        var hi = v.cloneNode(false);
        hi.removeAttribute('poster');
        hi.className = v.className;
        hi.style.cssText = v.getAttribute('style') || '';
        hi.muted = true; hi.loop = v.loop; hi.playsInline = true;
        hi.style.position = 'absolute'; hi.style.inset = '0';
        hi.style.width = '100%'; hi.style.height = '100%';
        hi.style.opacity = '0';
        /* Wrap the clip in its own positioned box first. Absolutely
           positioning the incoming copy against the <figure> made it cover
           the caption underneath — and if canplay never fired (an off-screen
           clip stays paused) the caption stayed hidden for good. */
        var parent = v.parentNode;
        if (!parent.classList || !parent.classList.contains('vid-swap')) {
          var wrap = document.createElement('span');
          wrap.className = 'vid-swap';
          parent.insertBefore(wrap, v);
          wrap.appendChild(v);
          parent = wrap;
        }
        var reveal = function () {
          hi.removeEventListener('canplay', reveal);
          try { hi.currentTime = t; } catch (e) {}
          var p = playing ? hi.play() : null;
          if (p && p.catch) p.catch(function () {});
          requestAnimationFrame(function () {
            hi.style.opacity = '1';
            /* hand the original element's identity over, then drop it */
            setTimeout(function () {
              try { v.pause(); } catch (e) {}
              v.remove();
              hi.style.position = ''; hi.style.inset = '';
              hi.style.opacity = '';
            }, 60);
          });
        };
        hi.addEventListener('canplay', reveal);
        hi.src = url;
        parent.insertBefore(hi, v.nextSibling);
        hi.load();
      })
      .catch(function () { v.dataset.hiDone = '1'; })
      .then(function () { hiBusy = false; pumpHi(); });
  }

  function start(v) {
    if (!v.src) {
      /* low rendition first (or straight to full if no -lo exists) */
      v.src = v.dataset.lo || v.dataset.lazyvid;
      v.load();
      if (v.dataset.lo && v.dataset.lazyvid !== v.dataset.lo) {
        hiQueue.push(v); pumpHi();
      } else {
        v.dataset.hiDone = '1';
      }
    }
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  }

  /* start EVERY clip the moment the page opens: the tiny -lo renditions
     load in parallel right away; the full files stream one at a time
     behind them. The observer only handles play/pause by visibility. */
  vids.forEach(function (v) { start(v); });
  var io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else if (v.src) v.pause();
      });
    }, { rootMargin: '400px 0px' });
    vids.forEach(function (v) { io.observe(v); });
  }

  /* Clips that arrive AFTER this ran — the scene gallery builds itself from
     assets/sim/scenes/index.json, so its videos do not exist at page load and
     would otherwise never start. Whoever creates them calls this. */
  window.__lazyVid = function (root) {
    var fresh = Array.prototype.slice.call(
      (root || document).querySelectorAll('video[data-lazyvid]'))
      .filter(function (v) { return vids.indexOf(v) < 0; });
    fresh.forEach(function (v) { vids.push(v); start(v); if (io) io.observe(v); });
    return fresh.length;
  };

  /* a freshly shown tab panel: start its clips immediately */
  function wantsPlay(v) {
    var r = v.getBoundingClientRect();
    return r.bottom > -100 && r.top < innerHeight + 100 && v.offsetParent !== null;
  }
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setTimeout(function () {
        vids.forEach(function (v) { if (wantsPlay(v)) start(v); });
      }, 30);
    });
  });
})();

/* ── Marquee rail: manual drag/scroll (mouse, touch, trackpad) ─────── */
(function () {
  'use strict';
  document.querySelectorAll('.marquee').forEach(function (rail) {
    var down = false, sx = 0, sl = 0, moved = false;
    rail.addEventListener('pointerdown', function (e) {
      down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft;
      rail.classList.add('dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - sx;
      if (Math.abs(dx) > 4) moved = true;
      rail.scrollLeft = sl - dx;
    });
    window.addEventListener('pointerup', function () {
      down = false; rail.classList.remove('dragging');
    });
    /* swallow the click after a drag so cards don't navigate accidentally */
    rail.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  });
})();

/* ── Tab deep-links: #hw-hands style hashes activate that tab ──────── */
(function () {
  'use strict';
  var id = (location.hash || '').slice(1);
  if (!id) return;
  var panel = document.getElementById(id);
  if (!panel || !panel.classList.contains('tab-panel')) return;
  var btn = document.querySelector('.tab-btn[data-tab="' + id + '"]');
  if (btn) btn.click();
  setTimeout(function () { panel.scrollIntoView(); window.scrollBy(0, -220); }, 60);
})();

/* ── Architecture map: hover tips + branch toggle ─────────────────── */
(function () {
  'use strict';
  var map = document.getElementById('archMap');
  if (!map) return;
  var tip = document.createElement('div');
  tip.className = 'arch-tip';
  map.appendChild(tip);
  map.querySelectorAll('[data-tip]').forEach(function (a) {
    a.addEventListener('mouseenter', function () {
      tip.textContent = a.getAttribute('data-tip');
      tip.classList.add('on');
      var mr = map.getBoundingClientRect(), ar = a.getBoundingClientRect();
      var x = ar.left - mr.left + ar.width / 2;
      tip.style.left = Math.max(8, Math.min(x - 150, mr.width - 308)) + 'px';
      var top = ar.top - mr.top - tip.offsetHeight - 12;
      if (top < 4) top = ar.bottom - mr.top + 12;
      tip.style.top = top + 'px';
    });
    a.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
  });
  map.querySelectorAll('.arch-toggle button').forEach(function (b) {
    b.addEventListener('click', function () {
      map.querySelectorAll('.arch-toggle button').forEach(function (x) { x.classList.toggle('on', x === b); });
      map.classList.remove('pick-hw', 'pick-sim');
      map.classList.add(b.dataset.branch === 'hw' ? 'pick-hw' : 'pick-sim');
    });
  });
  map.classList.add('pick-hw');
})();

/* ── Jumpy comic baseline: split .jumpy elements into letter spans ── */
(function () {
  'use strict';
  document.querySelectorAll('.jumpy').forEach(function (el) {
    if (el.dataset.jumped) return;
    el.dataset.jumped = '1';
    var text = el.textContent;
    el.textContent = '';
    for (var i = 0; i < text.length; i++) {
      if (text[i] === ' ') { el.appendChild(document.createTextNode(' ')); continue; }
      var sp = document.createElement('span');
      sp.textContent = text[i];
      el.appendChild(sp);
    }
  });
})();
