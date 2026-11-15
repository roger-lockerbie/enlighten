<!--
  One device on the Playground (SPEC R13, section 4.1). The controls follow what the gear reports
  (SPEC D2): a level for every driver, colour temperature for Tc gear, colour and channels for RGBWAF
  gear. Live sends as a control moves, coalesced by the engine. Commit sends nothing until Apply.
-->
<script lang="ts">
  import { short } from '../../dali/address.ts';
  import { arcToFraction, percentToArcNearest } from '../../dali/curve.ts';
  import { kelvinToMirek, mirekToKelvin } from '../../dali/sequences.ts';
  import type {
    Channels,
    DeviceView,
    FadeSetting,
    Intent,
    LightView,
  } from '../../engine/engine.ts';
  import ColourPicker from '../components/ColourPicker.svelte';
  import FadePicker from '../components/FadePicker.svelte';
  import PairedSlider from '../components/PairedSlider.svelte';
  import StatusChip, { type ChipKind } from '../components/StatusChip.svelte';
  import Toggle from '../components/Toggle.svelte';
  import { channelName, percent } from '../format.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app, device, light }: { app: AppState; device: DeviceView; light: LightView | undefined } =
    $props();

  const n = $derived(device.address);
  const facts = $derived(device.facts);
  const drive = $derived(facts?.drive ?? 'level');
  const live = $derived(app.prefs.playgroundMode === 'live');
  const ceiling = $derived(app.snap?.ceilingArc ?? 220);
  const minimum = $derived(facts?.minLevel ?? facts?.physicalMinimum ?? 1);
  const coolest = $derived(facts?.tcLimits?.coolest ?? 154);
  const warmest = $derived(facts?.tcLimits?.warmest ?? 370);
  const count = $derived(facts?.colour?.channels ?? 0);

  // What the controls show. In Live mode they follow the gear between edits. In Commit mode they hold
  // what has been set until Apply.
  let arc = $state(0);
  let mirek = $state(0);
  let channels = $state<number[]>([0, 0, 0, 0, 0, 255]);
  let fade = $state<FadeSetting | undefined>(undefined);
  let colourMode = $state<'colour' | 'raw'>('colour');
  let message = $state<{ state: ChipKind; text: string } | undefined>(undefined);
  let editedAt = -Infinity;
  let synced = false;

  $effect(() => {
    const l = light;
    if (l === undefined) return;
    const quiet = performance.now() - editedAt > 1500;
    if (!synced || (live && quiet)) {
      arc = Math.round(l.target);
      mirek = l.mirek > 0 ? l.mirek : Math.round((coolest + warmest) / 2);
      channels = [...l.channels];
      synced = true;
    }
  });

  const feedbackFor = (control: string) => {
    const f = app.snap?.feedback.find((x) => x.key === `${control}:${String(n)}`);
    return f === undefined ? undefined : { state: f.state, text: f.text };
  };

  async function request(intent: Intent): Promise<boolean> {
    const r = await app.call({ op: 'request', intent });
    if (!r.ok && 'reason' in r) {
      message = { state: 'refused', text: `Refused: ${r.reason}` };
      return false;
    }
    const note = 'note' in r ? r.note : undefined;
    if (note !== undefined && note !== '') message = { state: 'clamped', text: note };
    return true;
  }

  function touch(): void {
    editedAt = performance.now();
    message = undefined;
  }

  function setLevel(v: number, moving: boolean): void {
    touch();
    arc = v;
    if (live) void request({ kind: 'level', address: n, arc: v, live: moving });
  }

  function setMirek(v: number): void {
    touch();
    mirek = v;
    if (live) void request({ kind: 'tc', address: n, mirek: v });
  }

  function setChannels(ch: Channels): void {
    touch();
    channels = [...ch];
    if (live) void request({ kind: 'rgbwaf', address: n, channels: ch });
  }

  function setFade(f: FadeSetting): void {
    touch();
    fade = f;
    if (live) void request({ kind: 'apply', address: n, fade: f });
  }

  async function apply(): Promise<void> {
    touch();
    const ok = await request({
      kind: 'apply',
      address: n,
      arc,
      ...(fade === undefined ? {} : { fade }),
      ...(drive === 'tc' ? { mirek } : {}),
      ...(drive === 'rgbwaf' ? { channels: channels as unknown as Channels } : {}),
    });
    if (ok) {
      fade = undefined;
      synced = false;
      message ??= { state: 'sent', text: 'Applied.' };
    }
  }

  function command(id: string): Promise<boolean> {
    touch();
    return request({ kind: 'commands', commands: [{ id, address: short(n) }] });
  }

  // Hold to dim: UP or DOWN now and every 200 ms while held (SPEC section 4.1).
  let holding: ReturnType<typeof setInterval> | undefined;
  function startDim(id: 'UP' | 'DOWN'): void {
    stopDim();
    void command(id);
    holding = setInterval(() => {
      void command(id).then((ok) => {
        if (!ok) stopDim();
      });
    }, 200);
  }
  function stopDim(): void {
    clearInterval(holding);
    holding = undefined;
  }

  // Leaving the page, or the page losing focus, ends a hold (security review S5-L3).
  $effect(() => {
    const stop = () => {
      stopDim();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      stopDim();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  });

  function holdKeys(id: 'UP' | 'DOWN') {
    return {
      onkeydown: (e: KeyboardEvent) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          startDim(id);
        }
      },
      onkeyup: (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') stopDim();
      },
    };
  }

  const presents = $derived(
    drive === 'tc'
      ? 'Presents as colour temperature (Tc).'
      : drive === 'rgbwaf'
        ? `Presents as RGBWAF, ${String(count)} channels: ${Array.from({ length: count }, (_, i) =>
            channelName(i, facts?.assigned?.[i]).toLowerCase(),
          ).join(', ')}.`
        : 'Level only.',
  );

  const fadeTime = $derived(
    fade?.kind === 'standard' ? fade.value : fade?.kind === 'extended' ? 0 : (light?.fadeTime ?? 0),
  );
  const extendedFade = $derived(
    fade?.kind === 'extended' ? fade.value : (light?.extendedFade ?? 0),
  );
