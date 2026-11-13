# Rendering: lighting the hallway and showing its colour

Research for Stage 1, read on 13 and 14 November 2026. It tests the brief's proposed approach to light transport against the alternatives, sets out the colour pipeline, and recommends one design for Stage 2 to confirm by ADR and Stage 7 to build.

"Confirmed" means read at the cited source. "Measured here" means a benchmark or numeric check run for this research. "Derived" means our own reasoning from first principles, which Stage 7's tests should hold to account.

## Recommendation

Keep the brief's superposition approach, with one change: split direct light from indirect.

1. **Direct light is computed per pixel in a shader,** analytically, with each tape as a thin rectangle that emits evenly, clipped by the lips of its reveal.
2. **Indirect light comes from radiosity,** solved in a Web Worker in plain TypeScript, once per mount whenever geometry or materials change. The results are cached as unit responses.
3. **Each frame sums the responses,** weighted by each tape's present output per channel. Colour is carried as CIE XYZ and converted to the display at the end, with fixed exposure and a false-colour view.

It needs three.js core and no other runtime dependency. It needs no WebAssembly and nothing the strict CSP forbids.

The split is needed because a tape 75 mm from a ceiling lights it unevenly: the illuminance falls by a factor of 4.6 across 100 mm (section 2). A radiosity mesh fine enough to show that would need more than 100,000 patches. An analytic direct term has no such limit, and what is left for radiosity to carry is smooth.

## 1. The four approaches

|                | (a) Unit response per mount, summed each frame                                     | (b) Analytic area lights only                          | (c) Lightmaps baked in an outside tool                  | (d) Path tracing in the browser                     |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| Accuracy       | Direct is exact if split out. Indirect is as good as the mesh. Matte surfaces only | Direct light only. No interreflection and no occlusion | Could be excellent, for one fixed geometry              | Reference quality, but noisy for seconds to minutes |
| Cost per frame | A few texture reads and the direct term                                            | Low                                                    | One texture read                                        | Too slow to follow dimming                          |
| Precompute     | About 0.2 s per mount (measured here)                                              | None                                                   | Outside the app                                         | Restarts on every change                            |
| Dependencies   | three.js                                                                           | three.js                                               | A renderer in the workflow, and baked files in the repo | three-gpu-pathtracer, three-mesh-bvh and more       |
| Fits the brief | Yes                                                                                | No: it is not photometric                              | No: the hallway is parametric                           | As a development check only                         |

Why (b) fails: in a closed room, the average indirect light is the direct light times reflectance ÷ (1 − reflectance). With surfaces averaging 0.7 that factor is 2.3. In a pale hallway most of the light on most surfaces has bounced at least once. three.js's own area light confirms the limits: "There is no shadow support" (https://threejs.org/docs/pages/RectAreaLight.html).

Why (d) is not shipped: three-gpu-pathtracer is at version 0.0.28, had three releases in six weeks, now "requires WebGPU", and warns that it "is not yet stable" (https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/main/README.md). Its release pace conflicts with the seven-day minimum release age, and it brings two or three more dependencies. A reference still for validation is better made by a small path tracer of our own in the test tools, since a box of rectangles is simple, or by an offline renderer at development time.

### Why superposition is exact

Light transport is linear in what each emitter gives out. If T is the field of illuminance for one mount at unit output, then the field for any set of levels is the sum of each mount's T times its output. The dimming curve, MAX LEVEL and the governor all act on the outputs and never on T. The brief has this right. A DALI change costs a few numbers handed to the shader.

## 2. Direct light

Derived: for a long strip that emits evenly (a Lambertian strip) with flux per metre Φ′, facing a plane at distance d, the illuminance at sideways offset x is E(x) = (Φ′ ÷ 2) × d² ÷ (d² + x²)^1.5, with a peak of Φ′ ÷ (2d). Integrated over x it returns Φ′, so energy is conserved.

Measured here, for 1,000 lm over 5 m at d = 75 mm: the formula gives 1,333 lux at the peak, and a brute-force numerical integration gives 1,330. Across the plane: 1,333 lux at 0, 768 at 50 mm, 288 at 100 mm, 58 at 200 mm and 4.4 at 500 mm.

