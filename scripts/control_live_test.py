#!/usr/bin/env python3
import asyncio,json,argparse
from playwright.async_api import async_playwright
parser=argparse.ArgumentParser(description='Explicit live MuJoCo queue and browser interaction test. Takes two short turns.');parser.add_argument('--page',required=True);BASE=parser.parse_args().page
async def main():
 async with async_playwright() as p:
  for name in ['chromium','webkit']:
   b=await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True,args=['--use-angle=metal']) if name=='chromium' else await p.webkit.launch(headless=True)
   pg=await b.new_page(viewport={'width':1440,'height':1000},device_scale_factor=2);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));await pg.goto(BASE);await pg.locator('#controller').evaluate('(n)=>scrollTo(0,n.getBoundingClientRect().top+scrollY-100)');await pg.wait_for_function('window.__controlPhysics?.state');await pg.wait_for_timeout(800)
   await pg.screenshot(path='/tmp/mabel-control-'+name+'.png',scale='css');await pg.locator('#wholeBodyLab [data-live]').click();await pg.get_by_role('button',name='Start my turn',exact=True).last.click();await pg.wait_for_function('__controlPhysics.link.driver&&__controlPhysics.state.mode==="control"');await pg.wait_for_timeout(500)
   await pg.locator('#wholeBodyLab [data-space="joint"]').click();await pg.wait_for_timeout(300);q0=await pg.evaluate('__controlPhysics.state.q[15]');await pg.locator('[data-joint-angle]').fill('75');await pg.locator('[data-joint-angle]').dispatch_event('input');await pg.wait_for_timeout(1500);assert abs(await pg.evaluate('__controlPhysics.state.q[15]')-q0)>.025
   await pg.locator('#wholeBodyLab [data-space="task"]').click();await pg.wait_for_timeout(300);z0=await pg.evaluate('__controlPhysics.state.control.palms.left[2]');await pg.locator('#wholeBodyLab [data-offset="2"]').fill('0.06');await pg.locator('#wholeBodyLab [data-offset="2"]').dispatch_event('input');await pg.wait_for_timeout(3500);assert await pg.evaluate('__controlPhysics.state.control.palms.left[2]')-z0>.025
   print(name,'measured joint and task-space movement: PASS',flush=True)
   await pg.locator('#wholeBodyLab [data-space="force"]').click();await pg.wait_for_timeout(250)
   point=await pg.evaluate("""()=>{const S=__controlPhysics,n=S.rig.raw.getObjectByName('left_palm');let mesh;n.traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});mesh.geometry.computeBoundingBox();let v=mesh.geometry.boundingBox.getCenter(S.rig.model.position.clone());mesh.localToWorld(v);v.project(S.grid.views[0].camera);let r=document.querySelector('.control-stage').getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}""")
   await pg.mouse.move(point['x'],point['y']);await pg.mouse.down();await pg.mouse.move(point['x']+65,point['y']-25,steps=8);await pg.wait_for_timeout(300);assert await pg.evaluate('__controlPhysics.state.control.force')>1,'Dragging the palm did not apply force';await pg.mouse.up();await pg.wait_for_timeout(300);assert await pg.evaluate('__controlPhysics.state.control.force')==0
   await pg.locator('#wholeBodyLab [data-region]').select_option('whole_body');await pg.locator('#wholeBodyLab [data-law="gravity"]').click();await pg.wait_for_function('__controlPhysics.state.control.law==="gravity"');await pg.locator('#wholeBodyLab [data-push="1"]').hover();await pg.mouse.down();await pg.wait_for_timeout(900);assert await pg.evaluate('__controlPhysics.state.control.force')>15
   await pg.mouse.up();await pg.wait_for_timeout(400);assert await pg.evaluate('__controlPhysics.state.control.force')==0
   await pg.locator('#wholeBodyLab [data-reset]').click();await pg.wait_for_timeout(500);assert await pg.evaluate('Math.abs(__controlPhysics.state.base[0])')<.01
   await pg.get_by_role('button',name='End turn',exact=True).last.click();await pg.wait_for_function('!__controlPhysics.link.driver');assert not errors,errors;print(name,'recorded/live, joint/task targets, direct palm drag, gravity, force/release, reset and end turn: PASS',flush=True);await b.close()
asyncio.run(main())
print('RESULT: PASS')
