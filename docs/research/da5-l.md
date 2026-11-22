# Skydance DA5-L

Research for Stage 1, read on 13 and 14 November 2026. Everything here comes from the two manual revisions, the DALI Alliance product database, Skydance's site and sibling manuals. Nothing has been measured yet. Where a fact is not published it is listed under "Unknowns" with the query or measurement that settles it.

## Sources

| Key   | Source                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M102  | User Manual Ver 1.0.2, dated 2026.7, as hosted by Linear Lux: https://linearlux.com.au/wp-content/uploads/2026/09/LL-SD-DA5-L.pdf                      |
| M100  | User Manual Ver 1.0.0, dated 2023.12: https://superlightingled.com/PDF/SKYDANCE/5-Channel-Constant-Voltage-DT6-DT8-DALI-Dimer-for-LED-Strip-DA5-L.pdf  |
| DiiA  | DALI Alliance product database, product 8778: https://www.dali-alliance.org/products/8778/da5-l                                                        |
| SKY   | Skydance product page: https://www.iskydance.com/index.php?c=product_show&a=index&id=2350 and its manual link, which serves the same Ver 1.0.2 as M102 |
| DA4-L | Manual of the 4 channel sibling, Ver 2.0.2, 2026.10: https://www.iskydance.com/en/product/manual/id/492/index/0.html/DA4-L.pdf                         |
| DP4   | Manual of the DP4 DALI and DMX decoder: https://www.iskydance.com/en/product/manual/id/496/index/0.html/DP4.pdf                                        |
| LN    | Manual of the LN-150-24-2DA DT8 driver: https://www.iskydance.com/en/product/manual/id/520/index/0.html/m.pdf                                          |
| HL    | A UK reseller's description: https://hiline-lighting.co.uk/gb/dali-controllers/1109-DA5-L-dali-5ch-controller-5060440718229.html                       |

The Linear Lux PDF is Skydance's own Ver 1.0.2 manual with no rebranding, and the DALI Alliance listing links to the same Skydance product page. The product Linear Lux sells as LL-SD-DA5-L is the certified DA5-L by name and manual. Whether the bench units carry the certified firmware is not known until they are read.

## What is confirmed

### Certification (DiiA)

- Certified DALI-2. Parts 101, 102, 207 and 209, each at version 2.0. Hardware version 1.0, firmware version 2.0. GTIN 6975617411324.
- Bus current consumption: 2 mA.
- Product properties ticked: control gear, LED drivers (part 207), colour control (part 209).
- Colour types: **RGBWAF is ticked. Tc is not ticked. xy is not ticked.**
- "Time to first light under 500 ms" is not ticked.
- No certification date is shown.

### Electrical (M102, same in M100 unless noted)

- Input 12 to 48 V DC. Five constant-voltage outputs, 4 A each at 12 or 24 V and 3 A each at 36 or 48 V. 480 W at 24 V.
- PWM frequency "1000/2000/4000/8000/16000Hz selectable", shown as F1, F2, F4, F8 and FA. The bench uses FA.
- Dimming range: "1 -100%". The technical table says 1%, not 0.1%. The push-dim text repeats "dimming range 1%-100%".
- Dimming curve: "Logarithmic", and "standard DALI logarithmic dimming curve".
- Inputs: DALI and Push Dim. The DALI terminals are not polarised.
- Protection against overload, short circuit and reverse connection, with automatic recovery.

### Light types

Set from the two buttons (hold both for 2 s). Nothing in either manual suggests the light type or the PWM frequency can be changed over DALI.

| Code | Manual name            | Manual's DALI term | Addresses                                |
| ---- | ---------------------- | ------------------ | ---------------------------------------- |
| C1   | Single color           | DT6 dimming        | 1 (five channels dim together)           |
| C2   | Color Temperature      | DT8-TC             | 1 (per M100; M102 does not say per type) |
| C3   | RGB                    | DT8-RGB            | 1                                        |
| C4   | RGBW                   | DT8-RGBW           | 1                                        |
| C5   | RGB+CCT                | DT8-RGB+CCT        | 1                                        |
| 5C   | 5 channel single color | DT6                | 5 (M102 only: "5 channel independent")   |

