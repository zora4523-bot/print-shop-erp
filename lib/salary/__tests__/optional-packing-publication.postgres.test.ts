import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const migration = readFileSync('prisma/migrations/20260917190000_optional_unified_packing_rates/migration.sql', 'utf8');

(databaseUrl ? describe : describe.skip)('optional unified packing rates · PostgreSQL', () => {
  it('allows foil-only publication but retains required foil and personal packing guards', async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `optional_packing_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", public;
        CREATE TYPE "PieceworkOperationType" AS ENUM ('PARTIAL','FULL','PACKING');
        CREATE TYPE "PieceworkRateUnit" AS ENUM ('PER_PASS','PER_PIECE','PER_BAG','PER_BOX');
        CREATE TABLE "User" (id text, role text, "workerType" text, "machineType" text, "isActive" boolean);
        CREATE TABLE "PieceworkPriceBook" (id text PRIMARY KEY, status text, "workerId" text, "useUnifiedRates" boolean DEFAULT false);
        CREATE TABLE "PieceworkPriceRule" ("priceBookId" text, "operationType" "PieceworkOperationType", unit "PieceworkRateUnit", amount numeric);
      `);
      await client.query(migration);
      await client.query(`CREATE TRIGGER publication BEFORE INSERT OR UPDATE ON "PieceworkPriceBook"
        FOR EACH ROW EXECUTE FUNCTION validate_piecework_price_book_publication();
        INSERT INTO "PieceworkPriceBook" (id,status) VALUES ('foil','DRAFT'),('missing','DRAFT'),('null','DRAFT');
        INSERT INTO "PieceworkPriceRule" VALUES
          ('foil','PARTIAL','PER_PASS',0.007),('foil','FULL','PER_PIECE',0.01),
          ('missing','PARTIAL','PER_PASS',0.007),('missing','PACKING','PER_BAG',0.1),
          ('null','PARTIAL','PER_PASS',0.007),('null','FULL','PER_PIECE',0.01),('null','PACKING','PER_BAG',NULL);
      `);
      await expect(client.query(`UPDATE "PieceworkPriceBook" SET status='PUBLISHED' WHERE id='foil'`)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`UPDATE "PieceworkPriceBook" SET status='PUBLISHED' WHERE id='missing'`)).rejects.toThrow('incomplete');
      await expect(client.query(`UPDATE "PieceworkPriceBook" SET status='PUBLISHED' WHERE id='null'`)).rejects.toThrow('null rates');
      await client.query(`INSERT INTO "User" VALUES ('packer','WORKER','PACKER',NULL,true);
        INSERT INTO "PieceworkPriceBook" (id,status,"workerId") VALUES ('personal','DRAFT','packer');`);
      await expect(client.query(`UPDATE "PieceworkPriceBook" SET status='PUBLISHED' WHERE id='personal'`)).rejects.toThrow('must match the worker lane');
      await client.query(`INSERT INTO "PieceworkPriceRule" VALUES ('personal','PACKING','PER_BAG',0.1)`);
      await expect(client.query(`UPDATE "PieceworkPriceBook" SET status='PUBLISHED' WHERE id='personal'`)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});
