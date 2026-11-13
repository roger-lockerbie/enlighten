# Switchgear

Research for Stage 1, read on 13 and 14 November 2026, for the virtual switch plates in R16 (Stage 10). The app draws generic plates with no logos or trade dress, so what matters here is documented behaviour and layout.

Research was cut short more than once, and several makers' sites refuse automated readers. The gaps are listed at the end. Stage 10 begins by checking this document, as the stage plan says.

## Summary

- A DALI-2 push button sends events, not lighting commands. An application controller turns events into commands. In this app the controller is the app itself, as the brief says.
- The event model (IEC 62386-301) has nine events and four timers. python-dali encodes them, and Lunatone and Beckhoff document the defaults: short press threshold 500 ms, repeat 160 ms, stuck 20 s, double press off.
- zencontrol is the one provider of the brief's three that is DALI-2 native, and it documents press and hold behaviour well.
- **Basalte and Gira plates are KNX devices.** They never transmit on a DALI bus. They reach DALI lights through a KNX to DALI gateway, whose mapping is a second unknown.
- Recommended three: zencontrol, a generic DALI-2 input coupler behind any designer plate, and Basalte Sentido as a labelled "KNX through a gateway" profile. Gira is dropped.
- No provider documents a use for double press.
- Which brands are most common in high-end Australian homes could not be established from public sources.

## 1. The part 301 event model

Source for the encoding: python-dali, `dali/device/pushbutton.py`, read at https://github.com/sde1000/python-dali/blob/master/dali/device/pushbutton.py (line numbers from that file). Beckhoff's table of the same events agrees (https://infosys.beckhoff.com/content/1033/tcplclib_tc3_dali/6776837131.html).

### Events

| Event             | Code | Meaning                                                                                                             | Lines      |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------- | ---------- |
| Button released   | 0    | The button went up.                                                                                                 | 67 to 73   |
| Button pressed    | 1    | The button went down.                                                                                               | 76 to 82   |
| Short press       | 2    | Pressed and released within the short timer, and not pressed again within the double timer if that is on.           | 85 to 99   |
| Double press      | 5    | "pressed, released, then pressed again within T_double".                                                            | 102 to 116 |
| Long press start  | 9    | Still held when the short timer ends.                                                                               | 119 to 131 |
| Long press repeat | 11   | Sent "at regular intervals as long as the condition holds", every repeat timer.                                     | 134 to 146 |
| Long press stop   | 12   | Released after a long press. "If the long press stop event is enabled, there is no separate button released event." | 149 to 156 |
| Button free       | 14   | A stuck button was released.                                                                                        | 159 to 165 |
| Button stuck      | 15   | Held, or bouncing, for longer than the stuck timer.                                                                 | 168 to 179 |

### Event filter

One byte, a set bit enabling the event: bit 0 released, 1 pressed, 2 short press, 3 double press, 4 long press start, 5 long press repeat, 6 long press stop, 7 stuck and free together (lines 47 to 59).

### Timers

| Timer  | Unit  | Default                         | Range                                | Set and query (lines)  |
| ------ | ----- | ------------------------------- | ------------------------------------ | ---------------------- |
| Short  | 20 ms | 500 ms                          | from the device's minimum to 5100 ms | 196 to 209, 260 to 279 |
| Double | 20 ms | 0, which turns double press off | from the device's minimum to 2000 ms | 212 to 227, 282 to 301 |
| Repeat | 20 ms | 160 ms                          | 100 to 2000 ms                       | 230 to 242, 304 to 313 |
| Stuck  | 1 s   | 20 s                            | 5 to 255 s                           | 245 to 257, 316 to 325 |

Units are from python-dali. Defaults are from Lunatone's DALI-2 MC datasheet, which lists "Short press 500 ms, Double -, Repeat 160 ms, Stuck 20 s" as factory settings (https://www.lunatone.com/wp-content/uploads/2020/08/86459532-DALI-2_MC_EN_D0084-2.pdf, page 5). Ranges are from Beckhoff's page, which was read through a summarising tool and should be re-read before the spec quotes it.

### How double press delays short press

"T_double is disabled by setting a value of 0, when disabled a short press event is generated immediately upon button release" (lines 103 to 113). With the double timer on, a short press can only be sent once the double timer has run out after the release. Turning double press on therefore makes every single press feel slower by the length of the double timer. That is the likely reason no provider's defaults use it.

### Default filter

Lunatone ships with short press, long press start, repeat, stop, and stuck and free enabled, and with released, pressed and double press off. That is 0xF4 (same datasheet, pages 5 and 14). Whether that is the standard's default or Lunatone's choice is not confirmed.

### For the event engine in Stage 10

