/* The landscape MABEL is built into — platforms, filterable, with on-demand motion previews.
 *
 * Core comparison rows follow the active RA-L manuscript. The extended survey
 * retains additional platforms; Sunday Memo and Dyna Taku use the author's
 * submission sources. Each motion preview records its credit and source URL.
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
  var dof = function (n) { return n == null ? 'n.d.' : n; };
  var money = function (c) { return c == null ? 'n.d.' : '$' + Math.round(c * 1000).toLocaleString('en-US'); };

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

  fetch('assets/data/platforms.json', { cache: 'no-cache' })
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
        '<h3 class="pt-title">Platform comparison</h3>' +
      '</div>' +
      '<div class="pt-filters">' +
        FILTERS.map(function (f) {
          return '<button type="button" class="pt-chip" data-f="' + f[0] + '">' +
                 esc(f[1]) + '</button>';
        }).join('') +
        '<button type="button" class="pt-clear">clear</button>' +
      '</div>' +
      '<p class="pt-verdict"></p>' +
      '<p class="pt-hint">Hover a robot to see it move · tap or focus its name to preview</p>' +
      '<div class="pt-scroll"><table class="pt-table"><thead><tr>' +
        [['name', 'Platform'], ['base', 'Base'], ['arms', 'Arms'],
         ['hand', 'Hand DOF'], ['neck', 'Neck'], ['lift', 'Lift / torso'],
         ['cost', 'Cost'], ['open', 'Open']].map(function (c) {
          return '<th data-sort="' + c[0] + '">' + esc(c[1]) + '</th>';
        }).join('') +
      '</tr></thead><tbody></tbody></table></div>' +

      '<p class="pt-src">' + esc(D.cost_note) + '. Links go to the project page ' +
        'or paper the survey cites. Motion previews credit their original source. Source: <code>' +
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
      if (hideCard) hideCard();
      var rows = D.platforms.filter(keep);
      rows.sort(function (a, b) {
        var x = a[sortKey], y = b[sortKey];
        if (sortKey === 'cost') { x = x == null ? 1e9 : x; y = y == null ? 1e9 : y; }
        if (typeof x === 'string') return sortDir * x.localeCompare(y);
        return sortDir * ((x === true ? 1 : x === false ? 0 : x) -
                          (y === true ? 1 : y === false ? 0 : y));
      });
      /* ours always sits FIRST: the table shows eight rows and scrolls, so a
         last-place MABEL row would start out of sight */
      rows.sort(function (a, b) { return (b.ours ? 1 : 0) - (a.ours ? 1 : 0); });

      tbody.innerHTML = rows.map(function (r) {
        return '<tr class="' + (r.ours ? 'ours' : '') + '" data-row="' + esc(r.name) + '">' +
          '<td class="pt-name">' +
            '<button type="button" class="pt-preview-trigger" aria-haspopup="dialog" ' +
              'aria-controls="platformPreview" aria-expanded="false" aria-label="Preview ' + esc(r.name) + '">' +
              '<b>' + esc(r.name) + '</b><span class="pt-play" aria-hidden="true">▶</span></button>' +
            '<i class="pt-sub">' + esc(r.base) + ' · ' + esc(r.arms) + ' arms</i></td>' +
          /* data-label carries the column header into the cell so the phone
             layout can turn each row into a card — a CSS-only stack has no
             way to know which column a number came from */
          '<td data-label="Base">' + esc(r.base) +
            (r.holo === true ? ' <span class="pt-y">holo</span>' : '') + '</td>' +
          '<td class="pt-n" data-label="Arms">' + esc(r.arms) + '</td>' +
          '<td class="pt-n' + (r.hand > 1 ? ' hi' : '') +
            '" data-label="Hand DOF">' + dof(r.hand) + '</td>' +
          '<td class="pt-n' + (r.neck >= 1 ? ' hi' : '') +
            '" data-label="Neck">' + dof(r.neck) + '</td>' +
          '<td data-label="Lift / torso">' + esc(r.lift) + '</td>' +
          '<td class="pt-n' + (r.cost != null && r.cost < 10 ? ' hi' : '') +
            '" data-label="Cost">' + money(r.cost) + '</td>' +
          '<td data-label="Licence">' + (r.open ? '<span class="pt-open">open</span>'
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
      fit();
    }

    /* Eight rows visible, the rest scroll inside the table (header stays put).
       Measured, not fixed: rows are taller on a phone, where they carry a sub-line. */
    var VISIBLE = 8;
    function fit() {
      var box = host.querySelector('.pt-scroll'), trs = tbody.rows;
      if (!box) return;
      box.style.maxHeight = '';
      box.classList.toggle('capped', trs.length > VISIBLE);
      if (trs.length <= VISIBLE) return;
      var top = box.getBoundingClientRect().top;
      var cut = trs[VISIBLE - 1].getBoundingClientRect().bottom - top;
      // never taller than ~70% of the screen: a scroll box taller than the viewport traps the page's own scroll
      box.style.maxHeight = Math.ceil(Math.min(cut + 18, window.innerHeight * 0.7)) + 'px';
    }
    window.addEventListener('resize', fit);

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

    /* Videos are deliberately NOT intersection-autoplay clips: no poster or
       video bytes load until this explicit hover/focus/tap interaction. The
       floating card lives on body so the survey's scrolling/animated ancestors
       cannot clip it or turn position:fixed into a local containing block. */
    var card = document.createElement('div');
    card.className = 'pt-card pt-preview-card';
    card.id = 'platformPreview';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'platformPreviewTitle');
    document.body.appendChild(card);
    var currentRow = null, dismissTimer, pinned = false;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function hideCard() {
      clearTimeout(dismissTimer);
      var video = card.querySelector('video');
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      if (currentRow) {
        currentRow.classList.remove('pt-previewing');
        currentRow.querySelector('.pt-preview-trigger').setAttribute('aria-expanded', 'false');
      }
      currentRow = null;
      pinned = false;
      card.hidden = true;
      card.innerHTML = '';
    }
    function laterHide() {
      clearTimeout(dismissTimer);
      if (!pinned) dismissTimer = setTimeout(hideCard, 160);
    }
    function positionCard(row) {
      var b = row.getBoundingClientRect(), pad = 12;
      var w = card.offsetWidth, h = card.offsetHeight;
      var viewport = window.visualViewport;
      var vw = viewport ? viewport.width : document.documentElement.clientWidth;
      var vh = viewport ? viewport.height : window.innerHeight;
      var x = b.left + Math.min(row.cells[0].offsetWidth, 240) + 16;
      var y = b.top - 12;
      if (vw <= 720) {
        x = (vw - w) / 2;
        y = vh - h - pad;
      } else if (x + w > vw - pad) {
        x = b.left - w - 16;
      }
      card.style.left = Math.max(pad, Math.min(x, vw - w - pad)) + 'px';
      card.style.top = Math.max(pad, Math.min(y, vh - h - pad)) + 'px';
    }
    function showCard(row) {
      clearTimeout(dismissTimer);
      if (currentRow === row && !card.hidden) return;
      hideCard();
      var r = D.platforms.filter(function (x) { return x.name === row.dataset.row; })[0];
      if (!r) return;
      currentRow = row;
      row.classList.add('pt-previewing');
      row.querySelector('.pt-preview-trigger').setAttribute('aria-expanded', 'true');
      var preview = r.preview;
      card.innerHTML =
        '<div class="pt-card-head"><div><b id="platformPreviewTitle">' + esc(r.name) +
        '</b><span class="pt-card-y">' + r.year + '</span></div>' +
        '<button type="button" class="pt-card-close" aria-label="Close preview">×</button></div>' +
        (preview ? '<video class="pt-preview-video" data-hover-preview muted loop playsinline controls ' +
          'preload="none" poster="' + esc(preview.poster) + '" aria-label="' + esc(r.name) + ' moving"></video>' +
          '<a class="pt-video-credit" href="' + esc(preview.source_url) + '" target="_blank" rel="noopener">' +
          esc(preview.credit) + ' · ' + esc(preview.label || 'Motion preview') + ' ↗</a>'
        : '<p>Motion preview unavailable. Visit the project for demonstrations.</p>') +
        '<p>' + esc(r.focus) + '</p>' +
        '<dl><div><dt>Base</dt><dd>' + esc(r.base) + '</dd></div>' +
        '<div><dt>Arms</dt><dd>' + esc(r.arms) + '</dd></div>' +
        '<div><dt>Hand / neck</dt><dd>' + dof(r.hand) + ' / ' + dof(r.neck) + ' DOF</dd></div>' +
        '<div><dt>Lift / torso</dt><dd>' + esc(r.lift) + '</dd></div>' +
        '<div><dt>Cost</dt><dd>' + money(r.cost) + '</dd></div></dl>' +
        (r.note ? '<em>' + esc(r.note) + '</em>' : '') +
        (r.link ? '<a class="pt-card-link" href="' + esc(r.link) +
          '" target="_blank" rel="noopener">Visit project ↗</a>' : '');
      card.hidden = false;
      positionCard(row);
      card.querySelector('.pt-card-close').addEventListener('click', function () {
        var trigger = currentRow && currentRow.querySelector('.pt-preview-trigger');
        hideCard();
        if (trigger) { trigger.focus({ preventScroll: true }); hideCard(); }
      });
      var video = card.querySelector('video');
      if (video) {
        video.muted = true;
        video.src = preview.video;
        video.addEventListener('error', function () {
          if (currentRow !== row || !video.getAttribute('src')) return;
          var msg = document.createElement('p');
          msg.textContent = 'Preview could not load. Open the credited source to watch.';
          video.replaceWith(msg);
          positionCard(row);
        });
        if (!reducedMotion.matches) video.play().catch(function () { /* native play control remains available */ });
      }
    }
    host.addEventListener('pointerover', function (e) {
      var row = e.target.closest('tbody tr[data-row]');
      if (row && e.pointerType === 'mouse') showCard(row);
    });
    host.addEventListener('pointerout', function (e) {
      var row = e.target.closest('tbody tr[data-row]');
      if (row && !row.contains(e.relatedTarget)) laterHide();
    });
    host.addEventListener('focusin', function (e) {
      var row = e.target.closest('tbody tr[data-row]');
      if (row) showCard(row);
    });
    host.addEventListener('focusout', function (e) {
      if (!host.contains(e.relatedTarget) && !card.contains(e.relatedTarget)) laterHide();
    });
    host.addEventListener('click', function (e) {
      var trigger = e.target.closest('.pt-preview-trigger');
      if (!trigger) return;
      var row = trigger.closest('tr');
      if (currentRow === row && pinned) hideCard();
      else { showCard(row); pinned = true; if (e.detail === 0) card.querySelector('.pt-card-close').focus(); }
    });
    card.addEventListener('pointerenter', function () { clearTimeout(dismissTimer); });
    card.addEventListener('pointerleave', laterHide);
    card.addEventListener('focusin', function () { clearTimeout(dismissTimer); });
    card.addEventListener('focusout', function (e) {
      if (!card.contains(e.relatedTarget) && !(currentRow && currentRow.contains(e.relatedTarget))) laterHide();
    });
    document.addEventListener('pointerdown', function (e) {
      if (!card.hidden && !card.contains(e.target) && !(currentRow && currentRow.contains(e.target))) hideCard();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideCard(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) hideCard(); });
    function onScroll() {
      if (currentRow && currentRow.contains(document.activeElement)) {
        var b = currentRow.getBoundingClientRect();
        var scroll = host.querySelector('.pt-scroll').getBoundingClientRect();
        if (b.bottom > Math.max(0, scroll.top) && b.top < Math.min(innerHeight, scroll.bottom)) {
          positionCard(currentRow); return;
        }
      }
      hideCard();
    }
    host.querySelector('.pt-scroll').addEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', hideCard);
    reducedMotion.addEventListener('change', function () {
      var video = card.querySelector('video');
      if (video && reducedMotion.matches) video.pause();
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
