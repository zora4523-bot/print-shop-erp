import { randomUUID } from 'node:crypto';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_USERS, withDb } from '../e2e/_helpers';

/** Append-only presentation fixtures, confined to the disposable E2E database. */
export async function seedOrderShippingRecoveryFixture(options: { shipmentCount?: 1 | 2; longAddress?: boolean } = {}) {
  assertActivatedE2eDatabase();
  const prefix = `shipping-recovery-${randomUUID()}`;
  const orders = {
    progress: `${prefix}-progress`,
    released: `${prefix}-released`,
    completed: `${prefix}-completed`,
    packing: `${prefix}-packing`,
  };
  await withDb(async (db) => {
    const sales = (await db.query<{ id: string }>('SELECT id FROM "User" WHERE username=$1', [E2E_USERS.sales.username])).rows[0];
    if (!sales) throw new Error('E2E sales fixture is required');
    await db.query('BEGIN');
    try {
      for (const [kind, id] of Object.entries(orders)) {
        const status = kind === 'released' ? 'RELEASED' : kind === 'packing' ? 'PACKING' : 'COMPLETED';
        await db.query(`INSERT INTO "Order" (id,"orderNo","customName","submitterId","submitterRole","createdById",
          "billingMode","settlementType",status,"pricingStatus","pricingConfirmedAt","processingAmount","confirmedFee","totalAmount",
          "receiverName","receiverPhone","receiverAddress","updatedAt")
          VALUES ($1,$1,'发货恢复验证',$2,'SALES',$2,'NO_CHARGE','NO_CHARGE',$3,'AUTO_CONFIRMED',NOW(),0,0,0,
          '历史收件人','13800138000','历史收货地址',NOW())`, [id, sales.id, status]);
        await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute","productStructure",
          "paperType","paperWeightGsm",quantity,crafts,"foilTechnique",subtotal,"updatedAt")
          VALUES ($1,$2,1,'无计件款','STOCK_BLANK','STANDARD_ENVELOPE','珠光艳闪',160,100,
          ARRAY[]::text[],'NONE',0,NOW())`, [`${id}-item`, id]);
        if (kind === 'released') {
          const shipmentCount = options.shipmentCount ?? 1;
          for (let sequence = 1; sequence <= shipmentCount; sequence++) {
            const shipmentId = sequence === 1 ? `${id}-shipment` : `${id}-shipment-${sequence}`;
            const address = options.longAddress
              ? `广东省佛山市南海区测试街道物流园收货区 ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(2)}，二楼收货处`
              : '测试收货地址';
            await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone",
              "receiverAddress","updatedAt") VALUES ($1,$2,$3,'测试收件人','13800138000',$4,NOW())`, [shipmentId, id, sequence, address]);
            await db.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity)
              VALUES ($1,$2,$3,$4)`, [`${shipmentId}-line`, shipmentId, `${id}-item`, 100 / shipmentCount]);
          }
        }
        if (kind === 'progress') {
          await db.query(`INSERT INTO "ProductionProgressStep" (id,"orderId","orderItemId","craftId",
            "craftCode","craftName",status,"plannedQty","carriedCompletedQty","updatedAt")
            VALUES ($1,$2,$3,'recovery-gluing','GLUING','粘封','IN_PROGRESS',100,40,NOW())`,
          [`${id}-step`, id, `${id}-item`]);
        }
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
  return orders;
}
