#!/usr/bin/env python3
"""Render a replay from captured Claude Code visible output, with timed explanations.

python3 scripts/build_harness_recording.py --recordings /path/to/captured-json
Private model reasoning and raw tool results are never included. The rendered
replay condenses waiting time and retains the actual commands and answers.
"""
from pathlib import Path
import argparse,json,textwrap,subprocess,re,tempfile
from PIL import Image,ImageDraw,ImageFont
SITE=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--recordings',type=Path,required=True);args=ap.parse_args();metadata=json.loads((SITE/'assets/data/harness.json').read_text());commands=[c for g in metadata['groups'] for c in g['commands']];commands.sort(key=lambda c:0 if c['name']=='mabel-onboard' else 1)
 out=SITE/'assets/harness';out.mkdir(exist_ok=True);frames=Path(tempfile.mkdtemp(prefix='mabel-cli-frames-'));fontpath='/System/Library/Fonts/Menlo.ttc'
 font=ImageFont.truetype(fontpath,18);small=ImageFont.truetype(fontpath,15);large=ImageFont.truetype(fontpath,25)
 entries=[];chapters=[];clock=0;index=0
 def sanitize(text):
  text=re.sub(r'(?<!\d)(?:10\.[\d.]+|192\.168\.[\d.]+|100\.(?:[6-9]\d|1[01]\d|12[0-7])\.[\d.]+)(?!\d)','<private host>',text)
  return text.replace('/Users/jerrycheng/Desktop/open_mabel','~/open_mabel')
 def frame(command,lines,answer,duration):
  nonlocal clock,index
  im=Image.new('RGB',(1280,720),(244,234,210));d=ImageDraw.Draw(im);d.rounded_rectangle((23,20,1262,702),radius=16,fill=(21,24,32));d.text((48,38),'CLAUDE CODE  ·  open_mabel  ·  recorded output',font=large,fill=(244,234,210));d.line((45,82,1235,82),fill=(228,68,42),width=3);d.text((48,98),'$ cd ~/open_mabel',font=font,fill=(185,175,152));d.text((48,128),'$ claude -p '+command,font=large,fill=(242,201,76));y=177
  for line in lines[-5:]:
   for wrapped in textwrap.wrap(line,width=112,replace_whitespace=False)[:2]:d.text((50,y),wrapped,font=small,fill=(135,190,155));y+=21
  if answer:
   y+=12;flat=[]
   for paragraph in answer.replace('**','').splitlines():flat+=textwrap.wrap(paragraph,width=112,replace_whitespace=False) or ['']
   for line in flat[:max(1,(650-y)//21)]:d.text((50,y),line,font=font,fill=(244,234,210));y+=21
  d.text((48,674),'Read-only documentation run · waiting time condensed · full response in the transcript',font=small,fill=(185,175,152));p=frames/f'{index:04d}.png';index+=1;im.save(p);entries.append((p,duration));clock+=duration;return p
 for c in commands:
  data=json.loads((args.recordings/(c['name']+'.json')).read_text());start=clock;command=data['command'];lines=[];frame(command,[],'',1)
  events=[];answer='';last=0
  for event in data['events']:
   text=sanitize(event['text']);delta=max(.6,min(1.6,(event['t']-last)/5));last=event['t']
   if event['kind']=='tool':lines.append('› '+text);events.append(dict(at=clock,kind='inspection',text=text));frame(command,lines,'',delta)
   else:answer=text;events.append(dict(at=clock,kind='answer',text=text));frame(command,lines,answer,max(9,min(20,len(text.split())/5)))
  if not answer:frame(command,lines,'No final response was captured. Check the run status in the transcript.',6)
  chapters.append(dict(key=c['name'],command=command,start=round(start,3),end=round(clock,3),purpose=c['purpose'],mode='Read-only public-checkout documentation guide',recording_status=data['status'],events=events,answer=answer,note='Launches, host probes, calibration and generated-vault updates were reviewed, not executed. The public checkout does not include the private lab registry.'))
 concat=frames/'frames.txt';concat.write_text(''.join("file '%s'\nduration %.3f\n"%(p,duration) for p,duration in entries)+"file '%s'\n"%entries[-1][0])
 subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',str(concat),'-an','-r','12','-c:v','libx264','-preset','fast','-profile:v','baseline','-level:v','3.1','-crf','24','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'claude-code-walkthrough.mp4')],check=True)
 Image.open(entries[0][0]).convert('RGB').save(out/'claude-code-walkthrough.jpg',quality=85)
 public=dict(recorded='2026-11-02',title='Claude Code in the public open_mabel checkout',method='Actual Claude Code CLI visible messages and source-inspection calls; rendered as a condensed terminal replay. No private model reasoning or raw tool results are included.',duration=round(clock,3),video='assets/harness/claude-code-walkthrough.mp4',poster='assets/harness/claude-code-walkthrough.jpg',chapters=chapters)
 (SITE/'assets/data/harness-recording.json').write_text(json.dumps(public,indent=2)+'\n');print(len(chapters),'recorded command chapters;',round(clock),'seconds of condensed replay',flush=True)
if __name__=='__main__':main()
