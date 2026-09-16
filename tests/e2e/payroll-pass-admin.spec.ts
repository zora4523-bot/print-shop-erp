import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import Decimal from 'decimal.js';
import AxeBuilder from '@axe-core/playwright';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { login, E2E_PASSWORD, seedE2eProductionOperationFixture } from './_helpers';

test.use({ hasTouch: true });

test('管理员调整计薪次数，旧师傅页面拒绝，后续工资按新次数且历史不变', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const seeded = await seedE2eProductionOperationFixture();
  if (!seeded.ready) throw new Error(seeded.reason);
  const operationId = seeded.fixture.operationId;
  const client = new Client({ connectionString: assertActivatedE2eDatabase().url });
  await client.connect();
  const operation = (await client.query('SELECT "orderId", "plannedQty"::text, "payrollRevision" FROM "ProductionOperation" WHERE id=$1', [operationId])).rows[0];
  const historical = (await client.query('SELECT id, amount::text, snapshot FROM "ProductionReport" WHERE "operationId"=$1 ORDER BY id', [operationId])).rows;
  const workerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const worker = await workerContext.newPage();
    await login(worker, { username: 'e2e-worker-hand', password: E2E_PASSWORD, from: `/worker/tasks/${operationId}` });
    const report = worker.locator('section').filter({ has: worker.getByRole('heading', { name: '扫码报工', exact: true }) });
    await login(page, { from: `/orders/${operation.orderId}` });
    const form = page.getByRole('form').filter({ has: page.locator(`input[name="operationId"][value="${operationId}"]`) });
    await expect(form).toBeVisible();
    const before = await form.getByLabel('计薪过版次数').inputValue();
    const next = Number(before) === 3 ? '4' : '3';
    await form.getByLabel('计薪过版次数').fill(next);
    await form.getByLabel('调整原因').fill('隔离验收加工次数');
    await form.getByRole('button', { name: '核对调整' }).click();
    await expect(form).toContainText(`${before} 次 → ${next} 次`);
    await form.getByRole('button', { name: '保存计薪次数' }).click();
    await expect(form.getByRole('button', { name: '核对调整' })).toBeVisible();
    for (const [label, value] of [['本次合格完成数', '10'], ['本次工单件数进度', '0'], ['缺陷数', '0'], ['返工数', '0']]) await report.getByRole('spinbutton', { name: label, exact: true }).fill(value);
    await report.getByRole('button', { name: '提交扫码报工' }).click();
    await expect(report.getByRole('alert')).toContainText('计薪次数已调整');
    await worker.reload();
    await expect(report).toContainText(`计薪过版次数：${next} 次`);
    for (const [label, value] of [['本次合格完成数', '10'], ['本次工单件数进度', '0'], ['缺陷数', '0'], ['返工数', '0']]) await report.getByRole('spinbutton', { name: label, exact: true }).fill(value);
    await report.getByRole('button', { name: '提交扫码报工' }).click();
    await expect(report.getByRole('status')).toContainText('已记录本次报工');
    const added = (await client.query('SELECT "chargeableQty"::text, rate::text, amount::text, snapshot FROM "ProductionReport" WHERE "operationId"=$1 AND NOT (id = ANY($2::text[]))', [operationId, historical.map((r) => r.id)])).rows;
    expect(added).toHaveLength(1);
    expect(Number(added[0].chargeableQty)).toBe(10 * Number(next));
    expect(added[0].amount).toBe(new Decimal(added[0].rate).mul(10).mul(next).toDecimalPlaces(2).toFixed(2));
    expect(added[0].snapshot.payroll.passCount).toBe(Number(next));
    expect((await client.query('SELECT id, amount::text, snapshot FROM "ProductionReport" WHERE id = ANY($1::text[]) ORDER BY id', [historical.map((r) => r.id)])).rows).toEqual(historical);
    expect((await client.query('SELECT "plannedQty"::text FROM "ProductionOperation" WHERE id=$1', [operationId])).rows[0].plannedQty).toBe(operation.plannedQty);
    // Restore the fixture through the same admin action, retaining its audit history.
    await form.getByLabel('计薪过版次数').fill(before);
    await form.getByLabel('调整原因').fill('验收后恢复次数');
    await form.getByRole('button', { name: '核对调整' }).click();
    await form.getByRole('button', { name: '保存计薪次数' }).click();
    await expect(form.getByRole('button', { name: '核对调整' })).toBeVisible();
    await form.getByLabel('计薪过版次数').fill(next);
    await form.getByLabel('调整原因').fill('仅核对不保存');
    await form.getByRole('button', { name: '核对调整' }).focus();
    await page.keyboard.press('Enter');
    await expect(form.getByRole('button', { name: '保存计薪次数' })).toBeVisible();
    for (const width of [375, 393, 768, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        const toggle = page.getByRole('button', { name: '切换界面主题' });
        await toggle.focus();
        await toggle.press('Enter');
        const choice = page.getByRole('menuitemradio', { name: theme === 'dark' ? '暗色' : '浅色', exact: true });
        await choice.focus();
        await choice.press('Enter');
        await page.keyboard.press('Escape');
        await expect(choice).not.toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
        const violations = (await new AxeBuilder({ page }).include('form[aria-label*="计薪次数"]').analyze()).violations;
        expect(violations).toEqual([]);
        expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        const size = await form.getByRole('button', { name: '保存计薪次数' }).boundingBox();
        if (width <= 768) {
          expect(size?.height).toBeGreaterThanOrEqual(44);
          await form.getByLabel('计薪过版次数').tap();
          await expect(form.getByLabel('计薪过版次数')).toBeFocused();
        }
        if ((width === 375 && theme === 'dark') || (width === 1280 && theme === 'light')) await form.screenshot({ path: test.info().outputPath(`payroll-pass-${width}-${theme}.png`) });
      }
    }
  } finally { await client.end(); await workerContext.close(); }
});
