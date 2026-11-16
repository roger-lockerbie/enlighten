<!--
  Scripts (SPEC R9, section 7, ADR 0014). Lists the built-in and stored scripts, with an editor that
  shows parse errors by line. A script is data: saving or importing one never runs it. It runs only
  through the console's run, in the bus worker, where every step goes through the governor with the
  source script. Import reads a .txt file within the script limits. Export is a data: URL.
-->
<script lang="ts">
  import { aliasProblem } from '../../console/parse.ts';
  import { BUILTIN_SCRIPTS, builtin } from '../../script/builtin.ts';
  import {
    MAX_BYTES,
    MAX_SCRIPT_NAME,
    parseScript,
    scriptNameProblem,
  } from '../../script/parse.ts';
  import { MAX_SCRIPTS, type StoredScript } from '../../store/schema.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  /** The script open in the editor, by name, or undefined for a new one. */
  let open = $state<string | undefined>('first-light');
  let name = $state('first-light');
  let text = $state(builtin('first-light')?.text ?? '');
  let message = $state('');
  let problem = $state('');
  let deleting = $state(false);

  const isBuiltin = $derived(open !== undefined && builtin(open) !== undefined);
  const saved = $derived(
    open === undefined
      ? undefined
      : (builtin(open) ?? app.scripts.find((s) => s.name.toLowerCase() === open?.toLowerCase())),
  );
  const dirty = $derived(saved?.name !== name || saved.text !== text);

  const parsed = $derived.by(() => {
    const aliases = new Map(
      app.prefs.aliases
        .filter((a) => aliasProblem(a.alias) === undefined)
        .map((a) => [a.alias.toLowerCase(), a.address]),
    );
    return parseScript(text, { aliases });
  });

  function show(s: StoredScript | undefined): void {
    open = s?.name;
    name = s?.name ?? '';
    text = s?.text ?? '';
    message = '';
    problem = '';
    deleting = false;
  }

  async function save(): Promise<void> {
    message = '';
    problem = '';
    const bad = scriptNameProblem(name);
    if (bad !== undefined) {
      problem = bad;
      return;
    }
    if (builtin(name) !== undefined) {
      problem = `"${name}" is the name of a built-in script. Choose another.`;
      return;
    }
    const others = app.scripts.filter((s) => s.name.toLowerCase() !== open?.toLowerCase());
    if (others.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      problem = `A script called "${name}" is already stored.`;
      return;
    }
    if (others.length >= MAX_SCRIPTS) {
      problem = `At most ${String(MAX_SCRIPTS)} scripts are stored.`;
      return;
    }
    const at = app.scripts.findIndex((s) => s.name.toLowerCase() === open?.toLowerCase());
    const next = [...app.scripts];
    if (at >= 0) next.splice(at, 1, { name, text });
    else next.push({ name, text });
    const why = await app.saveScripts(next);
    if (why !== undefined) {
      problem = why;
      return;
    }
    open = name;
    message = parsed.ok
      ? `Saved ${name}.`
      : `Saved ${name}. It has errors, so run will refuse it until they are fixed.`;
  }

  async function remove(): Promise<void> {
    const gone = open;
    const why = await app.saveScripts(
      app.scripts.filter((s) => s.name.toLowerCase() !== gone?.toLowerCase()),
    );
    if (why !== undefined) {
      problem = why;
      return;
    }
    show(builtin('first-light'));
    message = `Deleted ${gone ?? ''}.`;
  }

  function run(): void {
    if (open === undefined) return;
    app.update({ drawerOpen: true });
    app.console.submit(`run "${open}"`);
  }

  /** A script name from a file name. */
  function nameFrom(file: string): string {
    const base = file
      .replace(/\.[^.]*$/, '')
      .replace(/[^A-Za-z0-9 ._-]/g, '-')
      .replace(/^[^A-Za-z0-9]+/, '')
      .slice(0, MAX_SCRIPT_NAME);
    return base === '' ? 'imported' : base;
  }

  async function choose(input: HTMLInputElement): Promise<void> {
    message = '';
    problem = '';
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    // Size first, before reading a byte of it (ADR 0007).
    if (file.size > MAX_BYTES) {
      problem = `Refused: a script is at most ${String(MAX_BYTES / 1024)} kB.`;
      return;
    }
    let body: string;
    try {
      body = await file.text();
    } catch {
      problem = 'Refused: the file could not be read.';
      return;
    }
    open = undefined;
    name = nameFrom(file.name);
    text = body;
    deleting = false;
    message = 'Imported into the editor and not saved. Nothing has run. Check it, then Save.';
  }

  const exportHref = $derived(`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
</script>

<div class="page stack">
  <h1>Scripts</h1>
  <p class="muted">
    A script is a list of console commands, one a line, with <code>wait</code>,
    <code>pause</code>, <code>echo</code> and <code>repeat</code>. It is only text until you type
    <code>run</code> in the console. Every step goes through the safety governor, a refused step stops
    it, and Ctrl-C or Panic stops it at once.
  </p>
  <div class="split">
    <nav aria-label="Scripts" class="stack">
      <ul data-testid="script-list">
        {#each BUILTIN_SCRIPTS as s (s.name)}
          <li>
            <button
              type="button"
              aria-current={open === s.name ? 'true' : undefined}
              onclick={() => {
                show(s);
              }}>{s.name} <span class="muted small">built in</span></button
            >
          </li>
        {/each}
        {#each app.scripts as s (s.name)}
          <li>
            <button
              type="button"
              aria-current={open?.toLowerCase() === s.name.toLowerCase() ? 'true' : undefined}
              onclick={() => {
                show(s);
              }}>{s.name}</button
            >
          </li>
        {/each}
      </ul>
      <div class="row">
        <button
          type="button"
          onclick={() => {
            show(undefined);
          }}
          data-testid="script-new">New</button
        >
        <label class="button">
          Import
          <input
            type="file"
            accept=".txt,text/plain"
            class="sr-only"
            data-testid="script-import"
            onchange={(e) => void choose(e.currentTarget)}
          />
        </label>
      </div>
    </nav>

    <section class="stack editor" aria-labelledby="script-h">
      <h2 id="script-h">{open ?? 'New script'}</h2>
      <label class="stack">
        <span>Name</span>
        <input
          type="text"
          bind:value={name}
          maxlength={MAX_SCRIPT_NAME}
          readonly={isBuiltin}
          data-testid="script-name"
        />
      </label>
      <label class="stack">
        <span>Script</span>
        <textarea
          bind:value={text}
          rows="16"
          spellcheck="false"
          readonly={isBuiltin}
          data-testid="script-text"></textarea>
      </label>
      <div aria-live="polite" data-testid="script-parse">
        {#if parsed.ok}
          <p class="muted small">
            It parses: {parsed.steps.length} steps once repeats are counted.
          </p>
        {:else}
          <p>It does not parse. Run refuses it until these are fixed:</p>
          <ul class="mono small">
            {#each parsed.errors as e, i (i)}
              <li>{e.line === 0 ? e.text : `line ${String(e.line)}: ${e.text}`}</li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="row">
        {#if !isBuiltin}
          <button
            type="button"
            class="primary"
            onclick={() => void save()}
            data-testid="script-save">Save</button
          >
        {/if}
        <button
          type="button"
          disabled={open === undefined || dirty || !parsed.ok}
          onclick={run}
          data-testid="script-run">Run in the console</button
        >
        <a
          class="button"
          href={exportHref}
          download={`${name === '' ? 'script' : name}.txt`}
          data-testid="script-export">Export</a
        >
        {#if !isBuiltin && open !== undefined}
          {#if deleting}
            <span>Delete {open}? It cannot be undone.</span>
            <button type="button" class="danger" onclick={() => void remove()}>Delete</button>
            <button
              type="button"
              onclick={() => {
                deleting = false;
              }}>Keep it</button
            >
          {:else}
            <button
              type="button"
              onclick={() => {
                deleting = true;
              }}
              data-testid="script-delete">Delete</button
            >
          {/if}
        {/if}
      </div>
      {#if dirty && open !== undefined && !isBuiltin}<p class="muted small">
          Save before running: run uses the stored script.
        </p>{/if}
      {#if message !== ''}<p role="status" data-testid="script-message">{message}</p>{/if}
      {#if problem !== ''}<p role="alert" data-testid="script-problem">{problem}</p>{/if}
    </section>
  </div>
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  nav li button {
    width: 100%;
    text-align: left;
    justify-content: flex-start;
    background: transparent;
    border-color: transparent;
  }
  nav li button[aria-current='true'] {
    background: var(--raised);
    border-color: var(--line);
  }
  textarea {
    font-family: var(--font-mono);
    width: 100%;
    resize: vertical;
  }
  .editor ul {
    list-style: disc;
    padding-left: var(--space-5);
  }
  .button {
    display: inline-flex;
    align-items: center;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-3);
    min-height: 28px;
    color: var(--text);
    text-decoration: none;
    cursor: pointer;
  }
  label.button:focus-within {
    outline: var(--focus-width) solid var(--accent);
    outline-offset: var(--focus-offset);
  }
</style>
