# Hardware server

A small Python program that lets the app reach a hasseb USB DALI Master. It serves the built app and one
WebSocket, `/bus`, from `http://127.0.0.1:47821`, and relays frames to the hasseb one at a time. It has no
governor, ceiling or rate guard of its own: those are in the app (ADR 0003). Its jobs are to check who is
talking to it, build every USB report itself from a frame it has decoded, keep one client, and turn the
lights off (TERMINATE, then broadcast OFF) whenever that client goes away, falls silent for 3 seconds,
asks for panic, or the server stops.

## Set up

You need Python 3.11 or later. The virtual environment is git-ignored.

```bash
python3 -m venv server/.venv
```

```bash
server/.venv/bin/python -m pip install --require-hashes --only-binary :all: -r server/requirements.txt
```

`requirements.txt` pins python-dali, hidapi and websockets by hash. For the tests, also install
`server/requirements-dev.txt` (pytest and its dependencies, pinned the same way). To change a version,
edit the `.in` file and recompile with `pip-compile --generate-hashes --allow-unsafe --no-annotate`.
Read the release before pinning it: pip has no minimum release age.

## Run

Build the app, then start the server from the repository root:

```bash
pnpm build
```

```bash
pnpm server
```

It prints an address with a session token, such as `http://127.0.0.1:47821/#t=...`. Open it in Chrome
or Brave. The token works once. To reload the page, press Enter in the server's terminal for a fresh
address. The server listens on 127.0.0.1 only and has no option to listen anywhere else. The preview
server uses the same port, so stop one before starting the other.

Keep a way to stop the server within reach of the bench. Ctrl-C turns the lights off.

### Demo hardware

```bash
pnpm server:demo
```

This runs the whole hardware path with a fake hasseb and a fake bench: address 0 as a DA5-L presenting
colour temperature, address 1 presenting five RGBWAF channels. It prints each frame that reaches the
fake bus. Type `unplug` or `plug` in its terminal to take the fake hasseb away and bring it back. The
fake changes levels at once, with no fades, so a fade set on it shows as a divergence in Both.

`--demo-quirk level-offset` makes the fake answer QUERY ACTUAL LEVEL one step high while a driver is lit, to see the
divergence log at work. `--demo-unaddressed` adds a driver with no short address, for commissioning.

### Timing

`--gap-ms` sets the least time from one frame's report to the next frame (default 20, as python-dali).
`--send-twice-ms` sets how long the hasseb waits before repeating a send-twice frame (default 10, as
python-dali). Both are hardware-day items: measure them with a scope or a second interface.

### Trace

`--trace` prints every report from the hasseb except the idle ones. The hardware check asks for this on
hardware day, to record a whole reply report.

## Remote use

Run the server on the bench computer. On the other computer, forward the port over SSH with the same
port at both ends, so the Host and Origin checks pass unchanged:

```bash
ssh -L 127.0.0.1:47821:127.0.0.1:47821 bench
```

The server cannot tell a forwarded client from a local one. The app asks on connect whether you can see
the lights. If you cannot, the `rate` unlock is off for that session.

## Linux

HID devices are read-only to users by default. This rule opens the hasseb, and nothing else, to the
person at the seat. It is composed from python-dali's and the vendor's rules and is not yet tested:

```
# /etc/udev/rules.d/70-hasseb-dali.rules
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="04cc", ATTRS{idProduct}=="0802", TAG+="uaccess"
```

Reload the rules and replug the hasseb. Do not use a rule that opens every HID device.

## Tests

```bash
pnpm test:server
```

The tests build the server in-process on a port the system picks, with the fake hasseb. A few start
`python -m server` itself on port 47821 and are skipped when that port is taken.
