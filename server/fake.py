"""A fake hasseb and a small gear model, for CI and the "demo hardware" start option.

The fake device speaks the firmware 2.x reports (idle reports, sequence numbers, send-twice done by the
device). The gear is our own small model of the bench: address 0 as a DA5-L in C2 presenting colour
temperature, address 1 in C5 presenting five RGBWAF channels. It is not the simulator in the app: level
changes happen at once, with no fades, so a fade set on the demo bench shows as a divergence in Both.

Commands are recognised by python-dali's class names (a run-time use of python-dali, nothing copied).

Known simplifications, none of which a test relies on: there is no 300 ms deaf time after RESET, no
fades, no power or bus failure, and memory banks other than bank 0 are absent.
"""

from __future__ import annotations

import random
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from dali.command import Command

from . import frames
from .hasseb import CMD_SEND, CMD_VERSION, PREAMBLE

MASK = 0xFF
YES = 0xFF

QUIRKS = ("level-offset", "slow", "wrong-sequence", "no-answer")

# Memory bank 0, read only. Placeholder contents: the part 102 version is 2.0 (8) at 0x16.
BANK0 = [
    0x1A, 0x00, 0x00, 0x06, 0x97, 0x56, 0x17, 0x41, 0x13, 0x24, 0x00, 0x00, 0x02, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x08, 0x08, 0x01, 0x00, 0x00,
]  # fmt: skip


