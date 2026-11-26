"""U-server, HTTP: Host and Origin checks, GET only, the file list, and the headers on every response."""

from __future__ import annotations

import asyncio
import http.client
import json
from pathlib import Path

import pytest
from websockets.exceptions import InvalidStatus

from server.web import Site, SiteError

from .conftest import HEADERS, server


def get(port: int, path: str, host: str | None = None, method: str = "GET", headers: dict[str, str] | None = None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.putrequest(method, path, skip_host=True)
    c.putheader("Host", host if host is not None else f"127.0.0.1:{port}")
    for k, v in (headers or {}).items():
        c.putheader(k, v)
    c.endheaders()
    r = c.getresponse()
    body = r.read()
    c.close()
    return r.status, dict(r.getheaders()), body


def check_headers(h: dict[str, str]) -> None:
    for k, v in HEADERS.items():
        assert h.get(k) == v, k
    assert "Server" not in h
    assert not any(k.lower().startswith("access-control-") for k in h)


def get_twice(port: int, path: str, name: str, values: tuple[str, str], headers: dict[str, str] | None = None):
    """A GET with one header sent twice."""
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.putrequest("GET", path, skip_host=True)
    if name != "Host":
        c.putheader("Host", f"127.0.0.1:{port}")
    for v in values:
        c.putheader(name, v)
    for k, v in (headers or {}).items():
        c.putheader(k, v)
    c.endheaders()
    r = c.getresponse()
    body = r.read()
    c.close()
    return r.status, dict(r.getheaders()), body


async def in_thread(fn, *args, **kw):
    return await asyncio.to_thread(fn, *args, **kw)


def test_serves_the_app_with_the_headers(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            status, h, body = await in_thread(get, s.port, "/")
            assert status == 200 and body.startswith(b"<!doctype html>")
            assert h["Content-Type"] == "text/html; charset=utf-8"
            check_headers(h)
            status, h, _ = await in_thread(get, s.port, "/assets/app.js?v=1")
            assert status == 200 and h["Content-Type"] == "text/javascript; charset=utf-8"
            check_headers(h)

    asyncio.run(go())


@pytest.mark.parametrize(
    "path",
    ["/headers.json", "/assets/notes.map", "/link.txt", "/../secret.txt", "/assets/../../secret.txt", "/nope", "/assets"],
)
def test_serves_only_the_file_list(dist: Path, path: str) -> None:
    async def go() -> None:
        async with server(dist) as s:
            status, h, _ = await in_thread(get, s.port, path)
            assert status == 404
            check_headers(h)

    asyncio.run(go())


@pytest.mark.parametrize("host", ["localhost:{p}", "127.0.0.1", "127.0.0.1:1", "evil.example:{p}", ""])
def test_refuses_a_wrong_host(dist: Path, host: str) -> None:
    async def go() -> None:
        async with server(dist) as s:
            status, h, _ = await in_thread(get, s.port, "/", host.format(p=s.port))
            assert status == 421
            check_headers(h)

    asyncio.run(go())


def test_refuses_a_header_sent_twice(dist: Path) -> None:
    """Two Hosts or two Origins are refused as wrong, not answered with a 500 (Stage 11 review N5)."""

    async def go() -> None:
        async with server(dist) as s:
            good = f"127.0.0.1:{s.port}"
            for values in [(good, good), (good, "evil.example"), ("evil.example", good)]:
                status, h, _ = await in_thread(get_twice, s.port, "/", "Host", values)
                assert status == 421, values
                check_headers(h)
            upgrade = {"Upgrade": "websocket", "Connection": "Upgrade"}
            for values in [(s.origin, s.origin), (s.origin, "http://evil.example"), ("http://evil.example", s.origin)]:
                status, h, _ = await in_thread(get_twice, s.port, "/bus", "Origin", values, upgrade)
                assert status == 403, values
                check_headers(h)
            status, h, _ = await in_thread(
                get_twice, s.port, "/bus", "Upgrade", ("websocket", "h2c"), {"Origin": s.origin}
            )
            assert status == 426
            assert s.frames() == []

    asyncio.run(go())


@pytest.mark.parametrize("method", ["POST", "HEAD", "PUT", "OPTIONS", "DELETE"])
def test_serves_get_only(dist: Path, method: str) -> None:
    async def go() -> None:
        async with server(dist) as s:
            status, h, _ = await in_thread(get, s.port, "/", method=method)
            assert status == 405 and h["Allow"] == "GET"

    asyncio.run(go())


def test_a_service_worker_request_clears_the_origin(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            status, h, _ = await in_thread(get, s.port, "/assets/app.js", headers={"Service-Worker": "script"})
            assert status == 404 and h["Clear-Site-Data"] == '"storage"'
            check_headers(h)

    asyncio.run(go())


@pytest.mark.parametrize("origin", [None, "null", "http://localhost:{p}", "http://127.0.0.1:1", "https://127.0.0.1:{p}", "http://evil.example"])
def test_refuses_an_upgrade_from_another_origin(dist: Path, origin: str | None) -> None:
    async def go() -> None:
        async with server(dist) as s:
            o = None if origin is None else origin.format(p=s.port)
            with pytest.raises(InvalidStatus) as e:
                async with s.client(origin=o, hello=False):
                    pass
            assert e.value.response.status_code == 403
            check_headers(dict(e.value.response.headers.raw_items()))
            assert s.frames() == []

    asyncio.run(go())


def test_bus_needs_an_upgrade(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            status, h, _ = await in_thread(get, s.port, "/bus", headers={"Origin": s.origin})
            assert status == 426
            check_headers(h)

    asyncio.run(go())


def test_the_upgrade_carries_the_headers(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                h = dict(ws.response.headers.raw_items())
                check_headers(h)
                assert "Sec-WebSocket-Extensions" not in h

    asyncio.run(go())


def test_refuses_to_start_without_headers(dist: Path) -> None:
    (dist / "headers.json").unlink()
    with pytest.raises(SiteError):
        Site(dist)
    (dist / "headers.json").write_text(json.dumps({"X-Frame-Options": "DENY"}))
    with pytest.raises(SiteError):
        Site(dist)
    (dist / "headers.json").write_text("[]")
    with pytest.raises(SiteError):
        Site(dist)


def test_refuses_to_start_without_an_app(tmp_path: Path) -> None:
    (tmp_path / "headers.json").write_text(json.dumps(HEADERS))
    with pytest.raises(SiteError):
        Site(tmp_path)


def test_the_build_writes_the_header_set_vite_preview_sends() -> None:
    """dist/headers.json comes from config/security.ts. If the build has run, check what it wrote."""
    built = Path(__file__).resolve().parents[2] / "dist" / "headers.json"
    if not built.exists():
        pytest.skip("dist/ is not built")
    data = json.loads(built.read_text())
    assert "trusted-types enlighten-worker" in data["Content-Security-Policy"]
    assert data["X-Frame-Options"] == "DENY"
    Site(built.parent)
