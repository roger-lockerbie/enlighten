# Enlighten

Enlighten is a browser app for designing and testing DALI lighting on a two-tape test bench. It will run a simulator and a rendered hallway, drive the real tapes through a hasseb USB DALI Master, or do both at once.

The build is in stages. Stage 4 has the DALI core, the simulator, the safety governor, the bus worker, and a small hardware server with a fake hasseb, behind an interim page. See `docs/BRIEF.md` for the goal and `docs/STAGES.md` for the build plan. `docs/STATUS.md` says where the build is up to.

## Run it

You need Node 26.13.1 (see `.nvmrc`) and pnpm 12.18.0 through corepack. Node 26 doesn't ship corepack, so install it first with `npm install --global corepack`, then `corepack enable`.

```bash
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` builds the site and serves it at http://127.0.0.1:47821 with the full security headers. That is the simulator alone, with no backend.

## Hardware

Hardware goes through a small Python server on the same address. It serves the built app and relays frames to the hasseb, and turns the lights off whenever the page goes away. Set it up once as `server/README.md` says, then:

```bash
pnpm build
```

```bash
pnpm server
```

Open the address it prints. `pnpm server:demo` runs the same path with a fake hasseb and a fake bench, so it works with no hardware. Remote use is an SSH port forward, also in `server/README.md`. Keep a way to stop the server within reach of the bench.

## Commands

See the Commands section of `CLAUDE.md`. `pnpm verify` runs lint, typecheck, unit and property tests, a build and the e2e tests.

## Security

The app is built to run under a strict Content Security Policy with Trusted Types. To report a problem, read `SECURITY.md`.
