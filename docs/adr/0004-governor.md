# ADR 0004: The governor, and what the brightness ceiling covers

Status: accepted

Date: 2026-11-14

## Context

`CLAUDE.md` requires that nothing reaches a simulated or real driver except through `src/safety`. `docs/research/dali.md` section 17 lists thirty ways light can rise without a level command above the ceiling. The owner decided that the ceiling is a comfort feature: it should hold on the ordinary paths, and edge cases are handled where that is cheap.

## Decision

### One path

Every source builds transactions (short, ordered groups of frames that must not be split) and hands them to the engine. The scheduler asks the governor to judge each transaction at the moment it is about to be sent, against the governor's tracked state. The governor returns allow, clamp (the same transaction with a lower level), or refuse with a reason. No other route to a transport exists, and a lint rule stops any module outside the engine importing a transport.

The governor is pure TypeScript: a `judge` function and an `observe` function over a state value. The state holds the ceiling, the unlocks, the last frame sent (for device type context), DTR0 to DTR2 (each a value or unknown), and one shadow gear model per address.

Raw frames are decoded and judged by the same rules. A frame that does not decode to a known command is refused.

### What the ceiling covers

Handled, because each is cheap once DTRs and a shadow model are tracked:

- A DAPC above the ceiling is clamped.
- The setters that read DTR0 (SET MAX LEVEL, SET MIN LEVEL, SET SCENE, SET POWER ON LEVEL, SET SYSTEM FAILURE LEVEL) are refused above the ceiling. SET POWER ON LEVEL 255 is refused.
- DTR0 to DTR2 are tracked, and become unknown after any command that lets gear write them. A command that reads an unknown register is refused until it is set again.
- Indirect level commands (RECALL MAX LEVEL, UP, STEP UP, ON AND STEP UP, CONTINUOUS UP, GO TO SCENE, GO TO LAST ACTIVE LEVEL) are allowed only for addresses whose safety profile is verified, because only the driver's own MAX LEVEL limits them.
- Lowering the ceiling writes MAX LEVEL and also sends a level command to any address above it.
- The safety profile reads PHYSICAL MINIMUM and MIN LEVEL before it writes MAX LEVEL, and reads every write back. A ceiling below the physical minimum is refused with the reason.
- For RGBWAF, the app holds arc fraction times the sum of channel fractions to the ceiling. Friendly colour controls lower the level to fit. Raw DT8 frames that would pass it are refused. Stored colours (scenes, power-on) are judged the same way when stored.
- A level command with a temporary colour pending is judged as the pair.
- After commissioning or a group change, the inventory is marked stale, and group and broadcast indirect commands are refused until a rescan.
- Blocked for good in this version: SET OPERATING MODE, START AUTO CALIBRATION, REFERENCE SYSTEM POWER, memory bank writes, the STORE PRIMARY commands and ASSIGN COLOUR TO LINKED CHANNEL. Blocked until unlocked for the session: RESET, commissioning, IDENTIFY DEVICE and SELECT DIMMING CURVE.

Not handled, and recorded in the threat model:

- Another master or tool on the bus.
- Script injected into the page. The governor is in the page, so it does not defend against the page.
- A colour temperature change that raises output on the tunable-white tape. The governor uses the profile's mixing law (constant total until measured). If the bench shows a hump, the profile changes and the governor follows it.
- The half second at full output after an unlocked RESET, and any flash before POWER ON LEVEL applies at power-up.
- The RGBWAF mix has no limit in the driver. A frame from outside the governor can light every channel at the capped arc level.
- Per-channel lumen weighting of the mix. The sum of channel fractions is the whole rule.

### Raising and unlocking

Raising the ceiling and every unlock need a confirmation from a person in the UI or at the console prompt. Scripts, sequences, effects, switches and imports can lower the ceiling and can never raise it or unlock anything. Unlocks last until the page reloads and show in the top bar.

## Consequences

- Stage 3 item 5 is smaller than first planned: one rule table, not thirty special cases.
- The property tests assert the ordinary-path guarantee: for random command streams from every source, simulated output stays at or below the ceiling unless it was raised by a confirmed action.
- A virtual switch on an unverified driver does nothing, and says why.

## Alternatives considered

- Every item in section 17 as a requirement: the owner decided against it.
- A ceiling held only in the drivers: fails for RGBWAF, and for every DTR-based setter.
- A second governor in the server: see ADR 0003.
