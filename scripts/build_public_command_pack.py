#!/usr/bin/env python3
"""Install and zip the public, read-only Claude Code source tours.

Existing command files are preserved unless they match this generated pack.
The full lab harness execution engine is not part of this portable download.
"""
from pathlib import Path
import argparse,json,zipfile
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--checkout',type=Path,required=True)
args=ap.parse_args()
SITE=Path(__file__).resolve().parents[1];ROOT=args.checkout.resolve();data=json.loads((SITE/'assets/data/harness.json').read_text());dest=ROOT/'.claude/commands';dest.mkdir(parents=True,exist_ok=True)
commands=[c for g in data['groups'] for c in g['commands']]
for c in commands:
 p=dest/(c['name']+'.md')
 text=f'''---
description: {c['purpose'].split('.')[0]}
allowed-tools: Read, Glob, Grep, Bash(pwd), Bash(ls:*), Bash(git status:*)
---

You are guiding a reader through the PUBLIC MABEL checkout. This portable command pack provides file-grounded documentation tours; it does not include the private lab host registry.

Command: /{c['name']}
Purpose: {c['purpose']}

Inspect README.md and up to two relevant source files in THIS checkout. Cite relative file paths and line numbers for concrete claims. Use the actual public directory names (ros/, simulation/, apps/, hardware_bridge/, controller/, learning/, server/).

This is a read-only documentation run. Show launch, setup, probe, calibration, graph-generation, or update commands when relevant; do not execute them. Do not connect to hosts, command actuators, install dependencies, inspect credentials, or create files. If a private registry or generated artifact is missing, say so clearly. Never substitute lab-specific hosts, measurements or credentials from memory.

Give a concise answer (at most 160 words) with: what this command is for, the actual files or entry points you inspected, the next step, and any unavailable functionality. For onboarding, lead with what MABEL is, then the simulation/controller/hardware_bridge/apps/learning roles, the canonical-model rule, and three next commands from this installed pack.
'''
 if p.exists() and p.read_text()!=text:raise SystemExit(f'Existing command must be preserved: {p}')
 p.write_text(text)
for alias in ['onboarding','onboard']:
 p=dest/(alias+'.md');text=(dest/'mabel-onboard.md').read_text()
 if p.exists() and p.read_text()!=text:raise SystemExit(f'Existing alias must be preserved: {p}')
 p.write_text(text)
out=SITE/'assets/harness';out.mkdir(exist_ok=True)
with zipfile.ZipFile(out/'public-command-pack.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in sorted([c['name'] for c in commands]+['onboard','onboarding']):
  p=dest/(name+'.md');z.write(p,str(p.relative_to(ROOT)))
 z.writestr('MABEL-COMMANDS.txt','Portable public-checkout documentation commands. Extract into the public MABEL repository, then open Claude Code there and run /onboarding. These are read-only file-grounded tours; private lab probes and actuation are not included.\n')
print('Installed',len(commands),'public documentation commands + /onboard and /onboarding aliases.')
