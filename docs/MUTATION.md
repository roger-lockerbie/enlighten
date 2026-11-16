# Mutation testing

`pnpm mutate` runs Stryker with the Vitest runner on `src/safety` and on the codec in `src/dali` (TEST_PLAN M-safety). The target is a score of 85% or more, with every surviving mutant in `src/safety` listed here with the reason it survives.

## Result

Stage 5: one fresh `pnpm mutate` run, without `--incremental`, on the source at commit `76138cb`. **93.92%** in all and **93.61%** on `src/safety`, against the 85% target. 3,112 mutants: 2,886 killed, 36 timed out, 173 survived, 16 with no coverage and 1 runtime error.

| File                       | Score      | Killed | Timed out | Survived | No coverage |
| -------------------------- | ---------- | ------ | --------- | -------- | ----------- |
| `src/dali/codec.ts`        | 98.15%     | 212    | 0         | 2        | 2           |
| `src/safety/ceiling.ts`    | 86.36%     | 111    | 3         | 16       | 2           |
| `src/safety/governor.ts`   | 92.79%     | 1653   | 8         | 118      | 11          |
| `src/safety/mix.ts`        | 92.59%     | 23     | 2         | 2        | 0           |
| `src/safety/panic.ts`      | 100.00%    | 3      | 0         | 0        | 0           |
| `src/safety/profile.ts`    | 97.73%     | 291    | 10        | 7        | 0           |
| `src/safety/rate/guard.ts` | 97.47%     | 151    | 3         | 4        | 0           |
| `src/safety/rate/legs.ts`  | 97.22%     | 200    | 10        | 6        | 0           |
| `src/safety/rate/trace.ts` | 85.38%     | 111    | 0         | 18       | 1           |
| `src/safety/rules.ts`      | 100.00%    | 127    | 0         | 0        | 0           |
| `src/safety/types.ts`      | 100.00%    | 4      | 0         | 0        | 0           |
| All of `src/safety`        | 93.61%     | 2674   | 36        | 171      | 14          |
| **Total**                  | **93.92%** | 2886   | 36        | 173      | 16          |

The run found a real gap: the governor's retry search dropped the retry time of the hold while the simulated bench is rebuilt, so the S5-D13 fix had no effect (S5-D19 in `docs/SECURITY_FINDINGS.md`). That is fixed, with tests for the ceiling's retries and fallbacks written against this run. After those changes, targeted runs (`--mutate` on the lines with survivors this list did not have, and on all of `src/safety/ceiling.ts`) gave these results:

- `src/safety/ceiling.ts` scores 97.79%: 133 killed and 3 survivors, each listed below.
- Of the 94 survivors that Stage 4's list did not have, 35 were killed. The property tests draw new cases on each run, five per mutant, so a mutant that only some cases catch can survive one run and not the next.
- 57 survive in code this stage did not change, and Stage 4's run had killed them. A spot check shows why: see "Killed in Stage 4 only by the old checker" below.

A full run was not repeated after the fixes. It takes about 7.5 hours, and the targeted runs cover every line the fixes touched.

## How the score was reached

Stage 3's run started at 70.86% and reached 94.73% with tests added for what it found, over several incremental and targeted runs. Stage 4 added the engine's tests and the new governor and router tests, and its single fresh run scored 96.69% (96.58% on `src/safety`). Its notes warned that the checker fix that followed it (S4-P4) could lower a fresh run's score. Stage 5's run is the first since then, and the 57 survivors in the last group below account for most of the fall. Most mutants that survived Stage 3 are listed again below at their new line numbers. Eight are new: `src/safety/governor.ts` 224:79 and the four at 367 (`issued`), and in `src/safety/rate/legs.ts` the three in `uniteTimes` (214:28, 218:18, 221:9). Many Stage 3 survivors are now killed.

Every run uses `PROP_RUNS=5`, so each property test runs five cases per mutant. The property tests run 1,000 cases each at stage close.

To check one line after a change, without incremental mode:

```sh
PROP_RUNS=5 pnpm exec stryker run --mutate 'src/safety/governor.ts:988-988'
```

Several ranges go in one comma-separated `--mutate` value. A second `--mutate` flag replaces the first.

## Why the rest survive

Each surviving mutant is listed by file, line and column, at the line numbers of the code after Stage 5, with the change Stryker made. They fall into these groups.

### A check that cannot fail (22)

The value is always present, or the case cannot be reached, so removing or reversing the check changes nothing a test, or a user, can see.

