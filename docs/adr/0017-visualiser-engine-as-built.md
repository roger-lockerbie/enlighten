# ADR 0017: The visualiser engine as built

Status: accepted

Date: 2026-11-18

## Context

ADR 0008 chose the method: direct light per pixel, indirect light by radiosity in a worker, one unit response per mount, colour as XYZ, fixed exposure. Stage 7 built it. This ADR records what was built, the choices ADR 0008 left open, and where the build differs from the Stage 7 plan the owner approved.

Stage 7 builds the engine for every mount kind in R11 and shows one fixed hallway from one fixed camera. Stage 8 adds the hallway and mount editors, the cameras and the A/B view.

## Decision

### The scene

- A scene is plain data: the hallway's size, end walls open or closed, three reflectances, and up to six mounts. A mount is a skirting slot (tape facing down at the floor), a reveal (tape facing up or down), or a flush channel. A reveal lit both ways is two mounts with the same opening. `parseScene` checks an untrusted value as a scene, in the style of the store's validator, and the light worker checks every scene it is sent.
- Geometry defaults come from `docs/research/optics.md` section 5, each with its basis and whether it is sourced (R11.2).
- An opening behind a wall is a cell of its own with five inside faces. The room is a cell too. Every cell is convex.

### Light transport

- **Visibility is by portals.** A point sees a polygon in another cell only through the opening between them, which is a clip of the polygon against the four planes through the point and the opening's edges. That is exact for this geometry and needs no general ray caster. Profiles and tape bodies inside an opening do not block light.
- **Direct light** is Lambert's edge integral over the tape's lit rectangle, after that clip. `src/light/polygon.ts` holds it for the core and `src/ui/visualiser/shaders.ts` repeats it in GLSL. An e2e test compares the two at a grid of pixels.
- **Form factors.** Far pairs of patches use the point-to-point kernel. Near pairs, and every pair that looks through an opening, use the exact edge integral from sample points on each patch. Each pair is made reciprocal by averaging both directions, or by sampling from the smaller patch when one is under half the other's size. The rows are then closed: each is scaled so it sums to 1, by a symmetric scaling that keeps reciprocity. Without that step, sampling error of under 1% in a row became 7% in the room's mean light at a reflectance of 0.9.
- **The mesh** is a grid on each face, with lines that run the whole face. Steps are 250 mm along the hallway and 150 mm across it, with 12.5 mm steps within 50 mm of a mount, 25 mm within 150 mm and 50 mm within 300 mm, on the mount's own wall and on a floor or ceiling within 600 mm of it. An opening's inside faces have four cells across. Above 5,000 patches every step is stretched by 15% at a time until the mesh fits.
- **The lightmap** takes each mount's indirect light from the patch centres by bilinear blending, at 100 mm texels along the hallway and 12.5 mm across it. Cells in an opening's mouth are filled from their neighbours, so a wall is not darkened beside one.
- **The solve** is Gauss-Seidel to a change of 1 part in 100,000 of the peak direct light.
- **Voltage drop** is up to four even pieces along the tape, only on a mount that turns it on. It is off by default, and it is part of the cache key.

### Emitters and covers

- The simulator already applies the dimming curve, the colour temperature mixing law and RGBWAF scaling, and reports a drive on each terminal. The emitter model takes that drive and treats flux as linear in it. `src/sim` is unchanged, and so is `LUMINANCE_WEIGHT`, which the rate guard reads.
- Tape profiles A, B and COB carry flux per metre and chromaticity per channel, each with its basis and its standing: datasheet, estimated or assumed. Stage 7's two mounts follow bench drivers A and B. On hardware, the lowest address stands for A and the next for B.
- Covers carry the transmissions from `optics.md` section 2 and an assumed haze each, because no cover's scattering is published. Dots are drawn only on the tape's own lit surface, from one repeat of the tape's pattern per channel: each LED lights the cover as the fourth power of the cosine, and the haze sets how much of that glow shows against the LEDs themselves. The pattern's mean is 1, so it never changes the flux. The room's light uses the even strip.
- Tape emission that is not even with angle is not built. A 120 degree beam is the even case.

### Colour

- White balance uses a Bradford transform to the display's D65. "Adapted to the scene" adapts to the point on the black-body locus nearest the room's mixed light, held to 2,000 to 10,000 K, and not to the mix itself: full adaptation would show a saturated blue room as white. After adapting, each channel's luminance is put back to its measured value, so the picture stays photometric.
- Each channel's colour is moved toward D65 at the same luminance until the display can show it, in closed form. The OkLCh method is in the core as a reference.
- Exposure presets are EV100 0, 4 and 7 for night-adapted, evening and day, and the manual range is -4 to 12. The tone curve is one to one up to 0.8 of display white, then rolls off toward 1 with all three channels scaled alike.
- False colour is a log scale over four decades: from 0.1 lux, or from 0.01 cd/m².
- The probe reports the light as a meter would read it, before white balance and gamut mapping.
- The bench preview on the Playground uses the same tape data and colour path, on one scale where tape A at full is white.

