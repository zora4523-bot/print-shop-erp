import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PrismaClient, TxDirection } from '../../generated/prisma/client';
import { databasePoolConfig } from '../database-session';
import { applyMaterialStockMovement, MaterialInvariantError } from '../material';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const tables = ['User', 'Warehouse', 'WarehouseLocation', 'Material', 'MaterialLocationStock', 'MaterialTransaction'];
const stockTriggers = [
  'Material_currentStock_insert_guard', 'Material_currentStock_update_guard',
  'MaterialLocationStock_sync_insert_delete', 'MaterialLocationStock_sync_update',
];
const summaryViews = ['material_inventory_movement_summary', 'material_inventory_daily_summary'];
const transactionOptions = { maxWait: 5_000, timeout: 10_000 };
type StockFixture = { first: PrismaClient; second: PrismaClient; observer: Client; materialId: string };

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withStockFixture(run: (fixture: StockFixture) => Promise<void>) {
  const schema = `material_stock_race_${randomBytes(8).toString('hex')}`;
  const quotedSchema = quoteIdentifier(schema);
  const materialId = `${schema}-material`;
  const observer = new Client({ connectionString: databaseUrl });
  const pool = databasePoolConfig(databaseUrl!);
  const makeClient = () => new PrismaClient({ adapter: new PrismaPg({
    ...pool, max: 1, options: `${pool.options} -c search_path=${schema},public`,
  }, { schema }) });
  const first = makeClient();
  const second = makeClient();
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA ${quotedSchema}`);
    // Prisma qualifies enum parameter casts with its configured schema. Domains
    // preserve the installed enum validation while LIKE keeps the real column types.
    const enums = await observer.query<{ name: string }>(`
      SELECT enum_type.typname AS name FROM pg_type enum_type
      JOIN pg_namespace namespace ON namespace.oid = enum_type.typnamespace
      WHERE namespace.nspname = 'public' AND enum_type.typtype = 'e'
    `);
    for (const enumType of enums.rows) {
      await observer.query(`CREATE DOMAIN ${quotedSchema}.${quoteIdentifier(enumType.name)} AS public.${quoteIdentifier(enumType.name)}`);
    }
    for (const table of tables) {
      await observer.query(`CREATE TABLE ${quotedSchema}.${quoteIdentifier(table)} (LIKE public.${quoteIdentifier(table)} INCLUDING ALL)`);
    }
    // Keep the installed constraints and stock synchronization/summary guards.
    // LIKE copies indexes/checks, but PostgreSQL requires copying FKs and triggers separately.
    const foreignKeys = await observer.query<{ table: string; name: string; definition: string }>(`
      SELECT source.relname AS table, constraint_row.conname AS name,
             pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      JOIN pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
      WHERE namespace.nspname = 'public' AND source.relname = ANY($1::text[])
        AND constraint_row.contype = 'f'
    `, [tables]);
    for (const foreignKey of foreignKeys.rows) {
      let definition = foreignKey.definition;
      for (const table of tables) {
        definition = definition.replace(`REFERENCES ${quoteIdentifier(table)}(`, `REFERENCES ${quotedSchema}.${quoteIdentifier(table)}(`);
        definition = definition.replace(`REFERENCES public.${quoteIdentifier(table)}(`, `REFERENCES ${quotedSchema}.${quoteIdentifier(table)}(`);
      }
      await observer.query(`ALTER TABLE ${quotedSchema}.${quoteIdentifier(foreignKey.table)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} ${definition}`);
    }
    const triggers = await observer.query<{
      table: string; name: string; definition: string; functionName: string; functionDefinition: string;
    }>(`
      SELECT source.relname AS table, trigger_row.tgname AS name,
             pg_get_triggerdef(trigger_row.oid) AS definition,
             function_row.proname AS "functionName",
             pg_get_functiondef(function_row.oid) AS "functionDefinition"
      FROM pg_trigger trigger_row
      JOIN pg_class source ON source.oid = trigger_row.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
      JOIN pg_proc function_row ON function_row.oid = trigger_row.tgfoid
      WHERE namespace.nspname = 'public' AND source.relname = ANY($1::text[])
        AND NOT trigger_row.tgisinternal
    `, [tables]);
    // Additional triggers (including pg_ivm) need their own isolated dependencies.
    // Fail before fixture writes instead of silently following them into public.
    expect(triggers.rows.map(({ name }) => name).sort()).toEqual([...stockTriggers].sort());
    const functions = new Map(triggers.rows.map((trigger) => [trigger.functionName, trigger.functionDefinition]));
    for (const [name, definition] of functions) {
      const isolatedDefinition = definition.replace('FUNCTION public.', `FUNCTION ${quotedSchema}.`);
      expect(isolatedDefinition).not.toBe(definition);
      expect(isolatedDefinition).not.toMatch(/\bpublic\./);
      await observer.query(isolatedDefinition);
      // Preserve the real installed bodies, but do not permit unqualified table
      // references to fall back to public if a future dependency is added.
      await observer.query(`ALTER FUNCTION ${quotedSchema}.${quoteIdentifier(name)}() SET search_path TO ${quotedSchema}, pg_catalog`);
    }
    for (const trigger of triggers.rows) {
      const isolatedFunction = `EXECUTE FUNCTION ${quotedSchema}.${quoteIdentifier(trigger.functionName)}(`;
      const isolatedDefinition = trigger.definition.replace(
        ` ON public.${quoteIdentifier(trigger.table)} `,
        ` ON ${quotedSchema}.${quoteIdentifier(trigger.table)} `,
      ).replace(`EXECUTE FUNCTION ${trigger.functionName}(`, isolatedFunction)
        .replace(`EXECUTE FUNCTION public.${trigger.functionName}(`, isolatedFunction);
      expect(isolatedDefinition).not.toBe(trigger.definition);
      expect(isolatedDefinition).toContain(isolatedFunction);
      await observer.query(isolatedDefinition);
    }
    await observer.query(`SET search_path TO ${quotedSchema}, public`);
    const publicBefore = await readPublicSummaries(observer, materialId);
    await first.user.create({ data: { id: 'operator', username: 'stock-race-operator', password: 'not-a-login-fixture', role: 'ADMIN', displayName: '库存并发测试' } });
    await first.warehouse.create({ data: { id: 'warehouse', code: 'RACE-WH', name: '隔离并发仓库' } });
    await first.warehouseLocation.create({ data: { id: 'location', warehouseId: 'warehouse', code: 'RACE-LOC', name: '隔离并发库位' } });
    await first.material.create({ data: { id: materialId, code: 'RACE-MATERIAL', name: '并发测试纸张', category: 'PAPER', unit: '张' } });
    // Seed the authoritative location balance; the real trigger derives the total.
    await first.materialLocationStock.create({ data: { id: 'stock', materialId, warehouseId: 'warehouse', locationId: 'location', currentStock: '10.00' } });
    await expectBalances(first, materialId, '10.00');
    await run({ first, second, observer, materialId });
    expect(await readPublicSummaries(observer, materialId)).toEqual(publicBefore);
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    try {
      await observer.query('RESET search_path');
      await observer.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    } finally {
      await observer.end();
    }
  }
}

async function readPublicSummaries(client: Client, materialId: string) {
  return Promise.all(summaryViews.map(async (view) => {
    const result = await client.query(`SELECT to_jsonb(summary) AS row FROM public.${quoteIdentifier(view)} summary WHERE material_id = $1 ORDER BY to_jsonb(summary)::text`, [materialId]);
    return { view, rows: result.rows };
  }));
}

async function competingMovements(
  fixture: StockFixture,
  direction: TxDirection,
  quantities: readonly [string, string],
) {
  let releaseFirst!: () => void;
  const firstMayCommit = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstPid: number | undefined;
  let secondPid: number | undefined;
  let firstApplied = false;
  const move = (client: PrismaClient, index: 0 | 1) => client.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    if (index === 0) firstPid = connection!.pid;
    else secondPid = connection!.pid;
    const result = await applyMaterialStockMovement(tx, {
      materialId: fixture.materialId, locationId: 'location', operatorId: 'operator',
      direction, quantity: quantities[index], reasonType: `CONCURRENT_${index}`,
      unitCost: null, remark: null,
    });
    if (index === 0) {
      firstApplied = true;
      await firstMayCommit;
    }
    return result;
  }, transactionOptions);
  const firstMove = move(fixture.first, 0);
  // Attach handlers immediately, including when an assertion aborts coordination.
  const firstResult = Promise.allSettled([firstMove]);
  let secondResult: typeof firstResult | undefined;
  try {
    await expect.poll(() => firstApplied).toBe(true);
    const secondMove = move(fixture.second, 1);
    secondResult = Promise.allSettled([secondMove]);
    await expect.poll(() => secondPid).toBeTypeOf('number');
    expect(secondPid).not.toBe(firstPid);
    // Prove real concurrent lock contention before releasing the first commit.
    await expect.poll(async () => {
      const blocked = await fixture.observer.query<{ blocked: boolean }>(
        'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked',
        [firstPid, secondPid],
      );
      return blocked.rows[0]?.blocked;
    }).toBe(true);
  } finally {
    releaseFirst();
    await Promise.all([firstResult, secondResult]);
  }
  return [(await firstResult)[0]!, (await secondResult!)[0]!] as const;
}

async function expectBalances(client: PrismaClient, materialId: string, expected: string) {
  const material = await client.material.findUniqueOrThrow({ where: { id: materialId }, select: { currentStock: true } });
  const location = await client.materialLocationStock.findUniqueOrThrow({ where: { id: 'stock' }, select: { currentStock: true } });
  expect(material.currentStock.toFixed(2)).toBe(expected);
  expect(location.currentStock.toFixed(2)).toBe(expected);
}

postgresDescribe.sequential('material stock movement · PostgreSQL concurrent writers', () => {
  it('commits both IN increments and both ledger rows without losing quantity', async () => {
    await withStockFixture(async (fixture) => {
      const results = await competingMovements(fixture, TxDirection.IN, ['2.35', '4.15']);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      await expectBalances(fixture.first, fixture.materialId, '16.50');
      const ledger = await fixture.first.materialTransaction.findMany({
        where: { materialId: fixture.materialId, locationId: 'location' },
        select: { id: true, direction: true, quantity: true, reasonType: true },
        orderBy: { reasonType: 'asc' },
      });
      expect(ledger.map(({ direction, quantity, reasonType }) => ({ direction, quantity: quantity.toFixed(2), reasonType }))).toEqual([
        { direction: 'IN', quantity: '2.35', reasonType: 'CONCURRENT_0' },
        { direction: 'IN', quantity: '4.15', reasonType: 'CONCURRENT_1' },
      ]);
      expect(new Set(ledger.map(({ id }) => id)).size).toBe(2);
    });
  }, 20_000);

  it('rechecks the committed balance before a competing OUT and rolls back insufficient stock', async () => {
    await withStockFixture(async (fixture) => {
      const [first, second] = await competingMovements(fixture, TxDirection.OUT, ['7.00', '4.00']);
      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('rejected');
      if (second.status === 'rejected') {
        expect(second.reason).toBeInstanceOf(MaterialInvariantError);
        expect(second.reason.message).toBe('库存不足，不能出库到负数');
      }
      await expectBalances(fixture.first, fixture.materialId, '3.00');
      const ledger = await fixture.first.materialTransaction.findMany({
        select: { direction: true, quantity: true, reasonType: true },
      });
      expect(ledger.map(({ direction, quantity, reasonType }) => ({ direction, quantity: quantity.toFixed(2), reasonType }))).toEqual([
        { direction: 'OUT', quantity: '7.00', reasonType: 'CONCURRENT_0' },
      ]);
    });
  }, 20_000);
});
