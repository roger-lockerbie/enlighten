# Specification

This is what Enlighten does and how each requirement is judged done. It follows `docs/BRIEF.md` (R1 to R16, S1 to S6) and the owner's decisions in `docs/research/SUMMARY.md`. Where this document and the brief differ, this document is the authority. The reasons for the main choices are in `docs/adr/`.

Each acceptance item has an ID such as R6.2. Section 11 maps every requirement to its items and to the tests in `docs/TEST_PLAN.md`.

Terms: **arc level** is DALI's 0 to 254 level. **Output** is light output as a fraction of the driver's full scale on the standard curve. **Verified** describes an address whose safety profile (S1) has been written and read back. **Transaction** is a short group of frames that must not be split.

## 1. Output targets and devices

**R1. Simulator first, hardware later.**

- R1.1 The top bar has one control with three values: Simulator, Hardware, Both. It can change at any time. Changing it stops running scripts, sequences and effects first, and never sends a level by itself.
- R1.1a The hardware has its own governor state, separate from the simulated bench's. On every change of target to Hardware or Both, and on every connect and reconnect, that state is reset: every address unverified, DTR0 to DTR2 unknown, levels, colours and fades unknown (the rate guard assumes the worst case for each), and the inventory stale, until the scan and the safety profile complete. Nothing learned from the simulator is ever applied to the hardware.
- R1.2 Simulator needs no server and runs in current Chrome, Firefox and Safari.
- R1.3 Hardware and Both are offered only when the page was loaded from the hardware server with a session token. Otherwise they are shown disabled with one line saying how to start the server.
- R1.4 In Hardware and Both, every frame goes to the server, and replies come from the hardware. A shadow simulator follows every frame that was sent, so the governor, the bench preview and the visualiser always have a prediction.
- R1.5 In Both, the shadow's answer to each query is compared with the hardware's, and a slow background check (QUERY ACTUAL LEVEL for each known address, at most one query a second when the bus is idle) compares levels. Every difference goes to a divergence log with the frame, both answers and the time.
- R1.6 The simulator models the DA5-L and nothing else. Each unknown in `docs/research/da5-l.md` and `docs/research/dali.md` section 16 is a profile setting with the researched default, editable on the Devices page and listed in the hardware-day plan. These settings shape the simulated bench only. On Hardware and Both, what a driver can do comes from what it reports, and the rate guard's assumptions about fades come from S3.7, never from a stored or imported setting.
- R1.7 The simulated bus is never faster than 29.1 ms for a command, 42.1 ms for a query and 56.7 ms for a send-twice pair. The defaults are 31.2, 46.7 and 59.4 ms.
- R1.8 If the hardware connection drops, the target falls back to showing "Hardware: disconnected", running work stops, and nothing is sent to the simulator in its place without the user choosing Simulator. The app then treats all gear as off with its state unknown (R1.1a).
- R1.9 A transport fault on a frame (the hasseb did not answer) leaves everything that frame could have changed unknown: the target's level, colour and fade, and any DTR it writes. Running work stops. The frame may have reached the bus, so it is not treated as unsent.

**R14. Both tape types.**

- R14.1 The simulator starts with two devices that match the bench: address 0 as a DA5-L in C2 with tape A, and address 1 as a DA5-L in C5 with tape B.
- R14.2 The visualiser can have up to six mounts. Each mount chooses a tape type and binds to an address. Addresses beyond the bench's two exist in the simulator only, and are marked "simulated only" in Hardware and Both.

**Inventory.**

- D1 A scan finds addresses 0 to 63 with QUERY CONTROL GEAR PRESENT, asks the same of gear without a short address, then reads device types, colour type features, RGBWAF channel count and assigned colours, colour temperature limits, physical minimum, MIN, MAX, power-on and system-failure levels, fade time and rate, extended fade time, the dimming curve, gear features, all 16 scene levels and group membership.
- D2 The app chooses how to drive each address from what it reports: colour temperature commands if the gear is Tc capable, RGBWAF channel control otherwise. It never assumes.
- D3 Commissioning (address assignment) is behind the `reset` unlock and a confirmation that names what will change.

## 2. The app and its security

**R2. Security.** The rules are in `CLAUDE.md` and the threats in `docs/THREAT_MODEL.md`.

- R2.1 The built app makes no request to any origin but its own. An e2e test fails on any cross-origin request, CSP violation or console error on every page of the app.
- R2.2 The production CSP is the one in ADR 0002, with `trusted-types enlighten-worker` and no other policy.
- R2.3 Every imported file and every stored record is validated before use (section 8).
- R2.4 No text from a file, the console, a reply or a device is ever placed in the page except as a text node or an attribute value set by Svelte.

**R3. A browser app with a small local server for hardware.** See ADR 0002 and ADR 0003.

- R3.1 `pnpm start` serves the simulator. `python -m server` serves the same build with hardware, and prints the URL to open.
- R3.2 The app has no setting for a server address.

**R8. One user.**

- R8.1 Preferences are global and stored in IndexedDB. No accounts, and nothing leaves the machine.

