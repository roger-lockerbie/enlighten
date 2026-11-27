<!--
  The colour picker (docs/UI.md section 3): a hue and saturation field, sliders for the channels past
  red, green and blue (the two whites on the bench), and a raw channel view. The field is for the
  pointer; the hue and saturation sliders beside it do the same from the keyboard and for screen
  readers. Brightness is the level control's job.
-->
<script lang="ts">
  import type { Channels } from '../../engine/engine.ts';
  import { channelsToHue, hueToChannels } from '../../light/hue.ts';
  import { channelName } from '../format.ts';
  import Segmented from './Segmented.svelte';

  let {
    channels,
    count,
    assigned,
    mode,
    onmode,
    onchange,
    disabled = false,
    testid,
  }: {
    channels: readonly number[];
    count: number;
    assigned: readonly (number | undefined)[] | undefined;
    mode: 'colour' | 'raw';
    onmode: (m: 'colour' | 'raw') => void;
    onchange: (ch: Channels, live: boolean) => void;
    disabled?: boolean;
    testid?: string | undefined;
  } = $props();

  const W = 240;
  const H = 120;
  // Svelte sets a bound element to null when it leaves the page, as the field does in Raw mode.
  let canvas = $state<HTMLCanvasElement | null>(null);

  const ch = (i: number) => channels[i] ?? 0;
  const hs = $derived(channelsToHue(ch(0), ch(1), ch(2)));
  const extra = $derived(Array.from({ length: Math.max(0, count - 3) }, (_, k) => k + 3));
  const all = $derived(Array.from({ length: count }, (_, k) => k));

  function full(next: readonly number[]): Channels {
    // Channels the gear does not have are left as they are.
    const out = [0, 1, 2, 3, 4, 5].map((i) => (i < count ? (next[i] ?? 0) : 255));
    return out as unknown as Channels;
  }

  function setHue(hue: number, sat: number, live: boolean): void {
    const [r, g, b] = hueToChannels(hue, sat);
    const next = [...channels];
    next[0] = r;
    next[1] = g;
    next[2] = b;
    onchange(full(next), live);
  }

  function setChannel(i: number, v: number, live: boolean): void {
    const next = [...channels];
    next[i] = Math.min(254, Math.max(0, Math.round(v)));
    onchange(full(next), live);
  }

  $effect(() => {
    const c = canvas;
    if (c === null) return;
    const ctx = c.getContext('2d');
    if (ctx === null) return;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const [r, g, b] = hueToChannels((x / W) * 360, 1 - y / (H - 1));
        const o = (y * W + x) * 4;
        img.data[o] = Math.round((r / 254) * 255);
        img.data[o + 1] = Math.round((g / 254) * 255);
        img.data[o + 2] = Math.round((b / 254) * 255);
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  });

  let dragging = false;
  function fromPointer(e: PointerEvent, live: boolean): void {
    const c = canvas;
    if (c === null || disabled) return;
    const r = c.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setHue(Math.min(359, x * 360), 1 - y, live);
  }
</script>

<div class="cp" data-testid={testid}>
  {#if count >= 3}
    <Segmented
      label="Colour or raw channels"
      options={[
        { value: 'colour', label: 'Colour' },
        { value: 'raw', label: 'Raw channels' },
      ]}
      value={mode}
      onchange={onmode}
      {disabled}
    />
  {/if}

  {#if mode === 'colour' && count >= 3}
    <div class="field-row">
      <div class="field">
        <canvas
          bind:this={canvas}
          width={W}
          height={H}
          aria-hidden="true"
          onpointerdown={(e) => {
            dragging = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e, true);
          }}
          onpointermove={(e) => {
            if (dragging) fromPointer(e, true);
          }}
          onpointerup={(e) => {
            dragging = false;
            fromPointer(e, false);
          }}
        ></canvas>
        <span
          class="dot"
          aria-hidden="true"
          style:left={`${String((hs.hue / 360) * 100)}%`}
          style:top={`${String((1 - hs.saturation) * 100)}%`}
        ></span>
      </div>
      <div class="stack sliders">
        <label class="stack">
          <span class="muted">Hue {Math.round(hs.hue)}°</span>
          <input
            type="range"
            min="0"
            max="359"
            value={Math.round(hs.hue)}
            {disabled}
            oninput={(e) => {
              setHue(Number(e.currentTarget.value), hs.saturation, true);
            }}
          />
        </label>
        <label class="stack">
          <span class="muted">Saturation {Math.round(hs.saturation * 100)}%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(hs.saturation * 100)}
            {disabled}
            oninput={(e) => {
              setHue(hs.hue, Number(e.currentTarget.value) / 100, true);
            }}
          />
        </label>
      </div>
    </div>
    <p class="muted small">
      Screens cannot show LED colours at full saturation. The tape will look more vivid.
    </p>
  {/if}

  <div class="channels">
    {#each mode === 'raw' ? all : extra as i (i)}
      <label class="chan">
        <span>{channelName(i, assigned?.[i])}</span>
        <input
          type="range"
          min="0"
          max="254"
          value={ch(i)}
          {disabled}
          oninput={(e) => {
            setChannel(i, Number(e.currentTarget.value), true);
          }}
        />
        <span
          class="value"
          data-testid={testid === undefined ? undefined : `${testid}-ch${String(i)}`}
        >
          {ch(i)}
        </span>
      </label>
    {/each}
  </div>
</div>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .field-row {
    display: flex;
    gap: var(--space-4);
    align-items: flex-start;
  }
  .field {
    position: relative;
    width: 240px;
    height: 120px;
    flex: none;
  }
  canvas {
    display: block;
    width: 240px;
    height: 120px;
    border-radius: var(--radius);
    cursor: crosshair;
    touch-action: none;
  }
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 2px solid var(--bg);
    outline: 1px solid var(--text);
    border-radius: 50%;
    pointer-events: none;
  }
  .sliders {
    flex: 1;
    min-width: 10rem;
  }
  .channels {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }
  .chan {
    display: grid;
    grid-template-columns: 7rem 1fr 3rem;
    align-items: center;
    gap: var(--space-2);
  }
  .value {
    text-align: right;
  }
  input[type='range'] {
    accent-color: var(--accent);
    width: 100%;
  }
</style>
