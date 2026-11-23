/** LED feedback for a button (SPEC section 10): a pure function of its mode and its target. */
import type { LedMode } from './plate.ts';

/** `targetOn` is undefined when the target's level is not known. */
export function ledLit(mode: LedMode, targetOn: boolean | undefined): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'always':
      return true;
    case 'onWhenOn':
      return targetOn === true;
    case 'onWhenOff':
      return targetOn === false;
  }
}