## 3. Brightness ceiling and the safety requirements

**R6. A global brightness ceiling.** A comfort feature (ADR 0004).

- R6.1 The ceiling is set as output % and stored as an arc level, rounded down. The default is 40%, which is arc level 220 (39.5%). The control shows both.
- R6.2 Lowering takes effect at once: the governor uses the new value for the next transaction, the app writes MAX LEVEL to every verified address, and it sends a level command to any address whose level or fade target is above the new ceiling.
- R6.3 Raising needs a confirmation that states the old and new values. Scripts, sequences, effects, switches and imports cannot raise it.
- R6.4 The top bar shows the ceiling and, for each address, whether the driver's MAX LEVEL matches it: verified, pending or mismatch.
- R6.5 A ceiling below a driver's physical minimum is refused, with the lowest value that driver can hold.
- R6.6 For RGBWAF gear, arc fraction times the sum of channel fractions is held to the ceiling. This part exists only in the app.

**S1. Gear safety profile.**

- S1.1 On connect, after commissioning and after any RESET, for each address: read PHYSICAL MINIMUM, MIN LEVEL and the dimming curve. If MIN LEVEL is above the ceiling, set it to the physical minimum. Write MAX LEVEL (the ceiling), POWER ON LEVEL 0 and SYSTEM FAILURE LEVEL 255. On DT8 gear, load a warm temporary colour before the power-on write. Read every value back.
- S1.2 An address is verified only when every read-back matches and the curve is standard. Any mismatch is shown against the address with the expected and actual values, and the address stays unverified.
- S1.3 The transport never repeats a configuration frame by itself. A retry is a new transaction through the governor.
- S1.4 The profile's dependence on unconfirmed behaviour (POWER ON LEVEL 0, the stored power-on colour) is in the hardware-day plan, and the UI marks those two lines "not yet confirmed on hardware".

**S2. Every command goes through the governor.**

- S2.1 Only the router (`src/engine/router.ts`) imports a transport's send. Its send takes an approval value that only the governor's `judge` can create, and panic is the one exception. The worker shell constructs transports and hands them to the router, and never sends. Lint enforces the import boundary, and a test proves the rule catches a violation.
- S2.2 The rules in section 5 hold for every source: playground, console, raw frames, scripts, sequences, effects, switches and imports.
- S2.3 The governor tracks DTR0, DTR1 and DTR2, and treats each as unknown after a command that lets gear write it.
- S2.4 A refused transaction is never sent in part. The source gets the reason as text, and the bus monitor shows the refusal.

**S3. Rate guard.** The safety control (ADR 0005).

- S3.1 By default no more than one swing starts in any one-second window, per address and for the room. A swing is two opposite legs. A leg is a maximal monotonic run of a predicted trace, across commands and sources, with a ratio of 1.10 or more between its ends, or one that starts or ends at off. Small steps in one direction add up to one leg.
- S3.1a The guard watches several traces for each address: the drive of each channel, and a luminance estimate that weights the channels by the profile's relative luminance (placeholder weights until measured). A leg on any of them is a leg for the address, so a swap between colours at a constant level counts. The ceiling's mix sum is not used by the guard.
- S3.1b On Hardware and Both, while the inventory is stale or gear without a short address is present, every broadcast, group and unaddressed frame is also judged against a worst-case phantom driver: fade time 0, MAX LEVEL 254, every channel, level unknown. Gear the app has not seen is therefore counted. Indirect level commands to a group or broadcast are refused in that state.
- S3.2 The `rate` unlock lets the limit be set to 2 or 3 for the session, with swing starts at least 360 ms apart. Nothing allows more than 3. On Hardware and Both, if the operator answered on connect that they cannot see the lights, the `rate` unlock is refused for that session.
- S3.3 A hard step is a leg with a ratio above 2, or one that starts or ends at off, made with no fade of 0.7 s or longer. At most one hard step starts in any 2 seconds per address, and one in any second for the room. One broadcast or group frame counts once for the room. No unlock changes this. Ordinary switching on and off is therefore allowed, and hard flashing is held to one change every 2 seconds. Under S3.7 every large change on hardware is a hard step until fades are confirmed.
- S3.4 Changes smaller than a leg are held to three reversals a second, per address and for the room.
- S3.5 A move to or from saturated red counts as a leg.
- S3.6 A repeating pattern faster than one swing in two seconds stops after 5 seconds.
- S3.7 On Hardware and Both, each level or colour command counts as an instant step until both are true: the address's fade time has been read back in this session, and the DA5-L's fade behaviour has been marked confirmed after hardware day. That mark is a constant in the code changed by a reviewed commit, not a setting.
- S3.8 Panic is never delayed or refused by the guard.
- S3.9 The guard judges every transaction by its predicted effect on those traces, whatever kind of command it is. That includes configuration writes that move the output, such as SET MIN LEVEL and SET MAX LEVEL. On Hardware and Both, every behaviour of the driver that is not yet confirmed takes its worst case for the guard: for example, a change to MIN LEVEL or MAX LEVEL is assumed to move the output at once. Panic's OFF is recorded in the guard's history like any other change.
- S3.10 An unlocked RESET is one hard step under S3.3 and a full swing under S3.1, and is further limited to one in any 10 seconds.

