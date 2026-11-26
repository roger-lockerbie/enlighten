<!--
  The manual (ADR 0024): the Markdown pages in `docs/manual/`, bundled with the app and drawn as
  ordinary elements. Every word is a text node. Nothing in a page is handed to the browser as markup,
  a link goes only to another page of the manual, and an image is shown only if the build has it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { ManualPage, Section } from '../../manual/book.ts';
  import type { Block, Inline } from '../../manual/markdown.ts';
  import type { AppState } from '../state.svelte.ts';

  /** The manual's pages and the functions over them, which arrive as one chunk (ADR 0024). */
  type Lib = typeof import('../../manual/pages.ts');

  let { app, lib }: { app: AppState; lib: Lib } = $props();
  const { book, images, findPage, resolveLink, resolvePath, search, SECTION_TITLES } =
    $derived(lib);

  let query = $state('');
  let article = $state<HTMLElement | undefined>(undefined);

  /** The page shown: the one last chosen this session, or the first. */
  const page = $derived(book.byPath.get(app.manualPath) ?? book.pages[0]);
  const index = $derived(book.pages.findIndex((p) => p.path === page?.path));
  const previous = $derived(index > 0 ? book.pages[index - 1] : undefined);
  const next = $derived(index >= 0 ? book.pages[index + 1] : undefined);
  const hits = $derived(search(book, query));

  const SECTIONS: readonly Section[] = ['start', 'guide', 'reference', 'generated', 'other'];
  const inSection = (s: Section): ManualPage[] => book.pages.filter((p) => p.section === s);

  /** Go to a page, and to a heading on it if one is named. */
  function go(to: string, anchor?: string): void {
    app.manualPath = to;
    query = '';
    void tick().then(() => {
      const target =
        anchor === undefined ? undefined : article?.querySelector(`[id="m-${CSS.escape(anchor)}"]`);
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' });
      else article?.scrollTo({ top: 0 });
      article?.focus();
    });
  }

  // `manual <page>` and F1 ask through the app's state.
  let asked = 0;
  $effect(() => {
    const ask = app.manualAsk;
    if (ask.n === asked) return;
    asked = ask.n;
    if (ask.name === undefined) return;
    const found = findPage(book, ask.name);
    if (found !== undefined) go(found.path);
    else query = ask.name;
  });

  function follow(href: string): void {
    if (page === undefined) return;
    const t = resolveLink(book, page.path, href);
    if (t.kind === 'page') go(t.path, t.anchor);
    else if (t.kind === 'anchor') go(page.path, t.anchor);
  }

  const linkKind = (href: string) =>
    page === undefined ? 'none' : resolveLink(book, page.path, href).kind;

  /** An address the manual does not follow, shown beside the link's words. */
  const outside = (href: string): string => (/^https?:\/\//i.test(href) ? ` (${href})` : '');

  const imageUrl = (src: string): string | undefined => {
    const p = page === undefined ? undefined : resolvePath(page.path, src);
    return p === undefined ? undefined : images.get(p);
  };

  /** The lines of a console block that are commands: not blank, and not comments. */
  const isCommand = (line: string): boolean => line.trim() !== '' && !line.trim().startsWith('#');

  /** Put a line in the console's input, ready to edit or send. It is not sent. */
  function putInConsole(line: string): void {
    app.update({ drawerOpen: true });
    app.console.input(line, line.length);
    void tick().then(() => document.getElementById('console-input')?.focus());
  }
</script>

{#snippet inline(nodes: readonly Inline[])}
  {#each nodes as n, i (i)}
    {#if n.t === 'text'}{n.v}{:else if n.t === 'code'}<code>{n.v}</code
      >{:else if n.t === 'strong'}<strong>{@render inline(n.c)}</strong>{:else if n.t === 'em'}<em
        >{@render inline(n.c)}</em
      >{:else if linkKind(n.href) === 'none'}<span class="nolink"
        >{@render inline(n.c)}{outside(n.href)}</span
      >{:else}<button
        type="button"
        class="link"
        onclick={() => {
          follow(n.href);
        }}>{@render inline(n.c)}</button
      >{/if}
  {/each}
{/snippet}

{#snippet blocks(bs: readonly Block[])}
  {#each bs as b, i (i)}
    {#if b.t === 'heading'}
      {#if b.level === 1}
        <h1 id={`m-${b.id}`}>{@render inline(b.c)}</h1>
      {:else if b.level === 2}
        <h2 id={`m-${b.id}`}>{@render inline(b.c)}</h2>
      {:else if b.level === 3}
        <h3 id={`m-${b.id}`}>{@render inline(b.c)}</h3>
      {:else}
        <h4 id={`m-${b.id}`}>{@render inline(b.c)}</h4>
      {/if}
    {:else if b.t === 'para'}
      <p>{@render inline(b.c)}</p>
    {:else if b.t === 'code'}
      {#if b.lang === 'console'}
        <ul class="console" aria-label="Console lines">
          {#each b.text.split('\n') as line, j (j)}
            <li>
              <code>{line}</code>
              {#if isCommand(line)}
                <button
                  type="button"
                  class="put small"
                  aria-label={`Put in console: ${line}`}
                  onclick={() => {
                    putInConsole(line);
                  }}>Put in console</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <pre><code>{b.text}</code></pre>
      {/if}
    {:else if b.t === 'list'}
      {#if b.ordered}
        <ol>
          {#each b.items as item, j (j)}
            <li>{@render blocks(item)}</li>
          {/each}
        </ol>
      {:else}
        <ul>
          {#each b.items as item, j (j)}
            <li>{@render blocks(item)}</li>
          {/each}
        </ul>
      {/if}
    {:else if b.t === 'table'}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              {#each b.head as cell, j (j)}
                <th scope="col">{@render inline(cell)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each b.rows as row, j (j)}
              <tr>
                {#each row as cell, k (k)}
                  <td>{@render inline(cell)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if b.t === 'quote'}
      <blockquote>{@render blocks(b.c)}</blockquote>
    {:else if b.t === 'callout'}
      <aside class={`callout ${b.kind}`}>
        <p class="callout-title">
          <span class="kind"
            >{b.kind === 'warning' ? 'Warning' : b.kind === 'tip' ? 'Tip' : 'Note'}</span
          >{b.title === '' ? '' : ` ${b.title}`}
        </p>
        {@render blocks(b.c)}
      </aside>
    {:else if b.t === 'image'}
      {@const url = imageUrl(b.src)}
      {#if url !== undefined}
        <figure>
          <img src={url} alt={b.alt} loading="lazy" />
          {#if b.alt !== ''}<figcaption class="muted small">{b.alt}</figcaption>{/if}
        </figure>
      {:else}
        <p class="muted">[Picture: {b.alt}]</p>
      {/if}
    {:else}
      <hr />
    {/if}
  {/each}
{/snippet}

<div class="manual" data-testid="manual">
  <nav class="contents" aria-label="Manual contents">
    <label class="stack">
      <span class="muted small">Find in the manual</span>
      <input type="search" bind:value={query} data-testid="manual-find" autocomplete="off" />
    </label>
    {#if query.trim() !== ''}
      <ul class="hits" data-testid="manual-hits">
        {#each hits as h (h.page.path)}
          <li>
            <button
              type="button"
              class="link"
              onclick={() => {
                go(h.page.path);
              }}>{h.page.title}</button
            >
            <span class="muted small">{h.snippet}</span>
          </li>
        {:else}
          <li class="muted">Nothing in the manual has that.</li>
        {/each}
      </ul>
    {:else}
      {#each SECTIONS as s (s)}
        {#if inSection(s).length > 0}
          <h2 class="muted small">{SECTION_TITLES[s]}</h2>
          <ul>
            {#each inSection(s) as p (p.path)}
              <li>
                <button
                  type="button"
                  class="entry"
                  aria-current={p.path === page?.path ? 'page' : undefined}
                  onclick={() => {
                    go(p.path);
                  }}>{p.title}</button
                >
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}
  </nav>
  <article
    bind:this={article}
    tabindex="-1"
    aria-label={page?.title ?? 'Manual'}
    data-testid="manual-page"
  >
    {#if page === undefined}
      <p class="muted">The manual has no pages in this build.</p>
    {:else}
      {@render blocks(page.doc.blocks)}
      <footer class="row">
        {#if previous !== undefined}
          <button
            type="button"
            onclick={() => {
              go(previous.path);
            }}>Previous: {previous.title}</button
          >
        {/if}
        {#if next !== undefined}
          <button
            type="button"
            class="next"
            onclick={() => {
              go(next.path);
            }}>Next: {next.title}</button
          >
        {/if}
      </footer>
    {/if}
  </article>
</div>

<style>
  .manual {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: var(--space-5);
    height: 100%;
  }
  .contents {
    overflow: auto;
    border-right: 1px solid var(--line);
    padding-right: var(--space-3);
  }
  .contents ul {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
  }
  .contents h2 {
    margin: var(--space-3) 0 var(--space-1);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .contents input {
    width: 100%;
  }
  .entry {
    width: 100%;
    text-align: left;
    background: transparent;
    border-color: transparent;
  }
  .entry[aria-current='page'] {
    background: var(--raised);
    border-color: var(--line);
    border-left: 2px solid var(--accent);
  }
  .hits li {
    margin-bottom: var(--space-2);
    display: flex;
    flex-direction: column;
  }
  article {
    overflow: auto;
    padding-right: var(--space-4);
    max-width: 920px;
    line-height: 1.55;
  }
  article :global(h1) {
    margin-bottom: var(--space-3);
  }
  article :global(h2) {
    margin: var(--space-5) 0 var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }
  article :global(h3),
  article :global(h4) {
    margin: var(--space-4) 0 var(--space-1);
    font-weight: 500;
  }
  article :global(p) {
    margin: 0 0 var(--space-3);
  }
  article :global(li > p) {
    margin-bottom: var(--space-1);
  }
  article :global(ol),
  article :global(ul) {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-5);
  }
  .link {
    display: inline;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
  .nolink {
    color: var(--text);
  }
  code {
    background: var(--raised);
    padding: 0 3px;
    border-radius: var(--radius);
  }
  pre {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-3);
    overflow-x: auto;
    margin: 0 0 var(--space-3);
  }
  pre code {
    background: none;
    padding: 0;
  }
  ul.console {
    list-style: none;
    padding: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-left: 2px solid var(--accent);
    border-radius: var(--radius);
  }
  ul.console li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 24px;
  }
  ul.console code {
    background: none;
    padding: 0;
    white-space: pre-wrap;
  }
  .put {
    padding: 0 var(--space-2);
    flex: none;
  }
  .scroll {
    overflow-x: auto;
    margin-bottom: var(--space-3);
  }
  table {
    width: 100%;
  }
  blockquote {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-3);
    border-left: 2px solid var(--line);
    color: var(--text-muted);
  }
  .callout {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
  }
  .callout.warning {
    border-left-color: var(--warn);
  }
  .callout-title {
    font-weight: 500;
    margin-bottom: var(--space-1);
  }
  .callout.warning .kind {
    color: var(--warn);
  }
  .callout :global(p:last-child) {
    margin-bottom: 0;
  }
  figure {
    margin: 0 0 var(--space-4);
  }
  img {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    display: block;
  }
  hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: var(--space-4) 0;
  }
  footer {
    margin: var(--space-5) 0 var(--space-6);
    justify-content: space-between;
  }
  .next {
    margin-left: auto;
  }
</style>
