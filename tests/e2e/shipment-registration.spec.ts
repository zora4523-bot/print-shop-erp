import { test, expect } from '@playwright/test';
import Decimal from 'decimal.js';
import sharp from 'sharp';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { resolveExternalOrderChargesForFinalization } from '../../lib/price/order-charge-service';
import { login, E2E_USERS } from './_helpers';

const PROCESSING_AMOUNT = '25.00';
const SHIPMENTS = [
  { sequence: 1, province: '广东', weightKg: '2.000', quantity: 600 },
  { sequence: 2, province: '湖南', weightKg: '3.000', quantity: 400 },
] as const;

/**
 * Playwright 的 CJS runner 不能加载生成的 Prisma client（见 _helpers.ts）。物流收费计算
 * 只读取价目簿与规则，这里用 pg 提供同形状的只读 client，直接调用发货时同一个
 * resolveExternalOrderChargesForFinalization，保证夹具的收费行与最后一票发货时的重算一致。
 */
function logisticsPriceBookReader(db: Client): Prisma.TransactionClient {
  return {
    $executeRaw: async () => 0,
    customerPriceBook: {
      findMany: async ({ where }: { where: { id?: string } }) => {
        const books = await db.query(
          'SELECT id, code::text AS code, name, version, "sourceName", "sourceSha256", notes FROM "CustomerPriceBook" WHERE id = $1',
          [where.id],
        );
        return Promise.all(books.rows.map(async (book) => {
          const rules = await db.query(
            `SELECT r.id, r.code::text AS code, r.amount::text AS amount, r."includedUnits"::text AS "includedUnits",
                    r."incrementUnits"::text AS "incrementUnits", r."incrementAmount"::text AS "incrementAmount",
                    r."minQty", r."maxQty", r."triggerCondition", r."sourceSheet", r."sourceRange", r."sourceName",
                    r."sourceSha256", r."blocksAutomaticQuote", c.id AS "categoryId", c.code::text AS "categoryCode"
               FROM "CustomerPriceRule" r JOIN "CustomerChargeCategory" c ON c.id = r."categoryId"
              WHERE r."priceBookId" = $1 AND r."isActive" AND c."isActive"
                AND c.code IN ('SHIPPING_FEE', 'PACKING_MATERIAL')
              ORDER BY c."sortOrder", r.code`,
            [book.id],
          );
          return { ...book, rules: rules.rows.map(({ categoryId, categoryCode, ...rule }) => ({ ...rule, category: { id: categoryId, code: categoryCode } })) };
        }));
      },
    },
  } as unknown as Prisma.TransactionClient;
}

