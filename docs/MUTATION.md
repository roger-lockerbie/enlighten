# Mutation testing

`pnpm mutate` runs Stryker with the Vitest runner on `src/safety` and on the codec in `src/dali` (TEST_PLAN M-safety). The target is a score of 85% or more, with every surviving mutant in `src/safety` listed here with the reason it survives.

## Result

`pnpm mutate` on the source at commit `a3a8eca` (later commits change tests only), merged from the runs described below: **94.73%** in all and **94.46%** on `src/safety`, against the 85% target. 3,015 mutants: 2,835 killed, 21 timed out, 148 survived and 11 with no coverage.

| File                       | Score      | Killed | Timed out | Survived | No coverage |
| -------------------------- | ---------- | ------ | --------- | -------- | ----------- |
| `src/dali/codec.ts`        | 98.15%     | 212    | 0         | 2        | 2           |
| `src/safety/ceiling.ts`    | 98.70%     | 76     | 0         | 1        | 0           |
| `src/safety/governor.ts`   | 93.25%     | 1651   | 8         | 112      | 8           |
| `src/safety/mix.ts`        | 92.59%     | 22     | 3         | 2        | 0           |
| `src/safety/panic.ts`      | 100.00%    | 3      | 0         | 0        | 0           |
| `src/safety/profile.ts`    | 97.73%     | 293    | 8         | 7        | 0           |
| `src/safety/rate/guard.ts` | 97.47%     | 154    | 0         | 4        | 0           |
| `src/safety/rate/legs.ts`  | 98.38%     | 180    | 2         | 3        | 0           |
| `src/safety/rate/trace.ts` | 86.26%     | 113    | 0         | 17       | 1           |
| `src/safety/rules.ts`      | 100.00%    | 127    | 0         | 0        | 0           |
| `src/safety/types.ts`      | 100.00%    | 4      | 0         | 0        | 0           |
| All of `src/safety`        | 94.46%     | 2623   | 21        | 146      | 9           |
| **Total**                  | **94.73%** | 2835   | 21        | 148      | 11          |

A timeout counts as killed: the mutant made a test loop or stall. Of the 159 mutants left, 155 are in `src/safety` and 4 are in the codec. Each is listed below.

## How the score was reached

The first full run, at the end of the first Stage 3 build, scored 70.86%. Tests were then added for what it found, and these runs followed on the same source:

1. A full incremental run over every target file (`--incremental`, seeded with the report before it). Stryker reuses a result when neither the mutant nor the tests that cover it changed.
2. A fresh run, without `--incremental`, of every line that still had a surviving mutant after step 1. Incremental mode reused stale results for mutants that only a new test file reaches, and for static mutants (module-level constants), so this step reruns them all from scratch.
3. A fresh run of each surviving mutant that spans more than one line. A range such as `governor.ts:746-746` leaves out a mutant that starts on line 746 and ends on 752, so step 2 missed these.
4. More tests for the real gaps steps 2 and 3 showed, each checked by applying its mutant by hand, then a fresh run of the lines they cover.

Only test files changed between these runs, and adding tests cannot turn a killed mutant back into a survivor. The result above is step 1's result, with each mutant that a later step ran again replaced by its latest result. Mutants are matched on their start and end position, mutator and replacement.

Every run uses `PROP_RUNS=5`, so each property test runs five cases per mutant. The property tests run 1,000 cases each in `pnpm coverage`.

To check one line after a change, without incremental mode:

```sh
PROP_RUNS=5 pnpm exec stryker run --mutate 'src/safety/governor.ts:988-988'
```

Several ranges go in one comma-separated `--mutate` value. A second `--mutate` flag replaces the first.

## Why the rest survive

Each surviving mutant is listed by file, line and column, with the change Stryker made. They fall into these groups.

### A check that cannot fail (26)

The value is always present, or the case cannot be reached, so removing or reversing the check changes nothing a test, or a user, can see.

