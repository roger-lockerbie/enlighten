# DALI control gear: commands, behaviour and timing

Research for Stage 1, read on 13 and 14 November 2026. This is the reference for the DALI core, the simulator and the governor in Stage 3. It covers IEC 62386 parts 102 (control gear), 207 (LED gear) and 209 (colour control), and the bus timing from part 101.

The IEC texts are paywalled and were not consulted. Frame encodings come from python-dali 0.16. Behaviour and timing come from Beckhoff's public documentation, with Microchip, TI and manufacturers' documents as second sources. Where no public source states a behaviour, it is listed in section 16 as unknown, with a default for the simulator and a bench test.

## Sources

| Key  | Source                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD   | python-dali 0.16, cited as file and line. `gear/general.py` unless another file is named.                                                                                          |
| TC3  | Beckhoff Tc3_DALI (DALI-2), manual 1.22.1 of 9 November 2026: `https://infosys.beckhoff.com/content/1033/tcplclib_tc3_dali/<id>.html`                                              |
| TC2  | Beckhoff Tc2_DALI (older library): `https://infosys.beckhoff.com/content/1033/tcplclib_tc2_dali/<id>.html`                                                                         |
| KL   | Beckhoff KL6811 manual, DALI commands: https://infosys.beckhoff.com/content/1033/kl6811/2214047371.html                                                                            |
| MC   | Microchip TB3200: https://onlinedocs.microchip.com/oxy/GUID-0CDBB4BA-5972-4F58-98B2-3F0408F3E10B-en-US-1/GUID-910C4B97-3A38-4F04-A78A-DF74EE1A3612.html and its DALI Commands page |
| TI   | TI SLAA422A: https://www.ti.com/lit/an/slaa422a/slaa422a.pdf                                                                                                                       |
| LUNA | Lunatone DALI RGBW LED Dimmer DT8 datasheet: https://www.watt24.com/media/da/54/c4/1674737986/86458912_DALI_RGBW_LED_Dimmer_CC_SD2_EN_D0039.pdf                                    |
| DIIA | DALI Alliance note on DALI-2: https://www.dali-alliance.org/data/downloadables/5/4/1711_technical-note-dali-2-the-new-standard.pdf                                                 |

Beckhoff page ids are given in brackets after TC3 or TC2. The DIIA note lists what changed in DALI-2 as headings and contains no numbers.

## 1. Frames and addresses

A forward frame to control gear is 16 bits: an address byte and a data byte (PD `frame.py`, `address.py`).

| Address byte                   | Meaning                                               | python-dali      |
| ------------------------------ | ----------------------------------------------------- | ---------------- |
| `0AAAAAAS`                     | Short address 0 to 63                                 | `address.py:252` |
| `100GGGGS`                     | Group 0 to 15                                         | `address.py:187` |
| `1111110S`                     | Broadcast to gear without a short address             | `address.py:131` |
| `1111111S`                     | Broadcast                                             | `address.py:82`  |
| other `101x xxxx`, `110x xxxx` | Special commands, where the first byte is the command | `general.py:998` |

S is the selector bit. S = 0 means the data byte is a level: direct arc power control, DAPC (`general.py:144`). S = 1 means the data byte is a command number (`general.py:48`).

A reply is an 8-bit backward frame. "Yes" is 0xFF and "no" is silence (MC). Two gear answering at once collide, which the master sees as a framing error. python-dali models that as `BackwardFrameError` (`tests/fakes.py:763`).

Commands for a device type (207 and 209) reuse command numbers 224 to 255. They are accepted only when the frame before them is ENABLE DEVICE TYPE n (`general.py:1256`, and TC2 [4345793547]: they "only work if they are preceded by the Enable Device Type 8 command"). The decoder therefore needs to know the previous frame to name a command, and so does the governor.

## 2. Arc levels and the dimming curve

- Levels 1 to 254 follow a logarithmic curve. Output % = 10^((level − 1) × 3 ÷ 253 − 1), so level 1 is 0.1% and level 254 is 100% (KL, formula read from the page).
- "The difference between successive levels is a constant 2.8%" (TI). The ratio is 10^(3÷253) = 1.0277.
- Level 0 is off. Level 255 in a DAPC is MASK: stop any fade and keep the present level (PD `general.py:144`, TC3 [5627763851]).
- The inverse is level = 1 + (253 ÷ 3) × (log10(output %) + 1).

| Output | Level |     | Level | Output |
| ------ | ----- | --- | ----- | ------ |
| 0.1%   | 1     |     | 85    | 0.99%  |
| 1%     | 85.3  |     | 127   | 3.12%  |
| 10%    | 169.7 |     | 170   | 10.1%  |
| 40%    | 220.4 |     | 220   | 39.5%  |
| 50%    | 228.6 |     | 221   | 40.6%  |
| 100%   | 254   |     | 229   | 50.5%  |

The brief's figures hold: level 220 is about 40% and level 127 about 3%. The default ceiling of 40% is level 220, which gives 39.5%. Level 221 would be 40.6%, so the governor rounds down.

A part 207 driver can be switched to a linear curve (section 12). The curve above then does not apply.

"Light output" here means the driver's output on its own scale. It is not perceived brightness, and for the DA5-L the bottom of the scale may not exist (`da5-l.md`).

## 3. Level limits

Variables and their reset values are from TC3 [5908382347].

- PHYSICAL MINIMUM is fixed by the hardware. MIN LEVEL lies from PHYSICAL MINIMUM to MAX LEVEL. MAX LEVEL lies from MIN LEVEL to 254.
- "The output value is limited within the DALI control gear by the variables minLevel and maxLevel. Exceptions are the output values 0 (OFF) and 255 (MASK)."
- A DAPC above MAX LEVEL gives MAX LEVEL. A DAPC from 1 to below MIN LEVEL gives MIN LEVEL. Either sets the limit error status bit (TC3 [5627763851]).
- SET MAX LEVEL takes DTR0. "If a value smaller than minLevel is specified, the value is set to minLevel. If the value 255 (MASK) is specified, maxLevel is automatically set to 254" (TC3 [5627750411]).
- SET MIN LEVEL takes DTR0. Above MAX LEVEL, or 255, stores MAX LEVEL. Below PHYSICAL MINIMUM stores PHYSICAL MINIMUM (TC3 [5627752331]).
- Scene levels, POWER ON LEVEL and SYSTEM FAILURE LEVEL are stored as given and limited when used, not when stored (TC3 [5627756171] and [5908382347]).

Not confirmed by any public source read: that lowering MAX LEVEL below the present level pulls the output down at once. python-dali's fake gear does pull it down (`tests/fakes.py:228-230`), and it is the expected behaviour, but the governor must not rely on it. After lowering MAX LEVEL the app also sends a DAPC to the new ceiling if the last known level is above it, then reads both back.

## 4. Power-on and system failure

