<!--
  The Manual page (ADR 0024). The page itself is small and loads with the other later pages. Its
  text, and the code that reads it, are a chunk of their own that loads when the manual is opened.
-->
<script lang="ts">
  import ManualView from '../manual/ManualView.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const lib = import('../../manual/pages.ts');
</script>

{#await lib}
  <p class="muted">Loading the manual.</p>
{:then loaded}
  <ManualView {app} lib={loaded} />
{:catch}
  <p class="muted" role="alert">The manual could not be loaded. Reload the page.</p>
{/await}
