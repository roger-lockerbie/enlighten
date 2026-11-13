# Security guidance

Research for Stage 1, read on 13 and 14 November 2026. It takes each security rule in `CLAUDE.md` and records current guidance as it applies to a static app that drives lights over WebHID. A script injected into this app could flash lights at full output in someone's home, so XSS here is a physical-safety problem.

"Confirmed" means the cited page said it when fetched. "Local check" means read in the packages installed in this repo. "Not confirmed" items are collected at the end of each section. The research ran short of budget three times, so coverage is uneven, and the gaps are listed plainly.

## What changes for the project

1. **Trusted Types now works in every engine.** It is no longer a Chromium-only backstop, so it protects the simulator in Firefox and Safari too.
2. **Workers need a Trusted Types policy of our own.** `new Worker(url)` is a script URL sink. Stage 2's spike has to prove the worker loads under enforcement, and will probably add one small policy beside Svelte's.
3. **Svelte writes `style.cssText`,** which a strict `style-src` blocks. Components must avoid `style="..."` and `style={...}`, and the spike has to test `style:` directives.
4. **GitHub now has workflow lockfiles** that pin transitive actions, which SHA pins in our own workflows do not cover. GitHub says a lockfile replaces SHA pinning. That conflicts with the wording of the `CLAUDE.md` rule, so it is a question for the owner. The recommendation is to keep the SHA pins and add the lockfile.
5. **GitHub Pages is not a suitable host** for the hardware-capable build, if hosting ever comes up. It cannot send the headers the design relies on (not confirmed from a GitHub page, see section 3).

## 1. Content Security Policy

### Confirmed

