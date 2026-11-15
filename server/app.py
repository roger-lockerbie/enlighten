"""The server as one object, so `python -m server` and the tests build it the same way."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

from websockets.asyncio.server import Server, serve

from .session import Hub
from .web import HOST, Site

MAX_MESSAGE = 64


@asynccontextmanager
async def running(site: Site, hub: Hub, port: int) -> AsyncIterator[Server]:
    """Listen on 127.0.0.1 only, with compression off and a 64-byte message limit (SPEC section 9)."""
    async with serve(
        hub.handle,
        HOST,
        port,
        process_request=site.process_request,
        process_response=site.process_response,
        compression=None,
        max_size=MAX_MESSAGE,
        server_header=None,
    ) as server:
        # With port 0 (tests only) the system picks one, and the Host and Origin checks follow it.
        site.set_port(server.sockets[0].getsockname()[1])
        tasks = [asyncio.create_task(hub.pump()), asyncio.create_task(hub.poll_device())]
        try:
            yield server
        finally:
            await hub.shutdown()
            for t in tasks:
                t.cancel()