**S4. Panic.**

- S4.1 The Panic button is in the top bar on every page and is never covered by a dialog or the console. Dialogs are opened without the browser's modal state, with their own focus trap, so the button stays clickable. The app never uses element fullscreen, and the Permissions-Policy sets `fullscreen=()`.
- S4.2 Escape pressed twice within 500 ms triggers panic from anywhere, including the console and open dialogs. The console command `panic` does the same.
- S4.3 Panic empties the queue, stops every runner, and sends TERMINATE then broadcast OFF. On hardware the OFF is on the bus within 100 ms of the key press when the bus is idle, and after at most the one frame already on the wire when it is busy. Everything queued, in the app and in the server, is dropped and not sent.
- S4.4 After panic the app is latched: nothing is sent until the user chooses Resume. The top bar shows the latch.
- S4.5 If the bus worker does not confirm within 250 ms, the page ends it, which makes the server send OFF.
- S4.6 While the page is visible it sends the bus worker a heartbeat every second. If a visible page misses 3 seconds of heartbeats, the worker stops every runner, because a hung page cannot offer Panic. A hidden page sends none and is not held to this, so long sequences keep running (S5).

**S5. Long sequences keep time.**

- S5.1 Sequences, effects and scripts run in the bus worker on the clock from ADR 0010.
- S5.2 The page holds a Screen Wake Lock while one runs, re-takes it on return to the foreground, and says so if the browser refuses it.
- S5.3 A 30-minute sequence run in a hidden tab ends within 2 seconds of its planned time, with every step sent.
- S5.4 Plans use the drivers' own fades first, so a late wake-up delays the next step and does not distort a fade in progress.

**S6. The UI never flashes.**

- S6.1 No animation changes luminance of a large area faster than once a second. No blinking indicators.
- S6.2 With `prefers-reduced-motion`, transitions are instant and the visualiser's camera moves cut.
- S6.3 The visualiser shows the simulator's output, which the rate guard already limits.

## 4. Features

**R4 and R13. Playground.** Section 4.1 is the capability map.

- R13.1 Each device has a panel with the controls in the map that apply to what the gear reports.
- R13.2 Every level control shows output % and arc level together, and every colour temperature control shows kelvin and mirek. Editing either updates the other.
- R13.3 Two modes. Live: a moving control sends as it moves, coalesced so the newest value is sent as soon as the bus and the rate guard allow, with the standard's DAPC sequence (one DAPC every 200 ms or less) for smooth manual dimming. Commit: nothing is sent until Apply.
- R13.4 The fade picker lists the 15 standard fade times and the extended fade values, shows which the driver will use and why, and marks the gaps in the extended range.
- R13.5 A control that was clamped or refused shows what was sent and the reason beside it.
- R13.6 The bench preview shows both tapes in 2D at their relative brightness and colour from the simulator.
- R13.7 The bus monitor lists each frame with its decoded name, address, source, time, reply and the governor's verdict, and shows bus use as a percentage.

**R4. Effects** (Stage 9).

- R4.1 Built-in effects: breathe, swell and settle, colour temperature drift, hue drift, warm shift, accent tint, two-tone, notification, presence follow and sunrise, with the parameters in `docs/research/effects.md` section 3.
- R4.2 Each effect shows its frames a second per address, and the planner refuses a setting the rate guard would refuse, saying which limit.
- R4.3 Effects can address more devices than the bench has, for the visualiser.

### 4.1 Capability map

| DALI capability                           | What a person wants                           | Control                                                                                |
| ----------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| DAPC and the log curve                    | Set brightness                                | Level slider with % and arc level                                                      |
| OFF, GO TO LAST ACTIVE LEVEL              | On and off, coming back to where it was       | Power toggle                                                                           |
| Fade time, extended fade time             | A smooth change over a chosen time            | Fade picker                                                                            |
| Fade rate, UP, DOWN                       | Hold to dim                                   | Dim up and dim down buttons that repeat while held, and the fade rate in the inspector |
| STEP UP, STEP DOWN                        | Nudge by the smallest step                    | Plus and minus beside the level                                                        |
| MIN LEVEL, PHYSICAL MINIMUM               | Know how dim it can go                        | A marker on the level slider, read from the driver                                     |
| MAX LEVEL                                 | A ceiling that outlasts the app               | The ceiling control (R6)                                                               |
| POWER ON and SYSTEM FAILURE LEVEL         | Stay dark after a power cut or a pulled cable | The safety profile panel (S1), read-only apart from Re-apply                           |
| Scenes 0 to 15                            | Save a look and recall it                     | Scene library with slot map (R5)                                                       |
| Groups 0 to 15                            | Move several tapes as one                     | Group chips on each device, and a group target in every control                        |
| DT8 colour temperature                    | Warm to cool                                  | Colour temperature slider with K and mirek, limits from the driver                     |
| DT8 RGBWAF channels                       | Colour, and the two whites                    | Colour picker with white sliders, and a raw channel view                               |
| Temporary colour and automatic activation | Change colour and level together in one fade  | Automatic: the app loads the colour, then sends the level                              |
| Colour and level in a scene               | A look that includes colour                   | Scene editor                                                                           |
| Queries                                   | See what the driver thinks                    | Device inspector, refreshed on demand                                                  |
| Status bits                               | Know when something is wrong                  | Status line on each device                                                             |
| Driver-run fades up to 16 minutes         | Night lighting that needs no app mid-fade     | Sequence planner (R5)                                                                  |
| Commissioning                             | Give a new driver an address                  | Devices page, behind an unlock                                                         |
| Raw frames                                | Try anything                                  | `raw` in the console, through the governor                                             |

