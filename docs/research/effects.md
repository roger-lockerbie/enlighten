# Effects: what DALI tape can do, and what is safe

Research for Stage 1, read on 13 and 14 November 2026. It answers the brief's question for RGBCCT: can subtle cues in colour and brightness, on tape where each run is one DALI address, replace or reduce addressable pixel tape? It also sets out the evidence behind the rate guard (S3).

Sources are cited where a fact was read. Several perception figures came only from search summaries and are marked. Everything under "Proposal" is this project's reasoning and not a published limit.

## Summary

- The bus is not the constraint for calm effects. Every candidate below costs less than one frame a second per address, because the drivers' own fades do the work.
- **The brief's rate guard default of three swings a second is too loose.** Three flashes a second is the broadcast and web ceiling. It was set for a television, and it comes with an exemption for small areas that room lighting can never claim. The proposal is a default of one swing a second, with three as a ceiling no setting can pass.
- The bus can do harm unaided. Alternating level commands with no fade can flash a tape at about 16 Hz, inside the band most likely to provoke seizures. The rate guard has to count frames from every source at the governor.
- 16 kHz PWM clears the published flicker limits by a wide margin. Common pixel tape runs at 400 Hz to 2 kHz and mostly does not.
- DALI tape cannot do motion along a run, or a gradient within one. It is better than pixel tape at dim, smooth, flicker-free light. Four to eight segments give presence-follow and a slow wash, but never a moving dot.
- Coloured cues are unreliable at night-light levels. Use level, and warm against cool.

## 1. Photosensitivity and the rate guard

### What the published limits say