- `src/dali/codec.ts` 59:5 ConditionalExpression (no coverage), 60:14 BooleanLiteral (no coverage). Every special command kind has its own case.
- `src/safety/governor.ts` 78:29 ConditionalExpression. `modelAddress` refuses DT8 gear whose colour features were not read back, so `colour` is never undefined here.
- `src/safety/governor.ts` 179:9 ConditionalExpression. It runs after the rules, when every frame decodes.
- `src/safety/governor.ts` 490:14 OptionalChaining, 490:33 OptionalChaining. Every frame decodes after the rules, and every OFF carries an address.
- `src/safety/governor.ts` 574:9 ConditionalExpression. A DAPC always carries a level.
- `src/safety/governor.ts` 648:13 OptionalChaining, 659:13 OptionalChaining. Colour commands always carry an address.
- `src/safety/governor.ts` 745:11 ConditionalExpression, 745:46 StringLiteral (no coverage). `plan` only sees transactions that passed the rules, where every frame decodes.
- `src/safety/governor.ts` 820:36 ConditionalExpression. Every DAPC carries an address.
- `src/safety/governor.ts` 843:12 ObjectLiteral (no coverage), 843:18 BooleanLiteral (no coverage), 843:33 StringLiteral (no coverage). The fit settles in at most two attempts, so the refusal after the third is never reached.
- `src/safety/governor.ts` 896:56 OptionalChaining. GO TO SCENE needs verified gear, and verified gear has its info.
- `src/safety/governor.ts` 998:35 ConditionalExpression. RESET always carries an address.
- `src/safety/governor.ts` 1045:22 OptionalChaining. The prediction always has the reset gear and the room as scopes.
- `src/safety/governor.ts` 1140:14 OptionalChaining. `unknownEvents` only asks about an address after finding its info.
- `src/safety/governor.ts` 1156:67 OptionalChaining. Every OFF carries an address.
- `src/safety/governor.ts` 1335:13 OptionalChaining. Modelled gear always has a unit in the shadow.
- `src/safety/rate/trace.ts` 68:74 StringLiteral (no coverage). Every terminal has a label.

### The same result by another path (51)

The mutant changes the code, but another part of it gives the same answer.

- `src/dali/codec.ts` 85:9 ConditionalExpression, 91:9 ConditionalExpression. `isByte(undefined)` and `Number.isInteger(undefined)` are already false.
- `src/safety/ceiling.ts` 41:9 ConditionalExpression. Drops `r.kind !== 'refused'`. Only a refusal carries a retry time, so a drop or a fault still returns `refused` through the second check.
- `src/safety/ceiling.ts` 106:11 ConditionalExpression. Sends the hold alone after an address that went through. The hold then finds that address under the ceiling and sends nothing.
- `src/safety/governor.ts` 1093:9 LogicalOperator (twice), 1093:9 ConditionalExpression (twice), 1093:43 ConditionalExpression, 1093:61 ConditionalExpression, 1093:61 OptionalChaining, 1094:44 ArithmeticOperator. The hold's own retry time (S5-D19). The hold is always the only violation when it refuses, its retry time is always after `now`, and where the check is dropped the rate guard's own hint and the searched time are the same (governor test "after a hold with a retry time has ended").
- `src/safety/governor.ts` 78:69 StringLiteral, 81:82 StringLiteral, 82:48 StringLiteral. Only C2 and C5 have two colour presentations. For C1, C3 and C4 the profile ignores it.
- `src/safety/governor.ts` 190:10 LogicalOperator, 190:10 ConditionalExpression, 190:10 ConditionalExpression, 190:35 ConditionalExpression, and the same four at 383:12, 383:12, 383:12 and 383:37 in `issued`. `WeakSet.has` is false for anything that is not an object, so the type checks before it change nothing.
- `src/safety/governor.ts` 224:79 ArrayDeclaration. Starts the DTR list empty instead of three unknowns. Reading any index of either gives `undefined`, and `dtrView` is only read by index or after all three are written.
- `src/safety/governor.ts` 306:12 ConditionalExpression. `structuredClone(undefined)` is undefined.
- `src/safety/governor.ts` 575:9 ConditionalExpression. A DAPC of 0 is never above the ceiling.
- `src/safety/governor.ts` 584:11 ConditionalExpression. Writes the register list at index `undefined`, which nothing reads.
- `src/safety/governor.ts` 651:11 LogicalOperator, 651:11 ConditionalExpression. For a short address, the check before has already refused gear without Tc (or RGBWAF), and the group check reads the same gear.
- `src/safety/governor.ts` 820:13 LogicalOperator, 820:13 ConditionalExpression. Commands other than DAPC that carry a value carry a scene or group number of 15 or less, which is never above a fitted level.
- `src/safety/governor.ts` 822:13 ConditionalExpression. A DAPC of 0 is never above the fitted level, so it is left alone either way.
- `src/safety/governor.ts` 1005:24 BooleanLiteral, 1006:26 BooleanLiteral. Flags on the OFF added to the prediction after a RESET. The simulator ignores both for OFF.
- `src/safety/governor.ts` 1046:41 EqualityOperator, 1046:45 ArithmeticOperator, 1046:56 EqualityOperator, 1046:56 ConditionalExpression, 1047:13 ConditionalExpression. The RESET's own step and the OFF after it fall in the window either way, and removing either leaves the same count.
- `src/safety/governor.ts` 1179:11 ConditionalExpression. DAPC is the only command in `SETS_LAST_ACTIVE` that carries a value.
- `src/safety/mix.ts` 31:7 ConditionalExpression, 31:7 EqualityOperator. `maxArcForMix` returns the ceiling for a sum of 1 or less either way.
- `src/safety/profile.ts` 111:14 ConditionalExpression, 111:14 LogicalOperator, 111:14 ConditionalExpression, 111:34 ConditionalExpression. Adds `undefined` or 254 to the device types, which are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 98:32 ConditionalExpression. `back1` is set before `back2`, so `back2` is undefined whenever `back1` is.
- `src/safety/rate/legs.ts` 214:28 ArithmeticOperator. Changes the order of two events at the same time from different predictions. `uniteTimes` keeps only times, and both have the same time.
- `src/safety/rate/legs.ts` 218:18 ArrayDeclaration. Starts the counts empty. The first event always opens a group, which sets both counts to 0, and a missing count is read as 0 anyway.
- `src/safety/rate/trace.ts` 96:21 StringLiteral. A terminal marked unused has no output, so it has no events.
- `src/safety/rate/trace.ts` 99:43 ArrowFunction. A leg on any channel is also a leg in the luminance trace, so the luminance events are already there.

