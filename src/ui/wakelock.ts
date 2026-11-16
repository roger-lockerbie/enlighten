/**
 * A screen wake lock while a script runs (SPEC S5.2). The browser drops the lock when the page is
 * hidden, so it is asked for again when the page is shown, while it is still wanted. A refusal is
 * reported once, so the person knows the screen may sleep.
 */

export class ScreenWake {
  private wanted = false;
  private held: WakeLockSentinel | undefined;
  private told = false;
  private readonly onRefused: (why: string) => void;

  constructor(onRefused: (why: string) => void) {
    this.onRefused = onRefused;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted) void this.take();
    });
  }

  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) void this.take();
    else {
      const h = this.held;
      this.held = undefined;
      void h?.release().catch(() => undefined);
    }
  }

  private async take(): Promise<void> {
    if (this.held !== undefined) return;
    if (!('wakeLock' in navigator)) {
      this.refused(
        'This browser has no screen wake lock, so the screen may sleep during a script.',
      );
      return;
    }
    try {
      const s = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        await s.release();
        return;
      }
      this.held = s;
      s.addEventListener('release', () => {
        if (this.held === s) this.held = undefined;
      });
    } catch {
      this.refused(
        'The browser refused a screen wake lock, so the screen may sleep during a script.',
      );
    }
  }

  private refused(why: string): void {
    if (this.told) return;
    this.told = true;
    this.onRefused(why);
  }
}
