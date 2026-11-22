# ADR 0020: Looks, sequences, effects and extra simulated drivers

Status: accepted

Date: 2026-11-22

## Context

Stage 9 builds R4 (effects), R5 (looks, scene slots, sequences and export), S5 (background timing) and the rest of R14.2 (simulated drivers beyond the bench's two). The owner approved this plan on 2026-11-22 and chose Fable for the stage in place of Opus.

Three things constrain the design:

- ADR 0019's holding rules for Hardware and Both. One address changes at a time, a colour changes only with no fade, and no light change but OFF goes to a group or to all. The owner's closing position on Stage 8b is that these stay until hardware day shows what the driver does.
- ADR 0005: a sequence or effect is checked against the guard when it is planned, and the guard still judges every step when it is sent.
- The words "scene", "sequences" and "Effect" already name other things in `src/light`, `src/dali` and `src/console`.

## Decision

### Owner decisions in planning

1. Extra simulated drivers are added on the Devices page, up to six drivers in total, and exist on the Simulator target only. On Hardware and Both a mount on such an address draws unlit with the "simulated only" chip, and a design step for such an address is skipped with a note.
2. All ten effects of SPEC R4.1 are built.
3. Looks, Sequences and Effects join the rail as Alt-7 to Alt-9. The rail is then full, so the Switches page of Stage 10 needs its own decision.
4. The hidden-tab proof for S5.3 is a 2-minute test in CI and a 30-minute run by hand (`pnpm e2e:hidden`), run once at stage close.

### Hardware and Both

Nothing in ADR 0019 is relaxed. Everything here works as designed on the Simulator. On Hardware and Both the governor refuses what the holding rules refuse, and the page shows the governor's reason. A plan is not checked ahead on those targets, and the page says so.

### No change to `src/safety`

The check at planning time is a dry run: the engine copies the simulated bench (`Simulator.fork`), builds a fresh governor with the live ceiling, swing limit and verified addresses, and runs the plan on a virtual clock. The first refusal comes back with the governor's own reason, which is how R4.2's "saying which limit" is met. The governor gains no new entry point.

### `src/design`

The pure core for this stage is `src/design`: looks and the slot map, sequences and their presets, the planner, the ten effects, the export, and the schema for stored records. The runner, the dry run and the scene operations are in `src/engine`, as `docs/ARCHITECTURE.md` plans.

### Slots

A slot's level is verified by QUERY SCENE LEVEL. No route is confirmed for reading back a slot's colour (`docs/research/dali.md` section 9), so the slot map marks a stored colour "assumed". Hardware day checks it.

### Night presets

SPEC R5.5 names one preset: off to 20% at 2700 K over 25 minutes. The others built here (a wind-down, a night light and sunrise) are additions of this stage, with values from `docs/research/effects.md`.

## Consequences

The sections below are filled in as the stage is built.

## Alternatives considered

- A `predict` entry point on the governor, to ask for a verdict without an approval. It would be exact where the dry run starts from a fresh history, but it changes `src/safety` for something the dry run and the judgement at send time already cover between them.
- Simulated drivers that follow the visualiser's mounts. Rejected by the owner: the bench would rebuild on every address edit.
- Extra drivers lit in Both. Rejected by the owner: it changes the hardware path, which nothing can test before the hasseb arrives.
