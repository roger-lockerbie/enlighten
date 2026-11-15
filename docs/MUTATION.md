# Mutation testing

`pnpm mutate` runs Stryker with the Vitest runner on `src/safety` and on the codec in `src/dali` (TEST_PLAN M-safety). The target is a score of 85% or more, with every surviving mutant in `src/safety` listed here with the reason it survives.

## Result

Stage 4: one fresh `pnpm mutate` run, without `--incremental`, on the source at commit `040135f`. Later commits change tests and docs only. **96.69%** in all and **96.58%** on `src/safety`, against the 85% target. 3,051 mutants: 2,921 killed, 28 timed out, 91 survived, 10 with no coverage and 1 runtime error.

| File                       | Score      | Killed | Timed out | Survived | No coverage |
| -------------------------- | ---------- | ------ | --------- | -------- | ----------- |
| `src/dali/codec.ts`        | 98.15%     | 212    | 0         | 2        | 2           |
| `src/safety/ceiling.ts`    | 98.70%     | 76     | 0         | 1        | 0           |
| `src/safety/governor.ts`   | 95.80%     | 1698   | 11        | 68       | 7           |
| `src/safety/mix.ts`        | 92.59%     | 23     | 2         | 2        | 0           |
| `src/safety/panic.ts`      | 100.00%    | 3      | 0         | 0        | 0           |
| `src/safety/profile.ts`    | 98.38%     | 297    | 6         | 5        | 0           |
| `src/safety/rate/guard.ts` | 98.73%     | 154    | 2         | 2        | 0           |
| `src/safety/rate/legs.ts`  | 97.69%     | 204    | 7         | 5        | 0           |
| `src/safety/rate/trace.ts` | 94.62%     | 123    | 0         | 6        | 1           |
| `src/safety/rules.ts`      | 100.00%    | 127    | 0         | 0        | 0           |
| `src/safety/types.ts`      | 100.00%    | 4      | 0         | 0        | 0           |
| All of `src/safety`        | 96.58%     | 2709   | 28        | 89       | 8           |
| **Total**                  | **96.69%** | 2921   | 28        | 91       | 10          |

A timeout counts as killed: the mutant made a test loop or stall. The runtime error is `src/safety/rate/trace.ts` 53:23 (`k < n` to `k >= n`), which makes the sampling loop run without end until the test fails, so it is detected. Of the 101 mutants left, 97 are in `src/safety` and 4 are in the codec. Each is listed below.

After the run, the property checker in `tests/harness/checker.ts` changed: it now samples every unit at the same times, so the room's total no longer shows false steps (see `docs/SECURITY_FINDINGS.md`, S4-P4). The change only removes false failures. A mutant that only a false failure killed would now survive, so the score may be a little lower on a fresh run. The run takes about 6 hours, and it was not repeated for a test-only change.

## How the score was reached

Stage 3's run started at 70.86% and reached 94.73% with tests added for what it found, over several incremental and targeted runs. Stage 4 added the engine's tests and the new governor and router tests, and its single fresh run scored 96.69%. Most mutants that survived Stage 3 are listed again below at their new line numbers. Eight are new: `src/safety/governor.ts` 224:79 and the four at 367 (`issued`), and in `src/safety/rate/legs.ts` the three in `uniteTimes` (214:28, 218:18, 221:9). Many Stage 3 survivors are now killed.

Every run uses `PROP_RUNS=5`, so each property test runs five cases per mutant. The property tests run 1,000 cases each at stage close.

To check one line after a change, without incremental mode:

```sh
PROP_RUNS=5 pnpm exec stryker run --mutate 'src/safety/governor.ts:988-988'
```

Several ranges go in one comma-separated `--mutate` value. A second `--mutate` flag replaces the first.

## Why the rest survive

Each surviving mutant is listed by file, line and column, with the change Stryker made. They fall into these groups.

### A check that cannot fail (22)

The value is always present, or the case cannot be reached, so removing or reversing the check changes nothing a test, or a user, can see.

