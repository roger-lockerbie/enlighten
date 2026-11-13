# Enlighten: brief

## Purpose

The bench drives two 5 m, 24 V DALI tapes through a hasseb USB DALI Master. It exists to answer one question for a high-end Australian home: what can DALI tunable-white and RGBCCT tape do? On tunable white that means night lighting, long slow fades and scenes. On RGBCCT it means finding out whether subtle colour and brightness cues can replace or reduce addressable pixel tape.

Enlighten lets the owner and his client try those ideas in a simulator and a rendered hallway now, run the same ideas on the real tapes when the hasseb arrives, or run both at once and compare. It is for learning and experimenting with two chosen tapes and one driver. A lighting professional will be engaged when the house is built, and the tapes may change then.

Stage 1's research and the owner's decisions on it are in `docs/research/SUMMARY.md`. This brief was updated to match on 14 November 2026. The client is a capable developer who will read the code and test its security. Treat security as a feature he will try to break.

## The bench

| Part               | Detail                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interface          | hasseb USB DALI Master with integrated bus power. USB HID, vendor 0x04CC, product 0x0802. Not yet delivered.                                     |
| Driver A           | Skydance DA5-L on light type C2 (colour temperature), PWM FA (16 kHz), short address 0, wired to the tunable-white tape's warm and cool outputs. |
| Driver B           | Skydance DA5-L on light type C5 (RGB+CCT), PWM FA, short address 1, all five outputs wired.                                                      |
| Tape A             | Linear Lux LLCCT-120-24-IP20-5M: tunable white, 120 LEDs/m, 18 W/m, 2700 to 6500 K, warm and cool LEDs alternating, about 10 mm wide, white PCB. |
| Tape B             | Linear Lux LL50-060-24-RGBCCT-IP20-5M: RGBCCT, 60 five-in-one LEDs/m, 24 W/m, whites 2400 to 6500 K, 12 mm wide, white PCB.                      |
| Alternative        | Linear Lux LLCOB-608-24-CCT: COB tunable white, 3000 to 6500 K, no visible dots.                                                                 |
| First-light script | `tools/first_light.py`: a python-dali walk-through of both drivers, written for the bench build.                                                 |

The DA5-L has five light types: single colour (C1), colour temperature (C2), RGB (C3), RGBW (C4) and RGB+CCT (C5). Its manual says it uses one DALI address in every type, dims only on the standard logarithmic curve, and offers PWM at 1, 2, 4, 8 and 16 kHz. The DALI Alliance lists it as DALI-2 certified (parts 101, 102, 207 and 209, firmware 2.0). The manual doesn't say how C5 presents the two whites on the bus: as RGBWAF white and amber channels (what `first_light.py` assumes) or as a colour temperature beside RGB. The app finds out with QUERY COLOUR TYPE FEATURES and QUERY ASSIGNED COLOUR, and the simulator offers both until then.

## DALI facts that shape the design

Stage 1 verifies each of these with sources.

- The bus runs at 1200 bit/s. A forward frame takes about 16 ms on the wire, plus settling time, so the bus carries roughly 30 frames a second at most. A DT8 colour change costs six to twelve frames, between a fifth and nearly half a second of bus time per address. Effects have to lean on the drivers' own fades.
- Each driver stores 16 scenes (level, plus colour on DT8) and recalls them with its own fade, so scenes keep working without the app. The hasseb stores nothing.
- Standard fade times come in 15 steps from 0.7 to 90.5 s. DALI-2 gear adds an extended fade from 0.1 s to 16 minutes in one command. Anything longer needs the app to chain steps.
- MAX LEVEL lives in each driver and caps every level it produces, whatever sends the command. That is the driver half of the brightness ceiling (R6).
- By default a driver goes to full output when bus power fails (SYSTEM FAILURE LEVEL 254) and when its supply comes back (POWER ON LEVEL 254), held back only by MAX LEVEL. RESET restores factory values, which sends the light to full output and puts MAX LEVEL back to 254.
- Levels are logarithmic. Arc level 220 is about 40% light output, and arc level 127, half the range, is about 3%. Every control shows light output, with the arc level beside it.
- The hasseb can't hear DALI-2 input devices or other controllers. Switches in this app are virtual, and the app plays the application controller.

## Requirements

R1. Simulator first, hardware later. The output target is Simulator, Hardware or Both, switchable at any time from the top bar. In Both, the simulator mirrors every frame, replies come from the hardware, and differences are logged.

R2. Security comes first, as set out in `CLAUDE.md` and the threat model.

R3. A browser app, with a small local server for the hardware. Stack defaults are under Decisions, to be confirmed or replaced by ADR in Stage 2.

R4. Research DALI's capabilities and build a playground for the outcomes the bench is for. On RGBCCT: subtle, distinguishable effects that could replace or reduce pixel tape. On tunable white: night lighting and scenes.

