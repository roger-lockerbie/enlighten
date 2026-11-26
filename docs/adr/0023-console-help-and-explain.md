# ADR 0023: help for every DALI command, and `explain`, which never sends

Status: accepted

Date: 2026-11-26

## Context

The console has two kinds of command. Twenty-nine are the app's own (`level`, `tc`, `cap`, `scan` and the rest). The other 137 are the DALI commands the app supports, typed by python-dali's class name in kebab case. `help` covered the first kind only. For a DALI command it said "is a DALI command", and nothing else.

A person could see the frames a line sent only by sending it: with `trace on`, or on the Bus monitor page. Nothing showed what a line would send before it went.

The owner asked for both on 2026-11-26, after Stage 11 and v0.1.0, as work between stages. Stage 12 stays hardware day.

Two things shaped the design. The IEC 62386 text is paywalled, was not read for this project, and cannot be quoted in a public repo. And asking the governor to judge a transaction is not free of effect: `judge` records an approval for what it allows.

## Decision

### Help

`help <name>` answers for every DALI command, by any name the console accepts. `help dali` lists all of them by group. `help -k <word>` looks a word up in every topic and every command. `help hardware` states the holding rules of ADR 0019 and ADR 0022. `help off` shows both the console's command and the DALI command it sends, since they share the name.

Only one thing about a DALI command is written by hand: the sentence or three saying what it does, in `src/console/dali-help.ts`. It is our own wording, from the public sources in `docs/research/dali.md`. Twenty-four entries describe commands the research names without describing. They are marked, and help says that the line rests on general knowledge of the standard.

Everything else in an entry is built from data the app already runs on:

- The syntax, the frame, the reply, the registers read and set, and send-twice come from the command table (`src/dali/commands.ts`), which the golden fixtures check against python-dali.
- The governor's line comes from the rule table (`src/safety/rules.ts`), through one sentence for each rule. The map is typed over the rule names, so a new rule does not compile without its sentence.
- The example line is made by the same function `explain` uses, and a test parses every example back to its command.

Help therefore cannot describe a frame, a register or a rule that the app does not have.

### Explain

`explain <line>` prints what the line would send and sends nothing. For each DALI command it prints the console line that sends that one command, its frames in hex (with ENABLE DEVICE TYPE where one is added, and `x2` for a send-twice command), and its name in the standard.

It covers the commands that are sent as DALI frames as written: `level`, `off`, `on`, `tc`, `rgb`, `fade`, `scene`, `group`, `query`, `raw` and any DALI command by name. The others (`scan`, `profile apply`, `cap`, `panic`, `target`) act on the app or send a sequence the engine builds as it goes, and `explain` says so. A script may not use it.

It runs the console's own executor, so it cannot drift from the real path, with two changes:

- The executor is given a host that cannot act. Every method that would send a frame or change the app's state refuses: request, reset, the ceiling, the target, scan, profile, unlock, lock, resume, panic. Reads pass through.
- Where a real run would submit an intent, it asks the engine to compile the intent to commands and prints them. `Engine.compile` reads the active connection's facts and the shadow's present level, as a real Apply does, and sends nothing, asks the governor nothing and changes nothing.

`explain` reads the target and what the app knows of the driver. The same line can explain differently on the simulator and on hardware: a fade setting is followed by its read-back queries on hardware, and a colour with a level goes as two transactions there.

It does not ask the governor. It says so in its last line, and it reports the one thing that can be told without asking: a DAPC above the ceiling would be clamped to it. A hold by the rate guard, a refusal by a holding rule, or a level lowered for a colour is known only when the line is sent.

Where a later frame depends on a reply, `explain` says what it cannot know. `scene <addr> store <n>` with no value reads the level first, so the DTR0 that follows is shown as 0 with a note.

## Consequences

- Nothing in `src/safety`, `src/dali`, `src/sim` or `src/bus` changed. The governor is as Stage 11 left it.
- The console imports the rule table from `src/safety` to describe it. That is a read of data, and the dependency runs from the console to the governor, not the other way.
- `Engine.compile` mirrors how `request` splits a colour and a level on hardware. A test on each target runs `explain` and then the real line, and compares the two lists of commands, so a change to one without the other fails.
- A verdict from the governor without side effects would make `explain` say more. It needs a change to `src/safety` and its own review, and is left for later.
- The descriptions are not the standard. Someone who needs the exact wording still needs IEC 62386.

## Tests

- U-console: an entry for every command and no other; every example parses to its command; the governor's line agrees with the rule table for every command; `help dali` names all 137; the word search.
- P-unparse: for any valid command, the line `explain` prints for it parses back to the same command.
- U-engine: `explain` then the real line, for 29 lines on the simulator, give the same commands; the hardware split and read-backs; the clamp note, checked against what the governor then sends; RESET explained with nothing reset; the host that cannot act.
- P-explain: for any line, `explain` sends no frame, adds no monitor line and leaves levels, ceiling, target, unlocks and the latch as they were.
- E-console: help for a DALI command, completion after `help`, and `explain` leaving the Bus monitor's count unchanged.