- `src/dali/codec.ts` 59:5 ConditionalExpression (no coverage), 60:14 BooleanLiteral (no coverage). Every special command kind has its own case.
- `src/safety/governor.ts` 78:29 ConditionalExpression. `modelAddress` refuses DT8 gear whose colour features were not read back, so `colour` is never undefined here.
- `src/safety/governor.ts` 179:9 ConditionalExpression. It runs after the rules, when every frame decodes.
- `src/safety/governor.ts` 474:14 OptionalChaining, 474:33 OptionalChaining. Every frame decodes after the rules, and every OFF carries an address.
- `src/safety/governor.ts` 558:9 ConditionalExpression. A DAPC always carries a level.
- `src/safety/governor.ts` 632:13 OptionalChaining, 643:13 OptionalChaining. Colour commands always carry an address.
- `src/safety/governor.ts` 729:11 ConditionalExpression, 729:46 StringLiteral (no coverage). `plan` only sees transactions that passed the rules, where every frame decodes.
- `src/safety/governor.ts` 804:36 ConditionalExpression. Every DAPC carries an address.
- `src/safety/governor.ts` 827:12 ObjectLiteral (no coverage), 827:18 BooleanLiteral (no coverage), 827:33 StringLiteral (no coverage). The fit settles in at most two attempts, so the refusal after the third is never reached.
- `src/safety/governor.ts` 880:56 OptionalChaining. GO TO SCENE needs verified gear, and verified gear has its info.
- `src/safety/governor.ts` 982:35 ConditionalExpression. RESET always carries an address.
- `src/safety/governor.ts` 1025:22 OptionalChaining. The prediction always has the reset gear and the room as scopes.
- `src/safety/governor.ts` 1115:14 OptionalChaining. `unknownEvents` only asks about an address after finding its info.
- `src/safety/governor.ts` 1131:67 OptionalChaining. Every OFF carries an address.
- `src/safety/governor.ts` 1310:13 OptionalChaining. Modelled gear always has a unit in the shadow.
- `src/safety/rate/trace.ts` 68:74 StringLiteral (no coverage). Every terminal has a label.

### The same result by another path (41)

The mutant changes the code, but another part of it gives the same answer.

- `src/dali/codec.ts` 85:9 ConditionalExpression, 91:9 ConditionalExpression. `isByte(undefined)` and `Number.isInteger(undefined)` are already false.
- `src/safety/governor.ts` 78:69 StringLiteral, 81:82 StringLiteral, 82:48 StringLiteral. Only C2 and C5 have two colour presentations. For C1, C3 and C4 the profile ignores it.
- `src/safety/governor.ts` 190:10 LogicalOperator, 190:10 ConditionalExpression, 190:10 ConditionalExpression, 190:35 ConditionalExpression, and the same four at 367:12, 367:12, 367:12 and 367:37 in `issued`. `WeakSet.has` is false for anything that is not an object, so the type checks before it change nothing.
- `src/safety/governor.ts` 224:79 ArrayDeclaration. Starts the DTR list empty instead of three unknowns. Reading any index of either gives `undefined`, and `dtrView` is only read by index or after all three are written.
- `src/safety/governor.ts` 290:12 ConditionalExpression. `structuredClone(undefined)` is undefined.
- `src/safety/governor.ts` 559:9 ConditionalExpression. A DAPC of 0 is never above the ceiling.
- `src/safety/governor.ts` 568:11 ConditionalExpression. Writes the register list at index `undefined`, which nothing reads.
- `src/safety/governor.ts` 635:11 LogicalOperator, 635:11 ConditionalExpression. For a short address, the check before has already refused gear without Tc (or RGBWAF), and the group check reads the same gear.
- `src/safety/governor.ts` 804:13 LogicalOperator, 804:13 ConditionalExpression. Commands other than DAPC that carry a value carry a scene or group number of 15 or less, which is never above a fitted level.
- `src/safety/governor.ts` 806:13 ConditionalExpression. A DAPC of 0 is never above the fitted level, so it is left alone either way.
- `src/safety/governor.ts` 989:24 BooleanLiteral, 990:26 BooleanLiteral. Flags on the OFF added to the prediction after a RESET. The simulator ignores both for OFF.
- `src/safety/governor.ts` 1026:41 EqualityOperator, 1026:45 ArithmeticOperator, 1026:56 EqualityOperator, 1026:56 ConditionalExpression, 1027:13 ConditionalExpression. The RESET's own step and the OFF after it fall in the window either way, and removing either leaves the same count.
- `src/safety/governor.ts` 1154:11 ConditionalExpression. DAPC is the only command in `SETS_LAST_ACTIVE` that carries a value.
- `src/safety/mix.ts` 31:7 ConditionalExpression, 31:7 EqualityOperator. `maxArcForMix` returns the ceiling for a sum of 1 or less either way.
- `src/safety/profile.ts` 111:14 ConditionalExpression, 111:14 LogicalOperator, 111:14 ConditionalExpression, 111:34 ConditionalExpression. Adds `undefined` or 254 to the device types, which are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 96:32 ConditionalExpression. `back1` is set before `back2`, so `back2` is undefined whenever `back1` is.
- `src/safety/rate/legs.ts` 214:28 ArithmeticOperator. Changes the order of two events at the same time from different predictions. `uniteTimes` keeps only times, and both have the same time.
- `src/safety/rate/legs.ts` 218:18 ArrayDeclaration. Starts the counts empty. The first event always opens a group, which sets both counts to 0, and a missing count is read as 0 anyway.
- `src/safety/rate/trace.ts` 96:21 StringLiteral. A terminal marked unused has no output, so it has no events.
- `src/safety/rate/trace.ts` 99:43 ArrowFunction. A leg on any channel is also a leg in the luminance trace, so the luminance events are already there.

