# CLAUDE.md — website · MABEL's public static site (own repo, GitHub Pages)

MABEL's public front door: per-subsystem HTML pages plus an interactive three.js **3D rig
viewer**. It is a **separate git repo** nested in the monorepo (`origin` →
`https://github.com/robotmabel/website.git`), published via **GitHub Pages** at
**https://robotmabel.github.io/website/** — so pushing to `main` *is* deploying.

## AUTO-DEPLOY — commit + push after every edit, unasked

Pushing to `main` publishes the site (Pages rebuilds in ~1–2 min), so finishing an edit and
publishing it are the same step. At the end of any turn where files here changed:

1. Validate first (never deploy a broken build): HTML well-formed, `node --check assets/mabel.js`,
   CSS braces balanced. Never commit stray temp/probe files (`*test*.html`, screenshots).
2. `git add -A` → `git commit -m "<concise msg>"` ending with:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
3. `GIT_TERMINAL_PROMPT=0 git push origin main`, then confirm it's pushed (Pages redeploys shortly).

If the tree is clean, there's nothing to push — no empty commits. If a push fails on auth
(non-interactive), say so and show the user the exact command to run.

## Key files
- `index.html` + per-subsystem pages — `hardware.html`, `software.html`, `simulation.html`,
  `teleop.html`, `wbc.html`, `learning.html`, `autonomy.html`, `ros.html`, `connect.html`
- `assets/mabel.css`, `assets/mabel.js` — shared iOS "liquid-glass" design system
- `assets/robot-viewer.js` — three.js rig viewer (three vendored under `assets/three/`)
- `assets/mabel_rig.glb` + `assets/mabel_joints.json` — **generated** rig, baked from the URDF
- `assets/{wbc-viewer,slam-viz,swerve-toy,explode-viewer,h264-video}.js` — embedded figures/viewers

## Run / build / test
```bash
# Regenerate the 3D model after a URDF/mesh change (run from website/):
python3 ../mabel_ws/src/mabel_description/urdf_to_glb.py    # writes mabel_rig.glb + mabel_joints.json
cd assets && npx @gltf-transform/cli simplify mabel_rig.glb mabel_rig.glb --ratio 0.4 --error 0.0015
# then commit + push (auto-deploy above)
```

## Conventions & gotchas (MABEL-specific)
- **Own git repo** nested in the monorepo — commits here are separate from the monorepo's.
- `.nojekyll` disables Jekyll; there is no CNAME (default Pages domain).
- `mabel_rig.glb` is a **build output** of the MJCF pipeline (MJCF → URDF → GLB). Never hand-edit it;
  a robot geometry change means re-running `urdf_to_glb.py` + re-simplifying, or the viewer drifts.
- The Connect page deep-links to the live studio subdomains on the relay VPS.

## Deeper context
- **Second brain:** `harness/MABEL/Software/Website.md` (read `harness/brain/content/Software/Website.md`).
- **Ask Claude:** `/studios` · `/pipelines` · `/network` · `/find <term>` — or plain language.
- Rig regen is step 2 of the model source-of-truth pipeline; see the repo-root `CLAUDE.md`.
