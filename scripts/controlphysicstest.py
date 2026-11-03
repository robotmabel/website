#!/usr/bin/env python3
"""Current physics replays and the actual MILO Mac curation recording.

Read-only by default. Live command/queue tests are explicitly opt-in, in
scripts/EXPERIMENTS.md, so routine builds never take a visitor's turn.
"""
import asyncio,os,json
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/').rstrip('/')+'/'
async def scroll(page,selector):await page.locator(selector).evaluate('(n)=>scrollTo(0,n.getBoundingClientRect().top+scrollY-120)')
async def main():
 data=json.loads((Path(__file__).resolve().parents[1]/'assets/data/control-replay.json').read_text())
 assert {c['id'] for c in data['clips']}=={'stiff','soft','gravity','joint','task'}
 for c in data['clips']:
  frames=c['frames'];assert len(frames)>50 and frames[0]['time']==0
  assert all(a['time']<b['time'] for a,b in zip(frames,frames[1:]));assert all(len(f['q'])==60 and len(f['base'])==7 for f in frames)
 async with async_playwright() as p:
  for engine,w,h,dpr in [('chromium',1440,1000,2),('webkit',390,844,3)]:
   b=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if engine=='chromium' else await p.webkit.launch(headless=True)
   page=await b.new_page(viewport={'width':w,'height':h},device_scale_factor=dpr,reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(BASE+'software.html',wait_until='domcontentloaded');await scroll(page,'#wholeBodyLab');await page.wait_for_function('window.__controlPhysics?.state')
   for c in data['clips']:
    await page.locator('#wholeBodyLab [data-clip]').select_option(c['id']);await page.wait_for_timeout(180);assert await page.locator('#wholeBodyLab [data-law-label]').inner_text()==c['label']
   await page.locator('#wholeBodyLab [data-clip]').select_option('stiff');await page.wait_for_timeout(700)
   slot=page.locator('.control-stage');before=await page.evaluate('__controlPhysics.grid.views[0].camera.position.toArray()');await slot.focus();await page.keyboard.press('ArrowRight');assert await page.evaluate('__controlPhysics.grid.views[0].camera.position.toArray()')!=before
   await slot.locator('.studio-recenter').click();await page.screenshot(path=f'/tmp/mabel-control-current-{engine}.png',scale='css')
   await scroll(page,'#tipLab');await page.wait_for_function('window.__motionPhysics');assert await page.evaluate('!__motionPhysics.grid.views[0].controls.enableRotate&&!__motionPhysics.grid.views[0].controls.enablePan')
   await page.goto(BASE+'autonomy.html',wait_until='domcontentloaded');assert await page.locator('a[href*="studio.mabelrobot.duckdns.org"]').count()==0
   await scroll(page,'#curation');video=page.locator('.milo-curation-recording video');await page.wait_for_function('document.querySelector(".milo-curation-recording video").currentTime>0.2');t=await video.evaluate('v=>v.currentTime');await page.wait_for_timeout(700);assert await video.evaluate('v=>v.currentTime')>t
   meta=await video.evaluate('v=>({muted:v.muted,loop:v.loop,width:v.videoWidth,height:v.videoHeight,src:v.currentSrc})');assert meta['muted'] and meta['loop'] and meta['width']>=720 and meta['height']>400,meta;assert await page.locator('.milo-curation-recording figcaption').inner_text()=='MILO Curation · Mac app'
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
   print(engine,'control presets, orbit/recenter, fixed motion camera, current Mac curation playback: PASS',flush=True);await b.close()
 print('RESULT: PASS')
asyncio.run(main())
