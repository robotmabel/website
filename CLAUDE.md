# CLAUDE.md — the MABEL website

The public site at <https://robotmabel.github.io/website/>. Static: nine HTML
pages, one stylesheet, a folder of ES modules, and a pile of generated assets.
Pushing to `main` deploys it.

## Read STYLE.md first

[`STYLE.md`](STYLE.md) is the design system — three colour voices, one button
recipe, four typefaces, and the rule that every figure is generated rather than
drawn. **If you are about to type a hex value into a CSS rule, read it first.**
The short version:

* `--hi` (`#E4442A`, warm comic red) is the highlight — primary buttons, links,
  accents.
* `--pop` (`#FFCE0A`, saturated cab yellow) is the shout, and **at most one
  thing on a screen may use it**.
* `--rust` is the deep voice; `--yellow`, `--blue`, `--green`, `--gold` are
  support and never the lead.
* Widget buttons inherit those tokens. They never name their own colour.

## Run it

```bash
python3 -m http.server 8741        # from website/, then open localhost:8741
./scripts/run_all.sh               # every check — must be green before a push
python3 scripts/bump_assets.py     # rewrite the ?v= cache-busting stamps
python3 scripts/loadtest.py        # what a cold visitor downloads, per page
```

**Nothing heavy loads at parse time.** Clips start when the
IntersectionObserver says they are near; three.js and the 1.87 MB GLB come in
through `assets/defer-module.js` when the canvas they draw into approaches; the
hero rig waits for an idle frame after `load`. index.html was 8.6 MB with
DOMContentLoaded at 42 s before that, and is 3.3 MB at 207 ms after. If you add
a `<video>` or a 3-D viewer, wire it the same way and re-run `loadtest.py`.

`bump_assets.py` is not optional. A verified fix that appears to do nothing is
almost always a stale `?v=` stamp.

## The checks, and why each exists

Every one of them was written after a defect shipped, and each names the defect
in its docstring. `scripts/run_all.sh` runs the lot.

| Check | Catches |
|---|---|
| `structure.py` | unbalanced tags; anchors that dangle **in the rendered DOM** (two sections build themselves from JSON) |
| `tablescroll.py` | tables that scroll sideways on a phone |
| `stickers.py` | stickers sitting on top of text |
| `poptest.py` `hovertest.py` `bomgroup.py` | the pop-ups, the BOM hover card, its grouping |
| `filmtest.py` `vidswap.py` | captions and cross-fades on the film players |
| `camtest.py` | the webcam retargeter: target DIRECTIONS, the palm frame, gaze, roll, hold-on-loss, and the solve's cost in ms |
| `frametest.mjs` | the operator→robot palm frame, in node, against hands whose orientation is known by construction |
| `gesturetest.mjs` | the finger counts and the two-hand heart |
| `sync_bodyteleop.py --check` | the vendored retargeter drifting from the studio's |
| `labrig.py` `labtable.py` `labcity.py` | the motion lab's facing, its lift stroke, its table, and a skyline that used to run out |
| `hwtest.py` | the hardware slider: parts, prices, outbound links, deep links |
| `curtest.py` | the curation lab: the defects it finds are the ones really in the data |
| `scenetest.py` | the scene gallery matches its manifest |
| `figscale.py` `panels.py` `artcheck.py` | figures that outgrow the type scale; instruction panels |
| `csscheck.py` | dangling selector lists, and a bare rule on a **utility class** |
| `loadtest.py` | page weight and first paint, per page, gzip-aware |
| `pttest.py` `smtest.py` | the platform survey; the stack map's routes, clicks and hovers |
| `acctest.py` | the accuracy lab draws what the archives measured, on one shared frame |
| `rktest.py` | the retargeting tiles stay IN SYNC and match their own rows |
| `slamtest.py` | the SLAM lab maps, and the scan matcher measurably matters |
| `vidcheck.py` | every clip on every page is WIRED — the thing that can break |
| `wikitest.py` | `docs/` stays the site's ground and faces, and its links resolve |

Each takes its own debugger port and profile — they used to collide and one
would die mid-run, which looked like a real failure.

## Assets are GENERATED. Do not hand-edit them.

