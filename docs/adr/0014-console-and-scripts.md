# ADR 0014: Console and scripts as built

Status: accepted

Date: 2026-11-17

## Context

Stage 6 builds R7 (the console) and R9 (scripts) from SPEC sections 6 and 7, ADR 0006 (the console), ADR 0007 (the script format) and `docs/research/console.md`. Stage 5 left a placeholder drawer and the engine's `request(intent, source)` path. The owner ran the stage on Opus and approved the plan, including the five decisions marked below.

## Decision

### Where things run

- The page holds the pure parts in `src/console/` and `src/script/`: the binding table, the line editor, history and its expansion, the lexer, values, DALI names, the line parser, completion, reply texts, help, the script parser and printer, and the built-in scripts. None of them touch the DOM or the clock.
- The bus worker runs lines and scripts. The page sends the line's text with its context (aliases and the `use` default), and the worker parses it again with the same parser. A script goes to the worker as its text, and the worker parses that too. The worker never trusts a parse the page did, and untrusted text crosses the boundary only as a length-limited string checked in `parseToWorker`.
- `src/engine/console.ts` holds `ConsoleExec`, which runs one parsed command against a `ConsoleHost` with a source. The engine runs a typed line as a job of kind `console` with source `console`, and a script as a job of kind `script` with source `script`. A script can never borrow the console's source. Panic, a target change, the watchdog and Ctrl-C stop both kinds, and a wait or a pause inside them wakes at once when stopped.
- Console and script jobs do not count as busy for the inventory or the background check in Both, because they stop for anything that needs the bus to itself: commissioning, a hardware check step, and a scan or profile write started outside the console (security review S6-L1).
- Page-only commands: `history`, `clear`, `help`, `use`, `scripts`, `trace` and the start of `run`, which reads the script from the store. `panic` calls the bus client's panic directly, so it skips the call queue.
- The worker keeps the last 500 console lines and sends the newest 200 with each snapshot, numbered as monitor lines are. The page keeps 2,000 lines of scrollback.

### The command language

- DALI commands answer to python-dali's class name in kebab case, built from the command table. Every device type command also answers to its name with a `dt6-` or `dt8-` prefix. `query-operating-mode` is shared by a general command and a DT6 one: the bare name is the general command. `query-extended-version-number` is shared by a DT6 and a DT8 command with no general one, so the bare name is refused and the console asks for the prefix (DALI review S6-D4).
- SPEC section 6 gave `set-temporary-colour-temperature-tc` as an example. python-dali names that class `SetTemporaryColourTemperature`, so the console's name is `set-temporary-colour-temperature`, and the spec's name is kept as an alias.
- `raw <hex> <hex>` sends a send-twice command twice, as the command needs, and says so. `x2` is accepted only on a send-twice command: on any other frame it is refused, because a repeated frame that is not a send-twice command would be two commands.
- `tc` and `rgb` on a group or broadcast check every known member's colour features first (SPEC D2). `fade` picks the nearest value the driver has and says which. `scene store` reads the present level, stores it and reads it back.
- A step the rate guard holds with a retry time waits for it, up to 10 s, and prints `waiting … for the rate guard` with the reason. Ctrl-C ends the wait. Any other refusal ends the line. (Owner decision: without the wait, `first-light` would stop at its first hard step in the room.)
- A transport fault prints `fault:`, a refusal `refused:`, and a step stopped by panic or Ctrl-C `stopped:`. The engine's failed results carry a `kind` so the console can tell them apart.

### Confirmations

`unlock <name>`, `cap` above the present ceiling and `history -c` print what will change and switch the prompt to `confirm>`. Only a typed line that matches (the unlock's name, the new value, or `yes`) goes on, and the page then sends the line with `confirmed: true`, as the Stage 5 dialogs do. Escape or Ctrl-C cancels. A confirmation lapses after 60 s, closing the drawer or running a script from the Scripts page drops it, and a typed `panic` at the prompt is panic (security review S6-M1, S6-L4). (Owner decision: inline in the console, not in a dialog, so it stays usable from the keyboard alone.)

A script cannot raise the ceiling. The runner refuses a `cap` above the present ceiling with `refused: a script cannot raise the ceiling.`, and the governor refuses it as well, because a script never sends `confirmed`.

### Scripts

- `scripts` joins SPEC section 7's list of commands a script may not use, beside `unlock`, `lock`, `target`, `run`, `history`, `clear`, `use` and `resume`.
- Each step is echoed as `line: text` before it runs. A `pause` is not echoed: its message and the prompt to press Enter are the line.
- A script runs from the store or the built-ins, never from the editor. The Scripts page's Run is off while the editor holds unsaved changes or the script does not parse.
- A screen wake lock is held while a script runs, taken again when the page is shown, and a refusal is reported once (SPEC S5.2).
- The page asks before it unloads while a line is half typed or a script runs.
- Import checks the file's size before reading it, and puts the text in the editor unsaved. Nothing runs. Export is a `data:` URL, as the workspace is.

### The Scripts page

Scripts get their own page, fifth in the rail after Settings, reached with Alt-5. (Owner decision: the design had no screen for editing them.)

### History

The leading-space rule is off by default, as in zsh, and verify mode is on. (Owner decisions.) History length is a preference from 100 to 10,000 lines, 1,000 by default. Two tabs merge the stored history with their own on each save.

### Persistence

All records share the one IndexedDB object store from Stage 5, each under its own key: preferences (version 2), history (version 1) and scripts (version 1). Each is validated on load and set aside if it fails, as ADR 0009 says. This replaces ADR 0009's "a store for each" and ADR 0013's version bump for each new store: keys in one store need no database upgrade, and each record keeps its own schema version and migrations.

Workspace version 2 adds `scripts` and the three history preferences. A version 1 file migrates. An import can turn verify mode on and never off.

## Consequences

- Every frame from the console or a script goes through `Engine.request` and the governor. `src/safety` did not change.
- P-ceiling now runs random console lines and scripts through the engine as well as intents.
- Ctrl-C with a selection copies, and Backspace or Delete with a selection is left to the browser, so the console's editor and the input's own selection never disagree.
- A refused step stops a script. A script that waits on the rate guard for more than 10 s stops with the guard's reason.
- The bundle grew by the console's pure core and the two pages.

## Alternatives considered

- Parse on the page and send the parsed command to the worker: the worker would have had to check a structured command it did not build, and the source rules would rest on the page.
- A script runner on the page: it would need its own clock and its own path to the governor, and would stop when the tab is hidden.
- Fail a step at once when the rate guard holds it: simpler, but the built-in script could not run on a bench with colour.
- Confirm in the Stage 5 dialog: it works, but takes focus out of the console for every unlock.
