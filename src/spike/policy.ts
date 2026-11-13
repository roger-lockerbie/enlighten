// The one place a Trusted Types policy is created. It passes exactly one URL, fixed at build time.
import workerUrl from './worker.ts?worker&url';

export const WORKER_URL = new URL(workerUrl, location.origin).href;

interface PolicyLike {
  createScriptURL(input: string): unknown;
}
interface FactoryLike {
  createPolicy(name: string, rules: { createScriptURL(input: string): string }): PolicyLike;
}

let policy: PolicyLike | undefined;

export function trustedWorkerUrl(): string {
  const factory = (globalThis as unknown as { trustedTypes?: FactoryLike }).trustedTypes;
  if (!factory) return WORKER_URL;
  policy ??= factory.createPolicy('enlighten-worker', {
    createScriptURL(input: string): string {
      if (input !== WORKER_URL) throw new TypeError('enlighten-worker: unexpected URL');
      return input;
    },
  });
  return policy.createScriptURL(WORKER_URL) as string;
}

export function tryPolicyWithOtherUrl(): string {
  try {
    policy?.createScriptURL('https://example.invalid/evil.js');
    return 'allowed';
  } catch {
    return 'refused';
  }
}
