#!/usr/bin/env python3
"""Main overview content remains visible in vertical flow on desktop and phones."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/')
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if engine=='chromium' else p.webkit.launch(headless=True)
  for width,height in [(1440,1000),(390,844)]:
   page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(BASE,wait_until='domcontentloaded');page.wait_for_function('window.__overviewScenes && window.__learningExplorer');page.wait_for_selector('.dg-card')
   assert page.locator('.ov-rail-controls').count()==0
   assert page.locator('.hero-path svg,.hero-path img').count()==0
   assert page.locator('#rgGrid .rg-lead h3').all_text_contents()==['Shop','Home','Street']
   assert page.locator('#rgGrid figure.rg-cell').count()==31
   assert page.locator('#rgGrid .rg-line').count()==8
   tiles=page.locator('#rgGrid .rg-cell').evaluate_all("es=>es.map(e=>{let r=e.getBoundingClientRect();return {w:r.width,h:r.height}})")
   assert len({round(t['w']) for t in tiles})>1 if width>760 else len({round(t['h']) for t in tiles})>2
   assert page.locator('#rgGrid .rg-lead h3').evaluate_all('es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)')
   assert 'Jost' in page.locator('.ov-nav a').first.evaluate('e=>getComputedStyle(e).fontFamily')
   assert page.locator('#demo .dg-card').count()==12
   assert page.locator('#demo .dg-grid').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
   for chapter in ['story','home','paper','anatomy','demo','play','architecture','learning']:
    page.locator('.ov-nav a[href="#'+chapter+'"]').click();page.wait_for_timeout(450)
    bounds=page.locator('#'+chapter).evaluate("e=>({top:e.querySelector('h2').getBoundingClientRect().top,nav:document.querySelector('.ov-nav').getBoundingClientRect().bottom})")
    assert bounds['top']>=bounds['nav']-1,(engine,width,chapter,bounds)
   assert page.locator('#learning [data-learning-dataset]').count()==0
   assert page.locator('#learning .lp-process li').count()==4
   assert page.locator('#play .ov-details').count()==0
   assert page.locator('#simStage').evaluate('e=>e.getBoundingClientRect().top<document.querySelector("#play .ov-two").getBoundingClientRect().top')
   assert 'Jost' in page.locator('.lp-node b').first.evaluate('e=>getComputedStyle(e).fontFamily')
   assert page.locator('#learning .lp-node b').first.evaluate('e=>getComputedStyle(e).fontWeight') in ['650','700']
   page.locator('.ov-nav a[href="#home"]').click();page.wait_for_timeout(500)
   page.wait_for_function("[...document.querySelectorAll('#rgGrid video')].some(v=>!v.paused&&v.readyState>=2&&v.loop&&v.muted)",timeout=30000)
   assert page.locator('#home').evaluate('e=>e.getBoundingClientRect().height>innerHeight')
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
   for chapter in ['home','demo','learning']:
    page.locator('.ov-nav a[href="#'+chapter+'"]').click();page.wait_for_timeout(350);page.screenshot(path=f'/tmp/mabel-vertical-{chapter}-{engine}-{width}.png')
   if width==1440:
    for resized in (320,760,761,1280):
     page.set_viewport_size({'width':resized,'height':844});page.wait_for_timeout(250)
     assert page.locator('.rg-chap').evaluate_all('chs=>chs.every(ch=>{let rs=[...ch.querySelectorAll(".rg-cell")].map(e=>e.getBoundingClientRect());return rs.every((a,i)=>rs.every((b,j)=>i===j||a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1))})'),(engine,resized,'Mosaic overlap after resize')
   print(engine,width,'vertical content, all photo/demo grids, aligned headings, simpler learning, autoplay and clean hero: PASS',flush=True);page.close()
  browser.close()
 print('RESULT: PASS')