@dataclass
class Gear:
    """One driver. Levels are arc levels 0 to 254."""

    short: int | None
    tc: bool
    channels: int
    assigned: list[int]
    seed: int
    level_offset: bool = False
    physical_minimum: int = 85
    level: int = 0
    last_active: int = 254
    min_level: int = 85
    max_level: int = 254
    power_on: int = 254
    system_failure: int = 254
    fade_time: int = 0
    fade_rate: int = 7
    extended_fade: int = 0
    groups: int = 0
    scenes: list[int] = field(default_factory=lambda: [MASK] * 16)
    dtr: list[int] = field(default_factory=lambda: [0, 0, 0])
    mirek: int = 370
    tc_limits: list[int] = field(default_factory=lambda: [154, 370, 154, 370])
    channel_levels: list[int] = field(default_factory=lambda: [254] * 6)
    temp_tc: int | None = None
    temp_channels: list[int | None] = field(default_factory=lambda: [None] * 6)
    rgbwaf_control: int = 0x3F
    gear_features: int = 1
    initialised: bool = False
    withdrawn: bool = False
    random_address: int = 0xFFFFFF
    search: list[int] = field(default_factory=lambda: [0xFF, 0xFF, 0xFF])
    walk: int | None = None
    walk_ok: bool = False
    temp_control: int | None = None

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)

    def hears(self, a: int) -> bool:
        if a >= 0xFE:
            return True
        if a in (0xFC, 0xFD):
            return self.short is None
        if a < 0x80:
            return self.short == a >> 1
        if a < 0xA0:
            return bool(self.groups & (1 << ((a >> 1) & 0x0F)))
        return False

    def clamp(self, level: int) -> int:
        if level == 0:
            return 0
        return max(self.min_level, min(self.max_level, level))

    def set_level(self, level: int) -> None:
        self.level = self.clamp(level)
        if self.level > 0:
            self.last_active = self.level
        if self.temp_tc is not None or any(c is not None for c in self.temp_channels):
            if self.gear_features & 1:
                self.activate()

    def activate(self) -> None:
        if self.temp_tc is not None:
            self.mirek = max(self.tc_limits[0], min(self.tc_limits[1], self.temp_tc))
        for i, c in enumerate(self.temp_channels):
            if c is not None:
                self.channel_levels[i] = c
        if self.temp_control is not None:
            self.rgbwaf_control = self.temp_control
        self.temp_tc = None
        self.temp_channels = [None] * 6
        self.temp_control = None

    def search_address(self) -> int:
        return (self.search[0] << 16) | (self.search[1] << 8) | self.search[2]

    def colour_value(self, selector: int) -> int | None:
        def sixteen(v: int) -> int:
            self.dtr[0] = v & 0xFF
            return (v >> 8) & 0xFF

        if selector in (2, 226):
            return sixteen(self.mirek if self.tc else 0xFFFF)
        if 128 <= selector <= 131:
            if not self.tc:
                return sixteen(0xFFFF)
            # Coolest, physical coolest, warmest, physical warmest.
            return sixteen([self.tc_limits[0], self.tc_limits[2], self.tc_limits[1], self.tc_limits[3]][selector - 128])
        if 233 <= selector <= 238 or 9 <= selector <= 14:
            i = selector - (233 if selector >= 233 else 9)
            return self.channel_levels[i] if i < self.channels else MASK
        if selector in (15, 239):
            return self.rgbwaf_control if self.channels else MASK
        if selector == 208:
            return 0x20 if self.temp_tc is not None else 0x80 if any(c is not None for c in self.temp_channels) else MASK
        if selector == 240:
            return 0x20 if self.tc else 0x80
        return MASK

    def handle(self, n: str, a: int, b: int) -> int | None:
        """Apply one command. Returns the answer byte, or None for no answer."""
        d = self.dtr
        on = self.level > 0
        # QUERY NEXT DEVICE TYPE answers only straight after QUERY DEVICE TYPE or itself.
        chained = self.walk_ok
        self.walk_ok = n in ("general.QueryDeviceType", "general.QueryNextDeviceType")
        if n == "general.DAPC":
            if b != MASK:
                self.set_level(b)
        elif n == "general.Off":
            self.level = 0
            if self.gear_features & 1:
                self.activate()
        elif n == "general.RecallMaxLevel":
            self.set_level(self.max_level)
        elif n == "general.RecallMinLevel":
            self.set_level(self.min_level)
        elif n in ("general.Up", "general.StepUp"):
            if on:
                self.set_level(min(self.max_level, self.level + 1))
        elif n in ("general.Down", "general.StepDown"):
            if on:
                self.set_level(max(self.min_level, self.level - 1))
        elif n == "general.OnAndStepUp":
            self.set_level(self.min_level if not on else min(self.max_level, self.level + 1))
        elif n == "general.StepDownAndOff":
            self.level = 0 if self.level <= self.min_level else self.level - 1
        elif n == "general.GoToLastActiveLevel":
            self.set_level(self.last_active)
        elif n == "general.GoToScene":
            if self.scenes[b & 0x0F] != MASK:
                self.set_level(self.scenes[b & 0x0F])
        elif n == "general.Reset":
            fresh = Gear(self.short, self.tc, self.channels, self.assigned, self.seed, self.level_offset)
            dtr = self.dtr
            self.__dict__.update(fresh.__dict__)
            # RESET leaves the DTRs as they were (dali.md section 5).
            self.dtr = dtr
            self.level = 254
        elif n == "general.StoreActualLevelInDTR0":
            d[0] = self.level
        elif n == "general.SetMaxLevel":
            self.max_level = max(self.min_level, min(254, d[0]))
            if self.level > self.max_level:
                self.level = self.max_level
        elif n == "general.SetMinLevel":
            self.min_level = max(self.physical_minimum, min(self.max_level, d[0]))
            if 0 < self.level < self.min_level:
                self.level = self.min_level
        elif n == "general.SetSystemFailureLevel":
            self.system_failure = d[0]
        elif n == "general.SetPowerOnLevel":
            self.power_on = d[0]
        elif n == "general.SetFadeTime":
            self.fade_time = min(15, d[0])
        elif n == "general.SetFadeRate":
            self.fade_rate = max(1, min(15, d[0]))
        elif n == "general.SetExtendedFadeTime":
            self.extended_fade = d[0] if d[0] <= 0x4F else 0
        elif n == "general.SetScene":
            self.scenes[b & 0x0F] = d[0]
        elif n == "general.RemoveFromScene":
            self.scenes[b & 0x0F] = MASK
        elif n == "general.AddToGroup":
            self.groups |= 1 << (b & 0x0F)
        elif n == "general.RemoveFromGroup":
            self.groups &= ~(1 << (b & 0x0F))
        elif n == "general.SetShortAddress":
            if d[0] == MASK:
                self.short = None
            elif d[0] & 1 and d[0] >> 1 < 64:
                self.short = d[0] >> 1
        # Queries.
        elif n == "general.QueryControlGearPresent":
            return YES
        elif n == "general.QueryStatus":
            return (0x04 if on else 0) | (0x40 if self.short is None else 0)
        elif n == "general.QueryLampPowerOn":
            return YES if on else None
        elif n == "general.QueryMissingShortAddress":
            return YES if self.short is None else None
        elif n == "general.QueryVersionNumber":
            return 0x08
        elif n == "general.QueryDeviceType":
            self.walk = None
            return 0xFF
        elif n == "general.QueryNextDeviceType":
            return self._next_type() if chained else None
        elif n == "general.QueryPhysicalMinimum":
            return self.physical_minimum
        elif n == "general.QueryActualLevel":
            # The quirk answers one step high while the driver is lit, as a miscalibrated driver might.
            return min(254, self.level + 1) if self.level_offset and self.level > 0 else self.level
        elif n == "general.QueryMaxLevel":
            return self.max_level
        elif n == "general.QueryMinLevel":
            return self.min_level
        elif n == "general.QueryPowerOnLevel":
            return self.power_on
        elif n == "general.QuerySystemFailureLevel":
            return self.system_failure
        elif n == "general.QueryFadeTimeFadeRate":
            return (self.fade_time << 4) | self.fade_rate
        elif n == "general.QueryExtendedFadeTime":
            return self.extended_fade
        elif n == "general.QuerySceneLevel":
            return self.scenes[b & 0x0F]
        elif n == "general.QueryGroupsZeroToSeven":
            return self.groups & 0xFF
        elif n == "general.QueryGroupsEightToFifteen":
            return (self.groups >> 8) & 0xFF
        elif n in ("general.QueryContentDTR0", "general.QueryContentDTR1", "general.QueryContentDTR2"):
            return d[int(n[-1])]
        elif n == "general.ReadMemoryLocation":
            if d[1] != 0 or d[0] >= len(BANK0):
                return None
            value = BANK0[d[0]]
            d[0] = min(255, d[0] + 1)
            return value
        # Device type 6.
        elif n == "led.QueryDimmingCurve":
            return 0
        elif n in ("led.QueryFastFadeTime", "led.QueryMinFastFadeTime"):
            return 0
        elif n == "led.QueryExtendedVersionNumber":
            return 1
        elif n in ("led.QueryGearType", "led.QueryFeatures", "led.QueryFailureStatus", "led.QueryOperatingMode"):
            return 0
        # Device type 8.
        elif n == "colour.QueryColourTypeFeatures":
            return (0x02 if self.tc else 0) | (self.channels << 5)
        elif n == "colour.QueryColourValue":
            return self.colour_value(d[0])
        elif n == "colour.QueryGearFeaturesStatus":
            return self.gear_features
        elif n == "colour.QueryRBGWAFControl":
            return self.rgbwaf_control if self.channels else None
        elif n == "colour.QueryAssignedColour":
            return self.assigned[d[0]] if d[0] < 6 else MASK
        elif n == "colour.QueryColourStatus":
            return 0x20 if self.tc else 0x80
        elif n == "colour.QueryExtendedVersionNumber":
            return 2
        elif n == "colour.SetTemporaryColourTemperature":
            if self.tc:
                self.temp_tc = (d[1] << 8) | d[0]
        elif n == "colour.SetTemporaryRGBDimLevel":
            for i in range(3):
                self.temp_channels[i] = d[i]
        elif n == "colour.SetTemporaryWAFDimLevel":
            for i in range(3):
                self.temp_channels[3 + i] = d[i]
        elif n == "colour.SetTemporaryRGBWAFControl":
            self.temp_control = d[0]
        elif n == "colour.Activate":
            self.activate()
        elif n == "colour.StoreColourTemperatureTcLimit":
            if d[2] <= 3:
                # DTR2: 0 coolest, 1 warmest, 2 physical coolest, 3 physical warmest.
                self.tc_limits[d[2]] = (d[1] << 8) | d[0]
        elif n == "colour.StoreGearFeaturesStatus":
            self.gear_features = d[0] & 1
        elif n == "colour.ColourTemperatureTcStepCooler":
            self.mirek = max(self.tc_limits[0], self.mirek - 1)
        elif n == "colour.ColourTemperatureTcStepWarmer":
            self.mirek = min(self.tc_limits[1], self.mirek + 1)
        elif n == "colour.CopyReportToTemporary":
            self.temp_tc = self.mirek if self.tc else None
        return None

    def _next_type(self) -> int:
        # QUERY NEXT DEVICE TYPE walks DT6 then DT8, then answers 254.
        self.walk = {None: 6, 6: 8, 8: 254, 254: 254}[self.walk]
        return self.walk

    def special(self, n: str, b: int) -> int | None:
        """Special commands: every gear hears them, whatever its address."""
        if n == "general.Terminate":
            self.initialised = False
            self.withdrawn = False
        elif n == "general.DTR0":
            self.dtr[0] = b
        elif n == "general.DTR1":
            self.dtr[1] = b
        elif n == "general.DTR2":
            self.dtr[2] = b
        elif n == "general.Initialise":
            if b == 0 or (b == 0xFF and self.short is None) or (self.short is not None and b == (self.short << 1) | 1):
                self.initialised = True
                self.withdrawn = False
        elif not self.initialised:
            return None
        elif n == "general.Randomise":
            self.random_address = self.rng.randrange(0, 0x1000000)
        elif n == "general.SearchaddrH":
            self.search[0] = b
        elif n == "general.SearchaddrM":
            self.search[1] = b
        elif n == "general.SearchaddrL":
            self.search[2] = b
        elif n == "general.Compare":
            return YES if not self.withdrawn and self.random_address <= self.search_address() else None
        elif n == "general.Withdraw":
            if self.random_address == self.search_address():
                self.withdrawn = True
        elif n == "general.ProgramShortAddress":
            if self.random_address == self.search_address():
                self.short = None if b == MASK else b >> 1
        elif n == "general.VerifyShortAddress":
            return YES if self.short is not None and b == (self.short << 1) | 1 else None
        elif n == "general.QueryShortAddress":
            if self.random_address == self.search_address():
                return MASK if self.short is None else (self.short << 1) | 1
        return None


