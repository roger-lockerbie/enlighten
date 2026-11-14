"""G-hasseb and D-live: the report builder against python-dali's own reports, and the server's decoding
of every supported command against the golden fixtures."""

from __future__ import annotations

import json

import pytest
from dali.gear.general import EnableDeviceType

from server import frames
from server import protocol as p
from server.hasseb import Hasseb, next_sequence, outcome, send_report, version_request

from .conftest import REPO

GOLDEN = REPO / "tests" / "golden"
HASSEB = json.loads((GOLDEN / "hasseb.json").read_text())
FRAMES = json.loads((GOLDEN / "frames.json").read_text())


@pytest.mark.parametrize("case", HASSEB["send"], ids=lambda c: c["pd"])
def test_send_reports_match_python_dali(case: dict) -> None:
    a, b = case["frame"]
    report = case["report"]
    device_type = {"colour": 8, "led": 6}.get(case["pd"].split(".")[0])
    cmd = frames.decode(a, b, None if device_type is None else EnableDeviceType(device_type))
    assert cmd is not None
    twice, reply = frames.flags(cmd)
    assert list(send_report(report[2], a, b, reply, twice)) == report


def test_sequence_numbers_wrap_from_255_to_1_never_0() -> None:
    wrap = HASSEB["sequenceWrap"]
    seqs = [r[2] for r in wrap]
    assert 0 not in seqs
    assert next_sequence(254) == 255 and next_sequence(255) == 1 and next_sequence(0) == 1
    assert [next_sequence(254), next_sequence(next_sequence(254)), 2] == seqs


def test_firmware_version_request_and_reply() -> None:
    fw = HASSEB["firmware"]
    assert list(version_request(fw["request"][2])) == fw["request"]

    class Device:
        def __init__(self):
            self.written = []

        def write(self, r):
            self.written.append(r)

        def read(self, timeout_ms):
            return bytes([0xAA, 0x02, self.written[-1][2], 2, 4, 0, 0, 0, 0, 0])

        def close(self):
            pass

    assert Hasseb(Device()).firmware_version() == (2, 4)


def test_answers_from_transmission_reports() -> None:
    by_kind = {}
    for case in HASSEB["extract"]:
        by_kind.setdefault(case["pd"]["kind"], []).append(bytes(case["report"]))
    assert outcome(by_kind["HassebDALIUSBNoAnswer"][0]) == (p.NO_REPLY, 0)
    assert [outcome(r) for r in by_kind["reply"]] == [(p.REPLY, 127), (p.REPLY, 255)]
    assert outcome(by_kind["framing-error"][0]) == (p.FRAMING_ERROR, 0)
    # Too early is an answer that is not clean: a framing error, not "no answer".
    assert outcome(by_kind["HassebDALIUSBAnswerTooEarly"][0]) == (p.FRAMING_ERROR, 0)
    # Sniffer reports are not answers to anything sent.
    assert outcome(by_kind["HassebDALIUSBSnifferByte"][0]) is None
    assert outcome(by_kind["HassebDALIUSBSnifferByteError"][0]) is None
    # A departure from python-dali, on purpose: a length byte of 8 (bits, as the vendor's note says)
    # is accepted as a reply. python-dali accepts only 1. Which one the device sends is a hardware-day item.
    eight = [r for r in by_kind["invalid"] if r[1] == 0x07]
    assert [outcome(r) for r in eight] == [(p.REPLY, 127)]
    assert outcome(bytes([0xAA, 0x07, 3, 2, 2, 9, 0, 0, 0, 0])) == (p.FRAMING_ERROR, 0)
    assert outcome(bytes([0xAA, 0x07, 3, 9, 0, 0, 0, 0, 0, 0])) == (p.HASSEB_TIMEOUT, 0)


def test_transmit_drops_idle_and_unmatched_reports() -> None:
    class Device:
        def __init__(self):
            self.queue = []

        def write(self, r):
            seq = r[2]
            self.queue = [
                bytes([0xAA, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                bytes([0xAA, 0x07, (seq % 255) + 1, 2, 1, 9, 0, 0, 0, 0]),
                bytes([0xAA, 0x07, seq, 5, 1, 7, 0, 0, 0, 0]),
                b"\x00\x01",
                bytes([0xAA, 0x07, seq, 2, 1, 42, 0, 0, 0, 0]),
            ]

        def read(self, timeout_ms):
            return self.queue.pop(0) if self.queue else None

        def close(self):
            pass

    h = Hasseb(Device())
    assert h.transmit(0x01, 0xA0, True, False) == (p.REPLY, 42)
    assert h.idle == 1


def test_transmit_times_out_when_the_hasseb_says_nothing() -> None:
    class Silent:
        def write(self, r):
            pass

        def read(self, timeout_ms):
            return None

        def close(self):
            pass

    assert Hasseb(Silent()).transmit(0x01, 0xA0, True, False) == (p.HASSEB_TIMEOUT, 0)


@pytest.mark.parametrize("case", FRAMES["commands"], ids=lambda c: f"{c['pd']}-{c['frame']}")
def test_server_decoding_matches_the_fixtures(case: dict) -> None:
    """D-live: the server works out send-twice and expect-reply exactly as python-dali does."""
    a, b = case["frame"]
    previous = EnableDeviceType(case["deviceType"]) if case["deviceType"] else None
    cmd = frames.decode(a, b, previous)
    assert cmd is not None
    assert frames.name(cmd) == case["pd"]
    assert frames.flags(cmd) == (case["sendTwice"], case["reply"] != "none")
