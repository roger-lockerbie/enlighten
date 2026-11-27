<!--
  The mapping editor for one button (SPEC R16, section 10): for each event, what it does; the LED
  mode; and the timers and event filter its plate shares. Every action goes through the governor to
  the current target. Hold dims repeat on the long press repeat timer for as long as the button is down.
-->
<script lang="ts">
  import type { Address } from '../../dali/address.ts';
  import {
    DEFAULT_FILTER,
    DEFAULT_TIMERS,
    EVENT_LABEL,
    isEnabled,
    LIMITS,
  } from '../../switch/button.ts';
  import {
    newAction,
    plateTarget,
    setAction,
    setFilter,
    setLed,
    setTimers,
  } from '../../switch/edit.ts';
  import {
    ACTION_LABEL,
    LED_LABEL,
    MAPPABLE,
    buttonNames,
    targetOf,
    type Action,
    type ActionKind,
    type Layout,
    type LedMode,
    type Plate,
  } from '../../switch/plate.ts';
  import NumberField from '../components/NumberField.svelte';

  let {
    plate,
    button,
    sequences,
    effects,
    onchange,
  }: {
    plate: Plate;
    button: number;
    sequences: readonly string[];
    effects: readonly string[];
    onchange: (p: Plate) => void;
  } = $props();

  const cfg = $derived(plate.buttons[button]);
  const names = $derived(buttonNames(plate.buttons.length as Layout));
  const fallback = $derived(plateTarget(plate));
  const KINDS = Object.keys(ACTION_LABEL) as ActionKind[];
  const t = $derived(plate.timers);
  const SHORT_NOTE =
    'With the double press timer on, a short press waits that long after the release, so every press feels slower.';

  function targetKind(a: Address): 'short' | 'group' | 'broadcast' {
    return a.kind === 'short' || a.kind === 'group' ? a.kind : 'broadcast';
  }

  const nOf = (a: Address): number => (a.kind === 'short' || a.kind === 'group' ? a.n : 0);

  function withTarget(a: Action, target: Address): Action {
    return 'target' in a ? { ...a, target } : a;
  }

  /** A typed timer snapped to its step, so the plate stays one the checks accept. */
  const snap = (v: number, step: number, min: number): number =>
    Math.max(min, Math.round(v / step) * step);

  function changeKind(event: (typeof MAPPABLE)[number], kind: ActionKind): void {
    const a = newAction(kind, fallback);
    const first = sequences[0] ?? effects[0];
    onchange(
      setAction(
        plate,
        button,
        event,
        a.kind === 'run' && first !== undefined
          ? { ...a, what: sequences[0] === undefined ? 'effect' : 'sequence', name: first }
          : a,
      ),
    );
  }

  function changeTarget(
    event: (typeof MAPPABLE)[number],
    a: Action,
    kind: string,
    n: number,
  ): void {
    const target: Address =
      kind === 'broadcast'
        ? { kind: 'broadcast' }
        : {
            kind: kind === 'group' ? 'group' : 'short',
            n: Math.min(n, kind === 'group' ? 15 : 63),
          };
    onchange(setAction(plate, button, event, withTarget(a, target)));
  }

  const FILTER_BITS: readonly { label: string; mask: number; events: string }[] = [
    { label: 'Released', mask: 1 << 0, events: 'released' },
    { label: 'Pressed', mask: 1 << 1, events: 'pressed' },
    { label: 'Short press', mask: 1 << 2, events: 'short' },
    { label: 'Double press', mask: 1 << 3, events: 'double' },
    { label: 'Long press start', mask: 1 << 4, events: 'longStart' },
    { label: 'Long press repeat', mask: 1 << 5, events: 'longRepeat' },
    { label: 'Long press stop', mask: 1 << 6, events: 'longStop' },
    { label: 'Stuck and free', mask: 1 << 7, events: 'stuck' },
  ];
</script>