M100 says "1 DALI address" for the product and lists five light types. M102 adds the sixth type, 5C, which takes five addresses. A unit with older firmware may have no 5C mode. The brief's statement that the DA5-L uses one address in every type is true for C1 to C5 and false for 5C.

The label on the unit gives the C5 terminal order as R, G, B, WW, CW. In C2 the label shows a repeating CW and WW pattern across the five terminals, and the wiring diagrams show two dual-colour strips. The exact C2 terminal order could not be read with certainty from the artwork.

### Addressing and display

- "by factory defaults, no DALI address is assigned for the dimmer, and digital displays FF" (M102).
- The address can be set from the buttons, from 00 to 63, or back to FF.
- The display shows "AU" while a DALI master assigns an address.

## The three accounts of how the colour modes appear on the bus

This is the main finding. Three sources disagree.

1. **The manual** calls C2 "DT8-TC" and gives no colour type for C3, C4 or C5.
2. **The DALI Alliance listing** ticks RGBWAF only. Tc and xy are not ticked.
3. **A reseller (HL)** says C2 uses Tc, C3 and C4 use xy, and C5 uses xy with Tc beside it. This reads as marketing copy and contradicts the certification record, so it carries the least weight.

Readings that fit the first two:

- The certification test ran in one light type, most likely C5 as RGBWAF, and the Tc behaviour of C2 exists but was not part of the listing. In that case C5's two whites are probably the W and A channels (what `tools/first_light.py` assumes), and C2 probably answers Tc commands.
- Or C2 is RGBWAF with two channels linked, and the "TC" in the manual is loose wording. In that case `SetDT8ColourValueTc` in `tools/first_light.py` steps 5 and 6 would do nothing on driver A.

Neither can be ruled out from documents. The sibling DA4-L manual says of its C-2 type "DT8-TC dimming, the dimmer occupy 1 DALI address, CH1 and CH3 synchronized output WW (warm white), CH2 and CH4 synchronized output CW (cool white)", which supports the first reading for C2 but is not evidence about the DA5-L itself.

Consequence for the build: the simulator's DA5-L profile must offer both presentations for C2 as well as for C5, not for C5 alone as the brief says. The first-light script and the app's playground need a path that works if driver A turns out to be RGBWAF only.

## What the sibling manuals suggest

These are confirmed for the sibling and only indicative for the DA5-L.

- **Default PWM frequency is probably 2 kHz.** DA4-L: "1K/2K(default)/4K/8K/16KHz". The DA1, DA4-D, DA4-T and DA4-WPS manuals say the same. The DA5-L manual states no default.
- **Higher PWM frequency has a cost.** DA4-L: "Higher PWM frequency, will cause lower output current, higher power noise, but more suitable for camera (No flickers for video)."
- **A button factory reset exists on the DA4-L** ("Long press both buttons for 2s, restore factory default parameter, display RES"). On the DA5-L the same gesture enters light type setting, and the DA5-L manual lists no factory reset. Do not assume it has one.
- **5C addressing is probably consecutive.** DA4-L in its 4CH type: "CH1 will be DALI address A, CH2 will be DALI address A+1".
- **Skydance DT8 Tc firmware can have configurable Tc limits and a linear curve.** The DP4's menu shows "DimCurve: Log", "MaxLevel: 254", "MinLevel: 1", power-on level 254 in its DT8 mode, a warmest limit settable from 1000 K to 4000 K and a coolest limit from 5000 K to 8000 K. The LN-150-24-2DA manual says "The default is a logarithmic dimming curve, if you need a linear dimming curve, you can change it through the DALI configuration tool." Whether the DA5-L accepts the same over DALI is not known.
- **Other Skydance drivers reach 0.1%.** The LN-150-24-2DA and the DP4's push dim claim 0.1 to 100%. The DA5-L claims 1 to 100%.

## The 1% floor

The manual's dimming range starts at 1%. On the standard logarithmic curve, 1% output is arc level 85 or 86 (level = 1 + 253 × log10(output% ÷ 0.1) ÷ 3, see `dali.md`). If the driver reports that as its PHYSICAL MINIMUM, then:

- Arc levels 1 to 84 do not exist on this driver. A DAPC to any of them gives the minimum level.
- The dimmest the bench can go is about 1% of each tape's full output. For night lighting that is a real limit: 1% of an 18 W/m tunable-white tape in a hallway is still a visible amount of light (see `optics.md` for the lux estimate).
- A slow fade from off starts with a jump from nothing to 1%.

