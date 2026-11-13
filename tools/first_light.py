"""First light for the LED test bench's two Skydance DA5-L dimmers.

Runs through the hasseb USB DALI Master. Before running it:
  1. Set DA5-L A to light type C2, PWM FA, address 00.
  2. Set DA5-L B to light type C5, PWM FA, address 01.
  3. Unroll both DALI tapes and plug them in with the power off, then power up.
Install once:   py -m pip install python-dali hidapi      (macOS: python3 -m pip ...)
Run:            py dali_first_light.py                     (macOS: python3 dali_first_light.py)
Each step prints what you should see, then waits for Enter.
"""
from dali.address import GearBroadcast, GearShort
from dali.driver.hasseb import SyncHassebDALIUSBDriver
from dali.gear.colour import Activate, SetTemporaryRGBDimLevel, SetTemporaryWAFDimLevel
from dali.gear.general import DAPC, DTR0, DTR1, DTR2, Off
from dali.gear.sequences import SetDT8ColourValueTc

FULL = 254          # DALI's top level
A, B = GearShort(0), GearShort(1)


def step(text):
    input(f"\n{text}\n    Press Enter for the next step... ")


def rgbwaf(address, r, g, b, w, a, f):
    """One DT8 colour mix: three primaries, then white, amber and free colour."""
    yield DTR0(r)
    yield DTR1(g)
    yield DTR2(b)
    yield SetTemporaryRGBDimLevel(address)
    yield DTR0(w)
    yield DTR1(a)
    yield DTR2(f)
    yield SetTemporaryWAFDimLevel(address)
    yield Activate(address)


bus = SyncHassebDALIUSBDriver()
if not bus.device_found:
    raise SystemExit("No hasseb found. Check its USB cable, then run this again.")
print("hasseb found.")

bus.send(DAPC(GearBroadcast(), FULL))
step("1. Both DALI tapes should be fully on.")
bus.send(Off(GearBroadcast()))
step("2. Both should be off.")

bus.send(DAPC(A, FULL))
step("3. Only tape A (tunable white) should be on. If tape B lit instead, the addresses are swapped.")
bus.send(Off(A))
bus.send(DAPC(B, FULL))
step("4. Only tape B (RGB+CCT) should be on.")
bus.send(Off(B))

bus.send(DAPC(A, FULL))
bus.run_sequence(SetDT8ColourValueTc(A, 370))      # 1,000,000 / 2700 K
step("5. Tape A warm white (about 2700 K).")
bus.run_sequence(SetDT8ColourValueTc(A, 154))      # 1,000,000 / 6500 K
step("6. Tape A cool white (about 6500 K). If 5 looked cool and 6 warm, WW and CW are swapped.")
bus.send(Off(A))

bus.send(DAPC(B, FULL))
for name, mix in (("red", (FULL, 0, 0, 0, 0, 0)), ("green", (0, FULL, 0, 0, 0, 0)),
                  ("blue", (0, 0, FULL, 0, 0, 0)), ("first white channel", (0, 0, 0, FULL, 0, 0)),
                  ("second white channel", (0, 0, 0, 0, FULL, 0))):
    bus.run_sequence(rgbwaf(B, *mix))
    step(f"7. Tape B {name} only.")
bus.send(Off(B))
print("\nDone. Both tapes off.")
