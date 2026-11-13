# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog.

## Unreleased

### Added

- Stage 0 baseline: TypeScript (strict), Vite, Svelte 5, Vitest, fast-check and Playwright.
- ESLint rules that ban `eval`, `new Function`, string timers, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `{@html}`, with a test that proves each one is caught.
- Security headers for build and preview: CSP with Trusted Types, COOP, COEP, CORP, Permissions-Policy, Referrer-Policy, nosniff and frame-ancestors, with a meta-tag fallback in the built page.
- An e2e test that fails on any CSP violation or console error.
- Hardened pnpm settings, GitHub Actions CI with pinned actions, CodeQL and Dependabot.
- `tools/golden/` with a hash-locked requirements file for python-dali 0.16 and hidapi.
- Stage 1 research in `docs/research/`: DALI gear behaviour and timing, the hasseb and WebHID, the DA5-L, optics, rendering, effects, switchgear, the console and security, with a summary of findings that change the brief.
- Stage 2 design: the specification, architecture, threat model, test plan with the hardware-day checklist, UI document with wireframes, ADRs 0002 to 0010 and open questions.

### Changed

- The plan for Stages 3, 4, 5 and 12 follows the design: the governor as ADR 0004 sets it out, a Python hardware server before any WebHID transport, and the build settings the spike proved.
