# Optics: tapes, diffusers, finishes and details

Research for Stage 1, read on 13 and 14 November 2026. It gathers the numbers the visualiser needs: what the tapes emit, what diffusers and profiles do to it, how the hallway's surfaces reflect it, and real dimensions for the mounts in R11. Suppliers and practice are Australian where sources exist.

"Confirmed" means read in the cited page or PDF. "Typical" means taken from a comparable product, not from the tape's own datasheet. "Estimate" means our arithmetic. Several numbers the visualiser needs are not published at all, and the last section says how to measure each.

## Summary

- Tape A's datasheet gives no lumens. The visualiser needs a placeholder until the tape is measured or Linear Lux supplies an IES file.
- Tape B is a low-output tape: about 1,100 lm/m with every channel on, and its red is weak. Its datasheet contradicts itself in places.
- Linear Lux's opal cover passes 30 to 40%, much less than the 45 to 75% other makers quote for opal.
- Two Linear Lux profile pages recommend at most 14 W/m. All three tapes exceed that at full output.
- A standard 10 mm plasterboard shadowline is too small to hold a tape. A lit shadowline is a purpose-made plaster-in profile or a framed recess.
- No sourced lux target for domestic night lighting was found. The app should present its night levels as a design choice.

## 1. The tapes

### Tape A: LLCCT-120-24-IP20-5M, tunable white