- `src/dali/codec.ts` 59:5 ConditionalExpression (no coverage), 60:14 BooleanLiteral (no coverage). Every special command kind has its own case.
- `src/safety/governor.ts` 77:29 ConditionalExpression. `modelAddress` refuses DT8 gear whose colour features were not read back, so `colour` is never undefined here.
- `src/safety/governor.ts` 178:9 ConditionalExpression. It runs after the rules, when every frame decodes.
- `src/safety/governor.ts` 465:14 OptionalChaining, 465:33 OptionalChaining. Every frame decodes after the rules, and every OFF carries an address.
- `src/safety/governor.ts` 549:9 ConditionalExpression. A DAPC always carries a level.
- `src/safety/governor.ts` 623:13 OptionalChaining, 634:13 OptionalChaining. Colour commands always carry an address.
- `src/safety/governor.ts` 661:9 ConditionalExpression. SET SCENE and SET POWER ON LEVEL always carry an address.
- `src/safety/governor.ts` 720:11 ConditionalExpression, 720:46 StringLiteral (no coverage). `plan` only sees transactions that passed the rules, where every frame decodes.
- `src/safety/governor.ts` 740:9 ConditionalExpression. Every unit asked about is in the simulator it is asked of.
- `src/safety/governor.ts` 795:36 ConditionalExpression. Every DAPC carries an address.
- `src/safety/governor.ts` 818:12 ObjectLiteral (no coverage), 818:18 BooleanLiteral (no coverage), 818:33 StringLiteral (no coverage). The fit settles in at most two attempts, so the refusal after the third is never reached.
- `src/safety/governor.ts` 860:9 ConditionalExpression. Every command that changes light carries an address.
- `src/safety/governor.ts` 871:56 OptionalChaining. GO TO SCENE needs verified gear, and verified gear has its info.
- `src/safety/governor.ts` 973:35 ConditionalExpression. RESET always carries an address.
- `src/safety/governor.ts` 1016:22 OptionalChaining. The prediction always has the reset gear and the room as scopes.
- `src/safety/governor.ts` 1090:9 ConditionalExpression. Every observed frame passed `judge`, or is panic's, so it decodes.
- `src/safety/governor.ts` 1105:14 OptionalChaining. `unknownEvents` only asks about an address after finding its info.
- `src/safety/governor.ts` 1121:67 OptionalChaining. Every OFF carries an address.
- `src/safety/governor.ts` 1299:13 OptionalChaining. Modelled gear always has a unit in the shadow.
- `src/safety/rate/trace.ts` 68:74 StringLiteral (no coverage). Every terminal has a label.

### The same result by another path (63)

The mutant changes the code, but another part of it gives the same answer.

