# ADR 0008: Light transport and colour for the visualiser

Status: accepted

Date: 2026-11-14

## Context

R10 asks for a rendered hallway. The owner decided it is a best-effort estimate that uses placeholder tape data and need not model real profiles exactly. `docs/research/rendering.md` compared four approaches and recommended one.

## Decision

- Superposition. Light is linear in each emitter's output, so each mount has a unit response, and each frame is the sum of responses weighted by each tape's present output per channel.
- Direct light is computed per pixel in a fragment shader: each tape is a thin rectangle that emits evenly, integrated in closed form and clipped by the lip of its reveal.
- Indirect light is radiosity on a mesh of a few thousand patches, solved in plain TypeScript in a worker when geometry or materials change. Only the indirect part is stored, one scalar field per mount, as layers of one half-float array texture. Solved responses are cached in IndexedDB against a hash of geometry and materials.
- Surfaces are neutral and matte. One response per mount serves all five channels. A tinted or glossy surface is outside this version, and the UI says so.
- Colour is carried as CIE XYZ. Each channel's chromaticity is mapped into the display's gamut once, on the CPU, holding luminance. The shader converts XYZ to linear sRGB or Display P3 with the CSS Color 4 matrices.
- Exposure is fixed: three presets (night-adapted, evening, day) and a manual value. It never adapts by itself. Tone mapping scales all three channels by one factor, so hue does not shift.
- White balance is a control: adapted to the scene (the default), daylight, or a chosen colour temperature. The A/B view uses one balance for both sides.
- A false-colour view and a probe under the pointer give lux, cd/m², chromaticity, colour temperature and Duv, computed on the CPU from the same data.
- Tape profiles carry the label "estimated" until measured. Flux per metre, chromaticity, angular distribution and diffuser transmission are placeholders with their source or "assumed" beside each.
- No WebAssembly, no WebGPU, no path tracer in the app, and no three.js addons.

## Consequences

- A DALI change costs a few numbers handed to the shader. Geometry changes cost a solve of under a second per mount.
- The spike measured 1.5 ms a frame for six emitters and six layers on an Apple M1 Pro, inside the 4 ms budget.
- The pure parts (form factors, the solve, the direct term, colour maths) test in Node against the closed forms and fixtures in `rendering.md` section 6.
- The glossy floor term and per-channel fields for tinted surfaces stay possible later without changing the structure.

## Alternatives considered

- Analytic area lights only: no interreflection, which is most of the light in a pale hallway.
- Baked lightmaps from an outside tool: the hallway is parametric.
- Path tracing in the browser: too slow to follow dimming, and the library is unstable.
