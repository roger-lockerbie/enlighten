<script lang="ts">
  import { onMount } from 'svelte';
  import { runGl, type GlResult } from './gl.ts';
  import { trustedWorkerUrl, tryPolicyWithOtherUrl } from './policy.ts';

  const parts = new Set((new URLSearchParams(location.search).get('parts') ?? '').split(','));
  const rows = Array.from({ length: 400 }, (_, i) => i);
  const results: Record<string, unknown> = {};
  (window as unknown as { __spike: Record<string, unknown> }).__spike = results;

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(40);
  let done = $state(false);

  function customProperty(node: HTMLElement, value: number) {
    node.style.setProperty('--w', `${String(value)}%`);
    return {
      update(next: number) {
        node.style.setProperty('--w', `${String(next)}%`);
      },
    };
  }

  function ask<T>(worker: Worker, message: unknown, kind: string): Promise<T> {
    return new Promise((resolve, reject) => {
      worker.addEventListener('message', (e: MessageEvent<{ kind: string }>) => {
        if (e.data.kind === kind) resolve(e.data as T);
      });
      worker.addEventListener('error', () => {
        reject(new Error('worker error'));
      });
      worker.postMessage(message);
    });
  }

  onMount(async () => {
    if (parts.has('worker-plain')) {
      try {
        const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        results['workerPlain'] = await ask(w, { kind: 'ping' }, 'pong');
        w.terminate();
      } catch (error) {
        results['workerPlain'] = `threw: ${String(error)}`;
      }
    }
    if (parts.has('worker-policy')) {
      try {
        const w = new Worker(trustedWorkerUrl(), { type: 'module' });
        results['workerPolicy'] = await ask(w, { kind: 'ping' }, 'pong');
        results['policyOtherUrl'] = tryPolicyWithOtherUrl();
        if (parts.has('ticks')) {
          results['visibilityAtStart'] = document.visibilityState;
          results['ticks'] = await ask(w, { kind: 'ticks', ms: 3000 }, 'ticks');
          results['visibilityAtEnd'] = document.visibilityState;
        }
        w.terminate();
      } catch (error) {
        results['workerPolicy'] = `threw: ${String(error)}`;
      }
    }
    if (parts.has('gl') && canvas) {
      results['gl'] = runGl(canvas) satisfies GlResult;
    }
    if (parts.has('ws')) {
      results['ws'] = await new Promise((resolve) => {
        try {
          const ws = new WebSocket(`ws://${location.host}/ws`);
          ws.addEventListener('open', () => {
            ws.send('hello');
          });
          ws.addEventListener('message', (e) => {
            resolve(`echo: ${String(e.data)}`);
            ws.close();
          });
          ws.addEventListener('error', () => {
            resolve('error');
          });
        } catch (error) {
          resolve(`threw: ${String(error)}`);
        }
      });
    }
    if (parts.has('style') || parts.has('action')) {
      width = 70;
    }
    results['mountMs'] = (window as unknown as { __mountMs?: number }).__mountMs;
    done = true;
  });
</script>

<main>
  <h1>Enlighten</h1>
  <p data-testid="done">{done ? 'done' : 'running'}</p>

  {#if parts.has('style')}
    <div
      class="bar"
      data-testid="style-directive"
      style:width="{width}%"
      style:--w="{width}%"
    ></div>
  {/if}
  {#if parts.has('action')}
    <div class="bar var" data-testid="style-action" use:customProperty={width}></div>
  {/if}
  {#if parts.has('gl')}
    <canvas bind:this={canvas} width="1440" height="900"></canvas>
  {/if}
  {#if parts.has('list')}
    <ul>
      {#each rows as row (row)}
        <li><span class="n">{row}</span><strong>row</strong><em>{row * 2}</em></li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .bar {
    height: 8px;
    background: var(--text-muted);
  }
  .var {
    width: var(--w, 10%);
  }
  canvas {
    width: 720px;
    height: 450px;
    display: block;
  }
  .n {
    color: var(--text-muted);
  }
</style>
