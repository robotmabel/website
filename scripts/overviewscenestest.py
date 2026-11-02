#!/usr/bin/env python3
"""Verify complete overview chapters, horizontal panels and actual video playback."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/')
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if engine=='chromium' else p.webkit.launch(headless=True)
  for width,height in [(1440,1000),(390,844)]:
   page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(BASE,wait_until='domcontentloaded');page.wait_for_function('window.__overviewScenes')
   for chapter in ['story','home','paper','anatomy','demo','play','architecture','learning']:
    page.locator('.ov-nav a[href="#'+chapter+'"]').click();page.wait_for_timeout(700)
    bounds=page.locator('#'+chapter).evaluate("e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,heading:e.querySelector('h2').getBoundingClientRect().top,nav:document.querySelector('.ov-nav').getBoundingClientRect().bottom})")
    assert bounds['heading']>=bounds['nav'],(engine,width,chapter,bounds)
    assert bounds['bottom']<=height+2,(engine,width,chapter,bounds)
   page.locator('.ov-nav a[href="#home"]').click();page.wait_for_timeout(700)
   for tab in ['Shop','Home','Street']:
    page.locator('#rgGrid .ov-rail-tabs button',has_text=tab).click();page.wait_for_timeout(900)
    page.wait_for_function("""()=>{let a=[...document.querySelectorAll('#rgGrid video')].filter(v=>{let r=v.getBoundingClientRect();return r.left>=0&&r.right<innerWidth&&r.top<innerHeight&&r.bottom>150});return a.length&&a.every(v=>v.readyState>=2&&!v.paused&&v.loop&&v.muted)}""",timeout=30000)
    times=page.locator('#rgGrid video').evaluate_all('vs=>vs.map(v=>v.currentTime)');page.wait_for_timeout(500)
    advanced=page.locator('#rgGrid video').evaluate_all('(vs,ts)=>vs.filter((v,i)=>v.currentTime!==ts[i]).length',times);assert advanced>0,(engine,width,tab)
   page.locator('.ov-nav a[href="#learning"]').click();page.wait_for_timeout(750)
   assert 'Bangers' in page.locator('.lp-node b').first.evaluate('e=>getComputedStyle(e).fontFamily')
   page.locator('#learning .ov-rail-tabs button',has_text='Dataset v2').click();page.wait_for_timeout(700)
   page.wait_for_function("document.querySelector('[data-learning-dataset]').textContent.includes('68,364')")
   assert page.locator('#learning [data-split="test"]').is_visible();page.locator('#learning [data-split="test"]').click();assert '5,989' in page.locator('#learning .lp-split-stats').inner_text()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors,errors
   print(engine,width,'complete chapters, gallery autoplay/loops, consistent learning fonts and dataset interaction: PASS',flush=True);page.close()
  browser.close()
 print('RESULT: PASS')
