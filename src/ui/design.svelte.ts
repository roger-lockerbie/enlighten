/**
 * The page's copy of the stored design (looks and the slot map), shared by the Looks, Sequences and
 * Effects pages. It loads once, on the first of those pages opened, and saves shortly after a change.
 */
import { defaultDesign, parseDesign, type Design } from '../design/saved.ts';
import type { AppState } from './state.svelte.ts';

export class DesignState {
  value = $state<Design>(defaultDesign());
  loaded = $state(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly app: AppState;

  constructor(app: AppState) {
    this.app = app;
    app.store
      .loadDesign(parseDesign, defaultDesign())
      .then((r) => {
        if (r.problem !== undefined) app.storeProblem = r.problem;
        this.value = r.value;
      })
      .catch(() => {
        app.storeProblem = 'Stored looks could not be read.';
      })
      .finally(() => {
        this.loaded = true;
      });
  }

  /** Keep a change, and save it shortly after. */
  set(next: Design): void {
    this.value = next;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.app.store.saveDesign<Design>(parseDesign, $state.snapshot(this.value)).catch(() => {
        this.app.storeProblem = 'Looks could not be saved.';
      });
    }, 250);
  }
}

const states = new WeakMap<AppState, DesignState>();

/** The one design state for an app. */
export function designOf(app: AppState): DesignState {
  let d = states.get(app);
  if (d === undefined) states.set(app, (d = new DesignState(app)));
  return d;
}
