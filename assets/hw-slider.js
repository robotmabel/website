/* The subsystem slider on hardware.html.
 *
 * Eight modules, side by side, scrolled horizontally. Each card carries a
 * portrait of the actual part (rendered from the MJCF by
 * simulation/mabel_mujoco/scripts/tools/render_module_shots.py, so it cannot
 * disagree with the robot), what the subsystem is, why it is built that way,
 * its measured specs, and what it costs.
 *
 * Open a card and it expands to the full parts list — every line with its BOM
 * reference, quantity, price and a link to where it was actually bought. That
 * data is generated from BOM/data/*.csv by scripts/build_hw_modules.py, which
 * is why the numbers here and the numbers in the printed build guide agree.
 *
 * This replaced a tab strip whose "— full page →" buttons linked to the tab
 * you were already looking at.
 */
(function () {
  var host = document.getElementById('hwSlider');
  if (!host) return;

  var USD = function (v) {
    return '$' + Math.round(v).toLocaleString('en-US');
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  fetch('assets/data/hw-modules.json')
    .then(function (r) { return r.json(); })
    .then(build)
    .catch(function (e) {
      host.innerHTML = '<p class="hs-err">Could not load the module data.</p>';
      console.error('[hw-slider]', e);
    });

  function build(data) {
    var mods = data.modules;
    var html =
      '<div class="hs-head">' +
        '<span class="hs-count">' + mods.length + ' subsystems</span>' +
        '<div class="hs-nav">' +
          '<button class="hs-arrow" data-dir="-1" aria-label="Previous">‹</button>' +
          '<button class="hs-arrow" data-dir="1" aria-label="Next">›</button>' +
        '</div>' +
      '</div>' +
      '<div class="hs-rail" tabindex="0" role="list">';

    mods.forEach(function (m, i) {
      html +=
        /* the real anchor id, so #hw-hands resolves in the DOM as well as in
           the handler below — the nav's deep links are the page's own
           table of contents and must not dangle */
        '<article class="hs-card" role="listitem" id="hw-' + m.id + '" ' +
          'data-id="' + m.id + '">' +
          '<div class="hs-shot"><img src="' + m.img + '" alt="MABEL’s ' +
            esc(m.name) + '" loading="' + (i < 2 ? 'eager' : 'lazy') + '"/>' +
            '<span class="hs-kicker">' + esc(m.kicker) + '</span></div>' +
          '<div class="hs-body">' +
            '<h3 class="hs-name">' + esc(m.name) + '</h3>' +
            '<p class="hs-blurb">' + esc(m.blurb) + '</p>' +
            '<dl class="hs-specs">' +
              m.specs.slice(0, 5).map(function (s) {
                return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>';
              }).join('') +
            '</dl>' +
            '<div class="hs-foot">' +
              '<span class="hs-price"><b>' + USD(m.price) + '</b>' +
                (m.options.length ? 'as recommended' : 'parts') + '</span>' +
              '<button class="hs-more" type="button">Parts &amp; prices →</button>' +
            '</div>' +
          '</div>' +
        '</article>';
    });
    html += '</div><div class="hs-dots"></div>' +
      '<div class="hs-sheet" hidden><div class="hs-sheet-in"></div></div>';
    host.innerHTML = html;

    var rail = host.querySelector('.hs-rail');
    var dots = host.querySelector('.hs-dots');
    var sheet = host.querySelector('.hs-sheet');
    var sheetIn = host.querySelector('.hs-sheet-in');
    var cards = [].slice.call(host.querySelectorAll('.hs-card'));

    dots.innerHTML = cards.map(function (c, i) {
      return '<button class="hs-dot' + (i ? '' : ' on') + '" data-i="' + i +
             '" aria-label="' + esc(mods[i].name) + '"></button>';
    }).join('');

    function step(dir) {
      var w = cards[0].getBoundingClientRect().width + 18;
      rail.scrollBy({ left: dir * w, behavior: 'smooth' });
    }
    host.querySelectorAll('.hs-arrow').forEach(function (b) {
      b.addEventListener('click', function () { step(+b.dataset.dir); });
    });
    dots.addEventListener('click', function (e) {
      var d = e.target.closest('.hs-dot');
      if (d) cards[+d.dataset.i].scrollIntoView(
        { behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    /* keyboard: the rail is focusable, so arrows should move it */
    rail.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    });

    var ticking = false;
    rail.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var mid = rail.scrollLeft + rail.clientWidth / 2;
        var best = 0, bd = 1e9;
        cards.forEach(function (c, i) {
          var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
          if (d < bd) { bd = d; best = i; }
        });
        dots.querySelectorAll('.hs-dot').forEach(function (d, i) {
          d.classList.toggle('on', i === best);
        });
        host.querySelector('[data-dir="-1"]').disabled = rail.scrollLeft < 4;
        host.querySelector('[data-dir="1"]').disabled =
          rail.scrollLeft > rail.scrollWidth - rail.clientWidth - 4;
      });
    });

    /* ── the detail sheet ─────────────────────────────────────────────── */
    function partRow(p) {
      var name = esc(p.item) + (p.spec ? ' <i>' + esc(p.spec) + '</i>' : '');
      /* a `search` link is a query, not a product page — the BOM records what
         to search for on Taobao / Amazon because those listings move. Say so
         rather than dressing a search up as a live listing. */
      var cell = p.link
        ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' +
          name + (p.search ? ' <em>search ↗</em>' : ' ↗') + '</a>' : name;
      return '<tr><td class="hs-ref">' + esc(p.ref) + '</td>' +
             '<td>' + cell + (p.note ? '<span class="hs-note">' +
               esc(p.note) + '</span>' : '') + '</td>' +
             '<td class="hs-qty">×' + p.qty + '</td>' +
             '<td class="hs-cost">' + (p.price ? USD(p.price * p.qty) : '—') +
             '</td></tr>';
    }
    function optRow(o) {
      var tier = o.tier ? '<span class="hs-tier t-' + esc(o.tier) + '">' +
        esc(o.tier) + '</span>' : '';
      var name = esc(o.option);
      var cell = o.link
        ? '<a href="' + esc(o.link) + '" target="_blank" rel="noopener">' +
          name + (o.search ? ' <em>search ↗</em>' : ' ↗') + '</a>' : name;
      return '<tr><td class="hs-ref">' + esc(o.choice) + '</td>' +
             '<td>' + cell + tier +
             (o.spec ? '<span class="hs-note">' + esc(o.spec) + '</span>' : '') +
             '</td><td class="hs-qty">×' + o.qty + '</td>' +
             '<td class="hs-cost">' + (o.price ? USD(o.price * o.qty) : 'free') +
             '</td></tr>';
    }

    function open(m) {
      sheetIn.innerHTML =
        '<button class="hs-close" type="button" aria-label="Close">✕</button>' +
        '<div class="hs-sheet-head">' +
          '<img src="' + m.img + '" alt=""/>' +
          '<div><span class="hs-sheet-kick">' + esc(m.kicker) + '</span>' +
            '<h3>' + esc(m.name) + '</h3>' +
            '<p>' + esc(m.why) + '</p></div>' +
        '</div>' +
        (m.gotcha ? '<p class="hs-gotcha"><b>Watch out.</b> ' +
          esc(m.gotcha) + '</p>' : '') +
        '<dl class="hs-specs wide">' + m.specs.map(function (s) {
          return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>';
        }).join('') + '</dl>' +
        /* the sensors and compute cards get a drawing of the actual parts.
           Vendor product photography is not ours to republish, so these are
           illustrations to each part's real proportions, in the site's own ink
           and flat colour. */
        (m.art ? '<figure class="hs-art"><img src="' + m.art + '" alt="" ' +
          'loading="lazy"/><figcaption>Drawn to each part\u2019s real ' +
          'proportions &mdash; not a vendor photograph.</figcaption></figure>' : '') +
        (m.parts.length
          ? '<h4 class="hs-sub">What you buy</h4>' +
            '<div class="table-scroll"><table class="hs-table"><thead><tr>' +
            '<th>BOM</th><th>Part</th><th>Qty</th><th>Cost</th></tr></thead>' +
            '<tbody>' + m.parts.map(partRow).join('') + '</tbody></table></div>'
          : '') +
        (m.options.length
          ? '<h4 class="hs-sub">Where you choose</h4>' +
            '<div class="table-scroll"><table class="hs-table"><thead><tr>' +
            '<th>Choice</th><th>Option</th><th>Qty</th><th>Cost</th></tr></thead>' +
            '<tbody>' + m.options.map(optRow).join('') + '</tbody></table></div>'
          : '') +
        '<h4 class="hs-sub">In the repo</h4>' +
        '<ul class="hs-files">' + m.files.map(function (f) {
          return '<li><b>' + esc(f[0]) + '</b><code>' + esc(f[1]) + '</code></li>';
        }).join('') + '</ul>' +
        '<p class="hs-src">Parts, prices and links come from ' +
          '<code>BOM/data/</code> — the same source as the printed build guide. ' +
          '<a href="build.html#bom">Full bill of materials →</a></p>';
      sheet.hidden = false;
      document.body.style.overflow = 'hidden';
      sheet.querySelector('.hs-close').focus();
    }
    function close() {
      sheet.hidden = true;
      document.body.style.overflow = '';
    }
    host.addEventListener('click', function (e) {
      var b = e.target.closest('.hs-more');
      if (b) {
        var id = b.closest('.hs-card').dataset.id;
        open(mods.filter(function (m) { return m.id === id; })[0]);
        return;
      }
      if (e.target.closest('.hs-close') || e.target === sheet) close();
    });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) close();
    });

    /* deep links from the nav still work: #hw-hands scrolls to that card */
    function jump() {
      var id = (location.hash || '').replace(/^#hw-/, '');
      var i = mods.findIndex(function (m) { return m.id === id; });
      if (i < 0) return;
      /* Set scrollLeft directly rather than scrollIntoView: the rail is inside
         a scrollable page, so scrollIntoView moves BOTH and lands wherever the
         smooth animation happens to be. This is exact. */
      var c = cards[i];
      rail.scrollTo({ left: Math.max(0, c.offsetLeft - (rail.clientWidth - c.offsetWidth) / 2),
                      behavior: 'smooth' });
      host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    addEventListener('hashchange', jump);
    if (/^#hw-/.test(location.hash)) setTimeout(jump, 350);

    window.__hwSlider = { modules: mods, open: open, close: close, step: step };
  }
})();