- POWER ON LEVEL: reset value 254. With no command in the first 0.6 s after power-up, the gear goes to this level (TI). In DALI-2, 255 means the last level before power was lost, and 0 means stay off. Values from 1 to 254 are limited by MIN and MAX (TC3 [5908382347]). The older range was 1 to 254 only (TC2 [142757387]), so "off at power-on" is a DALI-2 feature. The DA5-L is certified to part 102 version 2.0, so it should accept 0. Verify by reading it back.
- SYSTEM FAILURE LEVEL: reset value 254. If the bus voltage is missing "for more than 500 ms", the gear goes to this level. "If the variable value is 255 (MASK), the output value does not change." Limited by MIN and MAX (TC3 [5908382347]).
- The power failure status bit stays set until a level command or RESET arrives (TC2 [142757387]).

A manufacturer's factory settings can differ from the reset values. Lunatone ships a DT8 dimmer with POWER ON LEVEL at MASK, fade time 2 and membership of group 0, and says RESET then returns it to the standard's values (LUNA). The simulator needs a factory state per profile, separate from the reset state.

What this means on the bench: if the hasseb is unplugged, the computer sleeps or the bus supply drops for more than half a second, every driver goes to its SYSTEM FAILURE LEVEL. The app cannot act, because there is no bus. Only values already stored in the driver protect the room. That is the purpose of S1: SYSTEM FAILURE LEVEL 255, POWER ON LEVEL 0 and MAX LEVEL at the ceiling.

Not confirmed: whether the output is dark during the first 0.6 s, whether the system failure level is applied without a fade, and what happens when the bus returns. The DiiA listing for the DA5-L does not tick "time to first light under 500 ms".

## 5. RESET

RESET is command 32, sent twice (PD `general.py:350`). "Control gears can take up to 300 ms to execute the DALI command. Only then are further DALI commands executed" (TC3 [5627744651]).

| Variable                         | After RESET                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| Actual level                     | 254                                                                  |
| POWER ON LEVEL                   | 254                                                                  |
| SYSTEM FAILURE LEVEL             | 254                                                                  |
| MIN LEVEL                        | PHYSICAL MINIMUM                                                     |
| MAX LEVEL                        | 254                                                                  |
| Fade rate                        | 7 (44.7 steps a second)                                              |
| Fade time                        | 0 (no fade, or the extended fade time)                               |
| Extended fade time               | base 1, multiplier disabled                                          |
| Short address                    | unchanged                                                            |
| Groups                           | none                                                                 |
| Scenes 0 to 15                   | 255 (not in the scene)                                               |
| DTR0, DTR1, DTR2                 | unchanged                                                            |
| Search and random address        | 0xFFFFFF                                                             |
| Status                           | reset state set; limit error, fade running and power failure cleared |
| DT6 dimming curve                | standard (logarithmic)                                               |
| DT6 fast fade time               | 0                                                                    |
| DT8 temporary and report values  | MASK                                                                 |
| DT8 actual colour                | unchanged                                                            |
| DT8 colour temperature limits    | back to the physical limits                                          |
| DT8 assigned colours             | channel 0 red through channel 5 free colour                          |
| DT8 scene colours                | MASK                                                                 |
| DT8 power-on and failure colours | "manufacturer dependent"                                             |
| DT8 automatic activation         | on                                                                   |

Sources: TC3 [5908382347] and [6424389131], TC2 [1007747723].

RESET takes the light to full output and removes the driver's ceiling in one command, which confirms the brief and the rule in `CLAUDE.md`. Even when it is followed at once by the safety profile, the tape is at 100% for at least 0.3 s plus the frames that follow, about half a second. If RESET is ever unlocked, the app should first warn that this will happen, and afterwards wait 300 ms, write the safety profile and read it back.

Not confirmed: whether the jump to 254 is immediate, and the reset value of the DALI-2 last active level.

## 6. DTRs and commands sent twice

Three data transfer registers are set by special commands, which every gear on the bus hears: DTR0 (`general.py:1092`), DTR1 (`general.py:1265`) and DTR2 (`general.py:1272`). Configuration commands then read them.

| Reads               | Commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTR0                | SET MAX LEVEL, SET MIN LEVEL, SET SYSTEM FAILURE LEVEL, SET POWER ON LEVEL, SET FADE TIME, SET FADE RATE, SET EXTENDED FADE TIME, SET SCENE, SET SHORT ADDRESS, SET OPERATING MODE, RESET MEMORY BANK (`general.py:381-556`). DT6: SELECT DIMMING CURVE and the fast fade time (`gear/led.py:56-74`). DT8: SET TEMPORARY RGBWAF CONTROL, STORE GEAR FEATURES/STATUS, ASSIGN COLOUR TO LINKED CHANNEL, and the selector for QUERY COLOUR VALUE and QUERY ASSIGNED COLOUR (`gear/colour.py`). |
| DTR0 and DTR1       | DT8 16-bit values, low byte in DTR0: colour temperature, x and y (`gear/sequences.py:56-58`). Memory bank access.                                                                                                                                                                                                                                                                                                                                                                           |
| DTR0, DTR1 and DTR2 | SET TEMPORARY RGB DIMLEVEL (red, green, blue) and SET TEMPORARY WAF DIMLEVEL (white, amber, free colour) (`gear/colour.py:166-177`). STORE COLOUR TEMPERATURE Tc LIMIT, with DTR2 choosing the limit.                                                                                                                                                                                                                                                                                       |

STORE ACTUAL LEVEL IN DTR0 (`general.py:360`) writes DTR0 from the gear side. After it, the app cannot know DTR0 without asking. Some queries also change the DTRs: QUERY COLOUR VALUE puts the low byte of its answer in DTR0 (`gear/colour.py:327`), READ MEMORY LOCATION and both WRITE MEMORY LOCATION commands increment DTR0 (`general.py:953` and `1279-1311`), and QUERY LIGHT SOURCE TYPE can fill all three (`general.py:761`).

python-dali's `uses_dtr` flags are not a safe source for the governor's rules. They mark commands that write a register and commands that read one alike, and `QueryColourValue` reads DTR0 without carrying the flag (`gear/colour.py:327-339`). Stage 3 builds its own table of which commands read, write and invalidate each register, from this section.

For the governor (S2): track all three registers, and treat them as unknown after any command that lets gear write them. A command that reads an unknown register is refused until the register has been set again. This is stricter than tracking DTR0 alone, as the brief has it, and DT8 needs it.

### Send twice

"Certain DALI commands must be sent twice within 100 ms (send-twice) without the receiver being allowed to receive another DALI command in the meantime. Only then will the DALI command be recognized as valid" (TC3 [9837733003]).

In python-dali the commands marked `sendtwice` are RESET, STORE ACTUAL LEVEL IN DTR0, SAVE PERSISTENT VARIABLES, SET OPERATING MODE, RESET MEMORY BANK, IDENTIFY DEVICE, every SET command from SET MAX LEVEL to SET SHORT ADDRESS, SET SCENE, REMOVE FROM SCENE, ADD TO GROUP, REMOVE FROM GROUP, ENABLE WRITE MEMORY (`general.py:350-579`), INITIALISE and RANDOMISE (`general.py:1099` and `1154`), the DT6 configuration commands (`gear/led.py:11-15`), and the DT8 store and assign commands (`gear/colour.py:189-231`). That is every configuration command from 32 to 129, plus the configuration subset of 224 to 255.

