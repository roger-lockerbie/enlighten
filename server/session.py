"""The one client, its tokens, the queue of frames, and the stop (docs/SPEC.md section 9, ADR 0003).

Only a connection that passed HELLO holds the client slot. The token in the printed URL works once;
WELCOME carries a fresh one for reconnects, kept in memory only. Frames go to the hasseb one at a time
on one thread. The stop is the same in every case: drop the queue (each queued SEND answered with status
6), let the frame on the hasseb finish so frames stay in order, then send TERMINATE and broadcast OFF.
"""

from __future__ import annotations

import asyncio
import hmac
import secrets
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable

from websockets.asyncio.server import ServerConnection
from websockets.exceptions import ConnectionClosed

from . import frames
from . import protocol as p
from .hasseb import Link

HELLO_TIMEOUT_S = 1.0
SILENCE_S = 3.0
QUEUE_LIMIT = 8
DEVICE_POLL_S = 1.0


@dataclass
class Queued:
    ws: ServerConnection
    send: p.Send


class Hub:
    def __init__(self, link: Link, log: Callable[[str], None] = print):
        self.link = link
        self.log = log
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hasseb")
        self.url_token: bytes | None = None
        self.session_token: bytes | None = None
        self.client: ServerConnection | None = None
        self.queue: deque[Queued] = deque()
        self.bus = asyncio.Lock()
        self.wake = asyncio.Event()
        self.previous = None
        self.attached = False
        self.closing = False

    # Tokens ----------------------------------------------------------------------------------------

    def new_url_token(self) -> bytes:
        """A fresh one-time token for the printed URL. It replaces any earlier one."""
        self.url_token = secrets.token_bytes(p.TOKEN_BYTES)
        return self.url_token

    def _token_ok(self, token: bytes) -> bool:
        ok = False
        for known in (self.url_token, self.session_token):
            # Compare against both in constant time, whatever the first one said.
            if known is not None and hmac.compare_digest(token, known):
                ok = True
        return ok

    # The hasseb ------------------------------------------------------------------------------------

    async def _run(self, fn, *args):
        return await asyncio.get_running_loop().run_in_executor(self.executor, fn, *args)

    async def poll_device(self) -> None:
        """Watch for the hasseb coming and going, and tell the client."""
        while not self.closing:
            attached = await self._run(self.link.poll)
            if attached != self.attached:
                self.attached = attached
                self.log(f"hasseb {'attached' if attached else 'not attached'}")
                await self._send(self.client, p.device(attached))
            await asyncio.sleep(DEVICE_POLL_S)

    async def _transmit(self, a: int, b: int, expect_reply: bool, send_twice: bool) -> tuple[int, int]:
        status, data = await self._run(self.link.transmit, a, b, expect_reply, send_twice)
        if not self.link.attached and self.attached:
            self.attached = False
            self.log("hasseb not attached")
            await self._send(self.client, p.device(False))
        return status, data

    # Frames ----------------------------------------------------------------------------------------

    async def pump(self) -> None:
        """Send queued frames, one at a time, for as long as the server runs."""
        while not self.closing:
            await self.wake.wait()
            self.wake.clear()
            while self.queue:
                async with self.bus:
                    if not self.queue:
                        break
                    item = self.queue.popleft()
                    reply = await self._one(item.send)
                await self._send(item.ws, reply)

    async def _one(self, s: p.Send) -> bytes:
        cmd = frames.decode(s.a, s.b, self.previous)
        if cmd is None or frames.flags(cmd) != (s.send_twice, s.expect_reply):
            # Not sent, so the frame before stays the context for device type commands.
            return p.result(s.seq, p.REFUSED)
        status, data = await self._transmit(s.a, s.b, s.expect_reply, s.send_twice)
        # A frame that timed out may still have reached the bus, so it counts as the frame before.
        self.previous = cmd
        if not s.expect_reply and status == p.NO_REPLY:
            status = p.SENT
        return p.result(s.seq, status, data)

    async def stop(self) -> tuple[int, int]:
        """Drop the queue, let the frame on the hasseb finish, then TERMINATE and broadcast OFF."""
        dropped = list(self.queue)
        self.queue.clear()
        for item in dropped:
            await self._send(item.ws, p.result(item.send.seq, p.DROPPED))
        async with self.bus:
            t, _ = await self._transmit(*frames.TERMINATE, False, False)
            o, _ = await self._transmit(*frames.BROADCAST_OFF, False, False)
            self.previous = None
        t = p.SENT if t == p.NO_REPLY else t
        o = p.SENT if o == p.NO_REPLY else o
        self.log(f"stop: TERMINATE and broadcast OFF sent (statuses {t} and {o})")
        return t, o

    # Connections -----------------------------------------------------------------------------------

    async def _send(self, ws: ServerConnection | None, data: bytes) -> None:
        if ws is None:
            return
        try:
            await ws.send(data)
        except ConnectionClosed:
            pass

    async def _refuse(self, ws: ServerConnection, reason: int) -> None:
        await self._send(ws, p.close(reason))
        await ws.close()

    async def handle(self, ws: ServerConnection) -> None:
        """One WebSocket connection, from HELLO to the stop."""
        try:
            first = await asyncio.wait_for(ws.recv(), HELLO_TIMEOUT_S)
        except (TimeoutError, ConnectionClosed):
            await self._refuse(ws, p.NOT_AUTHORISED)
            return
        hello = p.parse_client(first) if isinstance(first, bytes) else None
        if not isinstance(hello, p.Hello) or hello.version != p.VERSION:
            await self._refuse(ws, p.PROTOCOL_ERROR)
            return
        if not self._token_ok(hello.token):
            self.log("refused a connection: bad or used token")
            await self._refuse(ws, p.NOT_AUTHORISED)
            return
        if self.client is not None:
            await self._refuse(ws, p.BUSY)
            return
        # The URL token is used up. Reconnects use the token WELCOME carries, renewed each time.
        self.client = ws
        self.url_token = None
        self.session_token = secrets.token_bytes(p.TOKEN_BYTES)
        major, minor = self.link.firmware
        await self._send(ws, p.welcome(major, minor, self.attached, self.session_token))
        self.log("client connected")
        try:
            await self._session(ws)
        finally:
            if self.client is ws:
                self.client = None
                self.log("client gone")
                await self.stop()

    async def _session(self, ws: ServerConnection) -> None:
        while True:
            try:
                data = await asyncio.wait_for(ws.recv(), SILENCE_S)
            except TimeoutError:
                self.log("no message for 3 seconds")
                t, o = await self.stop()
                await self._send(ws, p.stopped(t, o))
                self.client = None
                await self._refuse(ws, p.SILENCE)
                return
            except ConnectionClosed:
                return
            msg = p.parse_client(data) if isinstance(data, bytes) else None
            if msg is None or isinstance(msg, p.Hello):
                await self._refuse(ws, p.PROTOCOL_ERROR)
                return
            if isinstance(msg, p.Send):
                if len(self.queue) >= QUEUE_LIMIT:
                    await self._send(ws, p.result(msg.seq, p.REFUSED))
                else:
                    self.queue.append(Queued(ws, msg))
                    self.wake.set()
            elif isinstance(msg, p.Panic):
                t, o = await self.stop()
                await self._send(ws, p.stopped(t, o))

    async def shutdown(self) -> None:
        """The server is stopping: the same stop, then tell the client and close. Runs once."""
        if self.closing:
            return
        self.closing = True
        self.wake.set()
        ws = self.client
        self.client = None
        t, o = await self.stop()
        if ws is not None:
            await self._send(ws, p.stopped(t, o))
            await self._refuse(ws, p.SERVER_STOPPING)
        self.executor.shutdown(wait=True)
