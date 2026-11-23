<!--
  One plate, drawn generically with no logos (SPEC R16.1): a square divided into one, two or four
  buttons, each with its LED. A button takes mouse and touch through pointer events, and the keyboard
  through Space and Enter held down (R16.2). Down and up go to the worker, which keeps the time.
-->
<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { ledTarget, type Plate } from '../../switch/plate.ts';
  import { ledLit } from '../../switch/led.ts';
  import { EVENT_LABEL } from '../../switch/button.ts';
  import { buttonNames, type Layout } from '../../switch/plate.ts';
  import type { AppState } from '../state.svelte.ts';

  let {
    app,
    plate,
    selected,
    onselect,
  }: {
    app: AppState;
    plate: Plate;
    selected: number;
    onselect: (i: number) => void;
  } = $props();

  const layout = $derived(plate.buttons.length as Layout);
  const names = $derived(buttonNames(layout));
  const view = $derived(app.snap?.switches.find((v) => v.id === plate.id));
  const devices = $derived(app.snap?.devices ?? []);

  /** Whether a button's target is on, from the drivers' levels as the governor predicts them. */
  function targetOn(i: number): boolean | undefined {
    const cfg = plate.buttons[i];
    const t = cfg === undefined ? undefined : ledTarget(cfg);
    if (t === undefined) return undefined;
    const levels = devices
      .filter(
        (d) =>
          t.kind === 'broadcast' ||
          (t.kind === 'short' && d.address === t.n) ||
          (t.kind === 'group' && d.groups !== undefined && (d.groups & (1 << t.n)) !== 0),
      )
      .map((d) => d.level);
    if (levels.length === 0 || levels.every((l) => l === undefined)) return undefined;
    return levels.some((l) => l !== undefined && l > 0);
  }

  const lit = (i: number): boolean => {
    const cfg = plate.buttons[i];
    return cfg !== undefined && ledLit(cfg.led, targetOn(i));
  };

  // KNX plates have one central LED: white while touched, orange for a touch of two surfaces.
  const touched = $derived(view?.buttons.some((b) => b.down) === true);
  const multi = $derived(view?.multi === true);

  const held = new SvelteSet<number>();

  function down(i: number): void {
    if (held.has(i)) return;
    held.add(i);
    onselect(i);
    void app.call({ op: 'switchInput', plate: plate.id, button: i, down: true });
  }

  function up(i: number): void {
    if (!held.delete(i)) return;
    void app.call({ op: 'switchInput', plate: plate.id, button: i, down: false });
  }

  function releaseAll(): void {
    for (const i of [...held]) up(i);
  }

  const isPress = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';
</script>

<svelte:window onblur={releaseAll} />

<div
  class={`plate layout-${String(layout)}`}
  data-testid={`plate-${plate.id}`}
  data-family={plate.family}
