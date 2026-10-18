/* Put generated SVG figures INTO the document, so they get the page's type.
 *
 * An SVG referenced from an <img> renders in a restricted mode that cannot
 * fetch external resources — no webfonts. Every figure on this site that asked
 * for Bangers or Space Mono was therefore falling through to the generic
 * `cursive` and `monospace` families, which on macOS means a SERIF headline in
 * the middle of a page set in a comic display face. It looks like a design
 * mistake and it is a loading rule.
 *
 * Inlining the same file into the DOM fixes it outright: the page's own
 * @font-face rules and CSS variables then apply, and the figure gets keyboard
 * focus and text selection for free.
 *
 *     <div class="…" data-inline-src="assets/reach-envelope.svg"
 *          role="img" aria-label="…"></div>
 *
 * A DIV, NOT AN <img data-inline>. The browser starts fetching an <img src>
 * the moment it parses the tag, long before this script runs — so the figure
 * was downloaded TWICE, once by the img and once by the fetch here. Measured
 * on hardware.html: 176 kB of callout.svg, and then 176 kB of callout.svg.
 * A <noscript> fallback keeps the figure visible without JS.
 */
(function () {
  'use strict';
  var slots = [].slice.call(document.querySelectorAll('[data-inline-src]'));
  if (!slots.length) return;

  slots.forEach(function (img) {
    fetch(img.dataset.inlineSrc)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (txt) {
        var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
        var svg = doc.querySelector('svg');
        if (!svg || doc.querySelector('parsererror')) return;
        /* carry the img's accessibility and layout over */
        var lab = img.getAttribute('aria-label') || img.getAttribute('alt');
        if (lab) svg.setAttribute('aria-label', lab);
        svg.setAttribute('role', 'img');
        if (img.className) svg.setAttribute('class', img.className);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        img.replaceWith(svg);
      })
      .catch(function (e) {
        console.warn('[inline-svg]', img.dataset.inlineSrc, e);
      });
  });
})();