**R5. Scenes and sequences** (Stage 9).

- R5.1 The app keeps a library of named looks per device: level, colour and an optional fade.
- R5.2 A look can be written to one of a driver's 16 slots and read back. The slot map shows which library look is in which slot, and marks slots whose stored value no longer matches.
- R5.3 Recall is by address, group or broadcast. A look with its own fade sets the driver's fade time first.
- R5.4 A sequence is a list of steps (target, level, colour, duration). The planner turns each step into a driver fade where one fits, chains steps where it does not, and shows every frame with its time before anything runs.
- R5.5 Built-in night presets include off to 20% at 2700 K over 25 minutes.
- R5.6 A design exports as CSV and JSON: time, address, command, values, fade.

**R7. Console** (Stage 6). ADR 0006 and section 6.

- R7.1 The emacs keymap, kill ring, undo and incremental search in `docs/research/console.md` sections 1 to 5, with the departures in ADR 0006.
- R7.2 History expansion `!!`, `!n`, `!-n`, `!prefix`, `!?text?` and `^old^new`, shown for confirmation before running.
- R7.3 History persists, 1000 lines by default, set in preferences. `history` lists it and `history -c` clears it after a confirmation.
- R7.4 Every DALI command the core supports can be sent by name, and every reply is shown decoded with its raw byte.
- R7.5 Tab completes commands, addresses, scene numbers and script names.
- R7.6 The console is usable by keyboard alone and announces output to screen readers as a log.

**R9. Scripts** (Stage 6). ADR 0007 and section 7.

- R9.1 A script runs from the console with `run <name>`, shows each step as it runs, waits at `pause` for Enter, and stops on Ctrl-C or panic.
- R9.2 Scripts are stored locally and can be imported and exported as text.
- R9.3 `first-light` is built in and reproduces `tools/first_light.py` within the ceiling.

**R10, R11, R12, R15. Visualiser** (Stages 7 and 8). ADR 0008.

- R10.1 A hallway 5 m long by default, with width 1.0 to 1.5 m (default 1.2) and height 2.4 to 3.0 m (default 2.7), end walls open or closed.
- R10.2 The picture is labelled an estimate. In Hardware and Both it is labelled a prediction.
- R10.3 Exposure presets, manual exposure, white balance, a false-colour view and a probe, as in ADR 0008.
- R10.4 A DALI change shows in the next rendered frame. A geometry or material change shows within 2 seconds for one mount.
- R11.1 Each wall can have a shadowline reveal at an adjustable height with a tape facing up, down or both, and a flush channel at an adjustable height (default 600 mm) facing into the hallway. Left and right are set independently or mirrored.
- R11.2 Mount defaults come from `docs/research/optics.md` section 5, and each default shows whether it is sourced or assumed.
- R11.3 Materials: walls neutral matte, ceiling white, floor light neutral matte, each adjustable by preset and by reflectance.
- R11.4 Presets with small diagrams cover the common set-ups: skirting slot, mid-wall channel, high reveal up, high reveal down, both sides mirrored.
- R12.1 Diffusers: none, clear, frosted, opal (market typical) and opal (Linear Lux), each with a transmission and a blur, from `optics.md` section 2.
- R12.2 An A/B view shows two set-ups side by side, driven by the same devices, with one exposure and one white balance.
- R15.1 Each mount chooses 60 LEDs/m, 120 LEDs/m or COB. A close-up camera shows dots where the diffuser and its distance would show them.
- R15.2 Cameras: eye-level walk, orbit, and presets (down the hall, at the wall, close on the channel).

**R16. Switchgear** (Stage 10). Section 10.

- R16.1 Plates with 1, 2 and 4 buttons, drawn generically with no logos.
- R16.2 Press, double press and hold work with mouse, touch and keyboard.
- R16.3 Every action a plate causes goes through the engine and the governor to the current target, and shows in the console.

## 5. Governor rules

The governor judges each transaction just before it is sent. "Ceiling" is the ceiling's arc level. "Verified" is per address. For a group or broadcast, a rule that needs a verified address needs every known member verified and a fresh inventory.

