import { expect, vi } from 'vitest';

const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

const BASE_UI_TRANSITION_STYLES = '[data-starting-style], [data-ending-style]';

/**
 * Observe current animations after paint; a one-time finished snapshot misses newly mounted portals.
 *
 * Base UI popups mount with `data-starting-style` (dialog `scale-95`) and drop it on a later
 * frame, so their entry transition does not exist yet when the first snapshot is taken. Check
 * transition styles and animations after both snapshots: a transition created between them can
 * stay pending at its 0.95 start value for several frames, so the two rects would compare equal.
 */
export async function waitForStableLayout(root: Element = document.documentElement): Promise<void> {
  await document.fonts.ready;
  await vi.waitFor(async () => {
    const rects = () => [...root.querySelectorAll('button, input, a, [role="alertdialog"]')].map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height];
    });
    await paint();
    const before = rects();
    await paint();
    const after = rects();
    const transitioning = [root, ...root.querySelectorAll(BASE_UI_TRANSITION_STYLES)]
      .filter(element => element.matches(BASE_UI_TRANSITION_STYLES))
      .map(element => element.getAttribute('data-slot') ?? element.tagName);
    expect(transitioning, 'Base UI enter/exit styles must be cleared').toHaveLength(0);
    const active = root.getAnimations({ subtree: true }).filter(animation =>
      (animation.pending || animation.playState === 'running') && animation.effect?.getTiming().iterations !== Infinity,
    );
    expect(active, 'finite layout transitions must finish').toHaveLength(0);
    expect(after, 'control geometry must remain stable across paints').toEqual(before);
  }, { timeout: 5_000 });
}
