<!-- The page rail (docs/UI.md section 1). Only built pages are shown. Alt with a digit goes to one. -->
<script lang="ts">
  import type { Page } from '../../store/schema.ts';
  import { RAIL } from './rail.ts';

  let { page, onpage }: { page: Page; onpage: (p: Page) => void } = $props();

  /** The tenth page is on Alt-0. */
  const key = (i: number): string => String((i + 1) % 10);
</script>

<nav class="rail" aria-label="Pages" data-region="rail" tabindex="-1">
  <ul>
    {#each RAIL as r, i (r.page)}
      <li>
        <button
          type="button"
          aria-current={page === r.page ? 'page' : undefined}
          aria-keyshortcuts={`Alt+${key(i)}`}
          onclick={() => {
            onpage(r.page);
          }}
        >
          <span>{r.label}</span>
          <kbd class="muted" aria-hidden="true">Alt {key(i)}</kbd>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .rail {
    grid-area: rail;
    background: var(--surface);
    border-right: 1px solid var(--line);
    padding: var(--space-3) var(--space-2);
    overflow: auto;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: transparent;
    border-color: transparent;
    text-align: left;
  }
  button[aria-current='page'] {
    background: var(--raised);
    border-color: var(--line);
    border-left: 2px solid var(--accent);
  }
</style>
