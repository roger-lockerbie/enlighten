<!--
  Settings (docs/UI.md section 1): preferences, workspace export and import, records set aside, and
  the key legend. An import lists what will change and asks first. It never raises the ceiling. A
  lower ceiling is applied as the ceiling control applies it, which writes MAX LEVEL to every driver
  through the governor. Nothing else it holds reaches the lights (SPEC section 8).
-->
<script lang="ts">
  import { MAX_BYTES } from '../../store/validate.ts';
  import { exportWorkspace, readWorkspace, type ImportPlan } from '../../store/store.ts';
  import { DEFAULT_SETUP, type BenchUnit, type UnitSetup } from '../../sim/settings.ts';
  import Dialog from '../components/Dialog.svelte';
  import Segmented from '../components/Segmented.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  let importError = $state('');
  let plan = $state<ImportPlan | undefined>(undefined);
  let importDone = $state('');
  let setAside = $state<string[]>([]);

  /** The bench's units sit at addresses 0 and 1 (SPEC R14.1). */
  const UNIT_AT: Readonly<Record<number, BenchUnit>> = { 0: 'A', 1: 'B' };

  $effect(() => {
    void app.store.setAside().then((k) => {
      setAside = k;
    });
  });

  const exportText = $derived.by(() => {
    const snap = app.snap;
    const bench = snap?.bench ?? [];
    const devices: {
      address: number;
      alias?: string;
      presentation?: 'tc' | 'rgbwaf';
      settings?: UnitSetup['settings'];
    }[] = [];
    for (const n of [0, 1]) {
      const unit = UNIT_AT[n];
      const setup = bench.find((b) => b.unit === unit)?.setup;
      if (setup === undefined) continue;
      devices.push({ address: n, presentation: setup.presentation, settings: setup.settings });
    }
    for (const a of app.prefs.aliases) {
      const d = devices.find((x) => x.address === a.address);
      if (d === undefined) devices.push({ address: a.address, alias: a.alias });
      else d.alias = a.alias;
    }
    return exportWorkspace({
      ceiling: snap?.ceilingArc ?? app.prefs.ceilingArc,
      preferences: {
        playgroundMode: app.prefs.playgroundMode,
        reducedMotion: app.prefs.reducedMotion,
      },
      devices: devices.sort((x, y) => x.address - y.address),
    });
  });
  const exportHref = $derived(
    `data:application/json;charset=utf-8,${encodeURIComponent(exportText)}`,
  );

  async function choose(input: HTMLInputElement): Promise<void> {
    importError = '';
    importDone = '';
    plan = undefined;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    // Size first, before reading a byte of it (ADR 0009).
    if (file.size > MAX_BYTES) {
      importError = 'The file is larger than 2 MB.';
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      importError = 'The file could not be read.';
      return;
    }
    const r = readWorkspace(text, { ceilingArc: app.snap?.ceilingArc ?? app.prefs.ceilingArc });
    if (!r.ok) {
      importError = r.error;
      return;
    }
    plan = r.value;
  }

  async function apply(p: ImportPlan): Promise<void> {
    plan = undefined;
    const w = p.workspace;
    const notes: string[] = [];
    if (p.lowerCeiling !== undefined && !(await app.setCeiling(p.lowerCeiling, false)))
      notes.push(`The ceiling was not lowered: ${app.ceilingMessage}`);
    const prefs = w.preferences;
    if (prefs?.playgroundMode !== undefined) app.update({ playgroundMode: prefs.playgroundMode });
    // Reduced motion applies only when it makes the app more careful.
    if (prefs?.reducedMotion === 'always') app.update({ reducedMotion: 'always' });
    const aliases = [...app.prefs.aliases];
    const bench: Partial<Record<BenchUnit, UnitSetup>> = {};
    for (const d of w.devices ?? []) {
      if (d.alias !== undefined) {
        const i = aliases.findIndex((a) => a.address === d.address);
        if (i >= 0) aliases.splice(i, 1);
        if (d.alias !== '') aliases.push({ address: d.address, alias: d.alias });
      }
      if (d.presentation === undefined && d.settings === undefined) continue;
      const unit = UNIT_AT[d.address];
      if (unit === undefined) {
        notes.push(
          `A${String(d.address)}: no simulated unit there, so its settings were not used.`,
        );
        continue;
      }
      const now = app.snap?.bench.find((b) => b.unit === unit)?.setup ?? DEFAULT_SETUP[unit];
      bench[unit] = {
        presentation: d.presentation ?? now.presentation,
        settings: d.settings ?? now.settings,
      };
    }
    app.update({ aliases });
    if (Object.keys(bench).length > 0) {
      const r = await app.call({ op: 'bench', setup: bench });
      if (r.ok) app.update({ bench: { ...app.prefs.bench, ...bench } });
      else
        notes.push(
          `The simulator settings were not applied: ${'reason' in r ? r.reason : 'refused'}.`,
        );
    }
    importDone = ['Imported.', ...notes].join(' ');
  }

  const KEYS: readonly [string, string][] = [
    ['Escape, twice within 500 ms', 'Panic, from anywhere, including dialogs'],
    ['Ctrl `', 'Show or hide the console, and move focus to it'],
    ['Alt 1 to Alt 4', 'Go to a page, in the order of the rail'],
    ['F6, Shift F6', 'Move between regions: top bar, rail, main, inspector, console'],
    ['Tab, Shift Tab', 'Move between controls'],
    ['Left, Right, Up, Down', 'Step a slider or field by one unit'],
    ['Shift with an arrow', 'Step by ten'],
    ['Home, End', "The driver's minimum, and the ceiling"],
    ['Enter', 'Apply, in Commit mode'],
    ['Space, held', 'Hold a dim button'],
  ];
