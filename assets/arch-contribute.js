// Autonomy · interactive architecture viewer + community training-job form.
//
// Reuses the Trainer Studio's diagram renderer VERBATIM (assets/arch/archdiagram.js,
// re-copied by server/tools/export_web_arch.py) fed with pre-baked static specs, so
// the public viewer never drifts from the studio. It runs read-only: pan / zoom /
// hover / double-click-to-drill only — no editing, no backend needed to explore.
//
// The "contribute" form lets any visitor design a job (architecture + dataset +
// a few clamped hyperparameters) and POST it to the VPS community queue. Nothing
// runs on the GPU until the owner approves it in the studio.
import { ArchDiagram } from './arch/archdiagram.js';

// Community-queue endpoint (Caddy on mabel-vps). Overridable via ?trainapi= for testing.
const API = new URLSearchParams(location.search).get('trainapi')
  || 'https://train.mabelrobot.duckdns.org';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let SPECS = null, DATASETS = [], diagram = null, curArch = null;
const hpByArch = {};   // per-arch user-tuned hyperparameters

async function boot() {
  const stage = $('#av-stage');
  if (!stage) return;   // not on this page
  try {
    const [specs, ds] = await Promise.all([
      fetch('assets/arch/specs.json').then(r => r.json()),
      fetch('assets/arch/datasets.json').then(r => r.json()),
    ]);
    SPECS = specs; DATASETS = ds.datasets || [];
  } catch (e) {
    stage.innerHTML = '<div class="av-fail">architecture viewer failed to load</div>';
    return;
  }

  diagram = new ArchDiagram($('#archCanvas'), $('#archLegend'), $('#archTip'), {});
  diagram.readOnly = true;                 // explore only — no editing on the public site
  patchForStaticSite(diagram);

  buildTabs();
  buildDatasetSelect();
  const want = new URLSearchParams(location.search).get('arch');
  selectArch(SPECS.order.includes(want) ? want : SPECS.order[0]);

  $('#cf-submit').addEventListener('click', submitJob);
  $('#cf-refresh').addEventListener('click', loadQueue);
  loadQueue();
}

// ── read-only static-site tweaks (renderer stays verbatim) ────────────────────
function patchForStaticSite(d) {
  // no dataset feed on the static site → don't open the (empty) data-inspector window
  d._openDataWindow = () => {};
  // and render the proprio/action joint-scope nodes as a clean light placeholder
  // instead of the studio's black "loading…" panel (there are no live arrays here)
  d._jointPanel = function (ctx, r, series, indices, title) {
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 9);
    ctx.fillStyle = 'rgba(190,227,166,.35)'; ctx.fill();
    ctx.strokeStyle = 'rgba(124,176,94,.7)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#4a5a37'; ctx.textAlign = 'center';
    ctx.font = '9px "Geist Mono", monospace';
    ctx.fillText(title || 'joint vector', r.cx, r.cy - 2);
    ctx.fillStyle = 'rgba(74,90,55,.72)'; ctx.font = '8px "Geist Mono", monospace';
    ctx.fillText(`${(indices && indices.length) || SPECS.action_dim}-D`, r.cx, r.cy + 11);
  };
  // clean tooltip wording (drop the studio's "trained run" phrasing)
  d._tip = function (n, sx, sy) {
    const t = this.tipEl; if (!t) return;
    if (!n) { t.style.display = 'none'; return; }
    const bits = [`<b>${esc(n.label)}</b>`, esc(n.sub || '')];
    if (n.expand) bits.push('<i>double-click to look inside</i>');
    else if (n.protect) bits.push(`<i>${esc(n.protect)}</i>`);
    t.innerHTML = bits.filter(Boolean).join('<br>');
    t.style.display = 'block'; t.style.left = (sx + 14) + 'px'; t.style.top = (sy + 12) + 'px';
  };
}

// ── architecture tabs ─────────────────────────────────────────────────────────
function buildTabs() {
  const wrap = $('#av-tabs'); wrap.innerHTML = '';
  for (const key of SPECS.order) {
    const b = el('button', 'av-tab', esc(shortName(key)));
    b.dataset.arch = key;
    b.addEventListener('click', () => selectArch(key));
    wrap.appendChild(b);
  }
}

function shortName(key) {
  return { ACT: 'ACT', DiT: 'DiT', pi0: 'π₀', 'pi0.5': 'π₀.₅' }[key] || key;
}

