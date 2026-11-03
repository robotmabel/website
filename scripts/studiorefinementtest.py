#!/usr/bin/env python3
"""Verify the current 3D views, recorded workflows and responsive layout."""
import asyncio,os
from playwright.async_api import async_playwright
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/')
async def scroll(page,selector):
 await page.locator(selector).first.evaluate('(n)=>scrollTo(0,n.getBoundingClientRect().top+scrollY-125)');await page.wait_for_timeout(600)
async def main():
 async with async_playwright() as p:
  for engine,width,height in [('chromium',1440,1000),('webkit',390,844)]:
   browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if engine=='chromium' else await p.webkit.launch(headless=True)
   page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(BASE+'software.html',wait_until='domcontentloaded');await scroll(page,'#retargeting');await page.wait_for_function('window.__retargetStudio?.records().length===3');await page.wait_for_timeout(700)
   time=await page.evaluate('__retargetStudio.time()');await page.wait_for_timeout(500);assert await page.evaluate('__retargetStudio.time()')!=time
   assert await page.locator('#retargetCompare table').count()==0
   assert await page.locator('.retarget-facts>div').count()==3
   assert await page.locator('.replay-methods').inner_text() and 'Frozen fingers' in await page.locator('.replay-methods').inner_text()
   await page.locator('[data-episode]').select_option('91');await page.wait_for_function('__retargetStudio.records().every(r=>r.data.episode===91)')
   await page.locator('.replay-methods input[value="abs"]').check();await page.wait_for_function('__retargetStudio.records().length===4')
   await page.locator('[data-play]').click();slot=page.locator('.rk-stage').first;await slot.locator('.studio-recenter').click();before=await page.evaluate('__retargetStudio.grid.views[0].camera.position.toArray()');await slot.focus();await page.keyboard.press('ArrowRight');after=await page.evaluate('__retargetStudio.grid.views[0].camera.position.toArray()');assert before!=after
   await slot.locator('.studio-recenter').click();reset=await page.evaluate('__retargetStudio.grid.views[0].camera.position.toArray()');assert sum(abs(a-b) for a,b in zip(reset,before))<.05
   rect=await slot.bounding_box();await page.mouse.move(rect['x']+rect['width']*.45,rect['y']+rect['height']*.4);await page.mouse.down();await page.mouse.move(rect['x']+rect['width']*.65,rect['y']+rect['height']*.5,steps=6);await page.mouse.up();dragged=await page.evaluate('__retargetStudio.grid.views[0].camera.position.toArray()');assert dragged!=reset
   await page.screenshot(path=f'/tmp/mabel-3d-compare-{engine}.png')
   await scroll(page,'#motion');await page.wait_for_function('window.__motionPhysics');await page.wait_for_timeout(800);a=await page.locator('[data-speed]').inner_text();await page.wait_for_timeout(1200);assert await page.evaluate('__motionPhysics.grid.views[0].object.children.length')>0
   await scroll(page,'[data-walk="setup-studio"]');await page.wait_for_function('document.querySelector("[data-walk=setup-studio] video").readyState>=2');v=page.locator('[data-walk="setup-studio"] video');assert await v.evaluate('v=>v.videoWidth===1280&&v.loop&&v.muted');assert await page.locator('.setup-pin').count()==4
   await page.locator('[data-walk="setup-studio"] [data-walk-at="10"]').click();await page.wait_for_timeout(200);assert await v.evaluate('v=>v.currentTime>=10')
   assert await page.locator('[data-walk="setup-studio"] [data-walk-title]').inner_text()=='Joint details'
   await page.screenshot(path=f'/tmp/mabel-setup-{engine}.png');assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await page.goto(BASE+'hardware.html',wait_until='domcontentloaded');await scroll(page,'#hwSlider');await page.wait_for_function('document.querySelector(".hs-shot.studio-ready")');await page.wait_for_timeout(300)
   # Every card resolves real geometry as it becomes visible.
   for i in range(8):
    await page.locator('.hs-card').nth(i).evaluate('(n)=>n.scrollIntoView({block:"nearest",inline:"center"})');await page.wait_for_function(f'document.querySelectorAll(".hs-card")[{i}].querySelector(".studio-ready")');assert await page.locator('.hs-card').nth(i).locator('.studio-recenter').count()==1
   grid='document.getElementById("hwSlider").__studioGrid';assert await page.evaluate(grid+'.views.every(v=>v.object.children.length>0)')
   await scroll(page,'.al-panel');await page.wait_for_function('document.querySelector(".al-clip video")?.currentTime>0');assert await page.locator('.al-grid>.al-panel').nth(1).get_attribute('id')=='baseOdometry'
   if width>760:
    rect=await page.locator('.al-panel').first.evaluate('(n)=>{let a=n.querySelector("video").getBoundingClientRect(),b=n.querySelector(".al-plots").getBoundingClientRect();return {y:Math.abs(a.top-b.top),bottom:Math.max(a.bottom,b.bottom)}}');assert rect['y']<3 and rect['bottom']<height,rect
   await scroll(page,'#baseOdometry');await page.wait_for_function('document.getElementById("baseOdometry").__baseReplay?.time>0');await page.screenshot(path=f'/tmp/mabel-odom-{engine}.png')
   await page.goto(BASE+'autonomy.html',wait_until='domcontentloaded');assert await page.locator('#contribute').count()==0;assert await page.locator('img[src*="assets/studio/"]').count()==0;assert await page.locator('.studio-workspace').count()==2
   await page.goto(BASE+'harness.html',wait_until='domcontentloaded');assert await page.locator('#harnessWalkthrough').count()==1;assert await page.locator('#surface details').count()==1
   assert not errors,errors;print(engine,width,'3D geometry, synchronized clock, episode selection, orbit/recenter, recorded setup, compact tests, cleaned pages: PASS',flush=True);await browser.close()
asyncio.run(main())