This is an inference from one line of a table, and the certified product may report a lower physical minimum. It is the first thing to read on hardware day. If it holds, the options are a different driver for night scenes, a lower-output tape, or a denser diffuser, and that is a decision for the owner, so it is repeated in `SUMMARY.md`.

## PWM steps at 16 kHz

Neither manual gives a PWM resolution. The question matters because the lowest arc levels are close together in output: on the logarithmic curve each step is about 2.8%, so level 86 is about 1.02% and level 85 about 0.99%. That step is about 1 part in 3,700 of full output. At 16 kHz one period is 62.5 µs, so showing it needs about 17 ns of timer resolution, which means a timer clock of about 60 MHz or more. A cheaper design would have fewer steps at FA than at F1, and slow fades at the bottom would move in visible jumps.

A 1% floor would be one way a designer hides coarse PWM, which makes the two unknowns likely to be linked. The measurement on hardware day: at FA, step DAPC one level at a time from the physical minimum upward with a lux meter fixed against the tape, and count the distinct readings. Repeat at F1 or F2. If FA is coarse and F2 is fine, the PWM setting becomes a choice between camera-safe output and smooth low-level fades.

## Unknowns

Command names are python-dali's. DT8 queries need `EnableDeviceType(8)` first.

| Unknown                                          | Why the simulator or the app cares                                                                            | What settles it                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour types in C2                               | Whether Tc commands work on driver A at all                                                                   | `QueryColourTypeFeatures` on address 0: the "Tc capable" bit and the RGBWAF channel count. Then `QueryColourStatus` after a Tc activate.                                                     |
| Colour types in C5                               | How to drive the two whites on driver B                                                                       | `QueryColourTypeFeatures` on address 1: RGBWAF channel count (5 expected if the whites are W and A), and the "Tc capable" and "xy capable" bits.                                             |
| Channel to colour mapping in C5                  | Which RGBWAF channel is warm and which is cool                                                                | `QueryAssignedColour` with DTR0 = 0 to 5, then light one channel at a time and look.                                                                                                         |
| Device types reported                            | Whether it answers as DT6, DT8 or both                                                                        | `QueryDeviceType`, and `QueryNextDeviceType` if the answer is 255.                                                                                                                           |
| Physical minimum                                 | The dimmest possible level, and where fades from off start                                                    | `QueryPhysicalMinimum`, then `QueryMinLevel`.                                                                                                                                                |
| Tc limits in C2                                  | The range of the colour temperature slider, and clamping                                                      | `QueryColourValue` with DTR0 = 128, 129, 130 and 131 (coolest, physical coolest, warmest, physical warmest).                                                                                 |
| Whether Tc limits can be stored                  | Matching the driver to the 2700 to 6500 K tape                                                                | `StoreColourTemperatureTcLimit`, then read back.                                                                                                                                             |
| Tc mixing law                                    | Whether brightness holds steady as colour temperature changes                                                 | Lux meter at a fixed arc level while stepping Tc from warmest to coolest. Constant lux means the two channels sum to a constant. A hump in the middle means both channels run high together. |
| RGBWAF scaling under arc level                   | Whether a channel level of 127 means half the duty or half the log range, and how the arc level multiplies it | Lux meter on one channel: sweep the channel level at arc level 254, then sweep the arc level with the channel at 254.                                                                        |
| RGBWAF control default                           | Channel control or colour control, and which channels are linked                                              | `QueryRBGWAFControl`.                                                                                                                                                                        |
| Automatic activation                             | Whether a DAPC applies a pending temporary colour                                                             | `QueryGearFeaturesStatus`, bit 0.                                                                                                                                                            |
| Colour fade                                      | Whether a colour change follows the fade time                                                                 | Set a 4 s fade, activate a new colour and watch. `QueryStatus` bit 4 (fade running) during it.                                                                                               |
| Fade from off                                    | Whether a fade from 0 starts at the minimum level at once, and any soft start                                 | Set a long fade, send a DAPC from off and time it.                                                                                                                                           |
| Extended fade time                               | Fades up to 16 minutes in one command                                                                         | `QueryExtendedFadeTime` after `SetExtendedFadeTime`. Part 102 v2.0 certification implies it is there.                                                                                        |
| Power-on and system-failure defaults             | The gear safety profile (S1)                                                                                  | `QueryPowerOnLevel`, `QuerySystemFailureLevel`, and the DT8 power-on colour through `QueryColourValue`. Expect 254 for both levels.                                                          |
| Linear dimming curve                             | Whether part 207's curve selection is honoured                                                                | `QueryDimmingCurve`, then `SelectDimmingCurve` with DTR0 = 1 and read back. The app should leave it logarithmic.                                                                             |
| Fast fade time                                   | Fades shorter than 0.7 s                                                                                      | `QueryMinFastFadeTime` and `QueryFastFadeTime` (device type 6).                                                                                                                              |
| PWM steps at FA                                  | Smoothness of slow dim fades                                                                                  | The lux meter step count described above.                                                                                                                                                    |
| Firmware and hardware version on the bench units | Whether they match the certified 2.0                                                                          | Memory bank 0, read with `ReadMemoryLocation`. Also `QueryVersionNumber` and `QueryExtendedVersionNumber` for device types 6 and 8.                                                          |
| Default light type and PWM frequency             | What a unit does after a factory reset                                                                        | Not settable by DALI as far as the manuals show. Note the display after any reset.                                                                                                           |
| Behaviour of RESET                               | Whether it changes light type, PWM or address (it should not)                                                 | Send it once on the bench with the tapes covered or the supply current limited, then re-read everything. RESET is blocked by default in the app.                                             |
| Time from power-up to light                      | Whether the driver flashes at full output before a power-on level of 0 applies                                | Power-cycle with POWER ON LEVEL set to 0 and watch. The DiiA listing does not tick "time to first light under 500 ms".                                                                       |

