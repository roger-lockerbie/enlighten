# ADR 0006: Console design

Status: accepted

Date: 2026-11-14

## Context

R7 asks for a console that edits like zsh. `docs/research/console.md` sets out the behaviour to copy and the keys browsers take.

## Decision

- A purpose-built component, not a terminal emulator. The line is a real `<input>` so screen readers, IME and paste work. Output is a log region of text nodes.
- The line editor is a pure TypeScript core: a state value (buffer, cursor, kill ring, undo stack, search state) and a function from a key to a new state. The component translates DOM key events into keys and applies the result. The core tests in Node with key-sequence tests.
- One binding table drives the handler, the on-screen legend and `help keys`.
- Ctrl bindings match on `key`. Alt bindings match on `altKey` and `code`. Nothing binds Cmd or Ctrl-Alt.
- Every key a browser may take has a second binding: Alt-Backspace and Ctrl-Backspace for `backward-kill-word`, Down for Ctrl-N, Up for Ctrl-P.
- The listener is on the console, not the window. Panic is the only global shortcut.
- Departures from zsh, all from the research: undo groups typed runs, Escape cancels a search, verify mode is on by default, `history -c` exists and asks first, Tab completes only when there is something to complete and Escape releases focus.
- History expansion follows the research: `!!`, `!n`, `!-n`, `!prefix`, `!?text?`, `^old^new`. An expanded line is shown for editing before it runs.
- History is stored in IndexedDB, 1000 lines by default, duplicates dropped, and a line that starts with a space is kept out when that preference is on. Two tabs append and merge on load, and do not import from each other mid-session.
- The command language is in `docs/SPEC.md` section 6. Commands are parsed to a typed value and handed to the engine. Nothing typed is ever evaluated as code.

## Consequences

- No terminal dependency and no canvas text.
- Ctrl-W, Ctrl-N and Ctrl-T cannot be bound in a normal Chrome tab on Windows and Linux. The legend says so, and the README offers an app window.

## Alternatives considered

- xterm.js: a runtime dependency, renders to canvas, and still would not give zsh's line editing.
- A `contenteditable` line: harder to make safe and accessible than an input.
