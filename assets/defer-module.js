/* Load a heavy ES module only when the thing it draws into comes into view.
 *
 * three.js is 1.24 MB and mabel_rig.glb is 1.87 MB. Between them they were
 * three quarters of every page that carries a 3-D viewer, fetched at parse
 * time for a canvas that on hardware.html sits below three full screens of
 * content. Measured: hardware.html 4.07 MB and DOMContentLoaded at 6.5 s, for
 * a viewer most readers scroll past.
 *
 *     <script type="module" src="assets/defer-module.js"
 *             data-mod="./robot-viewer.js" data-when="#robot3d"></script>
 *
 * Nothing is lost: the observer fires 600 px early, which on any normal scroll
 * is well before the canvas is on screen, and a viewer that is already visible
 * at load (the hero) imports immediately.
 */
const tag = document.currentScript;
const mod = tag.dataset.mod;
const sel = tag.dataset.when;
const el = sel ? document.querySelector(sel) : null;

function go() {
  import(mod).catch((e) => console.error('[defer-module]', mod, e));
}

if (!el || !('IntersectionObserver' in window)) {
  go();
} else {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      go();
    }
  }, { rootMargin: '600px 0px' });
  io.observe(el);
}
