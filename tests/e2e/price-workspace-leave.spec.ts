import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

const exec = promisify(execFile);

/**
 * 价格工作台离开保护（2026-10-04 全应用导航守卫）：有未保存档位时点侧栏链接先确认；
 * 确认后由被点的侧栏链接自己导航，慢导航期间它的 pending 指示可见（不再改用 router.push）。
 */
test('owner: confirming a sidebar leave from unsaved tiers keeps the sidebar link pending', async ({ page }) => {
  assertActivatedE2eDatabase();
  await exec(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', `
    require('./scripts/lib/e2e-environment.ts').assertActivatedE2eDatabase();
    const {db}=require('./lib/db.ts');
    const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
      if(!versions.some(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT')) {
        const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
        await admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'离开保护验收'},actor);
      }
    })().finally(()=>db.$disconnect());
  `], { env: process.env });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { from: '/owner/rules/customer-pricing?section=tiers', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  const boundary = page.getByRole('spinbutton', { name: /^500个档上界/ });
  await expect(boundary).toBeEnabled();
  await boundary.fill('998');

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === '/orders' && url.searchParams.has('_rsc'), async (route) => {
    await held;
    await route.continue();
  });
  const link = page.locator('nav[aria-label="后台主导航"] a[href="/orders"]');
  await link.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('未保存档位修改将丢失');
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeFocused();
  await expect(boundary).toHaveValue('998');

  await link.click();
  await dialog.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await expect(link.locator('[data-pending="true"]')).toBeVisible();
  await expect(page).toHaveURL(/customer-pricing\?section=tiers$/);
  release();
  await expect(page).toHaveURL(/\/orders$/);
  expect(errors).toEqual([]);
});
