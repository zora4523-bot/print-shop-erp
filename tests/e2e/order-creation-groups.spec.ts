import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login, openFirstOrderItemEditor } from './_helpers';

for (const role of ['owner', 'sales'] as const) {
  test(`${role} 设计、规格和批量工单互相独立并保留编辑内容`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, { username: E2E_USERS[role].username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    const files = page.locator('[data-slot="order-design-section"]').getByRole('region', { name: '设计图与设计文件', exact: true });
    await expect(files.getByText('当前设计款共用', { exact: true })).toBeVisible();
    await expect(files.locator('input[type="file"]')).toHaveCount(2);
    const specificationSection = page.locator('[data-slot="order-specification-section"]');
    await expect(specificationSection.locator('input[type="file"]')).toHaveCount(0);
    const fileBox = await files.getByRole('button', { name: '拖放或选择第 1 款 CDR 文件', exact: true }).boundingBox();
    expect(fileBox?.height).toBeGreaterThanOrEqual(128);
    if (role === 'owner') {
      const pricing = page.getByRole('region', { name: '收费与其他要求', exact: true });
      await expect(pricing.getByRole('group', { name: '包装组 1 单价', exact: true })).toBeVisible();
      await expect(specificationSection.getByRole('group', { name: '包装组 1 单价', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole('region', { name: '收费与其他要求', exact: true })).toHaveCount(0);
    }
    const paperChoices = page.getByRole('group', { name: '纸张材质', exact: true });
    await expect(paperChoices.getByRole('button', { name: '珠光闪红', exact: true })).toHaveCount(0);
    await paperChoices.getByRole('button', { name: '珠光暗红', exact: true }).click();
    await expect(paperChoices.getByRole('button', { name: '珠光暗红', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot="order-form-rail"]').getByText('机烫费', { exact: true })).toBeVisible();

    await page.getByRole('textbox', { name: '工单名称', exact: true }).fill('批量第一单');
    await page.getByRole('group', { name: '纸张材质', exact: true }).getByRole('button', { name: '珠光艳闪', exact: true }).click();
    await page.locator('[data-slot="order-form-b"] input[type="file"]').last().setInputFiles({ name: 'shared-design.cdr', mimeType: 'application/octet-stream', buffer: Buffer.from('fixture-design-file') });
    await page.getByRole('button', { name: '＋ 增加规格', exact: true }).click();
    await expect(page.getByText('shared-design.cdr', { exact: false })).toBeVisible();
    await expect(page.getByRole('tablist', { name: '规格明细' }).getByRole('tab', { selected: true })).toHaveCount(1);
    await page.getByRole('group', { name: '规格', exact: true }).getByRole('button', { name: '西封大号', exact: true }).click();
    await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('100');
    const specs = page.getByRole('tablist', { name: '规格明细' });
    await expect(specs.getByRole('tab', { name: /· 100 个/ })).toBeVisible();
    const designPanel = page.getByRole('tabpanel').filter({ has: page.getByRole('tablist', { name: '规格明细' }) });
    const specPanel = designPanel.getByRole('tabpanel');
    await expect(specPanel.getByRole('spinbutton', { name: '数量', exact: true })).toHaveValue('100');
    await expect(specPanel.getByText('shared-design.cdr', { exact: false })).toHaveCount(0);
    await expect(designPanel.getByText('shared-design.cdr', { exact: false })).toBeVisible();
    // Packaging on one spec must not reset the first spec.
    await specPanel.getByRole('button', { name: '不包装', exact: true }).click();
    await specs.getByRole('tab').first().click();
    await expect(specPanel.getByRole('button', { name: '入袋', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(specPanel.getByRole('spinbutton', { name: '数量', exact: true })).toHaveValue('1000');
    await specs.getByRole('tab').first().press('ArrowRight');
    await expect(specs.getByRole('tab').nth(1)).toBeFocused();
    await expect(specs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(specPanel.getByRole('button', { name: '不包装', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(specPanel.getByRole('spinbutton', { name: '数量', exact: true })).toHaveValue('100');
    await page.getByRole('button', { name: '＋ 增加规格', exact: true }).click();
    await page.getByRole('button', { name: '移除当前规格', exact: true }).click();
    await expect(specs.getByRole('tab', { name: /· \d+ 个/ })).toHaveCount(2);
    await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
    await expect(page.getByRole('tablist', { name: '设计款' }).getByRole('tab')).toHaveCount(2);
    await expect(specs.getByRole('tab', { name: /· \d+ 个/ })).toHaveCount(1);
    await expect(page.getByText('shared-design.cdr', { exact: false })).toHaveCount(0);
    const designs = page.getByRole('tablist', { name: '设计款', exact: true });
    await designs.getByRole('tab').last().press('Home');
    await expect(designs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('shared-design.cdr', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: /编辑设计款 1 · 西封大号.*100 个/ }).click();
    await expect(specs.getByRole('tab', { selected: true })).toContainText('100 个');
    if (role === 'sales') await expect(page.getByRole('button', { name: '人工定价', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '＋ 增加工单', exact: true }).click();
    await page.getByRole('textbox', { name: '工单名称', exact: true }).fill('批量第二单');
    await expect(page.getByRole('tablist', { name: '设计款' }).getByRole('tab')).toHaveCount(1);
    await page.getByRole('navigation', { name: '待建工单' }).getByRole('button', { name: '工单 1', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue('批量第一单');
    await expect(page.getByRole('tablist', { name: '设计款' }).getByRole('tab')).toHaveCount(2);
    await expect(page.getByText('shared-design.cdr', { exact: false })).toBeVisible();
    await page.getByRole('navigation', { name: '待建工单' }).getByRole('button', { name: '工单 2', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue('批量第二单');
    expect(errors).toEqual([]);
  });
}


test('管理员按材料和克重限制规格，切换克重后报价正常', async ({ page }) => {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders/new' });
  await openFirstOrderItemEditor(page);
  const form = page.locator('[data-slot="order-form-b"]');
  await form.getByRole('group', { name: '纸张材质', exact: true }).getByRole('button', { name: '杂色珠光', exact: true }).click();
  await expect(form.getByRole('group', { name: '规格', exact: true }).getByRole('button', { name: '西封大号', exact: true })).toBeDisabled();
  await form.getByRole('group', { name: '纸张材质', exact: true }).getByRole('button', { name: '红卡', exact: true }).click();
  await form.getByRole('group', { name: '克重', exact: true }).getByRole('button', { name: '230g', exact: true }).click();
  await expect(page.locator('form[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  await expect(form.getByRole('group', { name: '克重', exact: true }).getByRole('button', { name: '230g', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/纸张名称与克重冲突|规格与建单产品.*不一致/)).toHaveCount(0);
});

test('批量逐张保存，规格分组持久化，刷新后不会重新创建', async ({ page }) => {
  const names = [`批量规格 A ${Date.now()}`, `批量规格 B ${Date.now()}`];
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders/new' });
  await openFirstOrderItemEditor(page);
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(names[0]);
  await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('张三 13800138000 广东省佛山市测试路一号');
  await page.getByRole('group', { name: '纸张材质', exact: true }).getByRole('button', { name: '珠光艳闪', exact: true }).click();
  await page.getByRole('button', { name: '＋ 增加规格', exact: true }).click();
  await page.getByRole('group', { name: '规格', exact: true }).getByRole('button', { name: '西封大号', exact: true }).click();
  await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('100');
  await page.getByRole('button', { name: '不包装', exact: true }).click();
  await page.getByRole('button', { name: '＋ 增加工单', exact: true }).click();
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(names[1]);
  await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('李四 13800138001 广东省佛山市测试路二号');
  const orders = page.getByRole('navigation', { name: '待建工单' });
  await orders.getByRole('button', { name: '工单 1', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(orders.getByRole('button', { name: '工单 1 · 已完成' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue(names[1]);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工单已创建' })).toBeVisible();
  await page.reload();
  await expect(orders.getByRole('button', { name: '工单 1 · 已完成' })).toBeVisible();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const rows = (await db.query(`SELECT o.id, o."customName", i."designGroupKey", i.quantity, i.specification FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o.id WHERE o."customName"=ANY($1) ORDER BY o."customName", i.sequence`, [names])).rows;
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    const first = rows.filter((row) => row.customName === names[0]);
    expect(first).toHaveLength(2);
    expect(first[0].designGroupKey).toBeTruthy();
    expect(first[0].designGroupKey).toBe(first[1].designGroupKey);
    expect(first.map((row) => row.quantity)).toEqual([1000, 100]);
    expect(first[0].specification).not.toBe(first[1].specification);
    const packaging = (await db.query('SELECT mode, "actualBagCount" FROM "OrderPackagingGroup" WHERE "orderId"=$1 ORDER BY sequence', [first[0].id])).rows;
    expect(packaging.map((group) => group.mode)).toEqual(['SINGLE_STYLE', 'UNPACKED']);
    expect(packaging[1].actualBagCount).toBe(0);
  } finally { await db.end(); }
});

test('批量寄样工单保存后继续下一张普通工单', async ({ page }) => {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders/new' });
  await openFirstOrderItemEditor(page);
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill('下一张普通工单');
  await page.getByRole('button', { name: '＋ 增加工单', exact: true }).click();
  await page.getByRole('button', { name: '寄样品', exact: true }).click();
  await page.getByLabel('样品名称').fill(`批量样品 ${Date.now()}`);
  await page.getByLabel('收货人', { exact: true }).fill('张三');
  await page.getByLabel('手机号', { exact: true }).fill('13800138000');
  await page.getByLabel('收件省份').selectOption('广东');
  await page.getByLabel('收货地址', { exact: true }).fill('广东省佛山市测试路一号');
  await page.getByRole('checkbox', { name: '顺丰到付', exact: true }).check();
  await page.getByRole('button', { name: '核对费用', exact: true }).click();
  await page.getByRole('button', { name: '保存工单', exact: true }).click();
  await page.getByRole('button', { name: '保存并继续下一张', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue('下一张普通工单');
  await expect(page.getByRole('button', { name: '工单 2 · 已完成', exact: true })).toBeVisible();
});

test('批量创建并编辑收费仍进入收费编辑，返回后可继续未创建工单', async ({ page }) => {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders/new' });
  await openFirstOrderItemEditor(page);
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill('后续普通工单');
  await page.getByRole('button', { name: '＋ 增加工单', exact: true }).click();
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(`批量编辑收费 ${Date.now()}`);
  await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('张三 13800138000 广东省佛山市测试地址');
  await page.locator('#promisedDate').fill('2026-12-30');
  await page.getByRole('button', { name: '创建并编辑收费', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认无误，提交', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[a-z0-9]+#admin-fee-editor$/);
  await page.goto('/orders/new');
  await expect(page.getByRole('button', { name: '工单 2 · 已完成', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '新建工单', exact: true })).toBeVisible();
});


for (const purpose of ['寄样品', '打样'] as const) {
  test(`${purpose}在浏览器存储失败时切换工单仍保留编辑内容`, async ({ page }) => {
    await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    await page.getByRole('button', { name: '＋ 增加工单', exact: true }).click();
    await page.evaluate(() => {
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) {
        if (this === sessionStorage) throw new DOMException('blocked', 'SecurityError');
        return get.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (this === sessionStorage) throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: purpose, exact: true }).click();
    await page.getByLabel('收货人', { exact: true }).fill('内存保留');
    await page.getByLabel('收货地址', { exact: true }).fill('广东省佛山市不丢失地址');
    await page.getByLabel(purpose === '打样' ? '打样要求' : '备注', { exact: true }).fill('切换后保留这段说明');
    if (purpose === '寄样品') await page.getByLabel('样品数量').fill('37');
    await page.getByRole('navigation', { name: '待建工单' }).getByRole('button', { name: '工单 1', exact: true }).click();
    await page.getByRole('navigation', { name: '待建工单' }).getByRole('button', { name: '工单 2', exact: true }).click();
    await expect(page.getByLabel('收货人', { exact: true })).toHaveValue('内存保留');
    await expect(page.getByLabel('收货地址', { exact: true })).toHaveValue('广东省佛山市不丢失地址');
    await expect(page.getByLabel(purpose === '打样' ? '打样要求' : '备注', { exact: true })).toHaveValue('切换后保留这段说明');
    if (purpose === '寄样品') await expect(page.getByLabel('样品数量')).toHaveValue('37');
  });
}

for (const changed of [false, true]) {
  test(`寄样已写入但响应丢失后${changed ? '拒绝不同内容' : '安全重试同一内容'}`, async ({ page }) => {
    await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    await page.getByRole('button', { name: '寄样品', exact: true }).click();
    const name = `响应丢失 ${changed} ${Date.now()}`;
    await page.getByLabel('样品名称').fill(name);
    await page.getByLabel('收货人', { exact: true }).fill('张三');
    await page.getByLabel('手机号', { exact: true }).fill('13800138000');
    await page.getByLabel('收件省份').selectOption('广东');
    await page.getByLabel('收货地址', { exact: true }).fill('广东省佛山市原始地址');
    await page.getByRole('checkbox', { name: '顺丰到付', exact: true }).check();
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    let dropped = false;
    await page.route('**/orders/new', async (route) => {
      if (!dropped && route.request().method() === 'POST' && route.request().postData()?.includes('clientSubmissionId')) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: '保存工单', exact: true }).click();
    await expect(page.getByText('工单保存失败，请重试', { exact: true })).toBeVisible();
    expect(dropped).toBe(true);
    if (changed) {
      await page.getByLabel('收货地址', { exact: true }).fill('广东省佛山市新地址');
      await page.getByRole('button', { name: '核对费用', exact: true }).click();
    }
    await page.getByRole('button', { name: '保存工单', exact: true }).click();
    if (changed) await expect(page.getByText(/本次填写与原记录不一致或无法核对/)).toBeVisible();
    else await expect(page.getByRole('button', { name: '查看已保存工单', exact: true })).toBeVisible();
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const rows = (await db.query('SELECT "receiverAddress" FROM "Order" WHERE "customName"=$1', [name])).rows;
      expect(rows).toEqual([{ receiverAddress: '广东省佛山市原始地址' }]);
    } finally { await db.end(); }
  });
}
