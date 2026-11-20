# ADR 0018: The hallway, mounts, cameras and A/B view as built

Status: accepted

Date: 2026-11-19

## Context

Stage 7 built the light engine and showed one fixed hallway from one fixed camera (ADR 0017). Stage 8 makes it a design tool: the hallway and its finishes can be edited (R10.1, R11.3), up to six mounts can be added, edited, mirrored and chosen from presets (R11.1, R11.2, R11.4, R14.2, R15.1), the camera moves (R15.2), and two set-ups can be shown side by side (R12.2). The picture follows the active connection in every output mode (R10.2).

The owner decided in planning that a mount binds to any short address from 0 to 63, but no simulated drivers are added. Extra simulated drivers wait for Stage 9.

## Decision

### Binding by address

- A mount carries `address`, a short address from 0 to 63, in place of Stage 7's bench unit name. `parseScene` checks it. It is not part of the geometry text, so a change of address keeps the cached solve.
- `drivesFor` returns each driver's drive by address, read from the active connection's light. A mount whose address has no driver gets no drive, draws unlit, and its row says "No driver at address N." A mount whose tape has channels its driver does not feed says which.
- In Simulator mode only addresses 0 and 1 have drivers. R14.2 asks for simulated drivers at the other addresses. That is a recorded gap until Stage 9.

### The set-up

- A set-up is a scene and a list of links (`src/light/setup.ts`). A link joins two mounts: `mirror` keeps a mount and its mirror on the other wall alike, and `both` keeps the up and down halves of a reveal lit both ways in one opening alike. The fields they share follow on every edit. Each mount keeps its own address. A mount has at most one link of each kind, and `group` walks the links to find everything an edit reaches.
- Every edit is a pure function that returns the new set-up or a one-line reason. Each result goes through `parseScene`, and the scene check's errors are turned into the editor's words, for example "Two mounts would take the same place on one wall."
- Making the hallway smaller fits the mounts to it rather than refusing: a mount is shortened, moved along or lowered. A mount that ran the full length still does.
- Five presets (R11.4): a skirting slot, a mid-wall channel, a high reveal lit up, a high reveal lit down, and skirting slots on both walls, mirrored. Each puts tape A on address 0 and keeps the hallway. Each has a small drawing made from its own data, as SVG elements, not markup text.
- Finishes come from `docs/research/optics.md` section 4: Dulux Vivid White (0.90), Natural White (0.80) and Lexicon Quarter (0.85) for ceiling and walls, each its LRV less a margin for an applied surface. The floor has three microcement placeholders (0.4, 0.5 and 0.6), marked assumed. A reflectance can be typed, from 0 to 0.98.
- The tape list is the three researched tapes, by density for R15.1: tunable white at 120 LEDs/m, RGB + CCT at 60 LEDs/m, and COB. No other density is offered, because none is researched.

### Cameras

