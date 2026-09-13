import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { E2E_PASSWORD } from './global-setup';
import { withLedgerDb } from './release-ledger-fixtures';

/** Only the actor is seeded. Every master-data mutation under test uses its UI. */
export async function seedMasterDataAdmin() {
  const suffix = randomUUID().slice(0, 8);
  const username = `e2e-master-${suffix}`;
  const password = await bcrypt.hash(E2E_PASSWORD, 10);
  await withLedgerDb((db) => db.query(
    `INSERT INTO "User" (id,username,password,role,"displayName","updatedAt")
     VALUES ($1::text,$1::text::citext,$2,'ADMIN',$3,NOW())`,
    [username, password, `主数据验收${suffix}`],
  ));
  return { username, suffix };
}

const MASTER_READS = {
  account: 'SELECT id,username,"displayName",phone,role,"workerType","isActive","createdAt" FROM "User" WHERE id=$1',
  category: 'SELECT id,path,name,"legacyCategory","sortOrder","isActive","createdAt" FROM "ProductCategoryNode" WHERE id=$1',
  craft: 'SELECT id,code,name,"isOutsource","sortOrder","isActive","createdAt" FROM "Craft" WHERE id=$1',
  paper: 'SELECT id,code,name,category,specification,unit,"safetyStock"::text,"averageCost"::text,"currentStock"::text,"isActive","createdAt" FROM "Material" WHERE id=$1',
  product: 'SELECT id,code,name,category,"categoryNodeId",specification,"paperType","isActive","createdAt" FROM "Product" WHERE id=$1',
} as const;

export async function readMasterRow(kind: keyof typeof MASTER_READS, id: string) {
  return withLedgerDb(async (db) => (await db.query<Record<string, unknown>>(MASTER_READS[kind], [id])).rows[0]);
}

export async function readPartyState(id: string) {
  return withLedgerDb(async (db) => ({
    party: (await db.query('SELECT id,code,type,name,"shortName","isActive","createdAt" FROM "Party" WHERE id=$1', [id])).rows[0],
    contacts: (await db.query('SELECT id,name,phone,wechat,"isPrimary" FROM "PartyContact" WHERE "partyId"=$1 ORDER BY id', [id])).rows,
    addresses: (await db.query('SELECT id,"receiverName","receiverPhone",province,city,district,detail,"isDefault" FROM "PartyAddress" WHERE "partyId"=$1 ORDER BY id', [id])).rows,
  }));
}

export async function readPurchaseSupplierSnapshot(id: string) {
  return withLedgerDb(async (db) => (await db.query(
    'SELECT id,"supplierPartyId","supplierCode","supplierName",status,"createdAt" FROM "PurchaseOrder" WHERE id=$1', [id],
  )).rows[0]);
}

export async function readBomVersions(productId: string) {
  return withLedgerDb(async (db) => (await db.query(
    `SELECT bom.id,bom.name,bom.version,bom."baseQuantity",bom."isActive",bom."createdAt",
      (SELECT json_agg(json_build_object('id',item.id,'materialId',item."materialId",'quantity',item.quantity::text,'remark',item.remark) ORDER BY item."sortOrder")
       FROM "BillOfMaterialItem" item WHERE item."bomId"=bom.id) AS items
     FROM "BillOfMaterial" bom WHERE bom."productId"=$1 ORDER BY bom.version`, [productId],
  )).rows);
}

export async function readProductStatusAudits(productId: string) {
  return withLedgerDb(async (db) => (await db.query(
    `SELECT action,"actorUsername",before,after,"requestMetadata" FROM "BusinessAuditLog"
     WHERE "entityType"='Product' AND "entityId"=$1 AND action IN ('PRODUCT_ACTIVATE','PRODUCT_DEACTIVATE')
     ORDER BY "createdAt",id`, [productId],
  )).rows);
}