### An exact boundary (8)

The mutant only differs when two values are exactly equal, such as a float measure equal to the ceiling to the last bit, or two events on the same millisecond.

- `src/safety/ceiling.ts` 49:13 EqualityOperator. Only differs for a fade heading for level 1, which is under the bench gear's physical minimum.
- `src/safety/governor.ts` 471:28 EqualityOperator. Only differs when a transaction is judged exactly at the end of the 2 s follow-up window.
- `src/safety/governor.ts` 569:24 EqualityOperator. Only differs when a DTR write is delivered on the exact millisecond the gear stops being deaf.
- `src/safety/governor.ts` 792:13 EqualityOperator. Only differs when a measure equals the limit to the last bit.
- `src/safety/governor.ts` 813:29 EqualityOperator. Only differs when the fitted level is exactly 1, which the bench gear cannot hold.
- `src/safety/governor.ts` 1031:54 EqualityOperator. Only differs exactly 10 s after the last RESET.
- `src/safety/rate/legs.ts` 88:9 EqualityOperator. Only differs when a change equals the flat tolerance exactly.
- `src/safety/rate/legs.ts` 221:9 EqualityOperator. Only differs when two predicted events are exactly 5 ms apart.

### Search and sampling density (13)

The mutant samples more or fewer points, or steps a search differently, and still finds the same peak or the same retry time.

- `src/safety/governor.ts` 780:40 UpdateOperator. The fit settles in at most two attempts, so the bound on the third is never reached.
- `src/safety/governor.ts` 1071:21 EqualityOperator, 1071:29 UpdateOperator, 1075:20 MethodExpression, 1075:42 ArrowFunction, 1076:11 ConditionalExpression, 1076:33 MethodExpression, 1076:46 ArithmeticOperator, 1076:47 ArithmeticOperator. The retry search reaches the same earliest passing time from another start or with another step, in the first round.
- `src/safety/rate/trace.ts` 43:18 MethodExpression. The times go into a set, and every sample time is still added.
- `src/safety/rate/trace.ts` 50:43 ArithmeticOperator, 50:43 EqualityOperator, 52:52 ArithmeticOperator. The interior samples in a faded trace still find the same legs.

### A stray entry in a list (10)

Stryker puts a string into an empty list. The list is only searched for numbers, ids or events with a time, so the string is never matched.

- `src/safety/governor.ts` 175:26 ArrayDeclaration. `decodeFrames` is only searched for command ids.
- `src/safety/governor.ts` 239:95 ArrayDeclaration. The synthetic events are filtered by time, and a string has none.
- `src/safety/governor.ts` 869:33 ArrayDeclaration (no coverage), 880:74 ArrayDeclaration, 937:32 ArrayDeclaration, 1025:47 ArrayDeclaration (no coverage), 1198:63 ArrayDeclaration (no coverage). The list is read for addresses, device types or scene levels, and a string matches none of them.
- `src/safety/profile.ts` 205:40 ArrayDeclaration. The device types are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 114:36 ArrayDeclaration. `EMPTY` is the baseline for a scope with no events, and its lists are only compared by time.
- `src/safety/rate/legs.ts` 185:32 ArrayDeclaration. The clusters are read by direction and time.

### Text that is not shown (5)

The mutant changes the note for a transaction that was not changed. Such a transaction is allowed, and an allow carries no note.

- `src/safety/governor.ts` 443:51 StringLiteral. The note for a confirmed transaction, which the fit never changes.
- `src/safety/governor.ts` 798:17 ConditionalExpression, 798:34 StringLiteral, 822:17 ConditionalExpression, 822:34 StringLiteral. The note for a fit that changed nothing.

### Equivalent while fades are not confirmed (1)

With `FADE_BEHAVIOUR_CONFIRMED` false, every change on hardware is already counted as an instant hard step, so the extra event the mutant removes coincides with one that is there already.

- `src/safety/governor.ts` 839:37 OptionalChaining. The level a DAPC or OFF makes known inside a transaction.

### A shift of a few milliseconds (1)

The mutant moves a predicted delivery by a few milliseconds. No rule depends on so small a shift.

- `src/safety/governor.ts` 1098:38 ArithmeticOperator. Moves the predicted second copy of a send-twice frame by two frame times, still inside the 100 ms window.
