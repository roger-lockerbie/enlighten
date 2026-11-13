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

One window, no routes that need a server. Nine pages in a rail on the left:

| Page        | Purpose                                                                                                       | Stage |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ----- |
| Playground  | Drive one device or group with sliders and pickers. The bench preview sits below                              | 5     |
| Looks       | The library of named looks, and each driver's 16 scene slots                                                  | 9     |
| Sequences   | Build, preview and run timed plans. Night presets                                                             | 9     |
| Effects     | Built-in effects with their parameters and bus cost                                                           | 9     |
| Visualiser  | The hallway, mounts, cameras and the A/B view                                                                 | 7, 8  |
| Switches    | Virtual plates and their mappings                                                                             | 10    |
| Devices     | Inventory, the safety profile for each address, simulator profile settings, commissioning, the hardware check | 4, 5  |
| Bus monitor | Every frame, decoded, with timing, source and verdict. The divergence log                                     | 5     |
| Settings    | Preferences, workspace export and import, key legend                                                          | 5     |

Pages that a stage has not built yet are not shown.

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

| Component         | Notes                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paired slider     | A slider with two linked numeric fields: % and arc level, or K and mirek. Arrow keys step by one unit of the right-hand field. Markers show the driver's minimum and the ceiling. A clamped value shows what was sent and why |
| Numeric field     | A number with its unit, a range, and Up and Down to step                                                                                                                                                                      |
| Segmented control | For two to four exclusive choices: target, Live or Commit, Colour or Raw channels                                                                                                                                             |
| Colour picker     | A hue and saturation field, with separate sliders for the two whites and a raw channel view. It carries a note that screens cannot show LED colours at full saturation                                                        |
| Fade picker       | A list of the values the driver has, grouped as standard and extended, with a line saying which the driver will use                                                                                                           |
| Toggle, menu      | Native elements, styled                                                                                                                                                                                                       |
| Dialog            | The native `<dialog>` opened with `show()`, not `showModal()`, with its own focus trap, so the top bar and Panic stay live. Used for confirmations only. Its own key handler closes it on Escape                              |
| Confirmation      | For raising the ceiling and for unlocks: states what changes, and asks for the new value or the unlock's name to be typed                                                                                                     |
| Status chip       | Text with a small shape, never colour alone: verified, pending, mismatch, simulated only, estimated, prediction                                                                                                               |
| Log row           | One line of the bus monitor or console output: text nodes only                                                                                                                                                                |

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

`help keys` and the legend in Settings show the table as it applies to the platform in use.

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