{#if cfg !== undefined}
  <section
    class="card stack"
    aria-label={`Mapping for ${names[button] ?? ''}`}
    data-testid="mapping"
  >
    <h3>{plate.name}: {names[button]}</h3>
    {#each MAPPABLE as event (event)}
      {@const a = cfg.mapping[event]}
      {@const target = a === undefined ? undefined : targetOf(a)}
      <div class="row wrap map-row" data-testid={`map-${event}`}>
        <label class="row">
          <span class="ev">{EVENT_LABEL[event]}</span>
          <select
            value={a?.kind ?? 'none'}
            data-testid={`map-${event}-kind`}
            onchange={(e) => {
              changeKind(event, e.currentTarget.value as ActionKind);
            }}
          >
            {#each KINDS as k (k)}
              <option value={k} selected={(a?.kind ?? 'none') === k}>{ACTION_LABEL[k]}</option>
            {/each}
          </select>
        </label>
        {#if a !== undefined && target !== undefined}
          <label class="row">
            Target
            <select
              aria-label={`${EVENT_LABEL[event]} target`}
              data-testid={`map-${event}-target`}
              onchange={(e) => {
                changeTarget(event, a, e.currentTarget.value, nOf(target));
              }}
            >
              <option value="short" selected={targetKind(target) === 'short'}>Address</option>
              <option value="group" selected={targetKind(target) === 'group'}>Group</option>
              <option value="broadcast" selected={targetKind(target) === 'broadcast'}>
                Everything
              </option>
            </select>
          </label>
          {#if target.kind === 'short' || target.kind === 'group'}
            <NumberField
              label={`${EVENT_LABEL[event]} number`}
              hideLabel
              value={target.n}
              min={0}
              max={target.kind === 'group' ? 15 : 63}
              onchange={(v: number) => {
                changeTarget(event, a, target.kind, v);
              }}
              testid={`map-${event}-n`}
            />
          {/if}
        {/if}
        {#if a?.kind === 'scene'}
          <NumberField
            label={`${EVENT_LABEL[event]} slot`}
            value={a.slot}
            min={0}
            max={15}
            onchange={(v: number) => {
              onchange(setAction(plate, button, event, { ...a, slot: v }));
            }}
            testid={`map-${event}-slot`}
          />
        {/if}
        {#if a?.kind === 'toggle'}
          <label class="row">
            On with
            <select
              onchange={(e) => {
                onchange(
                  setAction(plate, button, event, {
                    ...a,
                    on: e.currentTarget.value === 'max' ? 'max' : 'last',
                  }),
                );
              }}
            >
              <option value="last" selected={a.on === 'last'}>Last active level</option>
              <option value="max" selected={a.on === 'max'}>Max level</option>
            </select>
          </label>
        {/if}
        {#if a?.kind === 'dim'}
          <label class="row">
            Direction
            <select
              data-testid={`map-${event}-dir`}
              onchange={(e) => {
                const v = e.currentTarget.value;
                onchange(
                  setAction(plate, button, event, {
                    ...a,
                    dir: v === 'up' || v === 'down' ? v : 'alternate',
                  }),
                );
              }}
            >
              <option value="alternate" selected={a.dir === 'alternate'}>
                Alternate each hold
              </option>
              <option value="up" selected={a.dir === 'up'}>Up</option>
              <option value="down" selected={a.dir === 'down'}>Down</option>
            </select>
          </label>
        {/if}
        {#if a?.kind === 'tune'}
          <label class="row">
            Direction
            <select
              onchange={(e) => {
                const v = e.currentTarget.value;
                onchange(
                  setAction(plate, button, event, {
                    ...a,
                    dir: v === 'warmer' || v === 'cooler' ? v : 'alternate',
                  }),
                );
              }}
            >
              <option value="alternate" selected={a.dir === 'alternate'}>
                Alternate each hold
              </option>
              <option value="warmer" selected={a.dir === 'warmer'}>Warmer</option>
              <option value="cooler" selected={a.dir === 'cooler'}>Cooler</option>
            </select>
          </label>
        {/if}
        {#if a?.kind === 'run'}
          <label class="row">
            Kind
            <select
              onchange={(e) => {
                onchange(
                  setAction(plate, button, event, {
                    ...a,
                    what: e.currentTarget.value === 'effect' ? 'effect' : 'sequence',
                    name: (e.currentTarget.value === 'effect' ? effects : sequences)[0] ?? '',
                  }),
                );
              }}
            >
              <option value="sequence" selected={a.what === 'sequence'}>Sequence</option>
              <option value="effect" selected={a.what === 'effect'}>Effect</option>
            </select>
          </label>
          <label class="row">
            Name
            <select
              data-testid={`map-${event}-run`}
              onchange={(e) => {
                onchange(setAction(plate, button, event, { ...a, name: e.currentTarget.value }));
              }}
            >
              <option value="" selected={a.name === ''}>Choose one</option>
              {#each a.what === 'sequence' ? sequences : effects as n (n)}
                <option value={n} selected={a.name === n}>{n}</option>
              {/each}
            </select>
          </label>
        {/if}
      </div>
    {/each}
    <p class="muted small">
      A hold that starts a dim or warmer and cooler action repeats it on every long press repeat,
      and stops when the button is let go. Nothing is sent to an address that is not verified.
    </p>

    <label class="row">
      LED
      <select
        data-testid="led-mode"
        disabled={plate.family !== 'zencontrol'}
        onchange={(e) => {
          onchange(setLed(plate, button, e.currentTarget.value as LedMode));
        }}
      >
        {#each Object.keys(LED_LABEL) as m (m)}
          <option value={m} selected={cfg.led === m}>{LED_LABEL[m as LedMode]}</option>
        {/each}
      </select>
    </label>
    {#if plate.family === 'coupler'}
      <p class="muted small">A coupler has no LEDs, so this plate shows none.</p>
    {:else if plate.family === 'knx'}
      <p class="muted small">
        A KNX touch plate has one central LED. It is white while touched and orange for a touch of
        two surfaces at once.
      </p>
    {/if}
  </section>

  <section
    class="card stack"
    aria-label={`Timers and filter for ${plate.name}`}
    data-testid="timers"
  >
    <h3>Timers and event filter</h3>
    <div class="row wrap">
      <NumberField
        label="Short press"
        value={t.shortMs}
        min={LIMITS.shortMs[0]}
        max={LIMITS.shortMs[1]}
        step={20}
        unit="ms"
        onchange={(v: number) => {
          onchange(setTimers(plate, { ...t, shortMs: snap(v, 20, 20) }));
        }}
        testid="timer-short"
      />
      <NumberField
        label="Double press (0 is off)"
        value={t.doubleMs}
        min={LIMITS.doubleMs[0]}
        max={LIMITS.doubleMs[1]}
        step={20}
        unit="ms"
        onchange={(v: number) => {
          onchange(setTimers(plate, { ...t, doubleMs: snap(v, 20, 0) }));
        }}
        testid="timer-double"
      />
      <NumberField
        label="Repeat"
        value={t.repeatMs}
        min={LIMITS.repeatMs[0]}
        max={LIMITS.repeatMs[1]}
        step={20}
        unit="ms"
        onchange={(v: number) => {
          onchange(setTimers(plate, { ...t, repeatMs: snap(v, 20, 100) }));
        }}
        testid="timer-repeat"
      />
      <NumberField
        label="Stuck"
        value={t.stuckS}
        min={LIMITS.stuckS[0]}
        max={LIMITS.stuckS[1]}
        unit="s"
        onchange={(v: number) => {
          onchange(setTimers(plate, { ...t, stuckS: v }));
        }}
        testid="timer-stuck"
      />
      <NumberField
        label="Minimum pulse"
        value={t.minPulseMs}
        min={LIMITS.minPulseMs[0]}
        max={LIMITS.minPulseMs[1]}
        unit="ms"
        onchange={(v: number) => {
          onchange(setTimers(plate, { ...t, minPulseMs: v }));
        }}
        testid="timer-pulse"
      />
    </div>
    <p class="muted small">{SHORT_NOTE}</p>
    <fieldset class="row wrap">
      <legend>Events the button sends</legend>
      {#each FILTER_BITS as f (f.mask)}
        <label class="row">
          <input
            type="checkbox"
            checked={(plate.filter & f.mask) !== 0}
            data-testid={`filter-${f.events}`}
            onchange={(e) => {
              onchange(
                setFilter(
                  plate,
                  e.currentTarget.checked ? plate.filter | f.mask : plate.filter & ~f.mask & 0xff,
                ),
              );
            }}
          />{f.label}
        </label>
      {/each}
    </fieldset>
    <div class="row">
      <button
        type="button"
        onclick={() => {
          onchange(setFilter(setTimers(plate, DEFAULT_TIMERS), DEFAULT_FILTER));
        }}
      >
        Restore the part 301 defaults
      </button>
      <span class="muted small">
        Filter {isEnabled(plate.filter, 'short') ? 'passes' : 'holds back'} short press.
      </span>
    </div>
  </section>
{/if}

<style>
  .wrap {
    flex-wrap: wrap;
  }
  .ev {
    min-width: 9rem;
  }
  .map-row {
    align-items: center;
  }
</style>
