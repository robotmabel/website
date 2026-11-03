#!/usr/bin/env python3
"""Recorded ACT camera inputs move together, including after buffering and looping."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/')
STATE="""()=>[...document.querySelectorAll('.lp-cameras video')].map(v=>({time:v.currentTime,paused:v.paused,ready:v.readyState,duration:v.duration,w:v.videoWidth,h:v.videoHeight,muted:v.muted,loop:v.loop}))"""
PIXELS="""()=>[...document.querySelectorAll('.lp-cameras video')].map(v=>{let c=document.createElement('canvas');c.width=32;c.height=24;let x=c.getContext('2d');x.drawImage(v,0,0,32,24);return [...x.getImageData(0,0,32,24).data].reduce((h,n)=>(Math.imul(h,31)+n)|0,0)})"""
with sync_playwright() as p:
 for engine,width,height in [('chromium',1440,1000),('webkit',390,844)]:
  browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if engine=='chromium' else p.webkit.launch(headless=True)
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE,wait_until='domcontentloaded');page.wait_for_function('window.__learningExplorer')
  assert page.locator('.lp-camera video').count()==3
  assert page.locator('.lp-camera video').evaluate_all('vs=>vs.every(v=>!v.getAttribute("src"))'),'Camera clips must not load on the cover'
  page.locator('.ov-nav a[href="#learning"]').click();page.bring_to_front()
  page.wait_for_function('[...document.querySelectorAll(".lp-camera video")].every(v=>!v.paused&&v.readyState>=3&&v.currentTime>.4)',timeout=30000)
  first=page.evaluate(PIXELS);page.wait_for_timeout(1600);second=page.evaluate(PIXELS);assert all(a!=b for a,b in zip(first,second)),'Each camera must show moving images'
  values=page.evaluate(STATE);assert all(v['muted'] and v['loop'] and v['w']==320 and v['h']==240 for v in values),values
  assert len({round(v['duration'],3) for v in values})==1
  drift=page.evaluate("""()=>new Promise(resolve=>{let max=0,start=performance.now();function tick(){let vs=[...document.querySelectorAll('.lp-camera video')],t=vs.map(v=>v.currentTime);max=Math.max(max,Math.max(...t)-Math.min(...t));if(performance.now()-start>900)resolve(max);else requestAnimationFrame(tick)}tick()})""")
  assert drift<.12,('Camera drift',drift)
  page.evaluate('let v=document.querySelector(".lp-camera video");v.currentTime=v.duration-.5')
  page.wait_for_function('[...document.querySelectorAll(".lp-camera video")].every(v=>v.currentTime<2&&!v.paused)',timeout=7000)
  page.wait_for_timeout(500);values=page.evaluate(STATE);assert max(v['time'] for v in values)-min(v['time'] for v in values)<.12,values
  page.locator('.lp-camera[data-camera="left"]').click();assert 'synchronized' in page.locator('#learningDetail').inner_text()
  page.locator('.ov-nav a[href="#story"]').click();page.wait_for_timeout(700);assert all(v['paused'] for v in page.evaluate(STATE))
  page.locator('.ov-nav a[href="#learning"]').click();page.wait_for_function('[...document.querySelectorAll(".lp-camera video")].every(v=>!v.paused&&v.readyState>=3)',timeout=15000)
  assert not errors,errors;page.screenshot(path=f'/tmp/mabel-learning-cameras-{engine}.png');print(engine,'deferred loading, all three moving, synchronized loop, inspect and resume: PASS',flush=True)
  page.close();browser.close()
print('RESULT: PASS')
