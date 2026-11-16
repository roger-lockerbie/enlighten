import { describe, expect, it } from 'vitest';
import { CHECK_STEPS } from './hwcheck.ts';
import { CHECK_STEP_INFO } from './hwcheck-steps.ts';

describe('the hardware check step list', () => {
  it('has the same steps, in the same order, as the runners', () => {
    expect(CHECK_STEPS.map((s) => s.id)).toEqual(CHECK_STEP_INFO.map((s) => s.id));
  });

  it('gives every step a person does not do by hand a runner, and none to the manual steps', () => {
    for (const s of CHECK_STEPS) expect(s.run !== undefined, s.id).toBe(s.kind !== 'manual');
  });

  it('has unique ids', () => {
    expect(new Set(CHECK_STEP_INFO.map((s) => s.id)).size).toBe(CHECK_STEP_INFO.length);
  });
});
