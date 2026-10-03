import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login, withDb } from './_helpers';

/**
 * 管理员改单的确认离开（2026-10-04 全应用导航守卫，复审第五轮）：「返回工单详情」「放弃」确认后
 * 由 Next 客户端导航接管；目标页 RSC 失败退回整页加载时不得再弹原生离开提示，
 * 即使失败发生在 10 秒之后。
 */
async function seedOrder() {
  assertActivatedE2eDatabase();
  const id = `e2e-edit-leave-${randomUUID()}`;
  const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
  await withDb(async (db) => {
    await db.query('BEGIN');
    try {
      const craft = (await db.query(`SELECT id FROM "Craft" WHERE code='FLAT_FOIL_PARTIAL' AND "isActive" LIMIT 1`)).rows[0];
      expect(craft).toBeTruthy();
      await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","processingAmount","totalAmount","confirmedFee","pricingStatus","pricingConfirmedAt","updatedAt")
        VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES','SUBMITTED','离开保护回归','测试收件人','13800138000','广东省佛山市测试路1号',100,100,100,'LEGACY_CONFIRMED',NOW(),NOW())`, [id, salesId]);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,fig,name,"pricingRoute","productStructure",specification,"paperType","paperWeightGsm",quantity,pack,crafts,"frontFoilColors","backFoilColors","foilColors","foilTechnique","hasLocalFoil","isDoubleColor","actualWidthMm","actualHeightMm","unitPrice",subtotal,"suggestedSubtotal","pricingSnapshot","updatedAt")
        VALUES ($1,$2,1,1,'离开款式','STOCK_BLANK','STANDARD_ENVELOPE','大号封90×165','珠光艳闪',160,1000,10,ARRAY[$3]::text[],ARRAY['亚金'],ARRAY[]::text[],ARRAY['亚金'],'FLAT',true,false,90,165,0.1,100,100,'{"version":1,"complete":true,"suggestedSubtotal":"100.00","source":"historical-fixture"}',NOW())`,
      [`${id}-item`, id, craft.id]);
      await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","carrierCode","updatedAt")
        VALUES ($1,$2,1,'测试收件人','13800138000','广东省佛山市测试路1号','广东','ZTO',NOW())`, [`${id}-shipment`, id]);
      await db.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,1000)`, [`${id}-line`, `${id}-shipment`, `${id}-item`]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
  return id;
}

async function openDirtyEditor(page: Page, id: string) {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/orders/${id}/edit` });
  await page.getByRole('textbox', { name: '第 1 款名称', exact: true }).fill('未保存的名称');
  const prompts: string[] = [];
  page.on('dialog', async (dialog) => { prompts.push(dialog.type()); await dialog.accept(); });
  return prompts;
}

for (const [action, delayMs] of [['返回工单详情', 0], ['放弃', 0], ['放弃', 11_000]] as const) {
  test(`${action}: confirmed leave whose detail RSC fails${delayMs ? ' after 11 s' : ''} falls back without a second prompt`, async ({ page }) => {
    test.setTimeout(90_000);
    const id = await seedOrder();
    const prompts = await openDirtyEditor(page, id);
    await page.route((url) => url.pathname === `/orders/${id}` && url.searchParams.has('_rsc'), async (route) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.fulfill({ status: 500, body: 'boom' });
    });
    await page.getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${id}$`), { timeout: delayMs + 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(prompts).toEqual([]);
  });
}
