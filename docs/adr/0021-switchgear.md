# ADR 0021: Switchgear

Status: accepted

Date: 2026-11-23

## Context

Stage 10 builds R16: virtual plates with one, two and four buttons that play the application controller for IEC 62386-301 push button events (`docs/research/switchgear.md`). The hasseb cannot hear DALI-2 input devices, so the buttons are virtual and the app turns their events into commands. Every command still goes through the engine and the governor.

The owner chose in planning: zencontrol, a generic DALI-2 coupler and Basalte Sentido (labelled "KNX through a gateway") as the three families, with Gira dropped as the research recommends; Switches as a tenth page on Alt-0; plates and mappings kept in the workspace file.

## Decision

- **Where it runs.** The event machine and the controller are pure code in `src/switch`, built into the bus worker and driven by the engine's `Clock`, so hold timing does not depend on page timers. The page sends `switchInput` (plate, button, down or up) and `switchPlates` (the plates, with the sequences and effects they name resolved by the page). Both are checked in `src/engine/protocol-in.ts`, not `protocol.ts`, so the entry chunk stays free of the checks.
- **The machine** (`button.ts`) is the part 301 machine for one button: released 0, pressed 1, short 2, double 5, long start 9, repeat 11, long stop 12, free 14, stuck 15. Timers are short 500 ms, double 0 (off), repeat 160 ms, stuck 20 s, and a minimum pulse of 40 ms (from Lunatone). The event filter is one byte, default 0xF4. Ranges are python-dali's units and Beckhoff's limits (short up to 5100 ms, double up to 2000 ms, repeat 100 to 2000 ms, stuck 5 to 255 s). A press shorter than the minimum pulse is dropped after "pressed". Stuck ends a long press with no long stop.
- **The controller** (`controller.ts`) maps events to actions: toggle, on, off, recall a scene slot, dim while held, warmer or cooler while held, run a sequence or effect, stop. A hold's direction is chosen at long press start and kept for its repeats. An `alternate` direction flips at the end of each hold, first hold up (research section 6). From off, a dim up sends ON AND STEP UP. A KNX plate touched on two surfaces runs its `multi` action once and ignores both surfaces until they are released.
- **Safety.** Actions go to the engine with the source `switch`. That source is not a person, so no unlock, RESET or ceiling raise is reachable from a plate. Commands go through `Engine.request`, scenes through `sceneRecall`, and runs through `runDesign`, so the governor and rate guard judge every frame. A plate does nothing on an address that is not verified or has no driver, and says why in the console. Held repeats stop on Panic, a latch, a target change and the watchdog, because `stopRunners` resets the controller. Repeats are one in flight at a time, and a refusal is said once per hold.
- **Console and monitor.** Each event and action prints in the console as a `note` line ("switch Plate 1 2: long press start -> dim up A0"), and the frames show in the bus monitor with the source `switch`.
- **LEDs.** Off, on when the target is on, on when it is off, and always on, read from the governor's predicted levels. Each family is drawn differently: the zencontrol-style plate is a square of quarters with a slot LED on each button, the coupler is a slim plate with round push buttons and no LEDs, and the KNX plate is a glass touch plate with one central LED, white while touched and orange for a touch of two surfaces.
- **Persistence.** Plates live in the stored `design` record (a `plates` list, optional on load, so Stage 9 records load unchanged) and in the workspace file as `plates` (version 5, with a migration that only adds the number). An import replaces the stored plates and sends nothing.
- **The nesting limit** for stored and imported trees rose from 8 to 10, because a plate's action target sits nine levels down. The node and byte limits are unchanged.
- **The page.** `src/ui/pages/Switches.svelte`, in the one lazy chunk. Buttons are real focusable controls. Pointer events cover mouse and touch with pointer capture, and Space or Enter held down covers the keyboard. The mapping editor sits in the page under the plate, not in the inspector as `docs/UI.md` said: the inspector's slot is shared with the Visualiser's snippet and the editor needs the room.

## Consequences

- Hold repeats are the 160 ms default, above the 100 ms floor, and the governor and rate guard remain the limit on what reaches the driver. On Hardware and Both, ADR 0019's holding rules refuse most dims and group commands, and the console says so.
- The mapping has no console command. Switches are driven only from the page.
- zencontrol's own timings, first-hold direction and instance order are unconfirmed (research section 8). They are settings with sourced defaults.
- Beckhoff's timer limits were re-read for this stage. The default event filter is still not stated by any source read.

## Alternatives considered

- Running the machine in the page: simpler, but a hidden tab would throttle the timers and a hold could outlive Panic. Rejected.
- A new store key for plates: more plumbing and a second migration path. The design record already holds the user's own content.
- A separate rail group for Looks, Sequences, Effects and Switches: it would move shipped Alt keys. Alt-0 was the smaller change.
