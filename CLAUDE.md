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
./scripts/run_all.sh               # all 19 checks — must be green before a push
python3 scripts/bump_assets.py     # rewrite the ?v= cache-busting stamps
```

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

## Claims

Every number on a page comes from a file in this repo, and the page says which.
Estimates are labelled as estimates. Parts that are not released are described
as not released. `BOM/data/open_items.csv` is the list of things the build guide
must not promise.