Not confirmed:

- Whether a frame addressed to other gear between the two copies cancels the pair. Beckhoff's wording suggests it does. The scheduler must never put another frame between the two copies.
- Whether ENABLE DEVICE TYPE has to come before each copy of a device type command. python-dali's hasseb driver sends ENABLE DEVICE TYPE once and lets the firmware repeat the command (`driver/hasseb.py:109-112`), so the bus sees ENABLE DEVICE TYPE, command, command. If the DA5-L wants the other form, DT8 configuration through the hasseb's own send-twice will fail silently. Test with STORE GEAR FEATURES/STATUS and read it back.

Every configuration write is therefore followed by a read-back before the app trusts it. A lowered MAX LEVEL that did not take is the worst case.

## 7. Fades

### Fade time and fade rate

Fade time = 0.5 × √(2^n) seconds and fade rate = 506 ÷ √(2^n) steps a second, for n from 1 to 15 (PD `general.py:456-493`, TC2 [142757387]).

| n   | Fade time (s) | Fade rate (steps/s) |     | n   | Fade time (s) | Fade rate (steps/s) |
| --- | ------------- | ------------------- | --- | --- | ------------- | ------------------- |
| 1   | 0.707         | 357.8               |     | 9   | 11.31         | 22.4                |
| 2   | 1.000         | 253.0               |     | 10  | 16.00         | 15.8                |
| 3   | 1.414         | 178.9               |     | 11  | 22.63         | 11.2                |
| 4   | 2.000         | 126.5               |     | 12  | 32.00         | 7.9                 |
| 5   | 2.828         | 89.4                |     | 13  | 45.25         | 5.6                 |
| 6   | 4.000         | 63.3                |     | 14  | 64.00         | 4.0                 |
| 7   | 5.657         | 44.7                |     | 15  | 90.51         | 2.8                 |
| 8   | 8.000         | 31.6                |     |     |               |                     |

Fade time 0 means no fade, unless a fast or extended fade time is set. Fade rate 0 is not allowed.

### Extended fade time (DALI-2)

SET EXTENDED FADE TIME takes DTR0: bits 3 to 0 are the base and bits 6 to 4 the multiplier. A DTR0 above 0x4F sets both to 0 (PD `general.py:496-510`). The time is (base + 1) × multiplier, with multipliers of 100 ms, 1 s, 10 s and 1 minute for codes 1 to 4, and 0 for none (TC3 [5908382347]: base 1 to 16, range "0 ms to 16 min"). The longest is DTR0 = 0x4F: 16 minutes. QUERY EXTENDED FADE TIME returns the same byte (`general.py:890`).

The usable values are 0.1 to 1.6 s in tenths, 1 to 16 s, 10 to 160 s in tens, and 1 to 16 minutes. Above 160 s the steps are whole minutes, so nothing lies between 160 s and 3 minutes, which matters when a sequence planner picks fades.

### Which time applies

When fade time is 0, the order is: the DT6 fast fade time if it is not 0, otherwise the extended fade time if its multiplier is not 0, otherwise as fast as possible (TC3 [6424389131]). The fast fade time is 25 ms per count, up to 27, and not below the gear's minimum. A count of 27 is 675 ms by that rule, and Beckhoff's table calls it 700 ms. The sources disagree by 25 ms (PD `gear/led.py:66-74` and `210-224`).

| Uses                       | Commands                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Fade time                  | DAPC, GO TO SCENE, GO TO LAST ACTIVE LEVEL (TC3 [5908382347])                                  |
| Fade rate, for 200 ms      | UP, DOWN                                                                                       |
| Fade rate, until the limit | CONTINUOUS UP, CONTINUOUS DOWN, DALI-2 (PD `general.py:313-330`)                               |
| No fade                    | OFF, STEP UP, STEP DOWN, ON AND STEP UP, STEP DOWN AND OFF, RECALL MAX LEVEL, RECALL MIN LEVEL |

- "The new fade time will be used after the reception of the next arc power command. If a new fade time is set during a running fade process, the running fade process is not affected" (PD `general.py:456-473`).
- "If the lamp is switched on, the preheating and ignition times are not included in the fade time" (TC3 [5908382347]).
- ENABLE DAPC SEQUENCE: while DAPCs keep arriving within 200 ms of each other, the gear uses a 200 ms fade whatever the fade time is. An indirect level command ends it (PD `general.py:286-300`, TC2 [142769547]). This is the standard's way to drive a smooth manual dim from a slider: one DAPC every 200 ms or less, each fading into the next.
- DAPC 0 with a fade time: one older source says the gear "dims using the current fade time down to the parameterized MIN value, and then switches off" (KL). The DALI-2 text read says only "is switched off". OFF is always immediate. When off has to be immediate, use OFF.

### Not confirmed

- **Fading up from off.** The expected DALI-2 behaviour is a jump to MIN LEVEL and then a fade to the target over the fade time. No source read states it. With a physical minimum near 1%, that jump would be visible in a dark hallway.
- What a new level command does to a running fade. Expected: the fade stops where it is and the new one starts from there.
- What QUERY ACTUAL LEVEL returns during a fade. Expected: the present level.
- How gear rounds the fractional steps of UP and DOWN. One UP moves 0.2 s × fade rate: 72 steps at rate 1, 8.9 at rate 7 and 0.56 at rate 15.

Each has a bench test in section 16. The simulator makes each a profile setting.

## 8. Level commands

| No.      | Command                 | Behaviour                                                                                                                                 | Source                              |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| n/a      | DAPC level              | Fade to the level over the fade time, within MIN and MAX. 0 is off, 255 is stop and hold. Switches on from off.                           | `general.py:144`, TC3 [5627763851]  |
| 0        | OFF                     | Off at once.                                                                                                                              | `general.py:197`                    |
| 1        | UP                      | Dim up for 200 ms at the fade rate. Stops at MAX. Does not switch on. Re-triggered by a repeat.                                           | `general.py:202`                    |
| 2        | DOWN                    | Dim down for 200 ms. Stops at MIN. Does not switch off.                                                                                   | `general.py:216`                    |
| 3        | STEP UP                 | One level up at once. Not above MAX. Does not switch on.                                                                                  | `general.py:229`                    |
| 4        | STEP DOWN               | One level down at once. Not below MIN. Does not switch off.                                                                               | `general.py:241`                    |
| 5        | RECALL MAX LEVEL        | To MAX at once. Switches on.                                                                                                              | `general.py:252`                    |
| 6        | RECALL MIN LEVEL        | To MIN at once. Switches on.                                                                                                              | `general.py:259`                    |
| 7        | STEP DOWN AND OFF       | One level down. At MIN, switches off.                                                                                                     | `general.py:266`                    |
| 8        | ON AND STEP UP          | One level up. From off, switches on at MIN.                                                                                               | `general.py:276`                    |
| 9        | ENABLE DAPC SEQUENCE    | See section 7.                                                                                                                            | `general.py:286`                    |
| 10       | GO TO LAST ACTIVE LEVEL | DALI-2. From off, fade to the last level that was on. "Directly after applying the supply voltage ... sets the output value to maxLevel." | `general.py:303`, TC3 [11974416139] |
| 11       | CONTINUOUS UP           | DALI-2. Fade to MAX at the fade rate, without stopping after 200 ms.                                                                      | `general.py:313`                    |
| 12       | CONTINUOUS DOWN         | DALI-2. Fade to MIN at the fade rate.                                                                                                     | `general.py:323`                    |
| 16 to 31 | GO TO SCENE n           | Fade to the scene's level. See section 9.                                                                                                 | `general.py:333`                    |