| What | Written by |
|---|---|
| `assets/hw/*.png` | `simulation/.../render_module_shots.py` (from the MJCF) |
| `assets/sim/scenes/*` + `index.json` | `render_scene_grid.py` |
| `assets/maps/*` | `render_slam_maps.py` |
| `assets/curation/*` | `render_curation_clips.py` |
| `assets/tipover_table.json` | `controller/experiments/exp_tipover_web.py` |
| `assets/data/hw-modules.json` | `scripts/build_hw_modules.py` (from `BOM/data/*.csv`) |
| `assets/bodyteleop-core.js` | `scripts/sync_bodyteleop.py` (from the Control Studio) |
| `assets/mabel_rig.glb`, `mabel_joints.json` | `mabel_ws/.../urdf_to_glb.py` |
| `assets/hw/exploded.png` | `scripts/build_exploded.py` (cuts the paper's CAD out of its white) |
| `assets/hw/callout.{svg,png,json}` | `simulation/.../render_callout.py` |
| `assets/reach-envelope.svg` | `simulation/.../render_reach_plot.py` |
| `assets/data/accuracy.json` | `scripts/build_accuracy.py` (from `experiments/*/data/`) |
| `assets/accuracy/*` | `scripts/render_accuracy_clips.py` |
| `assets/retarget/*` | `controller/experiments/retargeting_ablation/render_compare.py` |
| `assets/data/platforms.json` | `scripts/build_platforms.py` |

The robot's geometry chain is MJCF → URDF → GLB → app rigs; see the repo root
`CLAUDE.md`. Editing a derived file means the next regeneration silently
discards your change.

## Things that have bitten, and will again

* **`position: fixed` inside a `transform`ed ancestor is not fixed.** `.fade-up`
  animates a transform, so a modal inside it resolves against that ancestor and
  gets clipped. Re-parent modals to `<body>`. (Cost: the BOM hover card, then
  the hardware sheet.)
* **`.rc-`, `.cl-view` — check a class name is free before you use it.** Two
  widgets sharing a prefix gave one an invisible label and the other a 16:10
  black timeline.
* **The GLB needs `setMeshoptDecoder`.** Without it the loader throws and the
  viewer is simply empty.
* **`models/mabel_full.xml` has a freejoint and no floor.** Anything that steps
  it free-falls — 14.5 m in 1.8 s — while staying perfectly upright, so an
  "is it upright?" check passes on a robot underground. Use a scene with a
  floor, or zero gravity.
* **A passing metric can miss the defect.** A brightness check once passed on a
  fallen robot; an upright check passed on four clips where the chassis was
  upside down, because it printed the number without gating on it.
* **Headless Chrome throttles `requestAnimationFrame`.** Test physics through
  pure step functions, not by watching a loop.
* **A single-word container class WILL collide with a utility class.** `.sm`
  was the stack map's card *and* the burst's size modifier, so every small
  starburst got a cream box, a border and a drop shadow. Third time (`.rc-`,
  `.cl-view`, `.sm`); `csscheck.py` fails on it now.
* **`document.currentScript` is null inside a module.** A module-typed loader
  that reads its own `data-` attributes gets `null` and silently loads nothing.
  Use a classic script — which also re-executes per tag, where a module URL
  runs once however many tags reference it.
* **An SVG in an `<img>` cannot fetch a webfont.** It renders in a restricted
  mode, so `font-family: Bangers` falls to the generic `cursive` — a serif, in
  a comic-set page. Inline the SVG (`assets/inline-svg.js`) with a
  `<div data-inline-src>`; an `<img>` would download the file a second time.
* **Setting `<video>.src` resets the element.** It drops to `readyState 0`,
  paints BLACK, and ignores a `currentTime` set before metadata arrives. One
  element per clip, and seek only when scrubbing — 15 seeks a second through
  long-GOP video is a black panel. Encode scrubbable clips all-intra (`-g 1`).
* **A camera you reconstruct by hand is one sign error from a point
  reflection.** Parts near the axis project correctly and parts far from it
  land mirrored, so the drawing looks 80% right. Ask `mjv_updateScene` for the
  camera the renderer actually used.
* **`body.xpos` is the frame ORIGIN, not where the part looks.** The wrists
  carry no geoms at all. Anchor on the shallowest level of the body tree that
  HAS geoms — the whole subtree is equally wrong, since 20 finger geoms outvote
  3 shoulder ones.
* **`scenery_clear` measures distance to geom CENTRES.** A 6 m building centred
  1.1 m away reads as "1.1 m of room" while MuJoCo resolves 760 kN of
  interpenetration. Ask the physics whether the robot is embedded; do not ask a
  proxy.

## Claims

Every number on a page comes from a file in this repo, and the page says which.
Estimates are labelled as estimates. Parts that are not released are described
as not released. `BOM/data/open_items.csv` is the list of things the build guide
must not promise.
