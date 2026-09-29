import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import {
  login,
  E2E_PASSWORD,
  E2E_USERS,
} from './_helpers';
import { expectA11yGate, expectViewportGate } from '../visual/ui-gates';
const exec = promisify(execFile);
async function query<T>(body: string): Promise<T> {
  const result = await exec(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '-e',
      `
    const {db}=require('./lib/db.ts');const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{${body}})().then(value=>console.log(JSON.stringify(value))).finally(()=>db.$disconnect());`,
    ],
    { env: process.env },
  );
  return JSON.parse(result.stdout) as T;
}
async function prepareDraft() {
  return query<{
    id: string;
  }>(`const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
    const draft=versions.find(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT');if(draft)return {id:draft.id};
    const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
    return admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'测试新增纸张'},actor);`);
}
test('空白封新增、矩阵与纸张页：六视口明暗、触控、键盘和可访问性', async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  assertActivatedE2eDatabase();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD,
    from: '/owner/rules/customer-pricing?section=blank' });
  const viewportDraft = await prepareDraft();
  const ownerState = await page.context().storageState();
  try {
    for (const [width, height] of [
      [375, 667],
      [393, 852],
      [768, 1024],
      [1024, 768],
      [1280, 800],
      [1920, 1080],
    ]) {
      const uiContext = await browser.newContext({
        storageState: ownerState,
        viewport: { width, height },
        hasTouch: width <= 768,
      });
      const ui = await uiContext.newPage();
      ui.on('pageerror', (error) => errors.push(error.message));
      try {
        await ui.goto('/owner/rules/customer-pricing/blank/new');
        await expect(ui.locator('[aria-current=page]').filter({ hasText: '新建纸张与规格价格' })).toBeVisible();
        // A streamed React response can temporarily retain a hidden copy in S:1.
        // Accessible roles select the mounted form, not that hidden payload.
        const form = ui.getByRole('form', { name: '新建纸张与规格价格', exact: true });
        await expect(form).toHaveCount(1);
        const newPaper = form.getByRole('radio', { name: '新建纸张', exact: true });
        const middlePrice = form.getByRole('spinbutton', { name: '中号封单价', exact: true });
        if (width <= 768) {
          await newPaper.locator('..').tap();
          await middlePrice.tap();
        } else {
          await newPaper.check();
          await middlePrice.focus();
        }
        await expect(newPaper).toBeChecked();
        await expect(form.getByRole('textbox', { name: '纸张名称', exact: true })).toBeVisible();
        await expect(middlePrice).toBeFocused();
        await middlePrice.press('Tab');
        await expect(form.getByRole('spinbutton', { name: '大号封单价', exact: true })).toBeFocused();
        for (const theme of ['light', 'dark']) {
          await ui.evaluate((value) => {
            document.documentElement.dataset.theme = value;
            document.documentElement.classList.toggle('dark', value === 'dark');
          }, theme);
          await expect
            .poll(() =>
              ui.evaluate(
                () =>
                  document
                    .getAnimations()
                    .filter(
                      (a) =>
                        a instanceof CSSTransition && a.playState === 'running',
                    ).length,
              ),
            )
            .toBe(0);
          await ui.evaluate(() => window.scrollTo(0, 0));
          await expectViewportGate(ui, {
            ...testInfo,
            project: {
              ...testInfo.project,
              use: { ...testInfo.project.use, viewport: { width, height } },
            },
          });
          await expectA11yGate(ui);
          if (theme === 'light' && (width === 375 || width === 1280)) {
            await ui.screenshot({
              path: `/tmp/blank-paper-${width}.png`,
              fullPage: true,
            });
          }
        }
        for (const path of ['/owner/rules/customer-pricing?section=blank', '/owner/rules/papers']) {
          await ui.goto(path);
          await expect(ui.locator('main h1')).toBeVisible();
          for (const theme of ['light', 'dark']) {
            await ui.evaluate((value) => {
              document.documentElement.dataset.theme = value;
              document.documentElement.classList.toggle('dark', value === 'dark');
            }, theme);
            await expect.poll(() => ui.evaluate(() => document.getAnimations().filter(
              (animation) => animation instanceof CSSTransition && animation.playState === 'running',
            ).length)).toBe(0);
            if (path.includes('customer-pricing')) {
              const input = ui.locator('main input[type="number"]:enabled').first();
              await input.focus();
              await expect(input).toBeFocused();
              await input.press('Tab');
            }
            await expectViewportGate(ui, { ...testInfo, project: { ...testInfo.project,
              use: { ...testInfo.project.use, viewport: { width, height } },
            } });
            await expectA11yGate(ui);
          }
        }
      } finally {
        await uiContext.close();
      }
    }
  } finally {
    await query(`const book=await db.customerPriceBook.findUniqueOrThrow({where:{id:${JSON.stringify(viewportDraft.id)}}});
      const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
      await admin.discardCustomerPriceBookDraft({priceBookId:book.id,expectedDraftUpdatedAt:book.updatedAt},actor);return true;`);
  }
  expect(errors).toEqual([]);
});
