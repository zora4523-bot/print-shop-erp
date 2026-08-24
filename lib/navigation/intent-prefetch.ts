export const INTENT_PREFETCH_DELAY_MS = 175;

export type IntentPrefetchTarget = {
  href: string;
  pathname: string;
};

/**
 * A small, framework-independent scheduler keeps the hover policy testable.
 * Only the newest sustained pointer intent is allowed to enable a full route
 * prefetch; leaving the item or unmounting cancels pending work.
 */
export class IntentPrefetchScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onReady: (target: IntentPrefetchTarget) => void,
    private readonly delayMs = INTENT_PREFETCH_DELAY_MS,
  ) {}

  schedule(target: IntentPrefetchTarget): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onReady(target);
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.cancel();
  }
}
