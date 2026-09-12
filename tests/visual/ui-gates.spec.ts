import { expect, test } from '@playwright/test';
import { expectViewportGate } from './ui-gates';

test('viewport gate checks expanded content but excludes closed disclosure descendants', async ({ page }, testInfo) => {
  await page.setContent(`
    <style>
      details { width: 80px; }
      summary, button { min-width: 44px; min-height: 44px; }
      button { margin-left: 100vw; }
    </style>
    <details><summary>展开记录</summary><button>保存记录</button></details>
  `);
  const button = page.getByRole('button', { name: '保存记录', includeHidden: true });
  const summary = page.getByText('展开记录');
  await summary.click();
  await expect(button).toBeVisible();
  await summary.click();
  // Chromium can return a nonzero box for descendants of closed details.
  // Their layout boxes must not be mistaken for painted, actionable controls.
  await expect(button).toBeHidden();
  await expectViewportGate(page, testInfo);
  await summary.click();
  await expect(button).toBeVisible();
  await expect(expectViewportGate(page, testInfo)).rejects.toThrow('viewport-x:');
});
