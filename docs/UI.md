# User interface

How the app is laid out, how it is driven from the keyboard, and what it looks like. The direction is the brief's: dark and restrained, one accent used sparingly, generous spacing, tabular figures, and monospace only for the console and frames. The light in the visualiser should be the most colourful thing on screen.

Wireframes are in `docs/wireframes/`. They show layout and content, not final styling.

| File                                    | Shows                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `01-shell-playground-tunable-white.svg` | The shell, the tunable-white playground, the inspector, the console |
| `02-playground-rgbcct.svg`              | The RGB + CCT playground with a level lowered to fit the ceiling    |
| `03-visualiser-mount-editor.svg`        | The hallway, the probe, cameras and the mount editor                |
| `04-ceiling-dialog-and-panic-latch.svg` | Raising the ceiling, and the app after panic                        |
| `05-switch-plates.svg`                  | Plates with 1, 2 and 4 buttons and the mapping inspector            |

## 1. Information architecture

One window, no routes that need a server. Ten pages in a rail on the left:

| Page        | Purpose                                                                                                        | Stage |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ----- |
| Playground  | Drive one device or group with sliders and pickers. The bench preview sits below                               | 5     |
| Looks       | The library of named looks, and each driver's 16 scene slots                                                   | 9     |
| Sequences   | Build, preview and run timed plans. Night presets                                                              | 9     |
| Effects     | Built-in effects with their parameters and bus cost                                                            | 9     |
| Visualiser  | The hallway, mounts, cameras and the A/B view                                                                  | 7, 8  |
| Switches    | Virtual plates and their mappings                                                                              | 10    |
| Devices     | Inventory, the safety profile for each address, simulator profile settings, commissioning, the hardware check  | 4, 5  |
| Bus monitor | Every frame, decoded, with timing, source and verdict. The divergence log                                      | 5     |
| Settings    | Preferences, workspace export and import, key legend                                                           | 5     |
| Scripts     | Built-in and stored scripts, an editor that shows parse errors by line, import, export, and Run in the console | 6     |

Pages that a stage has not built yet are not shown. Stage 5 built Playground, Devices, Bus monitor and Settings, in that order in the rail, so Alt-1 to Alt-4 reach them. Stage 6 added Scripts fifth, reached with Alt-5 (ADR 0014). Stage 7 added the Visualiser sixth, reached with Alt-6 (ADR 0017). Stage 9 added Looks, Sequences and Effects seventh to ninth, reached with Alt-7 to Alt-9 (ADR 0020). That fills Alt-1 to Alt-9. Stage 10 added Switches tenth, reached with Alt-0 (ADR 0021). Its mapping editor sits in the page under each plate, not in the inspector. Devices, the Visualiser and the three Stage 9 pages load when one of them is first opened. The Playground drives one address per panel: a group as the target is not built yet (ADR 0013). On Hardware and Both, a colour driver takes a colour before it takes a level (ADR 0019): until one has been sent after a connect or a scan, the level control is refused with that reason. On hardware the guard trusts nothing it has not sent (ADR 0019 amendment 2): each colour or level change to a tape waits about 2 s after the one before plus its fade time, and 1 s after a change to the other tape. A colour changes only with the fade time at 0, and the refusal says so. A group or broadcast level is refused: each tape is driven on its own. Apply sends the colour first and the level when the guard lets it.

### Looks, Sequences and Effects in Stage 9

No wireframes were drawn for these pages. They are built from the playground's controls and the design system, and are described here as built (ADR 0020).