</script>

<section
  class="panel card"
  aria-labelledby={`dev-${String(n)}-h`}
  data-testid={`panel-${String(n)}`}
>
  <header class="row head">
    <h2 id={`dev-${String(n)}-h`}>{app.name(n)}</h2>
    <StatusChip kind={device.ceiling} testid="panel-status" />
    <button
      type="button"
      class="inspect"
      aria-pressed={app.selected === n}
      onclick={() => {
        app.selected = n;
      }}>Inspect</button
    >
  </header>
  <p class="muted small">{presents}</p>

  <PairedSlider
    label="Level"
    value={arc}
    min={0}
    max={254}
    home={minimum}
    end={ceiling}
    right={{ label: 'arc level', unit: 'arc' }}
    left={{
      label: 'output',
      unit: '%',
      decimals: 1,
      step: 0.1,
      min: 0,
      max: 100,
      to: (v: number) => Math.round(arcToFraction(v) * 1000) / 10,
      from: (p: number) => percentToArcNearest(p),
    }}
    markers={[
      { at: minimum, label: `minimum ${percent(minimum)}%` },
      { at: ceiling, label: `ceiling ${percent(ceiling)}%` },
    ]}
    feedback={live ? feedbackFor('level') : undefined}
    onchange={setLevel}
    onenter={live ? undefined : () => void apply()}
    testid={`level-${String(n)}`}
  />

  <div class="row">
    <Toggle
      label="Power"
      checked={(light?.target ?? 0) > 0}
      onchange={(on) => void command(on ? 'GO_TO_LAST_ACTIVE_LEVEL' : 'OFF')}
      testid={`power-${String(n)}`}
    />
    <button type="button" aria-label="Step down one level" onclick={() => void command('STEP_DOWN')}
      >−1</button
    >
    <button type="button" aria-label="Step up one level" onclick={() => void command('STEP_UP')}
      >+1</button
    >
    <button
      type="button"
      onpointerdown={() => {
        startDim('DOWN');
      }}
      onpointerup={stopDim}
      onpointerleave={stopDim}
      onpointercancel={stopDim}
      onblur={stopDim}
      {...holdKeys('DOWN')}>Dim down</button
    >
    <button
      type="button"
      onpointerdown={() => {
        startDim('UP');
      }}
      onpointerup={stopDim}
      onpointerleave={stopDim}
      onpointercancel={stopDim}
      onblur={stopDim}
      {...holdKeys('UP')}>Dim up</button
    >
  </div>

  {#if drive === 'tc'}
    <PairedSlider
      label="Colour temperature"
      value={mirek}
      min={coolest}
      max={warmest}
      reverse
      right={{ label: 'mirek', unit: 'mirek' }}
      left={{
        label: 'kelvin',
        unit: 'K',
        decimals: 0,
        step: 10,
        min: Math.round(mirekToKelvin(warmest)),
        max: Math.round(mirekToKelvin(coolest)),
        to: (v: number) => Math.round(mirekToKelvin(v)),
        from: (k: number) => kelvinToMirek(k),
      }}
      feedback={live ? feedbackFor('tc') : undefined}
      onchange={(v: number) => {
        setMirek(v);
      }}
      onenter={live ? undefined : () => void apply()}
      testid={`tc-${String(n)}`}
    />
  {:else if drive === 'rgbwaf'}
    <ColourPicker
      {channels}
      {count}
      assigned={facts?.assigned}
      mode={colourMode}
      onmode={(m: 'colour' | 'raw') => {
        colourMode = m;
      }}
      onchange={(ch: Channels) => {
        setChannels(ch);
      }}
      testid={`colour-${String(n)}`}
    />
    {#if live}
      {@const f = feedbackFor('rgbwaf')}
      {#if f !== undefined}
        <p class="small row" role="status" data-testid={`colour-${String(n)}-feedback`}>
          <StatusChip kind={f.state} />{f.text}
        </p>
      {/if}
    {/if}
  {/if}

  <FadePicker
    {fadeTime}
    {extendedFade}
    fastFade={light?.fastFade ?? 0}
    fast27Ms={light?.fast27Ms}
    onchange={setFade}
    testid={`fade-${String(n)}`}
  />

  {#if !live}
    <div class="row">
      <button type="button" class="primary" onclick={() => void apply()}>Apply</button>
      <span class="muted small">Nothing is sent until Apply, or Enter on a slider.</span>
    </div>
  {/if}
  {#if message !== undefined}
    <p class="small row" role="status" data-testid={`message-${String(n)}`}>
      <StatusChip kind={message.state} />{message.text}
    </p>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 22rem;
  }
  .head {
    justify-content: space-between;
  }
  .head h2 {
    flex: 1;
  }
  .inspect[aria-pressed='true'] {
    border-color: var(--accent);
  }
</style>
