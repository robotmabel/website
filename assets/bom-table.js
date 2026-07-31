/* ═══════════════════════════════════════════════════════════════════
   MABEL — BOM page renderer
   Renders the whole bill of materials from window.MABEL_BOM (published by
   BOM/tools/build_bom.py). No data is duplicated in the HTML: change a price
   in BOM/data/mabel_bom.csv, re-run the build, and this page follows.
═══════════════════════════════════════════════════════════════════ */
(function () {
  const D = window.MABEL_BOM;
  if (!D) return;

  const usd = (n) => '$' + Math.round(n).toLocaleString();
  const usd2 = (n) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── 1 · scenarios ─────────────────────────────────────────────── */
  // Which subsystems each scenario drops, so picking one dims the right rows.
  const DROPS = { S1: [], S2: [], S3: ['Compute'], S4: ['Compute', 'Sensing'] };
  const scnHost = document.getElementById('bomScenarios');
  let active = 'S2';

  if (scnHost) {
    D.scenarios.forEach((s) => {
      const card = el('button', 'scn' + (s.id === active ? ' on' : ''));
      card.type = 'button';
      card.dataset.id = s.id;
      card.innerHTML =
        `<span class="scn-id">${s.id}</span>` +
        `<span class="scn-name">${esc(s.name)}</span>` +
        `<span class="scn-val">${usd(s.usd)}</span>` +
        `<span class="scn-detail">${esc(s.detail)}</span>`;
      card.addEventListener('click', () => select(s.id));
      scnHost.appendChild(card);
    });
  }

  function select(id) {
    active = id;
    document.querySelectorAll('.scn').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
    const drop = DROPS[id] || [];
    document.querySelectorAll('#bomTable .row').forEach((r) => {
      r.classList.toggle('dropped', drop.includes(r.dataset.section));
    });
    // S2 substitutes Thor rather than dropping it.
    const swap = (id === 'S2');
    const cr = document.querySelector('#bomTable .row[data-section="Compute"]');
    if (cr) {
      cr.classList.toggle('swapped', swap);
      const sub = cr.querySelector('.sub');
      const val = cr.querySelector('.val');
      if (sub) sub.textContent = swap ? 'Jetson Orin Nano Super (8 GB) — substituted' : 'Jetson AGX Thor developer kit';
      if (val) val.textContent = swap ? usd(249) : usd(computeCost);
    }
    const s = D.scenarios.find((x) => x.id === id);
    const tot = document.getElementById('bomLiveTotal');
    if (tot && s) tot.textContent = usd(s.usd);
    const note = document.getElementById('bomLiveNote');
    if (note && s) note.textContent = s.detail;
  }

  /* ── 2 · subsystem table (feeds bom-donut.js) ──────────────────── */
  const SUB_NOTE = {
    'Mobile base': '3× REV MAXSwerve + NEO / NEO 550 motors + 6 SPARK controllers',
    'Body': 'Lift column, torso-pitch DM-J10422P, plates and brackets',
    'Arms': '14 DAMIAO QDD actuators + OpenArm structure + harness',
    'Hands': '34 Feetech bus servos + driver and power boards (2 ORCA hands)',
    'Head & neck': 'DM-J4310 yaw + 2× Dynamixel XC330-T181 pitch/roll',
    'Sensing': 'ZED Mini, D435i, 2× D405 wrist cams, RPLIDAR A2M12',
    'Structure & fasteners': 'Aluminium extrusion, screws, brackets, magnets',
    'Electronics & power': '2× Teensy 4.1, Pico, switch, batteries, cabling',
    'Compute': 'Jetson AGX Thor developer kit',
  };
  const subHost = document.getElementById('bomTable');
  let computeCost = 0;
  if (subHost) {
    D.subsystems.forEach((s, i) => {
      if (s.name === 'Compute') computeCost = s.usd;
      const row = el('div', 'row');
      row.dataset.section = s.name;
      row.innerHTML =
        `<span class="num">${String(i + 1).padStart(2, '0')}</span>` +
        `<div><div class="name">${esc(s.name)}</div>` +
        `<div class="sub">${esc(SUB_NOTE[s.name] || '')}</div></div>` +
        `<span class="val">${usd(s.usd)}</span>`;
      subHost.appendChild(row);
    });
    const tot = el('div', 'spec-total');
    tot.innerHTML = `<span class="label">Total · <span id="bomLiveNote">${esc(
      D.scenarios.find((s) => s.id === 'S2').detail)}</span></span>` +
      `<span class="big" id="bomLiveTotal">${usd(D.scenarios.find((s) => s.id === 'S2').usd)}</span>`;
    subHost.appendChild(tot);
    // The donut always draws the AS-BUILT split (it is the robot's anatomy, not
    // a scenario); the rows and the big total below it follow the picker.
    const donut = document.getElementById('bomDonut');
    if (donut) {
      donut.dataset.total = D.total_usd;
      donut.dataset.totalLabel = 'Total · as built';
    }
  }

  /* ── 3 · full itemised table ───────────────────────────────────── */
  const FLAG = {
    corrected: ['†', 'Corrected against the submitted purchase sheet'],
    added: ['‡', 'Added — the firmware or HAL proves this part is installed'],
    verified: ['✓', 'Unit price read off the vendor page on ' + D.fx_date],
    sheet: ['', 'As-purchased from the record; not independently re-priced'],
  };
  const lineHost = document.getElementById('bomLines');
  const sections = D.subsystems.map((s) => s.name);
  let filter = 'all';
  let query = '';

  function renderLines() {
    if (!lineHost) return;
    lineHost.innerHTML = '';
    let shown = 0, sum = 0;
    sections.forEach((sec) => {
      const items = D.items.filter((it) =>
        it.section === sec &&
        (filter === 'all' || filter === sec) &&
        (!query || (it.item + ' ' + it.part + ' ' + it.vendor).toLowerCase().includes(query)));
      if (!items.length) return;
      const secSum = items.reduce((a, b) => a + b.ext_usd, 0);
      sum += secSum;
      const head = el('tr', 'bl-sec');
      head.innerHTML = `<td colspan="4">${esc(sec)}</td><td class="r">${usd2(secSum)}</td>`;
      lineHost.appendChild(head);
      items.forEach((it) => {
        shown++;
        const [mark, tip] = FLAG[it.status] || ['', ''];
        const name = it.link
          ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.item)} ↗</a>`
          : esc(it.item);
        const flag = mark ? ` <span class="bl-flag bl-${it.status}" title="${esc(tip)}">${mark}</span>` : '';
        const yen = it.currency === 'CNY' ? '<span class="bl-yen" title="quoted in CNY, converted at 1 USD = ' + D.fx_cny_per_usd + ' CNY">¥</span>' : '';
        const tr = el('tr');
        tr.innerHTML =
          `<td class="bl-item">${name}${flag}` +
          (it.note ? `<div class="bl-note">${esc(it.note)}</div>` : '') + '</td>' +
          `<td class="bl-part">${esc(it.part)}</td>` +
          `<td class="r">${it.qty}</td>` +
          `<td class="r">${usd2(it.unit_usd)}${yen}</td>` +
          `<td class="r">${usd2(it.ext_usd)}</td>`;
        lineHost.appendChild(tr);
      });
    });
    const foot = document.getElementById('bomLinesFoot');
    if (foot) {
      foot.innerHTML = shown === D.items.length
        ? `<strong>${D.items.length} lines · ${usd2(D.total_usd)}</strong> as built`
        : `<strong>${shown} of ${D.items.length} lines · ${usd2(sum)}</strong> shown`;
    }
  }

  const chipHost = document.getElementById('bomFilters');
  if (chipHost) {
    ['all'].concat(sections).forEach((sec) => {
      const b = el('button', 'bl-chip' + (sec === 'all' ? ' on' : ''), sec === 'all' ? 'All' : esc(sec));
      b.type = 'button';
      b.addEventListener('click', () => {
        filter = sec;
        chipHost.querySelectorAll('.bl-chip').forEach((c) => c.classList.toggle('on', c === b));
        renderLines();
      });
      chipHost.appendChild(b);
    });
  }
  const search = document.getElementById('bomSearch');
  if (search) {
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderLines(); });
  }

  /* ── 4 · variance + gaps ───────────────────────────────────────── */
  const varHost = document.getElementById('bomVariance');
  if (varHost) {
    let ts = 0, tv = 0;
    D.variance.forEach((v) => {
      ts += v.submitted_usd; tv += v.verified_usd;
      const d = v.verified_usd - v.submitted_usd;
      const tr = el('tr');
      tr.innerHTML =
        `<td><strong>${esc(v.line)}</strong><div class="bl-note">${esc(v.reason)}</div></td>` +
        `<td class="r">${usd2(v.submitted_usd)}</td>` +
        `<td class="r">${usd2(v.verified_usd)}</td>` +
        `<td class="r ${d < 0 ? 'dn' : 'up'}">${d < 0 ? '−' : '+'}${usd2(Math.abs(d))}</td>`;
      varHost.appendChild(tr);
    });
    const d = tv - ts;
    const tr = el('tr', 'bl-sec');
    tr.innerHTML = `<td>Net effect on the total</td><td class="r">${usd2(ts)}</td>` +
      `<td class="r">${usd2(tv)}</td><td class="r ${d < 0 ? 'dn' : 'up'}">${d < 0 ? '−' : '+'}${usd2(Math.abs(d))}</td>`;
    varHost.appendChild(tr);
  }

  const gapHost = document.getElementById('bomGaps');
  if (gapHost) {
    D.gaps.forEach((g) => {
      const tr = el('tr');
      tr.innerHTML =
        `<td><strong>${esc(g.item)}</strong><div class="bl-note">${esc(g.note)}</div></td>` +
        `<td class="r">${g.qty}</td>` +
        `<td class="r">${usd(g.qty * g.low_usd)} – ${usd(g.qty * g.high_usd)}</td>`;
      gapHost.appendChild(tr);
    });
    const lo = D.uncosted_gap_usd.low, hi = D.uncosted_gap_usd.high;
    const tr = el('tr', 'bl-sec');
    tr.innerHTML = `<td colspan="2">Estimated total not on the purchase record</td>` +
      `<td class="r">${usd(lo)} – ${usd(hi)}</td>`;
    gapHost.appendChild(tr);
    const s2 = D.scenarios.find((s) => s.id === 'S2').usd;
    const note = document.getElementById('bomGapNote');
    if (note) {
      note.innerHTML = `Carrying these, scenario <strong>S2</strong> becomes ` +
        `<strong>${usd(s2 + lo)} – ${usd(s2 + hi)}</strong> — above \$10,000 at both ends. ` +
        `Only <strong>S3</strong> (${usd(D.scenarios.find((s) => s.id === 'S3').usd)}, no onboard compute) ` +
        `stays under the line once the gaps are carried.`;
    }
  }

  /* ── 5 · peer comparison ───────────────────────────────────────── */
  const peerHost = document.getElementById('bomPeers');
  if (peerHost) {
    const s2 = D.scenarios.find((s) => s.id === 'S2').usd / 1000;
    const rows = D.peers.map((p) => ({ name: p.platform, k: p.cost_kusd, open: p.open, mine: false }));
    rows.push({ name: 'MABEL (this work)', k: s2, open: true, mine: true });
    rows.sort((a, b) => a.k - b.k);
    const max = rows[rows.length - 1].k;
    rows.forEach((r) => {
      const row = el('div', 'peer' + (r.mine ? ' mine' : ''));
      row.innerHTML =
        `<span class="peer-name">${esc(r.name)}</span>` +
        `<span class="peer-bar"><i style="width:${(r.k / max * 100).toFixed(1)}%"></i></span>` +
        `<span class="peer-val">$${r.k.toFixed(1)}k</span>` +
        `<span class="peer-tag">${r.open ? 'open' : 'commercial'}</span>`;
      peerHost.appendChild(row);
    });
  }

  /* ── 6 · stamps ────────────────────────────────────────────────── */
  document.querySelectorAll('[data-bom]').forEach((n) => {
    const key = n.dataset.bom;
    const map = {
      total: usd(D.total_usd),
      s1: usd(D.scenarios[0].usd), s2: usd(D.scenarios[1].usd),
      s3: usd(D.scenarios[2].usd), s4: usd(D.scenarios[3].usd),
      lines: D.line_count, dof: D.functional_dof, motors: D.motor_count,
      fx: D.fx_cny_per_usd, date: D.fx_date,
      perdof: usd(D.scenarios[1].usd / D.functional_dof),
      armact: usd(D.derived.arm_actuators_usd),
      swervemod: usd2(D.derived.swerve_per_module_usd),
      hands: usd(D.derived.hands_usd),
      handperdof: usd(D.derived.hand_per_dof_usd),
      computedelta: usd(D.derived.compute_delta_usd),
      fab: usd(D.derived.fabrication_usd),
    };
    if (map[key] != null) n.textContent = map[key];
  });

  renderLines();
  // Defer the scenario swap one frame so bom-donut.js slices the as-built rows.
  requestAnimationFrame(() => select(active));
})();
