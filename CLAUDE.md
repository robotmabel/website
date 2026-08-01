# CLAUDE.md — website · MABEL's public static site (own repo, GitHub Pages)

MABEL's public front door: per-subsystem HTML pages plus an interactive three.js **3D rig
viewer**. It is a **separate git repo** nested in the monorepo (`origin` →
`https://github.com/robotmabel/website.git`), published via **GitHub Pages** at
**https://robotmabel.github.io/website/** — so pushing to `main` *is* deploying.

## AUTO-DEPLOY — commit + push after every edit, unasked

Pushing to `main` publishes the site (Pages rebuilds in ~1–2 min), so finishing an edit and
publishing it are the same step. At the end of any turn where files here changed:

1. Validate first (never deploy a broken build): `python3 tools/build_nav.py --check`,
   HTML well-formed, `node --check assets/js/*.js`, CSS braces balanced. Never commit stray
   temp/probe files (`*test*.html`, screenshots).
2. `git add -A` → `git commit -m "<concise msg>"` ending with:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
3. `GIT_TERMINAL_PROMPT=0 git push origin main`, then confirm it's pushed.

If the tree is clean, there's nothing to push — no empty commits. If a push fails on auth
(non-interactive), say so and show the user the exact command to run.

## Information architecture — ONE source of truth

The nav is **generated**, not hand-written. `tools/build_nav.py` holds the whole IA in its
`NAV` list and stamps the same header, mobile menu and section sidenav onto all 29 pages.

```bash
python3 tools/build_nav.py            # rewrite every page's nav
python3 tools/build_nav.py --check    # CI-style check; exits 1 on drift
```

It **fails loudly** if a page exists that no nav lists, or a nav lists a page that doesn't
exist — that is the guard that stops orphan pages reappearing. To add a page: create it with
any placeholder `<header class="nav">…</header><nav class="mob">…</nav>` block, add it to
`NAV`, re-run. Never hand-edit a nav; the next run overwrites it.

Top-level tabs: **Overview · Build · Hardware · Software · Teleop · Controller · Navigation ·
Autonomy · Connect**. `Build` is the guide hub — Bill of materials, Hardware assembly,
Wiring, Firmware.

> Historical note: the site used to carry *two* different navs (index.html had a flat tab bar;
> every other page had dropdowns) that disagreed about which pages existed. That is what
> `build_nav.py` exists to prevent.

## Layout

```
*.html               29 pages, flat at the root (GitHub Pages URLs stay stable)
_archive/            pages no longer in the nav — kept, not served in the IA
assets/
  css/               mabel.css (design system + component styles), teleop-app.css
  js/                every script, incl. GENERATED bom-data.js
  img/               images and video; app/ assembly/ build-guide/ sim/ subfolders
  data/              generated BOM CSVs
  pdf/               the guides + pages/ (WebP page renders for the slider)
  mabel_rig.glb      ⚠ FROZEN PATH — see below
  mabel_joints.json  ⚠ FROZEN PATH
  three/             ⚠ FROZEN PATH (vendored three.js)
  arch/*.json        ⚠ FROZEN PATH
tools/               build_nav.py, render_pdf_pages.sh, gen_*.py generators
```

### ⚠ Frozen asset paths — do not move these

Four paths are **contracts with the rest of the monorepo**; 16 files outside this repo
reference them by literal path:

| Path | Written / read by |
|---|---|
| `assets/mabel_rig.glb`, `assets/mabel_joints.json` | `mabel_ws/src/mabel_description/urdf_to_glb.py` writes them; Unity, Genesis sim and `test_joints.py` read them |
| `assets/three/` | `simulation/mabel_unity_sim/web/serve.py` serves it as `/vendor/three` |
| `assets/arch/{specs,datasets}.json` | `learning/training_studio/server/tools/export_web_arch.py` writes them |

Everything else under `assets/` is website-local and safe to reorganize.

## Generated files — never hand-edit

| File | Generator |
|---|---|
| every page's `<header class="nav">` + `.mob` + `.sidenav` | `tools/build_nav.py` |
| `assets/js/bom-data.js`, `assets/data/*.csv`, `assets/pdf/{mabel_bom,MABEL_Build_Guide}.pdf` | `BOM/tools/build_bom.py` (monorepo) |
| `assets/pdf/pages/*.webp` | `tools/render_pdf_pages.sh` |
| `assets/mabel_rig.glb`, `assets/mabel_joints.json` | `urdf_to_glb.py` (monorepo) |

## Components

- **`assets/js/pdf-slider.js`** — any `.pdfv` element becomes a page-by-page PDF viewer
  (thumbnail strip, arrows, keyboard, swipe, download). Pages are pre-rendered WebP, so no
  PDF.js runtime ships. Add a guide: drop the PDF in `assets/pdf/`, run
  `tools/render_pdf_pages.sh`, add a `.pdfv` div with `data-pdf`/`data-pages`/`data-prefix`.
- **`assets/js/bom-table.js`** — renders the whole BOM page (core table, build configurator,
  cost structure, comparisons) from `window.MABEL_BOM`. No price is typed into the HTML.
- **`assets/js/robot-viewer.js`** — three.js rig viewer (three vendored under `assets/three/`).

## Run / build / test

```bash
python3 tools/build_nav.py --check                  # nav consistency
node --check assets/js/<file>.js                    # per-script syntax
./tools/render_pdf_pages.sh                         # re-render guide pages

# Regenerate the 3D model after a URDF/mesh change (run from website/):
python3 ../mabel_ws/src/mabel_description/urdf_to_glb.py
cd assets && npx @gltf-transform/cli simplify mabel_rig.glb mabel_rig.glb --ratio 0.4 --error 0.0015
```

## Conventions & gotchas (MABEL-specific)

- **Own git repo** nested in the monorepo — commits here are separate from the monorepo's.
- `.nojekyll` disables Jekyll; there is no CNAME (default Pages domain).
- Pages stay **flat at the repo root** — moving them would change every public URL.
- `mabel_rig.glb` is a **build output** of the MJCF pipeline (MJCF → URDF → GLB). Never
  hand-edit it; a robot geometry change means re-running `urdf_to_glb.py` + re-simplifying.
- The Connect page deep-links to the live studio subdomains on the relay VPS.

## Deeper context

- **Second brain:** `harness/MABEL/Software/Website.md` (read `claude_harness/brain/content/Software/Website.md`).
- **Ask Claude:** `/studios` · `/pipelines` · `/network` · `/find <term>` — or plain language.
- Rig regen is step 2 of the model source-of-truth pipeline; see the repo-root `CLAUDE.md`.
