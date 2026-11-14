"""Decoding forward frames with python-dali, so the server knows by itself what each frame is.

python-dali (LGPL-3.0) is used here as a run-time dependency, never copied. The server refuses a frame
that does not decode to a known command, and a frame whose flags differ from what it decodes to.
"""

from __future__ import annotations

from dali.command import Command
from dali.frame import ForwardFrame
from dali.gear import general
from dali.gear.general import EnableDeviceType


def _known(cmd: Command | None) -> Command | None:
    if cmd is None or type(cmd) is Command or isinstance(cmd, general.UnknownGearCommand):
        return None
    return cmd


def decode(a: int, b: int, previous: Command | None) -> Command | None:
    """The command a 16-bit frame carries, given the frame sent before it. None if it is not known.

    After ENABLE DEVICE TYPE, a standard command numbered below 224 is the part 102 command: the standard
    applies ENABLE DEVICE TYPE only to the application extended commands, 224 to 255. python-dali finds
    no command there. The app decodes it this way too (ADR 0011), so the server does the same.
    """
    device_type = previous.param if isinstance(previous, EnableDeviceType) else 0
    frame = ForwardFrame(16, [a, b])
    cmd = _known(Command.from_frame(frame, devicetype=device_type))
    standard = (a & 1) == 1 and not 0xA0 <= a <= 0xCB
    if cmd is None and device_type != 0 and standard and b < 224:
        cmd = _known(Command.from_frame(frame, devicetype=0))
    return cmd


def flags(cmd: Command) -> tuple[bool, bool]:
    """(send twice, expect a reply), as python-dali's own drivers decide them."""
    return bool(cmd.sendtwice), bool(cmd.is_query)


def name(cmd: Command) -> str:
    """The python-dali class as module.Class, for example general.DAPC or colour.Activate."""
    return f"{type(cmd).__module__.split('.')[-1]}.{type(cmd).__name__}"


TERMINATE = (0xA1, 0x00)
BROADCAST_OFF = (0xFF, 0x00)