- In a `<meta>` policy, "Neither are the `report-uri`, `frame-ancestors`, and `sandbox` directives" supported (https://www.w3.org/TR/CSP3/#meta-element). The built page's meta fallback cannot stop framing. Only the header can.
- A nonce must be unique per response, so a static file cannot use one (https://www.w3.org/TR/CSP3/#security-nonces). web.dev's advice for static pages is hashes (https://web.dev/articles/strict-csp). This app has no inline scripts at all, so `script-src 'self'` with no hashes and no `'strict-dynamic'` is tighter still. That conclusion is ours: an allowlist of only `'self'`, on an origin that serves only our files, has none of the CDN or JSONP bypasses the article warns about.
- `worker-src` falls back to `child-src`, then `script-src`, then `default-src` (https://www.w3.org/TR/CSP3/#directive-fallback-list).
- `'wasm-unsafe-eval'` allows WebAssembly to compile without allowing `eval` (https://www.w3.org/TR/CSP3/#can-compile-wasm-bytes). Not needed today. It is the only relaxation to accept if WebAssembly is ever added.
- Under `style-src 'self'`, MDN lists what is blocked: inline `<style>`, `style` attributes, `setAttribute("style", ...)` and `el.style.cssText = ...`. Properties set one at a time on `el.style` are allowed (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src). three.js setting `canvas.style.width` is fine. Anything that writes a style string is not.
- Vite 8: the module preload polyfill "is auto injected into the proxy module of each `index.html` entry", so it is bundled script and not inline. Assets under `build.assetsInlineLimit` (4096 bytes) become `data:` URIs, so set the limit to 0 to keep `data:` out of `img-src` and `font-src`. `html.cspNonce` needs a per-request value and does not suit a static site (https://vite.dev/config/build-options and https://vite.dev/guide/features).
- Vite 8 workers: `new Worker(new URL('./w.ts', import.meta.url), { type: 'module' })` emits a separate same-origin file. The `?worker&inline` form embeds the worker and needs `blob:` or `data:` in `worker-src`, so do not use it (https://vite.dev/guide/features).

### Svelte and inline styles (local check, svelte 5.57.3)

`node_modules/svelte/src/internal/client/dom/elements/style.js` writes a dynamic `style={...}` attribute, and the first render of an element with `style:` directives, through `dom.style.cssText`. Later `style:` updates use `style.setProperty()`. Static `style="..."` in a component reaches the page as a style attribute in template markup. MDN says both are blocked.

Consequences:

- No `style="..."` or `style={...}` in components. Lint can enforce it with `svelte/no-inline-styles` (https://sveltejs.github.io/eslint-plugin-svelte/rules/no-inline-styles).
- Whether `style:` directives trip the policy in Chromium is not confirmed. The Stage 2 spike should test one. The safe alternatives are classes and CSS custom properties set with `node.style.setProperty()` from an action.
- Svelte 5 transitions use the Web Animations API (`element.animate()`, local check of `transitions.js`, and https://github.com/sveltejs/svelte/issues/6662), so they inject no style elements.

### Recommended production policy

Stage 0 already ships close to this in `config/security.ts`. The differences to consider are `manifest-src`, the worker policy name, and `style-src-attr`.

```
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src 'self';
worker-src 'self';
manifest-src 'self';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
object-src 'none';
require-trusted-types-for 'script';
trusted-types svelte-trusted-html enlighten-worker
```

- Add `blob:` to `img-src` only if three.js textures prove to need it. Add `data:` nowhere.
- `connect-src 'self'` could become `'none'` if the app never fetches its own files at run time. The spike can tell.
- Leave out `upgrade-insecure-requests`. The app is served over http on 127.0.0.1 and makes no cross-origin requests.
- The dev server needs its relaxations: Vite injects styles, and its client builds a `SharedWorker` from a blob URL (local check of vite 8.3.6 `dist/client/client.mjs`, and https://github.com/vitejs/vite/issues/22457). Production output does not contain the client.

### Not confirmed

- The CSP specification's own sentence on CSSOM. MDN is the source.
- Whether three.js needs `blob:` for images.

## 2. Trusted Types

### Confirmed

- Support: Chromium since 83, Safari 26, and Firefox 148 on 24 February 2026. MDN marks it Baseline, newly available, from February 2026 (https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API and https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/148).
- `trusted-types 'none'` "Disallows creating any Trusted Type policy" (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/trusted-types). The `'allow-duplicates'` keyword and `*` exist and should not be used.
- Sinks on MDN's list:
  - HTML: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser.parseFromString`, `Range.createContextualFragment`, `iframe.srcdoc`, `setHTMLUnsafe`, `Document.parseHTMLUnsafe`.
  - Script: `eval`, `Function`, string timers, and script element text.
  - Script URL: `script.src`, the `Worker` and `SharedWorker` constructors, `importScripts`, and service worker registration.
  - Dynamic `import()` is not on the list. `script-src` governs it.
- A policy named `default` catches every string that reaches a sink. The specification warns that "a lax, no-op default policy defeats all the benefits of using Trusted Types" (https://w3c.github.io/trusted-types/dist/spec/#security-considerations). Do not create one.
- The same section says Trusted Types guard against mistakes, not against hostile first-party code, and that a restricted document can be bypassed by an unrestricted document on the same origin. That is one more reason the app keeps its origin (its port) to itself.

### Svelte 5

- Before 5.51.0, Svelte set `innerHTML` on a `<template>` for each component's static markup, which throws under enforcement. Since 5.51.0 those assignments go through a policy named `svelte-trusted-html` (https://github.com/sveltejs/svelte/pull/16271). The CSP then needs `trusted-types svelte-trusted-html`, which is what Stage 0 ships.
- `{@html}` does not use that policy. Local check of `blocks/html.js`: it assigns the raw value to `innerHTML`, so under enforcement it throws unless given a `TrustedHTML` object. `{@html}` fails closed, which is what we want. Lint bans it as well.
- The compiler option `fragments: 'tree'` (since 5.33) builds markup node by node and uses no `innerHTML`. The docs call it "slower, but works everywhere" (https://svelte.dev/docs/svelte/svelte-compiler).
- Local check of `dom/reconciler.js` in 5.57.3: the policy is created at module load, with no try and catch around it. Under `trusted-types 'none'` that call would throw unless the bundler removes it as unused. Not confirmed either way.
- Svelte's policy is the identity function: it passes any string through. What protects it is that the policy object is private to Svelte's module and that, without `'allow-duplicates'`, nobody else can create a second policy with that name. An attacker who can already run script gains nothing from it, and one who cannot has no way to reach it.

Recommendation: stay with `trusted-types svelte-trusted-html` as Stage 0 has it, and let the Stage 2 spike try `fragments: 'tree'` with `trusted-types 'none'` plus the worker policy. If the stricter form works and the speed cost is small, it removes the identity policy altogether. Record the result in the stack ADR.

### Workers

MDN on the `Worker` constructor: the URL is "A `TrustedScriptURL` object or a string", and a TypeError is "Thrown if the `url` parameter is a string when Trusted Types are enforced by a CSP and no default policy is defined" (https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker). The page does not say how a `URL` object is treated.

Vite's worker pattern passes a `URL` object. It probably throws under enforcement (not confirmed). The plan:

1. One small policy, named for example `enlighten-worker`, whose `createScriptURL` returns its input only when it equals a same-origin URL fixed at build time, and throws otherwise.
2. Vite's docs say worker detection needs `new URL()` "directly inside the `new Worker()` declaration". Wrapping it in a policy call may break detection. The fallback is `import workerUrl from './w.ts?worker&url'`.
3. `createPolicy` may be called in exactly one file, and lint should say so.

This is the main thing the Stage 2 spike has to prove, since the visualiser, the sequence clock (S5) and probably the bus scheduler all want workers.

### three.js

A search of three.js issues and pull requests for "trusted types" found nothing. A scan of the r187 core build files for `rendering.md` found no HTML or script sinks, no workers and no `cssText`, so the core should need no policy. That is a reading of the source and not yet a browser test. Addon loaders such as KTX2Loader and DRACOLoader build workers from blob URLs, so the app must not use them. When three.js is added, search its build for `innerHTML`, `new Worker`, `importScripts` and `createObjectURL`. `rendering.md` covers the rest.

### Not confirmed

- Whether a `<meta>` policy enforces the Trusted Types directives. They are ordinary directives and the specification excludes only three others, so it should. The e2e test can check the built page without headers.
- Whether `setAttribute('srcdoc', ...)` is caught in all three engines.

## 3. Other headers

### Confirmed

- COOP `same-origin` with COEP `require-corp` makes the page cross-origin isolated. That enables `SharedArrayBuffer` and a finer `performance.now()`: 5 microseconds in place of 100 (https://web.dev/articles/coop-coep). With no third-party resources, `require-corp` costs nothing. The finer timer is useful for bus timing, and it is lost on any host that cannot send headers.
- `X-Frame-Options: DENY` is still valid, has no effect in a `<meta>`, and is worth sending beside `frame-ancestors 'none'` (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options).
- The `hid` Permissions-Policy feature defaults to `self`. A cross-origin iframe gets no WebHID unless the page delegates it (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/hid).

### GitHub Pages

Not confirmed from a GitHub document: Pages cannot set custom response headers. If so, a Pages-hosted copy would lose `frame-ancestors`, `X-Frame-Options`, COOP, COEP, CORP, Permissions-Policy and `nosniff`. The meta policy keeps the script, style, connect and Trusted Types rules. Without `frame-ancestors` the app could be framed by another site, and its Connect and Panic controls clickjacked. Project pages also share one origin per account (`account.github.io/repo`), so WebHID grants and storage would be shared with that account's other pages.

Recommendation: the supported way to run the app stays "build it and serve it locally". If a hosted demo is ever wanted, make it simulator-only, or use a host that sends headers on its own domain.

### Not confirmed

The full Permissions-Policy deny list, Referrer-Policy, `nosniff` and Origin-Agent-Cluster were not re-read. Stage 0 ships a header set with tests. Stage 2's threat model should check it against MDN once.

## 4. Serving on localhost

### Confirmed

- Both `http://127.0.0.1:47821` and `http://localhost:47821` are secure contexts (https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy). They are different origins, with separate WebHID grants and storage. The project uses 127.0.0.1. The README should say to use that address and not `localhost`.
- Vite's advisory CVE-2025-24010 (January 2025): the dev server had permissive CORS, no Origin check on its WebSocket and no Host check, which allowed DNS rebinding. Fixed in 6.0.9, 5.4.12 and 4.5.6 (https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6). Vite 8.3.6 is past these.
- Vite 8 defaults: `server.allowedHosts` allows localhost, `.localhost` names and IP addresses. `server.cors` allows only localhost, 127.0.0.1 and ::1 origins. `true` for either opens the server to any website (https://vite.dev/config/server-options). Never set `server.allowedHosts: true`, `server.cors: true` or `server.host: true`.
- The same page notes that servers on a specific address take priority over those on a wildcard. Binding 127.0.0.1 explicitly, as Stage 0 does, stops another process from sitting in front of the app on a wildcard bind.
- Chrome's Local Network Access: from Chrome 142, a public website needs a permission prompt before it can fetch a loopback address. It replaces Private Network Access, which was put on hold. The first stage does not cover WebSockets (https://developer.chrome.com/blog/local-network-access). A page on loopback fetching itself is same-origin and unaffected. The benefit to us is that a public site can no longer probe `http://127.0.0.1:47821/` without a prompt, in Chrome.

### The same-port risk

An origin is scheme, host and port. Nothing ties it to a program. A different local program that later serves on the same port is the same origin to the browser, and would inherit the stored WebHID grant and the app's IndexedDB data. This follows from the origin model and was not read as a quoted sentence.

Mitigations, all already in the brief or `CLAUDE.md`: a fixed, strict port that other tools are unlikely to use, `forget()` on disconnect so no grant is left standing, nothing secret in storage, and stored data treated as untrusted on load. One more for the README: disconnect in the app before stopping the server.

### Not confirmed

- The state of Local Network Access after Chrome 142, including whether WebSockets are covered. This matters for the contingency bridge in `hasseb.md`.
- A quoted source for "site ignores port".

## 5. WebHID

`hasseb.md` covers the API in detail. The security points:

### Confirmed

- `requestDevice()` needs transient user activation and a secure context, and takes filters on `vendorId`, `productId`, `usagePage` and `usage` (https://developer.mozilla.org/en-US/docs/Web/API/HID/requestDevice).
- The user "must take active steps to select a particular HID device". `getDevices()` returns devices granted before, so grants persist until revoked. `forget()` arrived in Chrome 100 and "will revoke access to all the HID interfaces on the same physical device" (https://developer.chrome.com/docs/capabilities/hid).

### What an injected script could do

By the shape of the API, script running on the granted origin can call `getDevices()`, `open()` and `sendReport()` with no prompt, because only `requestDevice()` needs a gesture. This is inference, not a quoted statement. It is why the rules stack up as they do: a strict CSP and Trusted Types so no script gets in, `forget()` on disconnect so a grant does not outlive its use, and MAX LEVEL written into the drivers so that even a hostile frame cannot exceed the ceiling without first raising it.

That last point has a limit worth stating in the threat model: an injected script can send SET MAX LEVEL too. The driver-side ceiling protects against bugs and stale commands, not against an attacker who can send arbitrary frames. The governor is in the same page as the attacker in that case. Keeping script out is the control.

### Not confirmed

- The WebHID specification itself (https://wicg.github.io/webhid/) returned an empty body to the fetch tool. Its security and privacy section must be read by hand in Stage 2.
- That grants are keyed by origin including port, in those words.
- Whether two tabs on one origin can both open the device.

## 6. Stored and imported data

Nothing was fetched for this section. These are working assumptions for Stage 2 to check:

- Treat IndexedDB contents like an imported file: validate against the schema on every load.
- `JSON.parse` creates an own property named `__proto__` and pollutes nothing by itself. The damage comes later, from merging parsed data into live objects. Reject the keys `__proto__`, `constructor` and `prototype` in the validator, build results as fresh objects, and never deep-merge imported data.
- Check the file size before reading. Cap depth, array lengths and string lengths.
- A hand-written validator for a small schema avoids a runtime dependency. If a library is wanted, valibot and zod are the usual choices. Licences and sizes were not checked, and either needs the owner's approval under `CLAUDE.md`.

## 7. pnpm

### Confirmed

- "Only auth, registry, TLS, proxy, and `local-address` settings are read from `.npmrc` files." The rest live in `pnpm-workspace.yaml` (https://pnpm.io/settings).
- From pnpm's supply chain page (https://pnpm.io/supply-chain-security): `strictDepBuilds` is on by default, `allowBuilds` is the allowlist for install scripts, `blockExoticSubdeps` is on by default and refuses git and tarball URLs for transitive dependencies, `minimumReleaseAge` defaults to 1440 minutes, and `trustPolicy: no-downgrade` fails when a version has weaker publish evidence than earlier ones.
- `minimumReleaseAge` arrived in pnpm 10.16, prompted by "several incidents recently where popular packages were successfully attacked" (https://pnpm.io/blog/releases/10.16).
- The reason for a release-age delay: the Shai-Hulud worm of September 2025 compromised more than 500 npm packages, stole tokens and cloud keys, and used each victim's npm login to publish infected versions of their other packages (https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem). Most such releases are pulled within days.

The repo's `pnpm-workspace.yaml` matches these docs: a seven-day `minimumReleaseAge` with the strict flag, `trustPolicy: no-downgrade`, `strictDepBuilds`, an empty `allowBuilds` and exact saves. No change is needed.

### Worth considering

- The `packageManager` field has no hash. Adding the `+sha512` suffix lets corepack verify the pnpm download. Not confirmed: how pnpm 12 and corepack treat it today.
- `blockExoticSubdeps` is on by default. Setting it explicitly would document the intent.

### Not confirmed

The versions that introduced `trustPolicy` and `allowBuilds`, the source for the September 2025 chalk and debug compromise, and `pnpm audit` behaviour.

## 8. GitHub Actions

### Confirmed

From GitHub's secure-use reference (https://docs.github.com/en/actions/reference/security/secure-use):

- "Pin references to actions to a commit SHA", and check the SHA comes from the action's own repository and not a fork.
- Pass untrusted `${{ github.event.* }}` values through an environment variable, never straight into a `run:` script.
- Give `GITHUB_TOKEN` the minimum permissions, read-only by default and raised per job.
- "Avoid using the `pull_request_target` workflow trigger if it's not necessary".
- Dependabot "will not create alerts for actions pinned to SHA values", though version updates still work.

The repo's `ci.yml` follows all of these, and sets `persist-credentials: false` on checkout.

### Workflow lockfiles

New in October 2026 (https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles and https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview/):

- The file is `.github/workflows/actions.lock`, written by the `gh actions-lock` extension and never by hand.
- It records a commit for every action, including actions used inside other actions. SHA pins in our workflow files do not cover those.
- It does not cover reusable workflow calls, which still need a full SHA.
- GitHub says that with a lockfile, SHA pinning in workflow files is "no longer necessary".

The feature is weeks old, and its general availability is reported only by a secondary source. Recommendation: keep the SHA pins that `CLAUDE.md` requires and add the lockfile in Stage 11, when the supply chain is audited anyway. Whether to relax the SHA rule is the owner's decision, and the recommendation is not to.

### Immutable releases

A release can be made immutable: its tag is locked to a commit, its assets cannot change, and publishing creates a release attestation (https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases). Create v0.1.0 as a draft, attach the assets, then publish.

### Not confirmed

The primary source for the tj-actions/changed-files compromise of March 2025 (CVE-2025-30066), which is the usual reason given for SHA pinning. Also Dependabot cooldown settings, zizmor, cache poisoning guidance and OpenSSF Scorecard details. Stage 11 should pick these up.

## 9. Build provenance

### Confirmed

- GitHub's docs show one action, `actions/attest@v4`, needing `id-token: write`, `contents: read` and `attestations: write`. Verify with `gh attestation verify PATH -R OWNER/REPO` (https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).
- An attestation alone gives SLSA v1.0 Build Level 2. Level 3 needs the build to run in a reusable workflow. Public repositories sign through the public Sigstore instance with a public transparency log. An attestation is "not a guarantee that an artifact is secure", and it does nothing until someone verifies it (https://docs.github.com/en/actions/concepts/security/artifact-attestations).
- Push protection for users stops pushes of secrets to public repositories by default. Repository-level push protection is off by default (https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection). Turn it on when the repository goes public.

The release job is the one place that needs more than read permissions. Give those permissions to that job only.

### Not confirmed

- Whether attestations are available to a private repository on the current plan. If not, the first attested build happens after the repository goes public.
- What makes a Vite build differ between runs. Test it: build twice in CI and compare the SHA-256 of `dist/`.
- CycloneDX tooling for pnpm, and how an SBOM attestation is made with `actions/attest@v4`.

## 10. Lint and the banned sinks

### Confirmed

- Trusted Types covers the ways lint can be dodged when they end in an HTML or script sink: computed property names, aliasing, `Reflect.set`, `createContextualFragment`, `parseFromString`, `srcdoc`, `setHTMLUnsafe`, string timers, `eval` and `Function` are all on the sink list in section 2. `javascript:` URLs are stopped by the Trusted Types navigation check and by `script-src` without `'unsafe-inline'` (https://w3c.github.io/trusted-types/dist/spec/#require-trusted-types-for-pre-navigation-check).
- Lint finds mistakes early and explains them. Trusted Types is the enforcement. Neither replaces the other.
- The Sanitizer API's safe methods (`setHTML`) are not Baseline, and the app does not need them (https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API). Build DOM through Svelte templates and text nodes.
- Mozilla's eslint-plugin-no-unsanitized covers `innerHTML`-style assignments and `insertAdjacentHTML`-style calls (https://github.com/mozilla/eslint-plugin-no-unsanitized). It would be a new dev dependency under MPL-2.0. Stage 0's own rules in `eslint.sinks.js` already do this job without it.

### Suggested additions to the existing rules

Without a new dependency: ban `srcdoc`, `createContextualFragment`, `parseFromString`, `setHTMLUnsafe`, `parseHTMLUnsafe` and `cssText`, ban `createPolicy` outside one file, and turn on `no-script-url` and `svelte/no-inline-styles`. The rule names are from memory and need checking against the installed plugins.

## Questions for the owner

1. Workflow lockfiles: add one beside the SHA pins in Stage 11, and keep the SHA rule as it is?
2. If a hosted demo is ever wanted, is simulator-only acceptable, given what a host without headers loses?

## For the Stage 2 spike

Prove, under the production policy, in Chromium, with the e2e CSP test:

1. A module worker loads, with the `enlighten-worker` policy or without one.
2. `fragments: 'tree'` with `trusted-types 'none'`, and measure what it costs.
3. A `style:` directive and a CSS custom property set from script do not violate `style-src 'self'`.
4. three.js creates its context and renders with no violation.
5. The built page with headers stripped still enforces Trusted Types from the meta tag.
