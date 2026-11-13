/// <reference lib="webworker" />
// Spike worker: answers a ping, and counts timer ticks for the hidden-tab check.
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<{ kind: string; ms?: number }>) => {
  if (event.data.kind === 'ping') {
    scope.postMessage({ kind: 'pong', isolated: scope.crossOriginIsolated });
  }
  if (event.data.kind === 'ticks') {
    const total = event.data.ms ?? 2000;
    const start = performance.now();
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      if (performance.now() - start >= total) {
        clearInterval(id);
        scope.postMessage({ kind: 'ticks', ticks, elapsed: performance.now() - start });
      }
    }, 50);
  }
});
