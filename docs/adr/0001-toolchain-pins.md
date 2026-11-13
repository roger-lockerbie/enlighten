# ADR 0001: Toolchain pins for Stage 0

Status: accepted

Date: 2026-11-13

## Context

Stage 0 asks for the latest stable version of every tool, pinned exactly, with a minimum release age on new versions.

## Decision

- Node 26.13.1, the current LTS. Node 26 doesn't bundle corepack, so developers and CI install it with `npm install --global corepack`.
- pnpm 12.18.0 through corepack.
- TypeScript 6.0.3, not 7.0.2. typescript-eslint 8.72 and svelte-check 4.7 both declare support only up to TypeScript 6.0.x, and typed linting is a requirement. Revisit when both support 7.
- Svelte 5 creates one Trusted Types policy, `svelte-trusted-html`, to wrap its compiled static templates. The CSP allows that one name with `trusted-types svelte-trusted-html`. The policy is a pass-through that only sees compiler output. `{@html}` is banned by lint, so no runtime string reaches it.
- Ports: dev server 47820, preview 47821, both bound to 127.0.0.1 with `strictPort`. A fixed port gives the app its own origin, so no other local app shares its permissions.

## Consequences

Bumping TypeScript to 7 waits on tooling. The CSP names one Trusted Types policy, which a test pins.

## Alternatives considered

- TypeScript 7 with typed lint off: gives up the typed rules that catch real errors.
- `trusted-types 'none'`: breaks Svelte's template creation.
