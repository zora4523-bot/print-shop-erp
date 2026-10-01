import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { assertSupplyChainIsolation, readOutsourceState, seedOutsourcePrerequisites } from './_supply-chain-fixtures';

test.beforeEach(assertSupplyChainIsolation);

async function createStyleOutsource(page: Page, orderId: string, sequence: number) {
  await page.goto(`/foreman/outsource/new?orderId=${orderId}`);
  await page.getByRole('checkbox', { name: new RegExp(`^#${sequence} · 外协回归款${sequence}`) }).check();
  await page.getByLabel('外协厂名 *', { exact: true }).fill(`回归外协厂${sequence}`);
  await page.getByLabel('工艺 / 内容', { exact: true }).fill('纯彩印外协');
  await page.getByRole('button', { name: '创建并标记已发出', exact: true }).click();
  await page.waitForURL(/\/foreman\/outsource\/[a-z0-9_-]+$/i);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

async function receiveOutsource(page: Page) {
  await page.getByRole('button', { name: '标记已回货', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认已回货', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记已回货', exact: true })).toHaveCount(0);
}

async function submitPayment(page: Page, amount: string) {
  await page.getByLabel('本次付款金额（元）', { exact: true }).fill(amount);
  await page.getByRole('button', { name: '核对并记录外协付款', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  const submitted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === new URL(page.url()).pathname);
  await confirmation.getByRole('button', { name: '确认记录付款', exact: true }).click();
  return submitted;
}

test('逐款外协回货守住完成闸口；人工应付、部分付款和重试保留精确账本', async ({ page, context }) => {
  test.setTimeout(120_000);
  const fixture = await seedOutsourcePrerequisites();
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  const firstId = await test.step('第一款外协只冻结该款数量，回货不能冒领第二款', async () => {
    const firstId = await createStyleOutsource(page, fixture.orderId, 1);
    const sent = await readOutsourceState(fixture.orderId);
    expect(sent.rows).toEqual([{ id: firstId, status: 'SENT', totalQty: 100, amount: null }]);
    expect(sent.snapshots).toEqual([{ outsourceOrderId: firstId, orderItemId: fixture.itemIds[0], quantity: 100 }]);
    await expect(page.getByRole('button', { name: '核对并记录外协付款', exact: true })).toHaveCount(0);
    await receiveOutsource(page);
    await expect(page.getByText('已标记回货，但工单尚未生产完工', { exact: true })).toBeVisible();
    await expect(page.getByText(/款式 2「外协回归款2」/)).toBeVisible();
    const received = await readOutsourceState(fixture.orderId);
    expect(received.order).toMatchObject({ status: 'RELEASED', completedAt: null, workOrderVersion: 1 });
    expect(received.completionLogs).toHaveLength(0);
    expect(received.rows[0]?.status).toBe('RECEIVED');
    expect(received.snapshots).toEqual(sent.snapshots);
    expect(received.payments).toHaveLength(0);
    return firstId;
  });

  await test.step('第二款回货后由正式完成服务写入当前版本完工事实', async () => {
    const secondId = await createStyleOutsource(page, fixture.orderId, 2);
    await receiveOutsource(page);
    await expect(page.getByText('外协单已标记回货', { exact: true })).toBeVisible();
    const completed = await readOutsourceState(fixture.orderId);
    expect(completed.order?.status).toBe('PACKING');
    expect(completed.order?.completedAt).not.toBeNull();
    expect(completed.completionLogs).toHaveLength(1);
    expect(completed.snapshots).toEqual([
      { outsourceOrderId: firstId, orderItemId: fixture.itemIds[0], quantity: 100 },
      { outsourceOrderId: secondId, orderItemId: fixture.itemIds[1], quantity: 200 },
    ]);
    expect(completed.rows.map((row) => row.status)).toEqual(['RECEIVED', 'RECEIVED']);
  });
  const completed = await readOutsourceState(fixture.orderId);
  await page.goto(`/foreman/outsource/${firstId}`);

  await test.step('金额未知不能付款，管理员按对账结果人工确认应付', async () => {
    await expect(page.getByText('请先确认外协应付金额，再记录付款。', { exact: true })).toBeVisible();
    await page.getByLabel('确认金额（元）', { exact: true }).fill('125.50');
    await page.getByLabel('确认 / 更正原因', { exact: true }).fill('按外协厂回货对账单确认');
    await page.getByRole('button', { name: '确认金额', exact: true }).click();
    await expect(page.getByText('已保存外协金额 ¥ 125.50', { exact: true })).toBeVisible();
    const confirmed = await readOutsourceState(fixture.orderId);
    expect(confirmed.rows[0]?.amount).toBe('125.50');
    expect(confirmed.changes).toEqual([{ outsourceOrderId: firstId, previousAmount: null, newAmount: '125.50', reason: '按外协厂回货对账单确认' }]);
  });

  const stalePage = await context.newPage();
  await stalePage.goto(page.url());
  await expect(stalePage.getByLabel('本次付款金额（元）', { exact: true })).toBeVisible();
  try {
    await test.step('先付40.10，重放实际付款请求不重复入账', async () => {
      const paymentRequest = await submitPayment(page, '40.10');
      await expect(page.getByText('外协付款流水已记入', { exact: true })).toBeVisible();
      const paid = await readOutsourceState(fixture.orderId);
      expect(paid.payments).toHaveLength(1);
      expect(paid.payments[0]).toMatchObject({ outsourceOrderId: firstId, amount: '40.10' });
      const replay = await page.request.fetch(paymentRequest);
      expect(replay.status()).toBe(200);
      await replay.dispose();
      expect(await readOutsourceState(fixture.orderId)).toEqual(paid);
    });

    await test.step('旧页面按旧余额付款仍被服务端拒绝，账本不变', async () => {
      const before = await readOutsourceState(fixture.orderId);
      await submitPayment(stalePage, '125.50');
      await expect(stalePage.getByText('外协付款未记入', { exact: true })).toBeVisible();
      await expect(stalePage.getByText(/付款金额超出未付余额/)).toBeVisible();
      expect(await readOutsourceState(fixture.orderId)).toEqual(before);
    });

    await test.step('支付85.40尾款后精确结清，冻结数量和完工时间保持不变', async () => {
      await page.reload();
      await submitPayment(page, '85.40');
      await expect(page.getByText('该外协单已结清。', { exact: true })).toBeVisible();
      const final = await readOutsourceState(fixture.orderId);
      expect(final.payments.map((payment) => payment.amount)).toEqual(['40.10', '85.40']);
      expect(final.rows[0]?.amount).toBe('125.50');
      expect(final.order).toEqual(completed.order);
      expect(final.snapshots).toEqual(completed.snapshots);
      expect(final.completionLogs).toEqual(completed.completionLogs);
      await expect(page.getByRole('button', { name: '核对并记录外协付款', exact: true })).toHaveCount(0);
    });
  } finally {
    await stalePage.close();
  }
});

test('销售角色不能通过已知工单进入外协创建页面', async ({ page }) => {
  const fixture = await seedOutsourcePrerequisites();
  await login(page, { username: E2E_USERS.sales!.username, password: E2E_PASSWORD });
  await page.goto(`/foreman/outsource/new?orderId=${fixture.orderId}`);
  await expect(page).not.toHaveURL(/\/foreman\/outsource/);
  await expect(page.getByRole('button', { name: '创建并标记已发出', exact: true })).toHaveCount(0);
  expect((await readOutsourceState(fixture.orderId)).rows).toHaveLength(0);
});