function selectArch(key) {
  curArch = key;
  const A = SPECS.arches[key];
  diagram.setSpec(A.spec);
  diagram._needFit = true;   // refit on arch change
  $$('.av-tab').forEach(b => b.classList.toggle('on', b.dataset.arch === key));
  $('#av-desc').innerHTML =
    `<strong>${esc(A.label)}</strong> · <span class="av-decode">${esc(prettyDecode(A.decode))}</span>`
    + (A.paper ? ` · <span class="av-paper">${esc(A.paper)}</span>` : '');
  $('#cf-arch').textContent = A.label;
  buildFields(key);
}

const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function prettyDecode(d) {
  return { flow_matching: 'flow matching', diffusion: 'diffusion', direct: 'direct regression' }[d] || d;
}

// ── hyperparameter fields for the selected architecture ───────────────────────
function buildFields(key) {
  const host = $('#cf-fields'); host.innerHTML = '';
  const hp = hpByArch[key] || (hpByArch[key] = {});
  for (const f of SPECS.arches[key].fields) {
    if (hp[f.name] == null) hp[f.name] = f.default;
    const field = el('label', 'cf-field');
    field.appendChild(el('span', null, esc(f.label) + (f.help ? ` <em title="${esc(f.help)}">?</em>` : '')));
    const inp = el('input');
    inp.type = 'number';
    if (f.min != null) inp.min = f.min;
    if (f.max != null) inp.max = f.max;
    inp.value = hp[f.name];
    inp.addEventListener('input', () => {
      let v = parseInt(inp.value, 10);
      if (Number.isNaN(v)) return;
      if (f.min != null) v = Math.max(f.min, v);
      if (f.max != null) v = Math.min(f.max, v);
      hp[f.name] = v;
    });
    inp.addEventListener('blur', () => { inp.value = hp[f.name]; });   // reflect clamp
    field.appendChild(inp);
    host.appendChild(field);
  }
}

// ── dataset picker ────────────────────────────────────────────────────────────
function buildDatasetSelect() {
  const sel = $('#cf-dataset'); sel.innerHTML = '';
  if (!DATASETS.length) { sel.appendChild(el('option', null, 'no datasets available')); sel.disabled = true; return; }
  for (const d of DATASETS) {
    const o = el('option', null, `${esc(d.name)} · ${d.n_episodes} ep · ${d.n_cameras}cam`);
    o.value = d.name;
    sel.appendChild(o);
  }
}

// ── submit ────────────────────────────────────────────────────────────────────
async function submitJob() {
  const msg = $('#cf-msg'), btn = $('#cf-submit');
  const payload = {
    arch: curArch,
    dataset: $('#cf-dataset').value,
    hp: { ...(hpByArch[curArch] || {}) },
    submitter: ($('#cf-name').value || '').trim().slice(0, 40) || 'anon',
    note: ($('#cf-note').value || '').trim().slice(0, 140),
  };
  if (!payload.dataset) { setMsg(msg, 'pick a dataset first', 'err'); return; }
  btn.disabled = true; setMsg(msg, 'submitting…', '');
  try {
    const res = await fetch(`${API}/api/community/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `error ${res.status}`);
    setMsg(msg, `queued · #${data.id} · position ${data.position != null ? data.position : '—'} — thank you!`, 'ok');
    $('#cf-note').value = '';
    loadQueue();
  } catch (e) {
    setMsg(msg, `could not submit: ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
}

function setMsg(node, text, kind) {
  node.textContent = text;
  node.className = 'cf-msg' + (kind ? ' ' + kind : '');
}

// ── live community queue ──────────────────────────────────────────────────────
async function loadQueue() {
  const box = $('#cf-queue');
  box.innerHTML = '<div class="cf-q-empty">loading queue…</div>';
  try {
    const res = await fetch(`${API}/api/community/jobs?limit=24`);
    if (!res.ok) throw new Error();
    const { jobs = [] } = await res.json();
    if (!jobs.length) { box.innerHTML = '<div class="cf-q-empty">no jobs yet — be the first to contribute.</div>'; return; }
    box.innerHTML = '';
    for (const j of jobs) box.appendChild(queueRow(j));
  } catch {
    box.innerHTML = '<div class="cf-q-empty">community queue is offline right now.</div>';
  }
}

function queueRow(j) {
  const row = el('div', 'cf-q-row');
  const status = String(j.status || 'pending');
  row.appendChild(el('span', 'cf-q-arch', esc(shortName(j.arch))));
  row.appendChild(el('span', 'cf-q-main',
    `<b>${esc(j.submitter || 'anon')}</b> · ${esc(j.dataset || '')}`
    + (j.note ? ` <span class="cf-q-note">“${esc(j.note)}”</span>` : '')));
  row.appendChild(el('span', `cf-q-status s-${esc(status)}`, esc(status)));
  return row;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
