<!--
  Looks (SPEC R5.1 to R5.3, docs/UI.md section 1): the library of named looks, and each driver's 16
  scene slots. A look is written to a slot and its level read back. The slot map marks a slot whose
  stored level no longer matches. A stored colour cannot be read back, so it is marked assumed.
-->
<script lang="ts">
  import { broadcast, group, short, type Address } from '../../dali/address.ts';
  import {
    clearSlot,
    lookFits,
    putLook,
    removeLook,
    renameLook,
    setSlot,
    slotState,
    SLOTS,
    type Library,
    type Look,
    type LookColour,
    type SlotState,
  } from '../../design/look.ts';
  import { MAX_NAME } from '../../design/schema.ts';
  import { lookText } from '../../design/text.ts';
  import type { Channels, FadeSetting } from '../../engine/engine.ts';
  import FadePicker from '../components/FadePicker.svelte';
  import StatusChip from '../components/StatusChip.svelte';
  import Toggle from '../components/Toggle.svelte';
  import { designOf } from '../design.svelte.ts';
  import LookFields from '../design/LookFields.svelte';
  import BenchPreview from '../playground/BenchPreview.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const design = $derived(designOf(app));
  const lib = $derived(design.value);
  const snap = $derived(app.snap);
  const devices = $derived(snap?.devices ?? []);
  const ceiling = $derived(snap?.ceilingArc ?? 220);
  const onHardware = $derived(snap !== undefined && snap.target !== 'simulator');

  let message = $state('');

  // The look being edited: a copy, kept only on Save.
  let editing = $state<string | undefined>(undefined);
  let name = $state('');
  let arc = $state(0);
  let colour = $state<LookColour>({ kind: 'none' });
  let ownFade = $state(false);
  let fade = $state<FadeSetting>({ kind: 'standard', value: 4 });
  let open = $state(false);

  function edit(l: Look | undefined): void {
    editing = l?.name;
    name = l?.name ?? '';
    arc = l?.arc ?? Math.min(128, ceiling);
    colour = l?.colour ?? { kind: 'none' };
    ownFade = l?.fade !== undefined;
    fade = l?.fade ?? { kind: 'standard', value: 4 };
    open = true;
    message = '';
  }

  /** Take the level and colour a driver shows now. */
  function capture(address: number): void {
    const l = snap?.light.find((x) => x.address === address);
    const drive = devices.find((d) => d.address === address)?.facts?.drive ?? 'level';
    if (l === undefined) return;
    arc = Math.round(l.target);
    colour =
      drive === 'tc' && l.mirek > 0
        ? { kind: 'tc', mirek: Math.round(l.mirek) }
        : drive === 'rgbwaf'
          ? {
              kind: 'rgbwaf',
              channels: l.channels.map((v) => Math.round(v)) as unknown as Channels,
            }
          : { kind: 'none' };
  }

  function save(): void {
    const look: Look = { name, arc, colour, ...(ownFade ? { fade } : {}) };
    let next: Library = lib;
    if (editing !== undefined && editing !== name.trim()) {
      const renamed = renameLook(next, editing, name);
      if (!renamed.ok) {
        message = renamed.reason;
        return;
      }
      next = renamed.value;
    } else if (editing === undefined && lib.looks.some((l) => l.name === name.trim())) {
      message = 'Another look has that name.';
      return;
    }
    const put = putLook(next, look);
    if (!put.ok) {
      message = put.reason;
      return;
    }
    design.setLibrary(put.value);
    open = false;
    message = `Saved "${name.trim()}".`;
  }

  function remove(l: Look): void {
    design.setLibrary(removeLook(lib, l.name));
    if (editing === l.name) open = false;
    message = `Removed "${l.name}". The drivers still hold what was written.`;
  }

  // The slot map shows one driver at a time.
  let chosen = $state<number | undefined>(undefined);
  const address = $derived(chosen ?? devices[0]?.address);
  const device = $derived(devices.find((d) => d.address === address));
  const drive = $derived(device?.facts?.drive);
  let pick = $state<Record<number, string>>({});

  const CHIP = {
    pending: 'pending',
    empty: undefined,
    unlisted: 'mismatch',
    verified: 'verified',
    mismatch: 'mismatch',
  } as const satisfies Record<SlotState, string | undefined>;

  function row(slot: number) {
    const entry = lib.slots.find((s) => s.address === address && s.slot === slot);
    const look = lib.looks.find((l) => l.name === entry?.look);
    const read = device?.scenes?.[slot];
    return { entry, look, read, state: slotState(entry, look, read) };
  }

  function stateText(r: ReturnType<typeof row>): string {
    switch (r.state) {
      case 'pending':
        return 'Not read yet.';
      case 'empty':
        return 'Empty.';
      case 'unlisted':
        return `The driver holds arc ${String(r.read)}, which no look here wrote.`;
      case 'verified':
        return `Holds arc ${String(r.read)}, read back.`;
      case 'mismatch':
        return r.read === 255
          ? 'The driver holds nothing here now.'
          : `The driver holds arc ${String(r.read)}. The look was written at arc ${String(r.entry?.arc)}${r.look !== undefined && r.look.arc !== r.entry?.arc ? ` and is now arc ${String(r.look.arc)}` : ''}.`;
    }
  }

  async function run(p: ReturnType<AppState['call']>, done: string): Promise<boolean> {
    message = '';
    const r = await p;
    message = r.ok ? done : 'reason' in r ? `Refused: ${r.reason}` : 'Refused.';
    return r.ok;
  }

  async function write(slot: number): Promise<void> {
    const look = lib.looks.find((l) => l.name === pick[slot]);
    if (look === undefined || address === undefined) {
      message = 'Choose a look to write.';
      return;
    }
    const at = address;
    const ok = await run(
      app.call({ op: 'sceneWrite', address: at, slot, look }),
      `"${look.name}" is in slot ${String(slot)} of A${String(at)}, read back.`,
    );
    if (ok)
      design.setLibrary(
        setSlot(designOf(app).value, {
          address: at,
          slot,
          look: look.name,
          arc: look.arc,
          colour: look.colour,
        }),
      );
  }

  async function removeSlot(slot: number): Promise<void> {
    if (address === undefined) return;
    const at = address;
    const ok = await run(
      app.call({ op: 'sceneRemove', address: at, slot }),
      `Slot ${String(slot)} of A${String(at)} is empty.`,
    );
    if (ok) design.setLibrary(clearSlot(designOf(app).value, at, slot));
  }

  function recallOne(slot: number): void {
    if (address === undefined) return;
    const r = row(slot);
    void run(
      app.call({
        op: 'sceneRecall',
        target: short(address),
        slot,
        ...(r.look?.fade === undefined ? {} : { fade: r.look.fade }),
      }),
      `Recalled slot ${String(slot)} on A${String(address)}.`,
    );
  }

  // Recall on several drivers at once.
  let manySlot = $state(0);
  let manyTarget = $state('all');
  let manyFade = $state(false);
  let manyFadeValue = $state<FadeSetting>({ kind: 'standard', value: 4 });

  function recallMany(): void {
    const target: Address = manyTarget === 'all' ? broadcast : group(Number(manyTarget));
    void run(
      app.call({
        op: 'sceneRecall',
        target,
        slot: manySlot,
        ...(manyFade ? { fade: manyFadeValue } : {}),
      }),
      `Recalled slot ${String(manySlot)} on ${manyTarget === 'all' ? 'every driver' : `group ${manyTarget}`}.`,
    );
  }