def bench(quirk: str | None = None, unaddressed: bool = False) -> list[Gear]:
    gear = [
        Gear(short=0, tc=True, channels=0, assigned=[MASK] * 6, seed=1, level_offset=quirk == "level-offset"),
        Gear(short=1, tc=False, channels=5, assigned=[1, 2, 3, 4, 5, MASK], seed=2, level_offset=quirk == "level-offset"),
    ]
    if unaddressed:
        gear.append(Gear(short=None, tc=True, channels=0, assigned=[MASK] * 6, seed=3))
    return gear


class FakeBus:
    """Every gear hears every frame. Two answers at once are a framing error."""

    def __init__(self, gear: list[Gear], echo: Callable[[str], None] | None = None):
        self.gear = gear
        self.echo = echo
        self.previous: Command | None = None
        self.log: list[tuple[int, int, str]] = []

    def deliver(self, a: int, b: int) -> tuple[int, int | None]:
        """One forward frame. Returns (number of answers, the answer if exactly one)."""
        cmd = frames.decode(a, b, self.previous)
        self.previous = cmd
        n = frames.name(cmd) if cmd is not None else "unknown"
        self.log.append((a, b, n))
        if self.echo is not None:
            self.echo(f"bus {a:02x}{b:02x} {n}")
        if cmd is None:
            return 0, None
        answers: list[int] = []
        for g in self.gear:
            special = 0xA0 <= a <= 0xCB and a & 1
            r = g.special(n, b) if special else (g.handle(n, a, b) if g.hears(a) else None)
            if r is not None:
                answers.append(r)
        return len(answers), answers[0] if len(answers) == 1 else None


