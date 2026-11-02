#!/usr/bin/env python3
"""Capture visible Claude Code source-tour output for the website replay.

Run after build_public_command_pack.py. Captures remain local until the renderer
selects visible messages for publication. This command runs Claude Code using
the user's configured account; it does not execute the suggested lab actions.
"""
import argparse,json,subprocess,time,re,shutil
from pathlib import Path
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--checkout',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
ROOT=args.checkout.resolve();OUT=args.output.resolve();OUT.mkdir(parents=True,exist_ok=True)
metadata=json.loads((Path(__file__).resolve().parents[1]/'assets/data/harness.json').read_text());rows=[c for g in metadata['groups'] for c in g['commands']];rows.sort(key=lambda c:0 if c['name']=='mabel-onboard' else 1)
for number,row in enumerate(rows):
 key=row['name'];command='/onboarding' if key=='mabel-onboard' else '/'+key
 target=OUT/(key+'.json');raw=OUT/(key+'.jsonl')
 if target.exists():continue
 args=[shutil.which('claude') or 'claude','-p',command,'--permission-mode','plan','--tools','Read,Glob,Grep,Bash','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--max-turns','8','--max-budget-usd','0.85','--no-session-persistence','--output-format','stream-json','--verbose','--append-system-prompt','Record a concise, read-only public-repository documentation walkthrough. Do not spawn agents. Do not read any credentials, environment files or files outside this checkout. Do not execute setup, networking or hardware commands. Answer within 160 words.']
 start=time.monotonic();events=[];result=None
 with raw.open('w') as f:
  process=subprocess.Popen(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
  for line in process.stdout:
   f.write(line);f.flush()
   try:msg=json.loads(line)
   except:continue
   at=round(time.monotonic()-start,2)
   if msg.get('type')=='assistant':
    for part in msg.get('message',{}).get('content',[]):
     if part.get('type')=='text':events.append(dict(t=at,kind='answer',text=part['text']))
     elif part.get('type')=='tool_use':
      inp=part.get('input',{});text=part.get('name','Tool')+' '+str(inp.get('file_path') or inp.get('path') or inp.get('pattern') or inp.get('command') or '')
      events.append(dict(t=at,kind='tool',text=text))
   if msg.get('type')=='result':result=msg
  process.wait()
 def clean(s):
  s=s.replace(str(ROOT),'~/open_mabel');s=re.sub(r'/Users/[^/\s]+/[^\s`]+','<local path>',s);s=re.sub(r'(?i)(?:api[_-]?key|token|password)\s*[:=]\s*[\w.-]{12,}','[redacted]',s);return s
 for event in events:event['text']=clean(event['text'])
 data=dict(command=command,key=key,purpose=row['purpose'],safety=row['safety'],mode='Read-only public-checkout guide',duration=round(time.monotonic()-start,2),exit_code=process.returncode,status=(result or {}).get('subtype','no_result'),events=events)
 target.write_text(json.dumps(data,indent=2)+'\n');print(f'{number+1}/{len(rows)} {command}: {data["status"]}, {len(events)} visible events',flush=True)
