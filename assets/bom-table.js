/* ═══════════════════════════════════════════════════════════════════
   MABEL — BOM page renderer + build configurator
   Everything is drawn from window.MABEL_BOM, published by
   BOM/tools/build_bom.py. No price is duplicated in the HTML: edit
   BOM/data/*.csv, re-run the build, and this page follows.
═══════════════════════════════════════════════════════════════════ */
(function () {
  const D = window.MABEL_BOM;
  if (!D) return;

  const usd = (n) => '$' + Math.round(n).toLocaleString();
  const usd2 = (n) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const byId = (id) => document.getElementById(id);

  /* ── state: one selected option index per choice group ───────────── */
  const sel = {};                       // choice_id -> option index
  let preset = 'recommended';

  function applyPreset(id) {
    preset = id;
    D.choices.forEach((g) => {
      let i = g.options.findIndex((o) => o.tiers.includes(id));
      if (i < 0) i = 0;
      sel[g.id] = i;
    });
  }

  function chosen(g) { return g.options[sel[g.id]]; }
  function choicesTotal() { return D.choices.reduce((s, g) => s + chosen(g).ext_usd, 0); }
  function total() { return D.core_total + choicesTotal(); }

  function matchedPreset() {
    for (const b of D.builds) {
      if (D.choices.every((g) => chosen(g).tiers.includes(b.id))) return b.id;
    }
    return null;
  }

  /* ── 1 · build cards ─────────────────────────────────────────────── */
  const buildHost = byId('bomBuilds');
  if (buildHost) {
    D.builds.forEach((b) => {
      const card = el('button', 'scn');
      card.type = 'button';
      card.dataset.id = b.id;
      card.innerHTML =
        `<span class="scn-id">${esc(b.id === 'recommended' ? 'recommended · start here' : b.id)}</span>` +
        `<span class="scn-name">${esc(b.name)}</span>` +
        `<span class="scn-val">${usd(b.total)}</span>` +
        `<span class="scn-detail">${esc(b.blurb)}</span>`;
      card.addEventListener('click', () => { applyPreset(b.id); render(); });
      buildHost.appendChild(card);
    });
  }

  /* ── 2 · configurator ────────────────────────────────────────────── */
  const cfgHost = byId('bomConfig');
  if (cfgHost) {
    D.choices.forEach((g) => {
      const grp = el('div', 'cfg-grp');
      grp.dataset.choice = g.id;
      grp.innerHTML =
        `<div class="cfg-head"><span class="cfg-id">${esc(g.id)}</span>` +
        `<span class="cfg-name">${esc(g.name)}${g.qty > 1 ? ` <span class="cfg-qty">×${g.qty}</span>` : ''}</span>` +
        `<span class="cfg-span">${usd(g.lo)} – ${usd(g.hi)}</span></div>`;
      const list = el('div', 'cfg-opts');
      g.options.forEach((o, i) => {
        const b = el('button', 'cfg-opt');
        b.type = 'button';
        b.dataset.i = i;
        const tierTags = o.tiers.filter((t) => ['essential', 'recommended', 'maximum'].includes(t))
          .map((t) => `<span class="cfg-tier t-${t}">${t}</span>`).join('');
        b.innerHTML =
          `<span class="cfg-o-top"><span class="cfg-o-name">${esc(o.option)}</span>${tierTags}</span>` +
          `<span class="cfg-o-spec">${esc(o.spec)}</span>` +
          `<span class="cfg-o-price">${usd2(o.ext_usd)}${g.qty > 1 ? `<i>${usd2(o.unit_usd)} ea</i>` : ''}</span>`;
        b.addEventListener('click', () => { sel[g.id] = i; render(); });
        list.appendChild(b);
      });
      grp.appendChild(list);
      const note = g.options.map((o) => o.note).find(Boolean);
      if (note) grp.appendChild(el('p', 'cfg-note', esc(note)));
      cfgHost.appendChild(grp);
    });
  }

  /* ── 3 · core table ──────────────────────────────────────────────── */
  const FLAG = {
    corrected: ['†', 'Part number corrected against the verified vendor listing'],
    disputed: ['✻', 'The repository disagrees with this line — see open items'],
    tbd: ['', 'Not yet priced; carried at zero in every total'],
    sheet: ['', ''],
  };
  const coreHost = byId('bomCore');
  const sections = D.core_sections.map((s) => s.name);
  let filter = 'all';
  let query = '';

  function renderCore() {
    if (!coreHost) return;
    coreHost.innerHTML = '';
    let shown = 0, sum = 0;
    sections.forEach((sec) => {
      const items = D.core.filter((it) =>
        it.section === sec &&
        (filter === 'all' || filter === sec) &&
        (!query || (it.item + ' ' + it.spec + ' ' + it.vendor + ' ' + it.ref)
          .toLowerCase().includes(query)));
      if (!items.length) return;
      const secSum = items.reduce((a, b) => a + b.ext_usd, 0);
      sum += secSum;
      const head = el('tr', 'bl-sec');
      head.innerHTML = `<td colspan="4">${esc(sec)}</td><td class="r">${usd2(secSum)}</td>`;
      coreHost.appendChild(head);
      items.forEach((it) => {
        shown++;
        const [mark, tip] = FLAG[it.status] || ['', ''];
        const name = it.link
          ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.item)} ↗</a>`
          : esc(it.item);
        const flag = mark ? ` <span class="bl-flag bl-${it.status}" title="${esc(tip)}">${mark}</span>` : '';
        const yen = it.currency === 'CNY'
          ? `<span class="bl-yen" title="¥${it.unit_native} at 1 CNY = $${D.cny_to_usd}">¥</span>` : '';
        const tbd = it.status === 'tbd';
        const tr = el('tr');
        tr.innerHTML =
          `<td class="bl-ref">${esc(it.ref)}</td>` +
          `<td class="bl-item">${name}${flag}` +
          (it.spec ? `<div class="bl-spec">${esc(it.spec)}</div>` : '') +
          (it.note ? `<div class="bl-note">${esc(it.note)}</div>` : '') + '</td>' +
          `<td class="r">${it.qty}</td>` +
          `<td class="r">${tbd ? '<i>TBD</i>' : usd2(it.unit_usd) + yen}</td>` +
          `<td class="r">${tbd ? '<i>TBD</i>' : usd2(it.ext_usd)}</td>`;
        coreHost.appendChild(tr);
      });
    });
    const foot = byId('bomCoreFoot');
    if (foot) {
      foot.innerHTML = shown === D.core.length
        ? `<strong>${D.core.length} lines · ${usd2(D.core_total)}</strong> — identical in every build`
        : `<strong>${shown} of ${D.core.length} lines · ${usd2(sum)}</strong> shown`;
    }
  }

  const chipHost = byId('bomFilters');
  if (chipHost) {
    ['all'].concat(sections).forEach((sec) => {
      const b = el('button', 'bl-chip' + (sec === 'all' ? ' on' : ''), sec === 'all' ? 'All' : esc(sec));
      b.type = 'button';
      b.addEventListener('click', () => {
        filter = sec;
        chipHost.querySelectorAll('.bl-chip').forEach((c) => c.classList.toggle('on', c === b));
        renderCore();
      });
      chipHost.appendChild(b);
    });
  }
  const search = byId('bomSearch');
  if (search) search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderCore();
  });

  /* ── 4 · where the money goes ────────────────────────────────────── */
  function renderFunctional() {
    const host = byId('bomFunctional');
    if (!host) return;
    // recompute the split live from the current configuration
    const groups = {};
    D.core.forEach((r) => { groups[r.fgroup] = (groups[r.fgroup] || 0) + r.ext_usd; });
    D.choices.forEach((g) => {
      const o = chosen(g);
      if (o.ext_usd > 0) groups[o.fgroup] = (groups[o.fgroup] || 0) + o.ext_usd;
    });
    const NAMES = {};
    D.functional.forEach((f) => { NAMES[f.key] = f.name; });
    const t = total();
    const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    host.innerHTML = '';
    rows.forEach(([k, v], i) => {
      const row = el('div', 'fn-row');
      row.innerHTML =
        `<span class="fn-name">${esc(NAMES[k] || k)}</span>` +
        `<span class="fn-bar"><i style="width:${(v / rows[0][1] * 100).toFixed(1)}%"></i></span>` +
        `<span class="fn-val">${usd(v)}</span>` +
        `<span class="fn-pct">${(v / t * 100).toFixed(1)}%</span>`;
      host.appendChild(row);
    });
  }

  /* ── 5 · static tables ───────────────────────────────────────────── */
  function fillMachined() {
    const host = byId('bomMachined');
    if (!host) return;
    const tiers = ['p1', 'p2', 'p10', 'p50', 'p100', 'p1000'];
    D.machined.forEach((m) => {
      const tr = el('tr');
      tr.innerHTML =
        `<td class="bl-ref">${esc(m.ref)}</td>` +
        `<td class="bl-item"><strong>${esc(m.part)}</strong><div class="bl-spec">${esc(m.operations)}</div></td>` +
        `<td class="r">${m.qty}</td>` +
        tiers.map((t) => `<td class="r">${usd2(m.tiers[t])}</td>`).join('');
      host.appendChild(tr);
    });
    const tr = el('tr', 'bl-sec');
    tr.innerHTML = `<td colspan="3">Full set per robot</td>` +
      tiers.map((t) => `<td class="r">${usd2(D.machined_set[t])}</td>`).join('');
    host.appendChild(tr);
    const note = byId('bomMachinedNote');
    if (note) {
      const drop = (1 - D.machined_set.p10 / D.machined_set.p1) * 100;
      note.innerHTML = `One set costs <strong>${usd2(D.machined_set.p1)}</strong>. Ten sets cost ` +
        `<strong>${usd2(D.machined_set.p10)}</strong> each — a <strong>${drop.toFixed(0)}%</strong> ` +
        `reduction, because setup and tooling dominate at quantity one.`;
    }
  }

  function fillBuildBuy() {
    const host = byId('bomBuildBuy');
    if (!host) return;
    ['Arms', 'Hands'].forEach((c) => {
      const sel2 = D.build_or_buy.filter((r) => r.category === c);
      const base = sel2.find((r) => r.is_mabel).both_usd;
      const max = Math.max(...sel2.map((r) => r.both_usd));
      const head = el('tr', 'bl-sec');
      head.innerHTML = `<td colspan="4">${esc(c)} — both sides</td>`;
      host.appendChild(head);
      sel2.forEach((r) => {
        const tr = el('tr', r.is_mabel ? 'bb-mine' : '');
        tr.innerHTML =
          `<td class="bl-item"><strong>${esc(r.option)}</strong><div class="bl-spec">${esc(r.spec)}</div></td>` +
          `<td class="bb-bar"><span><i style="width:${(r.both_usd / max * 100).toFixed(1)}%"></i></span></td>` +
          `<td class="r">${usd2(r.both_usd)}</td>` +
          `<td class="r ${r.is_mabel ? '' : 'up'}">${r.is_mabel ? '—' : '+' + Math.round((r.both_usd / base - 1) * 100) + '%'}</td>`;
        host.appendChild(tr);
      });
    });
  }

  function fillTaobao() {
    const host = byId('bomTaobao');
    if (!host) return;
    D.taobao.forEach((r) => {
      const tr = el('tr');
      const disc = r.list_cny ? ((1 - r.paid_cny / r.list_cny) * 100) : 0;
      tr.innerHTML =
        `<td class="bl-item"><strong>${esc(r.model)}</strong>` +
        `<div class="bl-cn">${esc(r.search)}</div>` +
        `<div class="bl-spec">${esc(r.spec)}</div></td>` +
        `<td class="r">${r.list_cny ? '¥' + r.list_cny.toLocaleString() : '—'}</td>` +
        `<td class="r">¥${r.paid_cny.toLocaleString()}${disc > 0.5 ? `<i class="dn"> −${disc.toFixed(0)}%</i>` : ''}</td>` +
        `<td class="r">${usd2(r.usd)}</td>` +
        `<td class="bl-ref">${esc(r.refs)}</td>`;
      host.appendChild(tr);
    });
  }

  function fillOpen() {
    const host = byId('bomOpen');
    if (!host) return;
    const KIND = { correction: 'unresolved', gap: 'uncosted', 'guide-error': 'guide erratum' };
    D.open_items.forEach((o) => {
      const tr = el('tr');
      const lo = o.qty * o.low_usd, hi = o.qty * o.high_usd;
      const est = hi === 0 ? '—' : (lo === hi ? usd(lo) : `${usd(lo)} – ${usd(hi)}`);
      tr.innerHTML =
        `<td><span class="op-kind op-${o.kind}">${esc(KIND[o.kind] || o.kind)}</span></td>` +
        `<td class="bl-item"><strong>${esc(o.item)}</strong><div class="bl-note">${esc(o.note)}</div></td>` +
        `<td class="r">${est}</td>`;
      host.appendChild(tr);
    });
    const g = D.uncosted_gap_usd;
    const tr = el('tr', 'bl-sec');
    tr.innerHTML = `<td colspan="2">Uncosted hardware, estimated</td>` +
      `<td class="r">${usd(g.low)} – ${usd(g.high)}</td>`;
    host.appendChild(tr);
  }

  function fillPeers() {
    const host = byId('bomPeers');
    if (!host) return;
    const rows = D.peers.map((p) => ({ name: p.platform, k: p.cost_kusd, open: p.open, mine: false }));
    const me = D.builds.find((b) => b.id === 'recommended').total / 1000;
    rows.push({ name: 'MABEL (Recommended)', k: me, open: true, mine: true });
    rows.sort((a, b) => a.k - b.k);
    const max = rows[rows.length - 1].k;
    host.innerHTML = '';
    rows.forEach((r) => {
      const row = el('div', 'peer' + (r.mine ? ' mine' : ''));
      row.innerHTML =
        `<span class="peer-name">${esc(r.name)}</span>` +
        `<span class="peer-bar"><i style="width:${(r.k / max * 100).toFixed(1)}%"></i></span>` +
        `<span class="peer-val">$${r.k.toFixed(1)}k</span>` +
        `<span class="peer-tag">${r.open ? 'open' : 'commercial'}</span>`;
      host.appendChild(row);
    });
  }

  function fillTopTen() {
    const host = byId('bomTopTen');
    if (!host) return;
    D.top_ten.forEach((t, i) => {
      const tr = el('tr');
      tr.innerHTML =
        `<td class="bl-ref">${String(i + 1).padStart(2, '0')}</td>` +
        `<td class="bl-item">${esc(t.item)}</td>` +
        `<td class="r">×${t.qty}</td>` +
        `<td class="r">${usd2(t.ext_usd)}</td>` +
        `<td class="r">${t.share.toFixed(1)}%</td>`;
      host.appendChild(tr);
    });
    const tr = el('tr', 'bl-sec');
    tr.innerHTML = `<td colspan="3">Ten lines of the Maximum build</td>` +
      `<td class="r">${usd2(D.top_ten_sum)}</td><td class="r">${D.top_ten_share.toFixed(1)}%</td>`;
    host.appendChild(tr);
  }

  /* ── 6 · render ──────────────────────────────────────────────────── */
  function render() {
    const t = total();
    const match = matchedPreset();

    document.querySelectorAll('#bomBuilds .scn').forEach((c) =>
      c.classList.toggle('on', c.dataset.id === match));

    document.querySelectorAll('.cfg-grp').forEach((grp) => {
      const id = grp.dataset.choice;
      grp.querySelectorAll('.cfg-opt').forEach((b) =>
        b.classList.toggle('on', Number(b.dataset.i) === sel[id]));
    });

    const set = (id, txt) => { const n = byId(id); if (n) n.textContent = txt; };
    set('cfgTotal', usd(t));
    set('cfgCore', usd(D.core_total));
    set('cfgChoices', usd(choicesTotal()));
    const label = byId('cfgLabel');
    if (label) {
      label.textContent = match
        ? `${D.builds.find((b) => b.id === match).name} build`
        : 'Custom build';
    }
    const bar = byId('cfgBar');
    if (bar) {
      const maxT = D.builds.find((b) => b.id === 'maximum').total;
      bar.querySelector('.cfg-bar-core').style.width = (D.core_total / maxT * 100) + '%';
      bar.querySelector('.cfg-bar-ch').style.width = (choicesTotal() / maxT * 100) + '%';
    }
    renderFunctional();
  }

  /* ── 7 · [data-bom] stamps ───────────────────────────────────────── */
  function stamps() {
    const B = (id) => D.builds.find((b) => b.id === id).total;
    const sv = (k) => D.sensing_savings.find((s) => s.name.toLowerCase().includes(k.toLowerCase())).saving;
    const g = D.uncosted_gap_usd;
    const map = {
      core: usd(D.core_total),
      coreLines: D.core_line_count,
      coreShare: Math.round(D.core_total / B('recommended') * 100) + '%',
      essential: usd(B('essential')),
      recommended: usd(B('recommended')),
      maximum: usd(B('maximum')),
      essSaves: usd(B('maximum') - B('essential')),
      essSavesPct: Math.round((B('maximum') - B('essential')) / B('maximum') * 100) + '%',
      recSaves: usd(B('maximum') - B('recommended')),
      recSavesPct: Math.round((B('maximum') - B('recommended')) / B('maximum') * 100) + '%',
      choicesLo: usd(D.choices_range.lo),
      choicesHi: usd(D.choices_range.hi),
      choicesRatio: D.choices_range.ratio + '×',
      thorBefore: usd(D.jetson_rise.thor_before),
      thorAfter: usd(D.jetson_rise.thor_after),
      nanoBefore: usd(D.jetson_rise.nano_before),
      nanoAfter: usd(D.jetson_rise.nano_after),
      riseDate: D.jetson_rise.date,
      asQuoted: usd(D.as_quoted_total),
      asQuotedToday: usd(D.as_quoted_today),
      dof: D.functional_dof, motors: D.motor_count,
      perDof: usd(B('recommended') / D.functional_dof),
      date: D.price_date, fx: D.cny_to_usd, fxInv: D.usd_to_cny,
      gapsLo: usd(g.low), gapsHi: usd(g.high),
      recWithGapsLo: usd(B('recommended') + g.low),
      recWithGapsHi: usd(B('recommended') + g.high),
      topTen: usd(D.top_ten_sum), topTenPct: D.top_ten_share.toFixed(1) + '%',
      rest: usd(D.top_ten_rest), restCount: D.top_ten_rest_count,
      machinedOne: usd2(D.machined_set.p1), machinedTen: usd2(D.machined_set.p10),
      machinedDrop: Math.round((1 - D.machined_set.p10 / D.machined_set.p1) * 100) + '%',
      filament: usd2(D.bulk_offer.filament_list),
      filamentBulk: usd2(D.bulk_offer.filament_bulk),
      coreBulk: usd(D.bulk_offer.core_at_bulk),
      bulkPct: Math.round(D.bulk_offer.discount * 100) + '%',
      bulkMin: D.bulk_offer.min_qty,
      percCutRec: D.perception_cut.recommended + '%',
      percCutEss: D.perception_cut.essential + '%',
      saveWrist: usd2(sv('Wrist')), saveHead: usd2(sv('Head')),
      saveBase: usd2(sv('Base depth')), saveLidar: usd2(sv('lidar')),
      handShareRec: D.hand_share_recommended + '%',
      handShareMax: D.hand_share_maximum + '%',
      percEss: usd2(D.perception_by_build.essential),
      percRec: usd2(D.perception_by_build.recommended),
      percMax: usd2(D.perception_by_build.maximum),
    };
    const bb = (cat, key) => D.build_or_buy.find((r) => r.category === cat && r.option.includes(key));
    const armsMine = bb('Arms', 'MABEL'), armsOA = bb('Arms', 'assembled'), piper = bb('Arms', 'PiPER');
    map.armsMabel = usd2(armsMine.both_usd);
    map.armsOpenArm = usd2(armsOA.both_usd);
    map.armsSavePct = (100 - armsMine.both_usd / armsOA.both_usd * 100).toFixed(1) + '%';
    map.armsPiperPct = (100 - armsMine.both_usd / piper.both_usd * 100).toFixed(1) + '%';
    map.handsMabel = usd2(bb('Hands', 'MABEL').both_usd);
    const act = D.functional.find((f) => f.key === 'actuation');
    map.actuation = usd(act.usd);
    map.actuationPct = act.share.toFixed(1) + '%';

    document.querySelectorAll('[data-bom]').forEach((n) => {
      const v = map[n.dataset.bom];
      if (v != null) n.textContent = v;
    });
  }

  applyPreset('recommended');
  renderCore();
  fillMachined();
  fillBuildBuy();
  fillTaobao();
  fillOpen();
  fillPeers();
  fillTopTen();
  stamps();
  render();
})();
