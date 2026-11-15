"""The messages between the app and the server (docs/SPEC.md section 9).

Fixed-size binary messages, each starting with a type byte. Integers are big-endian. Anything that is
not exactly one of these messages is a protocol error, and the server closes the connection.
"""

from __future__ import annotations

from dataclasses import dataclass

VERSION = 1
TOKEN_BYTES = 32

HELLO, SEND, PING, PANIC = 0x01, 0x02, 0x03, 0x04
WELCOME, RESULT, DEVICE, STOPPED, CLOSE = 0x81, 0x82, 0x83, 0x84, 0x8F

# RESULT statuses.
SENT, NO_REPLY, REPLY, FRAMING_ERROR, HASSEB_TIMEOUT, REFUSED, DROPPED = range(7)

# CLOSE reasons.
SILENCE, PROTOCOL_ERROR, SERVER_STOPPING, NOT_AUTHORISED, BUSY = 1, 2, 3, 4, 5


@dataclass(frozen=True)
class Hello:
    version: int
    token: bytes


@dataclass(frozen=True)
class Send:
    seq: int
    expect_reply: bool
    send_twice: bool
    a: int
    b: int


@dataclass(frozen=True)
class Ping:
    pass


@dataclass(frozen=True)
class Panic:
    pass


ClientMessage = Hello | Send | Ping | Panic


def parse_client(data: bytes) -> ClientMessage | None:
    """One client message, or None if the bytes are not exactly one."""
    if not isinstance(data, bytes) or not data:
        return None
    kind = data[0]
    if kind == HELLO and len(data) == 2 + TOKEN_BYTES:
        return Hello(data[1], data[2:])
    if kind == SEND and len(data) == 6:
        flags = data[3]
        if flags & ~0x03:
            return None
        return Send((data[1] << 8) | data[2], bool(flags & 1), bool(flags & 2), data[4], data[5])
    if kind == PING and len(data) == 1:
        return Ping()
    if kind == PANIC and len(data) == 1:
        return Panic()
    return None


def welcome(fw_major: int, fw_minor: int, attached: bool, token: bytes) -> bytes:
    assert len(token) == TOKEN_BYTES
    return bytes([WELCOME, VERSION, fw_major & 0xFF, fw_minor & 0xFF, 1 if attached else 0]) + token


def result(seq: int, status: int, data: int = 0) -> bytes:
    return bytes([RESULT, (seq >> 8) & 0xFF, seq & 0xFF, status, data & 0xFF if status == REPLY else 0])


def device(attached: bool) -> bytes:
    return bytes([DEVICE, 1 if attached else 0])


def stopped(terminate: int, off: int) -> bytes:
    return bytes([STOPPED, terminate, off])


def close(reason: int) -> bytes:
    return bytes([CLOSE, reason])