### An exact boundary (8)

The mutant only differs when two values are exactly equal, such as a float measure equal to the ceiling to the last bit, or two events on the same millisecond.

- `src/safety/ceiling.ts` 87:12 EqualityOperator. Only differs for a fade heading for level 1, which is under the bench gear's physical minimum.
- `src/safety/governor.ts` 487:28 EqualityOperator. Only differs when a transaction is judged exactly at the end of the 2 s follow-up window.
- `src/safety/governor.ts` 585:24 EqualityOperator. Only differs when a DTR write is delivered on the exact millisecond the gear stops being deaf.
- `src/safety/governor.ts` 808:13 EqualityOperator. Only differs when a measure equals the limit to the last bit.
- `src/safety/governor.ts` 829:29 EqualityOperator. Only differs when the fitted level is exactly 1, which the bench gear cannot hold.
- `src/safety/governor.ts` 1051:54 EqualityOperator. Only differs exactly 10 s after the last RESET.
- `src/safety/rate/legs.ts` 88:9 EqualityOperator. Only differs when a change equals the flat tolerance exactly.
- `src/safety/rate/legs.ts` 221:9 EqualityOperator. Only differs when two predicted events are exactly 5 ms apart.

### Search and sampling density (15)

The mutant samples more or fewer points, or steps a search differently, and still finds the same peak or the same retry time.

- `src/safety/governor.ts` 796:40 UpdateOperator. The fit settles in at most two attempts, so the bound on the third is never reached.
- `src/safety/governor.ts` 1096:21 EqualityOperator, 1100:20 MethodExpression, 1100:42 ArrowFunction, 1101:11 ConditionalExpression, 1101:33 MethodExpression, 1101:46 ArithmeticOperator, 1101:47 ArithmeticOperator. The retry search reaches the same earliest passing time from another start or with another step, in the first round.
- `src/safety/governor.ts` 1095:13 MethodExpression, 1095:22 ArithmeticOperator, 1101:29 ArithmeticOperator (no coverage). The retry search's start and its wider step. The search reaches a time that passes from the earlier start, and in this run it never needed the wider step.
- `src/safety/rate/trace.ts` 43:18 MethodExpression. The times go into a set, and every sample time is still added.
- `src/safety/rate/trace.ts` 50:43 ArithmeticOperator, 50:43 EqualityOperator, 52:52 ArithmeticOperator. The interior samples in a faded trace still find the same legs.

### A stray entry in a list (10)

Stryker puts a string into an empty list. The list is only searched for numbers, ids or events with a time, so the string is never matched.

