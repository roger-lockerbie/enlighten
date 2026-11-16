<!--
  The app shell (docs/UI.md section 2): top bar, banner, rail, main view, inspector and console
  drawer. Preferences load first, so the bus worker starts with the stored ceiling and bench set-up.
  A stored ceiling above the default is not applied at start: the banner offers it back with a typed
  confirmation (ADR 0013).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { DEFAULT_PREFERENCES, type Page } from './store/schema.ts';
  import { Store } from './store/store.ts';
  import { BusClient, readToken } from './ui/bus.ts';
  import { IdbBackend } from './ui/idb.ts';
  import BusMonitor from './ui/pages/BusMonitor.svelte';
  import Devices from './ui/pages/Devices.svelte';
  import Playground from './ui/pages/Playground.svelte';
  import Settings from './ui/pages/Settings.svelte';
  import Banner from './ui/shell/Banner.svelte';
  import CeilingDialogs from './ui/shell/CeilingDialogs.svelte';
  import ConsoleDrawer from './ui/shell/ConsoleDrawer.svelte';
  import Inspector from './ui/shell/Inspector.svelte';
  import Rail from './ui/shell/Rail.svelte';
  import { RAIL } from './ui/shell/rail.ts';
  import TopBar from './ui/shell/TopBar.svelte';
  import Scripts from './ui/pages/Scripts.svelte';
  import { AppState, startCeiling, type Stored } from './ui/state.svelte.ts';
  import { ScreenWake } from './ui/wakelock.ts';

  // The token leaves the address bar at once, goes to the bus worker, and the page keeps no copy.
  const read = readToken();
  const tokenProblem = read.problem;
  const store = new Store(new IdbBackend(), () => new Date().toISOString().replaceAll(':', '-'));

  let app = $state<AppState | undefined>(undefined);

  /** Preferences, history and scripts, or the defaults if IndexedDB is slow or blocked. */
  async function loadStored(): Promise<Stored> {
    const [p, h, s] = await Promise.all([
      store.loadPreferences(),
      store.loadHistory(),
      store.loadScripts(),
    ]);
    const problem = [p.problem, h.problem, s.problem].filter((x) => x !== undefined).join(' ');
    return {
      prefs: p.value,
      history: h.value,
      scripts: s.value,
      ...(problem === '' ? {} : { problem }),
    };
  }

  function load(): Promise<Stored> {
    const late: Stored = {
      prefs: DEFAULT_PREFERENCES,
      history: [],
      scripts: [],
      problem: 'Stored preferences took too long to read, so the defaults are in use.',
    };
    return Promise.race([
      loadStored(),
      new Promise<Stored>((resolve) => {
        setTimeout(() => {
          resolve(late);
        }, 2000);
      }),
    ]);
  }

  void load().then((stored) => {
    const start = startCeiling(stored.prefs.ceilingArc);
    const client = new BusClient(read.token, { ceilingArc: start, bench: stored.prefs.bench });
    app = new AppState(client, store, stored, start);
  });

  const page = $derived<Page>(app?.prefs.page ?? 'playground');

  function setPage(p: Page): void {
    app?.update({ page: p });
  }

  function panic(): void {
    app?.client.panic();
  }

  // A screen wake lock while a script runs (SPEC S5.2).
  const wake = new ScreenWake((why) => {
    app?.console.print('note', why);
  });
  $effect(() => {
    wake.want(app?.snap?.script !== undefined);
  });

  /** Ask before leaving with a half-typed console line or a script running. */
  function beforeUnload(e: BeforeUnloadEvent): void {
    if (app?.console.guarded === true) e.preventDefault();
  }

  // Less motion when asked for in Settings, as well as when the system asks (SPEC S6.2).
  $effect(() => {
    const always = app?.prefs.reducedMotion === 'always';
    if (always) document.documentElement.dataset['motion'] = 'reduce';
    else delete document.documentElement.dataset['motion'];
  });

  const REGIONS = ['topbar', 'rail', 'main', 'inspector', 'console'];

  function cycleRegion(back: boolean): void {
    const present = REGIONS.map((r) =>
      document.querySelector<HTMLElement>(`[data-region="${r}"]`),
    ).filter((el): el is HTMLElement => el !== null);
    if (present.length === 0) return;
    const here = document.activeElement?.closest('[data-region]');
    const i = present.findIndex((el) => el === here);
    const next = present[(i + (back ? -1 : 1) + present.length) % present.length];
    next?.focus();
  }

  // Escape twice within 500 ms is panic, from anywhere on the page, dialogs included (SPEC S4.2).
  // This listens in the capture phase, so nothing on the page can stop it first.
  let lastEscape = -Infinity;
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      const now = e.timeStamp;
      if (now - lastEscape <= 500) {
        lastEscape = -Infinity;
        panic();
      } else {
        lastEscape = now;
      }
      return;
    }
    if (app === undefined) return;
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Backquote') {
      e.preventDefault();
      const open = !app.prefs.drawerOpen;
      app.update({ drawerOpen: open });
      if (open)
        void tick().then(() =>
          document.querySelector<HTMLElement>('[data-region="console"]')?.focus(),
        );
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const m = /^Digit([1-9])$/.exec(e.code);
      const target = m?.[1] === undefined ? undefined : RAIL[Number(m[1]) - 1];
      if (target !== undefined) {
        e.preventDefault();
        setPage(target.page);
        return;
      }
    }
    if (e.key === 'F6') {
      e.preventDefault();
      cycleRegion(e.shiftKey);
    }
  }

  const TITLES: Record<Page, string> = {
    playground: 'Playground',
    devices: 'Devices',
    monitor: 'Bus monitor',
    settings: 'Settings',
    scripts: 'Scripts',
  };