/** 与建单一致的外部销售工单：专属销售提交、管理员核价、每个地址一行快递费和一行包装材料费。 */
async function seedExternalSalesPackingOrder(db: Client, id: string) {
  const owner = (await db.query('SELECT id, password FROM "User" WHERE username=$1', [E2E_USERS.owner.username])).rows[0];
  // 结算后的工单会进入该销售的月度账单；每次使用专属销售，不污染 e2e-sales / 对账用例。
  const salesId = `${id}-sales`;
  await db.query(`INSERT INTO "User" (id, username, password, role, "displayName", "isActive", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'SALES', 'E2E 发货登记销售', TRUE, NOW(), NOW())`, [salesId, salesId, owner.password]);
  const book = (await db.query(`SELECT id FROM "CustomerPriceBook" WHERE purpose='LOGISTICS' AND "settlementType"='EXTERNAL_SALES'
    AND "isActive" AND "effectiveFrom" <= NOW() AND ("effectiveTo" IS NULL OR "effectiveTo" > NOW()) ORDER BY "effectiveFrom" DESC LIMIT 1`)).rows[0];
  expect(book, '隔离库应有生效的外部销售物流价目').toBeTruthy();
  const logistics = await resolveExternalOrderChargesForFinalization(logisticsPriceBookReader(db), {
    isSfCollect: false,
    shipments: SHIPMENTS.map((shipment) => ({
      shipmentKey: String(shipment.sequence), province: shipment.province, billableWeightKg: shipment.weightKg,
      itemQuantity: shipment.quantity, shippingFee: null, packingMaterialFee: null, overrideReason: null,
    })),
  }, book.id, new Date());
  expect(logistics.requiresAdminConfirmation).toBe(false);
  const receivable = new Decimal(PROCESSING_AMOUNT).plus(logistics.totalAmount).toFixed(2);
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"pricingStatus","pricingConfirmedAt","pricingConfirmedById","processingAmount","confirmedFee","totalAmount","receiverAddress","receiverPhone","revision","editVersion","workOrderVersion","priceRevision","updatedAt")
      VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES','PACKING','ADMIN_CONFIRMED',NOW(),$3,$4,$5,$5,'测试地址','13800138000',1,1,1,1,NOW())`,
    [id, salesId, owner.id, PROCESSING_AMOUNT, receivable]);
    await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute","productStructure","paperType","paperWeightGsm",quantity,crafts,"foilTechnique",subtotal,"updatedAt")
      VALUES ($1,$2,1,'发货登记测试款','STOCK_BLANK','STANDARD_ENVELOPE','珠光艳闪',160,1000,ARRAY[]::text[],'FLAT',$3,NOW())`, [`${id}-item`, id, PROCESSING_AMOUNT]);
    for (const shipment of SHIPMENTS) {
      const shipmentId = `${id}-${shipment.sequence}`;
      await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","weightKg","updatedAt")
        VALUES ($1,$2,$3,'测试收件人','13800138000','测试地址',$4,$5,NOW())`, [shipmentId, id, shipment.sequence, shipment.province, shipment.weightKg]);
      await db.query('INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,$4)', [`${shipmentId}-line`, shipmentId, `${id}-item`, shipment.quantity]);
    }
    for (const charge of logistics.charges) {
      await db.query(`INSERT INTO "OrderCustomerCharge" (id,"orderId","shipmentId","categoryId","priceBookId","sourceRuleId","businessKey",status,description,quantity,unit,"suggestedAmount",amount,"pricingSnapshot","createdById","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`, [
        `${id}-${charge.businessKey}`, id, `${id}-${charge.shipmentKey}`, charge.categoryId, charge.priceBookId, charge.sourceRuleId,
        charge.businessKey, charge.status, charge.description, charge.quantity, charge.unit, charge.suggestedAmount, charge.amount,
        JSON.stringify(charge.pricingSnapshot), salesId,
      ]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  return { receivable, salesId };
}

test('逐地址登记、面单历史与最后一票应收确认', async ({ page }) => {
  test.skip(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1', 'Requires an isolated database');
  test.setTimeout(120_000);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const id = `ship-e2e-${randomUUID()}`;
  try {
    const { receivable } = await seedExternalSalesPackingOrder(db, id);
    await login(page, { username: 'e2e-owner', password: 'e2e-test-password-1234' });
    await page.goto(`/orders/${id}`);
    const delivery = page.locator('#detail-delivery-records');
    await expect(delivery).toHaveAttribute('open', '');
    const first = delivery.locator('li').filter({ has: page.getByRole('textbox', { name: '运单号', exact: true }) }).nth(0);
    await first.getByRole('textbox', { name: '运单号', exact: true }).fill('ZTO-TEST-1');
    await first.getByRole('combobox', { name: '物流公司', exact: true }).selectOption('ZTO');
    await first.getByLabel('面单照片', { exact: false }).setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer() });
    await expect(first.getByRole('link', { name: '查看面单照片' })).toBeVisible();
    await first.getByRole('button', { name: '保存物流资料', exact: true }).click();
    await expect.poll(async () => (await db.query('SELECT "registrationVersion" FROM "OrderShipment" WHERE id=$1', [`${id}-1`])).rows[0].registrationVersion).toBe(1);
    await expect(first.getByRole('button', { name: '确认该地址已发货', exact: true })).toBeEnabled();
    await first.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认发货', exact: true }).click();
    await expect.poll(async () => (await db.query('SELECT status FROM "OrderShipment" WHERE id=$1', [`${id}-1`])).rows[0].status).toBe('SHIPPED');
    expect((await db.query('SELECT status,"settledFee" FROM "Order" WHERE id=$1', [id])).rows[0]).toEqual({ status: 'PACKING', settledFee: null });
    await expect(first.getByRole('button', { name: '确认该地址已发货', exact: true })).toHaveCount(0);
    const second = delivery.locator('li').filter({ has: page.getByRole('textbox', { name: '运单号', exact: true }) }).nth(1);
    await second.getByRole('textbox', { name: '运单号', exact: true }).fill('SF-TEST-2');
    await second.getByRole('combobox', { name: '物流公司', exact: true }).selectOption('SF');
    await second.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认发货', exact: true }).click();
    await expect.poll(async () => (await db.query('SELECT status FROM "Order" WHERE id=$1', [id])).rows[0].status).toBe('SETTLED');
    // 应收 = 加工费 + 价目簿按每个地址省份、计费重量与件数算出的快递费和包装材料费。
    const order = (await db.query('SELECT "settledFee","settledAt" FROM "Order" WHERE id=$1', [id])).rows[0];
    expect(order.settledFee).toBe(receivable); expect(order.settledAt).not.toBeNull();
    const finalized = await db.query(`SELECT count(*)::int AS n FROM "OrderCustomerCharge" WHERE "orderId"=$1 AND status IN ('FINAL','WAIVED') AND "finalizedAt" IS NOT NULL`, [id]);
    expect(finalized.rows[0].n).toBe(SHIPMENTS.length * 2);
    const labels = await db.query('SELECT id FROM "OrderShipmentLabel" WHERE "shipmentId"=$1', [`${id}-1`]);
    expect(labels.rowCount).toBe(1);
    const url = `/api/orders/${id}/shipments/${id}-1/labels/${labels.rows[0].id}`;
    expect((await page.request.get(url)).status()).toBe(200);
    await page.context().clearCookies();
    await login(page, { username: 'e2e-sales', password: 'e2e-test-password-1234' });
    expect((await page.request.get(url)).status()).toBe(404);
  } finally { await db.end(); }
});
