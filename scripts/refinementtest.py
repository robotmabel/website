#!/usr/bin/env python3
"""Exercise the paper-guided overview refinements in WebKit, desktop and phone."""
from pathlib import Path
import sys,json
from playwright.sync_api import sync_playwright
BASE=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8742').rstrip('/')
def snap(page,selector,name):
 page.locator(selector).evaluate('(e)=>e.scrollIntoView({block:"start",behavior:"instant"})');page.wait_for_timeout(500);page.screenshot(path='/tmp/mabel-'+name+'.png')
with sync_playwright() as p:
 browser=p.webkit.launch(headless=True)
 for width in [1440,390]:
  page=browser.new_page(viewport=dict(width=width,height=1000 if width>500 else 844))
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'/index.html',wait_until='domcontentloaded')
  page.wait_for_function('window.__learningExplorer !== undefined')
  assert page.locator('.ov-scroll-rail').is_hidden()
  assert page.locator('#photos-street video[data-lazyvid^="assets/demos/"]').count()==4
  assert page.locator('.dg-card').count()==12
  page.locator('#learning').scroll_into_view_if_needed()
  page.locator('[data-learn="train"]').click()
  assert 'ACT policy' in page.locator('#learningDetail').inner_text()
  page.locator('[data-camera="right"]').click()
  assert 'right wrist' in page.locator('#learningDetail').inner_text().lower()
  page.locator('#lpStep').evaluate('(e)=>{e.value=119;e.dispatchEvent(new Event("input",{bubbles:true}));}')
  assert '120 / 120' in page.locator('#lpStepReadout').inner_text()
  assert page.locator('#lpChunkCells > *').count()==120
  assert '68,364' in page.locator('[data-learning-dataset]').inner_text()
  page.locator('[data-split=val]').click()
  assert '7,725' in page.locator('.lp-split-stats').inner_text()
  page.locator('[data-split=test]').click()
  assert '5,989' in page.locator('.lp-split-stats').inner_text()
  page.locator('[data-split=train]').click()
  assert '53,379' in page.locator('.lp-split-stats').inner_text()
  page.locator('[data-target="sim"]').click()
  assert 'simulation' in page.locator('#lpTargetLabel').inner_text().lower()
  assert page.locator('#lpStateGroups button').count()==6
  snap(page,'#learning','learning-final-'+str(width))
  page.locator('.dg-card').first.scroll_into_view_if_needed();page.wait_for_timeout(1800)
  clip=page.locator('.dg-card video').first
  clip.evaluate('(v)=>v.play()');page.wait_for_timeout(500)
  assert clip.evaluate('(v)=>v.readyState>=2 && !v.paused && v.currentTime>0 && v.loop'),clip.evaluate('(v)=>[v.readyState,v.paused,v.currentTime,v.error]')
  page.locator('.dg-card .dg-toggle').first.click()
  assert clip.evaluate('(v)=>v.paused'),'Demo pause control did not pause'
  page.locator('.dg-card .dg-toggle').first.click()
  page.wait_for_timeout(100)
  assert clip.evaluate('(v)=>!v.paused'),'Demo play control did not resume'
  snap(page,'.dg-collection','demos-'+str(width))
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('index overflow',width)
  if width<500:
   assert page.locator('#heroRig').evaluate('(e)=>e.classList.contains("hero-rig-mini") || e.classList.contains("mini")'),page.locator('#heroRig').get_attribute('class')
  page.goto(BASE+'/harness.html',wait_until='domcontentloaded')
  page.wait_for_function('window.__harnessWalkthrough !== undefined')
  assert page.locator('#harnessWalkthrough option').count()==25
  video=page.locator('#harnessWalkthrough video');video.scroll_into_view_if_needed();video.evaluate('(v)=>v.play()');page.wait_for_timeout(1200)
  assert video.evaluate('(v)=>v.readyState>=2 && !v.paused && v.currentTime>0')
  page.locator('#harnessWalkthrough select').select_option('2');page.wait_for_timeout(300)
  assert page.locator('[data-hw-command]').inner_text()=='/mabel-map'
  video.evaluate('(v)=>{v.currentTime=24;v.dispatchEvent(new Event("timeupdate"));}')
  assert page.locator('[data-hw-command]').inner_text()=='/mabel-help'
  page.locator('[data-hw-next]').click();page.wait_for_timeout(200)
  assert page.locator('[data-hw-command]').inner_text()=='/mabel-map'
  snap(page,'#walkthrough','harness-'+str(width))
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('harness overflow',width)
  page.goto(BASE+'/software.html',wait_until='domcontentloaded')
  assert page.locator('.paper-equations').count()==3
  for selector in ['#controller .paper-equations','#motion .paper-equations','#retargeting .paper-equations']:
   page.locator(selector).evaluate('(e)=>{e.classList.remove("fade-up");e.style.opacity=1;e.scrollIntoView({block:"start",behavior:"instant"});}')
   if selector.startswith('#retargeting'):page.locator(selector+' summary').click()
   assert page.locator(selector).evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(selector,width)
  snap(page,'#retargeting .paper-equations','math-'+str(width))
  page.goto(BASE+'/teleop.html',wait_until='domcontentloaded')
  page.wait_for_selector('.dg-card');assert page.locator('.dg-card').count()==12
  page.wait_for_selector('#latencyBars .lb-row')
  assert '137' in page.locator('#latencyBars').inner_text() and '150' in page.locator('#latencyBars').inner_text() and '161' in page.locator('#latencyBars').inner_text() and '260' in page.locator('#latencyBars').inner_text()
  assert not errors,errors
  print(width,'learning, Sony grid, real video playback, 25 replay chapters, math layout, latency: PASS',flush=True)
  page.close()
 browser.close()
print('RESULT: PASS',flush=True)