| Command                                                                                                                                                                                                                                                       | Rule                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAPC n                                                                                                                                                                                                                                                        | Clamp to the ceiling. 0 and 255 pass. On RGBWAF gear, clamp further so the mix rule holds (R6.6). Rate guard.                                                                                                                                                                                 |
| OFF                                                                                                                                                                                                                                                           | Allow. Rate guard, except from panic.                                                                                                                                                                                                                                                         |
| DOWN, STEP DOWN, STEP DOWN AND OFF, RECALL MIN LEVEL, CONTINUOUS DOWN                                                                                                                                                                                         | Allow when verified. Rate guard.                                                                                                                                                                                                                                                              |
| UP, STEP UP, ON AND STEP UP, CONTINUOUS UP, RECALL MAX LEVEL, GO TO LAST ACTIVE LEVEL, GO TO SCENE n                                                                                                                                                          | Allow when verified. Rate guard, using the shadow's prediction of the result.                                                                                                                                                                                                                 |
| ENABLE DAPC SEQUENCE                                                                                                                                                                                                                                          | Allow.                                                                                                                                                                                                                                                                                        |
| DTR0, DTR1, DTR2                                                                                                                                                                                                                                              | Allow, and record the value.                                                                                                                                                                                                                                                                  |
| SET MAX LEVEL                                                                                                                                                                                                                                                 | Refuse if DTR0 is unknown or above the ceiling (255 counts as 254). Only the safety profile and the ceiling control normally send it.                                                                                                                                                         |
| SET MIN LEVEL                                                                                                                                                                                                                                                 | Refuse if DTR0 is unknown or above the ceiling.                                                                                                                                                                                                                                               |
| SET SCENE n, SET SYSTEM FAILURE LEVEL                                                                                                                                                                                                                         | Refuse if DTR0 is unknown, or above the ceiling and not 255. Judge a pending temporary colour by the mix rule.                                                                                                                                                                                |
| SET POWER ON LEVEL                                                                                                                                                                                                                                            | Refuse if DTR0 is unknown, above the ceiling, or 255. Judge a pending temporary colour by the mix rule.                                                                                                                                                                                       |
| SET FADE TIME, SET FADE RATE, SET EXTENDED FADE TIME                                                                                                                                                                                                          | Allow if DTR0 is known. The shadow records the new fade for the rate guard.                                                                                                                                                                                                                   |
| REMOVE FROM SCENE, ADD TO GROUP, REMOVE FROM GROUP                                                                                                                                                                                                            | Allow. Group changes mark the inventory stale.                                                                                                                                                                                                                                                |
| STORE ACTUAL LEVEL IN DTR0, and any query that writes a DTR                                                                                                                                                                                                   | Allow. Mark the registers it can write as unknown.                                                                                                                                                                                                                                            |
| READ MEMORY LOCATION                                                                                                                                                                                                                                          | Allow. Mark DTR0 unknown.                                                                                                                                                                                                                                                                     |
| Queries                                                                                                                                                                                                                                                       | Allow.                                                                                                                                                                                                                                                                                        |
| SET TEMPORARY COLOUR TEMPERATURE                                                                                                                                                                                                                              | Allow if DTR0 and DTR1 are known and the gear reports Tc. The shadow holds the pending colour.                                                                                                                                                                                                |
| SET TEMPORARY RGB DIMLEVEL, SET TEMPORARY WAF DIMLEVEL                                                                                                                                                                                                        | Allow if the registers are known and the gear reports RGBWAF. The shadow holds the pending colour.                                                                                                                                                                                            |
| SET TEMPORARY RGBWAF CONTROL                                                                                                                                                                                                                                  | Allow channel control only. Refuse the other control types.                                                                                                                                                                                                                                   |
| ACTIVATE, and any level command with a colour pending                                                                                                                                                                                                         | Judge the resulting level and colour together by the mix rule. Refuse if it would pass the ceiling. Rate guard.                                                                                                                                                                               |
| Tc STEP COOLER, STEP WARMER, COPY REPORT TO TEMPORARY                                                                                                                                                                                                         | Allow when verified.                                                                                                                                                                                                                                                                          |
| x and y coordinate commands, PRIMARY N commands                                                                                                                                                                                                               | Refuse. The DA5-L is not known to report those colour types, and the simulator has no model for them.                                                                                                                                                                                         |
| STORE COLOUR TEMPERATURE Tc LIMIT, STORE GEAR FEATURES/STATUS                                                                                                                                                                                                 | Allow with the `expert` unlock, with a read-back.                                                                                                                                                                                                                                             |
| RESET                                                                                                                                                                                                                                                         | Refuse without the `reset` unlock. With it: warn that the tape will go to full output, send, wait 300 ms, send OFF, then re-apply the safety profile and read it back. Full output lasts 300 ms plus one frame. A RESET counts as a full swing, and at most one is allowed in any 10 seconds. |
| INITIALISE, RANDOMISE, the search and programming commands, SET SHORT ADDRESS                                                                                                                                                                                 | Refuse without the `reset` unlock. They mark the inventory stale.                                                                                                                                                                                                                             |
| SELECT DIMMING CURVE                                                                                                                                                                                                                                          | Refuse without the `expert` unlock. Afterwards the address is unverified until the curve reads back as standard.                                                                                                                                                                              |
| IDENTIFY DEVICE, the DT6 current protector and fast fade time commands, SET OPERATING MODE, START AUTO CALIBRATION, REFERENCE SYSTEM POWER, ENABLE WRITE MEMORY and memory writes, RESET MEMORY BANK, STORE PRIMARY commands, ASSIGN COLOUR TO LINKED CHANNEL | Refuse always.                                                                                                                                                                                                                                                                                |
| TERMINATE                                                                                                                                                                                                                                                     | Allow.                                                                                                                                                                                                                                                                                        |
| A device type command without ENABLE DEVICE TYPE as the frame before it                                                                                                                                                                                       | Refuse. The engine adds ENABLE DEVICE TYPE inside the transaction, so only raw frames can hit this.                                                                                                                                                                                           |
| A raw frame that does not decode to a supported command                                                                                                                                                                                                       | Refuse.                                                                                                                                                                                                                                                                                       |

