# ADR 0022: on hardware, colour gear takes a level only in one moment

Status: accepted

Date: 2026-11-26

## Context

Stage 8b closed with one High finding open, S8b-R4-D1. On the Hardware and Both targets a faded level at a steady colour is not one leg on gear with a red channel (C3, C4 and C5). Each channel follows the level, and SPEC S3.1a counts red entering or leaving saturation as a leg of its own. The fourth review's case: RGB 254/205/205, a rescan, a bare ACTIVATE, fade time 2, then DAPC 150. That made three legs in 330 ms, and the guard counted one and allowed it.

On 2026-11-22 the owner chose to add no further rule and to settle this on the real driver. Stage 11 is done only with no High finding open, and there is still no hasseb. On 2026-11-26 the owner chose to close the finding with one more holding rule, to be relaxed on hardware day with the others. This is a third amendment to the holding position of ADR 0019, written as its own ADR.

## Decision

On Hardware and Both, gear that is colour gear, or may be (its device types hold 8, or were not all read), takes a level only in one moment:

1. A command that moves the level goes only when the fade time, the extended fade time and the fast fade time have all been read back as 0 since they were last written, and the transaction sends no fade setting to that address. This is the test a colour change already had (amendment 2, S8b-R4-1), and the same code.
2. UP, DOWN, CONTINUOUS UP and CONTINUOUS DOWN are refused. They fade at the fade rate whatever the fade time is.
3. ENABLE DAPC SEQUENCE is refused, by short address or by a group or broadcast that holds such gear. In a sequence every DAPC fades over 200 ms whatever the fade time is.

OFF is not a level-moving command and goes as before. GO TO SCENE keeps its own rule from Stage 8b, which is the same test. Gear whose types were read and hold no 8 is untouched, and so is the whole Simulator target, where the guard has the colour and counts these legs.

The rule covers all colour gear and not only gear with a red channel. On hardware the colour type comes from a read-back, and the holding position is that the guard rests on what was sent, not on what the shadow believes about the gear.

Each refusal has no time to ask again: the fade setting has to change first. The words say so ("set its fade time to 0 first", or that the settings have not been read back since they were set).

The engine's moving level control sends no DAPC sequence to such gear on hardware. It sends a plain DAPC, which the other holding rules allow about once every 2 s to an address.

## Consequences

- S8b-R4-D1 is closed. No High finding is open.
- On hardware, colour gear cannot fade a level from the app at all until hardware day. With amendment 2 it could not fade a colour either. Sequences and effects that fade were already mostly refused there, and this refuses the rest on colour gear. The pages say why through the governor's own words.
- The steps (STEP UP, STEP DOWN, RECALL MIN LEVEL and the rest) are refused while a fade time is set, though DALI gives them no fade. That is stricter than the standard needs. Whether the DA5-L fades a step is not known, and the cost is one SET FADE TIME 0.
- A plain DAPC with no fade is one moment and one hard step, which the guard already counts as such.

## How it is relaxed

`docs/TEST_PLAN.md` section 10 part 8 has the item. Two things settle it: the single-channel sweeps of part 6, which confirm or correct the channel law, and a colour read-back the guard can rest on. An ADR then either counts the red crossings from the colour read back, or keeps this rule for gear with a red channel and drops it for the rest. Whether a smooth fade across the 10% red-drive line should count as legs at all is the owner's to decide in SPEC S3.1a.

## Tests

- `src/safety/governor.hardware.test.ts`, "a level changes only in one moment": the review's case, each of the three fade settings, a fade setting in the same transaction, every level-moving command, the four commands that fade at the fade rate, the DAPC sequence by address, group and broadcast, and what is left alone (OFF, gear with no colour, the simulator target).
- `tests/properties/hard-steps.test.ts`: the review's case on a simulated C3 driver the governor has never seen, checked on the light trace. It fails on the rule before, and passes when the level goes with no fade.
- `tests/properties/rate.prop.test.ts`: the aimed generator gained fade settings read back, a DAPC sequence, DOWN and colours near saturated red, and every stream now ends with a wait so the last step's fade is in the trace.
- `src/engine/engine.test.ts`: the live level control sends no sequence to colour gear on hardware, and the level still arrives.

What the tests do not show: the widened property does not reach the review's case by chance. At 5,000 runs it passes with the rule and without it, because the case needs four particular steps in order. The fixed cases stand for it. A generator that builds such chains on purpose is a follow-up (S11 in `docs/SECURITY_FINDINGS.md`).

## Alternatives considered

- **Accept the finding until hardware day, in writing.** No code, and honest, since nothing can use the Hardware target yet. The owner preferred a closed finding to an accepted one for a public release.
- **Gate the Hardware and Both targets in v0.1.0** behind a typed confirmation. It leaves the gap in place for anyone who types the words.
- **Count the red crossings on hardware from the shadow's colour.** The shadow's colour is a guess there (amendment 1), which is how the finding arose.
- **Apply the rule only to gear with a red channel.** It rests the rule on a read-back of the colour type. Cheap to relax later, by the ADR that hardware day writes.
