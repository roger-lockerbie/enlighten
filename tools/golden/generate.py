"""Write Enlighten's golden fixtures from python-dali.

Run from the repo root with the venv in this folder:

    tools/golden/.venv/bin/python -I tools/golden/generate.py

It writes JSON into tests/golden/. The TypeScript tests read only those files,
so CI does not need Python. python-dali is used here as an oracle: this script
calls it and copies none of its code.
"""

import inspect
import json
import os
import struct
import sys

import dali
from dali import address as A
from dali.frame import ForwardFrame, BackwardFrame
from dali.gear import colour, general, led
from dali.gear.general import EnableDeviceType, _GearCommand
from dali.gear.sequences import SetDT8ColourValueTc, QueryDT8ColourValue
from dali.gear.colour import QueryColourValueDTR
from dali.sequences import Commissioning, QueryDeviceTypes, QueryGroups
from dali.driver.hasseb import HassebDALIUSBDriver
from dali.command import Command, YesNoResponse
from dali.tests import fakes

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'golden')
PD_VERSION = '0.16'

# Commands left out of the supported set. The general QueryExtendedVersionNumber
# has device type 0, which part 102 says gear ignores. UnknownGearCommand is not a command.
EXCLUDED = {'general.QueryExtendedVersionNumber', 'general.UnknownGearCommand'}

SHORTS = [0, 1, 37, 63]
GROUPS = [0, 5, 15]


def pd_name(cls):
    return cls.__module__.split('.')[-1] + '.' + cls.__name__


def reply_kind(cls):
    if cls.response is None:
        return 'none'
    if issubclass(cls.response, YesNoResponse):
        return 'yesno'
    return 'value'


def addr_json(a):
    if isinstance(a, A.GearShort):
        return {'kind': 'short', 'n': a.address}
    if isinstance(a, A.GearGroup):
        return {'kind': 'group', 'n': a.group}
    if isinstance(a, A.GearBroadcastUnaddressed):
        return {'kind': 'unaddressed'}
    if isinstance(a, A.GearBroadcast):
        return {'kind': 'broadcast'}
    raise ValueError(a)


def all_addresses():
    out = [A.GearShort(n) for n in SHORTS]
    out += [A.GearGroup(n) for n in GROUPS]
    out += [A.GearBroadcast(), A.GearBroadcastUnaddressed()]
    return out


def frame_bytes(cmd):
    a, b = cmd.frame.as_byte_sequence
    return [a, b]


def decode_name(a, b, devicetype):
    cmd = _GearCommand.from_frame(ForwardFrame(16, [a, b]), devicetype=devicetype)
    if cmd is None or isinstance(cmd, general.UnknownGearCommand):
        return None
    return pd_name(type(cmd))


def command_classes():
    seen = []
    for mod in (general, led, colour):
        for _, cls in inspect.getmembers(mod, inspect.isclass):
            if cls.__module__ != mod.__name__ or not issubclass(cls, Command):
                continue
            if cls.__name__.startswith('_') or cls in seen:
                continue
            if pd_name(cls) in EXCLUDED:
                continue
            seen.append(cls)
    return seen


def instances(cls):
    """Yield (instance, address or None, param or None) samples for one class."""
    if cls is general.DAPC:
        for a in all_addresses():
            for level in (0, 1, 85, 127, 220, 254, 255):
                yield cls(a, level), a, level
        return
    if issubclass(cls, general._SpecialCommand):
        if cls is general.Initialise:
            for kwargs, data in (({'broadcast': True}, 0), ({}, 0xFF),
                                 ({'address': 0}, 1), ({'address': 63}, 127)):
                yield cls(**kwargs), None, data
            return
        if issubclass(cls, general._ShortAddrSpecialCommand):
            for n in (0, 1, 63, 'MASK'):
                c = cls(n)
                yield c, None, frame_bytes(c)[1]
            return
        if cls._hasparam:
            for p in (0, 1, 127, 254, 255):
                yield cls(p), None, p
            return
        yield cls(), None, None
        return
    hasparam = getattr(cls, '_hasparam', False)
    for a in all_addresses():
        if hasparam:
            for p in (0, 7, 15):
                yield cls(a, p), a, p
        else:
            yield cls(a), a, None


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(compact(data, 0))
        f.write('\n')
    print('wrote', os.path.relpath(path))