- A state machine per button with the four timers, on the app's injectable clock, so tests can drive it.
- Inputs are down and up from pointer, touch or keyboard. Debounce is not needed for virtual buttons, but the engine should take a minimum pulse setting. Lunatone gives "minimum length of control pulse 40ms".
- With long press stop enabled, no separate released event follows a long press.
- The filter and timers are settings per plate, with the defaults above.

## 2. Which providers

### What "DALI switch" means for each

| Provider                                                                          | On the DALI bus?                   | How a press reaches a light                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| zencontrol                                                                        | Yes. DALI-2 part 301 input devices | Events go to a zencontrol application controller, which sends DALI commands    |
| A DALI-2 input coupler behind any plate (Lunatone, or zencontrol's switch module) | Yes                                | Events to any application controller, or the coupler's own built-in controller |
| Basalte Sentido                                                                   | No. KNX                            | KNX telegrams to a KNX to DALI gateway                                         |
| Gira pushbutton sensor 4                                                          | No. KNX                            | The same                                                                       |
| Philips Dynalite Antumbra, Clipsal C-Bus plates                                   | No. DyNet and C-Bus                | Their own networks, with DALI drivers behind gateways or DALI controllers      |

The brief's three were zencontrol, Basalte and Gira. Two of the three are not DALI devices. They can still be emulated, but as "plate plus gateway", and the gateway's translation of a KNX dimming telegram into DALI commands is configured per project and is not documented by the plate's maker.

### Recommendation

1. **zencontrol.** Australian, DALI-2 certified, sold in Australian plate formats, and the best public documentation of press, hold and LED behaviour found.
2. **A generic DALI-2 coupler behind a designer plate,** modelled on the Lunatone DALI-2 MC. This is how a house gets a chosen plate (a toggle or a metal push button from a specialist maker) onto DALI: volt-free buttons wired to a small input module. Lunatone's datasheet documents both the pure event mode and a full table of button functions with the DALI commands each sends. This replaces Gira.
3. **Basalte Sentido,** labelled in the app as a KNX plate through a gateway. It earns its place by being different: touch surfaces, multi-touch gestures and one central LED.

Gira is dropped. It is KNX, its rocker pairs add little that the others lack, and its timings could not be read. If an Australian incumbent is wanted in place of Basalte, Dynalite's Antumbra panel is the candidate, once its specification is read.

Which brands are most common in high-end Australian homes is not confirmed. The only comparison found is one integrator's opinion that C-Bus dominates homes and Dynalite sits at the prestige end (https://sydneyautomationco.pages.dev/cbus-vs-dynalite.html). Two or three Australian lighting designers or integrators could settle it in a conversation. This is a question for the owner and client, who may already know what the house will use.

## 3. zencontrol

### Plates

| Product       | Buttons                               | Size                                                      | Notes                                                                                                                                                                            | Source                                                                                          |
| ------------- | ------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Scenepanel    | 1, 2, 3 or 4                          | 87 × 87 × 13 mm, or an Australian plate about 87 × 117 mm | A centred square divided into quarters. One event instance per button. A small slot LED near the bottom edge of each button. 15 mA from the bus                                  | https://zencontrol.com/wp-content/uploads/products/instructions/0553058_zc-scene_w.pdf          |
| Smart switch  | 1, 2, 3 or 6                          | 75 × 117 × 34 mm (Australian), 86 × 86 mm (European)      | Round buttons in two columns, six as two by three. Mains powered. "8 selectable backlit colours with 8 preset dimmed levels" and printed icon caps. There is no 4 button version | https://zencontrol.com/wp-content/uploads/products/datasheets/zc-ss-6sw_Leaflet_Datasheet_w.pdf |
| Switch module | 2 inputs, or 1 input and 1 LED output | 40 × 20 × 10.5 mm, behind any plate                       | "Suitable for momentary switch mechanisms"                                                                                                                                       | https://zencontrol.com/wp-content/uploads/products/instructions/zc_switch_w.pdf                 |

Scenepanel layouts: one full square button, two stacked halves, three as two quarters with one half (either way up), and four quarters. The 1, 2 and 4 button plates in R16 are the Scenepanel. The Australian plate's height is printed as 177 mm in the sheet's table and 117 mm on its drawing. 117 is the likely figure.

Which quarter is instance 0 is not stated.

### Behaviour

zencontrol's plates only send events. The controller gives each button a type. From zencontrol's support article on push button types (https://support.zencontrol.com/hc/en-us/articles/360000504776-How-do-I-change-push-buttons-in-grid-view, read in a browser because the site refuses plain fetches):

| Type                    | Short press                                                                            | Hold                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dimmer                  | "Short press toggles on and off"                                                       | "All long presses instruct fitting to dim UP or DOWN in intensity for 200ms using FADE RATE. As long as user holds, will continue to instruct fitting each ~160ms to keep dimming." |
| Memory Dimmer           | "First short press turns the fitting off", "Second short press recalls the last level" | "First long press increases the fittings intensity", "Second long press decreases"                                                                                                  |
| Up Dimmer               |                                                                                        | Dims up. "IF the primary (first) target is off, the first command sent will turn the lights on."                                                                                    |
| Down Dimmer             |                                                                                        | Dims down "until minimum level. Lights will not turn off."                                                                                                                          |
| Tuneable White Dimmer   |                                                                                        | "First long press makes the colour cooler", "Second long press makes the colour warmer"                                                                                             |
| Custom Toggle           | First press sends command 1, second press command 2                                    |                                                                                                                                                                                     |
| Custom Short/Long Press | Command 1                                                                              | Command 2                                                                                                                                                                           |
| Custom Push And Release | Command 1 on push                                                                      | Command 2 on release                                                                                                                                                                |
| Action                  | Runs a sequence                                                                        |                                                                                                                                                                                     |

Commands a custom button can send: OFF, UP, DOWN, STEP UP, STEP DOWN, RECALL MAX, RECALL MIN, STEP DOWN AND OFF, ON AND STEP UP, GO TO LAST ACTIVE LEVEL and GO TO SCENE 0 to 11.

No type uses double press.

### LED modes

From the same article, per button: off, flash on press, on when the target is on, on when the target is off (a locator glow), on when the target is at a scene, on for the last scene heard, always on, and flashing. A colour can be set where the hardware allows.

### Not stated by zencontrol

The short press threshold its controller uses (assume the 500 ms default), which direction the plain Dimmer type takes on the first hold, and whether the direction resets after a pause or at the ends of the range. One detail from its Control4 driver: it treats a hold as ended "when no new hold events arrive within 500ms" (https://support.zencontrol.com/hc/en-us/articles/15467495211663-Keypad-Programming-Events).

## 4. A generic DALI-2 coupler (Lunatone DALI-2 MC as the model)

Source: https://www.lunatone.com/wp-content/uploads/2020/08/86459532-DALI-2_MC_EN_D0084-2.pdf, read in full.

Four volt-free inputs, so any plate with one to four momentary buttons. Two ways to use it:

**Event mode.** Four part 301 instances, with the defaults in section 1. The app plays the controller.

**Built-in controller.** Each input gets a button function. The factory defaults are a useful picture of what an installer leaves in place:

| Input | Function       | Short press                                         | Hold                                                    |
| ----- | -------------- | --------------------------------------------------- | ------------------------------------------------------- |
| 1     | "push and dim" | Toggle: RECALL MAX or OFF "depending on bus status" | "sends alternating UP or DOWN on long press and repeat" |
| 2     |                | RECALL MAX                                          | Dim up                                                  |
| 3     |                | OFF                                                 | Dim down                                                |
| 4     | Tunable white  | Toggle                                              | "alternating WARMER or COOLER on repeat"                |

Its own timings in this mode differ from the part 301 defaults: a short press is under 400 ms, a long press starts at 400 ms, repeats come every 200 ms, and an "extra long press" at 2.2 s can store a scene. The long press threshold is configurable from 200 to 5100 ms.

Other documented functions: a plain toggle between two commands, one command on press and another after a delay (a staircase timer), stepping to the next scene on each press, and an option to send ON AND STEP UP first, so that holding from off brings the light on at its minimum.

A coupler has no LEDs. Plates on couplers give no feedback unless the plate has its own.

## 5. Basalte Sentido (KNX, through a gateway)

Source: the Sentido KNX installation manual, version 2.0 (https://www.siblik.com/fileadmin/mam/medias/docus/59/BAS200-02_BAS201-xx_BAS202-xx_SENTIDO%20KNX_Beschreibung_EN_v2_0.pdf).

- A square plate with touch-sensitive surfaces and no moving buttons: two (top and bottom) or four (two by two). A single-surface version is not in this manual.
- "The separate touch-sensitive surfaces of Sentido each control various functions, such as switching, dimming, operating blinds, calling up and or saving scenes, using both short and long press."
- Touching more than one surface at once is a gesture of its own: "room toggle, scene sequencer and RGB sequencer".
- One central RGB LED behind a thin window, not one per surface. "When touching a single surface, the central LED turns white. Touching more than one surface at the same time will activate the multi-touch function and the LED turns orange". It can also serve as a backlight or night light.
- A touch held for more than 40 seconds makes the plate recalibrate.

Not confirmed: the plate's dimensions, the short and long press threshold, and what the gateway sends. KNX dimming is usually a start telegram on hold and a stop on release, which a gateway turns into a fade toward maximum or minimum. For the emulation, that maps onto the same hold behaviour as the DALI plates, with a fade in place of repeated UP commands. This paragraph is general KNX practice and was not read from a Basalte or gateway document.

## 6. One-button dimming

A synthesis of zencontrol's Dimmer and Memory Dimmer types and Lunatone's "push and dim", with the event model:

| Event             | Controller action                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Short press       | Toggle. If the target is on, OFF. If off, RECALL MAX, or GO TO LAST ACTIVE LEVEL, or a set level or scene. The controller has to know the target's state, by tracking or by asking. |
| Long press start  | Choose a direction, opposite to the last hold. Send the first UP or DOWN. Optionally send ON AND STEP UP first, so a hold from off turns the light on.                              |
| Long press repeat | Send UP or DOWN again. Each dims for 200 ms at the driver's fade rate, and repeats every 160 ms overlap into a continuous ramp.                                                     |
| Long press stop   | Stop sending. The driver finishes its 200 ms. Reverse the stored direction.                                                                                                         |
| Button stuck      | Stop repeating.                                                                                                                                                                     |

DOWN never turns a light off and UP never turns one on, by the rules in `dali.md`. A hold therefore dims between the driver's minimum and maximum, and the ramp's speed is the driver's fade rate, which the plate does not control. At the reset fade rate of 44.7 steps a second, the full range takes about 5.7 s.

Tunable white uses the same shape with warmer and cooler steps on each repeat. zencontrol's Control4 driver defaults to 200 K a press. Each DT8 step costs several frames (`dali.md`), so a held tunable-white button uses much more of the bus than a held dimmer.

Not documented by either maker: whether the direction also resets after a pause, or is forced upward at minimum and downward at maximum. The emulation makes it a setting, with "alternate each hold, first hold up" as the default.

### Through the governor

Every action in this section is an indirect level command: RECALL MAX, UP, ON AND STEP UP, GO TO LAST ACTIVE LEVEL, scenes. None carries a level the governor can read from the frame. They are safe only because the driver's MAX LEVEL has been written and verified, which is the rule `dali.md` sets for all such commands. A virtual plate on a driver whose safety profile is not verified must do nothing. The toggle's RECALL MAX is also a step to the ceiling with no fade, so the rate guard counts it.

## 7. Layouts and conventions

What could be found for a typical plate:

- zencontrol publishes examples of a "4 button scene status panel with dimmers" and a "two button toggle panel" where each button does "Recall Max or Off depending on the state of the lights" (https://support.zencontrol.com/hc/en-us/articles/360002080475-Touch-Switch-examples). It sells fixed Scenepanel variants named dimmer, three scenes and tunable white (https://zencontrol.com/products/scenepanel-switch/).
- Lunatone's defaults for four inputs: toggle and dim, on and up, off and down, and tunable white.
- LED conventions from zencontrol: on when the target is on, or the reverse as a locator, or on for the active scene, with the backlight's brightness set per time profile.

The layout often described for a hallway plate, with on, two scenes and off, holding to dim, is consistent with these but is not confirmed by any source.

Presets for Stage 10, each a starting point the mapping editor can change:

| Plate                  | Buttons        | Preset                                                                                                                     |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1 button               | One            | Memory Dimmer: press toggles, hold dims with alternating direction                                                         |
| 2 button               | Top and bottom | Top: on, and hold to dim up. Bottom: off, and hold to dim down                                                             |
| 4 button               | Two by two     | Top left: on. Top right: scene. Bottom left: scene. Bottom right: off. Hold dims, up on the top row and down on the bottom |
| 4 input coupler        | Any plate      | Lunatone's defaults above                                                                                                  |
| Sentido 2 or 4 surface | Touch          | As the 2 and 4 button presets, plus a multi-touch "room toggle"                                                            |

## 8. Not confirmed

| Item                                                                                                       | How to settle it                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The standard's default event filter                                                                        | Query a factory-fresh DALI-2 input device, or the standard itself                          |
| zencontrol's short press threshold, first hold direction, direction reset, instance order and plate height | A bus trace on zencontrol hardware, or a support request                                   |
| Double press in practice                                                                                   | No provider documents using it. Leave it in the engine and off in every preset             |
| Basalte and Gira press timings and dimensions, and gateway mappings                                        | Their KNX application descriptions                                                         |
| Dynalite Antumbra and Clipsal plates                                                                       | Not read                                                                                   |
| Which brands are common in high-end Australian homes, and the usual four button layout                     | Ask integrators, or the client                                                             |
| Beckhoff's timer ranges                                                                                    | Re-read the page directly                                                                  |
| DALI Alliance listings for zencontrol's devices                                                            | The product database pages were not opened. zencontrol's own pages state the certification |
