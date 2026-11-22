<!--
  The level and colour of a look or a sequence step: the playground's controls, with a choice of
  what kind of colour the value carries. Nothing here sends anything.
-->
<script lang="ts">
  import { arcToFraction, percentToArcNearest } from '../../dali/curve.ts';
  import { kelvinToMirek, mirekToKelvin } from '../../dali/sequences.ts';
  import type { LookColour } from '../../design/look.ts';
  import type { Channels } from '../../engine/engine.ts';
  import ColourPicker from '../components/ColourPicker.svelte';
  import PairedSlider from '../components/PairedSlider.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { percent } from '../format.ts';

  let {
    arc,
    colour,
    ceiling,
    onchange,
    testid,
  }: {
    arc: number;
    colour: LookColour;
    ceiling: number;
    onchange: (arc: number, colour: LookColour) => void;
    testid: string;
  } = $props();

  const COOLEST = 154;
  const WARMEST = 370;
  let colourMode = $state<'colour' | 'raw'>('colour');

  function kind(k: LookColour['kind']): void {
    if (k === colour.kind) return;
    onchange(
      arc,
      k === 'none'
        ? { kind: 'none' }
        : k === 'tc'
          ? { kind: 'tc', mirek: WARMEST }
          : { kind: 'rgbwaf', channels: [0, 0, 0, 0, 0, 255] },
    );
  }
</script>

<div class="stack" data-testid={testid}>
  <PairedSlider
    label="Level"
    value={arc}
    min={0}
    max={254}
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
    markers={[{ at: ceiling, label: `ceiling ${percent(ceiling)}%` }]}
    onchange={(v: number) => {
      onchange(v, colour);
    }}
    testid={`${testid}-level`}
  />
  <Segmented
    label="Colour"
    options={[
      { value: 'none', label: 'Unchanged' },
      { value: 'tc', label: 'Colour temperature' },
      { value: 'rgbwaf', label: 'RGBWAF' },
    ]}
    value={colour.kind}
    onchange={kind}
    testid={`${testid}-kind`}
  />
  {#if colour.kind === 'tc'}
    <PairedSlider
      label="Colour temperature"
      value={colour.mirek}
      min={COOLEST}
      max={WARMEST}
      reverse
      right={{ label: 'mirek', unit: 'mirek' }}
      left={{
        label: 'kelvin',
        unit: 'K',
        decimals: 0,
        step: 10,
        min: Math.round(mirekToKelvin(WARMEST)),
        max: Math.round(mirekToKelvin(COOLEST)),
        to: (v: number) => Math.round(mirekToKelvin(v)),
        from: (k: number) => kelvinToMirek(k),
      }}
      onchange={(v: number) => {
        onchange(arc, { kind: 'tc', mirek: v });
      }}
      testid={`${testid}-tc`}
    />
  {:else if colour.kind === 'rgbwaf'}
    <ColourPicker
      channels={colour.channels}
      count={5}
      assigned={undefined}
      mode={colourMode}
      onmode={(m: 'colour' | 'raw') => {
        colourMode = m;
      }}
      onchange={(ch: Channels) => {
        onchange(arc, { kind: 'rgbwaf', channels: ch });
      }}
      testid={`${testid}-colour`}
    />
  {/if}
</div>