- Three kinds of view (`src/light/camera.ts`): walk, at eye height (1.6 m, or 0.3 m below the ceiling in a low hallway); orbit, around the middle of the hallway at 0.3 to 12 m; and close up on one mount. Presets give the view down the hall (Stage 7's view as a walk) and the view at a wall.
- The close-up has a 30 degree field and a 5 mm near plane. It looks at a channel from 0.15 m. It looks at a slot or reveal from 0.3 m out and 0.2 m along the way its light goes, or the other way when that would leave the room, so a skirting slot is seen from above.
- Every view keeps the eye 0.15 m inside the room, since the faces are one-sided.
- Input: dragging the picture turns the view, the wheel moves in, and W, A, S and D walk a quarter metre (a metre with Shift). The arrow keys still move the probe. Each setting has a number field, so every view can be set from the keyboard. A preset is a cut: nothing animates (S6.3).
- A view is checked with `parseView` before it is kept, so a bad one is never drawn or stored.
- The close-up follows the selected mount. When that mount is removed, the view goes back down the hall.

### Edits and the picture

- After an edit that changes the geometry, the picture keeps its old surfaces and light until the new light is solved or read from the cache. It then changes in one step, and never sooner than a second after its last change (SPEC S6.1). Without this, each edit cleared the bounced light and brought it back, and fast clicking dimmed and restored the whole picture several times a second (S8-L1). The first picture shows its direct light at once, as in Stage 7.
- Each picture builds the frame for the scene it shows, so a frame never has more or fewer mounts than the surfaces it lights. An edit that changes only a tape, cover or address keeps the geometry and shows at once.
- The solve state says "ready" only once the new picture is shown.
- The wheel moves the camera one step for each 100 px of vertical scroll, so a trackpad moves it in proportion (S8-L2).

### The A/B view

- Set-up B starts as a copy of A and is a full set-up: hallway, mounts and links. A switch chooses which one the editor changes, and "Copy A to B" makes them the same again.
- Each picture has its own canvas, renderer and solver, and each solver makes its worker through `src/workers/policy.ts`. Both are driven by the same addresses from the same light. The light cache keeps four scenes, so both stay kept. The two solvers share the cache's index, and their updates can race: the cost is a solve again, and the cache stays within four scenes (S8-I4). A renderer forces its GL context lost when it is disposed, so turning B on and off does not reach the browser's limit (S8-L3).
- One camera, one exposure and one white balance serve both. "Adapted to the scene" adapts to the light of both together: `buildFrame` takes the other set-up's light as `alongside`, so the two pictures are balanced to one white and a difference between them is a difference in light.

### The editor's place

- The selected mount is edited in the inspector, as the Playground's selected device is. The page sets `app.inspector` to a snippet, so the editor's code stays in the Visualiser's lazy chunk.

### Storage and workspace files

- The set-ups, whether A/B is on, which set-up is being edited, and the view are kept in a `visualiser` record, version 1, saved 0.4 s after the last change and when the page closes. The store holds the record, but the check comes from the light core (`src/light/saved.ts`) and is passed in, so the entry chunk does not carry the scene's code. A record that fails the check is set aside, as every stored record is (ADR 0009).
- Workspace files move to version 3. Set-up A is written as `hallway`, `mounts` and `links`, as SPEC section 8 lists them. Set-up B is written under `compare` only when it differs from A. The exposure, white balance and false-colour settings join `preferences`, as ADR 0017 promised. Version 2 files migrate by a version bump.
- The store's schema checks only the shape of the set-up keys: objects, and lists of at most six. It passes them through by reference, unlike the rest of `validate.ts`'s results, and `importSetups` builds fresh objects from them, so nothing unchecked is stored (S8-I2). Before an import is offered, Settings loads the light core and checks the set-ups in full with `importSetups`. A set-up that fails is refused with its reason, and nothing is applied. One that passes adds a line for each change to the confirmation. A file with set-up A and no `compare` makes B a copy of A, as an export writes it. A file with only `compare` is refused.
- An import of set-ups sends nothing to any driver.

## Consequences

- The entry chunk is 253.45 kB against its 256,000 byte budget. The margin is 2.5 kB. The scene's code must keep loading through a dynamic import.
- Timings on an Apple M1 Pro are in `docs/STATUS.md`, against 4 ms a frame and 2 s per mount. The A/B view draws two half-width pictures, so it draws about as many pixels as one.
- Visual regression has a picture for each preset and for each cover close up on a lit channel. The bare channel shows the tape's alternating warm and cool emitters, and the opal cover blends them.
- A mount bound to an address with no simulated driver cannot be lit until Stage 9 adds drivers, or the hardware has one there.

## Differences from the approved plan

- The plan named a twin with a source. The build has links of two kinds, so a reveal lit both ways and a mirrored pair use one mechanism, and a mirrored reveal lit both ways is four mounts in one group.
- The plan gave the walls Lexicon Quarter at 0.86. The build uses 0.85: LRV 90 less the same margin as the other paints.

## Alternatives considered

- Simulated drivers at every bound address now: the owner chose to wait for Stage 9, which needs them for choreography and can model them once.
- Animated camera moves between presets: they add motion the user did not make, against S6.3, for no gain in judging the light.
- Checking the set-ups in full in the store's schema: it would put the scene's code in the entry chunk, which is already near its budget.
- Keeping set-up B out of workspace files: an export would then lose half of what the owner sees.