The shader computes this per pixel for each tape:

- The tape is a thin rectangle, not a line. The illuminance on a matte surface from a polygon that emits evenly has a closed form (Lambert's edge integral), about 40 lines of shader code and no lookup textures. The linearly transformed cosine method used for glossy area lights reduces to this for matte receivers (Heitz and others, https://eheitzresearch.wordpress.com/415-2/).
- A reveal's lip hides part of the tape from some points. For a straight lip parallel to the tape that is an exact clip of the rectangle before the integral.
- Real tape behind a diffuser does not emit perfectly evenly with angle. The angular distribution is a setting on the tape and diffuser profile. Anything other than the even case is integrated numerically along the strip with 8 to 16 samples.

### A glossy floor

`optics.md` notes that a sealed floor lit at a grazing angle from a skirting slot shows a streak that a matte model misses, and that this is the view the brief cares about most. Because direct light is already per pixel and analytic, a gloss term for the floor can be added there: a specular lobe evaluated against the same tape rectangle. That is where the glossy area-light method earns its place, with its lookup textures, and three.js ships them. The indirect solve stays matte. This is an option for Stage 7 to weigh, behind the floor's gloss setting, and not part of the first version.

## 3. Indirect light: radiosity

### Method

Radiosity divides surfaces into patches, computes for each pair the fraction of light leaving one that reaches the other (the form factor), and solves a linear system. "Because the reflectivities are less than 1, this scheme converges quickly, typically requiring only a handful of iterations" (https://en.wikipedia.org/wiki/Radiosity_(computer_graphics), which cites the original papers).

Design points, derived:

- Solve for illuminance E on each patch: E = E direct + F × (reflectance × E). The source term is the analytic direct illuminance averaged over the patch. Store only the indirect part, E − E direct, since the shader supplies the direct part.
- Solving for illuminance means lux readouts need no division by reflectance, and work on black surfaces.
- Form factors between rectangles that are parallel or perpendicular have closed forms. Using them for the six main faces is exact and removes the worst error, which is between patches that share an edge at a corner. Pairs that involve a reveal use numerical integration with a visibility ray.
- Visibility by ray casting against a handful of boxes, not a hemicube. A hemicube needs a rasteriser and brings nothing for a scene this simple. Ray casting runs in Node for the tests.

### Measured here

A benchmark in plain JavaScript on one thread of a laptop (Node 26, Apple M1 Pro), for a closed box 5 × 1.2 × 2.4 m with reflectance 0.7 and no occlusion:

| Patches | Matrix memory | Form factors | One solve |
| ------- | ------------- | ------------ | --------- |
| 1,008   | 4 MB          | 20 ms        | 19 ms     |
| 2,022   | 16 MB         | 27 ms        | 54 ms     |
| 3,982   | 63 MB         | 97 ms        | 174 ms    |
| 8,022   | 257 MB        | 357 ms       | 639 ms    |

A few thousand patches solve in well under a second per mount. WebAssembly is not needed, which keeps `'wasm-unsafe-eval'` out of the CSP. Memory grows with the square of the patch count, so the dense matrix should be capped near 5,000 patches. Above that, progressive refinement needs one row of form factors at a time. Visibility rays against reveals will add time, likely a few seconds, and were not measured. A slower laptop may take two or three times as long.

### How many patches

The hallway's surfaces total about 42 to 46 m². At 100 mm patches that is 4,200 to 4,600. Indirect light is smooth except beside the bright band next to a tape, so the mesh is graded: 100 to 150 mm in general, with strips 25 mm wide across the tape's direction within about 300 mm of each mount. That adds roughly 500 patches a mount, for 4,000 to 7,000 in total. Six mounts may pass the cap, and progressive refinement is the fallback.

### How many responses

Each mount has up to five colour channels. If all the surfaces are neutral (grey), reflectance does not depend on wavelength, and one response per mount serves all five channels. Six mounts need six scalar fields. The thirty channel levels enter only as six colours handed to the shader.

Tinted surfaces are harder, because each bounce shifts the colour, and differently for each channel. An accurate treatment gives each channel an effective reflectance per surface. The three narrow-band channels (red, green, blue) need one field each. The two phosphor whites change chromaticity as they bounce and need three each. That is nine fields per mount and 54 for six mounts.

The brief's finishes are a neutral wall, builders' white and a light neutral floor, so the first version treats surfaces as neutral and is exact for them. Mildly tinted surfaces can use one field per channel as an approximation, flagged as such in the UI. Paint spectra are rarely available anyway.

Direct light never needs extra fields. It has not bounced, so its colour is the emitter's.

### Storage and the frame

- One array texture holds every response as a layer, indexed by a small lightmap of the hallway's faces. It uses one texture unit however many layers there are. WebGL 2 guarantees at least 256 layers and 16 texture units (https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glGet.xhtml).
- Half-float storage (RGBA16F). 32-bit float textures cannot be filtered on some devices.
- The lightmap is tiny: under 128 × 64 texels at 100 mm.
- Because it is tiny, the weighted sum can also be done on the CPU each frame (about 72,000 multiply-adds) and uploaded as one texture. That is the fallback if sampling many layers per pixel proves slow.
- Render only when something changes. A still scene costs nothing.

### Frame time

No published figure was found for what an integrated GPU does with up to six polygon integrals and several texture reads per pixel at 1440 × 900. Proposed budget: 4 ms of GPU time per frame at that size, to be measured in Stage 2's spike. If it is over: skip emitters that a surface cannot see, render at one device pixel per CSS pixel, or bake each mount's direct term into a finer texture when geometry changes.

## 4. three.js

Confirmed from the package registry and the r187 source:

- Version 0.187.0, MIT licence, no runtime dependencies (https://registry.npmjs.org/three/latest).
- Size: the minified WebGL build is about 195 kB gzipped before tree shaking (measured here from the published files). The package marks itself as free of side effects outside one folder, so a bundler can drop what is unused. The figure after tree shaking was not measured, and the renderer brings its whole shader library with it.
- `WebGLRenderer` is WebGL 2 only.
- **CSP and Trusted Types:** a scan of the r187 core build files found no `eval`, no `new Function`, no HTML string sinks, no string timers, no `cssText`, no workers and no `importScripts`. The only style writes are `canvas.style.width`, `height` and `display`, which are single-property writes that a strict `style-src` allows (`security.md`). Passing our own canvas and calling `setSize(w, h, false)` avoids even those. This answers the open item in `security.md`: three.js core should need no Trusted Types policy. Stage 2's spike confirms it in a browser.
- Addon loaders that create workers from blob URLs (Draco and KTX2) would break the CSP. The app does not need them.
- Display P3 is not in core. It is in the addon `three/addons/math/ColorSpaces.js`, registered through `ColorManagement.define`. The app can use that, or carry the two matrices itself.
- The built-in tone mappers all assume linear sRGB input. The app does its own colour work in its own shader and sets the material so three.js adds nothing.

Browser support, from MDN's compatibility data (https://github.com/mdn/browser-compat-data):

| Feature                                       | Chrome | Firefox | Safari |
| --------------------------------------------- | ------ | ------- | ------ |
| WebGL 2                                       | 56     | 51      | 15     |
| `drawingBufferColorSpace` (Display P3 canvas) | 104    | 132     | 16.4   |
| OffscreenCanvas with WebGL 2                  | 69     | 105     | 17     |
| Rendering to float textures                   | 56     | 51      | 15     |
| `@media (color-gamut)`                        | 58     | 110     | 10     |
| HDR canvas for WebGL (`drawingBufferStorage`) | 122    | no      | no     |

The visualiser can run in all three engines, in Display P3 where the screen has it. HDR output is Chrome only and stays out of the first version.

The default stack's "three.js used directly" holds. WebGPU is not needed.

## 5. The colour pipeline

### From LED to XYZ

For a channel with chromaticity (x, y) and luminous quantity Y: X = Y × x ÷ y and Z = Y × (1 − x − y) ÷ y. XYZ values add, so any mix of channels is the sum of each channel's XYZ. This is why transport can carry one luminous number per channel and turn into colour only at the end.

The chromaticities and flux per channel come from `optics.md`, where most are placeholders until the tapes are measured.

### XYZ to the display

The matrices are from CSS Color 4's sample code (https://www.w3.org/TR/css-color-4/), and three.js r187 carries the same values to seven decimals:

XYZ to linear sRGB:

```
 3.2409699  -1.5373832  -0.4986108
-0.9692436   1.8759675   0.0415551
 0.0556301  -0.2039770   1.0569715
```

XYZ to linear Display P3:

```
 2.4934969  -0.9313836  -0.4027108
-0.8294890   1.7626641   0.0236247
 0.0358458  -0.0761724   0.9568845
```

Both use a D65 white and the sRGB transfer curve. Detect a P3 screen with `matchMedia('(color-gamut: p3)')`, then set the canvas's colour space and read it back to check it took.

### White balance

With no adaptation, a 2700 K tape looks orange on a D65 screen. That is right for a camera with fixed daylight balance, and wrong for a person standing in the hallway, whose eyes adapt. The visualiser needs a white balance control: fixed daylight, adapted to the scene's own white, or a chosen colour temperature. The A/B view should use one balance for both sides, or the comparison is lost. This is a design choice for the spec, not a researched fact.

### Out-of-gamut LED colours

Red near 625 nm, green near 525 nm and blue near 465 nm all lie outside sRGB, and by Display P3's primaries the green and blue lie outside P3 too. Their converted values have negative components, which a screen cannot show.

CSS Color 4 maps such colours by holding lightness and hue in OkLCh and reducing chroma, noting that "changes in Hue are particularly objectionable; changes in Chroma are more tolerable" and that the method "can be computationally intensive".

Recommended, derived: the room's light is a mix of a small number of known channel colours. Map each channel's colour into the display's gamut once, on the CPU, when the profile or the display changes. A sum of in-gamut colours is in gamut, so nothing has to be mapped per pixel. The cost is that some mixes come out a little less saturated than the screen could have shown. Mapping keeps luminance exact, because the viewer is photometric, and moves the colour toward white. The CSS OkLCh method goes in the pure core for interface swatches and as a test reference.

The UI should say plainly that a screen cannot show these colours at full saturation. The playground's swatch for a saturated blue is an approximation, and the real tape will look more vivid.

### Mixing warm and cool white

Derived from XYZ adding: a mix of two sources lies on the straight line between their chromaticities, weighted by Y ÷ y for each. The black-body locus is curved, so the mix of a 2700 K and a 6500 K LED falls below it, toward pink, most of all in the middle of the range. The visualiser should compute this, and show the mixed white's colour temperature with its distance from the locus (Duv). It is a real property of two-channel tunable white, and the client may notice it on the bench at 4000 K.

Formulas, both from https://en.wikipedia.org/wiki/Planckian_locus and https://en.wikipedia.org/wiki/Correlated_color_temperature, which cite the papers:

- Colour temperature to chromaticity: Krystek's 1985 rational fit in CIE 1960 (u, v), accurate to about 0.0001 from 1,000 to 15,000 K, or Kim's cubic fits in xy from 1,667 to 25,000 K.
- Chromaticity to colour temperature: McCamy's cubic, with error "under 2 K" from 2,856 to 6,504 K for points on the locus. It is less accurate off the locus, which is exactly where mixed whites sit.

Recommended: find the nearest point on Krystek's locus by a one-dimensional search in mirek. That gives colour temperature and Duv together, to the fit's accuracy. Use McCamy as a cross-check in tests.

### Exposure and tone

A screen cannot show real luminance, so the viewer needs a fixed, stated exposure, as the brief says.

- Displayed value = luminance ÷ the luminance mapped to white. The photographic convention is L max = 1.2 × 2^EV100 (Filament's documentation, https://google.github.io/filament/Filament.md.html).
- Worked example: a wall at 100 lux with reflectance 0.8 has a luminance of 25.5 cd/m². To show it at half scale, white is 51 cd/m², which is EV100 5.4.
- Presets (night-adapted, evening and day) are fixed EV values. Starting points of about EV 0, 4 and 7 are ours to tune. Never adapt continuously: automatic exposure would hide the dimming the tool exists to show. An "expose for this view, then hold" button is fine.
- Tone mapping: linear up to a shoulder, then a roll-off that keeps hue. The Khronos PBR Neutral mapper is documented as having "no hue shifts" and as being "1:1" over most of its range (https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md). The app should use the same idea: scale all three channels by one factor that depends on the largest, without that mapper's small offset, which exists for a different purpose. Reinhard, ACES and AgX as three.js ships them work per channel and shift the hue of saturated lights, which is wrong for judging LED colour.

### False colour and readouts

- Radiance's `falsecolor` is the model: a legend, a linear or logarithmic scale, and optional contour lines (https://floyd.lbl.gov/radiance/man_html/falsecolor.1.html). The app's version runs in the same shader: the logarithm of illuminance or luminance through a palette, three decades by default, with numbered ticks.
- A probe under the pointer shows lux, cd/m², and the chromaticity, colour temperature and Duv of the light arriving there. It is computed on the CPU from the same data, so no pixels are read back from the GPU.
- For a matte surface, luminance = reflectance × illuminance ÷ π.

## 6. Validation

All of these run in Node as unit and property tests on the pure core.

1. **Form factors** against closed forms. Measured here, as ready fixtures: for a unit cube, opposite faces 0.199825 and adjacent faces 0.200044, summing to exactly 1. For a 5 × 1.2 × 2.4 m box, floor to ceiling 0.16772, floor to each side wall 0.33554 and floor to each end wall 0.08060, summing to 1. The formulas were checked against Monte Carlo integration, because the catalogue that lists them shows them as images (https://www.thermalradiation.net/sectionc/C-11.html and C-14).
2. **Row sums** of 1 for any closed box, and reciprocity between every pair.
3. **Energy balance.** In a closed room with uniform reflectance ρ, area A and flux Φ, the mean indirect illuminance is Φ × ρ ÷ (A × (1 − ρ)). For 1,000 lm, 41.76 m² and ρ = 0.7 that is 55.9 lux indirect and 79.8 lux in total. A property test over random boxes, reflectances and emitter positions must meet it.
4. **The direct term** against the strip formula in section 2, and its integral against the flux.
5. **Superposition:** the response to a sum of levels equals the sum of responses.
6. **Limits:** zero reflectance gives zero indirect light, and reflectance near 1 still converges.
7. **Mesh convergence:** halving the patch size changes probe values by less than a set tolerance.
8. **A reference render** of two or three fixed set-ups from a development-only path tracer, compared at probe points.

CIE 171:2006 publishes test cases for lighting software, with analytic and measured reference data (https://cie.co.at/publications/test-cases-assess-accuracy-lighting-computer-programs). The report is paid, and its cases were not read.

## 7. Risks

- **Reveals.** Occlusion, and the bright first-bounce band inside a shadowline, are where coarse radiosity is weakest. This needs the graded mesh and careful clipping, checked against a reference render early in Stage 7.
- **Memory.** The dense matrix grows with the square of the patch count. Have progressive refinement ready.
- **Frame time on integrated graphics** is unmeasured. Stage 2's spike should include one analytic emitter and a layered texture, timed.
- **Tape data.** Chromaticity, flux per channel and angular distribution are unknown until measured (`optics.md`). The pipeline works with placeholders, but its pictures are only as true as its inputs. The UI should mark a tape profile as "estimated" until it is measured.
- **Matte only.** Glossy paint and a polished floor are outside the physics, apart from the optional floor term in section 2. The spec should say so.
- **What a screen can show.** It cannot show absolute luminance, or colours at the edge of what LEDs emit. The lux and cd/m² readouts and the false-colour view carry the numbers, and the picture carries the impression.

## 8. Not confirmed

- That a custom shader material in three.js skips the renderer's own output colour conversion. Check in the spike.
- The size of three.js after tree shaking.
- Frame time on an integrated GPU.
- That half-float textures filter on every target device.
- The accuracy of colour temperature formulas off the locus, and the details of Ohno's 2013 method.
- CIE 171's test cases.
- The tapes' real angular distribution behind each cover.