- **Looks** has the library as a table, an editor for one look (name, the level slider, a choice of no colour, a colour temperature or RGBWAF channels, an optional fade, and buttons that take what a driver shows now), and the slots of one driver at a time. Each of the 16 rows shows the look the map has there, a chip (verified, mismatch or pending) with a line of text, "assumed" beside a stored colour, a choice of look with Write, and Recall and Empty. A look the driver cannot take is greyed in the choice. Below is a row that recalls one slot on every driver or on a group, with a fade to set first if wanted.
- **Sequences** lists the built-in sequences and the saved ones. The editor has a name and the steps in order: a target, the level and colour (opened in place for one step at a time), minutes and seconds, and "With the step above". The preview shows what the planner left out or changed, a table of every change, and every frame with its time behind a disclosure.
- **Effects** has one button for each of the ten effects, its settings as sliders with a number field beside each, the drivers it is aimed at as checkboxes numbered in the order chosen, the bus cost as a percentage with a meter and frames a second for each address, and the same preview.
- Sequences and Effects share one bar: Check, Run, Stop, Export CSV and Export JSON. A check's answer stays only while what it checked is unchanged. While something runs, the bar shows its name, the change it is on, the time so far and the planned length. When it ends, the bar says how: finished and how close to its planned end, stopped and why, or refused and by which rule. On Hardware and Both the bar says that nothing is checked ahead.
- All three pages end with the bench preview, so a recall or a run can be watched without leaving the page.

### The Visualiser in Stage 7

One fixed hallway from one fixed camera, at eye level looking down it. From the top: the page title with its "estimated" chip ("prediction" when hardware is driving) and the state of the bounced light; the picture; the probe's reading; the view controls; and what the picture shows.

- The picture is a button, so it takes focus. The probe follows the pointer over it, and the arrow keys move it by 2% of the picture, or 10% with Shift. A ring marks where it is.
- The view controls are three segmented controls with a number field each: exposure (night-adapted, evening, day, manual, with EV), white balance (adapted to the scene, daylight, chosen, with K), and what to show (the picture, lux, cd/m²) with the false-colour legend.
- "What this shows" says the picture is a best-effort estimate, lists each mount with its tape, cover, place, driver and present output, and has "Measure frame time", which draws a six-mount scene off screen and reports milliseconds a frame and the GPU. The picture does not change while it runs.
- The inspector says the hallway and mounts are fixed in this version. Stage 8 puts the selected mount there.

### The Visualiser in Stage 8

Stage 8 makes the page a design tool (ADR 0018). From the top: the title, chip and solve state, as in Stage 7, with one line each for A and B in the A/B view; the camera bar and the A/B switch; the picture, or two side by side; the probe, with a reading for each picture; the view controls; the mounts card; the hallway card; and what the picture shows.

- **Camera bar.** Walk, Orbit and Close up, with "Down the hall" and "At the left wall" (or right, by the selected mount) as cuts. Each mode has number fields for its settings: along, across, turn and tilt for a walk; turn, tilt and distance for an orbit; and which mount for a close-up. Nothing animates.
- **Mounts card.** In the A/B view, a switch chooses whether the editor changes set-up A or B, with "Copy A to B". One row per mount: "Left: skirting slot, facing down. Tunable white, 120 LEDs/m, address 0, Opal (Linear Lux) cover." A row adds "Mirrored with m2." for a linked mount, "No driver at address N." when nothing drives its address, and which tape channels its driver does not feed. Selecting a row opens the inspector on that mount. Below the rows: add a mount by kind and wall, with a count out of six; a status line that gives the reason when an edit is refused; and the five presets, each a button with a small drawing of the hallway in section and a line of description.
- **Hallway card.** Length, width and height, end walls open or closed, and a finish for the ceiling, walls and floor, each by preset or by reflectance, with where the preset's figure comes from and an "assumed" chip for the floor's placeholders.
- **Inspector.** The selected mount: kind, wall, height, facing (up, down or both for a reveal), tape, cover with its transmission, the opening's sizes, start and length, voltage drop, address, and "Mirror on the other wall". Each default shows its basis and whether it is sourced or assumed (R11.2). A status line gives the reason when an edit is refused. "Remove this mount" is last.

## 2. Layout

Designed for a laptop at 1440 by 900 and up. No mobile layout.

