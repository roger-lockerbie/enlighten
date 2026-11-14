"""The hasseb USB DALI Master, firmware 2.x (docs/research/hasseb.md section 2).

The server builds every 10-byte report itself, sends one frame at a time, and matches each answer to
the frame by its sequence number. Idle reports, sniffer reports and reports for other sequence numbers
are dropped without logging each one. "The gear said nothing" (status 1) is kept apart from "the hasseb
said nothing" (a timeout), because the safety profile's read-backs depend on the difference.

Every call here blocks. The session runs them on one thread, so only one thing touches the device at a
time.
"""

from __future__ import annotations

import time
from typing import Callable, Protocol

from . import protocol as p

VENDOR_ID = 0x04CC
PRODUCT_ID = 0x0802

PREAMBLE = 0xAA
CMD_VERSION = 0x02
CMD_SEND = 0x07
REPORT_IDLE = 0x00

# The firmware repeats a send-twice frame itself after this many ms. python-dali uses 10. Whether that
# is the whole gap between the frames is a hardware-day item (TEST_PLAN section 10, part 3).
SEND_TWICE_DELAY_MS = 10

TIMEOUT_S = 0.25


class HidDevice(Protocol):
    def write(self, report: bytes) -> None: ...

    def read(self, timeout_ms: int) -> bytes | None: ...

    def close(self) -> None: ...


def next_sequence(seq: int) -> int:
    """1 to 255, then back to 1. Zero is not an allowed sequence number."""
    return 1 if seq >= 255 else seq + 1


def send_report(seq: int, a: int, b: int, expect_reply: bool, send_twice: bool) -> bytes:
    return bytes(
        [
            PREAMBLE,
            CMD_SEND,
            seq,
            16,
            1 if expect_reply else 0,
            0,
            SEND_TWICE_DELAY_MS if send_twice else 0,
            a,
            b,
            0,
        ]
    )


def version_request(seq: int) -> bytes:
    return bytes([PREAMBLE, CMD_VERSION, seq, 0, 0, 0, 0, 0, 0, 0])


def outcome(report: bytes) -> tuple[int, int] | None:
    """The RESULT status and data for a transmission report, or None if it is not an answer."""
    status = report[3]
    if status == 1:
        return p.NO_REPLY, 0
    if status == 2:
        # python-dali accepts a length of 1. The vendor's note says the length is in bits, so 8 is
        # accepted too. Which one the device sends is a hardware-day item.
        if report[4] in (1, 8):
            return p.REPLY, report[5]
        return p.FRAMING_ERROR, 0
    if status in (3, 4):
        # An invalid answer, or one that came too early: something answered, and not cleanly.
        return p.FRAMING_ERROR, 0
    if status in (5, 6):
        return None  # Sniffer reports are not answers.
    return p.HASSEB_TIMEOUT, 0


class Hasseb:
    def __init__(self, device: HidDevice, trace: Callable[[str], None] | None = None):
        self.device = device
        self.seq = 0
        self.trace = trace
        self.idle = 0

    def _next(self) -> int:
        self.seq = next_sequence(self.seq)
        return self.seq

    def _await(self, kind: int, seq: int) -> bytes | None:
        """Read until the report for this sequence number arrives, or the timeout."""
        deadline = time.monotonic() + TIMEOUT_S
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            report = self.device.read(max(1, int(left * 1000)))
            if not report or len(report) < 10 or report[0] != PREAMBLE:
                continue
            if report[1] == REPORT_IDLE:
                self.idle += 1
                continue
            if self.trace is not None:
                self.trace("report " + " ".join(f"{x:02x}" for x in report[:10]))
            if report[1] == kind and report[2] == seq:
                return bytes(report[:10])

    def firmware_version(self) -> tuple[int, int] | None:
        seq = self._next()
        self.device.write(version_request(seq))
        report = self._await(CMD_VERSION, seq)
        return None if report is None else (report[3], report[4])

    def transmit(self, a: int, b: int, expect_reply: bool, send_twice: bool) -> tuple[int, int]:
        """Send one frame and wait for its report. Returns a RESULT status and data byte."""
        seq = self._next()
        # The report is written as python-dali writes it: ten bytes starting 0xAA. How hidapi treats a
        # first byte that is not a report ID is a hardware-day item (docs/research/hasseb.md section 3).
        self.device.write(send_report(seq, a, b, expect_reply, send_twice))
        while True:
            report = self._await(CMD_SEND, seq)
            if report is None:
                return p.HASSEB_TIMEOUT, 0
            answer = outcome(report)
            if answer is not None:
                return answer


class Link:
    """The hasseb if one is attached. It reopens the device when it comes back."""

    def __init__(self, opener: Callable[[], HidDevice | None], trace: Callable[[str], None] | None = None):
        self.opener = opener
        self.trace = trace
        self.hasseb: Hasseb | None = None
        self.firmware: tuple[int, int] = (0, 0)

    @property
    def attached(self) -> bool:
        return self.hasseb is not None

    def poll(self) -> bool:
        """Open the device if it is not open. Returns whether it is attached."""
        if self.hasseb is None:
            try:
                device = self.opener()
            except OSError:
                device = None
            if device is not None:
                hasseb = Hasseb(device, self.trace)
                try:
                    version = hasseb.firmware_version()
                except OSError:
                    version = None
                if version is None:
                    device.close()
                    return False
                self.hasseb = hasseb
                self.firmware = version
        return self.hasseb is not None

    def transmit(self, a: int, b: int, expect_reply: bool, send_twice: bool) -> tuple[int, int]:
        if self.hasseb is None and not self.poll():
            return p.HASSEB_TIMEOUT, 0
        assert self.hasseb is not None
        try:
            return self.hasseb.transmit(a, b, expect_reply, send_twice)
        except (OSError, ValueError):
            self.drop()
            return p.HASSEB_TIMEOUT, 0

    def drop(self) -> None:
        if self.hasseb is not None:
            try:
                self.hasseb.device.close()
            except OSError:
                pass
        self.hasseb = None
        self.firmware = (0, 0)


def open_real() -> HidDevice | None:
    """Open the hasseb through hidapi. hidapi is imported only here, so demo mode never needs it."""
    import hid  # noqa: PLC0415

    device = hid.device()
    try:
        device.open(VENDOR_ID, PRODUCT_ID)
    except OSError:
        return None
    return _RealHid(device)


class _RealHid:
    def __init__(self, device):
        self.device = device

    def write(self, report: bytes) -> None:
        if self.device.write(list(report)) < 0:
            raise OSError("write to the hasseb failed")

    def read(self, timeout_ms: int) -> bytes | None:
        data = self.device.read(10, timeout_ms)
        return bytes(data) if data else None

    def close(self) -> None:
        self.device.close()
