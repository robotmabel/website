"""Update public cost summaries from the shipped BOM data, without other site edits."""
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
raw = (ROOT / 'assets/bom/bom_data.js').read_text()
data = json.loads(raw.split('window.MABEL_BOM =', 1)[1].strip().rstrip(';'))
builds = {b['id']: b for b in data['builds']}
essential, recommended, maximum = [builds[k]['total'] for k in ('essential', 'recommended', 'maximum')]
core = data['core_total']
for p in [*ROOT.glob('*.html'), *ROOT.glob('docs/*.html'), ROOT/'docs/hub.js',
          ROOT/'docs/data/community.json', ROOT/'assets/comic-pop.js', ROOT/'assets/spec-grid.js']:
    s = p.read_text()
    for old, new in [('8,722', f'{essential:,.0f}'), ('9,670', f'{recommended:,.0f}'),
                     ('15,129', f'{maximum:,.0f}'), ('8,058.29', f'{core:,.2f}'),
                     ('8,058', f'{core:,.0f}')]:
        s = s.replace(old, new)
    if p.name == 'index.html':
        s = s.replace('long-horizon autonomy on Jetson Thor', 'Raspberry Pi compute and off-board policy inference')
        s = s.replace('whole-body autonomy — onboard.', 'off-board policy inference.')
        s = s.replace(f'built for ${recommended:,.0f}', f'listed at ${essential:,.0f} in parts')
        s = s.replace(f'${recommended:,.0f} as built.', f'${essential:,.0f} in parts with Raspberry Pi compute.')
        s = s.replace(f'<b>${recommended:,.0f}</b><span>as built</span>', f'<b>${essential:,.0f}</b><span>Pi build, parts</span>')
        s = s.replace(f'What you get for <span class="italic accent">${recommended:,.0f}.', f'What you get for <span class="italic accent">${essential:,.0f}.')
        s = s.replace('data-target="9.7">0</span><span class="unit">k USD', f'data-target="{essential/1000:.1f}">0</span><span class="unit">k USD')
        s = s.replace('As built — under<br/>ten thousand', 'Pi build — listed<br/>parts subtotal')
    if p.name == 'spec-grid.js':
        s = s.replace('As built, at the recommended tier.', 'Listed parts, at the recommended tier.')
    p.write_text(s)

p = ROOT/'docs/bom.html'
s = p.read_text()
rows = []
for sec in data['core_sections']:
    name = html.escape(sec['name'])
    rows.append(f'<tr><td>{name}</td><td class="num">{sec["usd"]:,.2f}</td><td class="num">{sec["share"]:.2f}%</td></tr>')
table = '<table>\n<tr><th>Section</th><th class="num">USD</th><th class="num">Share</th></tr>\n' + '\n'.join(rows)
table += f'\n<tr class="total"><td>Core total</td><td class="num">{core:,.2f}</td><td class="num">100%</td></tr>\n</table>'
s = re.sub(r'(<h2>Core BOM.*?</p>\s*)<table>.*?</table>', lambda m:m[1]+table, s, count=1, flags=re.S)
for sec in data['core_sections']:
    name = sec['name']
    pattern = r'(<tr data-sec="' + re.escape(name) + r'">.*?data-l="Share">)[^<]*(.*?data-l="Cost"[^>]*>)[^<]*'
    s = re.sub(pattern, lambda m:m[1]+f'{sec["share"]:.0f}%'+m[2]+f'${sec["usd"]:,.0f}', s)
table = '<table>\n<tr><th>Choice</th><th>Essential</th><th>Recommended</th><th>Maximum</th></tr>\n'
for idx, pick in enumerate(builds['essential']['picks']):
    table += '<tr><td>' + html.escape(pick['choice']) + '</td>'
    for b in builds.values():
        choice = b['picks'][idx]
        table += f'<td>{html.escape(choice["option"])} (${choice["usd"]:,.2f})</td>'
    table += '</tr>\n'
table += '<tr class="total"><td>Listed parts subtotal</td>' + ''.join(f'<td class="num">${b["total"]:,.2f}</td>' for b in builds.values()) + '</tr>\n</table>'
s = re.sub(r'(<h2>The six choices.*?</p>\s*)<table>.*?</table>', lambda m:m[1]+table, s, count=1, flags=re.S)
s = s.replace('The reference robot in these docs is the <b>Maximum</b> build (Jetson Thor,\n    D405 wrists, ZED Mini head, D435i base, A2M12). Where a step is\n    sensor-specific it is flagged; everything else is tier-independent.',
    'The standard robot uses the <b>Essential</b> configuration: Raspberry Pi 5 (16 GB),\n    720p global-shutter wrist cameras, an IEights stereo head camera, and LD19 lidar.\n    Policies run off-board; Jetson compute and depth cameras are optional upgrades.\n    Totals exclude unpriced items, optional storage, operator equipment, shipping, taxes, and labor.')
s = s.replace('Prices are as paid on 31 July 2026.', 'Price basis: 31 July 2026; configuration and catalog corrections updated 22 September 2026.')
s = s.replace('Prices are live-quoted (last refresh: 31&nbsp;July&nbsp;2026)', 'Configuration updated 22&nbsp;September&nbsp;2026 (price basis: 31&nbsp;July&nbsp;2026)')
s = s.replace('The raw CSVs it\n  is generated from live in\n  <a href="https://github.com/robotmabel/MABEL/tree/main/BOM/data"><code>BOM/data/</code></a>.',
    'Download the current <a href="../assets/bom/core.csv">core parts CSV</a>,\n  <a href="../assets/bom/choices.csv">compute and sensing CSV</a>, or\n  <a href="../assets/bom/mabel_bom.pdf">BOM audit PDF</a>.')
p.write_text(s)
print(f'Synced BOM: core ${core:,.2f}; Essential ${essential:,.2f}; Recommended ${recommended:,.2f}; Maximum ${maximum:,.2f}')
