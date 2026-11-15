"""Shared set-up for the server's tests: a small dist/, and the server running in-process on a fake bus.

The server is built exactly as `python -m server` builds it (server/app.py), on a port the system picks.
"""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

import pytest
from websockets.asyncio.client import ClientConnection, connect

from server import fake
from server import protocol as p
from server.app import running
from server.hasseb import Link
from server.session import Hub
from server.web import Site

HEADERS = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
}

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>Enlighten</title>")
    (d / "assets" / "app.js").write_text("export {};")
    (d / "assets" / "notes.map").write_text("not served: unknown type")
    (d / "headers.json").write_text(json.dumps(HEADERS))
    (tmp_path / "secret.txt").write_text("outside dist")
    os.symlink(tmp_path / "secret.txt", d / "link.txt")
    return d


@dataclass
class Running:
    port: int
    hub: Hub
    bus: fake.FakeBus
    device: fake.FakeHasseb
    token: bytes
    logs: list[str] = field(default_factory=list)

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def uri(self) -> str:
        return f"ws://127.0.0.1:{self.port}/bus"

    def frames(self) -> list[str]:
        """What reached the fake bus, as python-dali class names."""
        return [n for _, _, n in self.bus.log]

    @asynccontextmanager
    async def client(self, origin: str | None = "", hello: bool = True, token: bytes | None = None) -> AsyncIterator[ClientConnection]:
        o = self.origin if origin == "" else origin
        async with connect(self.uri, origin=o, compression=None) as ws:  # type: ignore[arg-type]
            if hello:
                await ws.send(bytes([p.HELLO, p.VERSION]) + (token if token is not None else self.token))
            yield ws


@asynccontextmanager
async def server(dist: Path, quirk: str | None = None, unaddressed: bool = False) -> AsyncIterator[Running]:
    site = Site(dist, 0)
    bus = fake.FakeBus(fake.bench(quirk, unaddressed))
    device = fake.FakeHasseb(bus, quirk)
    logs: list[str] = []
    hub = Hub(Link(lambda: device if device.plugged else None), log=logs.append)
    async with running(site, hub, 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        token = hub.new_url_token()
        # Let the device poll find the fake hasseb.
        for _ in range(100):
            if hub.attached:
                break
            await asyncio.sleep(0.01)
        yield Running(port, hub, bus, device, token, logs)


async def recv(ws: ClientConnection, timeout: float = 2.0) -> bytes:
    data = await asyncio.wait_for(ws.recv(), timeout)
    assert isinstance(data, bytes)
    return data


def send(seq: int, a: int, b: int, expect_reply: bool = False, send_twice: bool = False) -> bytes:
    return bytes([p.SEND, seq >> 8, seq & 0xFF, (1 if expect_reply else 0) | (2 if send_twice else 0), a, b])