def compact(value, depth):
    """JSON with one line per list item, so the files stay small and diff well."""
    if depth >= 2 or not isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(',', ':'))
    pad = ' ' * (depth + 1)
    if isinstance(value, list):
        if not value:
            return '[]'
        return '[\n' + ',\n'.join(pad + compact(v, depth + 1) for v in value) + '\n' + ' ' * depth + ']'
    items = sorted(value.items())
    return '{\n' + ',\n'.join(pad + json.dumps(k) + ': ' + compact(v, depth + 1) for k, v in items) + \
        '\n' + ' ' * depth + '}'


def header(what):
    return {
        'generator': 'tools/golden/generate.py',
        'pythonDali': dali.__version__ if hasattr(dali, '__version__') else PD_VERSION,
        'what': what,
    }


# --- frames.json and decode.json -------------------------------------------------


def gen_frames():
    commands = []
    for cls in command_classes():
        for cmd, a, p in instances(cls):
            fb = frame_bytes(cmd)
            entry = {
                'pd': pd_name(cls),
                'address': addr_json(a) if a is not None else None,
                'param': p,
                'frame': fb,
                'sendTwice': bool(cmd.sendtwice),
                'reply': reply_kind(cls),
                'deviceType': cls.devicetype,
                'decodesAs': decode_name(fb[0], fb[1], cls.devicetype),
            }
            commands.append(entry)
    data = header('Every supported command with sample addresses and parameters')
    data['commands'] = commands
    write('frames.json', data)


def gen_decode():
    """A sweep of frames decoded by python-dali, with 0, 6 and 8 as device type context."""
    names = []
    rows = []

    def index(name):
        if name is None:
            return -1
        if name not in names:
            names.append(name)
        return names.index(name)

    address_bytes = [0x00, 0x01, 0x4A, 0x4B, 0x7E, 0x7F, 0x80, 0x81, 0x9F,
                     0xFC, 0xFD, 0xFE, 0xFF]
    for dt in (0, 6, 8):
        for a in address_bytes:
            rows.append({'a': a, 'deviceType': dt,
                         'pd': [index(decode_name(a, b, dt)) for b in range(256)]})
        for a in range(0xA0, 0xFC):
            rows.append({'a': a, 'deviceType': dt,
                         'pd': [index(decode_name(a, b, dt)) for b in range(256)]})
    data = header('python-dali decoding of every second byte for a set of first bytes. '
                  'pd holds an index into names, or -1 where python-dali finds no command.')
    data['names'] = names
    data['rows'] = rows
    write('decode.json', data)


# --- sequences.json -------------------------------------------------------------


class Recorder(HassebDALIUSBDriver):
    """A hasseb driver with no device. send() records the frame instead of writing it."""

    def __init__(self, replies=None):  # noqa: D401 - does not open a device
        self.sn = 0
        self.sent = []
        self.replies = replies or {}

    def send(self, command):
        fb = frame_bytes(command)
        self.sent.append({'frame': fb, 'sendTwice': bool(command.sendtwice),
                          'expectReply': bool(command.is_query)})
        if command.response is None:
            return None
        value = self.replies.get(type(command).__name__)
        return command.response(BackwardFrame(value) if value is not None else None)


def record(seq, replies=None):
    r = Recorder(replies)
    r.run_sequence(seq)
    return r.sent


def first_light_mix(address, r, g, b, w, a, f):
    """The RGB and WAF mix as tools/first_light.py builds it."""
    yield general.DTR0(r)
    yield general.DTR1(g)
    yield general.DTR2(b)
    yield colour.SetTemporaryRGBDimLevel(address)
    yield general.DTR0(w)
    yield general.DTR1(a)
    yield general.DTR2(f)
    yield colour.SetTemporaryWAFDimLevel(address)
    yield colour.Activate(address)


def gen_sequences():
    a, b = A.GearShort(0), A.GearShort(1)
    seqs = []
    for mirek in (370, 154, 153, 250):
        seqs.append({'name': f'tc-{mirek}', 'address': 0, 'mirek': mirek,
                     'frames': record(SetDT8ColourValueTc(a, mirek))})
    full = 254
    for name, mix in (('red', (full, 0, 0, 0, 0, 0)), ('green', (0, full, 0, 0, 0, 0)),
                      ('blue', (0, 0, full, 0, 0, 0)), ('white', (0, 0, 0, full, 0, 0)),
                      ('amber', (0, 0, 0, 0, full, 0)), ('mixed', (10, 20, 30, 40, 50, 60))):
        seqs.append({'name': f'rgbwaf-{name}', 'address': 1, 'mix': list(mix),
                     'frames': record(first_light_mix(b, *mix))})
    seqs.append({'name': 'query-tc', 'address': 0, 'selector': 2,
                 'frames': record(QueryDT8ColourValue(a, QueryColourValueDTR.ColourTemperatureTC),
                                  {'QueryColourValue': 1, 'QueryContentDTR0': 114,
                                   'QueryActualLevel': 200})})
    seqs.append({'name': 'query-device-types', 'address': 1,
                 'frames': record(QueryDeviceTypes(b), {'QueryDeviceType': 8})})
    seqs.append({'name': 'query-groups', 'address': 1,
                 'frames': record(QueryGroups(b), {'QueryGroupsZeroToSeven': 1,
                                                   'QueryGroupsEightToFifteen': 0})})
    data = header('Sequences as the hasseb driver sends them, with ENABLE DEVICE TYPE added')
    data['sequences'] = seqs
    write('sequences.json', data)


