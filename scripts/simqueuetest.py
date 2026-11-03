#!/usr/bin/env python3
"""Network test: FIFO, one driver, expiry, disconnect and offline waiting."""
import asyncio,json
from aiohttp import web,ClientSession,WSMsgType
from sim_queue_server import make_app
async def main():
    seen=[];sockets=set()
    async def upstream(request):
        ws=web.WebSocketResponse();await ws.prepare(request);sockets.add(ws)
        await ws.send_json({'type':'hello','payload':{'simulation':True}})
        async def states():
            while not ws.closed:
                await ws.send_json({'type':'robot_state','payload':{}});await asyncio.sleep(.1)
        task=asyncio.create_task(states())
        try:
            async for event in ws:
                if event.type==WSMsgType.TEXT:seen.append(json.loads(event.data))
        finally:task.cancel();await asyncio.gather(task,return_exceptions=True);sockets.discard(ws)
        return ws
    async def serve(app):
        runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start();return runner,site._server.sockets[0].getsockname()[1]
    mock=web.Application();mock.router.add_get('/teleop',upstream);mr,mp=await serve(mock)
    app=make_app(f'ws://127.0.0.1:{mp}/teleop',2);qr,qp=await serve(app);gate=app['queue']
    async def until(check):
        for _ in range(80):
            if check():return
            await asyncio.sleep(.05)
        raise AssertionError('Timed out')
    async with ClientSession() as client:
        peers=[await client.ws_connect(f'http://127.0.0.1:{qp}/teleop') for _ in range(3)]
        for ws in peers:await ws.send_json({'type':'queue_watch'})
        await until(lambda:gate.ready)
        for ws in peers:await ws.send_json({'type':'queue_join'})
        await until(lambda:gate.owner and len(gate.waiting)==2)
        first=gate.owner;second=gate.waiting[0];third=gate.waiting[1]
        state2=gate.state(second)['payload'];state3=gate.state(third)['payload']
        assert state2['people_ahead']==1 and 0<state2['estimated_wait_seconds']<=2
        assert state3['people_ahead']==2 and 2<state3['estimated_wait_seconds']<=4
        await peers[0].send_json({'type':'joint_command','payload':{'tag':'driver'}})
        await peers[1].send_json({'type':'joint_command','payload':{'tag':'spectator'}})
        await until(lambda:any(m.get('payload',{}).get('tag')=='driver' for m in seen))
        assert not any(m.get('payload',{}).get('tag')=='spectator' for m in seen)
        await until(lambda:gate.owner is second)
        assert gate.state(third)['payload']['people_ahead']==1
        assert any(m.get('type')=='reset' for m in seen),'Lease expiry did not reset the simulated plant'
        await peers[1].close();await until(lambda:gate.owner is third)
        assert gate.state(third)['payload']['people_ahead']==0 and gate.state(third)['payload']['estimated_wait_seconds']==0
        deadline=gate.deadline;await peers[2].send_json({'type':'queue_join'});await asyncio.sleep(.15);assert gate.deadline==deadline,'Join renewed an active lease'
        await peers[2].send_json({'type':'queue_leave'});await until(lambda:gate.owner is None)
        await asyncio.gather(*(ws.close() for ws in peers))
        # No upstream: preserve the queue without granting or burning time.
        offline=make_app('ws://127.0.0.1:1/teleop',2);orr,op=await serve(offline)
        ws=await client.ws_connect(f'http://127.0.0.1:{op}/teleop');await ws.send_json({'type':'queue_watch'});await ws.send_json({'type':'queue_join'})
        await asyncio.sleep(2.2);assert offline['queue'].owner is None and len(offline['queue'].waiting)==1
        state=offline['queue'].state(next(iter(offline['queue'].peers)))['payload']
        assert state['remaining_seconds']==0 and state['people_ahead']==0 and state['estimated_wait_seconds'] is None
        await ws.close();await orr.cleanup()
    await qr.cleanup();await mr.cleanup()
    print('FIFO, exclusive control, expiry/reset, disconnect handoff, nonrenewal, people ahead, wait estimates and offline waiting: PASS')
    print('RESULT: PASS')
if __name__=='__main__':asyncio.run(main())
