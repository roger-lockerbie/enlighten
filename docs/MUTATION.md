# Mutation testing

`pnpm mutate` runs Stryker with the Vitest runner on `src/safety` and on the codec in `src/dali` (TEST_PLAN M-safety). The target is a score of 85% or more, with every surviving mutant in `src/safety` listed here with the reason it survives.

## Stage 8b: the rate guard

Line numbers are those of the source the run used. `src/safety/rate` has not changed since the run, so its result and reasons stand. `governor.ts` has: ADR 0019 amendments 1 and 2 rewrote the colour rule and the events for unknown gear after it, so the governor lines and survivors listed below describe code that is partly gone. The rewritten code has unit tests, fixed cases on the bench and an aimed property, and no mutation run. A run on it is left for hardware day, when those rules are next changed.

Stage 8b rewrote `src/safety/rate` and changed 404 lines of `src/safety/governor.ts` (ADR 0019). Its runs cover the three rate files in full, the governor lines the stage changed, and the lines of the 57 mutants Stage 5 left unanalysed. They do not cover the rest of `src/safety` or the codec, which the stage did not touch. A full run was not repeated: the first of these took 168 minutes on its own.

| Files                                     | Score      | Killed | Timed out | Survived | No coverage |
| ----------------------------------------- | ---------- | ------ | --------- | -------- | ----------- |
| `src/safety/rate/guard.ts`                | 95.90%     | 253    | 4         | 11       | 0           |
| `src/safety/rate/legs.ts`                 | 91.87%     | 584    | 15        | 52       | 1           |
| `src/safety/rate/trace.ts`                | 89.43%     | 312    | 18        | 33       | 6           |
| **All of `src/safety/rate`**              | **92.01%** | 1149   | 37        | 96       | 7           |
| `src/safety/governor.ts`, the lines run   | 83.19%     |        |           | 124      | 15          |
| `src/safety/profile.ts`, lines 35 and 104 |            | 6      | 6         | 2        | 0           |

The governor row is 688 of 827 mutants killed or timed out, counted over several runs, so it has no split between the two. It is under the 85% target because the lines were picked for having survivors: they include every line of the 57. All 244 survivors are listed below with the reason each survives.

### How the score was reached

1. A first run on the rate files alone scored 83.92%, with 205 mutants surviving or uncovered. Most were in `trace.ts`: the slow test at the ends of its intervals, the sample times of the shifted readings, and which events count as new. Fixed tests were added for those in `spans.test.ts`, `edges.test.ts` and `tests/properties/hard-steps.test.ts`, with one fixed trace for each of the 8 ms and 17 ms readings that only that reading catches.
2. A second run, on the final source, covered the rate files and the governor lines. The rate files scored 91.93%. The governor lines scored 65.05%, with 289 surviving or uncovered. About half were real gaps in the tests for code this stage added: the colour rule (S5-P1), the event for each command (S8b-H1) and the OFF that ends a range. Nothing pinned that a whole colour needs both parts, that a masked channel or a lost register write leaves it unknown, how long the room waits, or that an OFF the gear may not have heard ends nothing. One test matched another rule's message and passed with the wait for a colour's fade removed.
3. Twenty-six tests were added to `src/safety/governor.hardware.test.ts`, with sharper checks in five it already had, and a span case to `spans.test.ts`. None found a fault in the guard or the governor. Four targeted runs on the lines that still had survivors brought the governor's count from 289 to 139.

### The 57 from Stage 5

Stage 5 listed 57 mutants that only the old checker had killed, and left them unanalysed. Each is now killed, gone or explained:

- **Governor, 41.** Five were on lines that no longer exist (985, 1019 and 1238 at Stage 5's numbers). Two are killed by this stage's tests: 862:14 (now 1047:14, a relative command marking the level known) and 1051:9 (now 1595:9, a RESET sent with a register write). The other 34 are in the lists below at their new lines: 811, 821, 822, 845, 852, 865, 869, 876, 893, 919, 953, 955, 960, 961, 962, 984, 994, 1046, 1118, 1644, 1647, 1653, 1827, 1840 and 1936. They are in the ceiling's fit and the colour rules, not the rate guard, and each is equivalent, on an exact boundary or a matter of sampling density.
- **`profile.ts`, 2.** Both survive and are listed below.
- **`rate/guard.ts`, 2.** The stray entries in `EMPTY`, now at 170:46 and 170:61, listed below.
- **`rate/legs.ts` 1 and `rate/trace.ts` 11.** The code they were in is rewritten. The spot check Stage 5 made, a mutant that stopped the breakpoints being sorted, has no counterpart: the grid is now a sorted set built in one place, and the fixed sample-time tests in `edges.test.ts` pin it.

### Why they survive

Each is listed by file, line and column at the line numbers of the code after Stage 8b, with the change Stryker made.

#### A check that cannot fail (63)

The value is always present, or the case cannot be reached, so removing or reversing the check changes nothing a test, or a user, can see.

- `src/safety/governor.ts` 305:9 ConditionalExpression, 305:9 LogicalOperator, 305:9 ConditionalExpression, 305:21 ConditionalExpression, 305:21 EqualityOperator. In `endUnknown`. No event in the list is later than the OFF or scan that ends it, and an event whose range has already ended keeps the same end.
- `src/safety/governor.ts` 666:42 OptionalChaining. Every member of an address has its info.
- `src/safety/governor.ts` 821:11 ConditionalExpression, 845:9 ConditionalExpression. Colour and store commands always carry an address.
- `src/safety/governor.ts` 953:9 ConditionalExpression. `maxMeasure` is only asked about units the simulator holds.
- `src/safety/governor.ts` 1099:29 ConditionalExpression, 1536:33 ConditionalExpression. Every OFF carries an address.
- `src/safety/governor.ts` 1118:9 ConditionalExpression, 1118:33 ArrayDeclaration (no coverage). Every light-changing command carries an address.
- `src/safety/governor.ts` 1082:45 ConditionalExpression, 1082:71 ArrayDeclaration (no coverage), 1084:61 ConditionalExpression. An event that names no address is the room's. The phantom driver has an address of its own, -1.
- `src/safety/governor.ts` 1130:7 OptionalChaining. `members` only gives addresses that have their info.
- `src/safety/governor.ts` 1133:29 ConditionalExpression, 1133:29 EqualityOperator. With no address reached, the loop that follows adds nothing either.
- `src/safety/governor.ts` 1279:9 LogicalOperator, 1279:9 ConditionalExpression, 1279:9 ConditionalExpression, 1279:9 OptionalChaining, 1279:33 ConditionalExpression, 1279:57 BooleanLiteral (no coverage). `mayFade` is asked only for gear whose colour is known, and a fault or a scan that unmodels gear makes its colour unknown. Modelled gear always has a unit in the shadow.
- `src/safety/governor.ts` 1288:12 ConditionalExpression. `isOff` is asked only for modelled gear, which always has a unit.
- `src/safety/governor.ts` 1418:11 LogicalOperator, 1418:11 ConditionalExpression, 1418:35 ConditionalExpression, 1418:80 UnaryOperator. The rules refuse colour commands to gear that is not modelled, so the colour rule only meets modelled gear here, and modelled gear has a unit.
- `src/safety/governor.ts` 1447:36 ConditionalExpression, 1447:43 StringLiteral. The `RESET` half of the test. A RESET goes only with commands that change no light, so the rule never sees a colour or a level after one in a transaction. `observe` has its own test (S8b-D8).
- `src/safety/governor.ts` 1467:55 UnaryOperator (no coverage). The fallback is read only when no colour is settling, where any value in the past does the same.
- `src/safety/governor.ts` 1563:10 OptionalChaining, 1563:35 ArrayDeclaration (no coverage). The prediction always has the reset gear and the room as scopes.
- `src/safety/governor.ts` 1644:9 ConditionalExpression. `observe` only sees frames that passed the rules, and those decode.
- `src/safety/rate/legs.ts` 262:33 UnaryOperator (no coverage). `firstWithin` only reads indexes inside the list.
- `src/safety/rate/legs.ts` 315:7 ConditionalExpression. `lim === RULE` is a short cut. The test after it gives the same answer for the rule's own limits.
- `src/safety/rate/legs.ts` 326:12 ConditionalExpression, 326:12 EqualityOperator, 326:37 OptionalChaining. The window list always holds the newest sample, which is never older than the window.
- `src/safety/rate/legs.ts` 453:5 ConditionalExpression. A run that is a fast leg always has its fast start.
- `src/safety/rate/legs.ts` 465:9 ConditionalExpression. The first step always opens a group, since `near` starts at minus infinity.
- `src/safety/rate/trace.ts` 65:9 ConditionalExpression, 65:9 LogicalOperator, 65:9 ConditionalExpression, 65:9 EqualityOperator, 65:23 ConditionalExpression, 65:23 EqualityOperator. `planBreakpoints` only gives times inside the span asked for.
- `src/safety/rate/trace.ts` 150:9 ConditionalExpression, 166:12 OptionalChaining, 170:9 ConditionalExpression, 170:33 BooleanLiteral (no coverage). The plan list is never empty and every index the search reads is inside it.
- `src/safety/rate/trace.ts` 201:74 StringLiteral (no coverage). Every terminal has a label.
- `src/safety/rate/trace.ts` 206:7 ConditionalExpression. Gear with no red terminal has no red output to be saturated.
- `src/safety/rate/trace.ts` 226:41 ArrayDeclaration (no coverage), 226:45 ConditionalExpression, 226:66 ArrayDeclaration (no coverage), 257:40 OptionalChaining, 257:40 OptionalChaining, 257:60 ArrayDeclaration (no coverage), 303:23 OptionalChaining, 303:43 ArrayDeclaration (no coverage). Fallbacks the type checker asks for: every unit has its samples and there is always a first reading.

#### The same result by another path (101)

The mutant changes the code, but another part of it gives the same answer.

- `src/safety/governor.ts` 259:7 ConditionalExpression. For any other command the part is not read.
- `src/safety/governor.ts` 547:58 StringLiteral, 1233:50 StringLiteral, 1846:56 StringLiteral. The `settled` label. Any label that is not `off` ends the range at the same time.
- `src/safety/governor.ts` 811:11 ConditionalExpression, 811:22 StringLiteral, 822:11 ConditionalExpression, 822:22 StringLiteral. For a short address, the check before has already refused gear without Tc (or RGBWAF), and the group check reads the same gear.
- `src/safety/governor.ts` 865:15 ConditionalExpression, 876:19 ConditionalExpression. `info.get(null)` is undefined already.
- `src/safety/governor.ts` 869:14 ObjectLiteral, 869:20 BooleanLiteral. `mixSum` gives 1 for gear with no colour channels, whatever `tc` says when the channel count is 0 or missing.
- `src/safety/governor.ts` 1044:9 ArrowFunction, 1044:36 ArrowFunction, 1044:43 ConditionalExpression. `plan` gives one planned command for a frame sent twice, so `judge` never has a second copy to join. `observe` sees both copies, and its join is tested.
- `src/safety/governor.ts` 1088:52 StringLiteral. The key is only compared with other keys built the same way.
- `src/safety/governor.ts` 1238:5 CallExpression. A scan makes the colour unknown, no level goes until a whole colour is set, and setting it writes a new settling time.
- `src/safety/governor.ts` 1288:58 ConditionalExpression. The shadow starts a rise from off at once, so gear that is off at a command's time and not staying off does not occur.
- `src/safety/governor.ts` 1386:27 ArithmeticOperator, 1387:11 ConditionalExpression, 1387:35 ObjectLiteral, 1613:9 MethodExpression, 1613:9 ConditionalExpression, 1613:16 ArrowFunction, 1613:23 ConditionalExpression, 1613:35 BooleanLiteral. The `fixed` mark saves the retry search. Without it the search judges the transaction again at the suggested time, finds the same refusal each time and gives no time.
- `src/safety/governor.ts` 1392:20 ConditionalExpression, 1393:11 ConditionalExpression, 1653:9 ConditionalExpression. Asks for a colour part with no address, or writes the register list at index `undefined`. Nothing reads either.
- `src/safety/governor.ts` 1394:28 ConditionalExpression. A SET TEMPORARY that reads a register written while the gear is deaf is refused by the rules before the rate guard runs.
- `src/safety/governor.ts` 1422:64 ConditionalExpression, 1426:15 ConditionalExpression, 1793:40 ConditionalExpression, 1801:15 ConditionalExpression. Puts `undefined` in the set of parts, which is only asked for `tc`, `rgb` and `waf`.
- `src/safety/governor.ts` 1441:15 MethodExpression, 1441:31 ArithmeticOperator, 1486:33 ArithmeticOperator. The time to ask again. The retry search starts from it and reaches the same first time that passes.
- `src/safety/governor.ts` 1451:11 CallExpression. After a level command in a transaction, an ACTIVATE is refused or the colour is known, so the parts are not read again.
- `src/safety/governor.ts` 1530:18 MethodExpression, 1530:47 ConditionalExpression. Keeps events whose ranges ended before the look-back. They are too old to be in any window.
- `src/safety/governor.ts` 1678:26 ConditionalExpression, 1694:28 ConditionalExpression. An OFF sent while the gear is deaf would clear the moving mark. The event's range still stands (S8b-D5 has a test), and other gear waits for the range.
- `src/safety/governor.ts` 1814:35 ConditionalExpression. In the Simulator target the colour rule does not run, so a settling time is never read.
- `src/safety/governor.ts` 1827:32 ConditionalExpression, 1827:45 StringLiteral, 1840:15 ConditionalExpression. `learn` only acts on queries, and a result that is not a reply has no byte.
- `src/safety/governor.ts` 1865:23 ConditionalExpression. Marks the device type list open after a single type. Nothing reads it unless a NEXT DEVICE TYPE query follows, which a scan sends only after 255.
- `src/safety/profile.ts` 35:11 ConditionalExpression. Only a refusal carries a time to ask again, so the third check returns the same result.
- `src/safety/rate/guard.ts` 44:9 ConditionalExpression, 83:9 ConditionalExpression. Adds -1 to the set of used indexes, which is only asked about real ones.
- `src/safety/rate/guard.ts` 77:10 ConditionalExpression. An old range with no direction is in the new prediction too, with no direction, so the test after it matches them.
- `src/safety/rate/guard.ts` 79:11 ConditionalExpression, 80:11 ConditionalExpression. A hard step never has direction 0.
- `src/safety/rate/guard.ts` 98:33 ConditionalExpression, 98:33 EqualityOperator. The ranges come sorted by their start, so the second half of the test is always true.
- `src/safety/rate/guard.ts` 152:32 ConditionalExpression. `back1` is set before `back2`, so `back2` is undefined whenever `back1` is.
- `src/safety/rate/legs.ts` 287:7 ConditionalExpression, 287:7 EqualityOperator, 289:12 ArithmeticOperator. In `spanFrom`. The first sample in the window is never after the newest, and the search never reads the index above its top.
- `src/safety/rate/legs.ts` 337:9 CallExpression, 345:25 EqualityOperator, 358:17 BooleanLiteral. A flat sample has nothing to trim, a change of zero is handled as flat before the direction is read, and the first sample's `moved` flag is never read.
- `src/safety/rate/legs.ts` 375:9 ConditionalExpression. A slow sample adds no fast change, so the span test finds what it found at the sample before.
- `src/safety/rate/legs.ts` 382:9 ConditionalExpression, 382:9 ConditionalExpression, 382:9 LogicalOperator, 382:28 ConditionalExpression, 389:36 ConditionalExpression. A sample compared with itself has a ratio of 1, which is never a jump.
- `src/safety/rate/legs.ts` 460:10 ArrowFunction, 462:14 UnaryOperator. Every instant step lies inside a span that is already in order, and the first step opens a group either way.
- `src/safety/rate/legs.ts` 539:37 LogicalOperator, 539:37 ConditionalExpression, 539:47 ConditionalExpression, 539:67 UpdateOperator, 541:13 ConditionalExpression, 542:13 ConditionalExpression. The cautious loop in `mergeSteps`. Events the same way within 5 ms are merged first, so the loop finds its match at the last kept event or not at all.
- `src/safety/rate/legs.ts` 593:34 ArithmeticOperator, 643:34 ArithmeticOperator. The tie-break for two events at the same time. Both end in the same group.
- `src/safety/rate/legs.ts` 647:34 ConditionalExpression, 647:49 ConditionalExpression. A hard step never has direction 0.
- `src/safety/rate/legs.ts` 659:16 UnaryOperator, 661:11 EqualityOperator, 661:43 ConditionalExpression, 661:69 ConditionalExpression, 661:69 EqualityOperator, 661:69 EqualityOperator, 666:11 ConditionalExpression, 669:13 ConditionalExpression, 672:11 ConditionalExpression. Which reading anchors a united range. The range is the hull of every reading's dates, whichever is the anchor.
- `src/safety/rate/trace.ts` 94:11 ConditionalExpression, 94:11 EqualityOperator. An identify that ended before the plan began adds a breakpoint outside the span, which is dropped.
- `src/safety/rate/trace.ts` 143:30 ArrayDeclaration, 144:31 ArrayDeclaration, 147:16 ArithmeticOperator, 163:14 ArithmeticOperator. The arrays are filled before they are read, and the loops never read past the last plan.
- `src/safety/rate/trace.ts` 171:24 ConditionalExpression. A plan that began inside the interval is found by the test before it.
- `src/safety/rate/trace.ts` 230:11 ConditionalExpression, 230:21 StringLiteral. A terminal marked unused has no output, so it has no events.
- `src/safety/rate/trace.ts` 283:9 ConditionalExpression, 286:7 CallExpression. The cache of samples. Without it each reading samples again and gets the same samples.
- `src/safety/rate/trace.ts` 291:49 BooleanLiteral. With fades not confirmed, the instant reading and the faded one sample the same plan breakpoints, and the instant values are read from the plan, not the flag.

#### An exact boundary (28)

The mutant only differs when two values are exactly equal.

- `src/safety/governor.ts` 852:11 EqualityOperator, 994:13 EqualityOperator, 1936:12 EqualityOperator. Only differs when a measure equals the ceiling to the last bit.
- `src/safety/governor.ts` 1099:67 EqualityOperator, 1394:28 EqualityOperator, 1536:64 EqualityOperator, 1678:26 EqualityOperator, 1694:28 EqualityOperator. Only differs for a frame delivered on the exact millisecond the gear stops being deaf.
- `src/safety/governor.ts` 1437:15 EqualityOperator, 1482:17 EqualityOperator. Only differs when the level settles on the exact millisecond of the delivery.
- `src/safety/governor.ts` 1468:15 EqualityOperator. Only differs when a level is delivered on the exact millisecond the colour has settled.
- `src/safety/governor.ts` 1530:47 EqualityOperator. Only differs for a range that ended exactly at the start of the look-back.
- `src/safety/governor.ts` 1595:54 EqualityOperator. Only differs exactly 10 s after the last RESET.
- `src/safety/rate/legs.ts` 296:46 EqualityOperator. Only differs for a sample exactly at the 2% floor.
- `src/safety/rate/legs.ts` 310:30 EqualityOperator. Only differs when a span starts on the exact sample the last one was sure until.
- `src/safety/rate/legs.ts` 333:9 EqualityOperator. Only differs when a change equals the flat tolerance exactly.
- `src/safety/rate/legs.ts` 389:47 EqualityOperator, 394:7 EqualityOperator. Only differs when a ratio equals the hard or fold limit to the last bit.
- `src/safety/rate/legs.ts` 396:7 EqualityOperator, 536:33 EqualityOperator, 541:32 EqualityOperator, 542:62 EqualityOperator, 599:9 EqualityOperator, 669:35 EqualityOperator. Only differs when two events are exactly a tolerance apart (5 ms, 0.01 ms, the join or the merge tolerance), or exactly as near to two anchors.
- `src/safety/rate/legs.ts` 446:7 EqualityOperator, 500:9 EqualityOperator. Only differs when a run's ratio equals the leg limit to the last bit.
- `src/safety/rate/trace.ts` 66:9 EqualityOperator, 80:25 EqualityOperator. Only differs when a breakpoint or a grid time falls exactly on the end of the span.

#### Search and sampling density (12)

The mutant samples more or fewer points, or steps a search differently, and still finds the same result.

- `src/safety/governor.ts` 955:17 MethodExpression, 955:80 ArrowFunction, 955:90 ArithmeticOperator, 960:11 ConditionalExpression, 961:19 MethodExpression, 961:44 ArithmeticOperator, 961:45 ArithmeticOperator, 962:25 EqualityOperator, 962:53 ArithmeticOperator. The interior samples in `maxMeasure`. The peak is still found from the samples that are left.
- `src/safety/governor.ts` 984:27 EqualityOperator, 984:40 UpdateOperator. The fit settles in at most two attempts, so the bound on the third is never reached.
- `src/safety/rate/trace.ts` 79:31 ArithmeticOperator. Moves the shifted grid by twice the shift. The grid is still 25 ms and still out of step with the clock, and the fixed traces for the 8 ms and 17 ms readings are found either way.

#### A stray entry in a list (13)

Stryker puts a string into an empty list. The list is only searched for numbers, ids or events with a time, so the string is never matched.

- `src/safety/governor.ts` 1046:53 ArrayDeclaration, 1415:70 ArrayDeclaration, 1422:85 ArrayDeclaration (no coverage), 1647:39 ArrayDeclaration, 1793:61 ArrayDeclaration. The list is read for addresses or colour parts, and a string matches none.
- `src/safety/profile.ts` 104:27 ArrayDeclaration. The device types are only searched for 6 and 8.
- `src/safety/rate/guard.ts` 170:36 ArrayDeclaration, 170:46 ArrayDeclaration, 170:61 ArrayDeclaration. `EMPTY` is the baseline for a scope with no events, and its lists are only compared by time.
- `src/safety/rate/trace.ts` 302:23 ObjectLiteral, 302:31 ArrayDeclaration, 302:41 ArrayDeclaration, 302:56 ArrayDeclaration. The empty reading for a scope one reading does not have. Its lists are only compared by time.

#### A shift of a few milliseconds (2)

- `src/safety/governor.ts` 893:44 ConditionalExpression, 919:17 ArithmeticOperator. Moves a predicted delivery by a few milliseconds. No rule depends on so small a shift.

#### The RESET pair (25)

These are in the code that counts a RESET's jump to full and the OFF after it as one hard step (ADR 0015). It drops one hard step from each scope where the RESET jumped: the one nearest the planned OFF, between 150 ms and 2 s after the RESET. The tests have only the pair itself, where there is one hard step to choose from, so the choice between two is not pinned, and the lines that make it have no coverage. The code runs only when a RESET is judged, and a RESET goes alone. The jump and the planned OFF are both new hard steps 350 ms apart, and every candidate lies 150 ms to 2 s after the jump. Dropping any candidate other than the OFF leaves the jump and the OFF, which the window refuses, so a wrong choice can only refuse more. The mutants on line 1564 that narrow the test are on the cautious side for the same reason. Both reviewers checked this argument (S8b-R2-I1). RESET is blocked by default and limited to one in 10 s. A test with a second hard step in the window is a follow-up, listed in `docs/STATUS.md`.

- `src/safety/governor.ts` 1564:18 EqualityOperator, 1564:26 ArithmeticOperator, 1564:37 EqualityOperator, 1581:11 ConditionalExpression (no coverage), 1581:11 ConditionalExpression (no coverage), 1581:11 EqualityOperator (no coverage), 1581:40 MethodExpression (no coverage), 1581:49 ArithmeticOperator (no coverage), 1581:63 ArithmeticOperator (no coverage), 1583:15 ConditionalExpression, 1583:15 LogicalOperator, 1583:15 ConditionalExpression, 1583:15 EqualityOperator, 1583:15 EqualityOperator, 1583:23 ArithmeticOperator, 1583:53 ConditionalExpression, 1583:53 EqualityOperator, 1584:15 ConditionalExpression, 1584:15 LogicalOperator, 1584:15 ConditionalExpression, 1584:15 EqualityOperator, 1584:15 EqualityOperator, 1584:24 ConditionalExpression (no coverage), 1584:24 EqualityOperator (no coverage), 1584:24 EqualityOperator (no coverage).

## Stage 5 result

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

## Why the rest survive (Stage 5)

Each surviving mutant is listed by file, line and column, at the line numbers of the code after Stage 5, with the change Stryker made. They fall into these groups. Stage 8b moved the governor's lines and rewrote `src/safety/rate`: for the rate files, `profile.ts` lines 35 and 104 and the governor lines that stage ran, its lists above replace these.

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

Stage 8b went through them one by one: see "The 57 from Stage 5" above. What follows is the Stage 5 note as written.

They are not yet analysed one by one. Some will be equivalent, and some show where the property tests are thin, such as the sampling in `trace.ts` and the colour-mix fit in the governor. Tests aimed at them are a follow-up.

- `src/safety/governor.ts` 652:11 ConditionalExpression, 652:22 StringLiteral, 662:11 ConditionalExpression, 663:11 ConditionalExpression, 663:22 StringLiteral, 686:9 ConditionalExpression, 693:11 EqualityOperator, 706:15 ConditionalExpression, 710:14 ObjectLiteral, 710:20 BooleanLiteral, 717:19 ConditionalExpression, 734:44 ConditionalExpression, 757:17 ArithmeticOperator, 765:9 ConditionalExpression, 767:17 MethodExpression, 767:80 ArrowFunction, 767:90 ArithmeticOperator, 772:11 ConditionalExpression, 773:19 MethodExpression, 773:44 ArithmeticOperator, 773:45 ArithmeticOperator, 774:25 EqualityOperator, 774:53 ArithmeticOperator, 796:27 EqualityOperator, 806:13 EqualityOperator, 861:53 ArrayDeclaration, 862:14 ConditionalExpression, 885:9 ConditionalExpression, 985:9 ConditionalExpression, 1019:18 MethodExpression, 1019:47 ConditionalExpression, 1019:47 EqualityOperator, 1051:9 MethodExpression, 1125:9 ConditionalExpression, 1128:39 ArrayDeclaration, 1131:9 ConditionalExpression, 1238:20 EqualityOperator, 1260:32 ConditionalExpression, 1260:45 StringLiteral, 1273:15 ConditionalExpression, 1359:12 EqualityOperator.
- `src/safety/profile.ts` 35:11 ConditionalExpression, 104:27 ArrayDeclaration.
- `src/safety/rate/guard.ts` 116:46 ArrayDeclaration, 116:61 ArrayDeclaration.
- `src/safety/rate/legs.ts` 89:25 EqualityOperator.
- `src/safety/rate/trace.ts` 43:41 ArrowFunction, 43:51 ArithmeticOperator, 47:9 EqualityOperator, 50:21 ConditionalExpression, 52:51 ArithmeticOperator, 53:23 EqualityOperator, 73:7 ConditionalExpression, 96:11 ConditionalExpression, 99:51 ObjectLiteral, 100:42 ArrayDeclaration, 112:9 ArithmeticOperator.