- **Top bar**, 48 px, always present. From the left: the wordmark; the output target (Simulator, Hardware, Both) with the connection state beside it; the ceiling as % and arc level with a count of verified drivers; bus use; active unlocks; and Panic at the far right. Nothing is ever drawn over the top bar. Dialogs sit below it and leave Panic clickable.
- **Rail**, 180 px.
- **Main view**, fluid.
- **Inspector**, 320 px, on the right. It shows detail for what is selected: a device's stored values on the Playground, a mount on the Visualiser, a button on Switches. It can be collapsed.
- **Console drawer**, along the bottom of the main view and inspector. It opens to 220 px, can be dragged taller, and remembers its height.
- **Banner**. One line under the top bar for states that need an answer: the panic latch with Resume, a lost connection, an unverified driver.

## 3. Components

All are keyboard reachable, have a visible focus ring, a role and an accessible name.

| Component         | Notes                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paired slider     | A slider with two linked numeric fields: % and arc level, or K and mirek. Arrow keys step by one unit of the right-hand field. Markers show the driver's minimum and the ceiling. A clamped value shows what was sent and why                              |
| Numeric field     | A number with its unit, a range, and Up and Down to step                                                                                                                                                                                                   |
| Segmented control | For two to four exclusive choices: target, Live or Commit, Colour or Raw channels                                                                                                                                                                          |
| Colour picker     | A hue and saturation field, with separate sliders for the two whites and a raw channel view. It carries a note that screens cannot show LED colours at full saturation                                                                                     |
| Fade picker       | A list of the values the driver has, grouped as standard and extended, with a line saying which the driver will use                                                                                                                                        |
| Toggle, menu      | Native elements, styled                                                                                                                                                                                                                                    |
| Dialog            | The native `<dialog>` opened with `show()`, not `showModal()`, with its own focus trap, so the top bar and Panic stay live. Used for confirmations only. Its own key handler closes it on Escape. A scrim below the top bar keeps the page behind it still |
| Confirmation      | For raising the ceiling and for unlocks: states what changes, and asks for the new value or the unlock's name to be typed                                                                                                                                  |
| Status chip       | Text with a small shape, never colour alone: verified, pending, mismatch, simulated only, estimated, prediction                                                                                                                                            |
| Log row           | One line of the bus monitor or console output: text nodes only. In Stage 5 the bus monitor's rows are table rows                                                                                                                                           |

Styling uses classes and CSS custom properties. Components contain no `style` attributes (ADR 0002).

## 4. Keyboard map

### Global

| Key                         | Action                                                         |
| --------------------------- | -------------------------------------------------------------- |
| Escape, twice within 500 ms | Panic. Works from any focus, including the console and dialogs |
| Ctrl-`                      | Show or hide the console, and move focus to it                 |
| Alt-1 to Alt-9              | Go to a page, matched on the key's position                    |
| Tab, Shift-Tab              | Move between controls                                          |
| F6, Shift-F6                | Move between regions: top bar, rail, main, inspector, console  |

A single Escape keeps its usual meaning: close a dialog, cancel a search, release Tab in the console. The first press of a pair does that too. No global shortcut uses Cmd, and none uses a Ctrl letter outside the console.

### Controls

| Key                   | Action                                  |
| --------------------- | --------------------------------------- |
| Left, Right, Up, Down | Step a slider or field by one unit      |
| Shift with an arrow   | Step by ten                             |
| Home, End             | The minimum, and the ceiling or maximum |
| Enter                 | Apply, in Commit mode                   |
| Space, held           | Hold a dim button or a plate button     |

### The Visualiser's picture

| Key                   | Action                                                 |
| --------------------- | ------------------------------------------------------ |
| W, S                  | Walk forward or back a quarter metre, in the walk view |
| A, D                  | Step left or right a quarter metre, in the walk view   |
| Shift with W, A, S, D | Step a metre                                           |
| Left, Right, Up, Down | Move the probe by 2% of the picture, or 10% with Shift |

Dragging the picture turns the view, and the wheel moves in or out. Every camera setting also has a number field.

### Console

The emacs keymap in `docs/research/console.md` section 1, driven from one binding table (ADR 0006). The keys that differ by platform:

| Action                 | Everywhere                    | Also on Mac and in an app window |
| ---------------------- | ----------------------------- | -------------------------------- |
| Delete the word before | Alt-Backspace, Ctrl-Backspace | Ctrl-W                           |
| Next history line      | Down                          | Ctrl-N                           |
| Previous history line  | Up, Ctrl-P                    |                                  |
| Search history         | Ctrl-R                        |                                  |
| Swap two characters    | not bound                     | Ctrl-T                           |
| Stop a script          | Ctrl-C with no selection      |                                  |
| Leave the console      | Escape, then Tab              |                                  |

`help keys` and the legend in Settings show the table as it applies to the platform in use. Help and `explain` print plain text lines in the console's log, with nothing drawn but text. Help wraps its own lines at 96 characters, and `explain` lines up its rows in columns (ADR 0023).

The drawer holds a scrollback with the role `log`, the input, a status line and an alert region read out for refusals and panic. Each output line has a text prefix (`>`, `refused:`, `fault:`, `+` for a script step, `||` for a pause), so colour is never the only cue. Moving to the drawer by Ctrl-` or F6 puts the caret in the input.