The table is default deny: a command it does not name is refused.

Unlocks: `rate`, `reset` and `expert`. Each needs a typed confirmation from a person, lasts until the page reloads, shows in the top bar, and can be dropped with `lock`. A script cannot unlock. A command that needs the `reset` or `expert` unlock is accepted only from a line typed at the console or a control in the UI. From a script, sequence, effect, switch or import it is refused even while the unlock is on.

An unverified address accepts DAPC (clamped), OFF, queries, DTR writes and the safety profile's own writes, and nothing else.

## 6. Console language

A line is a command name, then arguments separated by spaces. Double quotes group a string. `#` starts a comment. Names are case-insensitive. History expansion happens before parsing.

### Addresses

| Form             | Meaning                                             |
| ---------------- | --------------------------------------------------- |
| `0` to `63`      | A short address                                     |
| `g0` to `g15`    | A group                                             |
| `all`            | Broadcast                                           |
| `unaddressed`    | Broadcast to gear without a short address           |
| a name           | An alias set on the Devices page, such as `tw`      |
| `0,1` and `0..3` | A list or a range of short addresses, sent in order |

`use <address>` sets a default, after which the address may be left out. `use` alone clears it.

An alias starts with a letter, is not a command name or keyword, and does not match `g` followed by digits, `all` or `unaddressed`.

### Values

`35%` is output. A bare number is an arc level, or a channel level, 0 to 254. `2700K` is kelvin and `370m` is mirek. Times are `300ms`, `2s`, `25min`.

### Friendly commands

| Command                                           | Does                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `level <addr> <value> [fade <time>]`              | Sets the level, with an optional fade set first                               |
| `off <addr>`, `on <addr>`                         | OFF, and GO TO LAST ACTIVE LEVEL                                              |
| `tc <addr> <temperature> [<value>]`               | Colour temperature, with an optional level in the same fade                   |
| `rgb <addr> <r> <g> <b> [w <n>] [a <n>]`          | Channel levels, or `rgb <addr> #rrggbb`                                       |
| `fade <addr> [<time>]`, `fade <addr> rate <n>`    | Shows or sets the fade. Picks the nearest value the driver has and says which |
| `scene <addr> recall <n>`                         | GO TO SCENE                                                                   |
| `scene <addr> store <n> [<value>]`                | Stores the present or given look in a slot, and reads it back                 |
| `scene <addr> remove <n>`, `scene <addr> list`    | Removes a slot, or lists all 16                                               |
| `group <addr> add <n>`, `group <addr> remove <n>` | Group membership                                                              |
| `query <addr> [<what>]`                           | One value, or a summary of the device                                         |
| `devices`, `scan`                                 | Lists the inventory, or rebuilds it                                           |
| `profile [<addr>]`                                | Shows the safety profile's state, and `profile apply` writes it again         |
| `cap [<value>]`                                   | Shows or sets the ceiling. Raising asks for confirmation                      |
| `target [sim \| hw \| both]`                      | Shows or sets the output target                                               |
| `trace [on \| off]`                               | Shows every frame in the console as it is sent                                |
| `panic`, `resume`                                 | Panic, and release of the latch                                               |
| `unlock <name>`, `lock [<name>]`                  | Session unlocks                                                               |
| `run <script>`, `scripts`                         | Runs a script, or lists them                                                  |
| `history [-c]`, `clear`, `help [<topic>]`         | History, clearing the screen, and help. `help keys` shows the binding table   |
| `echo <text>`, `wait <time>`                      | As in scripts                                                                 |

### DALI commands

Every supported command is available under python-dali's class name in kebab case: `dapc 0 128`, `recall-max-level 0`, `dtr0 220`, `set-max-level 0`, `query-actual-level 0`, `go-to-scene 0 3`, `set-temporary-colour-temperature-tc 0`, `activate 0`. Device type commands get their ENABLE DEVICE TYPE frame added, and send-twice commands are sent twice. Both show in the trace.

`raw <hex> <hex> [x2]` sends one 16-bit frame as given, twice with `x2`. It is judged like any other frame.

### Replies

