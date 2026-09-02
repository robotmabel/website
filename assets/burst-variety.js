/* Give every burst a different shape, colour and lettering.
 *
 * They were all the same star in the same rust at the same size, so a page
 * with four of them looked like a repeated stamp. The variant is derived
 * from the burst's own text, so the same word always looks the same and a
 * re-render never reshuffles the page. */
(function () {
  'use strict';
  var SHAPES = ['b-star', 'b-blast', 'b-blob', 'b-zag', 'b-flag'];
  var VOICES = ['', 'v-yellow', 'v-orange', 'v-blue', 'v-green'];
  var FONTS = ['', 'f-tight', 'f-wide', 'f-tall', 'f-slant'];

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  document.querySelectorAll('.burst').forEach(function (b, i) {
    var key = (b.textContent || '').trim() + '|' + i;
    var h = hash(key);
    if (!/\bb-(star|blast|blob|zag|flag)\b/.test(b.className)) {
      b.classList.add(SHAPES[h % SHAPES.length]);
    }
    if (!/\bv-\w+\b/.test(b.className) && !/\b(gold|night)\b/.test(b.className)) {
      b.classList.add(VOICES[(h >> 3) % VOICES.length]);
    }
    b.classList.add(FONTS[(h >> 6) % FONTS.length]);
  });
})();