- `src/dali/codec.ts` 85:9 ConditionalExpression, 91:9 ConditionalExpression. `isByte(undefined)` and `Number.isInteger(undefined)` are already false.
- `src/safety/governor.ts` 77:69 StringLiteral, 80:82 StringLiteral, 81:48 StringLiteral. Only C2 and C5 have two colour presentations. For C1, C3 and C4 the profile ignores it.
- `src/safety/governor.ts` 189:10 LogicalOperator, 189:10 ConditionalExpression, 189:10 ConditionalExpression, 189:35 ConditionalExpression. `WeakSet.has` is false for anything that is not an object, so the type checks before it change nothing.
- `src/safety/governor.ts` 287:12 ConditionalExpression. `structuredClone(undefined)` is undefined.
- `src/safety/governor.ts` 550:9 ConditionalExpression. A DAPC of 0 is never above the ceiling.
- `src/safety/governor.ts` 559:11 ConditionalExpression, 1096:9 ConditionalExpression. Writes the register list at index `undefined`, which nothing reads.
- `src/safety/governor.ts` 626:11 LogicalOperator, 626:11 ConditionalExpression, 626:11 ConditionalExpression, 627:11 ConditionalExpression, 627:22 StringLiteral, 637:11 ConditionalExpression, 637:11 ConditionalExpression, 637:11 LogicalOperator, 638:11 ConditionalExpression, 638:22 StringLiteral. For a short address, the check before has already refused gear without Tc (or RGBWAF), and the group check reads the same gear.
- `src/safety/governor.ts` 681:15 ConditionalExpression. `info.get(null)` is undefined.
- `src/safety/governor.ts` 685:14 ObjectLiteral, 685:20 BooleanLiteral. `mixSum` gives 1 for `{}`, for `{ tc: false, channels: 0 }` and for `{ tc: true, channels: 0 }`.
- `src/safety/governor.ts` 692:19 ConditionalExpression. `info.get(null)` is undefined, so the colour is unknown either way.
- `src/safety/governor.ts` 747:11 ConditionalExpression. On the first breakpoint `a` is undefined, the sample count is NaN and the loop does not run.
- `src/safety/governor.ts` 795:13 LogicalOperator, 795:13 ConditionalExpression. Commands other than DAPC that carry a value carry a scene or group number of 15 or less, which is never above a fitted level.
- `src/safety/governor.ts` 797:13 ConditionalExpression. A DAPC of 0 is never above the fitted level, so it is left alone either way.
- `src/safety/governor.ts` 980:24 BooleanLiteral, 981:26 BooleanLiteral. Flags on the OFF added to the prediction after a RESET. The simulator ignores both for OFF.
- `src/safety/governor.ts` 994:18 MethodExpression, 994:47 ConditionalExpression, 994:47 EqualityOperator. History older than 6 s is added to both the prediction with and without the transaction, and no rule window is longer than 5 s.
- `src/safety/governor.ts` 1017:41 EqualityOperator, 1017:45 ArithmeticOperator, 1017:56 EqualityOperator, 1017:56 ConditionalExpression, 1018:13 ConditionalExpression. The RESET's own step and the OFF after it fall in the window either way, and removing either leaves the same count.
- `src/safety/governor.ts` 1022:9 MethodExpression. RESET always travels on its own, so `some` and `every` agree.
- `src/safety/governor.ts` 1144:11 ConditionalExpression. DAPC is the only command in `SETS_LAST_ACTIVE` that carries a value.
- `src/safety/governor.ts` 1203:20 EqualityOperator. Swaps the RGB and WAF marks. Both must be seen before ACTIVATE, so the result is the same.
- `src/safety/governor.ts` 1219:9 ConditionalExpression, 1304:7 ConditionalExpression. The default branch only breaks.
- `src/safety/governor.ts` 1225:32 ConditionalExpression, 1225:45 StringLiteral, 1237:15 ConditionalExpression. `learn` reads nothing from a result without a reply byte.
- `src/safety/mix.ts` 31:7 ConditionalExpression, 31:7 EqualityOperator. `maxArcForMix` returns the ceiling for a sum of 1 or less either way.
- `src/safety/profile.ts` 35:11 ConditionalExpression. A result that is not a refusal has no `retryAt`, so the next check returns it.
- `src/safety/profile.ts` 111:14 ConditionalExpression, 111:14 LogicalOperator, 111:14 ConditionalExpression, 111:34 ConditionalExpression. Adds `undefined` or 254 to the device types, which are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 96:32 ConditionalExpression. `back1` is set before `back2`, so `back2` is undefined whenever `back1` is.
- `src/safety/rate/legs.ts` 89:25 EqualityOperator. A change of 0 has already been skipped, so `d` is never 0 here.
- `src/safety/rate/trace.ts` 73:7 ConditionalExpression, 96:11 ConditionalExpression, 96:21 StringLiteral. A terminal marked unused has no output, so it adds nothing and has no events.
- `src/safety/rate/trace.ts` 99:43 ArrowFunction, 99:51 ObjectLiteral. A leg on any channel is also a leg in the luminance trace, so the luminance events are already there.

### An exact boundary (12)

The mutant only differs when two values are exactly equal, such as a float measure equal to the ceiling to the last bit, or two events on the same millisecond.

- `src/safety/ceiling.ts` 49:13 EqualityOperator. Only differs for a fade heading for level 1, which is under the bench gear's physical minimum.
- `src/safety/governor.ts` 462:28 EqualityOperator. Only differs when a transaction is judged exactly at the end of the 2 s follow-up window.
- `src/safety/governor.ts` 560:24 EqualityOperator. Only differs when a DTR write is delivered on the exact millisecond the gear stops being deaf.
- `src/safety/governor.ts` 668:11 EqualityOperator, 783:13 EqualityOperator, 1323:12 EqualityOperator. Only differs when a measure equals the limit to the last bit.
- `src/safety/governor.ts` 804:29 EqualityOperator. Only differs when the fitted level is exactly 1, which the bench gear cannot hold.
- `src/safety/governor.ts` 1004:9 EqualityOperator. Only differs when the first frame lands on the exact millisecond the connect hold ends.
- `src/safety/governor.ts` 1022:54 EqualityOperator. Only differs exactly 10 s after the last RESET.
- `src/safety/governor.ts` 1322:16 ArithmeticOperator. Ends the range 1 ms before the end of the fade instead of 1 ms after. The level at the end is reached by then.
- `src/safety/rate/legs.ts` 88:9 EqualityOperator. Only differs when a change equals the flat tolerance exactly.
- `src/safety/rate/trace.ts` 47:9 EqualityOperator. Only differs when a breakpoint is exactly the lead time after the start of the range.

### Search and sampling density (30)

The mutant samples more or fewer points, or steps a search differently, and still finds the same peak or the same retry time.