A query prints the decoded meaning and the raw byte, for example `actual level 170 (10.1%) [0xAA]`. No reply prints `no reply`. A collision prints `framing error (more than one device answered?)`. A transport fault prints as a fault, never as "no reply". A refusal prints `refused:` and the reason.

## 7. Script format

```
script     = { line }
line       = [ statement ] [ comment ] newline
comment    = "#" text
statement  = command | wait | pause | echo | repeat | end
wait       = "wait" time
pause      = "pause" [ string ]
echo       = "echo" string
repeat     = "repeat" count        ; count is 1 to 1000
end        = "end"
command    = any console command except those listed below
```

Not allowed in a script: `unlock`, `lock`, `target`, `run`, `history`, `clear`, `use`, `resume`, and `cap` with a value above the present ceiling. Limits are in ADR 0007. `pause` shows its message and waits for Enter. A refused step stops the script and reports the line. The built-in `first-light` follows `tools/first_light.py` step for step, using `level` and `tc` and `rgb` so every level is clamped.

## 8. Workspace file

JSON, at most 2 MB, with these top-level keys and no others:

| Key           | Content                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `format`      | `"enlighten-workspace"`                                                                                           |
| `version`     | An integer. Files newer than the app are refused. Older files are migrated                                        |
| `ceiling`     | An arc level, 1 to 254. Applied only if lower than the present ceiling                                            |
| `preferences` | History length, the leading-space rule, verify mode, exposure and white balance defaults, reduced motion override |
| `devices`     | Up to 64: address, alias, light type, and the simulator profile settings                                          |
| `looks`       | Up to 200: name, level, colour, fade                                                                              |
| `slots`       | Per address, which look is in which of the 16 slots                                                               |
| `sequences`   | Up to 100: name and up to 500 steps                                                                               |
| `effects`     | Up to 100: type and parameters                                                                                    |
| `scripts`     | Up to 100: name and text, each within the script limits                                                           |
| `hallway`     | Dimensions, end walls, materials                                                                                  |
| `mounts`      | Up to 6: side, kind, height, direction, tape type, density, diffuser, depth, length, address                      |
| `plates`      | Up to 16: provider preset, buttons, mapping, timers                                                               |

Names are at most 60 characters. Numbers have ranges. Enumerations are closed. Validation follows ADR 0009. An import replaces the library and set-up after a confirmation that lists what will change, and never sends a frame. Imported preferences cannot turn off verify mode or override reduced motion: those two apply only when they make the app more careful. Simulator profile settings in `devices` apply to the simulated bench only (R1.6).

