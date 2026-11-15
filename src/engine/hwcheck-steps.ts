/**
 * The hardware check's steps as data: what the page shows. The runners are in `hwcheck.ts`, in the
 * bus worker, so the page does not bundle them (ADR 0012).
 */
import type { Unlock } from '../safety/types.ts';

export type CheckKind = 'auto' | 'confirm' | 'manual';

export interface CheckStepInfo {
  readonly id: string;
  readonly part: 2 | 3 | 4;
  readonly title: string;
  /** What the person does or watches. */
  readonly how: string;
  readonly kind: CheckKind;
  readonly unlock?: Unlock;
}

export const CHECK_STEP_INFO: readonly CheckStepInfo[] = [
  {
    id: 'p2-device-types',
    part: 2,
    title: 'Device types',
    how: 'Reads QUERY DEVICE TYPE, and QUERY NEXT DEVICE TYPE when the answer is 255.',
    kind: 'auto',
  },
  {
    id: 'p2-colour-features',
    part: 2,
    title: 'Colour type features',
    how: 'Settles how C2 and C5 present colour: Tc capable, xy capable, RGBWAF channel count.',
    kind: 'auto',
  },
  {
    id: 'p2-assigned-colours',
    part: 2,
    title: 'Assigned colour for channels 0 to 5',
    how: 'QUERY ASSIGNED COLOUR with DTR0 set to each channel.',
    kind: 'auto',
  },
  {
    id: 'p2-limits',
    part: 2,
    title: 'Physical minimum, MIN LEVEL, MAX LEVEL',
    how: 'Three queries per driver.',
    kind: 'auto',
  },
  {
    id: 'p2-power-levels',
    part: 2,
    title: 'POWER ON LEVEL and SYSTEM FAILURE LEVEL',
    how: 'Two queries per driver.',
    kind: 'auto',
  },
  {
    id: 'p2-fades',
    part: 2,
    title: 'Fade time and rate, extended fade, fast fade and its minimum',
    how: 'Four queries per driver.',
    kind: 'auto',
  },
  {
    id: 'p2-curve-features',
    part: 2,
    title: 'Dimming curve, gear features, RGBWAF control',
    how: 'Three queries per driver. Gear features bit 0 is automatic activation.',
    kind: 'auto',
  },
  {
    id: 'p2-tc-limits',
    part: 2,
    title: 'Colour temperature limits, all four',
    how: 'QUERY COLOUR VALUE with selectors 128 to 131, in mirek.',
    kind: 'auto',
  },
  {
    id: 'p2-scenes-groups',
    part: 2,
    title: 'All 16 scene levels and both group bytes',
    how: 'Eighteen queries per driver.',
    kind: 'auto',
  },
  {
    id: 'p2-colour-as-shipped',
    part: 2,
    title: 'The colour as shipped',
    how: 'QUERY COLOUR VALUE selectors 226 (Tc) and 233 to 238 (channels).',
    kind: 'auto',
  },
  {
    id: 'p2-store-tc-limit',
    part: 2,
    title: 'Whether colour temperature limits can be stored',
    how: 'On the first driver: read the coolest limit, store it one mirek warmer with STORE COLOUR TEMPERATURE Tc LIMIT, read it back, then store the original and read it again. A store that does not take shows as no change.',
    kind: 'confirm',
    unlock: 'expert',
  },
  {
    id: 'p2-versions',
    part: 2,
    title: 'Version numbers and memory bank 0',
    how: 'QUERY VERSION NUMBER, the DT6 and DT8 extended versions, and memory bank 0 locations 0 to 26.',
    kind: 'auto',
  },
  {
    id: 'p3-status-report',
    part: 3,
    title: 'All 10 bytes of a reply report',
    how: 'Start the server with --trace. Run this step: it sends QUERY STATUS to the first driver. Copy the reply report line from the server output into the note. It settles byte 4 (1 or 8) and whether byte 2 echoes the sequence number.',
    kind: 'auto',
  },
  {
    id: 'p3-empty-address',
    part: 3,
    title: 'A query to an empty address',
    how: 'QUERY ACTUAL LEVEL to the first address no driver holds. Records the answer and the time taken.',
    kind: 'auto',
  },
  {
    id: 'p3-throughput',
    part: 3,
    title: 'Throughput',
    how: 'One hundred commands, then one hundred queries, each sent when the last result arrives. The commands are DTR0 loads: the same 16-bit frame with no reply as a level command, and no light changes, so the rate guard does not slow them.',
    kind: 'auto',
  },
  {
    id: 'p3-send-twice-gap',
    part: 3,
    title: 'The gap between the two frames of a send-twice command',
    how: 'With a scope or a second interface sniffing the bus, send a configuration command and measure the gap. It passes at 13.5 to 14.7 ms.',
    kind: 'manual',
  },
  {
    id: 'p3-store-gear-features',
    part: 3,
    title: 'STORE GEAR FEATURES/STATUS and read back',
    how: 'On the first driver: read gear features, store it with automatic activation turned the other way, read it back, then store the original and read it again. Settles ENABLE DEVICE TYPE with send-twice commands: a store that does not take shows as no change.',
    kind: 'confirm',
    unlock: 'expert',
  },
  {
    id: 'p3-unplug',
    part: 3,
    title: 'Unplug the hasseb mid-session',
    how: 'Unplug the USB cable. The app should show the fault, and the tapes should do what SYSTEM FAILURE LEVEL says (stay where they are). Record what happened, then plug it back in.',
    kind: 'manual',
  },
  {
    id: 'p4-profile',
    part: 4,
    title: 'Write the safety profile to every driver and read it back',
    how: 'The same profile the app writes on connect.',
    kind: 'auto',
  },
  {
    id: 'p4-power-cycle',
    part: 4,
    title: 'Power-cycle the drivers',
    how: 'Switch the drivers off and on. They should stay off. Film the first second and look for any flash.',
    kind: 'manual',
  },
  {
    id: 'p4-bus-supply',
    part: 4,
    title: 'Pull the bus supply for a second',
    how: 'The level should not change.',
    kind: 'manual',
  },
  {
    id: 'p4-system-failure-fade',
    part: 4,
    title: 'SYSTEM FAILURE LEVEL with a fade',
    how: 'The app sets SYSTEM FAILURE LEVEL to the physical minimum and a 4 s fade time on the first driver. Pull the bus supply for two seconds and record whether the light steps or fades, and what it does when the bus returns. Then run "Write the safety profile" again, which restores SYSTEM FAILURE LEVEL 255; set the fade time back from the note.',
    kind: 'confirm',
  },
  {
    id: 'p4-power-on-colour',
    part: 4,
    title: 'The stored power-on colour',
    how: 'The profile stores a warm power-on colour. Power-cycle the drivers, raise the level from the app, and record the colour.',
    kind: 'manual',
  },
  {
    id: 'p4-max-below-level',
    part: 4,
    title: 'Lower MAX LEVEL below the present level',
    how: 'The app sets the first driver to arc level 200 (or the ceiling, if lower), lowers MAX LEVEL to 150, and reads the level at once and after 2 s. It then writes the safety profile again and turns the driver off.',
    kind: 'confirm',
  },
  {
    id: 'p4-panic-timing',
    part: 4,
    title: 'Panic: button, Escape twice, closing the tab',
    how: 'Try each with the tapes lit. Time each to dark, for example by filming.',
    kind: 'manual',
  },
  {
    id: 'p4-panic-in-flight',
    part: 4,
    title: 'Panic while a send-twice frame is in flight',
    how: 'The app sends a configuration command (sent twice) and panics as soon as that frame is handed to the transport. Check in the server --trace output that TERMINATE and OFF came after the configuration frame, never between its two copies. The result records whether the frame went out or was dropped. Resume afterwards.',
    kind: 'confirm',
  },
  {
    id: 'p4-stop-server',
    part: 4,
    title: 'Stop the server with Ctrl-C',
    how: 'With the tapes lit, press Ctrl-C in the server terminal. The tapes should go off.',
    kind: 'manual',
  },
];
