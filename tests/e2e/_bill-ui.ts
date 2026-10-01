import { expect, type Page } from '@playwright/test';

export async function selectBillTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '切换界面主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: theme === 'dark' ? '暗色' : '浅色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await waitForBillPaint(page);
}

export async function waitForBillPaint(page: Page) {
  // Like the shared visual gates, wait for real theme transitions to finish
  // before axe samples foreground and background colors.
  for (let paint = 0; paint < 3; paint += 1) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect.poll(() => page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
  }
}