>
  {#each [...plate.buttons.keys()] as i (i)}
    <button
      type="button"
      class="pad"
      class:selected={selected === i}
      class:pressed={view?.buttons[i]?.down === true}
      aria-label={`${plate.name}, ${names[i] ?? `button ${String(i + 1)}`}`}
      aria-pressed={view?.buttons[i]?.down === true}
      data-testid={`plate-${plate.id}-button-${String(i)}`}
      onpointerdown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the browser no longer knows: the press still counts.
        }
        down(i);
      }}
      onpointerup={() => {
        up(i);
      }}
      onpointercancel={() => {
        up(i);
      }}
      onlostpointercapture={() => {
        up(i);
      }}
      onkeydown={(e) => {
        if (!isPress(e)) return;
        e.preventDefault();
        if (!e.repeat) down(i);
      }}
      onkeyup={(e) => {
        if (!isPress(e)) return;
        e.preventDefault();
        up(i);
      }}
      onblur={() => {
        up(i);
      }}
      oncontextmenu={(e) => {
        e.preventDefault();
      }}
    >
      <span class="name">{names[i] ?? ''}</span>
      {#if plate.family === 'zencontrol'}
        <span
          class="led"
          class:lit={lit(i)}
          data-lit={lit(i)}
          data-testid={`plate-${plate.id}-led-${String(i)}`}
          aria-hidden="true"
        ></span>
      {/if}
    </button>
  {/each}
  {#if plate.family === 'knx'}
    <span
      class="centre-led"
      class:lit={touched}
      class:multi
      data-lit={touched}
      data-testid={`plate-${plate.id}-led`}
      aria-hidden="true"
    ></span>
  {/if}
</div>

<ul class="events small" aria-label={`Last events of ${plate.name}`}>
  {#each [...plate.buttons.keys()] as i (i)}
    <li data-testid={`plate-${plate.id}-last-${String(i)}`}>
      {names[i] ?? ''}:
      {view?.buttons[i]?.last === undefined
        ? 'no event yet'
        : EVENT_LABEL[view.buttons[i].last]}{view?.buttons[i]?.stuck === true ? ' (stuck)' : ''}
    </li>
  {/each}
</ul>

<style>
  .plate {
    position: relative;
    display: grid;
    gap: 3px;
    width: 10rem;
    height: 10rem;
    padding: 6px;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    touch-action: none;
    user-select: none;
  }
  .layout-1 {
    grid-template: 1fr / 1fr;
  }
  .layout-2 {
    grid-template: 1fr 1fr / 1fr;
  }
  .layout-4 {
    grid-template: 1fr 1fr / 1fr 1fr;
  }
  .pad {
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text-muted);
    font-size: 0.7rem;
    padding: 0.25rem;
  }
  .pad.pressed {
    background: var(--line);
  }
  .pad.selected {
    border-color: var(--accent);
  }
  .led {
    position: absolute;
    top: 6px;
    left: 50%;
    width: 14px;
    height: 4px;
    transform: translateX(-50%);
    border-radius: 2px;
    background: var(--line);
  }
  .led.lit {
    background: var(--accent);
  }
  .centre-led {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 10px;
    height: 10px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--line);
    pointer-events: none;
  }
  .centre-led.lit {
    background: var(--text);
  }
  .centre-led.multi {
    background: var(--warn);
  }
  /* A DALI-2 coupler behind a designer plate: a slim plate with round volt-free push buttons and no
     LEDs, since a coupler has none (research section 4). */
  .plate[data-family='coupler'] {
    width: 5.5rem;
    height: auto;
    min-height: 10rem;
    padding: 12px 8px;
    gap: 12px;
    justify-items: center;
    align-content: space-evenly;
    background: var(--text-muted);
    border-color: var(--text);
    border-radius: 10px;
  }
  .plate[data-family='coupler'].layout-4 {
    width: 7.5rem;
    grid-template: 1fr 1fr / 1fr 1fr;
  }
  .plate[data-family='coupler'] .pad {
    width: 2.6rem;
    height: 2.6rem;
    padding: 0;
    border-radius: 50%;
    background: var(--bg);
    border: 2px solid var(--surface);
  }
  .plate[data-family='coupler'] .pad.pressed {
    background: var(--line);
    border-color: var(--accent);
  }
  .plate[data-family='coupler'] .name {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  /* A KNX touch plate: a glass square with touch surfaces and no moving buttons, and one central LED
     (research section 5). */
  .plate[data-family='knx'] {
    gap: 1px;
    padding: 4px;
    background: var(--viewport);
    border-color: var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .plate[data-family='knx'] .pad {
    background: var(--raised);
    border: none;
    border-radius: 0;
    align-items: center;
    opacity: 0.9;
  }
  .plate[data-family='knx'] .pad.pressed {
    background: var(--line);
    opacity: 1;
  }
  .plate[data-family='knx'] .pad.selected {
    outline: 1px solid var(--accent);
    outline-offset: -3px;
  }
  .events {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
