from playwright.sync_api import sync_playwright
import os
BASE=os.environ.get("MABEL_TEST_URL","http://localhost:8742/")
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal'])
 for width,height in [(1440,1000),(320,780)]:
  page=b.new_page(viewport={'width':width,'height':height},reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE);page.wait_for_function('window.__overviewScenes');page.locator('.ov-nav a[href="#play"]').click();f=page.frame_locator('#simStage iframe');f.locator('.sim-queue-join').wait_for();frame=page.frames[-1];frame.wait_for_function('window.__ta?.simSession.seen')
  frame.evaluate('window.fixtureQueue=window.__ta.simSession.receive;window.__ta.simSession.receive=()=>{}')
  frame.evaluate("window.fixtureQueue({role:'waiting',backend_ready:true,position:2,people_ahead:2,estimated_wait_seconds:190,remaining_seconds:0})")
  assert '2 people ahead' in f.locator('.sim-session-info').inner_text();assert '~4 min wait' in f.locator('.sim-session-info').inner_text();assert f.locator('.sim-queue-join').inner_text()=='Leave queue';assert f.locator('#taReset').is_hidden()
  frame.evaluate("window.fixtureQueue({role:'driver',backend_ready:true,position:null,people_ahead:0,estimated_wait_seconds:0,remaining_seconds:120})")
  assert 'Your turn' in f.locator('.sim-session-info').inner_text();assert 'left' in f.locator('.sim-session-estimate').inner_text();assert f.locator('#taReset').is_visible();assert not f.locator('#taReset').is_disabled()
  frame.evaluate("window.fixtureQueue({role:'waiting',backend_ready:false,position:1,people_ahead:0,estimated_wait_seconds:null,remaining_seconds:0})")
  assert 'First in queue' in f.locator('.sim-session-info').inner_text();assert 'place held' in f.locator('.sim-session-estimate').inner_text();assert not frame.evaluate('window.__ta.flying')
  bounds=frame.evaluate("()=>{let d=document.querySelector('.ta-dock').getBoundingClientRect();return {left:d.left,right:d.right,bottom:d.bottom,width:innerWidth,height:innerHeight}}")
  assert bounds['left']>=0 and bounds['right']<=bounds['width']+1 and bounds['bottom']<=bounds['height']+1,bounds
  assert not errors,errors;page.screenshot(path=f'/tmp/mabel-queue-eta-{width}.png');print(width,'ahead count, live estimate, grant countdown, offline hold and compact dock: PASS',flush=True);page.close()
 b.close()
