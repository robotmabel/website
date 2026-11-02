#!/usr/bin/env python3
"""Check the shared reading rail on every content page, desktop and phone."""
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright
SITE=Path(__file__).resolve().parents[1]
BASE=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8742').rstrip('/')
pages=[str(p.relative_to(SITE)) for p in sorted(SITE.glob('*.html'))+sorted((SITE/'docs').glob('*.html')) if p.name not in ['build.html','google58ba9b81364f27d9.html']]
with sync_playwright() as p:
 browser=p.webkit.launch(headless=True)
 page=browser.new_page()
 for width in [1440,390]:
  page.set_viewport_size(dict(width=width,height=900))
  for path in pages:
   page.goto(BASE+'/'+path,wait_until='domcontentloaded')
   page.wait_for_selector('.ov-scroll-rail',state='attached')
   page.wait_for_timeout(150)
   assert page.locator('.ov-scroll-rail').count()==1,path
   if path=='index.html':
    assert page.locator('.ov-scroll-rail').is_hidden(),'Hero should have no reading rail'
    page.locator('#story').evaluate('(e)=>scrollTo(0,e.getBoundingClientRect().top+scrollY-100)')
    page.wait_for_timeout(600)
   rail=page.locator('.ov-scroll-rail');assert rail.is_visible(),path
   count=rail.locator('a').count();assert count>=2,(path,count)
   assert rail.locator('a').evaluate_all('(as)=>as.every(a=>!!document.getElementById(decodeURIComponent(a.hash.slice(1))))'),path
   page.evaluate("document.documentElement.style.scrollBehavior='auto';scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})")
   page.wait_for_timeout(150)
   assert rail.locator('output').evaluate('(e)=>e.value')=='100%', (path,rail.locator('output').evaluate('(e)=>e.value'))
   assert rail.locator('a[aria-current]').count()==1,path
   bounds=rail.bounding_box();assert bounds['x']>=0 and bounds['x']+bounds['width']<=width-7,(path,bounds)
   if path!='index.html':
    rail.locator('a').first.click();page.wait_for_timeout(750)
    assert page.evaluate('scrollY')<2,path
   print(width,path,count,'dots: PASS',flush=True)
 page.goto(BASE+'/simulator.html?embed=1&overview=1',wait_until='domcontentloaded')
 assert page.locator('.ov-scroll-rail').count()==0,'Embedded console has a second reading rail'
 browser.close()
print('RESULT: PASS',flush=True)