</script>

<div class="page stack">
  <h1>Looks</h1>
  {#if snap === undefined || !design.loaded}
    <p class="muted">Starting.</p>
  {:else}
    <section class="stack" aria-labelledby="library-h">
      <h2 id="library-h">Library</h2>
      <p class="muted">
        A look is a level, a colour and an optional fade, kept in the app. Nothing is sent until a
        look is written to a driver's slot or recalled.
      </p>
      {#if lib.looks.length === 0}
        <p class="muted">No looks yet.</p>
      {:else}
        <table data-testid="looks">
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">Values</th><th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each lib.looks as l (l.name)}
              <tr>
                <th scope="row">{l.name}</th>
                <td>{lookText(l)}</td>
                <td class="row">
                  <button
                    type="button"
                    aria-label={`Edit ${l.name}`}
                    onclick={() => {
                      edit(l);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${l.name}`}
                    onclick={() => {
                      remove(l);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <div class="row">
        <button
          type="button"
          data-testid="look-new"
          onclick={() => {
            edit(undefined);
          }}
        >
          New look
        </button>
      </div>

      {#if open}
        <div class="card stack" data-testid="look-editor">
          <h3>{editing === undefined ? 'New look' : `Edit "${editing}"`}</h3>
          <label class="row">
            Name <input
              type="text"
              maxlength={MAX_NAME}
              bind:value={name}
              autocomplete="off"
              data-testid="look-name"
            />
          </label>
          <LookFields
            {arc}
            {colour}
            {ceiling}
            onchange={(a: number, c: LookColour) => {
              arc = a;
              colour = c;
            }}
            testid="look"
          />
          <Toggle
            label="Its own fade, set on the driver before a recall"
            checked={ownFade}
            onchange={(v: boolean) => {
              ownFade = v;
            }}
            testid="look-own-fade"
          />
          {#if ownFade}
            <FadePicker
              fadeTime={fade.kind === 'standard' ? fade.value : 0}
              extendedFade={fade.kind === 'extended' ? fade.value : 0}
              onchange={(f: FadeSetting) => {
                fade = f;
              }}
              testid="look-fade"
            />
          {/if}
          {#if devices.length > 0}
            <div class="row">
              <span class="muted">Take what a driver shows now:</span>
              {#each devices as d (d.address)}
                <button
                  type="button"
                  onclick={() => {
                    capture(d.address);
                  }}
                >
                  {app.name(d.address)}
                </button>
              {/each}
            </div>
          {/if}
          <div class="row">
            <button type="button" class="primary" data-testid="look-save" onclick={save}>
              Save
            </button>
            <button
              type="button"
              onclick={() => {
                open = false;
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </section>

    <section class="stack" aria-labelledby="slots-h">
      <h2 id="slots-h">Slots</h2>
      <p class="muted">
        Each driver holds 16 scene slots. Writing stores the look's level and colour in the driver
        and reads the level back. A stored colour cannot be read back, so it is marked assumed.
        {#if onHardware}
          On hardware a recall goes to one driver at a time and only with no fade, until the
          driver's behaviour is confirmed.
        {/if}
      </p>
      {#if devices.length === 0}
        <p class="muted">No driver answered the scan. See Devices.</p>
      {:else}
        <div class="row">
          <label class="row">
            Driver
            <select
              value={String(address)}
              data-testid="slots-driver"
              onchange={(e) => {
                chosen = Number(e.currentTarget.value);
                pick = {};
              }}
            >
              {#each devices as d (d.address)}
                <option value={String(d.address)}>{app.name(d.address)}</option>
              {/each}
            </select>
          </label>
          <button
            type="button"
            onclick={() => {
              if (address !== undefined)
                void run(
                  app.call({ op: 'sceneRead', address }),
                  `Read the slots of A${String(address)}.`,
                );
            }}
          >
            Read the slots again
          </button>
        </div>
        <div class="scroll">
          <table data-testid="slots">
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Look</th>
                <th scope="col">State</th>
                <th scope="col">Write</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each Array.from({ length: SLOTS }, (_, i) => i) as slot (slot)}
                {@const r = row(slot)}
                {@const chip = CHIP[r.state]}
                <tr data-testid={`slot-${String(slot)}`}>
                  <th scope="row">{slot}</th>
                  <td>{r.entry?.look ?? ''}</td>
                  <td>
                    <span class="row" data-testid={`slot-${String(slot)}-state`}>
                      {#if chip !== undefined}<StatusChip kind={chip} />{/if}
                      {stateText(r)}
                      {#if r.state === 'verified' && r.look !== undefined && r.look.colour.kind !== 'none'}
                        <StatusChip kind="assumed" /> colour
                      {/if}
                    </span>
                  </td>
                  <td>
                    <span class="row">
                      <select
                        aria-label={`Look for slot ${String(slot)}`}
                        value={pick[slot] ?? ''}
                        data-testid={`slot-${String(slot)}-look`}
                        onchange={(e) => {
                          pick = { ...pick, [slot]: e.currentTarget.value };
                        }}
                      >
                        <option value="">Choose a look</option>
                        {#each lib.looks as l (l.name)}
                          <option
                            value={l.name}
                            disabled={drive !== undefined && lookFits(l, drive) !== undefined}
                          >
                            {l.name}
                          </option>
                        {/each}
                      </select>
                      <button
                        type="button"
                        aria-label={`Write to slot ${String(slot)}`}
                        data-testid={`slot-${String(slot)}-write`}
                        onclick={() => void write(slot)}
                      >
                        Write
                      </button>
                    </span>
                  </td>
                  <td>
                    <span class="row">
                      <button
                        type="button"
                        aria-label={`Recall slot ${String(slot)}`}
                        data-testid={`slot-${String(slot)}-recall`}
                        disabled={r.read === undefined || r.read === 255}
                        onclick={() => {
                          recallOne(slot);
                        }}
                      >
                        Recall
                      </button>
                      <button
                        type="button"
                        aria-label={`Empty slot ${String(slot)}`}
                        data-testid={`slot-${String(slot)}-remove`}
                        disabled={r.read === 255 && r.entry === undefined}
                        onclick={() => void removeSlot(slot)}
                      >
                        Empty
                      </button>
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="stack" aria-labelledby="recall-h">
      <h2 id="recall-h">Recall on several drivers</h2>
      <p class="muted">
        One command recalls a slot on every driver, or on a group. Each driver goes to what its own
        slot holds. A driver whose slot is empty does not change.
      </p>
      <div class="row">
        <label class="row">
          Slot
          <select bind:value={manySlot} data-testid="many-slot">
            {#each Array.from({ length: SLOTS }, (_, i) => i) as slot (slot)}
              <option value={slot}>{slot}</option>
            {/each}
          </select>
        </label>
        <label class="row">
          On
          <select bind:value={manyTarget} data-testid="many-target">
            <option value="all">every driver</option>
            {#each Array.from({ length: 16 }, (_, i) => i) as g (g)}
              <option value={String(g)}>group {g}</option>
            {/each}
          </select>
        </label>
        <Toggle
          label="Set a fade first"
          checked={manyFade}
          onchange={(v: boolean) => {
            manyFade = v;
          }}
          testid="many-own-fade"
        />
        <button type="button" data-testid="many-recall" onclick={recallMany}>Recall</button>
      </div>
      {#if manyFade}
        <FadePicker
          fadeTime={manyFadeValue.kind === 'standard' ? manyFadeValue.value : 0}
          extendedFade={manyFadeValue.kind === 'extended' ? manyFadeValue.value : 0}
          onchange={(f: FadeSetting) => {
            manyFadeValue = f;
          }}
          testid="many-fade"
        />
      {/if}
    </section>

    <p role="status" aria-live="polite" data-testid="looks-message">{message}</p>
    <BenchPreview {app} light={snap.light} />
  {/if}
</div>

<style>
  .scroll {
    overflow-x: auto;
  }
</style>
