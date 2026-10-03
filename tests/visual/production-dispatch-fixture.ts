import { randomUUID } from 'node:crypto';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_USERS, withDb } from '../e2e/_helpers';

export async function seedProductionDispatchFixture({ incomplete = false }: { incomplete?: boolean } = {}) {
  assertActivatedE2eDatabase();
  const id = `dispatch-ui-${randomUUID()}`;
  return withDb(async db => {
    const users = (await db.query<{ id: string; username: string }>('SELECT id, username FROM "User" WHERE username = ANY($1::text[])', [[E2E_USERS.owner.username, E2E_USERS.sales.username, E2E_USERS.workerHandPress.username]])).rows;
    const userId = (username: string) => users.find(user => user.username === username)!.id;
    const craft = (await db.query<{ id: string }>('SELECT id FROM "Craft" WHERE code=$1', ['FLAT_FOIL_PARTIAL'])).rows[0];
    await db.query('BEGIN');
    try {
      await db.query(`INSERT INTO "Order" (id,"orderNo","customName","submitterId","submitterRole","createdById","settlementType",status,"pricingStatus","pricingConfirmedAt","pricingConfirmedById","confirmedFee","totalAmount","updatedAt")
        VALUES ($1,$1,'排单扫码验收',$2,'SALES',$3,'EXTERNAL_SALES','CONFIRMED','ADMIN_CONFIRMED',NOW(),$3,100,100,NOW())`, [id, userId(E2E_USERS.sales.username), userId(E2E_USERS.owner.username)]);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,quantity,craft,"pricingRoute","productStructure","foilTechnique","frontFoilColors",crafts,"paperType","updatedAt")
        VALUES ($1,$2,1,'验收款',1000,'PARTIAL','CUSTOM_SINGLE_FLAT_FOIL','STANDARD_ENVELOPE','FLAT',ARRAY['亚金'],ARRAY[$3]::text[],'珠光纸',NOW())`, [`${id}-item`, id, craft.id]);
      if (incomplete) {
        await db.query('UPDATE "OrderItem" SET craft=NULL, crafts=ARRAY[]::text[] WHERE "orderId"=$1', [id]);
      } else {
      await db.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,mode,"actualBagCount","updatedAt") VALUES ($1,$2,1,'SINGLE_STYLE',1000,NOW())`, [`${id}-pack`, id]);
      await db.query(`INSERT INTO "OrderPackagingGroupLine" (id,"packagingGroupId","orderItemId","orderId","unitsPerBag") VALUES ($1,$2,$3,$4,1)`, [`${id}-line`, `${id}-pack`, `${id}-item`, id]);
      }
      await db.query('COMMIT');
      return { id, workerId: userId(E2E_USERS.workerHandPress.username) };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  });
}
