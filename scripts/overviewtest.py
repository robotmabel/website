#!/usr/bin/env python3
"""Exercise the Overview's previews, section flow and compact responsive layout.

Checks actual media decoding, playback across a loop boundary, keyboard/touch
access, dismissal, deferred loading and both simulation viewports.
"""
import asyncio, base64, json, random, subprocess, sys, time, urllib.request
from pathlib import Path
import websockets
from _chrome import cleanup_on_exit

BASE = (sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8741').rstrip('/')
PORT = random.randrange(9700,9800)
proc = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless=new',f'--remote-debugging-port={PORT}',f'--user-data-dir=/tmp/cdp-overview-{PORT}','--window-size=1440,1000','--hide-scrollbars','--use-angle=metal','--enable-unsafe-swiftshader','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
cleanup_on_exit(proc)

async def main():
    for _ in range(50):
        try:
            tabs=json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json'));break
        except Exception: await asyncio.sleep(.2)
    ws=next(t['webSocketDebuggerUrl'] for t in tabs if t['type']=='page')
    async with websockets.connect(ws,max_size=None) as c:
        seq=0; requests=[]; errors=[]
        async def cmd(method,params=None):
            nonlocal seq
            seq+=1;n=seq
            await c.send(json.dumps(dict(id=n,method=method,params=params or {})))
            while True:
                r=json.loads(await asyncio.wait_for(c.recv(),60))
                if r.get('method')=='Network.requestWillBeSent':requests.append(r['params']['request']['url'])
                if r.get('method')=='Runtime.exceptionThrown':errors.append(str(r['params']['exceptionDetails']))
                if r.get('id')==n:
                    if 'error' in r:raise AssertionError(r['error'])
                    return r.get('result',{})
        async def ev(expr):
            r=await cmd('Runtime.evaluate',dict(expression=expr,returnByValue=True,awaitPromise=True))
            if r.get('exceptionDetails'):raise AssertionError(r['exceptionDetails'])
            return r.get('result',{}).get('value')
        async def until(expr,seconds=12):
            t=time.monotonic()
            while time.monotonic()-t<seconds:
                val=await ev(expr)
                if val:return val
                await asyncio.sleep(.1)
            raise AssertionError('Timed out: '+expr)
        async def metrics(w,h=1000,touch=False):
            await cmd('Emulation.setDeviceMetricsOverride',dict(width=w,height=h,deviceScaleFactor=1,mobile=touch))
            await cmd('Emulation.setTouchEmulationEnabled',dict(enabled=touch))
            await asyncio.sleep(.2)
        async def point(expr):
            # Let responsive masonry and the sticky header settle before measuring.
            await ev('('+expr+').scrollIntoView({block:"center",behavior:"instant"})')
            await asyncio.sleep(.4)
            return await ev('(()=>{let e='+expr+';e.scrollIntoView({block:"center",behavior:"instant"});let b=e.getBoundingClientRect();return {x:b.x+Math.min(b.width/2,80),y:b.y+b.height/2}})()')
        async def mouse(pt):await cmd('Input.dispatchMouseEvent',dict(type='mouseMoved',**pt))
        await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Network.enable');await cmd('Emulation.setFocusEmulationEnabled',{'enabled':True})
        await cmd('Page.navigate',dict(url=BASE+'/index.html'))
        await until('!!window.__platformTable && !!window.__specGrid')
        await ev("document.documentElement.style.scrollBehavior='auto'")
        titles=await ev("[...document.querySelectorAll('section h2.title')].map(e=>e.textContent.trim())")
        assert titles==['1. Abstract','2. Real robot photos','3. State-of-the-art robots','4. Hardware design','5. Teleoperation','6. Simulation','7. Control, retargeting and motion model','8. Learning and architecture'],titles
        assert not [u for u in requests if '/platforms/' in u], 'Preview media loaded before interaction'
        assert await ev("document.querySelectorAll('.sg-sub').length===0")
        specs=await ev("[...document.querySelectorAll('.sg-tile b')].map(e=>e.textContent.replace(/\\s/g,''))")
        assert specs==['56','17×2','2.23m','≈3.5kg','$8,056','150ms','61.8kg','0.635m'],specs
        print('Section order, paper values and deferred previews: PASS',flush=True)
        # Full abstract stays visible, and the popup video waits for a real user click.
        assert await ev("!document.querySelector('#story details')&&document.querySelector('.ov-full-abstract').textContent.includes('56 degrees of freedom (DOF)')")
        assert not any('/submission-final-v3' in u for u in requests), 'Submission downloaded before Play'
        pt=await point("document.querySelector('[data-submission-play]')")
        await cmd('Input.dispatchMouseEvent',dict(type='mousePressed',button='left',clickCount=1,**pt))
        await cmd('Input.dispatchMouseEvent',dict(type='mouseReleased',button='left',clickCount=1,**pt))
        await until("document.querySelector('#submissionDialog').open&&document.querySelector('#submissionDialog video').currentTime>.1")
        assert await ev("!document.querySelector('#submissionDialog video').muted&&document.querySelector('#submissionDialog video').controls")
        await cmd('Input.dispatchKeyEvent',dict(type='keyDown',key='Escape',code='Escape'))
        await until("!document.querySelector('#submissionDialog').open")
        assert await ev("document.querySelector('#submissionDialog video').paused&&document.querySelector('#submissionDialog video').currentTime===0")
        await ev("scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})")
        await asyncio.sleep(.3)
        assert await ev("document.querySelector('#pageProgress').value==='100%'"), await ev("[scrollY,innerHeight,document.documentElement.scrollHeight,document.querySelector('#pageProgress').value]")
        assert await ev("document.querySelector('.ov-scroll-rail a[aria-current]').hash==='#cite'")
        print('Full paper abstract, video popup with sound/Escape, and reading progress: PASS',flush=True)
        data=await ev('window.__platformTable.data.platforms')
        assert len(data)==22 and all(r.get('preview') for r in data)
        expected=json.loads((Path(__file__).resolve().parents[1]/'assets/data/platform-previews.json').read_text())
        assert all(r['preview']==expected[r['name']] for r in data), 'Survey uses outdated preview media'
        posters=await ev("Promise.all(window.__platformTable.data.platforms.map(async r=>{try{let response=await fetch(r.preview.poster);if(!response.ok)return false;let bitmap=await createImageBitmap(await response.blob());let ok=bitmap.width>0&&bitmap.height>0;bitmap.close();return ok}catch(e){return false}}))")
        assert all(posters), 'A preview poster is missing or invalid'
        # Every row's own video must decode and advance; no substitute/fallback.
        for row in data:
            print("Checking",row["name"],flush=True)
            sel='document.querySelector('+json.dumps('tr[data-row="'+row['name']+'"] .pt-preview-trigger')+')'
            await ev(sel+'.scrollIntoView({block:"center",behavior:"instant"})')
            await asyncio.sleep(.2)
            await ev(sel+'.focus({preventScroll:true})')
            await until("(()=>{let v=document.querySelector('.pt-preview-card video');return v&&v.readyState>=2&&v.videoWidth>0&&!v.paused&&v.currentTime>.05})()")
            assert await ev("(()=>{let v=document.querySelector('.pt-preview-card video');return v.loop&&v.muted&&v.playsInline})()"),row['name']
        print('All 22 robot previews decode, play muted and loop: PASS',flush=True)
        await cmd('Input.dispatchKeyEvent',dict(type='keyDown',key='Escape',code='Escape'))
        assert await ev('document.querySelector(".pt-preview-card").hidden')
        pt=await point('document.querySelector(\'tr[data-row="Sunday Memo"] .pt-preview-trigger\')');await asyncio.sleep(.15);await mouse(pt)
        await until("!!document.querySelector('.pt-preview-card video')")
        await until("document.querySelector('.pt-preview-card video').readyState>=2")
        await ev("window.testPreview=document.querySelector('.pt-preview-card video');testPreview.currentTime=testPreview.duration-.1")
        await asyncio.sleep(.65)
        assert await ev('testPreview.currentTime<testPreview.duration-.2&&!testPreview.paused'), 'Loop did not restart'
        await mouse(dict(x=5,y=5));await asyncio.sleep(.3)
        assert await ev('document.querySelector(".pt-preview-card").hidden&&testPreview.paused'), 'Mouse leave did not stop preview'
        print('Hover playback, repeat boundary, mouse leave and Escape: PASS',flush=True)
        # Restore all original photo chapters and their varied-aspect mosaic.
        assert await ev("document.querySelectorAll('#rgGrid .rg-chap:not([hidden])').length===3&&document.querySelectorAll('.rg-lead').length===3")
        assert await ev("getComputedStyle(document.querySelector('.rg-line')).display==='flex'")
        assert await ev("document.querySelectorAll('section h2.title').length===8&&[...document.querySelectorAll('h2 .sticker')].every(e=>e.getAttribute('aria-hidden')==='true')&&document.querySelectorAll('.contrib-cell[data-pop]').length===3")
        await until("document.querySelector('#heroRig').classList.contains('on')",30)
        assert await ev("document.querySelector('#heroRigCanvas').width>0")
        print('Original hero model, NYC stickers, comic cards and full photo mosaic: PASS',flush=True)
        await ev("document.querySelector('[data-node=references]').click()")
        assert await ev("document.querySelector('#learningDetail').textContent.includes('120')")
        await ev("document.querySelector('#anat3d').scrollIntoView({block:'center',behavior:'instant'})")
        await until("document.querySelector('#anat3d').classList.contains('loaded')",30)
        await ev("document.querySelector('[data-module=arms]').click()")
        assert await ev("document.querySelector('[data-module=arms]').classList.contains('on')")
        print('Interactive hardware X-ray loads and selects a module: PASS',flush=True)
        for width in [1440,1280,768,390,360]:
            await metrics(width,900,width<720)
            overflow=await ev('document.documentElement.scrollWidth-document.documentElement.clientWidth')
            assert overflow<=1,(width,overflow)
        await metrics(390,844,True)
        pt=await point('document.querySelector(\'tr[data-row="Dyna Taku"] .pt-preview-trigger\')');await asyncio.sleep(.1)
        await cmd('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[pt]));await cmd('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
        await until("!document.querySelector('.pt-preview-card').hidden")
        bounds=await ev("(()=>{let b=document.querySelector('.pt-preview-card').getBoundingClientRect();return [b.left,b.right,b.top,b.bottom]})()")
        assert bounds[0]>=0 and bounds[1]<=390 and bounds[2]>=0 and bounds[3]<=844,bounds
        await ev("document.querySelector('.pt-card-close').click()")
        assert await ev('document.querySelector(".pt-preview-card").hidden')
        print('Mobile tap/close, learning/gallery controls and 360–1440 px layout: PASS',flush=True)
        # Reduced motion keeps the poster and native play control without autoplay.
        await metrics(1440)
        await cmd('Emulation.setEmulatedMedia',dict(features=[dict(name='prefers-reduced-motion',value='reduce')]))
        await ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        await ev("document.querySelector('tr[data-row=\"Sunday Memo\"] .pt-preview-trigger').focus()")
        await until("!!document.querySelector('.pt-preview-card video')")
        assert await ev("document.querySelector('.pt-preview-card video').paused")
        await cmd('Emulation.setEmulatedMedia',dict(features=[]))
        await cmd('Page.navigate',dict(url=BASE+'/simulator.html?embed=1&overview=1'))
        await until('!!window.__ta && !!window.__ta.navStage',30)
        await asyncio.sleep(2)
        views=await ev("['teleop','nav'].map(k=>{let b=document.querySelector('[data-view='+k+']').getBoundingClientRect();return [b.width,b.height,getComputedStyle(document.querySelector('[data-view='+k+']')).display]})")
        assert all(x[0]>200 and x[1]>200 and x[2]!='none' for x in views),views
        assert await ev("document.querySelector('#overviewSimStatus').textContent.includes('kinematic') || document.querySelector('#overviewSimStatus').textContent.includes('Live MuJoCo')")
        await metrics(390,760,True)
        overflow=await ev('document.documentElement.scrollWidth-document.documentElement.clientWidth')
        assert overflow<=1,('sim mobile overflow',overflow)
        print('Camera + orbitable 3D state viewer, desktop and mobile: PASS',flush=True)
        assert not errors,errors[:3]
        print('RESULT: PASS',flush=True)

try:asyncio.run(main())
finally:proc.terminate()
