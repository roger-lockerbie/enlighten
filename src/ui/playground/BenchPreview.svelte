<!--
  The bench preview (SPEC R13.6): each tape in 2D at its relative brightness and colour, from the
  simulator, or in Hardware and Both from the shadow simulator as a prediction. It changes only when
  the light does, which the rate guard already limits, and has no animation of its own (SPEC S6).
-->
<script lang="ts">
  import { mirekToKelvin } from '../../dali/sequences.ts';
  import type { LightView } from '../../engine/engine.ts';
  import { previewColour } from '../../light/preview.ts';
  import StatusChip from '../components/StatusChip.svelte';
  import { percent } from '../format.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app, light }: { app: AppState; light: readonly LightView[] } = $props();

  const prediction = $derived(app.snap !== undefined && app.snap.target !== 'simulator');

  function describe(l: LightView): string {
    if (l.target <= 0 && l.level <= 0) return 'off';
    const level = `${percent(Math.round(l.level))}%`;
    const tc = l.labels.some((t) => t === 'WW' || t === 'CW') && !l.labels.includes('R');
    const colour = tc
      ? `${String(Math.round(mirekToKelvin(l.mirek)))} K`
      : `channels ${l.channels.slice(0, l.labels.filter((t) => t !== 'unused').length).join(' ')}`;
    return `${level}  ${colour}${l.fading ? ', fading' : ''}`;
  }
</script>

<section class="card preview" aria-labelledby="preview-h" data-testid="bench-preview">
  <header class="row">
    <h2 id="preview-h">Bench preview ({prediction ? 'prediction' : 'simulator'})</h2>
    <StatusChip kind={prediction ? 'prediction' : 'estimated'} />
  </header>
  {#if light.length === 0}
    <p class="muted">Nothing to show until the bench has been scanned.</p>
  {/if}
  {#each light as l (l.unit)}
    {@const c = previewColour(l.terminals, l.labels)}
    <div class="tape-row" data-testid={`tape-${String(l.address)}`}>
      <span class="name">Tape {l.unit.startsWith('hw') ? `at A${String(l.address)}` : l.unit}</span>
      <span
        class="tape"
        role="img"
        aria-label={`${app.name(l.address)}: ${describe(l)}`}
        style:--tape={`rgb(${String(c.rgb[0])} ${String(c.rgb[1])} ${String(c.rgb[2])})`}
      ></span>
      <span class="text" data-testid="tape-text">{app.name(l.address)} {describe(l)}</span>
    </div>
  {/each}
  <p class="muted small">
    An estimate: placeholder tape colours, each white channel assumed to give as much light as red,
    green and blue together, on a scale shared by both tapes.
  </p>
</section>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .tape-row {
    display: grid;
    grid-template-columns: 6rem 1fr 18rem;
    align-items: center;
    gap: var(--space-3);
  }
  .tape {
    height: 16px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--tape);
  }
  .text {
    white-space: pre;
  }
</style>