- `src/safety/governor.ts` 175:26 ArrayDeclaration. `decodeFrames` is only searched for command ids.
- `src/safety/governor.ts` 239:95 ArrayDeclaration. The synthetic events are filtered by time, and a string has none.
- `src/safety/governor.ts` 885:33 ArrayDeclaration (no coverage), 896:74 ArrayDeclaration, 953:32 ArrayDeclaration, 1045:47 ArrayDeclaration (no coverage), 1223:63 ArrayDeclaration (no coverage). The list is read for addresses, device types or scene levels, and a string matches none of them.
- `src/safety/profile.ts` 205:40 ArrayDeclaration. The device types are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 116:36 ArrayDeclaration. `EMPTY` is the baseline for a scope with no events, and its lists are only compared by time.
- `src/safety/rate/legs.ts` 185:32 ArrayDeclaration. The clusters are read by direction and time.

### Text that is not shown (5)

The mutant changes the note for a transaction that was not changed. Such a transaction is allowed, and an allow carries no note.

- `src/safety/governor.ts` 459:51 StringLiteral. The note for a confirmed transaction, which the fit never changes.
- `src/safety/governor.ts` 814:17 ConditionalExpression, 814:34 StringLiteral, 838:17 ConditionalExpression, 838:34 StringLiteral. The note for a fit that changed nothing.

### Equivalent while fades are not confirmed (1)

With `FADE_BEHAVIOUR_CONFIRMED` false, every change on hardware is already counted as an instant hard step, so the extra event the mutant removes coincides with one that is there already.

- `src/safety/governor.ts` 855:37 OptionalChaining. The level a DAPC or OFF makes known inside a transaction.

### A shift of a few milliseconds (1)

The mutant moves a predicted delivery by a few milliseconds. No rule depends on so small a shift.

- `src/safety/governor.ts` 1123:38 ArithmeticOperator. Moves the predicted second copy of a send-twice frame by two frame times, still inside the 100 ms window.

### Killed in Stage 4 only by the old checker (57)

These mutants are in code Stage 5 did not change, and Stage 4's run killed them. After that run, the property checker in `tests/harness/checker.ts` changed to sample every unit at the same times, which removed false steps in the room's total (S4-P4). The Stage 4 notes above said a mutant that only a false failure killed would then survive. Two runs in Stage 5 show these do.

A spot check confirms it for `src/safety/rate/trace.ts` 43:51, which stops the breakpoints being sorted. With the mutant in place, `PROP_RUNS=5 pnpm test:prop` passed twice with the current checker and failed one property twice with the checker as it was before S4-P4.

They are not yet analysed one by one. Some will be equivalent, and some show where the property tests are thin, such as the sampling in `trace.ts` and the colour-mix fit in the governor. Tests aimed at them are a follow-up.

- `src/safety/governor.ts` 652:11 ConditionalExpression, 652:22 StringLiteral, 662:11 ConditionalExpression, 663:11 ConditionalExpression, 663:22 StringLiteral, 686:9 ConditionalExpression, 693:11 EqualityOperator, 706:15 ConditionalExpression, 710:14 ObjectLiteral, 710:20 BooleanLiteral, 717:19 ConditionalExpression, 734:44 ConditionalExpression, 757:17 ArithmeticOperator, 765:9 ConditionalExpression, 767:17 MethodExpression, 767:80 ArrowFunction, 767:90 ArithmeticOperator, 772:11 ConditionalExpression, 773:19 MethodExpression, 773:44 ArithmeticOperator, 773:45 ArithmeticOperator, 774:25 EqualityOperator, 774:53 ArithmeticOperator, 796:27 EqualityOperator, 806:13 EqualityOperator, 861:53 ArrayDeclaration, 862:14 ConditionalExpression, 885:9 ConditionalExpression, 985:9 ConditionalExpression, 1019:18 MethodExpression, 1019:47 ConditionalExpression, 1019:47 EqualityOperator, 1051:9 MethodExpression, 1125:9 ConditionalExpression, 1128:39 ArrayDeclaration, 1131:9 ConditionalExpression, 1238:20 EqualityOperator, 1260:32 ConditionalExpression, 1260:45 StringLiteral, 1273:15 ConditionalExpression, 1359:12 EqualityOperator.
- `src/safety/profile.ts` 35:11 ConditionalExpression, 104:27 ArrayDeclaration.
- `src/safety/rate/guard.ts` 116:46 ArrayDeclaration, 116:61 ArrayDeclaration.
- `src/safety/rate/legs.ts` 89:25 EqualityOperator.
- `src/safety/rate/trace.ts` 43:41 ArrowFunction, 43:51 ArithmeticOperator, 47:9 EqualityOperator, 50:21 ConditionalExpression, 52:51 ArithmeticOperator, 53:23 EqualityOperator, 73:7 ConditionalExpression, 96:11 ConditionalExpression, 99:51 ObjectLiteral, 100:42 ArrayDeclaration, 112:9 ArithmeticOperator.
