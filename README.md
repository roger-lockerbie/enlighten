# Enlighten

Enlighten is a browser app for designing and testing DALI lighting on a two-tape test bench. It has a simulator of the bench's driver (a Skydance DA5-L), a rendered hallway that estimates how the light might look, and a path to the real tapes through a hasseb USB DALI Master. It can drive the simulator, the hardware, or both at once.

Every command to a simulated or real driver goes through one safety governor. It limits how fast and how far the light can swing, because flashing light can trigger seizures, it holds a brightness ceiling, and it backs a Panic button that turns everything off.

## What works and what has not been tried

This is version 0.3.0. The simulator, the playground, the console and scripts, looks, sequences, effects, switch plates and the visualiser all run with no hardware.

**The hardware path has never driven a real driver.** It is built and tested against a fake hasseb, and no hasseb has been on the bench yet. Until it has, the governor trusts nothing about real gear: on the Hardware and Both targets it refuses colour fades, level fades on colour gear, and any change to a group or to all but OFF, and it allows about one change every 2 seconds to an address (ADR 0019 and ADR 0022 in `docs/adr/`). `docs/TEST_PLAN.md` section 10 is the plan for the first day with hardware.

Other known gaps:

- The visualiser is an estimate. Its tape and cover data are placeholders where none is published, and it says so on the page.
- S9-P1: the rate guard and its independent checker disagree on one contrived set of commands on the simulator, with the light near 3%. It is logged in `docs/SECURITY_FINDINGS.md` with a saved test.
- S9-T1: a long sequence depends on the browser keeping the page awake. A hidden or frozen tab can stall it, and on hardware the server would then turn the lights off.
- Tested in Chromium only. Use Chrome or Brave.

`docs/STATUS.md` has the full state of the build, and `docs/SECURITY_FINDINGS.md` every review finding and what was done about it.

## Build from source

You need Node 26.13.1 (see `.nvmrc`) and pnpm 12.18.0 through corepack. Node 26 does not ship corepack, so install it first:

```bash
npm install --global corepack
```

```bash
corepack enable
```

Then install and start. The install uses the frozen lockfile, runs no package's install script, and refuses any version published in the last seven days.

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm start
```

`pnpm start` builds the site and serves it at http://127.0.0.1:47821 with the full security headers. That is the simulator alone, with no backend. The app makes no request to any other origin.

`pnpm verify` runs lint, the typecheck, the unit and property tests with coverage, a build and the end-to-end tests. The end-to-end tests need Chromium once: `pnpm exec playwright install chromium`. The other commands are in the table in `CLAUDE.md`.

## Hardware

Hardware goes through a small Python server on the same address. It serves the built app and relays frames to the hasseb, and it turns the lights off whenever the page goes away, falls silent for 3 seconds, or the server stops. It listens on 127.0.0.1 only. Set it up once as `server/README.md` says, then:

```bash
pnpm build
```

```bash
pnpm server
```

Open the address it prints. `pnpm server:demo` runs the same path with a fake hasseb and a fake bench, so it works with no hardware. Remote use is an SSH port forward, also in `server/README.md`.

Two things to do every time:

- Keep a way to stop the server within reach of the bench. Ctrl-C turns the lights off.
- Use a browser profile kept for this app. Anything else that ever ran on 127.0.0.1:47821 in the same profile shares the app's stored data (`docs/THREAT_MODEL.md` section 3.4).

## Verify a release

A release has four files: `enlighten-v<version>.tar.gz` (the built app, the server and the licence texts), two CycloneDX SBOMs, and `SHA256SUMS`. CI builds them from the tagged commit, and the archive and the two SBOMs each have a build provenance attestation signed through GitHub.

Check the sums, in the folder you downloaded into:

```bash
shasum -a 256 -c SHA256SUMS
```

Check that the archive was built by this repository's release workflow, with the GitHub CLI:

```bash
gh attestation verify enlighten-v0.3.0.tar.gz -R roger-lockerbie/enlighten --signer-workflow roger-lockerbie/enlighten/.github/workflows/release.yml --source-ref refs/tags/v0.3.0
```

The sums alone show the files match each other. The attestation is what ties them to this repository and to a commit, which is in the archive as `COMMIT`.

To run a release, unpack it and set up the server's Python environment as `server/README.md` says. The archive has no `package.json`, so skip that file's `pnpm` commands and start the server from the unpacked folder with `server/.venv/bin/python -m server`. The archive carries this README but not the `docs/` folder it points to: that is in the repository. To check a release against the source, check out the commit named in `COMMIT`, build as above, and run `tools/release/pack.sh` after `pnpm sbom:all`. With GNU tar the archive is made the same way each time. Whether your build matches CI's byte for byte also depends on the build tools giving the same output on your machine, which has not been proved.

## Security

The app is a static site under a strict Content Security Policy with Trusted Types, and it treats every imported file as untrusted data. `docs/THREAT_MODEL.md` says what it protects and what it accepts. To report a problem, read `SECURITY.md`.

## Licence

Enlighten is under the Apache License 2.0: see `LICENSE` and `NOTICE`. What a build carries from other projects, and under which licences, is in `THIRD_PARTY_NOTICES.md`.

## Manual

`docs/manual/` is the user manual: a guide to read in order, a concise reference, and tables of keys and commands. Start at `docs/manual/README.md`. Inside the app, press F1.

## Documents

- `docs/BRIEF.md`: the goal and the requirements.
- `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/UI.md`: what was built.
- `docs/THREAT_MODEL.md`, `docs/SECURITY_FINDINGS.md`: the security and safety case.
- `docs/TEST_PLAN.md`: the tests, and the hardware-day checklist.
- `docs/adr/`: each significant decision.
- `docs/DEPENDENCIES.md` and `THIRD_PARTY_NOTICES.md`: every dependency and its licence.
