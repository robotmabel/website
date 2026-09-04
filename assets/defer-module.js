/* Load a heavy ES module only when the thing it draws into comes into view.
 *
 * three.js is 1.24 MB and mabel_rig.glb is 1.87 MB. Between them they were
 * three quarters of every page that carries a 3-D viewer, fetched at parse
 * time for a canvas that on hardware.html sits below three full screens of
 * content. Measured: hardware.html 4.07 MB and DOMContentLoaded at 6.5 s, for
 * a viewer most readers scroll past.
 *
 *     <script defer src="assets/defer-module.js"
 *             data-mod="./robot-viewer.js" data-when="#robot3d"></script>
 *
 * A CLASSIC script, deliberately. `document.currentScript` is null inside a
 * module — modules are deferred and the browser does not set it — so the
 * module version threw "Cannot read properties of null" on every page and
 * silently loaded nothing. A classic script also re-executes per <script>
 * tag, which is what a page with three deferred viewers needs; a module URL
 * would run once no matter how many tags referenced it. `defer` keeps it off
 * the parser's critical path; currentScript is still set for a deferred
 * classic script.
 *
 * Nothing is lost: the observer fires 600 px early, which on any normal scroll
 * is well before the canvas is on screen, and a viewer that is already visible
 * at load (the hero) imports immediately.
 */
(function () {
  'use strict';
  var tag = document.currentScript;
  if (!tag) return;
  var mod = tag.dataset.mod;
  var sel = tag.dataset.when;
  var el = sel ? document.querySelector(sel) : null;

  function go() {
    /* resolved against this file's own directory, like the module form was */
    var url = new URL(mod, tag.src).href;
    import(url).catch(function (e) { console.error('[defer-module]', mod, e); });
  }

  if (!el || !('IntersectionObserver' in window)) {
    go();
  } else {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); go(); return; }
      }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
  }
})();