From the Linear Lux CCT technical data sheet (https://linearlux.com.au/wp-content/uploads/2026/08/Linear-Lux-Series-CCT-TDS.pdf, issue August 2026) and the product page (https://linearlux.com.au/product/tuneable-white-cct-led-strip/).

| Item                                 | Value                                                                        | Status                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Power                                | 18 W/m, 0.75 A/m at 24 V, both channels together                             | Confirmed                                                                                     |
| LEDs                                 | 120 per metre, "Separate warm and cool SMD LEDs"                             | Confirmed                                                                                     |
| Pitch                                | 8.33 mm between LEDs. 16.67 mm between LEDs of one colour, if they alternate | Derived. The alternation is the brief's statement and the sheet's diagram is "representative" |
| Colour temperature                   | 2700 to 6500 K                                                               | Confirmed                                                                                     |
| CRI                                  | "Ra >90 for stocked white-light products"                                    | Confirmed                                                                                     |
| Beam                                 | "120 degrees nominal"                                                        | Confirmed                                                                                     |
| Cut length                           | 50 mm                                                                        | Confirmed                                                                                     |
| Width                                | "10 mm typical; confirm exact SKU"                                           | Nominal                                                                                       |
| Lumens per metre                     | Not stated. "OUTPUT: CCT and channel-balance dependent"                      | Gap                                                                                           |
| Power per channel                    | Not stated. 9 W/m each is the natural reading                                | Not confirmed                                                                                 |
| LED package, PCB colour, maximum run | Not stated                                                                   | Gap                                                                                           |
| Mounting                             | "Approved aluminium profile required"                                        | Confirmed                                                                                     |

Placeholder for lumens: the COB sibling on the same sheet is planned at 100 lm/W. At that efficacy tape A gives about 1,800 lm/m with both channels on, about 900 lm/m per channel. This is an estimate from another product's planning figure. Linear Lux says an IES file is "available on request", and asking for it is the cheapest way to replace the placeholder.

### Tape B: LL50-060-24-RGBCCT-IP20-5M

From its technical data sheet (https://linearlux.com.au/wp-content/uploads/2023/12/LL50-060-RGBCCT-XX-Technical-Data.pdf, issue V1.0, January 2022).

| Item                    | Value                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| Power                   | 24 W/m, 1.0 A/m at 24 V                                                 |
| LEDs                    | 60 per metre, 5050 package, pitch 16.67 mm                              |
| Luminous flux per metre | 50 lm red, 270 lm green, 38 lm blue, 342 lm at 2900 K, 396 lm at 6000 K |
| Whites                  | "2900°K~6000°K"                                                         |
| CRI                     | Ra >90                                                                  |
| Beam                    | 120°                                                                    |
| Dimming                 | 1 to 100%                                                               |
| Size                    | 12.0 mm wide, cut every 100 mm                                          |
| Maximum run             | 10 m at 24 V                                                            |
| Pads                    | +24 V, R, G, WW, SW, B                                                  |

Points to treat with care:

- All five channels together give 1,096 lm/m, about 46 lm/W. The two whites give 738 lm/m. This is far below the 2,000 lm/m and more of a single-colour 24 W/m tape.
- Red is weak against green: the ratio of red to green to blue is 1 : 5.4 : 0.76. Other makers' 5050 RGB packages give about 1 : 1.4 to 2.5 : 0.4 to 0.7 (section 1.4). Either the red is under-driven on this tape or the figures are loose.
- The sheet says "5050 4Chip RGB CW+WW" and "Quantity of chips per LED: 4", but a package with red, green, blue and two whites has five. It also mentions "180 LEDs per metre", which contradicts 60. Text seems to have been carried over from another sheet.
- The whites disagree between sources. The sheet says 2900 to 6000 K. The web page says "approximately 2400 to 6000 K, by SKU" (https://linearlux.com.au/product/ll50-060-24-rgbcct-ip20-5m/). The brief says 2400 to 6500 K. The reel label or a colour meter settles it.
- Power per channel is not given, and neither is any chromaticity for red, green or blue.

### The COB alternative: LLCOB-608-24-CCT

From the same CCT sheet: "Dotless COB", 22 W/m, 0.92 A/m, 608 chips per metre (a pitch of 1.64 mm), 26.31 mm cut, "Continuous phosphor light line", and "an estimated 2,200 lm/m planning basis". Two versions: 3000 to 6500 K, and 608W at 2400 to 6000 K. The product URL in the brief says 19.2 W/m and 2400 to 6500 K, which matches neither.

### 1.4 Typical colour values, until measured

None of these is from Linear Lux.

- Dominant wavelengths for 5050 RGB packages: red 620 to 630 nm, green 520 to 530 nm, blue 465 to 475 nm (Yujileds, https://www.yujiintl.com/rgb-5050l/, and a Lumileds 5050 RGBW sheet, https://www.ledyilighting.com/wp-content/uploads/2023/08/LUMILEDS-5050RGBW-0.5W-datasheet.pdf).
- Starting chromaticities derived from those wavelengths (an estimate from standard colorimetry, not from a fetched source): red about (0.70, 0.30), green about (0.17, 0.70), blue about (0.13, 0.06).
- Whites: the black-body locus at the stated colour temperatures. Linear Lux states no tolerance.

All three primaries lie outside sRGB, and red and green lie outside Display P3. `rendering.md` deals with how to show them.

### 1.5 What the numbers mean in a hallway

An estimate, to give the 1% floor in `da5-l.md` and the 40% ceiling some scale. Take a hallway 5 m long, 1.2 m wide and 2.7 m high, with an average reflectance of 0.75. Its surfaces total 45.5 m². For a closed room of matte surfaces, the mean illuminance over all surfaces is flux ÷ (area × (1 − reflectance)), the integrating-sphere relation.

| Case                                                        | Flux     | Mean illuminance |
| ----------------------------------------------------------- | -------- | ---------------- |
| Tape A, 5 m, full output, no cover (placeholder 1,800 lm/m) | 9,000 lm | about 790 lux    |
| Tape A at the 40% ceiling                                   | 3,600 lm | about 315 lux    |
| Tape A at 1%, no cover                                      | 90 lm    | about 8 lux      |
| Tape A at 1%, Linear Lux opal (0.35)                        | 32 lm    | about 3 lux      |
| Tape B whites, 5 m, at 1%                                   | 37 lm    | about 3 lux      |
| Tape A at 0.1%, no cover                                    | 9 lm     | about 0.8 lux    |

If the DA5-L's lowest level is 1%, a bare tape A cannot give less than about 8 lux in this hallway. A plug-in night light measured in one study gave 0.015 lux at the eye (section 6). Whether 3 to 8 lux is dim enough for night use is a judgement for the owner and client to make on the bench. The physical minimum is therefore the first thing to read on hardware day. These figures rest on the placeholder flux and a simple model, and could be out by a factor of two.

## 2. Profiles and covers

### What Linear Lux sells

The catalogue lists 92 profiles (https://linearlux.com.au/product-category/led-profile/?type=list). Covers are polycarbonate and come as Clear, Diffused, Opaque (their name for opal) and Black (https://linearlux.com.au/product/ll-prb-sm-1715/).

The 1715 profile's data sheet gives transmission (https://linearlux.com.au/wp-content/uploads/2024/08/LL-PR-SM-1715-V2.pdf): "Clear (100% light transmission)", "Diffused (80~70% light transmission)", "Opal (40~30% light transmission)", and Black with no figure. A clear polycarbonate cover cannot pass 100%: surface reflection alone costs 8 to 10%. Treat that figure as nominal.

Profiles that suit 10 to 12 mm tape, from the pages read:

| Profile        | Type                         | Outside size   | Channel                  | Notes                                                                                                                    |
| -------------- | ---------------------------- | -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| LL-PRB-SM-1715 | Deep surface                 | 17.0 × 16.0 mm | 12.3 mm, tape to 12.0 mm | LED to cover about 11 to 12 mm, scaled from the drawing                                                                  |
| LL-PR-PL-5410  | Shallow plaster-in, trimless | 53.0 × 10.0 mm | 10.3 mm, tape to 10.0 mm | Opaque cover only. Too narrow for tape B (https://linearlux.com.au/product/ll-pr-pl-5410-2/)                             |
| LL-PR-PL-1963  | Plaster-in skirting          | 19.3 × 63.3 mm | 14.3 mm                  | Tape faces down at the floor. Opaque cover only (https://linearlux.com.au/product/1963-plaster-in-skirting-led-profile/) |
| LL-PRB-SM-1208 | Shallow surface              | 12 × 8 mm      | not read                 |                                                                                                                          |
| LL-PRB-RE-2515 | Recessed                     | 25 × 16 mm     | not read                 |                                                                                                                          |
| LL-PR-PL-6725T | Deep plaster-in              | 67 × 26 mm     | not read                 |                                                                                                                          |
| LL-PR-WL-5314  | Recessed wall-wash           | 53 × 14 mm     | not read                 |                                                                                                                          |

Internal depths are not dimensioned on any page read. Calipers settle them.

The two product pages read give "Recommended maximum strip power: 14 W/m". Tape A is 18 W/m, tape B 24 W/m and the COB 22 W/m at full output. With the default ceiling of 40% light output the tapes run well under that, which is one more reason to keep the ceiling. It is worth asking Linear Lux what the limit protects: the LEDs' life or the cover.

### Transmission across the market

Vendors' own figures, none with a test standard:

| Source                                                                                                                                                      | Clear     | Frosted or semi-clear | Opal      | Black     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------- | --------- | --------- |
| Linear Lux 1715 sheet                                                                                                                                       | "100%"    | 70 to 80%             | 30 to 40% | no figure |
| Wired4Signs polycarbonate cover (https://www.wired4signsusa.com/products/polycarbonate-diffuser-for-versalles-inferno-paris-xl-berlin-xl-roma-xl-sophia-xl) | 93%       | 75%                   | 65%       | 30%       |
| Ultra LEDs (https://www.ultraleds.co.uk/diffuser-for-standard-channels-v2-led-aluminium-channels)                                                           |           | 70 to 75%             | 45 to 50% |           |
| Signlite channel guide (https://www.signliteled.com/led-channel-guide/)                                                                                     | 90 to 95% |                       | 70 to 75% | 30 to 45% |

One measured comparison: the same 120 LED/m tape in one profile read 33,739 lux under a clear cover, 27,172 under "50% opal", 23,571 under opal frosted and 8,744 under black (https://www.wired4signsusa.com/blogs/led-technical-blog/led-diffuser-comparison-test-for-sl7-profile). Against clear, that is 0.81, 0.70 and 0.26. Colour temperature moved by less than 50 K, so a cover can be treated as neutral in colour.

Defaults for the visualiser:

| Cover                          | Transmission | Basis                                            |
| ------------------------------ | ------------ | ------------------------------------------------ |
| None                           | 1.00         |                                                  |
| Clear                          | 0.90         | Market figures, not Linear Lux's 100%            |
| Diffused (frosted, semi-clear) | 0.75         | Linear Lux's range and the market agree          |
| Opal, Linear Lux               | 0.35         | Linear Lux's sheet                               |
| Opal, general market           | 0.60         | The spread is 0.45 to 0.75, so this is a setting |
| Black                          | 0.28         | Market figures. Not confirmed for Linear Lux     |

"Opal" needs two entries, because Linear Lux's is about half as transmissive as the others. R12 asks to confirm what Linear Lux sells: clear, diffused, opal and black.

An on-axis lux reading understates what an opal cover passes in total, because the cover also spreads the beam. The visualiser needs total transmission and a spread. No scattering data (haze or half-angle) was found for any cover. Material makers such as Covestro and Röhm publish it for their diffusing grades, and those sheets are the next place to look.

## 3. When dots show

One manufacturer's guide gives a rule: "For dot-free performance with a milky diffuser, channel depth should be equal to or greater than the LED pitch", with 60 LEDs/m needing "16 mm or deeper", 120 LEDs/m "12 mm or deeper", and COB "8-10 mm typically sufficient". It bands profiles as low (7 to 10 mm, "higher risk of visible dots"), standard (12 to 15 mm) and deep (16 mm and more) (https://www.signliteled.com/led-channel-guide/). It is a maker's blog and not a standard, but hobbyist sources give the same rule, and Linear Lux says only "Use profile depth and diffusion to manage visible LED points" (https://linearlux.com.au/wp-content/uploads/2026/08/Linear-Lux-LED-Strip-Selection-Guide-Winter-2026.pdf).

Applying depth at least equal to pitch to the bench tapes is a prediction to check:

| Tape                                         | Pitch that matters | In the 1715 profile (about 11 to 12 mm) with opal                                             | In a shallow 7 to 8 mm profile |
| -------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------ |
| Tape A, both channels on                     | 8.33 mm            | No dots expected                                                                              | Marginal                       |
| Tape A at 2700 K or 6500 K, one channel only | 16.67 mm           | Dots likely                                                                                   | Dots certain                   |
| Tape B                                       | 16.67 mm           | Dots likely, with colour fringes, since the five emitters sit 1 to 2 mm apart in each package | Dots certain                   |
| COB                                          | 1.64 mm            | No dots                                                                                       | No dots                        |

The second row matters for the brief's night lighting. A tunable-white tape at its warmest setting has only its warm LEDs lit, so its effective pitch doubles exactly when the light is dimmest and the eye most sensitive to pattern. The visualiser's close-up camera should show this, and the mixing law in `da5-l.md` decides how far from the ends of the range it persists.

A model for the tape shader: each LED is a small Lambertian source at depth d behind the cover, the cover blurs with a width that depends on its type, and what shows is the ripple in luminance along the line as a function of pitch ÷ d. The blur width per cover is unknown and should be fitted to a photograph of the real profile at fixed exposure.

## 4. Reflectances

Dulux Australia publishes a light reflectance value for each colour:

| Colour                                | LRV | Source                                          |
| ------------------------------------- | --- | ----------------------------------------------- |
| Vivid White (the usual ceiling white) | 94  | https://www.dulux.com.au/colour/vivid-white     |
| Lexicon Quarter                       | 90  | https://www.dulux.com.au/colour/lexicon-quarter |
| Natural White                         | 85  | https://www.dulux.com.au/colour/natural-white   |

LRV is the CIE Y of the colour chip. A painted wall usually reflects a little less than its chip (not sourced).

No maker's figure was found for microcement. A placeholder for a light neutral matte floor is 0.50, in a range of 0.40 to 0.60, and it is a guess. The supplier can give the CIE Y of the chosen colour and sealer.

Defaults for the visualiser's materials, each adjustable as R11 asks:

| Surface | Reflectance | Basis                                                   |
| ------- | ----------- | ------------------------------------------------------- |
| Ceiling | 0.90        | Vivid White at 94, less a margin for an applied surface |
| Walls   | 0.80        | A neutral white at 85, less a margin                    |
| Floor   | 0.50        | Placeholder                                             |

Matte paint is close to Lambertian away from grazing angles. A sealed, trowelled floor lit at a grazing angle from a skirting slot is not: it will show a streak that a purely diffuse model misses. That is the view this visualiser cares about most, so the floor should have a gloss setting, and `rendering.md` has to allow for it.

## 5. Shadowlines, reveals and plaster-in details

### What is sold in Australia

- **Rondo P50 shadowline stopping angle:** "the P50 to allow a 10x10mm recess, up to 16mm board", with a 30 mm perforated leg. It is drawn with the recess in the wall plane below the ceiling, or in the ceiling plane beside the wall (https://www.rondo.com.au/media/2613/exangle-installation-guide.pdf).
- **Shadowline skirting:** Studco's AluBase has "a 90mm skirt to the floor line" and "a distinctive 10 x 10mm shadowline recess", for 10 and 13 mm plasterboard (https://archipro.com.au/article/alubase-shadowline-aluminium-skirting-by-ez-concept-studco).
- **Plaster-in LED profiles:** the Linear Lux range above, and BoscoLighting's TL series, which includes cove profiles for the junction of wall and ceiling (https://archipro.com.au/product/plaster-in-trimless-profiles-for-cove-lighting-boscolighting). The BoscoLighting drawings were not read.

A 10 × 10 mm shadowline cannot hold a 10 mm tape and a profile. The lit shadowline in R11 is therefore a different detail from the standard unlit one: a plaster-in profile, or a recess framed larger than a stopping bead gives. The visualiser should say so in its preset descriptions, since a builder will read "shadowline" as the 10 mm bead.

The Linear Lux 1963 skirting profile is the closest product to R11's down-facing tape. From its drawing (https://linearlux.com.au/wp-content/uploads/2026/10/LL-PR-PL-1963-DWG.png): 63.3 mm high and 19.3 mm deep overall, with a 14.3 mm channel. The tape faces down, with a cover below it, behind an open slot at the base of the wall. Scaled from the drawing, the slot is about 25 mm high and 18 mm deep. The channel takes tape A or tape B.

### Defaults for the mount editor

| Detail                                               | Default                                                                    | Basis                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unlit shadowline, for reference                      | 10 mm high, 10 mm deep                                                     | Rondo P50, AluBase                                                              |
| Lit skirting slot, tape facing down                  | Slot 25 mm high and 19 mm deep at floor level, tape 13 mm behind its cover | Linear Lux 1963, scaled                                                         |
| Lit reveal higher on the wall, tape up, down or both | 30 mm high, 25 mm deep, tape set back 15 mm                                | Not sourced. Sized to hold a 17 × 16 mm profile out of the direct line of sight |
| Flush wall channel                                   | 12 mm lit aperture, cover flush with the plaster, LED to cover 10 to 12 mm | Linear Lux 5410 and 1715                                                        |
| Wall channel height                                  | 600 mm                                                                     | The brief                                                                       |
| Plasterboard                                         | 13 mm                                                                      | Rondo's range                                                                   |

Cove and ceiling-edge dimensions were not found in a dimensioned Australian source. The reveal default in the third row is ours and is marked as such.

## 6. The hallway and light levels

- **Width:** the Livable Housing Design Standard, which NCC 2022 applies to new houses, asks for corridors with "a minimum clear width of 1000 mm" on the entry level. This is confirmed from summaries, not the standard's own text (https://abcb.gov.au/editions/ncc-2022/adopted/volume-two/h-class-1-and-10-buildings/part-h8-livable-housing-design).
- **Height:** NCC 2022 asks for 2.4 m in habitable rooms and allows 2.1 m in a corridor (from search summaries of https://abcb.gov.au/editions/ncc-2022/adopted/volume-one/f-health-and-amenity/part-f5-room-heights).
- **Defaults:** 1.2 m wide (1.0 to 1.5), 2.7 m high (2.4 to 3.0) and 5 m long to match the tapes. The height for high-end homes is not sourced.

Reference levels for the lux readout, with their standing:

| Level          | What                                                                                                                    | Standing                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0.015 lux      | Plug-in night lights, measured at the eye in a study of older adults (https://pmc.ncbi.nlm.nih.gov/articles/PMC3176147) | From a summary of the paper                  |
| 1 to 5 lux     | The night target in this project's planning                                                                             | Not confirmed by any source                  |
| 5 to 10 lux    | Low-level night path lighting                                                                                           | One uncited design page                      |
| 40 lux         | AS/NZS 1680 for movement and orientation                                                                                | Secondary sources. The standard is paywalled |
| 160 to 240 lux | Corridors in commercial buildings (https://www.abcb.gov.au/guide/j7d3-artificial-lighting)                              | Confirmed, but not a figure for houses       |

The same study found that night lights with luminous lines outlining the path worked as well as high ambient light, and night lights alone worked worst. A continuous low line of light along the floor edge is the form with evidence behind it, and it is what the skirting slot gives.

## 7. Unknowns and how to settle them

| Unknown                                                                      | How                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tape A lumens per channel, LED layout and maximum run                        | Ask Linear Lux for the IES file. Or a lux meter 2 m from a bare 1 m length, per channel: illuminance × distance² gives candela, and flux is about π times that for a 120° emitter |
| Tape B's flux figures, its warm white (2900 or 2400 K) and power per channel | Lux meter per channel, a colour meter, and an ammeter on each channel of a 1 m length                                                                                             |
| Red, green and blue chromaticity                                             | A spectrometer or colorimeter                                                                                                                                                     |
| Cover transmission and spread                                                | Lux meter with the cover on and off at fixed geometry, and a fixed-exposure photograph for the ripple                                                                             |
| Profile internal depth                                                       | Calipers                                                                                                                                                                          |
| Floor reflectance and gloss                                                  | The supplier's CIE Y. Or compare the floor against a Vivid White card lying on it                                                                                                 |
| Wall and ceiling reflectance as applied                                      | The same card method                                                                                                                                                              |
| Cove dimensions, and Australian diffuser figures                             | The BoscoLighting drawings and the other makers' catalogues                                                                                                                       |
| A night lighting target                                                      | No standard was found. Choose one on the bench and record it as a choice                                                                                                          |
