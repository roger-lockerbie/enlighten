# ADR 0007: Script format

Status: accepted

Date: 2026-11-14

## Context

R9 asks for scripts that run `first_light.py`-style sequences without a general-purpose language. Scripts can be imported, so they are untrusted input.

## Decision

- A script is plain text, UTF-8, one statement a line. A statement is a console command, or one of `wait`, `pause`, `echo`, `repeat N` with a matching `end`, or a `#` comment. The grammar is in `docs/SPEC.md` section 7.
- No variables, expressions, conditions, functions or includes. `repeat` takes a literal count.
- Limits, checked before anything runs: 64 kB, 2,000 lines, 500 characters a line, `repeat` nested at most twice, and at most 10,000 steps once repeats are expanded.
- The parser returns a list of typed steps or a list of errors with line numbers. The whole script is parsed and checked before the first step runs.
- The runner feeds steps to the engine one at a time. Every frame goes through the governor. Panic and Ctrl-C stop it at once.
- A script cannot use a command that needs an unlock, even while a person has that unlock on. It cannot raise the ceiling, unlock anything, change the output target, run another script, or touch history.
- `first-light` ships as a built-in script. Unlike `tools/first_light.py` it respects the ceiling.

## Consequences

- A script is data. No path from script text to `eval`, `Function` or a timer string exists, and lint and Trusted Types back that up.
- Long plans (R5) are sequences, a separate structured type with a planner. Scripts are for bench walk-throughs.

## Alternatives considered

- JSON: safe, but unpleasant to write by hand and unlike the console.
- A small expression language: more parser, more ways to be wrong, and nothing the brief asks for.