</script>

<div class="page stack">
  <h1>Settings</h1>

  <section class="stack" aria-labelledby="prefs-h">
    <h2 id="prefs-h">Preferences</h2>
    <div class="row">
      <span class="label">Playground sends</span>
      <Segmented
        label="Playground sends"
        options={[
          { value: 'live', label: 'Live' },
          { value: 'commit', label: 'Commit' },
        ]}
        value={app.prefs.playgroundMode}
        onchange={(m: 'live' | 'commit') => {
          app.update({ playgroundMode: m });
        }}
      />
    </div>
    <div class="row">
      <span class="label">Reduce motion</span>
      <Segmented
        label="Reduce motion"
        options={[
          { value: 'system', label: 'As the system says' },
          { value: 'always', label: 'Always' },
        ]}
        value={app.prefs.reducedMotion}
        onchange={(m: 'system' | 'always') => {
          app.update({ reducedMotion: m });
        }}
        testid="reduced-motion"
      />
    </div>
    <p class="muted small">
      Preferences are kept in this browser only. Unlocks, the panic latch and the connection are not
      kept: a reload starts with none of them.
    </p>
  </section>

  <section class="stack" aria-labelledby="ws-h">
    <h2 id="ws-h">Workspace</h2>
    <p class="muted">
      A workspace file holds the ceiling, these preferences, device names and the simulator
      settings. Importing one lists what will change first. A lower ceiling in the file is applied
      at once, which rewrites MAX LEVEL in every driver. A higher one is not applied. Nothing else
      in the file reaches the lights.
    </p>
    <div class="row">
      <a class="button" href={exportHref} download="enlighten-workspace.json" data-testid="export"
        >Export the workspace</a
      >
      <label class="button">
        Import a workspace
        <input
          type="file"
          accept=".json,application/json"
          class="sr-only"
          data-testid="import"
          onchange={(e) => void choose(e.currentTarget)}
        />
      </label>
    </div>
    {#if importError !== ''}<p role="alert" data-testid="import-error">
        Refused: {importError}
      </p>{/if}
    {#if importDone !== ''}<p role="status" data-testid="import-done">{importDone}</p>{/if}
  </section>

  <section class="stack" aria-labelledby="aside-h">
    <h2 id="aside-h">Records set aside</h2>
    {#if setAside.length === 0}
      <p class="muted">
        None. A stored record that fails its checks is set aside here, not deleted.
      </p>
    {:else}
      <ul>
        {#each setAside as k (k)}<li class="mono">{k}</li>{/each}
      </ul>
      <button
        type="button"
        onclick={() =>
          void app.store.discardSetAside().then(() => {
            setAside = [];
          })}>Discard them</button
      >
    {/if}
  </section>

  <section class="stack" aria-labelledby="keys-h">
    <h2 id="keys-h">Keys</h2>
    <table data-testid="key-legend">
      <thead><tr><th scope="col">Key</th><th scope="col">Does</th></tr></thead>
      <tbody>
        {#each KEYS as [k, d] (k)}
          <tr><td><kbd>{k}</kbd></td><td>{d}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>

<Dialog
  open={plan !== undefined}
  title="Import this workspace?"
  onclose={() => {
    plan = undefined;
  }}
  testid="import-dialog"
>
  <div class="stack">
    {#if plan?.changes.length === 0}
      <p>The file changes nothing.</p>
    {:else}
      <ul data-testid="import-changes">
        {#each plan?.changes ?? [] as c, i (i)}<li>{c}</li>{/each}
      </ul>
    {/if}
    <p class="muted small">
      Only a lower ceiling reaches the lights: it rewrites MAX LEVEL in every driver.
    </p>
    <div class="row end">
      <button
        type="button"
        onclick={() => {
          plan = undefined;
        }}>Cancel</button
      >
      <button
        type="button"
        class="primary"
        onclick={() => {
          if (plan !== undefined) void apply(plan);
        }}>Import</button
      >
    </div>
  </div>
</Dialog>

<style>
  .label {
    width: 10rem;
    color: var(--text-muted);
  }
  .button {
    display: inline-flex;
    align-items: center;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-3);
    min-height: 28px;
    color: var(--text);
    text-decoration: none;
    cursor: pointer;
  }
  label.button:focus-within {
    outline: var(--focus-width) solid var(--accent);
    outline-offset: var(--focus-offset);
  }
  .end {
    justify-content: flex-end;
  }
</style>