### Workers, cache and bundle

- The light worker's messages are checked both ways: the worker checks the scene, and the page checks the layers that come back, for shape, size and values in range.
- A newer request ends the worker and starts another. `src/workers/policy.ts` stays the one place a worker is made.
- The cache reaches the store's backend through `Store.lightBackend()`, which passes only the cache's own keys. A response, kept or fresh, is used only when its lightmap is laid out face for face as the page's is.
- A solved response is kept under a key that hashes the solver's version and the scene's geometry text. The hash is not a security measure: the text is stored beside the layers and compared on read. Tape type, cover and binding are not in the key, because they only weight a mount's response. Four scenes are kept, least recently used first out. A record that is not this scene's, or fails its checks, is deleted and solved again. It is not set aside, because it holds nothing that a solve does not give back.
- three.js loads in a chunk of its own, with the Visualiser page and the light core in a second lazy chunk. The light cache has its own store module (`src/store/light.ts`) so the entry chunk does not carry it.
- Preferences move to version 3 with the exposure, white balance and false-colour view.

### Drawing

- One mesh and one shader, compiled for the scene's count of tape pieces, mounts and openings. It draws only when something changes.
- Faces overlap by 2 mm at their outer edges, which closes cracks where faces meet at different end points. An unlit tape draws as the surface it sits in.
- The canvas takes Display P3 when the screen reports it and the drawing buffer accepts it.

## Consequences

- Measured on an Apple M1 Pro: a frame with six mounts, all lit, takes about 3.1 ms at 1440 by 900 in steady state (`pnpm perf:frame`: medians of 3.05 to 3.34 ms over several runs, single readings from 2.4 to 4.1), against the 4 ms budget. The margin is thin. A frame drawn after a pause, when the GPU has gone idle, takes 5 to 8 ms: the app draws only on change, so isolated frames are of that kind, and a fade's frames are of the steady kind. The fallbacks in `rendering.md` section 3 are still available.
- The measurement draws its six-mount scene off screen, in runs of at most 40 ms with the page free between them, and stops at a frame over 50 ms. It never changes the picture and cannot hold up Panic (S7-M1, S7-L1). Its off-screen target is not multisampled. The canvas is, and the two read the same within the noise.
- The solve takes about 0.65 s per mount with six mounts at 4,348 patches, and 0.73 s in all for the default scene (`pnpm perf:solve`), against 2 s per mount.
- Against the reference path tracer in `tools/reference`, direct light agrees within 1% at every probe point, inside the openings included. Indirect light agrees within 5% at 122 of 124 points. A point on the ceiling 30 mm from the wall above a reveal is 8% high. A point on the floor under a low reveal is 21% high: it sits on a shadow edge of bounced light, which the mesh smooths over a 12.5 mm patch. The tests hold every point to 10% and that one to 25%.
- In a closed box the solve balances energy within 1% for reflectances from 0.05 to 0.9.
- The view settings are not in workspace files yet. `docs/SPEC.md` section 8 lists them. They join the file with the visualiser's set-up in Stage 8, in one version step.
- Headless Chromium draws WebGL in software and logs a warning when it reads a frame back to show it. The e2e harness allows that one message.
- `@types/three` brings six packages that type addons the app does not use (`docs/DEPENDENCIES.md`).

## Differences from the approved plan

- The plan said to gather indirect light at each lightmap texel from the patch solution. At 5,000 patches that costs more than the 2 s budget, so the build blends patch centres onto the lightmap and makes the mesh fine where the light is not smooth.
- The plan said closed forms for form factors between room faces. The build uses the exact point-to-polygon integral for near pairs and closes the rows, which gives the same closed-form face totals within 1% with less code.
- The plan said a corrupt cache record is set aside. It is deleted, as `docs/ARCHITECTURE.md` section 5 already allowed.

## Alternatives considered

- A general ray caster for visibility: more code and no gain for a box with openings.
- Normalising rows without keeping reciprocity: simpler, and it breaks the symmetry the energy balance rests on.
- Writing our own declarations for three.js to avoid `@types/three`'s six packages: possible later, at the cost of keeping a dozen class declarations in step with three.js.
