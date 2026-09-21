import { expect, vi } from 'vitest';

const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** Observe current animations after paint; a one-time finished snapshot misses newly mounted portals. */
export async function waitForStableLayout(root: Element = document.documentElement): Promise<void> {
  await document.fonts.ready;
  await vi.waitFor(async () => {
    await paint();
    const active = root.getAnimations({ subtree: true }).filter(animation =>
      (animation.pending || animation.playState === 'running') && animation.effect?.getTiming().iterations !== Infinity,
    );
    expect(active, 'finite layout transitions must finish').toHaveLength(0);
    const rects = () => [...root.querySelectorAll('button, input, a, [role="alertdialog"]')].map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height];
    });
    const before = rects();
    await paint();
    expect(rects(), 'control geometry must remain stable across paints').toEqual(before);
  });
}