- `src/safety/governor.ts` 742:17 MethodExpression, 742:80 ArrowFunction, 742:90 ArithmeticOperator, 748:19 MethodExpression, 748:44 ArithmeticOperator, 748:45 ArithmeticOperator, 749:25 EqualityOperator, 749:53 ArithmeticOperator. The interior sampling in `maxMeasure` still finds the peak: more samples, unsorted breakpoints that still cover the range, or a sample on a breakpoint already counted.
- `src/safety/governor.ts` 771:27 EqualityOperator, 771:40 UpdateOperator. The fit settles in at most two attempts, so the bound on the third is never reached.
- `src/safety/governor.ts` 990:16 MethodExpression. Drops the 17 minute horizon, which only matters for fades longer than any test runs.
- `src/safety/governor.ts` 1061:13 MethodExpression, 1061:22 ArithmeticOperator, 1062:21 EqualityOperator, 1062:29 UpdateOperator, 1066:42 ArrowFunction, 1067:11 ConditionalExpression, 1067:33 MethodExpression, 1067:46 ArithmeticOperator, 1067:47 ArithmeticOperator. The retry search reaches the same earliest passing time from another start or with another step, in the first round.
- `src/safety/rate/trace.ts` 43:18 MethodExpression, 43:41 ArrowFunction, 43:51 ArithmeticOperator. The times go into a set, and every sample time is still added.
- `src/safety/rate/trace.ts` 50:21 ConditionalExpression, 50:43 ArithmeticOperator, 50:43 EqualityOperator, 50:43 ConditionalExpression, 52:51 ArithmeticOperator, 52:52 ArithmeticOperator, 53:23 EqualityOperator. The interior samples in a faded trace still find the same legs.

### A stray entry in a list (16)

Stryker puts a string into an empty list. The list is only searched for numbers, ids or events with a time, so the string is never matched.

- `src/safety/governor.ts` 174:26 ArrayDeclaration. `decodeFrames` is only searched for command ids.
- `src/safety/governor.ts` 238:95 ArrayDeclaration. The synthetic events are filtered by time, and a string has none.
- `src/safety/governor.ts` 836:53 ArrayDeclaration, 860:33 ArrayDeclaration (no coverage), 871:74 ArrayDeclaration (no coverage), 928:32 ArrayDeclaration, 1016:47 ArrayDeclaration (no coverage), 1093:39 ArrayDeclaration, 1188:63 ArrayDeclaration (no coverage). The list is read for addresses, device types or scene levels, and a string matches none of them.
- `src/safety/profile.ts` 104:27 ArrayDeclaration, 205:40 ArrayDeclaration. The device types are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 114:36 ArrayDeclaration, 114:46 ArrayDeclaration, 114:61 ArrayDeclaration. `EMPTY` is the baseline for a scope with no events, and its lists are only compared by time.
- `src/safety/rate/legs.ts` 185:32 ArrayDeclaration. The clusters are read by direction and time.
- `src/safety/rate/trace.ts` 100:42 ArrayDeclaration. The red events are read by time.

### Text that is not shown (5)

The mutant changes the note for a transaction that was not changed. Such a transaction is allowed, and an allow carries no note.

- `src/safety/governor.ts` 435:51 StringLiteral. The note for a confirmed transaction, which the fit never changes.
- `src/safety/governor.ts` 789:17 ConditionalExpression, 789:34 StringLiteral, 813:17 ConditionalExpression, 813:34 StringLiteral. The note for a fit that changed nothing.

### Equivalent while fades are not confirmed (4)

With `FADE_BEHAVIOUR_CONFIRMED` false, every change on hardware is already counted as an instant hard step, so the extra event or mark the mutant removes or adds coincides with one that is there already.

- `src/safety/governor.ts` 830:37 ConditionalExpression, 830:37 OptionalChaining, 837:14 ConditionalExpression. The level a DAPC or OFF makes known inside a transaction.
- `src/safety/governor.ts` 960:9 ConditionalExpression. The colour of gear without DT8 is marked known.

### A shift of a few milliseconds (3)

The mutant moves a predicted delivery by a few milliseconds. No rule depends on so small a shift.

- `src/safety/governor.ts` 709:44 ConditionalExpression. Later frames get the first frame's settling time, about 1.4 ms more.
- `src/safety/governor.ts` 732:17 ArithmeticOperator, 1087:36 ArithmeticOperator. Moves the predicted second copy of a send-twice frame by two frame times, still inside the 100 ms window.
