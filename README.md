# Enlighten

Enlighten is a browser app for designing and testing DALI lighting on a two-tape test bench. It will run a simulator and a rendered hallway, drive the real tapes through a hasseb USB DALI Master, or do both at once.

This is the Stage 0 baseline: the tooling, the security headers and the guards, with a placeholder page and no features yet. See `docs/BRIEF.md` for the goal and `docs/STAGES.md` for the build plan. `docs/STATUS.md` says where the build is up to.

## Run it

You need Node 26.13.1 (see `.nvmrc`) and pnpm 12.18.0 through corepack. Node 26 doesn't ship corepack, so install it first with `npm install --global corepack`, then `corepack enable`.

```bash
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` builds the site and serves it at http://127.0.0.1:47821 with the full security headers. The app is a static site with no backend. Hardware access will use WebHID, which needs Chrome, Edge or another Chromium browser on a desktop.

## Commands

See the Commands section of `CLAUDE.md`. `pnpm verify` runs lint, typecheck, unit and property tests, a build and the e2e tests.

## Security

The app is built to run under a strict Content Security Policy with Trusted Types. To report a problem, read `SECURITY.md`.
