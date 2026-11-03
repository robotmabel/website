#!/usr/bin/env python3
"""Every rendered pixel stays inside its card at Retina scale, scroll and resize."""
import asyncio, os
from playwright.async_api import async_playwright
BASE=os.environ.get('MABEL_TEST_URL','http://localhost:8742/')
CHECK=r"""host=>{
 const grid=host.__studioGrid,canvas=grid.renderer.domElement;grid.dirty=true;grid.render();
 const rect=canvas.getBoundingClientRect(),copy=document.createElement('canvas');
 copy.width=Math.ceil(rect.width);copy.height=Math.ceil(rect.height);
 const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,copy.width,copy.height);
 const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;
 const boxes=grid.views.filter(v=>v.visible&&!v.slot.closest('[hidden]')).map(v=>{
   const s=v.slot.getBoundingClientRect(),c=v.clip?.getBoundingClientRect()||rect;
   return {l:Math.max(s.left,rect.left,c.left)-rect.left-1,r:Math.min(s.right,rect.right,c.right)-rect.left+1,
    t:Math.max(s.top,rect.top,c.top)-rect.top-1,b:Math.min(s.bottom,rect.bottom,c.bottom)-rect.top+1};
 });
 let ink=0,escaped=0;for(let y=0;y<copy.height;y++)for(let x=0;x<copy.width;x++){
   if(pixels[(y*copy.width+x)*4+3]<8)continue;ink++;
   if(!boxes.some(b=>x>=b.l&&x<=b.r&&y>=b.t&&y<=b.b))escaped++;
 }
 return {dpr:devicePixelRatio,width:rect.width,height:rect.height,hostWidth:host.clientWidth,
  hostHeight:host.clientHeight,ink,escaped,views:boxes.length,buffer:canvas.width};
}"""
async def check(page,selector):
 host=page.locator(selector).first
 await host.evaluate('(n)=>scrollTo(0,n.getBoundingClientRect().top+scrollY-125)')
 await page.wait_for_function('(s)=>document.querySelector(s)?.__studioGrid?.views.some(v=>v.visible)',arg=selector)
 await page.wait_for_timeout(250)
 print(selector,flush=True)
 result=await host.evaluate(CHECK)
 assert abs(result['width']-result['hostWidth'])<1,result
 assert abs(result['height']-result['hostHeight'])<1,result
 assert result['ink']>200,result
 assert result['escaped']==0,result
 return result
async def main():
 async with async_playwright() as p:
  for engine,width,height,dpr in [('chromium',1440,1000,2),('webkit',390,844,3)]:
   browser=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if engine=='chromium' else await p.webkit.launch(headless=True)
   page=await browser.new_page(viewport={'width':width,'height':height},device_scale_factor=dpr,reduced_motion='reduce')
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(BASE+'hardware.html',wait_until='domcontentloaded')
   await check(page,'#hwSlider')
   for i in range(8):
    await page.locator('.hs-card').nth(i).evaluate('(n)=>n.scrollIntoView({block:"nearest",inline:"center"})')
    await page.wait_for_function('(i)=>document.querySelectorAll(".hs-card")[i].querySelector(".studio-ready")',arg=i)
    await check(page,'#hwSlider')
   await page.set_viewport_size({'width':width-30,'height':height-40});await check(page,'#hwSlider')
   await check(page,'#baseOdometry .base-replay')
   await page.screenshot(path=f'/tmp/mabel-retina-odom-{engine}.png',scale='css')
   await page.goto(BASE+'software.html',wait_until='domcontentloaded')
   await page.locator('#retargeting').evaluate('(n)=>scrollTo(0,n.getBoundingClientRect().top+scrollY-125)')
   await check(page,'#retargetClips .replay-grid')
   await page.locator('.replay-methods input[value="abs"]').check();await page.wait_for_function('__retargetStudio.records().length===4')
   await check(page,'#retargetClips .replay-grid')
   await page.screenshot(path=f'/tmp/mabel-retina-retarget-{engine}.png',scale='css')
   await check(page,'#tipLab')
   assert not errors,errors
   print(engine,'DPR',dpr,'all eight hardware cards, odometry, retargeting and motion: no pixels outside card bounds',flush=True)
   await browser.close()
asyncio.run(main())