R5. Tunable-white scenes, such as a fade from off to X% at Y K over Z minutes, saved as scenes. Write scenes into the drivers' 16 slots and recall them, and keep a richer library in the app (named, multi-step, longer than 16 minutes).

R6. A global brightness ceiling, default 40% light output, adjustable, that overrides later requests. DALI supports this through MAX LEVEL, so it is set in the app and in the drivers. It is a comfort feature and a nice-to-have, not a safety control: it should hold on the ordinary paths and need not hold in every edge case.

R7. A console that sends DALI commands and shows decoded replies. Editing and shortcuts behave like zsh: emacs keys, up and down history, Ctrl-R, `history`, `!!`, `!n`, `!-n`, `!prefix`, `!?text?` and `^old^new`. History is persisted, and its length is a preference (default 1000).

R8. One user. Preferences are global and stored locally.

R9. Scripts that run `first_light.py`-style sequences from the console without a general-purpose language: console commands plus `wait`, `pause "message"`, `echo`, comments and a bounded `repeat`. `first_light.py` ships as a built-in script.

R10. A visualiser that shows the 5 m tapes in a rendered hallway. It is a best-effort estimate, to give an idea of how the light might look in different positions. It does not have to represent the light sources or the details of real profiles exactly.

R11. Mounts. On each wall, a horizontal shadowline reveal at an adjustable height can hold an up-facing tape (washing the upper wall and ceiling, cove style), a down-facing tape (washing the lower wall and floor), or both. A flush aluminium channel set into the plaster at an adjustable height (default 600 mm) faces into the hallway. Any combination works, on the left, the right or both, mirrored or set independently. Walls are a neutral matte colour, the ceiling builders' white, and the floor a light neutral matte microcement that diffuses what lands on it. The UI is refined and simple, with presets.

R12. Diffusers: none, plus the range sold in the market (clear, frosted or semi-clear, opal; confirm what Linear Lux sells and each one's transmission), each rendered with its transmission and blur. An A/B view compares two set-ups side by side, for example the same tape with and without a diffuser.

R13. Playground controls distilled from DALI's capabilities into sliders, fields and pickers, so ideas can be prototyped fast.

R14. Both tape types in the playground. In the visualiser, each mount chooses its tape type and binds to a DALI address.

R15. Tape look: 24 V, 10 to 12 mm wide, white PCB, with LED density (60 or 120 per metre) or COB chosen per mount.

R16. Switchgear, after the playground. Emulate 1, 2 and 4 button plates: zencontrol as the DALI-2 plates, with Basalte and Gira as examples of KNX plates that reach DALI through a gateway. Press, double press and hold with the mouse, touch or keyboard, with each provider's behaviour researched, driving the simulator, the hardware or both through the same engine as everything else.

## Safety requirements

S3 and S4 are the safety controls, because flashing light can trigger seizures. S1 and S2 serve the brightness ceiling, which is a comfort feature (R6): they are worth doing well on the ordinary paths and are not critical in every edge case.

S1. Gear safety profile. On connect, after commissioning and after any RESET, write and verify MAX LEVEL (the ceiling), POWER ON LEVEL (off by default), SYSTEM FAILURE LEVEL (255, no change) and a warm default colour on DT8 drivers. Warn on any mismatch.

S2. Every command goes through the governor, including raw frames and DTR-based commands. Covering the ordinary paths matters. Rare edge cases are handled where that is cheap. SET MAX LEVEL, SET SCENE, SET POWER ON LEVEL and SET SYSTEM FAILURE LEVEL all take their value from DTR0, so the governor tracks DTR values.

S3. A rate guard limits how large and how fast luminance changes can be: one swing a second by default, configurable up to three and never beyond. A swing is a rise and fall of 10% or more in light. Going past the default needs an explicit unlock that lasts one session. Panic is never held back by it.

S4. Panic, as in `CLAUDE.md`.

S5. Long sequences keep time while the tab is hidden or the screen sleeps: a worker clock, the Screen Wake Lock while a sequence runs, and drift correction. Plans use the drivers' fades first, so the app is rarely needed mid-fade.

S6. The UI honours `prefers-reduced-motion` and never flashes.

## Decisions

- A browser app with a small local server for hardware. The server is a Python program that uses python-dali to talk to the hasseb. It binds to 127.0.0.1, serves the app and a WebSocket on one fixed port, checks origins and needs a per-session token. The app and the server can run on one computer, or the server can run on the bench computer and be reached from another through an SSH port forward. It never listens on the LAN. The simulator runs in any current browser with no server.
- WebHID straight to the hasseb is an optional second transport, with no server. It needs a Chromium browser, and it only works if Chrome accepts the hasseb's HID descriptor, which is in doubt (`docs/research/hasseb.md`). If it is built, choosing between it and the server is one setting in the app.
- python-dali stays in the project as the reference implementation and the test oracle, generating fixtures at dev time. The hardware server also uses it at run time. It is not part of the browser app. `tools/first_light.py` stays as a standalone check.
- Use the hasseb's 10-byte protocol, as python-dali's `dali/driver/hasseb.py` does: 0xAA header, sequence number, an explicit expect-reply flag and a send-twice delay byte. Don't use the 2-byte protocol in `dali/driver/hid.py`. It relies on the hasseb's internal list of commands that reply, which leaves out DT8 queries, so they hang.
- Default stack: TypeScript (strict), Vite, Svelte 5, three.js used directly, Vitest, fast-check, Playwright and pnpm, with a purpose-built console component rather than a terminal emulator. The framework must run under strict CSP and Trusted Types. Stage 2 proves that with a spike and can replace any part by ADR.
- Visual direction: dark and restrained. A near-black neutral background, one accent colour used sparingly, generous spacing, tabular figures, and monospace only for the console and frames. No gradients, glows or decoration. The light in the visualiser should be the most colourful thing on screen.
- Name: Enlighten, shown as a plain wordmark in the UI font. No logo for now.
- Suppliers and market research favour what is sold in Australia.
- The licence is chosen when the repo goes public.

### Visualiser approach, for Stage 1 to test

Light transport is linear in each emitter's output, and DALI drives each tape evenly along its length. The visualiser can precompute each mount's contribution to the room for a unit white emitter, direct light plus interreflection, for example by radiosity on the matte hallway in a worker. Each frame then combines those contributions, scaled by each tape's current output per channel. Recomputing happens only when geometry or materials change, and DALI changes cost nothing. The tape itself (its dots, the diffuser's blur, the visible line of the wall channel) gets its own shader. Work in photometric units throughout, with fixed exposure presets, a false-colour luminance view and lux readouts, because a screen can't show real luminance.