class FakeHasseb:
    """A hasseb on a fake bus. Thread-safe enough for the server's one HID thread and a test thread."""

    def __init__(self, bus: FakeBus, quirk: str | None = None, firmware: tuple[int, int] = (2, 4)):
        self.bus = bus
        self.quirk = quirk
        self.firmware = firmware
        self.plugged = True
        self.reports: deque[bytes] = deque()
        self.lock = threading.Lock()
        self.reads = 0
        self.wrong_sent = False

    def write(self, report: bytes) -> None:
        if not self.plugged:
            raise OSError("the fake hasseb is unplugged")
        if len(report) != 10 or report[0] != PREAMBLE:
            return
        kind, seq = report[1], report[2]
        if kind == CMD_VERSION:
            if self.quirk == "no-answer":
                return
            self._push(bytes([PREAMBLE, CMD_VERSION, seq, self.firmware[0], self.firmware[1], 0, 0, 0, 0, 0]))
            return
        if kind != CMD_SEND:
            return
        a, b = report[7], report[8]
        count, answer = self.bus.deliver(a, b)
        if report[6]:
            count, answer = self.bus.deliver(a, b)
        if self.quirk == "no-answer":
            return
        late = self.quirk == "slow"
        if self.quirk == "wrong-sequence" and not self.wrong_sent:
            # One stray report for another sequence number, which the server must drop.
            self.wrong_sent = True
            self._push(bytes([PREAMBLE, CMD_SEND, (seq + 7) % 255 + 1, 2, 1, 0x55, 0, 0, 0, 0]))
        if not report[4]:
            status, length, data = 1, 0, 0
        elif count == 0:
            status, length, data = 1, 0, 0
        elif count == 1 and answer is not None:
            status, length, data = 2, 1, answer
        else:
            status, length, data = 3, 0, 0
        report = bytes([PREAMBLE, CMD_SEND, seq, status, length, data, 0, 0, 0, 0])
        if late:
            # The answer comes after the server's 250 ms timeout, so the server must drop it.
            threading.Timer(0.3, self._push, (report,)).start()
        else:
            self._push(report)

    def _push(self, report: bytes) -> None:
        with self.lock:
            self.reports.append(report)

    def read(self, timeout_ms: int) -> bytes | None:
        if not self.plugged:
            raise OSError("the fake hasseb is unplugged")
        self.reads += 1
        # Every other read is an idle report, as the old firmware sent them continuously.
        if self.reads % 2 == 0:
            return bytes([PREAMBLE, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        with self.lock:
            if self.reports:
                return self.reports.popleft()
        time.sleep(min(timeout_ms, 5) / 1000)
        return None

    def close(self) -> None:
        pass
