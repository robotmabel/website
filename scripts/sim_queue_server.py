#!/usr/bin/env python3
"""A single-driver FIFO lease in front of the public simulation WebSocket.

Bind to loopback. Caddy keeps its existing token gate and routes ONLY /sim/teleop
here; the physical robot routes and the simulation video route stay separate.
All viewers receive state. Only the current driver can forward control messages.
"""
import argparse,asyncio,contextlib,json,math,time
from collections import deque
from dataclasses import dataclass,field
from aiohttp import web,ClientSession,ClientTimeout,WSMsgType

@dataclass(eq=False)
class Peer:
    ws: web.WebSocketResponse
    aware: bool=False
    expired: bool=False
    pending: deque=field(default_factory=lambda:deque(maxlen=16))
    latest_state: dict=None
    latest_queue: dict=None
    wake: asyncio.Event=field(default_factory=asyncio.Event)
    writer: asyncio.Task=None
    async def send(self,message):
        if self.ws.closed:return
        # A slow spectator must never stall the plant or another visitor's lease.
        kind=message.get('type')
        if kind=='robot_state':self.latest_state=message
        elif kind=='sim_queue':self.latest_queue=message
        else:self.pending.append(message)
        self.wake.set()
    async def write(self):
        try:
            while not self.ws.closed:
                await self.wake.wait();self.wake.clear()
                messages=list(self.pending);self.pending.clear()
                if self.latest_queue:messages.append(self.latest_queue);self.latest_queue=None
                if self.latest_state:messages.append(self.latest_state);self.latest_state=None
                for message in messages:
                    await asyncio.wait_for(self.ws.send_json(message),2)
        except (Exception,asyncio.TimeoutError):
            await self.ws.close()