Version 1, from Stage 5, carries `format`, `version`, `ceiling`, `preferences` (the playground's Live or Commit mode, and reduced motion) and `devices` (address, alias, how the simulated unit presents colour, and its settings). Each later key arrives with the stage that builds its feature, a new version and a migration. Until then a file that carries one is refused, naming the key (ADR 0013).

## 9. Server protocol

One WebSocket at `/bus`. Binary messages only. Every message starts with a type byte. A message of the wrong length or an unknown type closes the connection.

Client to server:

| Type | Name  | Body                                                                                      |
| ---- | ----- | ----------------------------------------------------------------------------------------- |
| 0x01 | HELLO | Protocol version (1 byte), token (32 bytes). Must be the first message, within 1 second   |
| 0x02 | SEND  | Sequence (2 bytes), flags (1 byte: bit 0 expect reply, bit 1 send twice), frame (2 bytes) |
| 0x03 | PING  | None. Sent every second                                                                   |
| 0x04 | PANIC | None. The server drops everything queued, then sends TERMINATE and broadcast OFF          |

Server to client:

| Type | Name    | Body                                                                                                                  |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| 0x81 | WELCOME | Protocol version, hasseb firmware major and minor, whether a hasseb is attached, and a fresh session token (32 bytes) |
| 0x82 | RESULT  | Sequence (2 bytes), status (1 byte), data (1 byte)                                                                    |
| 0x83 | DEVICE  | 1 when the hasseb is attached, 0 when it is not                                                                       |
| 0x84 | STOPPED | TERMINATE's status, then OFF's status (RESULT status codes). Sent after every stop while the client is connected      |
| 0x8F | CLOSE   | A reason code, then the server closes                                                                                 |

Encoding: integers are big-endian. Message lengths are HELLO 34, SEND 6, PING 1, PANIC 1, WELCOME 37, RESULT 5, DEVICE 2, STOPPED 3 and CLOSE 2 bytes. The protocol version is 1. The client picks the SEND sequence (0 to 65535, wrapping) and RESULT echoes it. RESULT data is 0 unless the status is 2. A SEND with any flag bit but bits 0 and 1 set is a protocol error. The token is 32 random bytes: the printed URL carries it as 64 lowercase hex characters, and HELLO and WELCOME carry the raw bytes. WELCOME gives firmware 0.0 when no hasseb is attached.

CLOSE reasons: 1 silence for 3 seconds, 2 protocol error (wrong length, unknown type, bad flags, wrong version, a second HELLO), 3 the server is stopping, 4 not authorised (a bad or reused token, or no HELLO within 1 second), 5 another client holds the session.

RESULT status: 0 sent with no reply expected, 1 no reply from gear, 2 reply (data is the byte), 3 framing error, 4 the hasseb did not answer in time, 5 refused (flags did not match the server's own decoding, or the frame is not a known command), 6 dropped (queued when a stop happened, and not sent).

The server sends one frame at a time and waits for its report or a timeout before the next. It accepts at most 8 queued SEND messages and refuses more. The hasseb timeout is 250 ms.

The stop is the same in every case: drop the queue, answering each queued SEND with status 6, let the frame already on the hasseb finish (its report or the timeout) so frames stay in order, then send TERMINATE and broadcast OFF, then STOPPED. After a PANIC the session stays open. It happens on PANIC, on close, on 3 seconds without a message, and on exit (SIGINT, SIGTERM and SIGHUP). After a stop for silence the server sends CLOSE with the reason and closes. The app keeps sending PING while it is latched after panic.

The token in the printed URL works once. WELCOME carries a fresh token for reconnects in the same page, held in the bus worker's memory, and the server refuses the URL token from then on. A reload needs the server's URL printed again, which the server does on request from its terminal.

Only a connection that has passed HELLO holds the one client slot. A missing or `null` Origin is refused. HTTP serves GET only. A request with a `Service-Worker` header gets 404 and `Clear-Site-Data: "storage"`. The app registers no service worker, so such a request means a foreign one is on the origin. WebSocket compression is off and the maximum message size is 64 bytes. To decode device type commands for the flags check, the server keeps the previous frame it sent.

## 10. Switch behaviour

The app plays the application controller. Each button runs the part 301 event machine on the engine's clock: pressed, released, short press, double press, long press start, repeat and stop, stuck and free. Timer defaults: short 500 ms, double off, repeat 160 ms, stuck 20 s. Timers and the event filter are settings on each plate.

| Preset                 | Plates          | Behaviour                                                                                                                   |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| zencontrol             | 1, 2, 4 buttons | The button types in `docs/research/switchgear.md` section 3: dimmer, memory dimmer, up, down, tunable white, custom, action |
| Generic DALI-2 coupler | 1, 2, 4 buttons | One-button dimming as in section 6 of the research, with the hold direction rule as a setting                               |
| KNX through a gateway  | 1, 2, 4 buttons | Basalte Sentido and Gira layouts as examples, labelled as KNX plates that reach DALI through a gateway                      |

A mapping ties each event on each button to an action: toggle, recall a look or slot, dim up or down while held, warmer or cooler while held, run a sequence, start or stop an effect. Actions are indirect level commands, so a plate bound to an unverified address does nothing and says why. Each plate has LED feedback modes from the research: off, on when the target is on, on when it is off, always on.

## 11. Traceability

Test IDs are defined in `docs/TEST_PLAN.md`.

| Requirement | Spec items                  | Tests                                                      |
| ----------- | --------------------------- | ---------------------------------------------------------- |
| R1          | R1.1 to R1.8, D1 to D3      | U-sim, U-bus, U-engine, P-sched, E-modes, E-server, H      |
| R2          | R2.1 to R2.4                | E-csp, U-headers, L-sinks, P-validator, E-import           |
| R3          | R3.1, R3.2                  | E-csp, E-server, U-server                                  |
| R4          | R4.1 to R4.3, R13 items     | U-engine, P-rate, E-effects                                |
| R5          | R5.1 to R5.6                | U-engine, P-plan, E-sequence                               |
| R6          | R6.1 to R6.6, section 5     | U-safety, P-ceiling, M-safety, E-ceiling, H                |
| R7          | R7.1 to R7.6, section 6     | U-console, P-history, E-console, E-keys                    |
| R8          | R8.1                        | U-store, E-shell                                           |
| R9          | R9.1 to R9.3, section 7     | U-script, P-parser, E-script                               |
| R10         | R10.1 to R10.4              | U-light, U-colour, P-light, V-hallway, Perf-frame          |
| R11         | R11.1 to R11.4              | U-light, V-hallway, E-visualiser                           |
| R12         | R12.1, R12.2                | U-light, V-hallway, E-ab                                   |
| R13         | R13.1 to R13.7, section 4.1 | E-playground, U-engine                                     |
| R14         | R14.1, R14.2                | U-sim, E-playground, E-visualiser                          |
| R15         | R15.1, R15.2                | V-hallway                                                  |
| R16         | R16.1 to R16.3, section 10  | U-switch, E-switch                                         |
| S1          | S1.1 to S1.4                | U-safety, U-sim, E-modes, H                                |
| S2          | S2.1 to S2.4, section 5     | L-boundary, U-safety, P-ceiling, P-dtr, G-frames, M-safety |
| S3          | S3.1 to S3.10               | U-safety, P-rate, M-safety, E-playground                   |
| S4          | S4.1 to S4.6                | U-safety, P-panic, E-panic, U-server, H                    |
| S5          | S5.1 to S5.4                | U-engine, E-hidden                                         |
| S6          | S6.1 to S6.3                | E-a11y, V-ui                                               |
