"""HTTP for the hardware server: the built app and the /bus upgrade, from one origin (ADR 0003).

Every request must carry the exact Host. The upgrade must carry the exact Origin. Files come from a list
built at start from dist/, never from the request path, with a fixed set of types. Every response
carries the same security headers as `vite preview`, read from dist/headers.json, which the build
writes from config/security.ts.
"""

from __future__ import annotations

import json
from http import HTTPStatus
from pathlib import Path

from websockets.asyncio.server import ServerConnection
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

HOST = "127.0.0.1"
PORT = 47821
BUS_PATH = "/bus"
HEADERS_FILE = "headers.json"

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}

# A service worker script request on this origin means a foreign worker: the app registers none.
CLEAR_SITE_DATA = '"storage"'


class SiteError(Exception):
    pass


def load_headers(dist: Path) -> dict[str, str]:
    path = dist / HEADERS_FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SiteError(f"{path} is missing or unreadable. Run `pnpm build` first.") from e
    if not isinstance(data, dict) or not data or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in data.items()
    ):
        raise SiteError(f"{path} is not a map of header names to values.")
    for required in ("Content-Security-Policy", "Cross-Origin-Embedder-Policy", "X-Frame-Options"):
        if required not in data:
            raise SiteError(f"{path} has no {required}.")
    return data


def load_files(dist: Path) -> dict[str, tuple[bytes, str]]:
    """Every servable file under dist/, by URL path. Built once, at start."""
    files: dict[str, tuple[bytes, str]] = {}
    root = dist.resolve()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink() or path.name == HEADERS_FILE:
            continue
        kind = TYPES.get(path.suffix)
        if kind is None:
            continue
        rel = path.relative_to(root).as_posix()
        files["/" + rel] = (path.read_bytes(), kind)
    if "/index.html" not in files:
        raise SiteError(f"{dist} has no index.html. Run `pnpm build` first.")
    files["/"] = files["/index.html"]
    return files


class Site:
    def __init__(self, dist: Path, port: int = PORT):
        self.headers = load_headers(dist)
        self.files = load_files(dist)
        self.set_port(port)

    def set_port(self, port: int) -> None:
        self.host = f"{HOST}:{port}"
        self.origin = f"http://{HOST}:{port}"

    def _response(self, status: HTTPStatus, body: bytes, kind: str, extra: dict[str, str] | None = None) -> Response:
        headers = Headers()
        for k, v in self.headers.items():
            headers[k] = v
        headers["Content-Type"] = kind
        headers["Content-Length"] = str(len(body))
        for k, v in (extra or {}).items():
            headers[k] = v
        return Response(status.value, status.phrase, headers, body)

    def _text(self, status: HTTPStatus, text: str, extra: dict[str, str] | None = None) -> Response:
        return self._response(status, text.encode(), "text/plain; charset=utf-8", extra)

    def process_request(self, connection: ServerConnection, request: Request) -> Response | None:
        """Answer every HTTP request but a good /bus upgrade, which goes on to the WebSocket."""
        # `get_all`, because `get` raises on a header sent twice, and two Hosts are never right.
        if request.headers.get_all("Host") != [self.host]:
            return self._text(HTTPStatus.MISDIRECTED_REQUEST, "Wrong host.\n")
        if request.method != "GET":
            return self._text(HTTPStatus.METHOD_NOT_ALLOWED, "GET only.\n", {"Allow": "GET"})
        if "Service-Worker" in request.headers:
            return self._text(HTTPStatus.NOT_FOUND, "Not found.\n", {"Clear-Site-Data": CLEAR_SITE_DATA})
        path = request.path.split("?", 1)[0]
        if path == BUS_PATH:
            if request.headers.get_all("Origin") != [self.origin]:
                return self._text(HTTPStatus.FORBIDDEN, "Wrong origin.\n")
            if [u.lower() for u in request.headers.get_all("Upgrade")] != ["websocket"]:
                return self._text(HTTPStatus.UPGRADE_REQUIRED, "WebSocket only.\n")
            return None
        found = self.files.get(path)
        if found is None:
            return self._text(HTTPStatus.NOT_FOUND, "Not found.\n")
        body, kind = found
        return self._response(HTTPStatus.OK, body, kind)

    def process_response(self, connection: ServerConnection, request: Request, response: Response) -> Response:
        """The security headers go on every response, the upgrade and websockets' own errors included."""
        for k, v in self.headers.items():
            if k not in response.headers:
                response.headers[k] = v
        return response