## Simulator profile defaults until hardware day

Each is a setting on the profile, not a constant in the code.

| Setting                                         | Default                                                                                  | Basis                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Physical minimum                                | 85 (about 1%)                                                                            | The manual's "1 -100%" range on the standard curve. A second profile value of 1 stays selectable.     |
| Dimming curve                                   | Logarithmic                                                                              | Both manuals.                                                                                         |
| C2 presentation                                 | Tc, with an RGBWAF (two linked channels) alternative                                     | The manual's "DT8-TC" against the DiiA listing.                                                       |
| C5 presentation                                 | RGBWAF with five channels, W as warm and A as cool, with a "Tc beside RGB" alternative   | The DiiA listing and the label order R, G, B, WW, CW.                                                 |
| Tc limits in C2                                 | Unknown. Use 2700 to 6500 K (370 to 154 mirek) to match tape A, flagged as a placeholder | No source. The tape's range is the only number available.                                             |
| Tc mixing                                       | Linear cross-fade at constant total duty, flagged as a placeholder                       | No source. It is the simplest law, and the alternative is a profile option.                           |
| Power-on level, system failure level, max level | 254, 254, 254                                                                            | DALI defaults (see `dali.md`), and the DP4 and DA-12A-2 manuals show the same on other Skydance gear. |
| PWM steps at FA                                 | Unlimited (no quantisation), with an option to quantise                                  | Unknown. Quantising by default would be a guess.                                                      |

## Hardware-day list

1. Before anything else, read both drivers: device types, colour type features, assigned colours, physical minimum, min and max level, power-on and system-failure levels, Tc limits, fade time and rate, extended fade time, gear features, version numbers and memory bank 0.
2. Record what the display shows in each light type, and the default PWM setting if a unit is ever reset.
3. Run the first-light steps. If step 5 or 6 does nothing on driver A, C2 is not Tc: switch the app's C2 profile and re-run.
4. Lux meter sweeps: level steps at the bottom of the range at FA and at F2, the Tc sweep at a fixed level, and the single-channel RGBWAF sweeps.
5. Time a fade from off, a colour fade and an extended fade.
6. Power-cycle with the safety profile written, and watch for any flash before the power-on level applies.
7. Work through part 8 of the checklist in `docs/TEST_PLAN.md` section 10: the read-backs, timings and faults the rate guard's hardware rules wait on (ADR 0019). They include the colour and the temporary colour as read back, the fade-running bit during a colour fade, whether a fade setting is always taken, how long each fade time runs, and what a colour change does at fade time 0.
