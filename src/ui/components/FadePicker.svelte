<!--
  The fade picker (SPEC R13.4, docs/UI.md section 3): the 15 standard fade times and the extended
  values, grouped, with the gaps in the extended range marked, and a line saying which fade the driver
  will use and why.
-->
<script lang="ts">
  import { extendedFadeMs, extendedFades, fadeInUse, standardFades } from '../../dali/fade.ts';
  import type { FadeSetting } from '../../engine/engine.ts';
  import { duration } from '../format.ts';

  let {
    fadeTime,
    extendedFade,
    fastFade = 0,
    onchange,
    disabled = false,
    testid,
  }: {
    fadeTime: number;
    extendedFade: number;
    fastFade?: number;
    onchange: (f: FadeSetting) => void;
    disabled?: boolean;
    testid?: string | undefined;
  } = $props();

  const standard = standardFades();
  const extended = extendedFades();

  const selected = $derived(
    fadeTime > 0
      ? `s:${String(fadeTime)}`
      : extendedFadeMs(extendedFade) > 0
        ? `e:${String(extendedFade)}`
        : 'none',
  );
  const inUse = $derived(fadeInUse(fadeTime, extendedFade, fastFade));

  function choose(v: string): void {
    if (v === 'none') onchange({ kind: 'extended', value: 0 });
    else if (v.startsWith('s:')) onchange({ kind: 'standard', value: Number(v.slice(2)) });
    else onchange({ kind: 'extended', value: Number(v.slice(2)) });
  }
</script>

<div class="fp" data-testid={testid}>
  <label class="row">
    <span class="muted">Fade</span>
    <select
      value={selected}
      {disabled}
      onchange={(e) => {
        choose(e.currentTarget.value);
      }}
    >
      <option value="none">No fade</option>
      <optgroup label="Standard fade time">
        {#each standard as o (o.value)}
          <option value={`s:${String(o.value)}`}
            >{duration(o.ms)} (standard fade time {o.value})</option
          >
        {/each}
      </optgroup>
      <optgroup label="Extended fade time">
        {#each extended as o (o.value)}
          <option value={`e:${String(o.value)}`}
            >{duration(o.ms)}{o.gapBefore === true ? ' (larger steps from here)' : ''}</option
          >
        {/each}
      </optgroup>
    </select>
  </label>
  <p class="muted small" data-testid={testid === undefined ? undefined : `${testid}-why`}>
    {inUse.why}
    {inUse.ms > 0 ? `A level change takes ${duration(inUse.ms)}.` : ''}
  </p>
</div>

<style>
  .fp {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
