/* ═══════════════════════════════════════════════════════════════════
   MABEL — interactive BOM cost donut
   Reads the existing bill-of-materials table (no duplicated data), draws an
   SVG cost-breakdown donut, and cross-links it with the rows: hover a row to
   highlight its slice and vice-versa, with a live centre readout.
═══════════════════════════════════════════════════════════════════ */
(function () {
  const host = document.getElementById('bomDonut');
  if (!host) return;
  const rows = Array.from(document.querySelectorAll('.spec-table .row'));
  if (!rows.length) return;

  const items = rows.map((el) => {
    const name = (el.querySelector('.name')?.textContent || '').trim();
    const cost = parseFloat((el.querySelector('.val')?.textContent || '').replace(/[^0-9.]/g, '')) || 0;
    return { el, name, cost };
  }).filter((i) => i.cost > 0);
  const total = items.reduce((s, i) => s + i.cost, 0);
  if (!total) return;

  // A host may declare the authoritative centre readout (data-total /
  // data-total-label) when the rows are rounded per-line and would otherwise
  // sum a dollar off. Slice geometry always uses the row sum.
  const shownTotal = () => {
    const t = parseFloat(host.dataset.total || '');
    return Number.isFinite(t) ? t : total;
  };
  const shownLabel = () => host.dataset.totalLabel || 'Total BOM';

  // warm palette (rusts → inks) so slices stay on-brand
  const PALETTE = ['#C25B2A', '#A8481F', '#D8814F', '#8B3F1D', '#E0A06A',
    '#5E4A38', '#A89A86', '#3A332C', '#C9B79A'];

  const NS = 'http://www.w3.org/2000/svg';
  const R = 42, C = 2 * Math.PI * R, cx = 60, cy = 60;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'bom-donut-svg');

  // track ring
  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('cx', cx); track.setAttribute('cy', cy); track.setAttribute('r', R);
  track.setAttribute('fill', 'none'); track.setAttribute('stroke', 'rgba(22,20,18,0.08)'); track.setAttribute('stroke-width', '14');
  svg.appendChild(track);

  let acc = 0;
  const segs = items.map((it, i) => {
    const frac = it.cost / total;
    const seg = document.createElementNS(NS, 'circle');
    seg.setAttribute('cx', cx); seg.setAttribute('cy', cy); seg.setAttribute('r', R);
    seg.setAttribute('fill', 'none');
    seg.setAttribute('stroke', PALETTE[i % PALETTE.length]);
    seg.setAttribute('stroke-width', '14');
    seg.setAttribute('stroke-dasharray', `${frac * C - 1.2} ${C - frac * C + 1.2}`);
    seg.setAttribute('stroke-dashoffset', `${-acc * C}`);
    seg.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    seg.setAttribute('class', 'bom-seg');
    seg.style.cursor = 'pointer';
    svg.appendChild(seg);
    acc += frac;
    it.frac = frac; it.color = PALETTE[i % PALETTE.length];
    return seg;
  });

  // centre readout
  const fmt = (n) => '$' + Math.round(n).toLocaleString();
  const big = document.createElement('div'); big.className = 'bom-c-val'; big.textContent = fmt(shownTotal());
  const sub = document.createElement('div'); sub.className = 'bom-c-key'; sub.textContent = shownLabel();
  const centre = document.createElement('div'); centre.className = 'bom-centre';
  centre.appendChild(big); centre.appendChild(sub);

  host.appendChild(svg);
  host.appendChild(centre);

  function focus(i) {
    items.forEach((it, k) => {
      const on = (k === i);
      segs[k].classList.toggle('dim', i !== null && !on);
      segs[k].classList.toggle('hot', on);
      it.el.classList.toggle('bom-row-hot', on);
    });
    if (i === null) { big.textContent = fmt(shownTotal()); sub.textContent = shownLabel(); big.style.color = ''; }
    else {
      big.textContent = fmt(items[i].cost);
      sub.textContent = `${Math.round(items[i].frac * 100)}% · ${items[i].name}`;
      big.style.color = items[i].color;
    }
  }

  items.forEach((it, i) => {
    const enter = () => focus(i);
    const leave = () => focus(null);
    segs[i].addEventListener('mouseenter', enter);
    segs[i].addEventListener('mouseleave', leave);
    it.el.addEventListener('mouseenter', enter);
    it.el.addEventListener('mouseleave', leave);
    it.el.style.cursor = 'default';
  });
})();
