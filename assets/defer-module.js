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
    /* NEVER IN THE CRITICAL PATH. Intersection alone is not enough: on
       hardware.html the viewer is the second section, so the 600 px margin
       fires it during the initial layout and three.js plus the 1.87 MB GLB
       land BEFORE the load event — 3.4 MB, which is the thing this file
       exists to prevent. Waiting for load (and then an idle frame) costs a
       visible viewer about a second and takes it off the critical path
       entirely. */
    var run = function () {
      /* resolved against this file's own directory, like the module form was */
      var url = new URL(mod, tag.src).href;
      import(url).catch(function (e) { console.error('[defer-module]', mod, e); });
    };
    var idle = function () {
      if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 1500 });
      else setTimeout(run, 120);
    };
    if (document.readyState === 'complete') idle();
    else addEventListener('load', idle, { once: true });
  }

  /* A TEST HOOK, and a deep link. Two callers legitimately need the module
     before anyone has scrolled: a check that reads `window.__tipLab`, and a
     visitor who arrives on `#tipLab` directly. Without this, deferring the
     module also defers every test hook the checks depend on, and they time out
     waiting for a global that will never appear. */
  var pending = (window.__deferred = window.__deferred || []);
  var loaded = false;
  var once = function () { if (!loaded) { loaded = true; go(); } };
  pending.push(once);
  window.__loadDeferred = function () {
    pending.forEach(function (f) { f(); });
    return pending.length;
  };
  if (sel && location.hash && sel.split(',').some(function (s2) {
    return s2.trim() === location.hash;
  })) { once(); return; }

  if (!el || !('IntersectionObserver' in window)) {
    once();
  } else {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); once(); return; }
      }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
  }
})();