class SimulationQueue:
    def __init__(self,upstream,lease_seconds=120):
        self.url=upstream;self.lease_seconds=lease_seconds
        self.peers=set();self.waiting=deque();self.owner=None;self.deadline=0
        self.upstream=None;self.ready=False;self.hello=None;self.last_bridge_at=0
        self.lock=asyncio.Lock();self.tasks=[];self.session=None;self.needs_reset=True
    def state(self,peer):
        position=next((i+1 for i,p in enumerate(self.waiting) if p is peer),None)
        remaining=max(0,math.ceil(self.deadline-time.monotonic())) if self.owner else 0
        queued_ahead=position-1 if position else len(self.waiting)
        ahead=0 if peer is self.owner else queued_ahead+int(self.owner is not None)
        estimate=(remaining+queued_ahead*self.lease_seconds) if self.ready else None
        return {'type':'sim_queue','payload':{'role':'driver' if peer is self.owner else 'waiting' if position else 'viewer','position':position,'waiting':len(self.waiting),'people_ahead':ahead,'estimated_wait_seconds':0 if peer is self.owner else estimate,'current_turn_remaining_seconds':remaining,'remaining_seconds':remaining if peer is self.owner else 0,'lease_seconds':self.lease_seconds,'backend_ready':self.ready}}
    async def broadcast_queue(self):
        await asyncio.gather(*(p.send(self.state(p)) for p in list(self.peers)),return_exceptions=True)
    async def _send(self,message):
        if not self.upstream or self.upstream.closed:return False
        try:await asyncio.wait_for(self.upstream.send_json(message),1);return True
        except Exception:return False
    async def _grant(self):
        if self.owner or not self.ready:return
        while self.waiting:
            p=self.waiting.popleft()
            if p.ws.closed:continue
            if self.needs_reset:
                if not await self._send({'type':'reset','payload':{}}):
                    self.waiting.appendleft(p);return
                self.needs_reset=False
            # A fresh simulated turn must not inherit a previous visitor's stop.
            # This gateway serves only the dedicated SIM upstream. During a turn,
            # viewers can stop it and only its current driver can release it.
            if not await self._send({'type':'estop','payload':{'active':False}}):
                self.waiting.appendleft(p);return
            self.owner=p;self.deadline=time.monotonic()+self.lease_seconds;break
    async def _release(self):
        if self.owner:self.owner.expired=True
        self.owner=None;self.deadline=0;self.needs_reset=True
        self.needs_reset=not await self._send({'type':'reset','payload':{}})
        await self._grant()
    async def join(self,peer):
        async with self.lock:
            peer.expired=False
            if peer is not self.owner and peer not in self.waiting:self.waiting.append(peer)
            await self._grant()
        await self.broadcast_queue()
    async def leave(self,peer):
        async with self.lock:
            self.waiting=deque(p for p in self.waiting if p is not peer)
            if peer is self.owner:await self._release()
        await self.broadcast_queue()
    async def handle(self,peer,message):
        kind=message.get('type');payload=message.get('payload') or {}
        if not isinstance(payload,dict):return
        if kind=='queue_watch':peer.aware=True;await peer.send(self.state(peer));return
        if kind=='queue_join':peer.aware=True;await self.join(peer);return
        if kind=='queue_leave':await self.leave(peer);return
        if kind=='ping':
            if self.ready:await peer.send({'type':'pong','payload':payload})
            return
        if kind in ['list_maps']:
            if self.ready:await self._send(message)
            return
        # Any viewer can stop this simulated plant; only the driver can release it.
        if kind=='queue_estop':
            if payload.get('active',True) or peer is self.owner:
                await self._send({'type':'estop','payload':{'active':bool(payload.get('active',True))}})
            return
        async with self.lock:
            if self.owner and time.monotonic()>=self.deadline:await self._release()
            # Native clients without the queue UI enter on their first command.
            # An expired legacy connection cannot renew its own lease by spamming.
            if not peer.aware and not peer.expired and peer is not self.owner:
                if peer not in self.waiting:self.waiting.append(peer)
                await self._grant()
            if self.ready and peer is self.owner and time.monotonic()<self.deadline:
                await self._send(message)
    async def websocket(self,request):
        if len(self.peers)>=256:raise web.HTTPServiceUnavailable(text='Simulation queue is full')
        ws=web.WebSocketResponse(heartbeat=20,max_msg_size=65536);await ws.prepare(request)
        peer=Peer(ws);self.peers.add(peer)
        peer.writer=asyncio.create_task(peer.write())
        if self.ready and self.hello:await peer.send(self.hello)
        await peer.send(self.state(peer))
        try:
            async for event in ws:
                if event.type==WSMsgType.TEXT:
                    try:message=json.loads(event.data)
                    except (ValueError,TypeError):continue
                    if isinstance(message,dict):await self.handle(peer,message)
        finally:
            self.peers.discard(peer);await self.leave(peer)
            peer.writer.cancel();await asyncio.gather(peer.writer,return_exceptions=True)
        return ws
    async def health(self,request):
        return web.json_response({'ok':True,'backend_ready':self.ready,'lease_seconds':self.lease_seconds,'waiting':len(self.waiting),'driver_active':self.owner is not None})
    async def bridge(self):
        while True:
            try:
                async with self.session.ws_connect(self.url,heartbeat=10,max_msg_size=4194304) as upstream:
                    self.upstream=upstream;opened=time.monotonic()
                    while True:
                        event=await asyncio.wait_for(upstream.receive(),6)
                        if event.type==WSMsgType.TEXT:
                            try:message=json.loads(event.data)
                            except (ValueError,TypeError):continue
                            if message.get('type') in ['hello','robot_state','pong']:
                                self.last_bridge_at=time.monotonic()
                            if message.get('type') in ['hello','robot_state'] and not self.ready:
                                async with self.lock:self.ready=True;await self._grant()
                            if message.get('type')=='hello':self.hello=message
                            await asyncio.gather(*(p.send(message) for p in list(self.peers)),return_exceptions=True)
                        elif event.type in [WSMsgType.CLOSE,WSMsgType.CLOSED,WSMsgType.ERROR]:break
                        if not self.ready and time.monotonic()-opened>5:break
            except asyncio.CancelledError:raise
            except Exception:pass  # No upstream URL/token or client data in logs.
            finally:
                async with self.lock:
                    self.ready=False;self.upstream=None;self.hello=None;self.needs_reset=True
                    if self.owner and not self.owner.ws.closed:self.waiting.appendleft(self.owner)
                    self.owner=None;self.deadline=0
                await self.broadcast_queue()
            await asyncio.sleep(2)
    async def ticker(self):
        last=0
        while True:
            async with self.lock:
                if self.owner and time.monotonic()>=self.deadline:await self._release()
            if time.monotonic()-last>=1:last=time.monotonic();await self.broadcast_queue()
            await asyncio.sleep(.1)
    async def start(self,app):
        self.session=ClientSession(timeout=ClientTimeout(total=None,sock_connect=3))
        self.tasks=[asyncio.create_task(self.bridge()),asyncio.create_task(self.ticker())]
    async def stop(self,app):
        await self._send({'type':'reset','payload':{}})
        for task in self.tasks:task.cancel()
        await asyncio.gather(*self.tasks,return_exceptions=True)
        await asyncio.gather(*(p.ws.close() for p in list(self.peers)),return_exceptions=True)
        if self.session:await self.session.close()

def make_app(upstream,lease_seconds=120):
    gate=SimulationQueue(upstream,lease_seconds);app=web.Application()
    app['queue']=gate;app.router.add_get('/teleop',gate.websocket);app.router.add_get('/healthz',gate.health)
    app.on_startup.append(gate.start);app.on_cleanup.append(gate.stop);return app
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--host',default='127.0.0.1');ap.add_argument('--port',type=int,default=7011);ap.add_argument('--upstream',default='ws://127.0.0.1:7006/teleop');ap.add_argument('--lease-seconds',type=int,default=120);args=ap.parse_args()
    web.run_app(make_app(args.upstream,args.lease_seconds),host=args.host,port=args.port,access_log=None)
