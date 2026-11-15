# ADR 0013: The app shell and playground as built

Status: accepted

Date: 2026-11-16

## Context

Stage 5 builds the app people use every day: the shell from `docs/UI.md`, the design system, the Playground, the ceiling control, the bench preview, the bus monitor, and preferences with workspace files. The engine from Stage 4 gave the page device read-backs and monitor lines, but no live light, no colour controls and no feedback on live values. This ADR records what was added and the choices made where the design left one. The owner made four decisions while the stage was planned, listed last.

## Decision

### What the engine gives the page

- `Snapshot.light`: one entry for each unit in the active connection's shadow. That is the bench simulator in Simulator, and the hardware governor's shadow in Hardware and Both. Each entry has the present and target arc level, the colour (mirek and channels), the fade settings, and the drive on each output terminal. While any unit is fading, the engine sends snapshots at its usual rate of at most ten a second, and stops when the light settles.
- `Snapshot.feedback`: what happened to the newest value of each live control: `sent`, `clamped` (with the governor's note), `waiting` (refused with a retry time) or `refused`. This is SPEC R13.5 for values the coalescer sends after the call has returned.
- `MonitorLine` gains `seq`, `address` and `ms` (time on the wire). The page keeps up to 2,000 lines by `seq`, so it holds more than the 50 each snapshot carries.
- `Snapshot.bench`: how each simulated unit is set up.

### New intents

- `tc` and `rgbwaf` are coalesced per address, like `level`. The engine refuses a colour intent the gear does not report it can take (SPEC D2), naming the address.
- `level` gains `live`. A live value sends ENABLE DAPC SEQUENCE before its DAPC when more than 100 ms has passed since the last live DAPC to that address finished. The margin covers the time between the gear hearing a DAPC and the engine seeing it done, inside the gear's 200 ms. The gear then dims smoothly between values, as SPEC R13.3 asks. A typed value is not live, and uses the driver's fade.
- `apply`, for Commit mode, is one transaction in this order:
  1. The fade: DTR0 and SET FADE TIME, or for an extended fade, the fade time set to 0 and then SET EXTENDED FADE TIME.
  2. The colour, loaded without ACTIVATE.
  3. The DAPC.

  Automatic activation brings the colour in with the level, but only where the gear features read back say it is on (bit 0, dali.md section 11). Otherwise, or where they were not read, the colour is activated before the DAPC. From off that changes nothing visible, and the level then comes up in the new colour. With no level, the colour is activated. Extended fade byte 0 is allowed and means no fade.

- Power, step and dim use the existing `commands` intent. Dim repeats UP or DOWN every 200 ms while the button is held. It stops at the first refusal, on release, and when focus leaves.

### Simulator settings

- `src/sim/settings.ts` lists each setting's allowed values: a choice for booleans and enumerations (the researched default first), a range for numbers, and fixed for the two that are not edited in this version (the Tc limits and the C2 terminal order). The page, IndexedDB and workspace files all pass through the same check.
- A change first turns each lit unit it replaces off, through the governor, which judges that step and waits if the rate guard asks. It then replaces the gear in the bench simulator with `Simulator.replace`, and the new gear starts off. The rate guard reads each unit's history from its gear, and new gear has none, so light changes on the simulated bench then wait for the 2 s hard step window. The simulated connection keeps its governor and scheduler, and the unit is scanned and profiled again. The hardware connection is never touched (SPEC R1.6). A physical minimum above the ceiling is refused, naming the ceiling the unit would need, and so is a factory MAX LEVEL below the physical minimum.

### Persistence

- One database, `enlighten`, version 1, with the `preferences` store. A record that fails its checks is set aside under `set-aside:preferences:<time>` in the same store. Later stages add their stores with a version bump.
- The IndexedDB adapter is `src/ui/idb.ts`, not `src/store/idb.ts` as ARCHITECTURE section 6 suggested. All of `src/store` is then pure and covered, and the adapter lives with the rest of the page.
- Workspace version 1 has `format`, `version`, `ceiling`, `preferences` (Live or Commit, and reduced motion) and `devices` (address, alias, presentation and simulator settings). SPEC section 8 lists further keys, which belong to later stages. Each arrives with a version bump and a migration, and until then a file that has one is refused as an unknown key.
- **The stored ceiling.** At start the bus worker gets the stored ceiling only if it is at or below the default (arc 220). A stored value above that starts the session at 220. A banner then offers the saved value back, through the same typed confirmation as any raise. Raising always takes a deliberate action, even when another program on the origin has changed the stored value (THREAT_MODEL 3.3).
- Every call the page posts to the worker is taken as a plain snapshot of the page's reactive state. A Svelte proxy cannot be cloned by `postMessage`.

### The bench preview

- `src/light/preview.ts` is a placeholder, labelled "estimated". Each terminal kind has an assumed colour in linear sRGB:
  - R, G and B: the sRGB primaries.
  - The whites: 2700 K, 4000 K and 6500 K on the Planckian locus.

  Each is scaled so its luminance matches `LUMINANCE_WEIGHT`. All terminals share one exposure, at which two white terminals at full read as display white, so the two tapes keep their true ratio. Stage 7 replaces it with ADR 0008's XYZ path.

### The UI

- The rail shows the four pages Stage 5 builds. Alt with a digit goes by position in the rail.
- Dialogs use `show()` with their own focus trap. The global Escape handler listens in the capture phase, so Escape twice is panic from anywhere, inside a dialog included.
- The level control's Home goes to the driver's MIN LEVEL and End to the ceiling. The slider runs from 0, so dragging to the left end turns the light off.
- The workspace downloads through a `data:` URL, as the hardware check does, because lint bans `createObjectURL`.

### Owner decisions in planning

1. Fonts: Inter 4.1 (Regular and Medium) and JetBrains Mono 2.304 (Regular), downloaded from the projects' tagged repositories. Each matched its git blob hash there, and a test checks their SHA-256 sums.
2. three.js waits for Stage 7, when it has a user. Stage 5 adds `e2e/bundle.spec.ts`, which checks that the entry chunk has no dynamic import and stays under 250 kB.
3. The simulator's profile settings are editable on the Devices page, and carried in workspace files.
4. S4-D6 is fixed by turning lit gear down before the profile work. For each address above the new ceiling, `lowerCeiling` sends the MAX LEVEL write and the hold DAPC (or OFF) together, for all addresses in one transaction where the rate guard allows it. Gear that pulls its output down to a lower MAX LEVEL then lands at the ceiling at once, with no OFF even with a fade time set. Where the governor will not take the combined transaction, each address is tried alone. If it will not take the MAX LEVEL write either (on hardware with a DT8 colour unknown that counts as two hard steps), the hold goes alone. An OFF follows for gear still above the ceiling: a colour mix that cannot fit, or the owner's pinned case of gear that does not pull down and is still fading. Then come the MAX LEVEL writes and profiles for every address. The commands are worked out again before each attempt, so a wait for the rate guard never sends a stale hold. On hardware with a colour unknown the room takes one hard step a second (S3.3): the first driver lands within a quarter of a second and the second about a second later, where before it waited 3 to 5 s. The rate guard is unchanged.

## Consequences

- The page bundle grew from 81 kB to 167 kB (56 kB gzipped). Most of the growth is the UI, and the settings table's text, which the Devices page shows.
- V-ui screenshots are not in CI: macOS and Linux render fonts differently, so one set of baselines cannot serve both. They are run by hand on the reference laptop (`pnpm e2e:visual`).
- Groups as a target for the playground's controls (SPEC section 4.1) are not built. Each panel drives its own address.
- "A script cannot raise the ceiling" (E-ceiling) waits for the console in Stage 6. The governor already refuses it (U-safety).
- An import that lowers the ceiling writes MAX LEVEL, as the ceiling control does. An import can also switch the Playground between Live and Commit: both send through the same governor.
- The reviews' findings and what was done about each are in `docs/SECURITY_FINDINGS.md` (S5-M1 to S5-D10).

## Alternatives considered

- Rebuild the simulator and its transport for a settings change: needs a factory from the worker, where replacing the gear in place needs none.
- Apply a stored ceiling above the default at start: simpler, but a value another program wrote would raise the ceiling with no one confirming it.
- Store the full SPEC section 8 schema now: most of its keys have no design detail yet, and a schema written ahead of its feature would need a migration anyway.
