import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

// Explicit disposable databases only; never inherit .env and write to the working development DB.
const url = process.env.DATABASE_URL;
const disposable = url && /(?:^|\/)(?:erp_e2e_|test_)[a-zA-Z0-9_-]+(?:\?|$)/u.test(new URL(url).pathname);
const databaseDescribe = disposable ? describe : describe.skip;
const migration = readFileSync('prisma/migrations/20260920180000_blank_price_rules/migration.sql', 'utf8');

databaseDescribe('blank price SQL constraints', () => {
  it('accepts text prices, rejects aliased duplicates and keeps nonblank BASE constraints', async () => {
    const client = new Client({ connectionString: url });
    const schema = `blank_prices_${randomBytes(8).toString('hex')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      await client.query(`
        CREATE TYPE "CustomerPriceRuleKind" AS ENUM ('BASE','ADD_ON','REFERENCE');
        CREATE TYPE "CustomerPriceCalculationType" AS ENUM ('PER_PIECE','FIXED_AMOUNT','PER_SHEET');
        CREATE TABLE "CustomerPriceBook" (id TEXT PRIMARY KEY, purpose TEXT, "settlementType" TEXT);
        CREATE TABLE "CustomerChargeCategory" (id TEXT PRIMARY KEY, code TEXT, "isActive" BOOLEAN);
        CREATE TABLE "CustomerPriceRule" (
          id TEXT PRIMARY KEY, "priceBookId" TEXT, "categoryId" TEXT, "productId" TEXT,
          code TEXT, name TEXT, kind "CustomerPriceRuleKind", "calculationType" "CustomerPriceCalculationType",
          amount NUMERIC(14,4), priority INTEGER DEFAULT 0, "minQty" INTEGER DEFAULT 1, "maxQty" INTEGER,
          "triggerCondition" JSONB, "exclusiveGroup" TEXT DEFAULT 'STOCK_BASE',
          "blocksAutomaticQuote" BOOLEAN DEFAULT FALSE, "isActive" BOOLEAN DEFAULT TRUE,
          "sourceSheet" TEXT, "sourceRange" TEXT, CONSTRAINT "CustomerPriceRule_values_valid" CHECK (TRUE));
        INSERT INTO "CustomerPriceBook" VALUES ('book','PROCESSING','EXTERNAL_SALES');
        INSERT INTO "CustomerChargeCategory" VALUES ('base','BASE_PROCESSING',TRUE);
      `);
      await client.query(migration);
      const condition = { schemaVersion: 1, target: 'ITEM', pricingRoutes: ['STOCK_BLANK'], paperTypes: ['180g红卡'], specifications: ['中号封'] };
      const insert = (id: string, overrides: { condition?: unknown; amount?: string | null; group?: string; productId?: string | null; category?: string } = {}) => client.query(`INSERT INTO "CustomerPriceRule"
        (id,"priceBookId","categoryId","productId",code,name,kind,"calculationType",amount,"triggerCondition","exclusiveGroup")
        VALUES ($1,'book',$2,$3,$1,$1,'BASE','PER_PIECE',$4,$5,$6)`,
      [id, overrides.category ?? 'base', overrides.productId ?? null, overrides.amount === undefined ? '0.135' : overrides.amount,
        JSON.stringify(overrides.condition ?? condition), overrides.group ?? 'STOCK_BASE']);
      await insert('positive');
      await expect(insert('alias', { condition: { ...condition, paperTypes: ['180克红卡'], specifications: ['中号80×115'] } })).rejects.toMatchObject({ code: '23505' });
      await insert('zero', { amount: '0', condition: { ...condition, specifications: ['大号封'] } });
      await expect(insert('null', { amount: null })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('negative', { amount: '-1' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('nonblank', { group: 'CUSTOM_BASE' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('extra', { condition: { ...condition, productCodes: ['fake'] } })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('category', { category: 'missing' })).rejects.toMatchObject({ code: '23514' });
      await expect(insert('unknown', { condition: { ...condition, specifications: ['自定义'] } })).rejects.toMatchObject({ code: '23514' });
      const result = await client.query('SELECT "productId", amount::TEXT FROM "CustomerPriceRule" ORDER BY amount');
      expect(result.rows).toEqual([{ productId: null, amount: '0.0000' }, { productId: null, amount: '0.1350' }]);
    } finally {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });
});