CONTINUOUS UP and CONTINUOUS DOWN are in python-dali and were not in the Beckhoff pages read, so their detail rests on python-dali's docstrings.

## 9. Scenes and groups

- 16 scenes per gear. SET SCENE n stores DTR0 as the level, and 255 means "not in this scene" (`general.py:513`). REMOVE FROM SCENE stores 255 (`general.py:523`). QUERY SCENE LEVEL returns the stored value (`general.py:910`).
- GO TO SCENE fades to the stored level over the fade time, switches on from off, and does nothing if the value is 255 (TC3 [5627780491]). The level is limited by MIN and MAX at recall. A scene stored as 254 under a low MAX LEVEL gives more light if MAX LEVEL is later raised.
- A fade belongs to the gear, not to the scene. To recall a scene with its own fade, the app sets the fade time first, as Stage 9 plans.
- 16 groups. ADD TO GROUP and REMOVE FROM GROUP (`general.py:533-544`). Membership is read as two bytes (`general.py:919-932`).
- On DT8 gear a scene also holds a colour type and value, each with its own MASK. A scene can change colour with the level masked, and the reverse (Ozuno RAPIX APN-010, https://ozuno.com/wp-content/uploads/APN-RAPIX-010-DALI-Colour-Control-with-RAPIX.pdf). Scene recalls fade the colour as well as the level (Dynalite, https://docs.dynalite.com/system-builder/4.43/signal_dimmers/tw_rgbwaf_control.html).

Not confirmed: what SET SCENE stores as the colour. The expected rule is the temporary colour if one is set, and MASK otherwise. The brief's "or the actual colour if no temporary colour is set" could not be confirmed and may be wrong. The same question applies to SET POWER ON LEVEL and SET SYSTEM FAILURE LEVEL, which S1 uses to store a warm default colour. Test before relying on it.

## 10. Queries

| No.           | Query                                                                        | Reply                                                                                                                          | python-dali                    |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 144           | QUERY STATUS                                                                 | Bits 0 to 7: gear failure, lamp failure, lamp on, limit error, fade running, reset state, missing short address, power failure | `general.py:582-611`           |
| 145           | QUERY CONTROL GEAR PRESENT                                                   | Yes or silence                                                                                                                 | `general.py:614`               |
| 146 to 150    | Lamp failure, lamp power on, limit error, reset state, missing short address | Yes or silence                                                                                                                 | `general.py:620-652`           |
| 151           | QUERY VERSION NUMBER                                                         | Memory bank 0, location 0x16                                                                                                   | `general.py:655`               |
| 152, 156, 157 | QUERY CONTENT DTR0, DTR1, DTR2                                               | The register                                                                                                                   | `general.py:668`, `741`, `748` |
| 153           | QUERY DEVICE TYPE                                                            | The type. 254 for none. 255 for more than one, then QUERY NEXT DEVICE TYPE                                                     | `general.py:675-724`           |
| 154           | QUERY PHYSICAL MINIMUM                                                       | Level                                                                                                                          | `general.py:727`               |
| 155           | QUERY POWER FAILURE                                                          | Yes or silence                                                                                                                 | `general.py:733`               |
| 158           | QUERY OPERATING MODE                                                         | Mode                                                                                                                           | `general.py:755`               |
| 159           | QUERY LIGHT SOURCE TYPE                                                      | 6 for LED                                                                                                                      | `general.py:761`               |
| 160           | QUERY ACTUAL LEVEL                                                           | Level. 255 during start-up or on a lamp error                                                                                  | `general.py:796`               |
| 161 to 164    | MAX, MIN, POWER ON and SYSTEM FAILURE LEVEL                                  | Level                                                                                                                          | `general.py:804-825`           |
| 165           | QUERY FADE TIME/FADE RATE                                                    | High four bits time, low four bits rate                                                                                        | `general.py:828-854`           |
| 166           | QUERY MANUFACTURER SPECIFIC MODE                                             | Yes when the operating mode is 0x80 to 0xFF                                                                                    | `general.py:857`               |
| 167           | QUERY NEXT DEVICE TYPE                                                       | Next type, 254 at the end. Valid only straight after 153 or 167                                                                | `general.py:867`               |
| 168           | QUERY EXTENDED FADE TIME                                                     | Bits 6 to 4 multiplier, 3 to 0 base                                                                                            | `general.py:890`               |
| 170           | QUERY CONTROL GEAR FAILURE                                                   | Yes or silence                                                                                                                 | `general.py:900`               |
| 176 to 191    | QUERY SCENE LEVEL n                                                          | Level or 255                                                                                                                   | `general.py:910`               |
| 192, 193      | QUERY GROUPS 0-7, 8-15                                                       | One bit per group                                                                                                              | `general.py:919-932`           |
| 194 to 196    | QUERY RANDOM ADDRESS H, M, L                                                 | Byte                                                                                                                           | `general.py:935-950`           |
| 197           | READ MEMORY LOCATION                                                         | Bank DTR1, location DTR0, then DTR0 + 1                                                                                        | `general.py:953`               |
| 255           | QUERY EXTENDED VERSION NUMBER                                                | After ENABLE DEVICE TYPE n                                                                                                     | `general.py:969`               |

Two corrections to the brief's wording. QUERY DEVICE TYPE answers 255 for several types and 254 for none, not the other way round. And no other frame may come between QUERY DEVICE TYPE and QUERY NEXT DEVICE TYPE, so the scheduler must treat that pair, and the pair QUERY COLOUR VALUE then QUERY CONTENT DTR0, as transactions.

A query to a group or broadcast invites every member to answer at once. The console should allow it and show a collision for what it is.

## 11. Part 209: colour control (DT8)

Command numbers are from PD `gear/colour.py`. All need ENABLE DEVICE TYPE 8 first.

### Colour types

A gear supports one or more of: xy coordinates, colour temperature Tc, primary N, and RGBWAF (up to six channels: red, green, blue, white, amber and free colour). QUERY COLOUR TYPE FEATURES (249) answers: bit 0 xy capable, bit 1 Tc capable, bits 2 to 4 the number of primaries, bits 5 to 7 the number of RGBWAF channels (`gear/colour.py:284-324`). QUERY COLOUR STATUS (248): bit 0 xy out of range, bit 1 Tc out of range, bits 2 and 3 calibration, bits 4 to 7 which colour type is active (`gear/colour.py:261-281`).

### Temporary colour, then activate

A colour change has two stages. First load a temporary colour:

| No.      | Command                                  | Reads                                                             |
| -------- | ---------------------------------------- | ----------------------------------------------------------------- |
| 224, 225 | SET TEMPORARY x-COORDINATE, y-COORDINATE | DTR0 low, DTR1 high, in units of 1/65536                          |
| 231      | SET TEMPORARY COLOUR TEMPERATURE Tc      | DTR0 low, DTR1 high, in mirek. 0 is ignored                       |
| 234      | SET TEMPORARY PRIMARY N DIMLEVEL         | DTR0, DTR1 value, DTR2 the primary                                |
| 235      | SET TEMPORARY RGB DIMLEVEL               | DTR0 red, DTR1 green, DTR2 blue, each 0 to 254, 255 for no change |
| 236      | SET TEMPORARY WAF DIMLEVEL               | DTR0 white, DTR1 amber, DTR2 free colour                          |
| 237      | SET TEMPORARY RGBWAF CONTROL             | DTR0: bits 0 to 5 link channels, bits 7 and 6 the control type    |

Then apply it:

- ACTIVATE (226) "causes the buffered values of the temporary registers to be transferred to the lamp. It ends a running cross-fade and starts a new cross-fade" (TC3 [6424507147]).
- **Automatic activation.** If bit 0 of the gear features is set, "all commands for the control of the lamp power, with the exception of ENABLE DAPC SEQUENCE, must automatically trigger a color transition" (TC2 [1012421771]). It is on after RESET. QUERY GEAR FEATURES/STATUS (247) reads it and STORE GEAR FEATURES/STATUS (243) writes it from DTR0 (`gear/colour.py:222-258`).

Automatic activation has two consequences. A level and a colour can be made to fade together by loading the temporary colour and then sending the DAPC, which also saves the two frames of ENABLE DEVICE TYPE and ACTIVATE. And any level command, from any source, applies whatever temporary colour is pending. The governor must judge the pending colour and the level together.

Colour temperature is in mirek: 1,000,000 ÷ kelvin. 2700 K is 370 and 6500 K is 153.8, which python-dali truncates to 153 (`gear/colour.py:13-25`) and `tools/first_light.py` writes as 154. The app should round to nearest and show the kelvin value the driver will use.

### Colour temperature

- Four limits: coolest, warmest, physical coolest and physical warmest, in mirek. Coolest is the smallest number. Tc is "adjustable in the range between" warmest and coolest (TC3 [6424411531]). python-dali's fake gear clamps a requested Tc to the limits on ACTIVATE (`tests/fakes.py:442-448`).
- STORE COLOUR TEMPERATURE Tc LIMIT (242) takes the value in DTR0 and DTR1 and the limit in DTR2: 0 coolest, 1 warmest, 2 physical coolest, 3 physical warmest (`gear/colour.py:203-219`). The physical limits can be written too.
- COLOUR TEMPERATURE Tc STEP COOLER (232) and STEP WARMER (233) move 1 mirek with no fade, stop at the limits, and work only while Tc is the active colour type (TC2 [1008570635]).

### RGBWAF

- Each channel has a dim level from 0 to 254. RGBWAF CONTROL links channels and sets the control type: 0 channel control, 1 colour control, 2 normalised colour control (`gear/colour.py:342-376`).
- QUERY ASSIGNED COLOUR (252) with DTR0 = channel 0 to 5 answers 0 none, 1 red, 2 green, 3 blue, 4 white, 5 amber, 6 free colour, or 255 for a channel that does not exist (`gear/colour.py:379-427`). The reset assignment is channel 0 red through channel 5 free colour.
- ASSIGN COLOUR TO LINKED CHANNEL (245) changes the assignment, and afterwards "All TEMPORARY COLOUR SETTINGS are set to MASK" (TC2 [1008414859]). The app has no reason to send it.

Not confirmed: how the channel levels combine with the arc level. The usual description is a separate level "(0-254)" that "determines the light intensity" beside six colour values (Dynalite). The expected law is channel output = curve(arc level) × channel level ÷ 254, linear in the channel level. Nothing public states it. This is one of the brief's listed unknowns and it decides how the playground's colour picker maps to frames. `da5-l.md` has the measurement.

### Reading colour

QUERY COLOUR VALUE (250) takes a selector in DTR0, answers the high byte, and leaves the low byte in DTR0, to be read with QUERY CONTENT DTR0. python-dali sends QUERY ACTUAL LEVEL first, as the standard's note asks, to refresh the report values (`gear/sequences.py:90-94`). With the device type frame the hasseb driver adds, one 16-bit read is five frames: three queries and two commands, about a fifth of a second.

| Selector           | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| 0, 1, 2            | x, y, Tc                                                |
| 3 to 8             | Primary N dim level 0 to 5                              |
| 9 to 14            | Red, green, blue, white, amber, free colour dim level   |
| 15                 | RGBWAF CONTROL                                          |
| 64 to 82           | Primary coordinates and the number of primaries         |
| 128, 129, 130, 131 | Tc coolest, physical coolest, warmest, physical warmest |
| 192 to 207         | The temporary values, in the same order as 0 to 15      |
| 208                | Temporary colour type                                   |
| 224 to 239         | The report values, in the same order                    |
| 240                | Report colour type                                      |

Source: `gear/colour.py:28-106`, matching TC2 [1009001483]. Colour type values are 0x10 xy, 0x20 Tc, 0x40 primary N, 0x80 RGBWAF and 0xFF for none.

COPY REPORT TO TEMPORARY (238) copies the report values into the temporary ones.

### Other DT8 commands

- START AUTO CALIBRATION (246): for up to 15 minutes the gear runs its own procedure and ignores everything except TERMINATE, QUERY COLOUR STATUS and itself (TC2 [1012359947]). The governor blocks it.
- STORE TY PRIMARY N, STORE XY COORDINATE PRIMARY N: calibration data. Blocked.

### Not confirmed

- That the temporary values return to MASK after ACTIVATE, and whether they time out.
- That colour changes take the fade time. Three vendors' documents describe colour fading, and none states the rule.
- That a Tc outside the limits is clamped and flagged. python-dali's fake does clamp.
- How power-on, system-failure and scene colours are read back. The expected route is the level query followed by QUERY COLOUR VALUE on the report selectors.

### Frame cost

| Operation                                         | Frames                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Level only                                        | 1 (DAPC)                                                                                                                                           |
| Tc, then ACTIVATE                                 | 6: DTR0, DTR1, ENABLE DEVICE TYPE, SET TEMPORARY Tc, ENABLE DEVICE TYPE, ACTIVATE (`gear/sequences.py:38-60` with the driver's device type frames) |
| Tc with a level, by automatic activation          | 5: DTR0, DTR1, ENABLE DEVICE TYPE, SET TEMPORARY Tc, DAPC                                                                                          |
| RGB and WAF, then ACTIVATE                        | 12, as `tools/first_light.py` does it                                                                                                              |
| RGB and WAF with a level, by automatic activation | 11                                                                                                                                                 |
| RGB only (three channels, others unchanged)       | 6 or 7                                                                                                                                             |

At about 31 ms a frame (section 14) a Tc change takes about 190 ms of bus time and a full RGBWAF change about 370 ms. The brief's "six to twelve frames" is confirmed. Since DTR frames are broadcast, two drivers taking the same colour can share them: address a group and the cost does not double.

## 12. Part 207: LED gear (DT6)

Commands need ENABLE DEVICE TYPE 6 (PD `gear/led.py`).

- SELECT DIMMING CURVE (227): DTR0 = 0 standard, 1 linear, sent twice (`gear/led.py:56-63`). QUERY DIMMING CURVE (238). RESET returns it to standard (TC3 [6424389131]).
- Fast fade time: STORE DTR AS FAST FADE TIME (228), QUERY FAST FADE TIME (253) and QUERY MIN FAST FADE TIME (254), in units of 25 ms up to a count of 27.
- REFERENCE SYSTEM POWER (224): see section 17, item 18. Blocked.
- QUERY GEAR TYPE (237), QUERY POSSIBLE OPERATING MODES (239), QUERY FEATURES (240), QUERY FAILURE STATUS (241), QUERY OPERATING MODE (252), and yes or no queries for short circuit, open circuit, load change and thermal events.

Under the linear curve, arc level 127 is about half output, where the standard curve gives 3%. A ceiling held as an arc level is only a ceiling on light if the curve is pinned. The governor blocks SELECT DIMMING CURVE, and the safety profile checks QUERY DIMMING CURVE on connect.

The DA5-L manual offers only the logarithmic curve, but its part 207 certification means the command may exist (`da5-l.md`).

## 13. Commissioning

python-dali's sequence is the reference (`sequences.py:150-238`).

1. Optionally clear all short addresses: DTR0 = 255, then SET SHORT ADDRESS to broadcast.
2. TERMINATE, then INITIALISE sent twice. Its data byte selects all gear (0), gear without an address (255) or one address. It opens a 15 minute window in which the addressing commands work (`general.py:1099-1151`).
3. RANDOMISE, sent twice. Each gear picks a 24-bit random address. Wait 100 ms.
4. Binary search: set SEARCHADDR H, M and L, then COMPARE. A gear answers yes if its random address is at or below the search address and it has not been withdrawn (`general.py:1162-1170`). A framing error means more than one answered.
5. With the lowest address found: PROGRAM SHORT ADDRESS, VERIFY SHORT ADDRESS, then WITHDRAW so it stops answering.
6. Repeat until COMPARE at 0xFFFFFF gets no answer. If two gear chose the same random address, randomise again.
7. TERMINATE.

A search costs about 24 rounds of three address frames and a query for each gear, so roughly three seconds per gear on the bus.

On the bench both drivers get their addresses from their front panels (`da5-l.md`), so commissioning is not needed for first light. It stays behind a confirmation step as Stage 4 plans, because clearing addresses is destructive and because tools commonly flash gear between MAX and MIN to identify it.

IDENTIFY DEVICE (37) starts a 10 second, manufacturer-defined identification, and is stopped by any command other than INITIALISE, RECALL MIN LEVEL, RECALL MAX LEVEL or itself (`general.py:409-422`). What the DA5-L does is unknown. It may flash to full. Blocked by default.

## 14. Bus timing

From TC3 [12346803211], [12346805131] and [9837733003], with MC as the second source.

- 1200 bits a second, Manchester coded. One bit is 0.833 ms and a half bit 0.417 ms.
- A 16-bit forward frame is a start bit and 16 data bits: 14.2 ms, then a stop condition of at least 2.45 ms. Microchip gives 16.2 ms for the frame with its stop bits, as 39 half bits. A backward frame is 7.5 ms, or 9.95 ms with its stop condition.
- A reply starts "no sooner than 5.5 ms ... and no later than 10.5 ms" after the forward frame (MC). The older rule was 7 to 22 half bits, 2.9 to 9.2 ms (TI).

Settling time before a forward frame, by priority. Beckhoff counts the stop condition inside it.

| Priority | Minimum | Mean    | Maximum | Beckhoff's use                                                                                                   |
| -------- | ------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| 1        | 13.5 ms | 14.1 ms | 14.7 ms | The second frame of a send-twice pair and later frames of a transaction. "must not be used in any other context" |
| 2        | 14.9 ms | 15.5 ms | 16.1 ms | Writing parameters and addressing                                                                                |
| 3        | 16.3 ms | 17.0 ms | 17.7 ms |                                                                                                                  |
| 4        | 17.9 ms | 18.6 ms | 19.3 ms | Everything else                                                                                                  |
| 5        | 19.5 ms | 20.3 ms | 21.2 ms |                                                                                                                  |

Beckhoff's worked totals at priority 3:

| Transaction               | Length  | A second                    |
| ------------------------- | ------- | --------------------------- |
| 16-bit frame, no reply    | 31.2 ms | about 32                    |
| 16-bit frame with a reply | 46.7 ms | about 21                    |
| 16-bit frame sent twice   | 59.4 ms | about 16 (16.8 by division) |

The fastest the standard allows for ordinary frames comes from the priority 2 minimum, since priority 1 is reserved for the later frames of a pair or a transaction: 29.1 ms for a command (34 a second), 42.1 ms for an answered query (23.8 a second) and 56.7 ms for a send-twice pair (the first frame at priority 2 and the second at priority 1). Inside a transaction, later frames may use priority 1: 27.7 ms for a command and 40.7 ms for an answered query. A query with no answer still has to wait out the reply window, so a "no" is not faster than a "yes".

The brief's "roughly 30 frames a second" is confirmed. Queries are slower than the brief implies: about 21 a second.

### For the simulator and scheduler

`CLAUDE.md` says the simulated bus is never faster than the real one. Recommended defaults, each a setting:

- 31.2 ms for a command, 46.7 ms for a query and 59.4 ms for a send-twice pair (Beckhoff's mean figures). The floor that no setting may go below is 29.1, 42.1 and 56.7 ms.
- The real bench will be slower. python-dali waits 20 ms before every hasseb send (`driver/hasseb.py:176`), and each exchange crosses USB twice at an unknown polling interval (`hasseb.md`). Expect 20 to 25 frames a second until measured, and set the simulator's default to the measured figure after hardware day.
- Simulated gear answers 5.5 to 9.2 ms after the frame, which satisfies both the old and new reply windows.
- Gear may ignore commands for 300 ms after RESET and after SAVE PERSISTENT VARIABLES, and for up to 10 s after RESET MEMORY BANK (`general.py:369-406`). After RANDOMISE the new random address is ready within 100 ms (`general.py:1154`), so the sequence waits that long before searching.

## 15. python-dali's fake gear, for Stage 3's differential check

`tests/fakes.py` implements a subset. It is useful where it has a behaviour, and should not be mistaken for a reference where it does not.

It models: DAPC with clamping and MASK, OFF, RECALL MAX and MIN, SET MAX and MIN LEVEL with their limits, the pull-down of the level when MAX is lowered, scenes with clamping at recall, groups, DTR0 to DTR2, short address setting, device type queries with the "nothing in between" rule, random address commissioning, memory banks, and a minimal DT8 colour temperature (temporary Tc, ACTIVATE with clamping, limits and COPY REPORT TO TEMPORARY).

It does not model: fades or time of any kind, UP, DOWN and the step commands, RESET, power-on and system failure, fade time and rate, status bits, the send-twice rule (a single SET MAX LEVEL takes effect, `tests/fakes.py:221`), the ENABLE DEVICE TYPE requirement for DT8 commands (it checks the command's class, `tests/fakes.py:392`), RGBWAF, xy, or the 15 minute INITIALISE timer.

One bug to expect in a differential run: SET MIN LEVEL with DTR0 = 0 stores 0, not 1, because the second `if` at `tests/fakes.py:234` is not an `elif`. The simulator should follow the documented rule (not below PHYSICAL MINIMUM), and the differential check should list this as a known difference. Three more to list: GO TO SCENE with a stored 0 gives MIN LEVEL in the fake, not off (`tests/fakes.py:295-296`). Its QUERY COLOUR VALUE overwrites DTR1 as well as DTR0 (`tests/fakes.py:399-435`). And its SET MIN LEVEL uses 1 as the floor and ignores its own `physical_minimum`.

The differential check is worth having for clamping, scenes, groups, DTRs, addressing and commissioning. For everything in the second list, the oracle is this document and the bench.

## 16. Unknowns, simulator defaults and bench tests

| Unknown                                                                         | Simulator default (a profile setting)            | Bench test                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Lowering MAX LEVEL pulls the level down                                         | Yes, at once                                     | DAPC 200, SET MAX LEVEL 150, then QUERY ACTUAL LEVEL at once and after 2 s. Repeat during a slow fade upward. |
| Raising MIN LEVEL lifts the level                                               | Yes, at once                                     | Level 100, SET MIN LEVEL 150, query.                                                                          |
| Fade up from off                                                                | Jump to MIN, then fade over the fade time        | Fade time 8 s, DAPC 254 from off, QUERY ACTUAL LEVEL every 100 ms, and watch the tape.                        |
| A new command during a fade                                                     | Stops the fade where it is and starts from there | A second DAPC mid-fade, and a DAPC 255 mid-fade.                                                              |
| QUERY ACTUAL LEVEL during a fade                                                | The present level                                | The same log.                                                                                                 |
| DAPC 0 with a fade time                                                         | Fade to MIN over the fade time, then off         | Fade time 4 s, DAPC 0, log.                                                                                   |
| Output in the first 0.6 s after power-up                                        | Off                                              | Power-cycle with POWER ON LEVEL at 0 and at 254, and film it.                                                 |
| System failure: fade or step, and after the bus returns                         | Step, and the level stays                        | Unplug the bus supply for a second, with SYSTEM FAILURE LEVEL at 255 and then at a low level.                 |
| Send twice: does a frame to another address cancel it                           | Yes                                              | SET MAX LEVEL, a DAPC to the other driver, SET MAX LEVEL again within 100 ms, then query.                     |
| ENABLE DEVICE TYPE before each copy of a send-twice DT8 command                 | Accept both forms, and log which arrived         | STORE GEAR FEATURES/STATUS through the hasseb, then read back.                                                |
| Temporary colour after ACTIVATE                                                 | Cleared to MASK                                  | QUERY COLOUR VALUE selector 208 before and after.                                                             |
| Colour fades                                                                    | Use the fade time                                | Fade time 4 s, ACTIVATE a new Tc, watch, and poll QUERY STATUS bit 4.                                         |
| Tc outside the limits                                                           | Clamped, with colour status bit 1 set            | Request 1000 mirek, then read Tc and the status.                                                              |
| What SET SCENE, SET POWER ON LEVEL and SET SYSTEM FAILURE LEVEL store as colour | The temporary colour if set, otherwise MASK      | Store each with and without a temporary colour, change colour, recall or power-cycle.                         |
| RGBWAF channel level against arc level                                          | Output = curve(arc level) × channel ÷ 254        | The lux sweeps in `da5-l.md`.                                                                                 |
| GO TO LAST ACTIVE LEVEL when already on                                         | No change                                        | Send it at a known level and query.                                                                           |
| UP and DOWN step rounding                                                       | Accumulate fractions                             | 20 UPs at fade rate 15, query after each.                                                                     |
| IDENTIFY DEVICE on the DA5-L                                                    | Flash between MIN and MAX for 10 s               | Only with the tapes covered, once.                                                                            |
| RESET: immediate or faded                                                       | Immediate                                        | Covered tapes, once.                                                                                          |

## 17. Every edge case that touches the brightness ceiling

"Driver MAX" is MAX LEVEL stored in the driver. "The governor" is the app's check in `src/safety`. Each item is a way output can rise without a DAPC above the ceiling, with what the governor does about it.

1. **RESET.** Level 254 and driver MAX 254 at once (section 5). Blocked by default. If unlocked: warn, send, wait 300 ms, write the safety profile, read it back.
2. **Mains power-up.** After 0.6 s the driver goes to POWER ON LEVEL, limited only by driver MAX. The app may not be running. Safety profile: POWER ON LEVEL 0, verified.
3. **Bus failure for more than 500 ms.** SYSTEM FAILURE LEVEL, limited only by driver MAX. Unplugging the hasseb or a sleeping computer triggers it. Safety profile: 255.
4. **SET MAX LEVEL above the ceiling,** including 255, which stores 254. The governor reads DTR0 and refuses a value above the ceiling. Raising the ceiling itself is the deliberate action in R6. Writing the ceiling can also fail without an error: a MAX LEVEL below MIN LEVEL is stored as MIN LEVEL (section 3). If the factory or another tool left MIN LEVEL above the ceiling, the write does not take. The safety profile therefore reads MIN LEVEL and PHYSICAL MINIMUM first, lowers MIN LEVEL to PHYSICAL MINIMUM if it is above the ceiling, then writes MAX LEVEL and reads it back. A ceiling below PHYSICAL MINIMUM cannot be met by the driver at all (level 85 on the DA5-L, if its manual's 1% holds). The app refuses to set one and says why.
5. **RECALL MAX LEVEL.** Jumps to driver MAX with no fade. Allowed only when the driver's MAX has been verified at or below the ceiling. It is also a jump, so the rate guard counts it.
6. **GO TO SCENE.** Stored values are limited at recall by driver MAX, so they are safe while item 4 holds. Scenes written by other tools before the app connected are unknown, so read all 16 on connect.
7. **SET SCENE, SET POWER ON LEVEL, SET SYSTEM FAILURE LEVEL with DTR0 above the ceiling.** They arm a later rise. Refused above the ceiling. 255 is allowed for SET SCENE (not in the scene) and for SET SYSTEM FAILURE LEVEL (no change). It is refused for SET POWER ON LEVEL, where in DALI-2 it means "the last level" and would undo S1's power-on setting.
8. **UP and CONTINUOUS UP.** Stop at driver MAX, not at the governor's number. Safe while driver MAX is verified. CONTINUOUS UP runs to MAX from one frame.
9. **STEP UP and ON AND STEP UP.** The same. ON AND STEP UP switches on at MIN.
10. **SET MIN LEVEL above the ceiling.** Every "on" would then land above it, and 255 stores MAX. Refused above the ceiling. The app has little reason to raise MIN at all.
11. **A DAPC below MIN gives MIN.** Harmless unless item 10 happened.
12. **GO TO LAST ACTIVE LEVEL.** Returns to a level that may predate a lower ceiling, and gives MAX straight after power-up. Limited by driver MAX.
13. **SELECT DIMMING CURVE to linear.** The same arc level gives far more light (section 12). Blocked, and checked on connect.
14. **DT8 colour at a fixed level.** On RGBWAF, going from one channel at 254 to five at 254 multiplies the light and the current at the same arc level. The 40% ceiling on arc level alone is not a ceiling on light for the RGBCCT tape. See the note below.
15. **Automatic activation.** Any level command applies a pending temporary colour. The governor judges the pair.
16. **DT8 scene, power-on and failure colours.** A scene with the level masked and every channel full raises output with no level change. Judged like item 14 when stored.
17. **Normalised colour control, and the other colour types.** Normalised control may rescale channels upward. The governor refuses SET TEMPORARY RGBWAF CONTROL values other than channel control until the DA5-L's behaviour is measured. SET TEMPORARY PRIMARY N DIMLEVEL and the xy commands (set and step) carry the same risk as item 14, by a route the mix limit does not see. They are refused unless the driver reports that colour type and the simulator has a model for it.
18. **START AUTO CALIBRATION and REFERENCE SYSTEM POWER.** After START AUTO CALIBRATION (DT8) the driver takes over its outputs for up to 15 minutes and ignores level commands. REFERENCE SYSTEM POWER (DT6, command 224) starts a measurement during which the gear ignores everything but queries and TERMINATE, for up to 15 minutes (`gear/led.py:23-35`). Panic's level commands would be ignored in both. Both are blocked. Panic also sends TERMINATE.
19. **IDENTIFY DEVICE.** Manufacturer-defined, probably a flash to full. Blocked.
20. **SET OPERATING MODE.** A manufacturer mode may not follow part 102 at all. Blocked.
21. **Memory bank writes.** May hold manufacturer limits. Blocked, except reads.
22. **A configuration write that did not take.** A cancelled send-twice pair, or a frame lost in the 300 ms after RESET, leaves the old value. Every write of the safety profile is read back before the governor trusts it.
23. **A duplicated frame.** A retry of a raw frame could complete a send-twice pair the governor approved only once. The transport never retries a configuration frame on its own. A retry is a new request to the governor.
24. **A fade already running.** A long fade toward a high target continues after the ceiling drops. Lowering the ceiling sends a level command, not only a new MAX LEVEL.
25. **Panic.** OFF is immediate where a DAPC with a fade time is not. If the safe level is off, panic sends OFF. If it is a low level, panic sets fade time 0 and then sends the DAPC, or accepts the current fade. Stage 2 has to choose, and say which in the spec.
26. **STORE ACTUAL LEVEL IN DTR0 and other gear-written registers.** The governor loses track of DTR0. It marks the register unknown and refuses DTR0-based commands until it is set again.
27. **Group and broadcast addressing.** One frame reaches several drivers with different stored values. The governor judges it against every driver that would respond, including drivers it has not yet seen. Its map of addresses and groups goes stale after SET SHORT ADDRESS, PROGRAM SHORT ADDRESS, any commissioning run, ADD TO GROUP or REMOVE FROM GROUP. After any of these it marks the map unknown and rebuilds it by query before allowing indirect or group commands.
28. **Gear the app has not configured.** A new or reset driver has MAX LEVEL 254 and may answer group 0 (LUNA). Until its safety profile is verified, the governor allows it nothing above the ceiling by direct command and no indirect level commands at all.
29. **Other masters.** A second controller or a manufacturer's tool on the bus can do all of the above. Only the driver's stored values survive that, and RESET removes them. Out of the app's control. The threat model should say so.
30. **Raw frames.** Decoded with the previous frame as context (for ENABLE DEVICE TYPE), then judged by the same rules. A frame that does not decode to a known command is refused.

### A ceiling for colour

Item 14 changes the brief. R6 defines the ceiling as a percentage of light output, enforced through MAX LEVEL. For tunable white it works only if the driver holds total output steady as colour temperature changes. `da5-l.md` leaves the mixing law open: if both channels run high in the middle of the range, a colour temperature change at a fixed arc level raises the light, perhaps toward double. Until the law is measured, the governor treats a colour temperature change like a channel mix change and assumes the worse law. For RGBWAF the ceiling does not work at all through MAX LEVEL, because the driver's MAX LEVEL limits the arc level and says nothing about how many channels are on.

The governor therefore needs a ceiling in two parts for the RGBCCT driver: MAX LEVEL on the arc level, which the driver enforces, and a limit on the channel mix, which only the app can enforce. The simplest mix rule is a cap on the sum of channel levels, as a fraction of one full channel. A better one weighs each channel by its lumens from `optics.md`. Both depend on the scaling law that is still unknown, so the default until hardware day should be conservative: treat total output as the arc-level fraction times the sum of the channel fractions, and hold that product to the ceiling.

The driver half of this ceiling does not exist for the mix. A stray frame from outside the governor can light every channel at the capped arc level. The worst case for tape B is then the arc ceiling times all five channels. At a 40% ceiling that is 40% of every channel at once, which the tape and supply can deliver, so it is a comfort problem and not an electrical one. Stage 2's threat model should record it, and `SUMMARY.md` raises it for the owner.

## 18. Corrections to the brief

- QUERY DEVICE TYPE answers 255 for several device types and 254 for none.
- `tools/first_light.py` sends both tapes to arc level 254, by broadcast and one channel at a time, with no MAX LEVEL set. It is a bench check that ignores the 40% ceiling. The built-in `first-light` script in Stage 6 goes through the governor and will not reach those levels unless the ceiling is raised. Its docstring also calls the file `dali_first_light.py`.
- The ceiling needs a second part for RGBWAF (section 17).
- The governor must track DTR1 and DTR2 as well as DTR0, and must treat all three as unknown after gear-written commands.
- "POWER ON LEVEL (off by default)" in S1 relies on the DALI-2 meaning of 0. The older range started at 1.
- "A warm default colour on DT8 drivers" in S1 depends on how SET POWER ON LEVEL captures colour, which is unconfirmed.
- Extended fade time has gaps in its values (section 7). "0.1 s to 16 minutes in one command" is true of the range, not of every value in it.
- Queries run at about 21 a second, slower than plain commands.
- Lowering MAX LEVEL is not known to pull the level down, so "lowering it takes effect at once" needs the app to send a level command as well.
