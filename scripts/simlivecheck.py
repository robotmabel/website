#!/usr/bin/env python3
"""Opt-in live SIM regression: two visitors, movement, home reset and handoff.

Uses the dedicated public SIM endpoint through the website. Never touches real
robot routes. Run only while the queue is empty: python scripts/simlivecheck.py --live
"""
import argparse,math,os
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--live',action='store_true');args=ap.parse_args();assert args.live,'Live opt-in required'
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/')
SNAP="""()=>{let a=window.__ta,s=a.sim.state;return {x:s.bx,y:s.by,lift:a.sim.lift,stop:a.estop,role:a.simSession.role}}"""
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']);pages=[];frames=[]
 try:
  for width,height in [(1440,1000),(390,844)]:
   page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce');pages.append(page);page.goto(BASE,wait_until='domcontentloaded');page.wait_for_function('window.__overviewScenes');page.locator('.ov-nav a[href="#play"]').click();frame=page.frame_locator('#simStage iframe');frame.locator('.sim-queue-join').wait_for();f=page.frames[-1];frames.append((frame,f))
   f.wait_for_function('window.__ta?.simSession.ready&&window.__ta.sim.remote',timeout=45000)
   assert f.evaluate('window.__ta.simSession.ahead')==0,'Queue is in use; do not interrupt another visitor'
  first,second=frames
  pages[0].bring_to_front();first[0].locator('.sim-queue-join').click();first[1].wait_for_function('window.__ta.simSession.driver&&!window.__ta.estop')
  second[0].locator('.sim-queue-join').click();second[1].wait_for_function("window.__ta.simSession.role==='waiting'&&window.__ta.simSession.ahead===1")
  assert 'wait' in second[0].locator('.sim-session-estimate').inner_text();assert second[0].locator('#taReset').is_hidden()
  pages[0].bring_to_front();pages[0].wait_for_timeout(400)
  home=first[1].evaluate(SNAP)
  def drag(joy,offset,ms):
   r=first[0].locator('[data-joy="'+joy+'"]').bounding_box();x=r['x']+r['width']/2;y=r['y']+r['height']/2
   pages[0].mouse.move(x,y);pages[0].mouse.down();pages[0].mouse.move(x,y-offset,steps=5);pages[0].wait_for_timeout(ms);pages[0].mouse.up();pages[0].wait_for_timeout(700)
  drag('navL',25,1100);moved=first[1].evaluate(SNAP);distance=math.hypot(moved['x']-home['x'],moved['y']-home['y']);assert distance>.1,(home,moved)
  drag('navR',22,1000);raised=first[1].evaluate(SNAP);assert abs(raised['lift']-home['lift'])>.025,(home,raised)
  first[0].locator('#taReset').click();pages[0].wait_for_timeout(2000);reset=first[1].evaluate(SNAP)
  print('Live base motion',round(distance,3),'m; lift',round(raised['lift'],3),'m; reset',reset,flush=True)
  assert math.hypot(reset['x'],reset['y'])<.025 and abs(reset['lift']-.3175)<.015,'Reset must restore the server home pose, including lift'
  first[0].locator('#taEstop').click();first[1].wait_for_function('window.__ta.estop');second[1].wait_for_function('window.__ta.estop')
  assert second[0].locator('#taEstop').is_disabled(),'Waiting viewers cannot release a stop'
  first[0].locator('.sim-queue-join').click();second[1].wait_for_function('window.__ta.simSession.driver&&!window.__ta.estop')
  assert second[1].evaluate('window.__ta.simSession.remaining')>=115
  first[1].wait_for_function("window.__ta.simSession.role==='viewer'")
  assert first[0].locator('.sim-queue-join').inner_text()=='Join queue'
  second[0].locator('.sim-queue-join').click();second[1].wait_for_function("window.__ta.simSession.role==='viewer'")
  print('Two visitors: real pointer controls, wait estimate, authoritative stop, Reset home, End turn and fresh two-minute handoff: PASS',flush=True)
 finally:
  for page in pages:page.close()
  browser.close()
print('RESULT: PASS')
