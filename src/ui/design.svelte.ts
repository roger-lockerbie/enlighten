/**
 * The page's copy of the stored design (looks and the slot map), shared by the Looks, Sequences and
 * Effects pages. It loads once, on the first of those pages opened, and saves shortly after a change.
 */
import type { Library } from '../design/look.ts';
import { defaultDesign, parseDesign, type Design } from '../design/stored.ts';
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

  /** Keep a change to the looks and the slot map. */
  setLibrary(lib: Library): void {
    this.set({ ...this.value, looks: lib.looks, slots: lib.slots });
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

const states = new WeakMap<AppState, { rev: number; state: DesignState }>();

/** The one design state for an app. It is read from the store again after an import replaces it. */
export function designOf(app: AppState): DesignState {
  const rev = app.designRev;
  let d = states.get(app);
  if (d?.rev !== rev) states.set(app, (d = { rev, state: new DesignState(app) }));
  return d.state;
}
