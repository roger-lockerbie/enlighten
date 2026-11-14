"""U-server, the program: stop on each signal, the URL token printed again on Enter, demo mode without
hidapi. These run `python -m server` itself on its fixed port, and are skipped when the port is taken."""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from .conftest import REPO

PORT = 47821


def port_free() -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", PORT))
        except OSError:
            return False
    return True


def start(dist: Path) -> subprocess.Popen[str]:
    if not port_free():
        pytest.skip(f"port {PORT} is in use")
    proc = subprocess.Popen(
        [sys.executable, "-m", "server", "--demo", "--dist", str(dist)],
        cwd=REPO,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    assert proc.stdout is not None
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if line.startswith("http://127.0.0.1:47821/#t="):
            return proc
    proc.kill()
    raise AssertionError("the server did not print its URL")


@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM, signal.SIGHUP])
def test_each_signal_stops_the_bus(dist: Path, sig: signal.Signals) -> None:
    proc = start(dist)
    time.sleep(0.3)
    proc.send_signal(sig)
    out, _ = proc.communicate(timeout=10)
    assert proc.returncode == 0
    after = out[out.index("enlighten: stopping") :]
    assert "bus a100 general.Terminate" in after
    assert "bus ff00 general.Off" in after
    assert after.index("Terminate") < after.index("general.Off")


def test_enter_prints_a_fresh_url(dist: Path) -> None:
    proc = start(dist)
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write("\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    assert line.startswith("http://127.0.0.1:47821/#t=") and len(line.strip()) == len("http://127.0.0.1:47821/#t=") + 64
    proc.send_signal(signal.SIGTERM)
    proc.communicate(timeout=10)


def test_refuses_to_start_without_a_built_app(tmp_path: Path) -> None:
    out = subprocess.run(
        [sys.executable, "-m", "server", "--demo", "--dist", str(tmp_path)],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert out.returncode == 2
    assert "headers.json" in out.stdout


def test_has_no_option_for_host_or_port() -> None:
    from server.__main__ import parse_args

    for flag in ("--host", "--port", "--bind", "--listen"):
        with pytest.raises(SystemExit):
            parse_args([flag, "0.0.0.0"])


def test_demo_mode_never_imports_hidapi(dist: Path) -> None:
    code = (
        "import sys, asyncio\n"
        "from server import fake\n"
        "from server.hasseb import Link\n"
        "d = fake.FakeHasseb(fake.FakeBus(fake.bench()))\n"
        "link = Link(lambda: d)\n"
        "assert link.poll()\n"
        "assert 'hid' not in sys.modules\n"
    )
    subprocess.run([sys.executable, "-c", code], cwd=REPO, check=True, timeout=20)
