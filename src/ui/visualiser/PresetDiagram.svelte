<!--
  A small drawing of a set-up: the hallway in cross-section, with each mount where it sits on its
  wall and an arrow the way its light goes (SPEC R11.4). Drawn from the preset's own data.
-->
<script lang="ts">
  import type { Scene } from '../../light/scene.ts';
  import { section } from '../../light/setup.ts';

  let { scene }: { scene: Scene } = $props();

  // The section, 60 wide by 60 high, inside a 72 by 68 box.
  const X0 = 6;
  const X1 = 66;
  const Y0 = 4;
  const Y1 = 64;
  const marks = $derived(
    section(scene).map((m) => {
      const x = m.side === 'left' ? X0 : X1;
      const into = m.side === 'left' ? 1 : -1;
      const y = Y1 - m.y * (Y1 - Y0) - (m.kind === 'skirting' ? 2 : 0);
      // The light: into the room for a channel, up or down for a slot or reveal.
      const tip =
        m.kind === 'channel'
          ? { x: x + into * 12, y }
          : { x: x + into * 6, y: y + (m.facing === 'up' ? -10 : 10) };
      return { x, y, into, tip, kind: m.kind };
    }),
  );
</script>

<svg viewBox="0 0 72 68" width="72" height="68" aria-hidden="true" class="diagram">
  <rect class="room" x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} />
  {#each marks as m, i (i)}
    {#if m.kind === 'channel'}
      <line class="mount" x1={m.x} y1={m.y - 2.5} x2={m.x} y2={m.y + 2.5} />
    {:else}
      <rect class="slot" x={m.into === 1 ? m.x - 3 : m.x} y={m.y - 1.5} width="3" height="3" />
    {/if}
    <line class="ray" x1={m.x} y1={m.y} x2={m.tip.x} y2={m.tip.y} />
    <circle class="tip" cx={m.tip.x} cy={m.tip.y} r="1.4" />
  {/each}
</svg>

<style>
  .diagram {
    display: block;
  }
  .room {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1;
  }
  .mount {
    stroke: var(--accent);
    stroke-width: 3;
  }
  .slot {
    fill: var(--accent);
  }
  .ray {
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 2 1.5;
  }
  .tip {
    fill: var(--accent);
  }
</style>
