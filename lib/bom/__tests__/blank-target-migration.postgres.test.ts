import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { isDisposableE2eDatabaseName, postgresDatabaseIdentity } from '../../../scripts/lib/e2e-environment';
import { migrateBlankBomTargets } from '../../../scripts/maintenance/migrate-blank-bom-targets';

// Explicit test database only. No dotenv import or ordinary-database fallback.
const databaseUrl = process.env.DATABASE_URL;
const identity = databaseUrl ? postgresDatabaseIdentity(databaseUrl) : null;
const databaseDescribe = identity && isDisposableE2eDatabaseName(identity.databaseName) ? describe : describe.skip;
const original = readFileSync('prisma/migrations/20260628013000_bom_material_usage/migration.sql', 'utf8');
const forward = readFileSync('prisma/migrations/20260920181000_blank_bom_targets/migration.sql', 'utf8');
async function withSchema(run: (client: Client, schema: string) => Promise<void>) {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `blank_bom_${randomBytes(8).toString('hex')}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE "Material" (id TEXT PRIMARY KEY, name TEXT, specification TEXT, category TEXT);
      CREATE TABLE "ProductCategoryNode" (id TEXT PRIMARY KEY, "isActive" BOOLEAN, "legacyCategory" TEXT);
      CREATE TABLE "Product" (id TEXT PRIMARY KEY, category TEXT, "paperMaterialId" TEXT, "paperType" TEXT, weight INT, specification TEXT, "categoryNodeId" TEXT);
      CREATE TABLE "Setting" (id TEXT PRIMARY KEY, key TEXT UNIQUE, value JSONB NOT NULL, remark TEXT, "updatedAt" TIMESTAMP);
      CREATE TABLE "BusinessAuditLog" (id TEXT PRIMARY KEY, action TEXT, "entityType" TEXT, "entityId" TEXT, "before" JSONB, "after" JSONB);
      INSERT INTO "Material" VALUES ('paper','红卡','180g','PAPER'), ('ingredient','用料纸','大张','PAPER');
      INSERT INTO "ProductCategoryNode" VALUES ('node',true,'BLANK_STOCK'), ('inactive',false,'BLANK_STOCK'), ('other',true,'COLOR_PRINT');
      INSERT INTO "Product" VALUES ('product','BLANK_STOCK','paper','180g红卡',180,'中号封80×115','node');
    `);
    await client.query(original);
    await client.query(`INSERT INTO "BillOfMaterial" (id,"productId",name,version,"baseQuantity","updatedAt") VALUES ('legacy','product','原产品用料',3,1000,NOW());
      INSERT INTO "BillOfMaterialItem" (id,"bomId","materialId",quantity,"sortOrder",remark,"updatedAt") VALUES ('item','legacy','ingredient',123.4567,20,'保留备注',NOW());`);
    await client.query(forward);
    await run(client, schema);
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
}

