/* Give every burst a different shape, colour and lettering.
 *
 * They were all the same star in the same rust at the same size, so a page
 * with four of them looked like a repeated stamp. The variant is derived
 * from the burst's own text, so the same word always looks the same and a
 * re-render never reshuffles the page. */
(function () {
  'use strict';
  var SHAPES = ['b-star', 'b-blast', 'b-blob', 'b-zag', 'b-flag'];
  /* The empty string in each list is "leave it at the default". classList.add
     REJECTS an empty token — it throws a SyntaxError and abandons the rest of
     the pass — so it has to be filtered at the call site rather than passed
     through. That threw on every page with a burst on it. */
  var VOICES = ['', 'v-yellow', 'v-orange', 'v-blue', 'v-green'];
  var FONTS = ['', 'f-tight', 'f-wide', 'f-tall', 'f-slant'];
  var add = function (el, cls) { if (cls) el.classList.add(cls); };

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  document.querySelectorAll('.burst').forEach(function (b, i) {
    var key = (b.textContent || '').trim() + '|' + i;
    var h = hash(key);
    if (!/\bb-(star|blast|blob|zag|flag)\b/.test(b.className)) {
      add(b, SHAPES[h % SHAPES.length]);
    }
    if (!/\bv-\w+\b/.test(b.className) && !/\b(gold|night)\b/.test(b.className)) {
      add(b, VOICES[(h >> 3) % VOICES.length]);
    }
    add(b, FONTS[(h >> 6) % FONTS.length]);
  });
})();
