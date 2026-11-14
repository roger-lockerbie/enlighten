"""U-server, the session: the token, one client, message lengths, flags, the queue, and every stop."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from websockets.exceptions import ConnectionClosed

from server import protocol as p
from server import session

from .conftest import recv, send, server

STOP = ["general.Terminate", "general.Off"]


async def welcomed(ws) -> bytes:
    w = await recv(ws)
    assert w[0] == p.WELCOME and len(w) == 37
    return w


async def closed_with(ws, reason: int) -> None:
    assert await recv(ws) == p.close(reason)
    with pytest.raises(ConnectionClosed):
        await asyncio.wait_for(ws.recv(), 2)


def test_welcome_and_a_query(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                w = await welcomed(ws)
                assert w[1:5] == bytes([p.VERSION, 2, 4, 1])
                assert w[5:] != s.token
                await ws.send(send(0x1234, 0x03, 0xA0, expect_reply=True))  # QUERY ACTUAL LEVEL A1
                assert await recv(ws) == p.result(0x1234, p.REPLY, 0)
                await ws.send(send(7, 0x02, 100))  # DAPC A1 100
                assert await recv(ws) == p.result(7, p.SENT)
                await ws.send(send(8, 0x03, 0xA0, expect_reply=True))
                assert await recv(ws) == p.result(8, p.REPLY, 100)
                await ws.send(send(9, 0x7F, 0xA0, expect_reply=True))  # nobody at A63
                assert await recv(ws) == p.result(9, p.NO_REPLY)

    asyncio.run(go())


def test_two_answers_at_once_are_a_framing_error(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send(send(1, 0xFF, 0xA0, expect_reply=True))  # QUERY ACTUAL LEVEL broadcast
                assert await recv(ws) == p.result(1, p.FRAMING_ERROR)

    asyncio.run(go())


@pytest.mark.parametrize(
    "token",
    [bytes(32), b"\x01" * 32],
)
def test_refuses_a_wrong_token(dist: Path, token: bytes) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client(token=token) as ws:
                await closed_with(ws, p.NOT_AUTHORISED)
            assert s.hub.client is None

    asyncio.run(go())


def test_refuses_a_connection_with_no_hello_in_a_second(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client(hello=False) as ws:
                await closed_with(ws, p.NOT_AUTHORISED)

    asyncio.run(go())


def test_the_url_token_works_once_and_welcome_tokens_rotate(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                first = (await welcomed(ws))[5:]
            await asyncio.sleep(0.05)
            # The URL token is used up, even after the first client has gone.
            async with s.client() as ws:
                await closed_with(ws, p.NOT_AUTHORISED)
            # The token from WELCOME works for a reconnect, and brings a new one.
            async with s.client(token=first) as ws:
                second = (await welcomed(ws))[5:]
            assert second != first
            await asyncio.sleep(0.05)
            async with s.client(token=first) as ws:
                await closed_with(ws, p.NOT_AUTHORISED)
            # A fresh URL token, as Enter in the terminal prints, works once.
            fresh = s.hub.new_url_token()
            async with s.client(token=fresh) as ws:
                await welcomed(ws)

    asyncio.run(go())


def test_one_client_at_a_time(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            # A connection that has not passed HELLO holds nothing.
            async with s.client(hello=False):
                async with s.client() as a:
                    w = await welcomed(a)
                    async with s.client(token=w[5:]) as b:
                        await closed_with(b, p.BUSY)
                    await a.send(send(1, 0x01, 0xA0, expect_reply=True))
                    assert (await recv(a))[3] == p.REPLY

    asyncio.run(go())


@pytest.mark.parametrize(
    "message",
    [
        b"",
        bytes([p.SEND, 0, 1, 0, 0xFF]),
        bytes([p.SEND, 0, 1, 0, 0xFF, 0, 0]),
        bytes([p.SEND, 0, 1, 4, 0xFF, 0]),
        bytes([p.PING, 0]),
        bytes([p.PANIC, 0]),
        bytes([0x05]),
        bytes([p.WELCOME] + [0] * 36),
        bytes([p.HELLO, p.VERSION]) + bytes(32),
    ],
)
def test_closes_on_a_message_of_the_wrong_shape(dist: Path, message: bytes) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send(message)
                await closed_with(ws, p.PROTOCOL_ERROR)
            await asyncio.sleep(0.1)
            assert s.frames() == STOP

    asyncio.run(go())


def test_closes_on_text_and_on_oversized_messages(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send("hello")
                await closed_with(ws, p.PROTOCOL_ERROR)
            async with s.client(hello=False) as ws:
                await ws.send(bytes(65))
                with pytest.raises(ConnectionClosed):
                    while True:
                        await asyncio.wait_for(ws.recv(), 2)

    asyncio.run(go())


def test_refuses_a_hello_with_another_version(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client(hello=False) as ws:
                await ws.send(bytes([p.HELLO, 2]) + s.token)
                await closed_with(ws, p.PROTOCOL_ERROR)

    asyncio.run(go())


def test_refuses_flags_that_differ_from_the_decoding(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                # A query sent as a command, a command sent as a query.
                await ws.send(send(1, 0x01, 0xA0))
                assert await recv(ws) == p.result(1, p.REFUSED)
                await ws.send(send(2, 0x01, 0x05, expect_reply=True))
                assert await recv(ws) == p.result(2, p.REFUSED)
                # SET MAX LEVEL must be sent twice, and OFF must not.
                await ws.send(send(3, 0x01, 0x2A))
                assert await recv(ws) == p.result(3, p.REFUSED)
                await ws.send(send(4, 0x01, 0x00, send_twice=True))
                assert await recv(ws) == p.result(4, p.REFUSED)
                # A reserved command number does not decode.
                await ws.send(send(5, 0x01, 0x0E))
                assert await recv(ws) == p.result(5, p.REFUSED)
                assert s.frames() == []

    asyncio.run(go())


def test_decodes_device_type_commands_after_enable_device_type(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                # QUERY COLOUR TYPE FEATURES (DT8 opcode 0xF9) without ENABLE DEVICE TYPE 8 first: refused.
                await ws.send(send(1, 0x03, 0xF9, expect_reply=True))
                assert await recv(ws) == p.result(1, p.REFUSED)
                await ws.send(send(2, 0xC1, 0x08))
                assert await recv(ws) == p.result(2, p.SENT)
                await ws.send(send(3, 0x03, 0xF9, expect_reply=True))
                assert await recv(ws) == p.result(3, p.REPLY, 5 << 5)
                # The context is the frame just before: a second DT8 query needs its own ENABLE.
                await ws.send(send(4, 0x03, 0xF9, expect_reply=True))
                assert await recv(ws) == p.result(4, p.REFUSED)

    asyncio.run(go())


def test_a_ping_keeps_the_session_and_silence_stops_it(dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(session, "SILENCE_S", 0.4)

    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                for _ in range(4):
                    await asyncio.sleep(0.2)
                    await ws.send(bytes([p.PING]))
                await ws.send(send(1, 0x02, 100))
                assert await recv(ws) == p.result(1, p.SENT)
                assert await recv(ws, 3) == p.stopped(p.SENT, p.SENT)
                await closed_with(ws, p.SILENCE)
            assert s.frames() == ["general.DAPC", *STOP]
            assert s.bus.gear[1].level == 0

    asyncio.run(go())


def test_the_silence_limit_is_three_seconds() -> None:
    assert session.SILENCE_S == 3.0
    assert session.HELLO_TIMEOUT_S == 1.0
    assert session.QUEUE_LIMIT == 8


def test_closing_the_connection_turns_the_bus_off(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send(send(1, 0x02, 120))
                await recv(ws)
            for _ in range(100):
                if s.frames()[-2:] == STOP:
                    break
                await asyncio.sleep(0.02)
            assert s.frames() == ["general.DAPC", *STOP]
            assert s.bus.gear[1].level == 0

    asyncio.run(go())


def test_panic_with_a_full_queue_sends_nothing_queued_after_the_off(dist: Path) -> None:
    async def go() -> None:
        # Each frame takes the full 250 ms timeout, so the queue fills.
        async with server(dist, quirk="slow") as s:
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send(send(0, 0x02, 100))
                await asyncio.sleep(0.05)
                for seq in range(1, 10):
                    await ws.send(send(seq, 0x02, 100 + seq))
                # One on the hasseb, eight queued, the tenth refused.
                await ws.send(bytes([p.PANIC]))
                got = [await recv(ws) for _ in range(11)]
                results = {m[2]: m[3] for m in got if m[0] == p.RESULT}
                assert got[-1] == p.stopped(p.HASSEB_TIMEOUT, p.HASSEB_TIMEOUT)
                assert results[0] == p.HASSEB_TIMEOUT
                assert sorted(k for k, v in results.items() if v == p.DROPPED) == list(range(1, 9))
                assert results[9] == p.REFUSED
                # The frame on the hasseb went first, then the stop, and nothing queued after it.
                assert s.frames() == ["general.DAPC", *STOP]
                # The session stays open after a panic.
                await ws.send(bytes([p.PING]))

    asyncio.run(go())


def test_panic_lets_the_frame_on_the_hasseb_finish_first(dist: Path) -> None:
    async def go() -> None:
        async with server(dist, quirk="slow") as s:
            assert s.hub.attached
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send(send(1, 0x01, 0x2A, send_twice=True))  # SET MAX LEVEL A0, sent twice
                await asyncio.sleep(0.05)
                await ws.send(bytes([p.PANIC]))
                first = await recv(ws, 3)
                second = await recv(ws, 3)
                assert first == p.result(1, p.HASSEB_TIMEOUT)
                assert second[0] == p.STOPPED
                # Both copies of the pair, then TERMINATE and OFF: never between the copies.
                assert s.frames() == ["general.SetMaxLevel", "general.SetMaxLevel", *STOP]

    asyncio.run(go())


def test_shutdown_stops_and_tells_the_client(dist: Path) -> None:
    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                await s.hub.shutdown()
                assert await recv(ws) == p.stopped(p.SENT, p.SENT)
                await closed_with(ws, p.SERVER_STOPPING)
            assert s.frames()[-2:] == STOP

    asyncio.run(go())


def test_the_hasseb_going_and_coming(dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(session, "DEVICE_POLL_S", 0.05)

    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                s.device.plugged = False
                await ws.send(send(1, 0x01, 0xA0, expect_reply=True))
                got = {await recv(ws), await recv(ws)}
                assert got == {p.result(1, p.HASSEB_TIMEOUT), p.device(False)}
                s.device.plugged = True
                assert await recv(ws) == p.device(True)
                await ws.send(send(2, 0x01, 0xA0, expect_reply=True))
                assert (await recv(ws))[3] == p.REPLY

    asyncio.run(go())


def test_drops_reports_for_other_sequence_numbers(dist: Path) -> None:
    async def go() -> None:
        async with server(dist, quirk="wrong-sequence") as s:
            async with s.client() as ws:
                await welcomed(ws)
                await ws.send(send(1, 0x01, 0xA0, expect_reply=True))
                assert await recv(ws) == p.result(1, p.REPLY, 0)

    asyncio.run(go())


def test_a_hasseb_that_never_answers_is_a_timeout(dist: Path) -> None:
    async def go() -> None:
        async with server(dist, quirk="no-answer") as s:
            assert not s.hub.attached
            async with s.client() as ws:
                w = await welcomed(ws)
                assert w[2:5] == bytes([0, 0, 0])
                await ws.send(send(1, 0x01, 0xA0, expect_reply=True))
                assert await recv(ws) == p.result(1, p.HASSEB_TIMEOUT)

    asyncio.run(go())


def test_an_idle_session_notices_an_unplug(dist: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(session, "DEVICE_POLL_S", 0.05)

    async def go() -> None:
        async with server(dist) as s:
            async with s.client() as ws:
                await welcomed(ws)
                s.device.plugged = False
                assert await recv(ws) == p.device(False)
                s.device.plugged = True
                assert await recv(ws) == p.device(True)

    asyncio.run(go())