# --- hasseb.json ----------------------------------------------------------------


class FakeHid:
    def __init__(self, reads=None):
        self.writes = []
        self.reads = list(reads or [])

    def write(self, data):
        self.writes.append(list(data))

    def read(self, n):
        return self.reads.pop(0) if self.reads else []


def bare_driver():
    d = HassebDALIUSBDriver.__new__(HassebDALIUSBDriver)
    d.sn = 0
    return d


def gen_hasseb():
    d = bare_driver()
    samples = [
        general.DAPC(A.GearShort(0), 220), general.DAPC(A.GearBroadcast(), 0),
        general.Off(A.GearBroadcast()), general.QueryActualLevel(A.GearShort(1)),
        general.QueryStatus(A.GearShort(0)), general.SetMaxLevel(A.GearShort(0)),
        general.Reset(A.GearShort(1)), general.DTR0(220), general.Terminate(),
        general.Initialise(broadcast=True), general.Compare(), EnableDeviceType(8),
        colour.Activate(A.GearShort(1)), colour.QueryColourTypeFeatures(A.GearShort(1)),
        colour.StoreGearFeaturesStatus(A.GearShort(1)), led.QueryDimmingCurve(A.GearShort(0)),
    ]
    reports = []
    for cmd in samples:
        reports.append({'pd': pd_name(type(cmd)), 'frame': frame_bytes(cmd),
                        'report': list(d.construct(cmd))})
    # Sequence numbers wrap from 255 to 1, never 0.
    d.sn = 254
    wrap = [list(d.construct(general.Off(A.GearShort(0)))) for _ in range(3)]

    fw = bare_driver()
    fw.sn = 6
    fw.device = FakeHid([[0xAA, 0x02, 7, 2, 4, 0, 0, 0, 0, 0]])
    version = fw.readFirmwareVersion()
    sniff = bare_driver()
    sniff.sn = 9
    sniff.device = FakeHid()
    sniff.enableSniffing()
    sniff.disableSniffing()

    def describe(x):
        if x is None:
            return {'kind': 'invalid'}
        if isinstance(x, BackwardFrame):
            if type(x).__name__ == 'BackwardFrameError':
                return {'kind': 'framing-error'}
            return {'kind': 'reply', 'byte': x.as_integer}
        return {'kind': type(x).__name__}

    incoming = [
        [0xAA, 0x00, 0, 0, 0, 0, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 1, 0, 0, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 2, 1, 0x7F, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 2, 1, 0xFF, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 2, 8, 0x7F, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 3, 0, 0, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 4, 0, 0, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 5, 1, 0x12, 0, 0, 0, 0],
        [0xAA, 0x07, 3, 6, 0, 0, 0, 0, 0, 0],
        [0xAA, 0x09, 3, 0, 0, 0, 0, 0, 0, 0],
    ]
    extracted = [{'report': r, 'pd': describe(d.extract(r))} for r in incoming]
    data = header('hasseb 10-byte reports from the python-dali driver, with no device attached')
    data['send'] = reports
    data['sequenceWrap'] = wrap
    data['firmware'] = {'request': fw.device.writes[0], 'reply': [0xAA, 0x02, 7, 2, 4, 0, 0, 0, 0, 0],
                        'version': version}
    data['configure'] = {'enable': sniff.device.writes[0], 'disable': sniff.device.writes[1]}
    data['extract'] = extracted
    write('hasseb.json', data)


# --- fakes.json -----------------------------------------------------------------


def run_stream(gears, commands):
    """Send each command to every fake gear and record the merged reply."""
    out = []
    for cmd in commands:
        steps = [EnableDeviceType(cmd.devicetype), cmd] if cmd.devicetype else [cmd]
        for c in steps:
            replies = [x for x in (g.send(c) for g in gears) if x is not None]
            if c.response is None:
                reply = None
            elif len(replies) > 1:
                reply = 'collision'
            elif len(replies) == 1:
                r = replies[0]
                reply = r if isinstance(r, int) else r.as_integer
            else:
                reply = 'none'
            out.append({'pd': pd_name(type(c)), 'frame': frame_bytes(c),
                        'sendTwice': bool(c.sendtwice), 'reply': reply})
    return out