## Unknowns the build must settle

- How the DA5-L presents C5's whites, its physical minimum level, and how it fades up from off.
- The hasseb's firmware version and its real throughput. Its HID report descriptor matters only if the WebHID transport is built.
- Whether DT8 RGBWAF channel levels scale linearly under the arc level on the DA5-L.
- The DA5-L's colour temperature mixing law: constant lumen or not.
- How many PWM steps the DA5-L has at 16 kHz, which decides whether slow, dim fades step visibly.
- Which browser the client uses.

## Sources to start from

- python-dali: https://github.com/sde1000/python-dali and https://pypi.org/project/python-dali (0.16 at the time of writing)
- python-dali discussion on bus monitoring: https://github.com/sde1000/python-dali/discussions/129
- hasseb USB DALI Master: https://hasseb.fi/shop3/index.php?route=product%2Fproduct&product_id=52
- DA5-L manual: https://linearlux.com.au/wp-content/uploads/2026/09/LL-SD-DA5-L.pdf and https://superlightingled.com/PDF/SKYDANCE/5-Channel-Constant-Voltage-DT6-DT8-DALI-Dimer-for-LED-Strip-DA5-L.pdf
- DA5-L DALI-2 listing: https://www.dali-alliance.org/products/8778/da5-l
- Tapes: https://linearlux.com.au/product/tuneable-white-cct-led-strip/, https://linearlux.com.au/product/ll50-060-24-rgbcct-ip20-5m/ and https://linearlux.com.au/product/flexible-led-strip-light-cob-cct-dual-warm-cool-white-19-2w-m-24v-2400-6500ok-ip20/
- Tape datasheets: https://linearlux.com.au/wp-content/uploads/2026/08/Linear-Lux-Series-CCT-TDS.pdf and https://linearlux.com.au/wp-content/uploads/2023/12/LL50-060-RGBCCT-XX-Technical-Data.pdf
- Linear Lux profiles and diffusers: https://linearlux.com.au/product-category/led-profile/?type=list
- DALI-2 changes: https://www.dali-alliance.org/data/downloadables/5/4/1711_technical-note-dali-2-the-new-standard.pdf
- Beckhoff's public DALI documentation: https://infosys.beckhoff.com/content/1033/tcplclib_tc2_dali/4345805067.html (power control), https://infosys.beckhoff.com/content/1033/tcplclib_tc2_dali/4345793547.html (part 209 colour) and https://infosys.beckhoff.com/content/1033/tcplclib_tc3_dali/5908382347.html (variables and reset values)
- zencontrol switches: https://zencontrol.com/smart-switch/ and https://zencontrol.com/products/dali-switch/
- Gira pushbutton sensor 4: https://rc-partner.gira.com/en/systeme/knx-system/knx-produkte/bediengeraete/tastsensor4.html

## Out of scope

Multiple users, cloud sync, mobile layouts, DALI-2 input-device hardware (the hasseb can't hear it), the pixel tape bench, and drivers other than the DA5-L. Whether the DA5-L dims low enough for night lighting is one of the things the bench is there to find out. If it does not, other drivers are a later piece of work.
