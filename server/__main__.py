"""Start the hardware server: `python -m server` from the repository root.

It binds to 127.0.0.1:47821 only and has no option to listen anywhere else. For remote use, forward the
port over SSH (README). It prints a one-time URL with the session token. Press Enter to print a fresh
one, for a reload. In demo mode, `unplug` and `plug` on the same terminal take the fake hasseb away and
bring it back.
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys
import threading
from pathlib import Path

from . import fake
from .app import running
from .hasseb import Link, open_real
from .session import Hub
from .web import HOST, PORT, Site, SiteError


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="python -m server", description="Enlighten's hardware server.")
    ap.add_argument("--dist", default="dist", help="the built app (default: dist)")
    ap.add_argument("--demo", action="store_true", help="use a fake hasseb and fake bench, no device")
    ap.add_argument("--demo-quirk", choices=fake.QUIRKS, help="make the fake differ, for tests")
    ap.add_argument("--demo-unaddressed", action="store_true", help="add a fake driver with no address")
    ap.add_argument("--trace", action="store_true", help="print every hasseb report but idle ones")
    return ap.parse_args(argv)


def say(text: str) -> None:
    print(text, flush=True)


def url(token: bytes) -> str:
    return f"http://{HOST}:{PORT}/#t={token.hex()}"


async def run(args: argparse.Namespace) -> int:
    try:
        site = Site(Path(args.dist), PORT)
    except SiteError as e:
        say(f"enlighten: {e}")
        return 2

    trace = say if args.trace else None
    device: fake.FakeHasseb | None = None
    if args.demo:
        bus = fake.FakeBus(fake.bench(args.demo_quirk, args.demo_unaddressed), echo=say)
        device = fake.FakeHasseb(bus, args.demo_quirk)
        demo = device
        link = Link(lambda: demo if demo.plugged else None, trace)
    else:
        link = Link(open_real, trace)
    hub = Hub(link, log=lambda t: say(f"enlighten: {t}"))

    loop = asyncio.get_running_loop()
    stopping = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        loop.add_signal_handler(sig, stopping.set)

    def stdin() -> None:
        for line in sys.stdin:
            word = line.strip()
            if word == "":
                loop.call_soon_threadsafe(lambda: say(url(hub.new_url_token())))
            elif device is not None and word == "unplug":
                device.plugged = False
            elif device is not None and word == "plug":
                device.plugged = True

    async with running(site, hub, PORT):
        say(f"enlighten: serving {args.dist} on {HOST}:{PORT}{' with a fake hasseb' if args.demo else ''}")
        say("enlighten: open this address. It works once. Press Enter for a fresh one.")
        say(url(hub.new_url_token()))
        threading.Thread(target=stdin, daemon=True).start()
        await stopping.wait()
        say("enlighten: stopping")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return asyncio.run(run(args))
    except OSError as e:
        say(f"enlighten: cannot listen on {HOST}:{PORT}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