</script>

<svelte:window onkeydowncapture={onKey} onbeforeunload={beforeUnload} />
<svelte:head><title>{TITLES[page]}: Enlighten</title></svelte:head>

{#if app === undefined}
  <div class="loading">
    <span class="mark">Enlighten</span>
    <span class="muted">Starting.</span>
    <button type="button" class="panic" disabled>Panic</button>
  </div>
{:else}
  <div
    class="shell"
    class:no-inspector={!app.prefs.inspectorOpen}
    class:with-console={app.prefs.drawerOpen}
  >
    <TopBar {app} onPanic={panic} />
    <Banner {app} {tokenProblem} />
    <Rail {page} onpage={setPage} />
    <main data-region="main" tabindex="-1">
      {#if !app.prefs.inspectorOpen}
        <button
          type="button"
          class="show-inspector"
          onclick={() => {
            app?.update({ inspectorOpen: true });
          }}>Show inspector</button
        >
      {/if}
      {#if page === 'playground'}
        <Playground {app} />
      {:else if page === 'devices'}
        <Devices {app} />
      {:else if page === 'monitor'}
        <BusMonitor {app} />
      {:else if page === 'scripts'}
        <Scripts {app} />
      {:else}
        <Settings {app} />
      {/if}
    </main>
    {#if app.prefs.inspectorOpen}<Inspector {app} {page} />{/if}
    {#if app.prefs.drawerOpen}<ConsoleDrawer {app} />{/if}
  </div>
  <CeilingDialogs {app} />
{/if}

<style>
  .shell {
    display: grid;
    height: 100vh;
    grid-template-columns: var(--rail) minmax(0, 1fr) var(--inspector);
    grid-template-rows: var(--topbar) auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top top top'
      'banner banner banner'
      'rail main inspector'
      'rail console console';
  }
  .shell.no-inspector {
    grid-template-columns: var(--rail) minmax(0, 1fr) 0;
  }
  main {
    grid-area: main;
    overflow: auto;
    padding: var(--space-5) var(--space-6);
    position: relative;
  }
  main:focus-visible,
  :global([data-region]:focus-visible) {
    outline-offset: -2px;
  }
  .show-inspector {
    position: absolute;
    top: var(--space-3);
    right: var(--space-4);
  }
  .loading {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: var(--topbar);
    padding: 0 var(--space-4);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .mark {
    font-size: var(--size-3);
    font-weight: 500;
  }
  .panic {
    margin-left: auto;
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
</style>
