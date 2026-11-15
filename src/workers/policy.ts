/**
 * The one Trusted Types policy, and the one place a worker is made (ADR 0002). The policy passes only
 * the worker URLs fixed at build time and throws for anything else. It has no `createHTML` and no
 * `createScript`. Lint keeps `createPolicy` and `new Worker` in this file.
 */
import busWorkerUrl from './bus.worker.ts?worker&url';

/** Every worker URL the policy will pass. The light worker joins in Stage 7. */
const WORKER_URLS: readonly string[] = [new URL(busWorkerUrl, location.origin).href];

interface PolicyLike {
  createScriptURL(input: string): unknown;
}
interface FactoryLike {
  createPolicy(name: string, rules: { createScriptURL(input: string): string }): PolicyLike;
}

let policy: PolicyLike | undefined;

/** A URL the browser accepts for a worker under `require-trusted-types-for 'script'`. */
function trusted(url: string): string {
  const factory = (globalThis as unknown as { trustedTypes?: FactoryLike }).trustedTypes;
  // Browsers without Trusted Types take the plain URL. The CSP still limits workers to 'self'.
  if (factory === undefined) return url;
  policy ??= factory.createPolicy('enlighten-worker', {
    createScriptURL(input: string): string {
      if (!WORKER_URLS.includes(input)) throw new TypeError('enlighten-worker: unexpected URL');
      return input;
    },
  });
  return policy.createScriptURL(url) as string;
}

/** Start the bus worker (ADR 0010). */
export function startBusWorker(): Worker {
  const [url] = WORKER_URLS;
  if (url === undefined) throw new Error('No bus worker URL.');
  return new Worker(trusted(url), { type: 'module', name: 'bus' });
}
