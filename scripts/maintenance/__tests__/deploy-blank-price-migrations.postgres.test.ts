import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { assertBlankPriceMigrationsApplied, deployBlankPriceMigrations } from '../deploy-blank-price-migrations';
import { isDisposableE2eDatabaseName, postgresDatabaseIdentity } from '../../lib/e2e-environment';
import { PRICE_RULE_SNAPSHOT_LOCK_KEY } from '../../../lib/price/rule-snapshot-lock';

const url = process.env.DATABASE_URL;
const identity = url ? postgresDatabaseIdentity(url) : null;
const databaseDescribe = identity && isDisposableE2eDatabaseName(identity.databaseName) ? describe : describe.skip;

async function fixture(run: (client: Client, options: { databaseUrl: string; confirmDatabase: string; writersStopped: boolean }) => Promise<void>) {
  const schema = `cutover_${randomBytes(8).toString('hex')}`;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ);
      CREATE TABLE "Material" (id TEXT, name TEXT, specification TEXT, category TEXT, "isActive" BOOLEAN, "outOfStock" BOOLEAN);
      CREATE TABLE "CustomerPriceBook" (id TEXT, version INT, "isActive" BOOLEAN, "effectiveFrom" TIMESTAMPTZ, "effectiveTo" TIMESTAMPTZ, notes JSONB, purpose TEXT, "settlementType" TEXT);
      CREATE TABLE "Product" (id TEXT, code TEXT, "paperMaterialId" TEXT, "paperType" TEXT, weight INT, specification TEXT, "categoryNodeId" TEXT, category TEXT);
      CREATE TABLE "CustomerPriceRule" (id TEXT, "priceBookId" TEXT, "productId" TEXT, amount NUMERIC, "isActive" BOOLEAN, kind TEXT, "calculationType" TEXT, "triggerCondition" JSONB, "exclusiveGroup" TEXT);
      CREATE TABLE "Order" (id TEXT, status TEXT);
      CREATE TABLE "OrderItem" (id TEXT, "orderId" TEXT, "productId" TEXT, "pricingRoute" TEXT, "paperType" TEXT, "paperWeightGsm" INT, specification TEXT, "actualWidthMm" NUMERIC, "actualHeightMm" NUMERIC, quantity INT, "unitPrice" NUMERIC, "fixedFee" NUMERIC, subtotal NUMERIC, "pricingSnapshot" JSONB);
      CREATE TABLE "ProductCategoryNode" (id TEXT, "isActive" BOOLEAN, "legacyCategory" TEXT);
      CREATE TABLE "BillOfMaterial" (id TEXT, "productId" TEXT);
      CREATE TABLE "BillOfMaterialItem" ("bomId" TEXT, "materialId" TEXT, quantity NUMERIC, "sortOrder" INT, remark TEXT);
      CREATE TABLE "Setting" (key TEXT, value JSONB);
      CREATE TABLE "PriceTier" ("productId" TEXT);
      INSERT INTO "Material" VALUES ('paper','180g红卡','180g','PAPER',true,false);
      INSERT INTO "CustomerPriceBook" VALUES ('book',1,true,NOW()-INTERVAL '1 day',NULL,'{}','PROCESSING','EXTERNAL_SALES');
      INSERT INTO "CustomerPriceRule" VALUES ('rule','book',NULL,0.135,true,'BASE','PER_PIECE','{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"paperTypes":["180g红卡"],"specifications":["中号封"]}','STOCK_BASE');
    `);
    for (const entry of readdirSync('prisma/migrations', { withFileTypes: true })) {
      if (entry.isDirectory() && !['20260920180000_blank_price_rules', '20260920181000_blank_bom_targets'].includes(entry.name)) {
        await client.query('INSERT INTO "_prisma_migrations" VALUES ($1,NOW(),NULL)', [entry.name]);
      }
    }
    const target = new URL(url!);
    target.searchParams.set('application_name', schema);
    target.searchParams.set('options', `-c search_path=${schema},public`);
    await run(client, { databaseUrl: target.href, confirmDatabase: identity!.databaseName, writersStopped: true });
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
}

databaseDescribe('blank migration deployment gate', () => {
  it('blocks the normal deployment entry until both reviewed migrations are complete', async () => fixture(async (client, options) => {
    await expect(assertBlankPriceMigrationsApplied(options.databaseUrl)).rejects.toThrow('guarded blank-price cutover');
    await client.query(`INSERT INTO "_prisma_migrations" VALUES ('20260920180000_blank_price_rules',NOW(),NULL)`);
    await expect(assertBlankPriceMigrationsApplied(options.databaseUrl)).rejects.toThrow('guarded blank-price cutover');
    await client.query(`INSERT INTO "_prisma_migrations" VALUES ('20260920181000_blank_bom_targets',NOW(),NULL)`);
    await expect(assertBlankPriceMigrationsApplied(options.databaseUrl)).resolves.toBeUndefined();
    const update = readFileSync('deploy/update.sh', 'utf8');
    const gate = update.indexOf('pnpm exec tsx scripts/maintenance/deploy-blank-price-migrations.ts --check-applied');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(update.indexOf('DEPLOYMENT_QUIESCED=1'));
    expect(gate).toBeLessThan(update.indexOf('pnpm exec prisma migrate deploy'));
  }));

  it('rejects duplicate identities before invoking Prisma or creating failure journal rows', async () => fixture(async (client, options) => {
    await client.query('INSERT INTO "CustomerPriceRule" SELECT \'duplicate\',"priceBookId","productId",amount,"isActive",kind,"calculationType","triggerCondition","exclusiveGroup" FROM "CustomerPriceRule"');
    const migrate = vi.fn();
    expect(await deployBlankPriceMigrations(options, migrate)).toMatchObject({ applied: false, report: { prices: { duplicateRuleGroups: [['duplicate', 'rule']] } } });
    expect(migrate).not.toHaveBeenCalled();
    expect((await client.query('SELECT * FROM "_prisma_migrations" WHERE finished_at IS NULL')).rows).toEqual([]);
  }));

  it('holds the shared price authority lock through migration and releases it on failure', async () => fixture(async (client, options) => {
    let lockPid: number | undefined;
    const migrate = vi.fn(async (connectionString: string) => {
      const peer = new Client({ connectionString });
      await peer.connect();
      try {
        lockPid = (await peer.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = $1 AND l.locktype = 'advisory' AND l.granted", [new URL(connectionString).searchParams.get('application_name')])).rows[0]?.pid;
        expect(lockPid).toBeTypeOf('number');
        expect((await peer.query('SHOW lock_timeout')).rows[0].lock_timeout).toBe('5s');
        expect((await peer.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('2min');
        expect((await peer.query('SELECT pg_try_advisory_xact_lock_shared(hashtext($1)) AS acquired', [PRICE_RULE_SNAPSHOT_LOCK_KEY])).rows[0].acquired).toBe(false);
      } finally { await peer.end(); }
      throw new Error('synthetic migration failure');
    });
    await expect(deployBlankPriceMigrations(options, migrate)).rejects.toThrow('synthetic migration failure');
    expect(migrate).toHaveBeenCalledOnce();
    await expect.poll(async () => (await client.query("SELECT pid FROM pg_locks WHERE pid = $1 AND locktype = 'advisory'", [lockPid])).rows).toEqual([]);
  }));

  it('rejects an existing table reader before invoking Prisma', async () => fixture(async (client, options) => {
    await client.query('BEGIN');
    await client.query('LOCK TABLE "CustomerPriceRule" IN ACCESS SHARE MODE');
    const migrate = vi.fn();
    await expect(deployBlankPriceMigrations(options, migrate)).rejects.toMatchObject({ code: '55P03' });
    expect(migrate).not.toHaveBeenCalled();
  }));
});