- Tab is taken only when there is something to complete. A list of candidates shows under the scrollback.
- The first Escape closes a search, a list or a confirmation. The next releases focus, and Tab then leaves.
- Ctrl-C copies a selection. With none, it abandons the line and stops a running line or script.
- Backspace and Delete with a selection are left to the browser.
- While a script is paused, Enter goes on. The drawer's header shows the script, its step and line, with Go on and Stop.
- An unlock, a raise of the ceiling and `history -c` ask at a `confirm>` prompt for the name, the value or `yes` to be typed (ADR 0014).

## 5. Design tokens

Custom properties on `:root`. Dark only.

| Token                      | Value                               | Use                                                |
| -------------------------- | ----------------------------------- | -------------------------------------------------- |
| `--bg`                     | `#0b0b0c`                           | Page                                               |
| `--surface`                | `#131315`                           | Bars, rail, cards                                  |
| `--raised`                 | `#1b1b1e`                           | Selected items, inputs, dialogs                    |
| `--line`                   | `#2a2a2f`                           | Borders and rules                                  |
| `--text`                   | `#e8e8ea`                           | Text                                               |
| `--text-muted`             | `#9a9aa0`                           | Labels and secondary text                          |
| `--accent`                 | `#8fb4d9`                           | Selection, focus ring, slider fill. Used sparingly |
| `--danger`                 | `#d9534f`                           | Panic, the latch banner, refusals                  |
| `--warn`                   | `#c9a24a`                           | Mismatch and "not yet confirmed" chips             |
| `--viewport`               | `#050506`                           | Behind the visualiser                              |
| `--font-ui`                | Inter, then `system-ui`             | Everything but the console and frames              |
| `--font-mono`              | JetBrains Mono, then `ui-monospace` | Console, frames, hex                               |
| `--size-1` to `--size-4`   | 12, 13, 16, 18 px                   | Small labels, body, wordmark, page titles          |
| `--space-1` to `--space-6` | 4, 8, 12, 16, 24, 32 px             | Spacing                                            |
| `--radius`                 | 4 px                                | Controls and cards                                 |
| `--focus`                  | 2 px solid `--accent`, 2 px offset  | Focus ring                                         |

Rules:

- `font-variant-numeric: tabular-nums` everywhere.
- Text on `--bg` and `--surface` meets WCAG AA: `--text` is about 16:1 and `--text-muted` about 7:1.
- No gradients, glows, shadows or decoration.
- State is never carried by colour alone.
- Transitions are 120 ms on opacity and transform only, and off under `prefers-reduced-motion`. Nothing blinks (S6).
- Fonts are self-hosted WOFF2 files in the repo, both under the SIL Open Font License 1.1, with their licence files and checksums beside them. They are assets, not packages.

## 6. Wording

Plain and short, by the rules in `CLAUDE.md`. Refusals say what was refused and why, in one line, for example "Refused: SET MAX LEVEL 254 is above the ceiling (220)". Labels that mark uncertainty are fixed words used the same way everywhere: "estimated" for tape data, "prediction" for the visualiser when hardware is driving, "assumed" for an unsourced default, "not yet confirmed on hardware" for a behaviour awaiting hardware day, "simulated only" for an address the bench does not have.
