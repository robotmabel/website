/* Filter the scene gallery by room type. Pure show/hide — the clips keep
   their lazy-loading behaviour, so a hidden one simply pauses. */
(function () {
  'use strict';
  var bar = document.querySelector('.scene-filters');
  var grid = document.querySelector('.scene-grid');
  if (!bar || !grid) return;
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var want = b.dataset.sg || '';
    bar.querySelectorAll('button').forEach(function (x) {
      x.classList.toggle('on', x === b);
    });
    grid.querySelectorAll('.scene-cell').forEach(function (c) {
      c.hidden = !!want && c.dataset.group !== want;
    });
  });
})();
