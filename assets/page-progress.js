/* The same right-edge reading indicator on the project site and build guide. */
(function () {
  'use strict';
  function init() {
    if (new URLSearchParams(location.search).has('embed')) return;
    var rail = document.querySelector('.ov-scroll-rail');
    var authored = !!rail;
    if (!rail) {
      rail = document.createElement('nav');
      rail.className = 'ov-scroll-rail';
      rail.setAttribute('aria-label', 'Page progress');
      document.body.appendChild(rail);
    }
    var top = document.getElementById('page-top');
    if (!top) {
      top = document.createElement('span'); top.id = 'page-top'; top.className = 'page-progress-anchor';
      top.setAttribute('aria-hidden', 'true'); document.body.prepend(top);
    }
    var end = document.getElementById('page-end');
    if (!end) {
      end = document.createElement('span'); end.id = 'page-end'; end.className = 'page-progress-anchor';
      end.setAttribute('aria-hidden', 'true'); document.body.appendChild(end);
    }
    var dots = [], scheduled = false, timer;
    function visible(element) {
      return !!element && !element.closest('[hidden],dialog:not([open]),.pop-overlay') && element.getClientRects().length > 0;
    }
    function label(element) {
      var heading = element.matches('h1,h2') ? element : element.querySelector('h1,h2,h3');
      return (element.getAttribute('data-progress-label') || element.getAttribute('aria-label') || (heading ? heading.textContent : '')).replace(/\s+/g, ' ').trim();
    }
    function rebuild() {
      if (!authored) {
        var labels = new Map();
        document.querySelectorAll('.sidenav a[href^="#"],.hub-nav a[href^="#"],.acct-nav a[href^="#"]').forEach(function (a) {
          labels.set(decodeURIComponent(a.hash.slice(1)), a.textContent.trim());
        });
        var candidates = Array.from(document.querySelectorAll('section[id],main h2,.sidenav a[href^="#"]'));
        var entries = [], seen = new Set();
        candidates.forEach(function (element) {
          if (element.matches('a')) element = document.getElementById(decodeURIComponent(element.hash.slice(1)));
          if (!visible(element) || element.closest('header,footer,dialog,.ta-app') || element === document.getElementById('taSection')) return;
          if (element.matches('h2') && element.closest('section[id]')) return;
          var text = labels.get(element.id) || label(element);
          if (!text) return;
          if (!element.id) {
            var stem = 'read-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            var id = stem, count = 2;
            while (document.getElementById(id)) id = stem + '-' + count++;
            element.id = id;
          }
          if (seen.has(element.id)) return;
          seen.add(element.id); entries.push({ element: element, text: text });
        });
        entries.sort(function (a, b) { return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
        var fragment = document.createDocumentFragment();
        function add(id, text) {
          var a = document.createElement('a'), span = document.createElement('span');
          a.href = '#' + id; a.setAttribute('aria-label', text); a.title = text; span.textContent = text;
          a.appendChild(span); fragment.appendChild(a);
        }
        add('page-top', 'Top of page');
        entries.forEach(function (entry) { add(entry.element.id, entry.text); });
        add('page-end', 'End of page');
        var output = document.createElement('output'); output.id = 'pageProgress'; output.setAttribute('aria-label', 'Page progress');
        fragment.appendChild(output); rail.replaceChildren(fragment);
      }
      dots = Array.from(rail.querySelectorAll('a'));
      schedule();
    }
    function update() {
      scheduled = false;
      var abstract = document.querySelector('.overview-page #story');
      rail.hidden = !!abstract && abstract.getBoundingClientRect().top > 160;
      var height = document.documentElement.clientHeight || innerHeight;
      var total = Math.max(0, document.documentElement.scrollHeight - height);
      var fraction = total > 1 ? Math.min(1, Math.max(0, scrollY / total)) : 1;
      var output = rail.querySelector('output');
      if (output) output.value = Math.round(fraction * 100) + '%';
      var current = 0;
      dots.forEach(function (dot, i) {
        var target = document.getElementById(decodeURIComponent(dot.hash.slice(1)));
        if (visible(target) && target.getBoundingClientRect().top < height * .4) current = i;
      });
      if (fraction > .995) current = dots.length - 1;
      dots.forEach(function (dot, i) {
        dot.classList.toggle('passed', i < current);
        if (i === current) dot.setAttribute('aria-current', 'location'); else dot.removeAttribute('aria-current');
      });
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }
    rail.addEventListener('click', function (event) {
      var dot = event.target.closest('a'); if (!dot) return;
      if (dot.hash === '#page-top' || dot.hash === '#page-end') {
        event.preventDefault();
        scrollTo({ top: dot.hash === '#page-top' ? 0 : document.documentElement.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }
    });
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
    // Account visibility and generated hardware chapters can change the available sections.
    new MutationObserver(function (records) {
      var changed = records.some(function (record) {
        if (record.target.closest && record.target.closest('.ov-scroll-rail')) return false;
        if (record.type === 'attributes') return record.target.matches('section,[data-progress-label]');
        return Array.from(record.addedNodes).some(function (node) {
          return node.nodeType === 1 && (node.matches('section,h2,main') || node.querySelector('section,h2'));
        });
      });
      if (changed) { clearTimeout(timer); timer = setTimeout(rebuild, 100); }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    rebuild();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
