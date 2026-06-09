# CLAUDE.md — MABEL website

This is the MABEL project website (static site). It is its own git repo
(`origin` → https://github.com/robotmabel/website.git) and is published via
**GitHub Pages** at **https://robotmabel.github.io/website/**.

## Auto-deploy: always commit + push after edits

**Whenever you finish making edits to this website, automatically commit and
push to `origin main` — do not wait to be asked.** Pushing to `main` is what
deploys the site (GitHub Pages rebuilds in ~1–2 minutes), so "finishing an
edit" and "publishing it" are the same step here.

Concretely, at the end of any turn where files under this repo changed:

1. `git add -A`
2. `git commit -m "<concise message>"` — end the message with:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
3. `GIT_TERMINAL_PROMPT=0 git push origin main`
4. Briefly confirm to the user it's pushed (and that Pages will redeploy shortly).

Notes:
- Always run a quick validation before pushing (HTML well-formed, `node --check
  assets/mabel.js`, CSS braces balanced) so a broken build is never deployed.
- Never commit stray temp/probe files (`*test*.html`, screenshots, etc.).
- If a push fails on auth (non-interactive), say so and show the exact command
  for the user to run themselves.
- If the working tree is clean (no edits this turn), there's nothing to push —
  don't create empty commits.

## Structure

- `index.html` + per-subsystem pages: `hardware.html`, `software.html`,
  `simulation.html`, `teleop.html`, `wbc.html`, `learning.html`, `connect.html`
- Shared design system: `assets/mabel.css`, `assets/mabel.js` (iOS liquid-glass UI)
- Hardware 3D viewer: `assets/robot-viewer.js` (THREE.js, vendored under
  `assets/three/`) drives the articulated rig `assets/mabel_rig.glb` +
  `assets/mabel_joints.json`, both baked from the URDF by
  `../mabel_ws/src/mabel_description/urdf_to_glb.py`.

To regenerate the 3D model after a URDF/mesh change:
```
python3 ../mabel_ws/src/mabel_description/urdf_to_glb.py
cd assets && npx @gltf-transform/cli simplify mabel_rig.glb mabel_rig.glb --ratio 0.4 --error 0.0015
```
(then commit + push as above).