- **WCAG 2.2, criterion 2.3.1:** content must not flash "more than three times in any one second period", unless the flash is below the general and red flash thresholds (https://www.w3.org/TR/WCAG22/). A general flash is a pair of opposing changes in relative luminance of 10% or more where the darker state is below 0.80. A red flash is a pair of opposing transitions involving a saturated red. The small-area exemption applies only when the flashing area is no more than a quarter of a 10 degree field of view (https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).
- **ITU-R BT.1702-3 (2023),** the broadcast rule: "a sequence of flashes is not permitted when both the following occur: the combined area of flashes occurring concurrently occupies more than 25% of the displayed screen area; and there are more than three flashes (i.e. six changes in luminance as described above) within any one-second period." A harmful flash is a change of 20 cd/m² or more when the darker state is below 160 cd/m². "Irrespective of luminance, a transition to or from a saturated red is also potentially harmful." And: "a sequence of flashing images lasting more than five seconds might constitute a risk even when it complies with the guidelines above." Flashes whose leading edges are 360 ms or more apart are acceptable whatever their brightness or area (https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1702-3-202311-I!!PDF-E.pdf).
- **Epilepsy Society:** "Between 3-30 hertz (flashes per second) are the common rates to trigger seizures", "sensitivity under 3 hertz is not common", and "Lights that flash or flicker between 16 and 25 times a second are the most likely to trigger seizures." It notes the UK safety regulator's advice for venues of four flashes a second or fewer (https://epilepsysociety.org.uk/about-epilepsy/epileptic-seizures/seizure-triggers/photosensitive-epilepsy).
- **An Epilepsy Foundation working group (2025):** the highest risk is at about 10 to 25 flashes a second, the light must cover at least a quarter of the visual field, diffuse flashing light is more provocative than direct light because more of the retina is stimulated, and red transitions are worse (https://pmc.ncbi.nlm.nih.gov/articles/PMC11995705).

### Why three a second is not a safe default here

1. It is a ceiling for television, not a comfort level. It assumes a screen at about 200 cd/m² that fills part of the view.
2. Both rules pair it with an area condition. A tape lighting a hallway fills the whole visual field with diffuse light, which is the more provocative case. The exemption never applies.
3. "Not common" below 3 Hz is not "absent".
4. The ITU warns about sequences longer than five seconds. An ambient effect runs for hours.
5. A flash is a pair of opposing changes, so three flashes are six level changes. The brief says "swings" and does not say which it means.
6. The bus itself can flash. At about 32 frames a second, alternating DAPC commands with fade time 0 can drive one address at about 16 Hz, in the worst band. Nothing in DALI prevents that. Only the governor does.

### Proposal

- **A swing** is a pair of opposing changes in light output where the ratio of high to low is 1.10 or more. This borrows WCAG's 10% and sits just under the ITU's contrast threshold. On the DALI curve it is 4 or more arc levels (1.0277⁴ = 1.116).
- **Default:** no more than 1 swing in any one second, per address and for the room as a whole. The eye sees the room, so swings on different addresses add up.
- **Ceiling that no setting or unlock can pass:** 3 swings in any one second, with leading edges at least 360 ms apart. S3's "explicit unlock" raises the limit from 1 toward 3 and never past it.
- **Large swings** (a ratio above 2, about 26 arc levels) need a fade of at least 0.7 s each way, the shortest standard fade.
- **Small ripples** under 4 levels are not swings, but are still held under 3 reversals a second, so they cannot sit in the 8 to 20 Hz band where the eye is most sensitive to flicker.
- **Saturated red:** any transition to or from a saturated red counts as a swing whatever the change in luminance. The built-in effects do not use one.
- **Duration:** a repeating pattern above half a swing a second times out after 5 seconds, the ITU's figure. Slower ones can run on.
- **Where it is enforced:** at the governor, on frames about to be sent, from every source: effects, sequences, the console, scripts, raw frames, switches and panic's own recovery. It works on predicted light output, so it needs the simulator's model of each driver's fade. Until a driver's fade time has been read back, and until its fade behaviour is confirmed on the bench (`dali.md` section 16), the guard treats every level command as an instant step. That is the worst case. Panic is never refused or delayed by the guard: a move to the safe level always goes out.

The guard has to reason about the driver's fade, not only about the frames. A DAPC with a long fade is one slow change. Two DAPCs a second apart with fade time 0 are a swing. Changing the fade time is therefore a guarded act as well.

This proposal is stricter than the brief, so it is repeated in `SUMMARY.md` for the owner to accept or change.

### PWM flicker

- IEEE 1789-2015, as presented by its committee: "Max % Flicker <= Flicker Frequency x 0.08", so "At 1250 Hz or higher, 100% flicker is allowed", with a stricter line of 0.0333 × frequency for sensitive people, which reaches 100% at about 3000 Hz (https://www.energy.gov/sites/prod/files/2015/05/f22/miller%2Blehman_flicker_lightfair2015.pdf). The standard's own text is paywalled.
- EU ecodesign limits for LED light sources: "Pst LM <= 1,0" and "SVM <= 0,4" at full load (https://legislation.gov.uk/eur/2019/2020/annex/II/division/2/2019-10-01).
- The DA5-L at 16 kHz is about 13 times above the first line and 5 times above the second.

Not confirmed: that the DA5-L holds 16 kHz at the bottom of its range, and its measured flicker. A phone's slow-motion camera on hardware day shows banding if it does not.

## 2. What people can see

### Brightness

- One arc level is a 2.8% change in light (`dali.md`). Faded, single steps are near or below what the eye detects. Sent with no fade at low levels, they can show as steps. Use the drivers' fades for everything.
- Light output is not perceived brightness. "A lamp that is dimmed to 10% of its maximum measured light output is perceived as being dimmed to only 32%. Likewise, a lamp dimmed to 1% is perceived to be at 10%" (Lutron, https://assets.lutron.com/a/documents/Measured_vs_Perceived.pdf). That is a square-root rule.
- The DALI curve is close to even in perceived steps, so effects should be specified in arc levels. A breathe of ±8 levels is ±24% in light and reads as gentle.
- The brief asks every control to show light output with the arc level beside it. This finding suggests a third reading, perceived brightness (the square root of output), for the playground. The 40% ceiling is about 63% perceived. The DA5-L's possible 1% floor is about 10% perceived, which is why it matters for night lighting.
- Slow changes: one study found that detecting a slowly changing illuminance depends on how far it has moved from where it started, not on its rate (Kawarabayashi and Ishida, abstract only, https://www.jstage.jst.go.jp/article/ieijac/39/0/39_0_90/_article/-char/en).
- Temporal sensitivity peaks at about 8 to 20 Hz at room brightness and lower in dim light (search summaries of https://pmc.ncbi.nlm.nih.gov/articles/PMC3005172 and related papers).

Not confirmed: a number for the just-noticeable step in brightness between adjacent fields or over time.

### Colour

- One step of colour difference (a MacAdam step) is a radius of 0.0011 in u′v′. "A just noticeable chromaticity difference at 50 % probability is considered to be 0,0013", and "This applies only to the white region" (CIE TN 001:2014, from a search extract of https://files.cie.co.at/738_CIE_TN_001-2014.pdf).
- Industry rule of thumb: 1 step is not visible, 2 to 4 barely, 5 or more readily. The tolerance for white LEDs is 4 steps (https://www.waveformlighting.com/tech/color-consistency-in-lighting-products).
- These are thresholds for two patches side by side. For a single field drifting over 10 seconds, the threshold was 2 to 15 CIELUV units depending on the starting colour and direction, and changes toward neutral white were harder to see (Pastilha and others 2020, from the abstract, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7774110/).
- Colour temperature should be planned in mirek, which is how DALI carries it. About 1 mirek is the best-case detectable difference and about 5 the practical one (search extracts, including a 1950 paper). 5 mirek is 36 K at 2700 K and 210 K at 6500 K.

Consequences for design:

- An accent tint of 3 to 7 steps is the "is that slightly rosy?" range.
- Two tapes can differ from each other by 3 or 4 steps as made. Tints smaller than that are lost in the mismatch, and a two-tone effect across two tapes needs more.
- A cue meant to be noticed should take under about 2 seconds. A drift meant not to distract should take minutes and move toward neutral.

### At night

- Mesopic vision, where rods and cones both work, runs from 0.005 to 5 cd/m² (https://sensing.konicaminolta.asia/what-is-mesopic-photometry/). Surfaces lit by a night-level tape sit in that range. Colour discrimination weakens there and sensitivity shifts toward blue-green.
- Coloured cues at night-light levels are therefore unreliable. Level, and warm against cool, are the dependable signals.
- Consensus guidance for healthy sleep: no more than 10 lux melanopic EDI at the eye in the three hours before bed and for night trips, and no more than 1 lux in the sleep environment (Brown and others 2022, https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.3001571). Warm, dim light has a low melanopic share, which is the case for night scenes at the warm end.

Not confirmed: melanopic ratios for specific colour temperatures. They would let the visualiser show a melanopic reading beside lux, which would suit the night-lighting purpose. A Stage 7 option, not a requirement.

## 3. Candidate effects

Frame costs are from `dali.md`: a level is 1 frame, a colour temperature change with its level is 5, and a full RGBWAF change with its level is 11. Changing the fade time first costs 3 more (DTR0 and a command sent twice).

| Effect                   | What it is                                  | Frames per event                                     | Typical rate          | Frames a second per address | What to tune                                                  |
| ------------------------ | ------------------------------------------- | ---------------------------------------------------- | --------------------- | --------------------------- | ------------------------------------------------------------- |
| Breathe                  | Level rises and falls slowly                | 1 at each turn, with the fade set to half the period | A period of 8 to 16 s | 0.13 to 0.25                | Depth of 4 to 12 levels, and the period                       |
| Swell and settle         | A brief rise, then ease back                | 2                                                    | One-off               | n/a                         | Overshoot of 5 to 10 levels, settle over 2 to 4 s             |
| Colour temperature drift | A slow wander between warm and cool         | 5                                                    | Every 20 to 60 s      | 0.08 to 0.25                | Steps of 10 to 30 mirek, fade as long as the interval         |
| Hue drift                | A slow wander in tint                       | 11                                                   | Every 20 to 60 s      | 0.2 to 0.55                 | Keep saturation low. No saturated red transitions             |
| Warm shift               | Warmer as it dims, as a filament lamp does  | 5                                                    | Per dim action        | n/a                         | The curve, which is a setting                                 |
| Accent tint              | White with a small colour offset            | 11                                                   | One-off               | n/a                         | 3 to 7 steps of colour difference                             |
| Two-tone                 | Two addresses in opposing phase             | As breathe, on each                                  | A period of 8 to 16 s | 0.13 to 0.25 each           | Hold the room's total light steady so the room does not pulse |
| Notification             | One or two soft pulses                      | 2 to 8                                               | Rare                  | n/a                         | Rise under 1 s, depth over 4 levels, never more than two      |
| Presence follow          | Zones brighten ahead of a walker            | 1 per zone                                           | Walking pace          | under 1                     | Lead time, fades of 0.7 to 1.4 s                              |
| Sunrise                  | A long rise in level and colour temperature | 1, then 5 per colour step                            | Over 20 to 40 minutes | under 0.1                   | Start level, and colour steps small enough not to show        |

All of these fit two tapes with room to spare. The budget meter Stage 9 plans will read low for every one of them. What limits them is the rate guard and how the drivers fade.

Three things about the drivers decide how good these look, and all are unknown until hardware day (`dali.md` section 16):

- Whether a colour change follows the fade time, and along what path.
- Whether a new command during a fade restarts cleanly from the present level. Breathe and drift depend on it.
- The DA5-L's lowest level and its PWM steps at 16 kHz (`da5-l.md`). A breathe at the bottom of the range is the first effect to show stepping.

A fade is linear in arc level, which is close to linear in perceived brightness. A breathe built from two fades is therefore a triangle wave, with a visible turn at each end. Two extra commands a cycle, with shorter fades near the turns, soften it into something closer to a sine, at about half a frame a second.

### Dim to warm

Products that warm as they dim are "usually designed for 2700-3000K at full output", falling as low as 1800 K (US Department of Energy, https://www.energy.gov/node/1228156). One patent describes a curve falling roughly linearly to about 2600 K at 40% and then faster to about 1800 K at 5% (search extract of US 9769895). Makers sell both a halogen-like and a linear curve (https://luminus.com/products/dynamic-cob/warm-dimming). The shape is product-specific, so the app's warm shift takes a curve as a setting. Tape A's warmest is 2700 K, so on the bench it can only run from 6500 K down to 2700 K. Tape B's warm white goes lower.

### Rates that feel calm

No source was found that gives a comfortable rate for ambient change in numbers. One office field study had lighting "programmed to vary slowly between settings", and just over half of occupants preferred it (https://www.cibsejournal.com/?p=12016). The periods in the table are starting points to tune by eye on the bench, and the document does not claim more for them.

## 4. Against pixel tape

Pixel tape can do, and DALI tape cannot:

- Motion along the tape: chases, a moving dot.
- A gradient within a run.
- Per-pixel sparkle.
- Fast frame rates. A WS2812B takes 800 kbit/s, about 30 µs a pixel, so 300 pixels refresh about 100 times a second (https://learn.watterott.com/kb/ws281x/WS2812B-v5.pdf, with our arithmetic).

DALI tape does better:

|                                 | DALI tape on a DA5-L                                                           | Pixel tape                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| PWM frequency                   | 16 kHz                                                                         | 400 Hz on older WS2812B, 2 kHz on current ones, about 1 to 1.2 kHz on SK6812 (datasheet search extracts) |
| Against IEEE 1789 at full depth | Passes both lines                                                              | 400 Hz and 1.2 kHz fail both. 2 kHz passes only the first                                                |
| Lowest level                    | 0.1% on the standard curve, in 2.8% steps (the DA5-L may stop at 1%)           | 8-bit linear: the first step is 0.39% and the second doubles the light                                   |
| Who runs the fade               | The driver. The last state holds if the controller stops                       | A controller must stream every frame                                                                     |
| White quality                   | Dedicated warm and cool LEDs, CRI above 90                                     | Not researched                                                                                           |
| Fits the house system           | Scenes, groups, power-on and failure levels, and MAX LEVEL as a second ceiling | A separate system                                                                                        |
| Standby                         | Not researched                                                                 | About 1 mA a pixel at 5 V on SK6812, so about 1.5 W for a dark 300 pixel strip (our arithmetic)          |

Dim, smooth night scenes are where pixel tape is weakest and DALI tape is strongest, and night lighting is what the brief cares about most.

Not confirmed: CRI of RGBW pixels, voltage drop and power injection, and the DMX pixel chips. The comparison of white quality in the table is one-sided for that reason.

### Segmenting a run

Splitting a hallway into several DALI addresses buys some of what pixels do. A chase hop across segments is two level commands, one up and one down.

| Pattern                                                | Bus cost                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Level-only chase, one hop a second                     | 2 frames a second, whatever the number of segments                                            |
| A hop that changes colour temperature on both segments | 10 frames a hop                                                                               |
| A hop that changes RGBWAF on both                      | 22 frames a hop, most of a second of bus                                                      |
| Setting 8 segments to 8 different RGBWAF colours       | 88 frames, nearly 3 s. The change ripples down the hall unless fades are several seconds long |
| Setting 8 segments to one colour through a group       | 11 frames                                                                                     |

With overlapping fades, 4 to 8 segments give a convincing slow wash and presence-follow. They never give a crisp moving dot or a smooth gradient: the resolution is the segment length. Each segment also needs its own driver, which is the real cost.

### The answer to the brief's question

Subtle cues on DALI tape can replace pixel tape wherever the purpose is atmosphere, orientation or a gentle signal: a breathe, a warm shift, a tint, a slow wash across a few segments, light that leads a walker down the hall. They cannot replace it where motion or a gradient within a couple of metres is itself the point. The bench can demonstrate the first list directly with two addresses, and the visualiser can show segmented set-ups that the bench has too few drivers to build, as Stage 9 plans.

## 5. Not confirmed

| Item                                                            | How to settle it                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| IEEE 1789's own text and its low-frequency rules                | The standard                                                            |
| Just-noticeable steps in brightness, side by side and over time | Vision science texts. Or judge on the bench, which is what matters here |
| A comfortable rate for ambient change                           | The bench, by eye                                                       |
| A maker's dim-to-warm table                                     | A product datasheet                                                     |
| Melanopic ratios by colour temperature                          | CIE S 026 and its toolbox                                               |
| The DA5-L's flicker at low levels                               | Slow-motion video or a flicker meter on hardware day                    |
| Colour fades, and restarting a fade midway                      | `dali.md` section 16                                                    |
| Pixel tape's white quality, voltage drop and standby            | Datasheets, if the comparison needs to be complete                      |