databaseDescribe('blank BOM forward migration with real PostgreSQL', () => {
  it('upgrades old BOMs, enforces exactly-one target/version/active uniqueness and protects historical parents', async () => {
    await withSchema(async (client) => {
      const originalRow = await client.query('SELECT "productId", version, "baseQuantity" FROM "BillOfMaterial" WHERE id=\'legacy\'');
      expect(originalRow.rows).toEqual([{ productId: 'product', version: 3, baseQuantity: 1000 }]);
      const insert = (id: string, fields: { productId?: string; categoryNodeId?: string; paperId?: string; key?: string; version?: number; active?: boolean }) => client.query(`
        INSERT INTO "BillOfMaterial" (id,"productId","categoryNodeId","blankPaperMaterialId","blankSpecificationKey",name,version,"isActive","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$1,$6,$7,NOW())`, [id, fields.productId ?? null, fields.categoryNodeId ?? null, fields.paperId ?? null, fields.key ?? null, fields.version ?? 1, fields.active ?? true]);
      await expect(insert('no-target', {})).rejects.toMatchObject({ code: '23514' });
      await expect(insert('half-target', { paperId: 'paper' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('mixed', { paperId: 'paper', key: 'mid', categoryNodeId: 'node' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('unknown-spec', { paperId: 'paper', key: 'custom' })).rejects.toMatchObject({ code: '23514' });
      await insert('blank', { paperId: 'paper', key: 'mid' });
      await expect(insert('active-duplicate', { paperId: 'paper', key: 'mid', version: 2 })).rejects.toMatchObject({ code: '23505' });
      await insert('inactive-version', { paperId: 'paper', key: 'mid', version: 2, active: false });
      await expect(insert('version-duplicate', { paperId: 'paper', key: 'mid', version: 2, active: false })).rejects.toMatchObject({ code: '23505' });
      await expect(client.query('DELETE FROM "Material" WHERE id=\'paper\'')).rejects.toMatchObject({ code: '23503' });
      await expect(client.query('DELETE FROM "Product" WHERE id=\'product\'')).rejects.toMatchObject({ code: '23503' });
      await insert('category', { categoryNodeId: 'node' });
      await expect(client.query('DELETE FROM "ProductCategoryNode" WHERE id=\'node\'')).rejects.toMatchObject({ code: '23503' });
      expect((await client.query('SELECT COUNT(*)::int AS count FROM "BillOfMaterialItem" WHERE "bomId"=\'legacy\'')).rows[0]?.count).toBe(1);
    });
  });
  it('protects the production category setting against invalid references, deletion and retirement', async () => {
    await withSchema(async (client) => {
      const set = (value: unknown) => client.query(`INSERT INTO "Setting" (id,key,value,"updatedAt") VALUES ('default','blank_stock_bom_category_node_id',$1::jsonb,NOW())
        ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(value)]);
      for (const value of ['missing', 'inactive', 'other', '', {}, 1]) await expect(set(value)).rejects.toMatchObject({ code: 'P0001' });
      await set('node');
      await expect(client.query('UPDATE "ProductCategoryNode" SET "isActive"=false WHERE id=\'node\'')).rejects.toMatchObject({ code: 'P0001' });
      await expect(client.query('UPDATE "ProductCategoryNode" SET "legacyCategory"=\'COLOR_PRINT\' WHERE id=\'node\'')).rejects.toMatchObject({ code: 'P0001' });
      await expect(client.query('DELETE FROM "ProductCategoryNode" WHERE id=\'node\'')).rejects.toMatchObject({ code: 'P0001' });
      await set(null);
      await expect(client.query('UPDATE "ProductCategoryNode" SET "isActive"=false WHERE id=\'node\'')).resolves.toMatchObject({ rowCount: 1 });
    });
  });
  it('CLI dry-run is read-only, apply copies identical usage with audit and replay makes no changes', async () => {
    await withSchema(async (client) => {
      const options = { databaseUrl: databaseUrl!, apply: false, defaultCategoryId: undefined };
      const sourceBefore = (await client.query('SELECT row_to_json(b) AS value FROM "BillOfMaterial" b WHERE id=\'legacy\'')).rows;
      const preview = await migrateBlankBomTargets(client, options);
      expect(preview).toMatchObject({ ready: true, applied: false, defaultCategoryId: null });
      expect(preview.copies).toHaveLength(1);
      expect((await client.query('SELECT COUNT(*)::int AS count FROM "BillOfMaterial"')).rows[0]?.count).toBe(1);
      const applied = await migrateBlankBomTargets(client, { ...options, apply: true });
      expect(applied).toMatchObject({ ready: true, applied: true });
      const id = applied.copies[0]!.id;
      const compared = await client.query(`SELECT quantity::text, (quantity * 2500 / b."baseQuantity")::numeric(12,4)::text AS estimate,
        b.version, b."baseQuantity", i."sortOrder", i.remark FROM "BillOfMaterial" b JOIN "BillOfMaterialItem" i ON i."bomId"=b.id WHERE b.id=$1`, [id]);
      expect(compared.rows).toEqual([{ quantity: '123.4567', estimate: '308.6418', version: 3, baseQuantity: 1000, sortOrder: 20, remark: '保留备注' }]);
      expect((await client.query('SELECT row_to_json(b) AS value FROM "BillOfMaterial" b WHERE id=\'legacy\'')).rows).toEqual(sourceBefore);
      expect((await client.query('SELECT "after" FROM "BusinessAuditLog" WHERE "entityId"=$1', [id])).rows[0]?.after).toMatchObject({ quantitiesVerified: true });
      const counts = (await client.query('SELECT (SELECT COUNT(*) FROM "BillOfMaterial") AS boms, (SELECT COUNT(*) FROM "BillOfMaterialItem") AS items, (SELECT COUNT(*) FROM "BusinessAuditLog") AS audits')).rows;
      const again = await migrateBlankBomTargets(client, { ...options, apply: true });
      expect(again.copies).toHaveLength(0);
      expect(again.preserved).toEqual([id]);
      expect((await client.query('SELECT (SELECT COUNT(*) FROM "BillOfMaterial") AS boms, (SELECT COUNT(*) FROM "BillOfMaterialItem") AS items, (SELECT COUNT(*) FROM "BusinessAuditLog") AS audits')).rows).toEqual(counts);
    });
  });
  it('CLI rejects ambiguous source mapping without partial writes', async () => {
    await withSchema(async (client) => {
      await client.query(`INSERT INTO "Material" VALUES ('duplicate','180g红卡',NULL,'PAPER')`);
      const report = await migrateBlankBomTargets(client, { databaseUrl: databaseUrl!, apply: true, defaultCategoryId: undefined });
      expect(report.ready).toBe(false);
      expect(report.applied).toBe(false);
      expect((await client.query('SELECT COUNT(*)::int AS count FROM "BillOfMaterial"')).rows[0]?.count).toBe(1);
      expect((await client.query('SELECT COUNT(*)::int AS count FROM "BusinessAuditLog"')).rows[0]?.count).toBe(0);
    });
  });
  it('two concurrent writers cannot activate two BOMs for one paper and specification', async () => {
    await withSchema(async (client, schema) => {
      const contender = new Client({ connectionString: databaseUrl });
      await contender.connect();
      try {
        await contender.query(`SET search_path TO "${schema}", public`);
        const insert = (connection: Client, id: string, version: number) => connection.query(`INSERT INTO "BillOfMaterial"
          (id,"blankPaperMaterialId","blankSpecificationKey",name,version,"updatedAt") VALUES ($1,'paper','large',$1,$2,NOW())`, [id, version]);
        const results = await Promise.allSettled([insert(client, 'one', 1), insert(contender, 'two', 2)]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({ code: '23505' });
      } finally { await contender.end(); }
    });
  });
});
