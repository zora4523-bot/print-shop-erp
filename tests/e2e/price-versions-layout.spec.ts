import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Decimal from 'decimal.js';
import { expect, test } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { expectA11yGate, expectViewportGate } from '../visual/ui-gates';
const exec = promisify(execFile);

test('price versions navigation, exact prices, responsive review and unchanged draft', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  assertActivatedE2eDatabase();
  const prepared = await exec(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', `
    const {db}=require('./lib/db.ts'); const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{let versions=await admin.listCustomerPriceBookVersionsAndDrafts();
      let draft=versions.find(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT');
      if(!draft){const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
        await admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'检查价格版本布局'},actor);
        versions=await admin.listCustomerPriceBookVersionsAndDrafts();
        draft=versions.find(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT');}
      console.log(JSON.stringify({id:draft.id}));
    })().finally(()=>db.$disconnect());`], { env: process.env });
  const { id } = JSON.parse(prepared.stdout) as { id: string };
  const route = `/owner/rules/price-versions?draft=${id}`;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, { from: route, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await expect(page.getByText('草稿与当前版本一致，无需发布。', { exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: '发布价目草稿' })).toHaveCount(0);
  await page.getByRole('navigation', { name: '价格用途' }).getByRole('link', { name: /^物流费/ }).click();
  await expect(page.getByRole('heading', { name: '物流费', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: '价格用途' }).getByRole('link', { name: /^加工费/ }).click();
  await expect(page).toHaveURL(new RegExp(`draft=${id}`));
  await page.goto('/owner/rules/customer-pricing?section=tiers');
  const price = page.getByRole('spinbutton', { name: /^1千档大号组单价/ });
  const original = await price.inputValue();
  const changed = new Decimal(original).plus('0.0001').toString();
  try {
    await price.fill(changed);
    await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
    await expect(page.getByText('调价草稿已保存。', { exact: true })).toBeVisible();
    await page.goto(route);
    await expect(page.getByRole('button', { name: '确认并立即发布', exact: true })).toBeEnabled();
    await expect(page.getByRole('table', { name: '草稿价格变更明细' })).toContainText(`¥ ${changed}`);
    for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
      const context = await browser.newContext({ storageState: await page.context().storageState(),
        viewport: { width, height }, hasTouch: width <= 768, isMobile: width <= 768, reducedMotion: 'reduce' });
      try {
        const view = await context.newPage(); view.on('pageerror', error => errors.push(error.message));
        await view.goto(route);
        const info = { ...testInfo, project: { ...testInfo.project, use: { ...testInfo.project.use, viewport: { width, height } } } };
        const options = view.getByText('预约生效或补充发布说明（可选）', { exact: true });
        if (width <= 768) await options.tap(); else await options.click();
        await expect(view.getByLabel('预约生效时间（上海时间）')).toBeVisible();
        for (const theme of ['light', 'dark'] as const) {
          await view.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          await view.evaluate(value => { localStorage.setItem('erp-theme', value); document.documentElement.dataset.theme = value;
            document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
          // Observe the rendered theme without awaiting animation promises on detached nodes.
          await expect.poll(() => view.evaluate(() =>
            document.getAnimations().filter(animation =>
              animation instanceof CSSTransition && animation.playState === 'running',
            ).length,
          )).toBe(0);
          await expectViewportGate(view, info);
          await expectA11yGate(view);
          await view.screenshot({ path: testInfo.outputPath(`versions-${width}-${theme}.png`), fullPage: true });
        }
      } finally { await context.close(); }
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto('/owner/rules/customer-pricing?section=tiers');
    await price.fill(original);
    await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
    await expect(page.getByText('调价草稿已保存。', { exact: true })).toBeVisible();
  }
});
