<!--
  The console drawer (docs/UI.md sections 2 and 4, SPEC section 6). A one-line input driven by the
  console's binding table, a scrollback that is a log, a status line for search, completion, pauses
  and confirmations, and an alert region for refusals and panic. It opens to 220 px, drags taller,
  and remembers its height. Ctrl-` shows or hides it and moves focus to the input.

  Keys: Tab is taken only when there is something to complete. The first Escape closes a search or a
  list, the next releases focus, so Tab then leaves. Ctrl-C copies a selection, and with none abandons
  the line and stops a running line or script. Every frame goes through the governor in the worker.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { DRAWER_MAX, DRAWER_MIN } from '../../store/schema.ts';
  import { keyPress } from '../console.svelte.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const con = $derived(app.console);
  const height = $derived(app.prefs.drawerHeight);
  const script = $derived(app.snap?.script);
  let dragFrom: { y: number; h: number } | undefined;
  let drawer: HTMLElement | undefined = $state();
  let field: HTMLInputElement | undefined = $state();
  let log: HTMLElement | undefined = $state();

  const clamp = (h: number) => Math.round(Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, h)));

  function gripKey(e: KeyboardEvent): void {
    const by = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowUp') app.update({ drawerHeight: clamp(height + by) });
    else if (e.key === 'ArrowDown') app.update({ drawerHeight: clamp(height - by) });
    else return;
    e.preventDefault();
  }

  /** The caret moved by the mouse or a key the console leaves to the browser. */
  function syncCaret(el: HTMLInputElement): void {
    const at = el.selectionStart;
    if (at !== null && at === el.selectionEnd && at !== con.ed.cursor)
      con.ed = { ...con.ed, cursor: at };
  }

  function onKey(e: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    // An input method is composing: its keys are its own.
    if (e.isComposing) return;
    const el = e.currentTarget;
    syncCaret(el);
    const r = con.key(keyPress(e), el.selectionStart !== el.selectionEnd);
    if (r.handled) e.preventDefault();
    if (r.release === true && e.key === 'Escape') drawer?.focus();
  }

  // Keep the input and its caret in step with the editor.
  $effect(() => {
    const b = con.ed.buffer;
    const c = con.ed.cursor;
    if (field === undefined) return;
    if (field.value !== b) field.value = b;
    if (
      document.activeElement === field &&
      (field.selectionStart !== c || field.selectionEnd !== c)
    )
      field.setSelectionRange(c, c);
  });

  // New output scrolls into view.
  $effect(() => {
    const lines = con.out.length;
    void tick().then(() => {
      if (log !== undefined && lines > 0) log.scrollTop = log.scrollHeight;
    });
  });

  const PREFIX: Readonly<Record<string, string>> = { step: '+ ', pause: '|| ' };
</script>

<section
  class="drawer"
  aria-labelledby="console-h"
  data-region="console"
  tabindex="-1"
  style:height={`${String(height)}px`}
  data-testid="console"
  bind:this={drawer}
  onfocus={(e) => {
    // Moving to the region by Ctrl-` or F6 puts the caret in the input.
    if (e.target === drawer && e.relatedTarget !== field) field?.focus();
  }}
>
  <button
    type="button"
    class="grip"
    aria-label={`Console height ${String(height)} pixels. Up and Down to change it.`}
    onkeydown={gripKey}
    onpointerdown={(e) => {
      dragFrom = { y: e.clientY, h: height };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onpointermove={(e) => {
      if (dragFrom !== undefined)
        app.update({ drawerHeight: clamp(dragFrom.h + dragFrom.y - e.clientY) });
    }}
    onpointerup={() => {
      dragFrom = undefined;
    }}
  ></button>
  <header class="row head">
    <h2 id="console-h">Console</h2>
    {#if script !== undefined}
      <span class="small" data-testid="script-status">
        Script {script.name}: step {script.step} of {script.steps}, line {script.line}
        {script.paused === undefined ? '' : '(paused)'}
      </span>
      {#if script.paused !== undefined}
        <button
          type="button"
          onclick={() => void app.call({ op: 'scriptContinue' })}
          data-testid="script-continue">Go on</button
        >
      {/if}
      <button
        type="button"
        onclick={() => void app.call({ op: 'stopConsole' })}
        data-testid="script-stop">Stop</button
      >
    {/if}
    <span class="muted small hint"
      ><kbd>help</kbd> lists commands. <kbd>Escape</kbd> then <kbd>Tab</kbd> leaves. <kbd>Ctrl</kbd>
      <kbd>`</kbd> hides.</span
    >
  </header>
  <div class="log" role="log" aria-label="Console output" bind:this={log} data-testid="console-log">
    {#each con.out as l (l.id)}
      <div class={`line ${l.kind}`}>{(PREFIX[l.kind] ?? '') + l.text}</div>
    {/each}
  </div>
  {#if con.list.length > 0}
    <ul class="list" aria-label="Completions" data-testid="console-list">
      {#each con.list as item (item)}<li>{item}</li>{/each}
    </ul>
  {/if}
  <div class="entry row">
    <label for="console-input" class="prompt"
      >{con.prompt}<span class="sr-only"> Console</span></label
    >
    <input
      id="console-input"
      bind:this={field}
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      maxlength="500"
      aria-describedby="console-status"
      data-testid="console-input"
      onkeydown={onKey}
      oninput={(e) => {
        const el = e.currentTarget;
        con.input(el.value, el.selectionStart ?? el.value.length);
      }}
      onpointerup={(e) => {
        syncCaret(e.currentTarget);
      }}
    />
  </div>
  <div id="console-status" class="status small" aria-live="polite" data-testid="console-status">
    {con.status}
  </div>
  <div class="sr-only" role="alert" data-testid="console-alert">{con.alert}</div>
</section>

<style>
  .drawer {
    grid-area: console;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-mono);
    min-height: 0;
  }
  .grip {
    padding: 0;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: ns-resize;
  }
  .grip:focus-visible {
    outline-offset: -2px;
  }
  .head {
    gap: var(--space-3);
    font-family: var(--font-ui);
  }
  .hint {
    margin-left: auto;
  }
  .log {
    flex: 1 1 auto;
    overflow: auto;
    min-height: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .line.input {
    color: var(--text-muted);
  }
  .line.refused,
  .line.fault,
  .line.error {
    color: var(--danger);
  }
  .line.note,
  .line.step,
  .line.trace {
    color: var(--text-muted);
  }
  .line.pause {
    font-weight: 600;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 6rem;
    overflow: auto;
  }
  .entry {
    gap: var(--space-2);
  }
  .prompt {
    color: var(--text-muted);
  }
  input {
    flex: 1 1 auto;
    font-family: var(--font-mono);
    min-width: 0;
  }
  .status {
    min-height: 1.4em;
    color: var(--text-muted);
  }
</style>
