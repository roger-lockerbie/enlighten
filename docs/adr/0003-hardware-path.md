# ADR 0003: The hardware path is a local Python server. WebHID is a deferred option

Status: accepted

Date: 2026-11-14

## Context

Chrome may refuse the hasseb over WebHID (`docs/research/hasseb.md` section 3). The owner decided on 14 November 2026 that a small Python server is the hardware path, that it may use python-dali at run time, that it is a thin relay with no governor of its own, and that WebHID is optional (`docs/research/SUMMARY.md`). On the same day the owner approved the `websockets` library for the server.

## Decision

### The server

- One Python program in `server/`. Dependencies: python-dali 0.16 (frame decoding), hidapi (USB), and `websockets` (HTTP and WebSocket). All are pinned to exact versions by hash in `server/requirements.txt`. The server builds the hasseb's reports itself.
- It binds to 127.0.0.1 on port 47821 and nothing else. It serves the built app from `dist/` and one WebSocket endpoint, `/bus`, from that one origin. It sends the same security headers as `vite preview`, generated from one shared source so the two cannot drift.
- Every request must carry `Host: 127.0.0.1:47821`. The WebSocket upgrade must carry `Origin: http://127.0.0.1:47821`. Anything else is refused.
- At start it makes a 256-bit random token and prints `http://127.0.0.1:47821/#t=<token>`. The app reads the fragment, removes it from the address bar with `history.replaceState`, and sends it as the first WebSocket message. The server compares in constant time. The URL token works once: the server answers with a fresh token for reconnects, kept in memory only, because the browser's own history may keep the URL. The app refuses to read the token if a service worker controls the page. The token is what stops other local programs, which can forge headers.
- One client at a time. A second connection is refused.
- The protocol is fixed-size binary messages (`docs/SPEC.md` section 9). The client sends one 16-bit frame with the flags it expects. The server decodes the frame with python-dali, works out for itself whether it is sent twice and whether it expects a reply, and refuses the message if the client's flags differ. It builds the hasseb report itself, matches the report's sequence number, and keeps "the gear said nothing" apart from "the hasseb said nothing".
- Stop: when the client goes away, when no message arrives for 3 seconds, when the server is stopped, or on the client's one-message panic, it drops everything queued, sends TERMINATE and broadcast OFF, and waits.
- The server has no governor, no ceiling and no rate guard. Those live in the app (ADR 0004, ADR 0005). The threat model records what that leaves open.
- Remote use is an SSH forward with the same port at both ends: `ssh -L 127.0.0.1:47821:127.0.0.1:47821 bench`. The server never listens on the LAN and has no flag that makes it.

### The app

- Hardware is available only when the page was loaded from the server with a token. Under `vite preview` or the dev server the app is the simulator alone. No address field and no connection setting exist.
- The transport runs in the bus worker (ADR 0010).

### WebHID

- Not built in Stage 4. The `Transport` interface (`docs/ARCHITECTURE.md`) leaves room for it.
- Until it is built, the Permissions-Policy sets `hid=()`, so no device grant can exist on the app's origin. The descriptor check on hardware day uses a separate throwaway page on another port and calls `forget()` afterwards.
- It may be built after hardware day if the descriptor check shows Chrome exposes the hasseb's reports. Before building it, read the WebHID specification's security section by hand, which Stage 1 could not fetch.
- If built: filter on vendor 0x04CC and product 0x0802 only, choose the report framing from `device.collections`, and call `forget()` on disconnect. Choosing between it and the server is one setting.

## Consequences

- Hardware works in any current browser.
- The person running the bench runs a Python program, which the client will read. It is kept small for that reason.
- The app's CSP does not change: `connect-src 'self'` covers the WebSocket, which the spike confirmed.
- The preview server and the hardware server use the same port, so they share one origin and one set of stored data, and cannot run at the same time.
- A live cross-check comes free: the server's python-dali decode disagrees with the TypeScript core only if one of them is wrong.

## Alternatives considered

- WebHID first: blocked on an unknown that only the hardware can settle.
- A Node server sharing the TypeScript core: needs a native HID module, which the install-script block exists to stop.
- A hand-written WebSocket implementation: no dependency, but our own parser in the most exposed part of the server.
- A second governor in the server: the owner decided against it. A cheaper, partial rate limiter in the server is an open question (`docs/OPEN_QUESTIONS.md`).
