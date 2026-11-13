# Security policy

Enlighten is a static browser app that will talk to DALI lighting hardware, so security and physical safety both matter here.

## Reporting a problem

Please don't open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on this repository (Security tab, then Report a vulnerability). If that isn't available, contact the repository owner directly.

Include what you found, how to reproduce it, and what you think the impact is. Expect an acknowledgement within a few days.

## What counts

- Anything that gets script running outside the Content Security Policy, or that weakens the policy.
- Any path that sends a command to a simulated or real driver without going through the safety governor in `src/safety`.
- Any way to exceed the brightness ceiling, or to defeat panic.
- Unsafe handling of imported files, scripts or pasted text.
- Supply chain problems: dependencies, install scripts, CI workflows.

## Where the design is written down

The threat model will live in `docs/THREAT_MODEL.md` once Stage 2 writes it. Accepted risks and findings are logged in `docs/SECURITY_FINDINGS.md`.