def gear_json(g):
    return {'shortAddress': g.shortaddr, 'groups': sorted(g.groups),
            'deviceTypes': list(g.devicetypes), 'randomPreload': list(g.random_preload)}


def stream(name, gears, commands, note=''):
    config = [gear_json(g) for g in gears]
    return {'name': name, 'note': note, 'gear': config, 'frames': run_stream(gears, commands)}


def gen_fakes():
    s0, s1, bc = A.GearShort(0), A.GearShort(1), A.GearBroadcast()
    G = general
    streams = []

    gears = [fakes.Gear(0), fakes.Gear(1)]
    cmds = [G.DAPC(s0, 200), G.QueryActualLevel(s0), G.DTR0(150), G.SetMaxLevel(s0),
            G.QueryMaxLevel(s0), G.QueryActualLevel(s0), G.DAPC(s0, 254), G.QueryActualLevel(s0),
            G.DTR0(100), G.SetMinLevel(s0), G.QueryMinLevel(s0), G.DAPC(s0, 50),
            G.QueryActualLevel(s0), G.DTR0(255), G.SetMaxLevel(s0), G.QueryMaxLevel(s0),
            G.DTR0(255), G.SetMinLevel(s1), G.QueryMinLevel(s1), G.DTR0(20), G.SetMaxLevel(s1),
            G.QueryMaxLevel(s1), G.DAPC(bc, 255), G.QueryActualLevel(s0), G.Off(s0),
            G.QueryActualLevel(s0), G.RecallMaxLevel(s1), G.QueryActualLevel(s1),
            G.RecallMinLevel(s0), G.QueryActualLevel(s0), G.QueryPhysicalMinimum(s0),
            G.DTR0(1), G.SetMinLevel(s0), G.QueryMinLevel(s0)]
    streams.append(stream('clamping', gears, cmds, 'MIN, MAX, MASK and the recall commands'))

    gears = [fakes.Gear(0), fakes.Gear(1)]
    cmds = [G.DTR0(180), G.SetScene(s0, 3), G.DTR0(254), G.SetScene(bc, 4),
            G.QuerySceneLevel(s0, 3), G.QuerySceneLevel(s1, 3), G.QuerySceneLevel(s1, 4),
            G.GoToScene(s0, 3), G.QueryActualLevel(s0), G.GoToScene(s1, 3), G.QueryActualLevel(s1),
            G.DTR0(100), G.SetMaxLevel(s0), G.GoToScene(s0, 4), G.QueryActualLevel(s0),
            G.RemoveFromScene(s0, 3), G.QuerySceneLevel(s0, 3), G.GoToScene(s0, 3),
            G.QueryActualLevel(s0)]
    streams.append(stream('scenes', gears, cmds, 'Scenes, MASK and clamping at recall'))

    gears = [fakes.Gear(0, groups={1}), fakes.Gear(1)]
    cmds = [G.QueryGroupsZeroToSeven(s0), G.AddToGroup(s1, 1), G.AddToGroup(s1, 9),
            G.QueryGroupsZeroToSeven(s1), G.QueryGroupsEightToFifteen(s1),
            G.DAPC(A.GearGroup(1), 150), G.QueryActualLevel(s0), G.QueryActualLevel(s1),
            G.QueryActualLevel(A.GearGroup(1)), G.RemoveFromGroup(s0, 1),
            G.DAPC(A.GearGroup(1), 90), G.QueryActualLevel(s0), G.QueryActualLevel(s1),
            G.QueryActualLevel(A.GearGroup(9)), G.QueryControlGearPresent(A.GearGroup(1)),
            G.QueryControlGearPresent(A.GearGroup(2))]
    streams.append(stream('groups', gears, cmds, 'Membership, group commands and a collision'))

    gears = [fakes.Gear(0), fakes.Gear(1)]
    cmds = [G.DTR0(12), G.DTR1(34), G.DTR2(56), G.QueryContentDTR0(s0), G.QueryContentDTR1(s1),
            G.QueryContentDTR2(s0), G.DTR0(0), G.QueryContentDTR0(s1), G.DTR1(7), G.DTR0(0x16),
            G.ReadMemoryLocation(s0), G.QueryContentDTR0(s0), G.QueryContentDTR0(s1)]
    streams.append(stream('dtrs', gears, cmds, 'DTR writes and reads, and READ MEMORY LOCATION on a bank that does not exist'))

    gears = [fakes.Gear(0, devicetypes=[6, 8]), fakes.Gear(1, devicetypes=[8]),
             fakes.Gear(2)]
    cmds = [G.QueryDeviceType(s0), G.QueryNextDeviceType(s0), G.QueryNextDeviceType(s0),
            G.QueryNextDeviceType(s0), G.QueryDeviceType(A.GearShort(1)),
            G.QueryDeviceType(A.GearShort(2)), G.QueryDeviceType(s0),
            G.QueryActualLevel(s0), G.QueryNextDeviceType(s0)]
    streams.append(stream('device-types', gears, cmds, 'The nothing-in-between rule'))

    gears = [fakes.Gear(None, random_preload=[0x123456]), fakes.Gear(None, random_preload=[0x00ABCD]),
             fakes.Gear(5)]
    seq_frames = []
    bus_gears = gears

    class RecordingBus:
        def run_sequence(self, seq):
            response = None
            while True:
                try:
                    cmd = seq.send(response)
                except StopIteration:
                    return
                response = None
                if isinstance(cmd, Command):
                    rec = run_stream(bus_gears, [cmd])
                    seq_frames.extend(rec)
                    if cmd.response is not None:
                        r = rec[-1]['reply']
                        if r == 'none':
                            response = cmd.response(None)
                        elif r == 'collision':
                            response = cmd.response(fakes.frame.BackwardFrameError(255))
                        else:
                            response = cmd.response(BackwardFrame(r))

    RecordingBus().run_sequence(Commissioning())
    tail = run_stream(gears, [G.QueryActualLevel(A.GearShort(0)), G.QueryControlGearPresent(A.GearShort(1)),
                              G.QueryMissingShortAddress(bc), G.QueryControlGearPresent(A.GearShort(5))])
    streams.append({'name': 'commissioning', 'note': 'python-dali Commissioning() with fixed random addresses',
                    'gear': [{'shortAddress': None, 'groups': [], 'deviceTypes': [], 'randomPreload': [0x123456]},
                             {'shortAddress': None, 'groups': [], 'deviceTypes': [], 'randomPreload': [0x00ABCD]},
                             {'shortAddress': 5, 'groups': [], 'deviceTypes': [], 'randomPreload': []}],
                    'frames': seq_frames + tail})

    gears = [fakes.Gear(0, devicetypes=[8])]
    C = colour
    cmds = [C.QueryColourTypeFeatures(s0), G.DTR0(250), G.DTR1(0), C.SetTemporaryColourTemperature(s0),
            C.Activate(s0), G.DTR0(2), C.QueryColourValue(s0), G.QueryContentDTR0(s0),
            G.DTR0(0x10), G.DTR1(0x27), C.SetTemporaryColourTemperature(s0), C.Activate(s0),
            G.DTR0(2), C.QueryColourValue(s0), G.QueryContentDTR0(s0),
            G.DTR0(100), G.DTR1(0), C.SetTemporaryColourTemperature(s0), C.Activate(s0),
            G.DTR0(2), C.QueryColourValue(s0), G.QueryContentDTR0(s0),
            G.DTR0(128), C.QueryColourValue(s0), G.DTR0(130), C.QueryColourValue(s0),
            G.DTR0(131), C.QueryColourValue(s0), G.QueryContentDTR0(s0)]
    streams.append(stream('dt8-tc', gears, cmds, 'Temporary Tc, ACTIVATE with clamping, limits'))

    data = header('Command streams through python-dali tests/fakes.py, with the replies it gives')
    data['streams'] = streams
    data['knownDifferences'] = [
        {'id': 'set-min-zero', 'where': 'tests/fakes.py:234',
         'what': 'SET MIN LEVEL with DTR0 = 0 stores 0 in the fake. The simulator stores PHYSICAL MINIMUM.'},
        {'id': 'scene-zero', 'where': 'tests/fakes.py:295-296',
         'what': 'GO TO SCENE with a stored 0 gives MIN LEVEL in the fake. The simulator switches off.'},
        {'id': 'colour-value-dtr1', 'where': 'tests/fakes.py:399-435',
         'what': 'QUERY COLOUR VALUE overwrites DTR1 as well as DTR0 in the fake.'},
        {'id': 'min-floor', 'where': 'tests/fakes.py:234',
         'what': 'The fake uses 1 as the SET MIN LEVEL floor and ignores physical_minimum.'},
    ]
    write('fakes.json', data)


def main():
    gen_frames()
    gen_decode()
    gen_sequences()
    gen_hasseb()
    gen_fakes()


if __name__ == '__main__':
    sys.exit(main())
