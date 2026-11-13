# ADR 0009: Persistence, workspace files and validation

Status: accepted

Date: 2026-11-14

## Context

R8 asks for one user with local preferences. Stage 5 asks for IndexedDB with a schema version and migrations, and workspace export and import. Imported and stored data is untrusted (`docs/research/security.md` section 6).

## Decision

- One IndexedDB database, `enlighten`, with a store for each of: preferences, console history, scripts, the library (scenes, sequences, effects), the visualiser set-up, switch plates, and the radiosity cache.
- Every record carries a schema version. Migrations are an ordered list of pure functions from version n to n + 1 over plain data, each tested against a saved fixture of the older version.
- Every load validates, from IndexedDB as well as from a file. A record that fails is set aside, not deleted, the user is told, and defaults are used.
- A workspace file is JSON with `"format": "enlighten-workspace"` and a `version`. The schema is in `docs/SPEC.md` section 8.
- The validator is hand-written, with no runtime dependency. It checks size before parsing (2 MB), then depth (8), array lengths, string lengths, number ranges and enumerations. It rejects the keys `__proto__`, `constructor` and `prototype`, and unknown keys. It builds its result as fresh objects and never merges parsed data into live ones.
- Import never connects, unlocks, raises the ceiling or runs anything. Imported preferences cannot make the app less careful, and imported simulator settings never reach the hardware's governor. An imported ceiling applies only if it is lower than the present one.
- Nothing secret is stored. The server token is never written anywhere.
- Unlocks, the panic latch and the connection are session state and are not stored.
- A reload starts with the ceiling from preferences, no unlocks, and nothing running.

## Consequences

- The validator is ours to maintain, with property tests that feed it random and hostile JSON.
- Another local program on the same port would share the origin and could read or alter stored data. Validation on load is the answer to that, and the threat model records it.

## Alternatives considered

- zod or valibot: a runtime dependency for a small schema.
- localStorage: synchronous, small, and strings only.
